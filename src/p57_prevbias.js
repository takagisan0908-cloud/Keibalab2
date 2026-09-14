/* =========================================================
   p57_prevbias.js — 「前日の馬場」を検出して、当日のトラックバイアス想定にする
   （#2026-09-12 第18弾）

   ★ ユーザーの依頼
     「日曜開催（日曜と月曜開催なら月曜に反映）: 前日の馬場がトラックバイアスとして
       確定しているので、前日分の馬場を検出して当日のバイアス想定を事前予想に反映したい」

   ★ これまでの制約と、今回の拡張
     トラックバイアスは「**その日の馬場**」の話なので、p13 の biasRacesOurs() は
     別日の記録を混ぜない設計になっています（biasVerdict() は当日ぶんだけを見る）。
     これは正しい制約なので **biasVerdict() 自体は変更しません**。
     かわりに「当日ぶんの記録がまだ無い／薄い」ときに限り、
     **学習DBから検出した前日の馬場を"想定"として補う**層を1枚かぶせます。

   ★ 「前日」の決めかた（日曜開催・日曜＋月曜開催の両方に自動対応）
     「カレンダー上の昨日」ではなく、**学習DBに入っている同じ競馬場のレース日で、
     対象日より前の一番新しい日**を前日とします。これで
       ・土曜＋日曜の2日開催 → 日曜の前日＝土曜
       ・日曜＋月曜の2日開催 → 月曜の前日＝日曜
       ・3日開催            → 3日目の前日＝2日目
     がすべて自動的に正しくなります。場が変われば（例: 東京→中山）別の日になるので混ぜません。
     前の開催まで空いている場合（例: 3週間前）は馬場が別物なので、
     **間隔が PB_MAX_GAP 日を超えたら使いません**。

   ★ 前日の馬場の測りかた（p13 の biasVerdict と同じ物差し）
     前日の全レースの **3着以内に入った馬の4角通過順** を
       biasPosToStyle(pos4, 頭数) → 逃げ / 先行 / 差し / 追込
     に分類し、前残り寄与度（逃げ1.00 / 先行0.78 / 差し0.38 / 追込0.06）の平均を取ります。
       frontScore >= 0.60 → 前残り・先行有利
       frontScore <= 0.42 → 差し・追込有利
       それ以外          → 前後バランス型
     データ源は学習DB（p52 hfCollectRaces が持つ passing / order / place / date8）なので
     **netkeiba への通信は一切ありません**。

   ★ 当日ぶんとの混ぜかた（ブレンド）
     前日の馬場は「確定した測定値」ではなく「当日の想定」なので、そのまま100%は使いません。
       縮小: f_prev = 0.5 + (frontScore − 0.5) × PB_K × 間隔による減衰
       ブレンド: 当日の3着内サンプル数 known に対して
                 f = w × 当日 + (1 − w) × 前日想定,   w = known ÷ (known + PB_BLEND_K)
     → 当日のデータが3頭ぶんしか無い朝イチは前日寄りの想定、
       全レースが終わるころには当日の実測が主役になります。
     当日ぶんが全く無い（レース前）ときは前日想定だけを使います。

   ★ 手動指定との関係
     展開予想欄でバイアスを**手動指定**したときは、そちらが最優先です（この想定は使いません）。
     「OFF」を選んだときは補正しません。
   ========================================================= */

var PB_K = 0.60;          // 前日の frontScore を 0.5 へどれだけ縮小するか（想定なので弱めに）
var PB_BLEND_K = 12;      // 当日の3着内サンプルが何頭ぶんあれば当日を半分信用するか
var PB_MAX_GAP = 8;       // 前の開催との間隔がこれを超えたら「別の馬場」とみなして使わない
var PB_MIN_KNOWN = 8;     // 前日の3着内サンプルがこれ未満なら判定しない（半日ぶん程度）
var PB_MIN_RACES = 3;     // 前日のレース数がこれ未満なら判定しない

var pbCache = { n: -1, days: null, at: 0 };

/* 学習DBを「競馬場 × 開催日」で集計する（通信ゼロ） */
function pbDayStats(){
  try {
    var races = (typeof hfCollectRaces === 'function') ? hfCollectRaces() : null;
    if (!races || !races.length) return null;
    if (pbCache.days && pbCache.n === races.length) return pbCache.days;
    var days = {};     // days[venue][d8] = { venue, d8, races, known, sum, styles, speedSum, speedN, oddsSum, oddsN }
    races.forEach(function(r){
      try {
        if (!r || !r.d8 || !r.place) return;
        var rows = r.rows || [];
        if (rows.length < 3) return;
        // 障害は馬場の性質が平地と違うので混ぜない
        if (r.surface === '障') return;
        var V = days[r.place] = days[r.place] || {};
        var D = V[r.d8] = V[r.d8] || {
          venue: r.place, d8: r.d8, races: 0, known: 0, sum: 0,
          styles: { '逃げ': 0, '先行': 0, '差し': 0, '追込': 0 },
          speedSum: 0, speedN: 0, oddsSum: 0, oddsN: 0, baba: r.baba || ''
        };
        D.races++;
        var n = rows.length;
        rows.forEach(function(x){
          var o = parseInt(x.order, 10) || 0;
          if (o < 1 || o > 3) return;
          var pos = (typeof hfLastPos === 'function') ? hfLastPos(x.passing) : 0;
          if (!pos) return;
          var sty = (typeof biasPosToStyle === 'function') ? biasPosToStyle(pos, n) : '';
          if (!sty) return;
          var w = (typeof biasStyleFrontWeight === 'function') ? biasStyleFrontWeight(sty) : -1;
          if (w < 0) return;
          D.sum += w; D.known++;
          D.styles[sty]++;
          if (x.odds > 1){ D.oddsSum += x.odds; D.oddsN++; }
        });
        // 時計（勝ち時計 − 基準時計）
        try {
          var win = null;
          rows.forEach(function(x){ if ((parseInt(x.order, 10) || 0) === 1) win = x; });
          if (win && win.timeSec > 0 && r.m && typeof nkParSec === 'function'){
            var par = nkParSec(r.surface, r.m, r.baba);
            if (par){ D.speedSum += (win.timeSec - par); D.speedN++; }
          }
        } catch(e){}
      } catch(e){}
    });
    pbCache = { n: races.length, days: days, at: Date.now() };
    return days;
  } catch(e){ return pbCache.days; }
}
function pbDrop(){ pbCache = { n: -1, days: null, at: 0 }; }

/* 1日ぶんの frontScore（0〜1）。サンプルが足りなければ null */
function pbDayScore(D){
  if (!D || D.known < PB_MIN_KNOWN || D.races < PB_MIN_RACES) return null;
  return D.sum / D.known;
}
function pbPosLabel(f){
  if (f == null) return '';
  if (f >= 0.60) return '前残り・先行有利';
  if (f <= 0.42) return '差し・追込有利';
  return '前後バランス型';
}
function pbDayGap(a8, b8){
  try {
    if (typeof hfDays === 'function') return hfDays(a8, b8);
  } catch(e){}
  function dt(s){ return new Date(parseInt(s.slice(0, 4), 10), parseInt(s.slice(4, 6), 10) - 1, parseInt(s.slice(6, 8), 10)); }
  return Math.round((dt(b8) - dt(a8)) / 86400000);
}

/* 対象日(d8)・競馬場(venue) の「前日の馬場」を返す。無ければ null
   → { venue, d8, gap, races, known, raw, frontScore(縮小後), posLabel, styles, speedLbl, payout, note } */
function pbPrevDay(d8, venue){
  try {
    d8 = String(d8 || '').replace(/[^0-9]/g, '');
    venue = String(venue || '');
    if (!/^\d{8}$/.test(d8) || !venue) return null;
    var days = pbDayStats();
    if (!days || !days[venue]) return null;
    var V = days[venue];
    /* 対象日より前の開催日を新しい順に並べ、**判定できる（サンプルが足りる）一番新しい日**を前日とする。
       障害だけの日は hfCollectRaces 側で surface==='障' を集計から外しているので known=0 になり、
       ここで自動的に飛ばされて 1 つ前の平地の開催日を見に行きます。 */
    var ks = Object.keys(V).filter(function(k){ return k < d8; }).sort().reverse();
    var prev = '', D = null, raw = null;
    for (var qi = 0; qi < ks.length; qi++){
      var sc = pbDayScore(V[ks[qi]]);
      if (sc == null) continue;
      prev = ks[qi]; D = V[ks[qi]]; raw = sc; break;
    }
    if (!prev || !D) return null;
    var gap = pbDayGap(prev, d8);
    if (!(gap >= 1)) return null;
    if (gap > PB_MAX_GAP){
      return { venue: venue, d8: prev, gap: gap, races: D.races, known: D.known, raw: raw,
               frontScore: null, posLabel: '', skip: true,
               note: '前の開催（' + gap + '日前）なので馬場が別物とみなし、想定には使いません。' };
    }
    // 間隔が空くほど弱める（1日空き＝1.0 / PB_MAX_GAP 日空き＝0.45）
    var gapShr = Math.max(0.45, 1 - (gap - 1) * 0.55 / Math.max(1, PB_MAX_GAP - 1));
    var f = 0.5 + (raw - 0.5) * PB_K * gapShr;
    var speed = D.speedN ? (D.speedSum / D.speedN) : null;
    var speedLbl = '';
    if (speed != null){
      if (speed <= -1.2) speedLbl = 'やや時計の出る速い馬場';
      else if (speed <= 0) speedLbl = '標準よりやや速い';
      else if (speed <= 1.4) speedLbl = 'ほぼ標準';
      else speedLbl = '時計がかかる重い傾向';
    }
    var avgOd = D.oddsN ? (D.oddsSum / D.oddsN) : null;
    var payout = avgOd == null ? '' : (avgOd <= 6 ? '堅い決着が続く（人気サイド）' : avgOd <= 14 ? '平均的な荒れ方' : '波乱含み（人気薄が絡む）');
    return {
      venue: venue, d8: prev, gap: gap, races: D.races, known: D.known,
      raw: raw, frontScore: f, posLabel: pbPosLabel(f), rawLabel: pbPosLabel(raw),
      styles: D.styles, speed: speed, speedLbl: speedLbl, payout: payout, baba: D.baba || '',
      skip: false,
      note: venue + ' ' + prev.slice(0, 4) + '/' + prev.slice(4, 6) + '/' + prev.slice(6, 8) +
        '（' + gap + '日前・' + D.races + 'レース・3着内' + D.known + '頭）の馬場: ' +
        pbPosLabel(raw) + '（前残り寄与 ' + raw.toFixed(2) + '）→ 当日の想定は ' + pbPosLabel(f) +
        '（' + f.toFixed(2) + ' に縮小）'
    };
  } catch(e){ return null; }
}

/* 現在の入力中のレースについて「前日の馬場」を引く */
function pbCurPrev(){
  try {
    var d8 = '';
    try { if (typeof hfCurD8 === 'function') d8 = hfCurD8() || ''; } catch(e){}
    if (!/^\d{8}$/.test(d8)){
      try { if (typeof biasDay8 === 'function') d8 = biasDay8() || ''; } catch(e){}
    }
    var venue = '';
    try { if (typeof biasTargetVenue === 'function') venue = (biasTargetVenue() || {}).name || ''; } catch(e){}
    if (!/^\d{8}$/.test(d8) || !venue) return null;
    return pbPrevDay(d8, venue);
  } catch(e){ return null; }
}
/* チェックボックス（使う/使わない） */
function pbUseOn(){
  try {
    // state が最優先（initPb() がチェックボックスの値をここへ写す）
    if (state && state.prevBiasUse === true) return true;
    if (state && state.prevBiasUse === false) return false;
    var el = (typeof document !== 'undefined') ? document.getElementById('pbUseChk') : null;
    if (el) return !!el.checked;
  } catch(e){}
  return true;
}

/* =========================================================
   biasStyleMul() からのフォールバック／ブレンド
   forcePrev = true のとき当日ぶん（state.biasRaces）を一切見ない
     → バックテスト用。当日ぶんの記録はその日のものではないため。
   返り値: { mul:{E,S,K,C}, v:{...} } か null
   ========================================================= */
function pbStyleMulFallback(forcePrev){
  try {
    if (!pbUseOn() && !forcePrev) return null;
    if (forcePrev && !pbUseOn()) return null;
    var pv = pbCurPrev();
    if (!pv || pv.skip || pv.frontScore == null) return null;
    var f = pv.frontScore, wCur = 0, curF = null, curKnown = 0;
    if (!forcePrev){
      var v = null;
      try { v = biasVerdict(); } catch(e){ v = null; }
      if (v && v.frontScore != null){
        curF = v.frontScore;
        curKnown = v.known || 0;
        wCur = curKnown / (curKnown + PB_BLEND_K);
        f = wCur * curF + (1 - wCur) * pv.frontScore;
      }
    }
    var mul = (typeof biasMulFromFront === 'function')
      ? biasMulFromFront(f) : { E: 1, S: 1, K: 1, C: 1 };
    var lbl = pbPosLabel(f);
    var note = (forcePrev ? '🕰 バックテスト: 当日ぶんは見ず、' : (wCur > 0 ? '🕰 前日の馬場 ' + Math.round((1 - wCur) * 100) + '% ＋ 当日ぶん ' + Math.round(wCur * 100) + '% のブレンド: ' : '🕰 当日ぶんの記録がまだ無いので前日の馬場を想定に使用: ')) +
      pv.note +
      (pv.speedLbl ? ' ／ 時計: ' + pv.speedLbl : '') +
      (pv.payout ? ' ／ 配当: ' + pv.payout : '');
    return {
      mul: mul,
      v: {
        counts: { front: (pv.styles['逃げ'] || 0) + (pv.styles['先行'] || 0), mid: 0,
                  back: (pv.styles['差し'] || 0) + (pv.styles['追込'] || 0) },
        styles: { '逃げ': pv.styles['逃げ'], '先行': pv.styles['先行'], '差し': pv.styles['差し'],
                  '追込': pv.styles['追込'], known: pv.known, legacy: 0 },
        frontScore: f, posLabel: lbl, posNote: note,
        speed: pv.speed, speedLbl: pv.speedLbl, payout: pv.payout, moneyAvg: null,
        lane: null, known: pv.known, races: pv.races, laneTotal: 0, legacy: 0,
        prevDay: true, prev: pv, blend: (wCur > 0), blendCur: curF, blendW: wCur
      }
    };
  } catch(e){ return null; }
}

/* ---------- 表示 ---------- */
function pbHTML(){
  var pv = null;
  try { pv = pbCurPrev(); } catch(e){ pv = null; }
  if (!pv){
    return '<div class="small muted">🕰 前日の馬場: この競馬場・この日付より前の開催が学習DBに見つかりません' +
      '（結果を取り込むと自動で検出できるようになります）。</div>';
  }
  if (pv.skip){
    return '<div class="small muted">🕰 前日の馬場: ' + esc(pv.note) + '</div>';
  }
  var on = pbUseOn();
  var st = pv.styles || {};
  var bar = ['逃げ', '先行', '差し', '追込'].map(function(k){
    var c = st[k] || 0;
    var p = pv.known ? (c / pv.known * 100) : 0;
    var col = (typeof BIAS_STYLE_COLORS !== 'undefined' && BIAS_STYLE_COLORS[k]) ? BIAS_STYLE_COLORS[k] : '#888';
    return '<div style="width:' + p.toFixed(1) + '%;background:' + col + '" title="' + k + ' ' + c + '頭"></div>';
  }).join('');
  var d = pv.d8;
  return '<div class="small" style="margin:4px 0">' +
    '<b>🕰 前日の馬場（' + esc(pv.venue) + ' ' + d.slice(0, 4) + '/' + d.slice(4, 6) + '/' + d.slice(6, 8) +
    '・' + pv.gap + '日前・' + pv.races + 'レース）</b>: ' +
    '<b style="color:var(--info-ink)">' + esc(pv.rawLabel || '') + '</b>' +
    '<span class="muted">（前残り寄与 ' + pv.raw.toFixed(2) + ' ／ 3着内 ' + pv.known + '頭）</span>' +
    '<div style="display:flex;height:7px;border-radius:4px;overflow:hidden;margin:3px 0;background:var(--card2)">' + bar + '</div>' +
    '<div class="small muted">' + ['逃げ', '先行', '差し', '追込'].map(function(k){
      return k + ' ' + (st[k] || 0);
    }).join(' / ') +
    (pv.speedLbl ? '　⏱ 時計: ' + esc(pv.speedLbl) + (pv.baba ? '（馬場 ' + esc(pv.baba) + '）' : '') : '') +
    (pv.payout ? '　💴 配当: ' + esc(pv.payout) : '') + '</div>' +
    '<div class="small" style="margin-top:3px">→ 当日の<b>想定バイアス</b>: <b>' + esc(pv.posLabel || '') + '</b>' +
    '<span class="muted">（前残り寄与 ' + pv.frontScore.toFixed(2) + ' ＝ 実測 ' + pv.raw.toFixed(2) + ' を ' +
    Math.round(PB_K * 100) + '% へ縮小' + (pv.gap > 1 ? '・' + pv.gap + '日空きなのでさらに減衰' : '') + '）</span>' +
    (on ? '　<span style="color:var(--ok-ink)">✅ 当日ぶんが薄い間はこれを予想に使います（当日の記録が増えるほど当日ぶんが主役になります）</span>'
        : '　<span class="muted">（「前日の馬場を想定に使う」がオフなので表示だけ）</span>') +
    '</div></div>';
}
function pbPaint(){
  try {
    var el = document.getElementById('pbBox');
    if (el) el.innerHTML = pbHTML();
  } catch(e){}
}
function initPb(){
  try {
    var c = document.getElementById('pbUseChk');
    if (c){
      c.checked = !(state && state.prevBiasUse === false);
      try { if (state) state.prevBiasUse = !!c.checked; } catch(e){}
      c.addEventListener('change', function(){
        try { if (state) state.prevBiasUse = !!c.checked; } catch(e){}
        pbPaint();
        try { if (typeof renderKentaiFull === 'function') renderKentaiFull(); } catch(e){}
      });
    }
    var card = document.getElementById('pbCard');
    if (card) card.addEventListener('toggle', function(){ if (card.open) pbPaint(); });
    pbPaint();
  } catch(e){}
}
