/* =========================================================
   p54_factorlearn.js — 提案4: 学習の単位を「年月」から「ファクター別」へ
   （#2026-09-12 第17弾）

   ★ なぜこれが要るか
   従来の自己学習は「年月ごとの回収率」で 3 つのスカラー（hitTm / roiRho / hybLam）を
   調整するだけでした。これだと **どのファクターが効いたのか** が分かりません。
   （例: 調教タイムは効いているのに持ちタイムは効いていない、ということが区別できない）

   ★ 何をするか
   出走前に保存したスナップショット（rec.pre）には、そのときの
   **各ファクターの正規化値**（オッズ/調教/持ちタイム/展開/馬場/洋芝/学習DB実績）が
   1頭ずつ入っています。結果が来たら、ファクターごとに次を測ります。

     あるレースの中で、そのファクターの値が **高かった馬（上位1/3）** と
     **低かった馬（下位1/3）** の「リフト（実勝率 − 市場期待勝率）」を比べる
       spread = lift(高) − lift(低)
     spread > 0 … そのファクターは馬の優劣を正しく見分けられている
     spread ≒ 0 … ノイズ（重みを下げる）
     spread < 0 … 逆効果（重みを大きく下げる）

   これを全レースで累積し、ファクターごとの重み倍率（0.4〜1.6）を作って
   p5_engine の state.weights に掛けます（state.weights 自体は書き換えません）。

   ★ いかさま防止
   rec.pre は「結果を知らない時点」で保存したものだけを使います（apSnapPred 側で
   結果確定済みのレースは保存を断っています）。さらに照合は rec.result があるものだけ。
   ========================================================= */

var FL_MIN_RACES = 30;      // 重みを動かし始めるのに必要な最低レース数
var FL_MIN_CELL = 60;       // 1ファクターの高低それぞれに必要な最低頭数
var FL_K = 1.6;             // spread → 倍率 の効き
var FL_SHRINK = 60;         // サンプルが少ないほど 1.0 へ縮小するための定数
/* rec.pre の f.* のキー → state.weights のキー */
var FL_FACTORS = [
  { k: 'O',  w: 'odds',   label: '📊 単勝オッズ(人気)', scale: false },
  { k: 'Y',  w: 'yobi',   label: '🏇 調教タイム',       scale: true },
  { k: 'T',  w: 'time',   label: '⏱ 持ちタイム',       scale: true },
  { k: 'K',  w: 'tenkai', label: '🧭 展開・脚質',       scale: true },
  { k: 'B',  w: 'baba',   label: '🏟 バ場好走率',       scale: true },
  { k: 'Y2', w: 'yoso',   label: '🏔 洋芝・コース適性', scale: true },
  { k: 'A',  w: 'abl',    label: '📚 学習DBの過去実績', scale: true }
];

function flCnt(){ return { n: 0, win: 0, top3: 0, exp: 0 }; }
function flAdd(c, order, mi){
  c.n++;
  c.exp += (mi || 0);
  if (order === 1) c.win++;
  if (order >= 1 && order <= 3) c.top3++;
}
function flLift(c){
  if (!c.n) return null;
  return { n: c.n, win: c.win / c.n, exp: c.exp / c.n, lift: c.win / c.n - c.exp / c.n,
           top3: c.top3 / c.n };
}

/* 保存済みの「事前予想＋結果」がそろったレースを集める */
function flRaces(){
  var out = [];
  try {
    /* ★2026-09-12 第18弾: 対象を「apCompleted()（rec.result があるもの）」から
       「apStoredRaceList()（学習DBの全レース＋自己検証済みレコード）」へ広げる。
       バックテスト(rec.preBt)だけのレースは rec.result を持たないので、
       apCompleted() だと1件も拾えず、せっかくの数千レースぶんが無駄になるため。
       結果行は apStoredRaceList() の p.rows から取る。 */
    var list = (typeof apStoredRaceList === 'function') ? (apStoredRaceList() || []) : [];
    list.forEach(function(item){
      var rid0 = String((item && item.rid) || '');
      if (!rid0) return;
      var resRows = (item.p && item.p.rows) || [];
      var rec = null;
      try { rec = (typeof apGet === 'function') ? apGet(rid0) : null; } catch(e){ rec = null; }
      if (!rec) return;
      if (!resRows.length && rec.result && rec.result.rows) resRows = rec.result.rows;
      if (!resRows || !resRows.length) return;
      rec = { rid: rid0, pre: rec.pre, preBt: rec.preBt, result: { rows: resRows } };
      /* ★2026-09-12 第18弾: 学習データ源を「本物の事前予想(rec.pre) → 無ければバックテスト(rec.preBt)」に拡張。
         バックテストは過去レースを「レース日より前の出走データだけ」で予想し直したもの（p53 preBacktest）で、
         synthetic:true / src:'backtest' が付いています。
         これにより 30レース待ちだった重み調整が、学習DBの全レースぶん（数千）で効くようになります。
         同じレースを pre と preBt の両方で数えると二重計上になるので、pre を優先して1レース1件にします。 */
      var PRE = (rec.pre && rec.pre.rows && rec.pre.rows.length) ? rec.pre
              : (rec.preBt && rec.preBt.rows && rec.preBt.rows.length) ? rec.preBt : null;
      if (!PRE) return;
      var PRE_SRC = (PRE === rec.pre) ? 'live' : 'backtest';
      // 着順と市場期待勝率を馬番で引けるようにする
      var orderByNo = {}, oddsByNo = {}, n = 0, inv = 0;
      rec.result.rows.forEach(function(r){
        if (!r || r.no == null) return;
        var o = parseInt(r.order, 10) || 0;
        if (o < 1) return;
        orderByNo[String(r.no)] = o;
        var od = (typeof apNum === 'function') ? apNum(r.odds) : parseFloat(String(r.odds || '').replace(/[^0-9.]/g, ''));
        if (od > 1){ oddsByNo[String(r.no)] = od; inv += 1 / od; n++; }
      });
      if (!(inv > 0) || n < 3) return;
      var rows = [];
      PRE.rows.forEach(function(x){
        if (!x || x.no == null) return;
        var no = String(x.no);
        if (orderByNo[no] == null) return;
        var od = oddsByNo[no];
        if (!od) return;
        rows.push({ no: no, order: orderByNo[no], odds: od, mi: (1 / od) / inv, f: x.f || {} });
      });
      if (rows.length >= 3) out.push({ rid: String(rec.rid || ''), rows: rows, src: PRE_SRC });
    });
  } catch(e){}
  return out;
}

/* ファクターごとの集計 */
function flLearn(races){
  var L = { at: Date.now(), races: (races || []).length, f: {}, nLive: 0, nBt: 0 };
  (races || []).forEach(function(rc){ if (rc && rc.src === 'backtest') L.nBt++; else L.nLive++; });
  FL_FACTORS.forEach(function(fd){ L.f[fd.k] = { hi: flCnt(), lo: flCnt(), mid: flCnt(), races: 0 }; });
  (races || []).forEach(function(rc){
    FL_FACTORS.forEach(function(fd){
      var withV = rc.rows.filter(function(x){
        var v = x.f ? x.f[fd.k] : null;
        return (typeof v === 'number' && isFinite(v));
      });
      // 全部同じ値（＝材料が無くて 0.5 固定）なら判定しない
      var mn = 1e9, mx = -1e9;
      withV.forEach(function(x){ var v = x.f[fd.k]; if (v < mn) mn = v; if (v > mx) mx = v; });
      if (withV.length < 6 || (mx - mn) < 0.02) return;
      var cell = L.f[fd.k];
      cell.races++;
      var sorted = withV.slice().sort(function(a, b){ return b.f[fd.k] - a.f[fd.k]; });   // 値の大きい順
      var k = Math.max(1, Math.round(sorted.length / 3));
      for (var i = 0; i < sorted.length; i++){
        var x = sorted[i];
        var g = (i < k) ? cell.hi : (i >= sorted.length - k) ? cell.lo : cell.mid;
        flAdd(g, x.order, x.mi);
      }
    });
  });
  // spread と倍率
  FL_FACTORS.forEach(function(fd){
    var c = L.f[fd.k];
    var hi = flLift(c.hi), lo = flLift(c.lo);
    c.hiF = hi; c.loF = lo;
    c.spread = (hi && lo) ? (hi.lift - lo.lift) : null;
    var enough = (hi && lo && hi.n >= FL_MIN_CELL && lo.n >= FL_MIN_CELL && c.races >= FL_MIN_RACES);
    c.enough = !!enough;
    if (enough){
      var shr = c.races / (c.races + FL_SHRINK);
      c.mul = clamp(1 + c.spread * FL_K * shr, 0.4, 1.6);
    } else {
      c.mul = 1;
    }
  });
  return L;
}

/* p5_engine から呼ばれる。→ { yobi: 1.12, time: 0.86, ... }（odds は返さない） */
var flCache = null, flCacheAt = 0;
function apFactorScale(force){
  try {
    if (!force && flCache && (Date.now() - flCacheAt) < 20000) return flCache.scale;
    var L = flLearn(flRaces());
    flCache = { L: L, at: Date.now() };
    flCacheAt = Date.now();
    var sc = {};
    FL_FACTORS.forEach(function(fd){
      if (!fd.scale) return;
      var c = L.f[fd.k];
      if (c && c.enough && c.mul !== 1) sc[fd.w] = Math.round(c.mul * 1000) / 1000;
    });
    flCache.scale = sc;
    return sc;
  } catch(e){ return null; }
}
function flGet(force){
  try {
    if (!force && flCache && (Date.now() - flCacheAt) < 20000) return flCache.L;
    apFactorScale(force);
    return flCache ? flCache.L : null;
  } catch(e){ return null; }
}
function flDrop(){ flCache = null; flCacheAt = 0; }

/* ---------- 表示（🔬 AI予想の診断カードに出す） ---------- */
function flHTML(){
  var L = flGet(false);
  if (!L || !L.races) return '';
  var rows = [];
  FL_FACTORS.forEach(function(fd){
    var c = L.f[fd.k];
    if (!c || !c.races) return;
    var hi = c.hiF, lo = c.loF;
    rows.push([
      fd.label,
      c.races + ' レース',
      hi ? (hi.n + '頭 ' + (hi.lift >= 0 ? '+' : '') + (hi.lift * 100).toFixed(1) + 'pt') : '—',
      lo ? (lo.n + '頭 ' + (lo.lift >= 0 ? '+' : '') + (lo.lift * 100).toFixed(1) + 'pt') : '—',
      c.spread == null ? '—' : ('<b style="color:' + (c.spread > 0.005 ? 'var(--ok-ink)' : (c.spread < -0.005 ? 'var(--warn-ink)' : 'var(--fg)')) + '">' +
        (c.spread >= 0 ? '+' : '') + (c.spread * 100).toFixed(1) + 'pt</b>'),
      c.enough ? ('<b>×' + c.mul.toFixed(2) + '</b>' + (fd.scale ? '' : ' <span class="muted">(計測のみ)</span>'))
               : '<span class="muted">サンプル不足 ×1.00</span>'
    ]);
  });
  if (!rows.length){
    return '<div class="small muted" style="margin:6px 0">📌 事前予想と結果がそろったレースがまだありません。' +
      '①データ入力の「🕰 バックテストを実行」を押すと、学習DBの過去レースぶん（数千レース）をすぐ学習に使えます。</div>';
  }
  var need = Math.max(0, FL_MIN_RACES - L.races);
  return '<div style="margin:10px 0 4px;font-weight:700">⑧ ファクター別の学習（提案4）― どの材料が効いているか</div>' +
    '<div style="overflow:auto"><table class="tbl" style="font-size:.78rem;min-width:640px"><thead><tr>' +
    '<th>ファクター</th><th>対象</th><th>リフト（値が高かった馬 上位1/3）</th><th>リフト（値が低かった馬 下位1/3）</th><th>見分け力 spread</th><th>重みへの反映</th>' +
    '</tr></thead><tbody>' +
    rows.map(function(r){
      return '<tr>' + r.map(function(c, i){
        return (i === 0) ? '<th style="text-align:left;white-space:nowrap">' + c + '</th>' : '<td>' + c + '</td>';
      }).join('') + '</tr>';
    }).join('') +
    '</tbody></table></div>' +
    '<div class="small muted" style="margin:2px 0 6px">' +
    '<b>リフト</b> = 実勝率 − 市場期待勝率。<b>spread</b> = 「値が高かった馬のリフト」−「値が低かった馬のリフト」で、' +
    'プラスならそのファクターは馬の優劣を正しく見分けられています。0付近ならノイズ、マイナスなら逆効果です。' +
    'spread を重みの倍率（×0.40〜×1.60）にして ①のAI印へ自動反映します（オッズは市場とのブレンド率にも使うので計測のみ）。' +
    '<br>対象: 予想と結果がそろった <b>' + L.races + '</b> レース（📌本物の事前予想 <b>' + (L.nLive || 0) +
    '</b> ＋ 🕰バックテスト <b>' + (L.nBt || 0) + '</b>）' +
    (need > 0 ? ' → 重みを動かし始めるには<b>あと ' + need + ' レース</b>（' + FL_MIN_RACES + ' レース未満は ×1.00 のまま）' : ' → ✅ 重みの自動調整が有効') +
    '。1ファクターあたり高低それぞれ ' + FL_MIN_CELL + ' 頭以上必要です。' +
    '<br>★ この学習は<b>「出走前と同じ条件」で作ったスナップショットだけ</b>を使います（📌本物の事前予想 <code>rec.pre</code> ＋ ' +
    '🕰バックテスト <code>rec.preBt</code>）。バックテストは結果側の情報（着順・タイム・上り・通過順・着差・払戻）を一切使わず、' +
    '過去実績も<b>レース日より前の出走だけ</b>から作るので、結果を見てから作った印にはなりません。' +
    '</div>';
}
function flPaint(){
  var box = null;
  try { box = document.getElementById('flBox'); } catch(e){}
  if (!box) return;
  try {
    flDrop();
    var h = flHTML();
    box.innerHTML = h || '<div class="small muted">📌 事前予想と結果がそろったレースがまだありません。①の「📥 その日の出馬表を一括取得」でレース前に出馬表を取り込むと、結果が出たときに照合されてここに出ます。</div>';
  } catch(e){}
}
