/* =========================================================
   p61_wtauto.js — 🎛 AI予想エンジンの重みを「レースごとに」自動補正する
   （#2026-09-13 第21弾⑤）

   ご依頼: 「AI予想エンジンの重み設定にて『あなたの予想印』の項目を削除。
            他のスライダーに関しても過去のレース展開やトラックバイアス、学習DB内容、
            各詳細データなどからレースごとにAIで判断してスライダーの位置を変更し
            予想の精度を上げていく必要がある」

   方式は【オーバーレイ】です（ご指定どおり）。
   ・**手動のスライダー位置(state.weights)は書き換えません**。そのまま基準値として残ります。
   ・レースごとの自動補正（×0.30〜×1.60）を計算して、AI印の計算のなかだけで掛けます。
   ・スライダーの右に「×1.24 → 実効 8.7」のような補正バーを出して、何倍になっているかを見せます。
   ・☑「レースごとに自動で補正」をOFFにすると、即座に素のスライダー値だけに戻ります。

   2つの補正を掛け合わせています（役割が違うので両方必要）:
   ┌──────────────────────┬──────────────────────────────────────────────┐
   │ ①ファクター別リフト学習 │ 「この材料は**歴史的に**効いているか」           │
   │   apFactorScale()      │  事前予想×実結果のリフトから（p54・第17弾から）  │
   │   レース横断・ゆっくり   │  ×0.40〜×1.40                                │
   ├──────────────────────┼──────────────────────────────────────────────┤
   │ ②このレースの材料充足度 │ 「**このレースでは**その材料がどれだけ揃っているか」│
   │   wtCompute() ★新規    │  各詳細データ・トラックバイアス・学習DBの入り具合  │
   │   レースごと・即座      │  ×0.30〜×1.60                                │
   └──────────────────────┴──────────────────────────────────────────────┘
   実効重み = スライダー値 × ① × ②

   ★ ②が効く理由: 材料が半分しか無い馬列で「🏟バ場好走率」を満点の重みで掛けると、
     データの無い馬が 0.5（中立）に寄って**数据のある馬だけ損をする**ゆがみが出ます。
     揃い具合に応じて重みを落とすと、そのレースで本当に使える材料だけが効くようになります。

   ※ odds（単勝オッズ）は市場確率とのブレンド率にも使っているため、ここでは補正しません
     （第17弾のファクター別学習でも同じ理由で除外しています）。
   ========================================================= */

var WT_MIN = 0.30, WT_MAX = 1.60;
var WT_FACTORS = [
  { k:'yobi',   label:'🏇 調教タイム' },
  { k:'time',   label:'⏱ 持ちタイム' },
  { k:'tenkai', label:'🧭 展開・脚質' },
  { k:'baba',   label:'🏟 バ場好走率' },
  { k:'yoso',   label:'🏔 洋芝・コース適性' },
  { k:'abl',    label:'📚 学習DBの過去実績' }
];
var WT_LAST = null;      // 直近の補正内容（表示用・{ at, n, muls:{}, cov:{}, why:{} }）

function wtClamp(x, a, b){ x = +x; if (!isFinite(x)) return a; return x < a ? a : (x > b ? b : x); }
function wtOn(){
  try { return (typeof amOn === 'function') ? amOn('wtAuto') : true; } catch(e){ return true; }
}

/* ---------- このレースの材料充足度（0〜1） ----------
   ★ analyzeRace の中で列（colY/colT/colK/colB/colY2/colA）を作った直後に呼ぶので、
     馬柱データや学習DBを2回読み直すことがありません（重い処理の二度手間を避けます）。
   o = { n, yobi:[0/1…], time:[0/1…], tenkai:[0/1…], baba:[…], yoso:[…], abl:[…] } */
var WT_KEYS = ['yobi','time','tenkai','baba','yoso','abl'];
function wtCovBuild(o){
  o = o || {};
  var cov = {}, det = {};
  WT_KEYS.forEach(function(k){
    var arr = o[k] || [], sum = 0;
    for (var i = 0; i < arr.length; i++) sum += (+arr[i] || 0);
    det[k] = Math.round(sum * 10) / 10;
    cov[k] = o.n ? (sum / o.n) : 0;
  });
  return { cov: cov, det: det, n: o.n || 0 };
}

/* ---------- トラックバイアスの信頼度（当日の記録が何レースぶんあるか） ---------- */
function wtBiasConf(){
  var n = 0, known = 0;
  try {
    var t8 = '';
    if (typeof baToday8 === 'function') t8 = baToday8();
    if (typeof baDayRaces === 'function' && t8){
      var rs = baDayRaces(t8) || [];
      n = rs.length;
      rs.forEach(function(rc){
        if (rc && Array.isArray(rc.money)){
          rc.money.forEach(function(m){ if (m && (m.sty || m.bucket)) known++; });
        }
      });
    }
  } catch(e){}
  // 当日の記録 0レース → ×0.85（前日・別日の記録でまだ何とかなる）
  // 8レース以上 → ×1.25 まで上げる（その日の馬場が実際に測れている）
  var mul = wtClamp(0.85 + Math.min(n, 8) * 0.05, 0.85, 1.25);
  return { n:n, known:known, mul:mul };
}

/* ---------- 補正倍率を計算する（表示・計算の両方がここを使う） ----------
   c = wtCovBuild() の戻り値。res（分析結果）は要りません＝analyzeRace の途中から呼べます。 */
function wtCompute(c){
  var out = { at: Date.now(), n: (c && c.n) || 0, muls: {}, cov: {}, why: {}, bias: null, on: wtOn() };
  var bc = wtBiasConf();
  out.bias = bc;
  var cov = (c && c.cov) || {}, det = (c && c.det) || {}, n = (c && c.n) || 0;
  WT_FACTORS.forEach(function(f){
    var cv = +cov[f.k] || 0;
    out.cov[f.k] = cv;
    /* 材料が 0 → ×0.30（ほとんど効かせない）／半分 → ×1.00／全部 → ×1.60。
       線形にすると「1頭だけデータがある」ケースで急に跳ねるので、0.5 を中心にした折れ線にしています。 */
    var m = cv <= 0.5 ? (0.30 + (cv / 0.5) * 0.70) : (1.00 + ((cv - 0.5) / 0.5) * 0.60);
    var why = '材料 ' + Math.round(cv * 100) + '%（' + (det[f.k] || 0) + '/' + n + '頭ぶん）';
    if (f.k === 'tenkai'){
      m *= bc.mul;
      why += '／🌊当日バイアス ' + bc.n + ' レースぶん（×' + bc.mul.toFixed(2) + '）';
    }
    out.muls[f.k] = Math.round(wtClamp(m, WT_MIN, WT_MAX) * 1000) / 1000;
    out.why[f.k] = why;
  });
  WT_LAST = out;
  return out;
}

/* ---------- p5_engine から呼ばれる「実効重み」 ----------
   w0 = スライダーの値（state.weights）/ res = 分析結果 / hs = 出走馬
   戻り値: { w: 実効重みのコピー, wt: 補正内容 }
   ★ state.weights は絶対に書き換えません（オーバーレイ方式）。 */
function wtEffective(w0, covInfo){
  var w = {};
  for (var k in w0){ if (Object.prototype.hasOwnProperty.call(w0, k)) w[k] = w0[k]; }
  /* ★第21弾⑤: 「🧠 あなたの印」は重み設定の項目から削除しました。
     印の入力欄そのものは残します（メモ・買い目の照合・自己学習の記録として使えます）が、
     AI印の計算には一切使いません（＝自分の予想がAIの答えに影響して自己強化するのを止めます）。 */
  w.mark = 0;
  if (!wtOn() || !covInfo || !covInfo.n) return { w: w, wt: null };
  var wt = wtCompute(covInfo);
  WT_FACTORS.forEach(function(f){
    if (w[f.k] == null) return;
    w[f.k] = Math.max(0, w[f.k] * (wt.muls[f.k] != null ? wt.muls[f.k] : 1));
  });
  return { w: w, wt: wt };
}

/* ---------- 表示 ---------- */
function wtRender(res){
  var box = $('wtAutoBox');
  if (!box) return;
  var hs = (typeof state !== 'undefined' && state && state.horses) || [];
  var on = wtOn();
  var w0 = (typeof state !== 'undefined' && state && state.weights) || {};
  var chk = $('wtAutoChk');
  if (chk && typeof chk.checked === 'boolean' && chk.checked !== on) chk.checked = on;
  if (!on){
    box.innerHTML = '<div class="small muted">☑「レースごとに自動で補正」がOFFです。スライダーの値だけがそのまま使われます。</div>';
    return;
  }
  /* 補正値は analyzeRace の中で計算済み（WT_LAST）。ここでは描画だけします。
     2回計算すると 馬柱・学習DB の読み直しで重くなるため、必ずこの流れにしてください。 */
  var wt = (WT_LAST && WT_LAST.on && WT_LAST.n) ? WT_LAST : null;
  /* スライダーの右に補正バーを出す */
  try {
    WT_FACTORS.forEach(function(f){
      var bar = $('wtBar_' + f.k);
      if (!bar) return;
      if (!wt){ bar.innerHTML = ''; return; }
      var m = wt.muls[f.k];
      var base = w0[f.k] || 0;
      var eff = base * m;
      var up = m > 1.001, dn = m < 0.999;
      bar.innerHTML = '<span class="wtmul" style="color:' + (up ? 'var(--ok-ink,#1c6e42)' : dn ? 'var(--bad-ink,#b3261e)' : 'var(--muted)') + '">' +
        '×' + m.toFixed(2) + '</span> → <b>' + eff.toFixed(1) + '</b>';
      bar.title = (wt.why[f.k] || '') + '\n実効重み = スライダー ' + base + ' × 自動補正 ' + m.toFixed(2);
    });
    var mb = $('wtBar_mark');
    if (mb) mb.innerHTML = '<span class="wtmul muted">削除（常に0）</span>';
  } catch(e){}
  if (!wt){
    box.innerHTML = '<div class="small muted">出走馬が入ると、このレースの材料の揃い具合から自動補正を計算します。</div>';
    return;
  }
  var fs = null;
  try { if (typeof apFactorScale === 'function') fs = apFactorScale(); } catch(e){}
  var rows = WT_FACTORS.map(function(f){
    var base = w0[f.k] || 0;
    var m2 = wt.muls[f.k];
    var m1 = (fs && fs[f.k] != null) ? fs[f.k] : 1;
    return '<tr><td style="text-align:left">' + f.label + '</td>' +
      '<td>' + base + '</td>' +
      '<td>' + m1.toFixed(2) + '</td>' +
      '<td><b style="color:' + (m2 > 1.001 ? 'var(--ok-ink,#1c6e42)' : m2 < 0.999 ? 'var(--bad-ink,#b3261e)' : 'inherit') + '">' +
        m2.toFixed(2) + '</b></td>' +
      '<td><b>' + (base * m1 * m2).toFixed(1) + '</b></td>' +
      '<td style="text-align:left" class="muted small">' + esc(wt.why[f.k] || '') + '</td></tr>';
  }).join('');
  rows += '<tr><td style="text-align:left">🧠 あなたの印</td><td colspan="3" class="muted">—</td>' +
    '<td><b>0</b></td><td style="text-align:left" class="muted small">★第21弾⑤で重み設定から削除（AI印の計算には使いません。印の入力欄は残ります）</td></tr>';
  box.innerHTML =
    '<div class="small muted" style="margin:2px 0 4px">実効重み = <b>スライダーの値</b> × <b>①歴史的な効き目</b>（リフト学習） × <b>②このレースの材料の揃い具合</b>。' +
    'スライダーの位置そのものは変わりません（いつでも手動値に戻せます）。</div>' +
    '<div style="overflow-x:auto"><table class="lr-tbl" style="font-size:.76rem;white-space:nowrap">' +
    '<thead><tr><th style="text-align:left">材料</th><th>スライダー</th><th>①歴史的</th><th>②このレース</th><th>実効</th><th style="text-align:left">②の根拠</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>' +
    '<div class="small muted" style="margin-top:3px">🌊 当日のトラックバイアス: <b>' + (wt.bias ? wt.bias.n : 0) + '</b> レースぶん' +
    (wt.bias && wt.bias.known ? '（脚質を判定できた延べ ' + wt.bias.known + ' 頭）' : '') +
    ' → 🧭展開・脚質に ×' + (wt.bias ? wt.bias.mul.toFixed(2) : '1.00') +
    '。　※①は「事前予想 × 実際の結果」が貯まるほど効いてきます（🔬AI予想の診断で中身を確認できます）。</div>';
}
function wtInit(){
  var chk = $('wtAutoChk');
  if (chk){
    chk.checked = wtOn();
    chk.addEventListener('change', function(){
      try { if (typeof amSet === 'function') amSet('wtAuto', !!chk.checked); } catch(e){}
      try {
        if (typeof renderTables === 'function' && typeof currentAnalysis === 'function'){
          renderTables(currentAnalysis());
        }
      } catch(e){}
      wtRender(null);
    });
  }
  var b = $('wtAutoBtn');
  if (b) b.addEventListener('click', function(){
    try { if (typeof flDrop === 'function') flDrop(); } catch(e){}   // ①のリフト学習を計算し直す
    try { if (typeof renderTables === 'function' && typeof currentAnalysis === 'function') renderTables(currentAnalysis()); } catch(e){}
    wtRender(null);
  });
  try { wtRender(null); } catch(e){}
}
