/* =========================================================
   p56_picks.js — 各レースの「軸に最適馬・妙味馬・穴馬」を1頭ずつ選ぶ
   （#2026-09-12 第18弾）

   ★ 3つの選びかた（どれも ①のAI印＝analyzeRace() の出力から計算します）
     🎯 軸に最適馬 … AIの勝率が**一番高い**馬。3連系の「軸（1着固定／1頭軸）」に向く
                     = 最も外しにくい馬。prob の最大。
     💠 妙味馬     … **期待値（AI勝率 × 単勝オッズ）が一番高い**馬。
                     1.0を超えていれば「オッズが実力より甘い」＝単勝で買って长期でプラスになる側。
                     軸と同じ馬になることもあるので、そのときは軸を除いた2番手を妙味馬にします。
     🕳 穴馬       … **人気薄（おおむね6番人気以下）の中で、AI評価が市場評価を一番上回っている**馬。
                     edge = AI勝率 ÷ 市場期待勝率 で測ります（market期待勝率 = (1/オッズ)÷Σ(1/オッズ)）。
                     3連系の「相手」や3連単の3着側に入れる候補。

   ★ なぜ edge（AI勝率 ÷ 市場期待勝率）で測るか
     オッズは控除後（JRAは単勝20%・馬連系25%）なので、人気通りに買えば长期で必ず負けます。
     プラスになるのは **AIの評価が市場の評価を上回っている馬だけ**です。
     「単にオッズが高い馬」を穴馬にすると、それはただの人気薄で妙味がありません。
   ========================================================= */

var PK_HOLE_MIN_RANK = 6;      // 穴馬は概ねこの人気以下から選ぶ
var PK_HOLE_MIN_ODDS = 12;     // またはこのオッズ以上

/* =========================================================
   ★2026-09-13 第21弾⑥: 「狙い目の理由」をオッズ妙味だけにしない
   ---------------------------------------------------------
   以前は 🎯軸=「AI勝率 ○%」/ 💠妙味=「期待値 ○」/ 🕳穴=「市場の ○倍」だけで、
   **なぜその馬なのか**（過去の好走データ・時計・展開・馬場）が一切出ていませんでした。
   ここでは ①のAI印（analyzeRace）が実際に使った材料を1つずつ文章にして、
   「効いている順」に並べて出します。数字は全部その馬の実データです（捏造しません）。

   材料（スコアの高い順に最大 PK_WHY_MAX 件）:
     📚 学習DBの過去実績 … 過去戦の3着内率・同距離実績・上り順位・騎手勝率・鉄砲/2走目
     ⏱ 持ちタイム        … 何m の時計か（前走/同場/同コース種別）と出場馬中の位置
     🌊 前走上り3F        … 前走の上り3F とレース内順位
     🏁 前走の実績        … 日付・場・距離・着順（★第21弾③で前走距離を正しく持つようにした）
     🏟 バ場好走率        … 同じ開催場×同じ馬場での3着内率
     🏔 洋芝・コース適性  … 同じコース種別・同距離の最速タイムと最速上り
     🧭 展開適性          … 脚質 × 予想ペース × 当日トラックバイアス
     🏇 調教タイム        … 追い切りの時計
     ⚠ 出遅れ率          … 減点材料も隠さず出す
   ========================================================= */
var PK_WHY_MAX = 4;

function pkP1(x){ return (x == null || !isFinite(x)) ? '—' : (x * 100).toFixed(0) + '%'; }
function pkD8Label(d8){
  var s = String(d8 || '');
  return /^\d{8}$/.test(s) ? (s.slice(4,6) + '/' + s.slice(6,8)) : s;
}
/* 0〜1 の正規化スコアを「出場馬中の位置」の言葉にする */
function pkPos(v, n){
  if (v == null || !isFinite(v)) return '';
  if (v >= 0.90) return '最上位';
  if (v >= 0.75) return '上位';
  if (v >= 0.55) return 'やや上位';
  if (v >= 0.45) return '中位';
  if (v >= 0.25) return 'やや下位';
  return '下位';
}
/* 1頭の「理由」をスコアつきで作る。kind = axis / value / hole（並べ替えの優先度に使う） */
function pkReasons(r, res, kind){
  var out = [];
  if (!r || !r.h) return out;
  var h = r.h;
  var pace = (res && res.pace) || null;
  var n = (res && res.rows && res.rows.length) || 0;

  /* 📚 学習DBの過去実績（そのレースの日付より前の出走だけ＝いかさま防止済み） */
  var f = r.ablHit;
  if (f && f.has){
    var t = [];
    if (f.prevN && f.top3Rate != null) t.push('過去 ' + f.prevN + '戦で3着内 <b>' + (f.top3Rate * 100).toFixed(0) + '%</b>');
    if (f.sameDistN) t.push('同距離 ' + f.sameDistN + '戦 <b>' + ((f.sameDistTop3Rate || 0) * 100).toFixed(0) + '%</b>');
    if (f.l3RankAvg != null) t.push('上り順位 平均 ' + (f.l3RankAvg * 100).toFixed(0) + '%（小さいほど速い）');
    if (f.jockeyN && f.jockeyWinRate != null) t.push('騎手 ' + f.jockeyN + '戦 勝率 ' + (f.jockeyWinRate * 100).toFixed(1) + '%');
    if (f.isTeppo && f.restDays != null) t.push('<b>鉄砲</b>（' + f.restDays + '日ぶり）');
    else if (f.is2nd) t.push('<b>2走目</b>（前走が鉄砲）');
    else if (f.restDays != null && f.restDays >= 21) t.push('中' + Math.floor((f.restDays - 1) / 7) + '週');
    if (t.length) out.push({ k:'abl', s: (r.fA != null ? r.fA : 0.5), txt: '📚 学習DB: ' + t.slice(0, 4).join('／') });
  }

  /* ⏱ 持ちタイム（何m の時計かまで出す。★第21弾③で前走距離と混ざらなくなりました） */
  if (h.time){
    var srcLbl = { prev:'前走', 'same-venue':'同じ競馬場', 'same-course':'同コース種別', 'same-dist':'同距離' }[h.timeSrc] || '';
    var dm = /^\d{3,4}$/.test(String(h.prevD || '')) ? (h.prevD + 'm') : '';
    out.push({ k:'time', s: (r.fT != null ? r.fT : 0.5),
      txt: '⏱ 持ちタイム <b>' + h.time + '</b>' + (dm ? '（' + dm + (srcLbl ? '・' + srcLbl : '') + '）' : '') +
        ' は出場 ' + n + '頭中 <b>' + (pkPos(r.fT, n) || '—') + '</b>' });
  }

  /* 🌊 前走の上り3F（順位が分かればそれも） */
  if (h.last3f){
    out.push({ k:'last3', s: (h.last3rank && h.last3rank <= 3 ? 0.85 : (h.last3rank ? 0.6 : 0.5)),
      txt: '🌊 前走の上り3F <b>' + h.last3f + '秒</b>' + (h.last3rank ? '（そのレース <b>' + h.last3rank + '位</b>）' : '') });
  }

  /* 🏁 前走の実績（日付・場・距離・着順） */
  if (h.prevM || h.prevDate8){
    var pj = [];
    if (h.prevDate8) pj.push(pkD8Label(h.prevDate8));
    if (h.prevVenue) pj.push(h.prevVenue);
    if (h.prevM) pj.push((h.prevSurf || '') + h.prevM + 'm');
    if (h.prevOrder) pj.push('<b>' + h.prevOrder + '着</b>');
    if (pj.length) out.push({ k:'prev', s: (h.prevOrder && h.prevOrder <= 3 ? 0.8 : 0.45), txt: '🏁 前走: ' + pj.join(' ') });
  }

  /* 🏟 バ場好走率（同じ開催場×同じ馬場） */
  var b = r.babaHit;
  if (b && b.n){
    out.push({ k:'baba', s: (r.fB != null ? r.fB : 0.5),
      txt: '🏟 同じ開催場×同じ馬場で <b>' + b.n + '戦 ' + (b.top3 || 0) + '回3着内（' +
        ((b.top3 || 0) / b.n * 100).toFixed(0) + '%）</b>・出場中 ' + (pkPos(r.fB, n) || '—') });
  }

  /* 🏔 洋芝・コース適性 */
  var y = r.yosoHit;
  if (y && (y.sec != null || y.l3 != null)){
    var tierLbl = (y.tier === 1) ? '今回と同じ競馬場' : (y.tier === 2) ? '同コース種別（' + (y.type || '') + '）の他場' : '同距離';
    var yy = [];
    if (y.sec != null) yy.push('最速 ' + (typeof yoFmt === 'function' ? yoFmt(y.sec) : y.sec) + (y.dist ? '（' + y.dist + 'm' + (y.venue ? '・' + y.venue : '') + '）' : ''));
    if (y.l3 != null) yy.push('最速上り ' + y.l3.toFixed(1) + '秒' + (y.l3dist ? '（' + y.l3dist + 'm）' : ''));
    out.push({ k:'yoso', s: (r.fY2 != null ? r.fY2 : 0.5), txt: '🏔 ' + tierLbl + 'で ' + yy.join('／') + '・出場中 ' + (pkPos(r.fY2, n) || '—') });
  }

  /* 🧭 展開適性（脚質 × 予想ペース × 当日トラックバイアス） */
  if (h.style && pace){
    var biasTxt = '';
    try {
      var bv = (typeof biasVerdict === 'function') ? biasVerdict() : null;
      if (bv && bv.posLabel) biasTxt = '・🌊当日の馬場は「' + bv.posLabel + '」';
    } catch(e){}
    out.push({ k:'tenkai', s: (r.fK != null ? r.fK : 0.5),
      txt: '🧭 脚質 <b>' + h.style + '</b>' + (h.styleConf ? '（AI確信度 ' + h.styleConf + '%）' : '') +
        ' × 予想ペース <b>' + (pace.label || '—') + '</b> → 展開適性は出場中 <b>' + (pkPos(r.fK, n) || '—') + '</b>' + biasTxt });
  }

  /* 🏇 調教タイム */
  if (h.yobi && r.fY != null){
    out.push({ k:'yobi', s: r.fY, txt: '🏇 調教タイム（' + String(h.yobi).slice(0, 28) + '）は出場中 <b>' + (pkPos(r.fY, n) || '—') + '</b>' });
  }

  /* ⚠ 出遅れ率（減点材料も隠さない） */
  try {
    var sp = (typeof slowPctOf === 'function') ? slowPctOf(h.slow) : 0;
    if (sp >= 10) out.push({ k:'slow', s: -sp / 100, txt: '⚠ 出遅れ率 <b>' + sp + '%</b>（評価を減点しています）' });
  } catch(e){}

  /* 💰 オッズ妙味（従来ここだけだったものを、最後に1項目として足す） */
  if (r._ev != null){
    out.push({ k:'odds', s: 0.5,
      txt: '💰 期待値 <b>' + r._ev.toFixed(2) + '</b>（AI勝率 ' + pkPct(r.prob) + ' × 単勝 ' + (h.odds || '?') + '倍）' +
        (r._edge != null ? '・市場評価の <b>' + r._edge.toFixed(2) + '倍</b>' : '') +
        (r._ev >= 1 ? ' ＝ 1.0以上なのでオッズが実力より甘い' : '') });
  }

  /* 並べ替え: 種類ごとに「何が決め手か」の重みを変える */
  var pri = {
    axis: { abl:1.10, time:1.05, baba:1.05, yoso:1.00, last3:1.00, tenkai:0.95, prev:0.90, yobi:0.85, odds:0.60, slow:1.20 },
    value:{ odds:1.30, abl:1.05, time:1.00, yoso:1.00, baba:0.95, last3:0.95, tenkai:0.90, prev:0.85, yobi:0.80, slow:1.15 },
    hole: { odds:1.20, abl:1.15, yoso:1.05, last3:1.05, time:1.00, tenkai:1.00, baba:0.95, prev:0.85, yobi:0.75, slow:1.15 }
  }[kind] || {};
  out.forEach(function(o){
    /* スコアは「その材料の中で上位か」＝0.5 を中心にした振り幅。
       減点材料（出遅れ）だけは必ず上位に来るようにします。 */
    o.score = (o.k === 'slow') ? 2.0 : (0.5 + Math.abs((o.s == null ? 0.5 : o.s) - 0.5)) * (pri[o.k] || 1);
  });
  /* 💰期待値の材料は「その馬が何によって選ばれたか」なので、強さに関係なく先頭に出す
     （💠妙味馬＝期待値が一番高い馬 / 🕳穴馬＝市場評価を一番上回っている馬、が定義そのものなので）。 */
  if (kind === 'value' || kind === 'hole'){
    out.forEach(function(o){ if (o.k === 'odds') o.score = 3.0; });
  }
  out.sort(function(a, b){ return b.score - a.score; });
  return out;
}
/* 表示用の文章（上位 N 件）。full=true なら全部 */
function pkWhyText(r, res, kind, full){
  var rs = pkReasons(r, res, kind);
  if (!rs.length) return '';
  var use = full ? rs : rs.slice(0, PK_WHY_MAX);
  return use.map(function(o){ return o.txt; }).join('　／　');
}
function pkWhyList(r, res, kind){
  return pkReasons(r, res, kind).slice(0, PK_WHY_MAX).map(function(o){ return o.txt; });
}

/* res = analyzeRace() の戻り値 → { axis, value, hole, n } */
function pkPicks(res){
  var out = { axis: null, value: null, hole: null, n: 0, ok: false };
  try {
    var rows = (res && res.rows) || [];
    if (rows.length < 2) return out;
    out.n = rows.length;
    // 市場期待勝率（控除後オッズから逆算）
    var inv = 0, cnt = 0;
    rows.forEach(function(r){
      var o = num(r.h.odds);
      if (o && o > 1){ inv += 1 / o; cnt++; }
    });
    rows.forEach(function(r){
      var o = num(r.h.odds);
      r._mi = (o && o > 1 && inv > 0) ? (1 / o) / inv : null;
      r._edge = (r._mi && r.prob) ? (r.prob / r._mi) : null;
      r._ev = (o && o > 1 && r.prob != null) ? (o * r.prob) : null;
    });
    function pack(r, why, kind){
      if (!r) return null;
      var o = num(r.h.odds);
      /* ★2026-09-13 第21弾⑥: 狙い目の理由を「オッズ妙味だけ」から、
         学習DBの過去実績・持ちタイム・前走上り3F・前走実績・バ場好走率・コース適性・展開まで
         実データの数字つきで並べます（whyList = 上位4件 / whyAll = 全件）。 */
      var wl = [], wa = [];
      try {
        var rs = pkReasons(r, res, kind);
        wl = rs.slice(0, PK_WHY_MAX).map(function(x){ return x.txt; });
        wa = rs.map(function(x){ return x.txt; });
      } catch(e){}
      return {
        whyList: wl, whyAll: wa,
        no: String(r.h.no || ''), name: String(r.h.name || ''),
        rank: r.rank || 0, mark: r.mark || '',
        odds: (o ? o : null), oddsRaw: (r.h.odds == null ? '' : String(r.h.odds)),
        oddsRank: r._oddsRank || 0,
        prob: (r.prob != null ? Math.round(r.prob * 10000) / 10000 : null),
        mi: (r._mi != null ? Math.round(r._mi * 10000) / 10000 : null),
        edge: (r._edge != null ? Math.round(r._edge * 100) / 100 : null),
        ev: (r._ev != null ? Math.round(r._ev * 100) / 100 : null),
        style: String(r.h.style || ''), why: why || ''
      };
    }
    // 人気順（オッズ昇順）
    var withOdds = rows.filter(function(r){ var o = num(r.h.odds); return o && o > 1; })
      .slice().sort(function(a, b){ return num(a.h.odds) - num(b.h.odds); });
    withOdds.forEach(function(r, i){ r._oddsRank = i + 1; });

    // 🎯 軸に最適馬: AI勝率の最大（＝analyzeRace の1位。念のため prob で選び直す）
    var byProb = rows.slice().sort(function(a, b){ return (b.prob || 0) - (a.prob || 0); });
    /* ★2026-09-13 第24弾④b: AI評価の「順位」も持つ（穴馬の判定に使う） */
    byProb.forEach(function(r, i){ r._probRank = i + 1; });
    var axis = byProb[0] || null;
    out.axis = pack(axis, axis ? ('AI勝率 ' + pkPct(axis.prob) + (axis._oddsRank ? '・' + axis._oddsRank + '番人気' : '')) : '', 'axis');

    // 💠 妙味馬: 期待値(AI勝率×オッズ)の最大。軸と同じなら2番手を使う
    var byEv = rows.filter(function(r){ return r._ev != null; }).sort(function(a, b){ return b._ev - a._ev; });
    var val = null;
    for (var i = 0; i < byEv.length; i++){
      if (axis && byEv[i] === axis) continue;
      val = byEv[i]; break;
    }
    if (!val && byEv.length) val = byEv[0];
    out.value = pack(val, val ? ('期待値 ' + (val._ev != null ? val._ev.toFixed(2) : '—') +
      '（AI勝率 ' + pkPct(val.prob) + ' × オッズ ' + (val.oddsRaw || '?') + '倍）' +
      (val._ev >= 1 ? ' ＝ 1.0以上なのでオッズが実力より甘い' : ' ＝ 1.0未満なので単勝では長期マイナス側')) : '', 'value');

    /* 🕳 穴馬
       ★2026-09-13 第24弾④b: 「妙味馬と穴馬が毎回同じ馬になる」バグの修正。
       --- 原因（数学的に必ず一致していた） ---
         _mi   = (1/オッズ) ÷ inv      … inv = Σ(1/オッズ) は【レース内で全馬共通の定数】
         _edge = AI勝率 ÷ _mi = AI勝率 × オッズ × inv = _ev × inv
       つまり edge の順位は ev の順位と【完全に同一】で、別の指標になっていませんでした。
       さらに穴馬の絞り込みが axis しか除外していなかったため、
       ev 1位の馬が人気薄（6番人気以下 or 12倍以上）だと 妙味馬＝穴馬 になります。
       実測でも 2000レース中 2000回（100%）同一でした。
       --- 修正 ---
       (1) 穴馬の候補から axis に加えて val（妙味馬）も除外 → 軸・妙味・穴は必ず別々の馬になる
       (2) 並び替えの指標を edge（≡ev）から「市場の人気順位とAI評価順位のズレ」に変更。
           穴馬は「市場が見捨てているのにAIは上位評価している馬」なので、
           期待値の大きさ（妙味馬の指標）ではなく 順位の上がり幅 で選ぶのが本来の意味です。
           同率のときは edge の大きい順。 */
    var holeGap = function(r){
      if (!r._oddsRank || !r._probRank) return -999;
      return r._oddsRank - r._probRank;   // 正＝市場よりAIが高く評価している
    };
    var holeSort = function(a, b){
      var d = holeGap(b) - holeGap(a);
      if (d) return d;
      return (b._edge || 0) - (a._edge || 0);
    };
    var taken = function(r){ return (axis && r === axis) || (val && r === val); };
    var cand = rows.filter(function(r){
      if (!r._edge) return false;
      if (taken(r)) return false;
      var o = num(r.h.odds);
      return (r._oddsRank >= PK_HOLE_MIN_RANK) || (o && o >= PK_HOLE_MIN_ODDS);
    }).sort(holeSort);
    var hole = cand[0] || null;
    if (!hole){
      // 人気薄が居ない（少頭数・上位人気しかない）ときも、軸と妙味馬は除いて選ぶ
      var alt = rows.filter(function(r){ return r._edge && !taken(r); }).sort(holeSort);
      hole = alt[0] || null;
    }
    out.hole = pack(hole, hole ? (
      (hole._oddsRank && hole._probRank
        ? (hole._oddsRank + '番人気 → AI評価 ' + hole._probRank + '番（' + (holeGap(hole) > 0 ? '+' : '') + holeGap(hole) + '）')
        : 'AI評価が市場の ' + (hole._edge != null ? hole._edge.toFixed(2) : '—') + ' 倍') +
      '・AI評価が市場の ' + (hole._edge != null ? hole._edge.toFixed(2) : '—') + ' 倍' +
      '（市場期待 ' + pkPct(hole._mi) + ' に対し AI ' + pkPct(hole.prob) + '）') : '', 'hole');
    out.ok = !!(out.axis || out.value || out.hole);
    return out;
  } catch(e){ return out; }
}
function pkPct(x, d){
  if (x == null || !isFinite(x)) return '—';
  return (x * 100).toFixed(d == null ? 1 : d) + '%';
}
/* 3頭を1行のテキストに（保存用・表示用） */
function pkLine(picks){
  if (!picks) return '';
  function f(p, tag){ return p ? (tag + ' ' + p.no + ' ' + p.name) : (tag + ' —'); }
  return [f(picks.axis, '🎯軸'), f(picks.value, '💠妙味'), f(picks.hole, '🕳穴')].join(' / ');
}
/* 3頭のHTML（②の「今回の狙い目」用） */
function pkHTML(picks){
  if (!picks || !picks.ok) return '<div class="small muted">オッズが入ると軸・妙味・穴を出せます。</div>';
  function cell(p, tag, title){
    if (!p) return '<div class="pkcell"><div class="pktag">' + tag + '</div><div class="small muted">—</div></div>';
    return '<div class="pkcell" title="' + esc(title || '') + '">' +
      '<div class="pktag">' + tag + '</div>' +
      '<div class="pkno"><b>' + esc(p.no) + '</b> ' + esc(p.name) + ' <span class="chip">' + esc(p.mark || '') + '</span></div>' +
      '<div class="small muted">' +
        (p.oddsRaw ? '単勝 ' + esc(p.oddsRaw) + '倍' : 'オッズ未入力') +
        (p.oddsRank ? '・' + p.oddsRank + '番人気' : '') +
        (p.prob != null ? '・AI勝率 ' + pkPct(p.prob) : '') +
        (p.edge != null ? '・市場比 ' + p.edge.toFixed(2) + '倍' : '') +
      '</div>' +
      '<div class="small" style="margin-top:2px">' + esc(p.why || '') + '</div>' +
      /* ★第21弾⑥: 決め手になった材料を実データの数字つきで列挙する */
      ((p.whyList && p.whyList.length)
        ? '<div class="pkwhy" style="margin-top:4px;padding-top:4px;border-top:1px dashed var(--line2)">' +
          '<div class="small" style="font-weight:700;color:var(--ok-ink);margin-bottom:1px">🔎 狙い目の理由</div>' +
          p.whyList.map(function(t){ return '<div class="small" style="margin:1px 0;line-height:1.55">' + t + '</div>'; }).join('') +
          ((p.whyAll && p.whyAll.length > p.whyList.length)
            ? '<details style="margin-top:2px"><summary class="small muted" style="cursor:pointer">ほか ' +
              (p.whyAll.length - p.whyList.length) + ' 件の材料</summary>' +
              p.whyAll.slice(p.whyList.length).map(function(t){ return '<div class="small muted" style="margin:1px 0;line-height:1.5">' + t + '</div>'; }).join('') +
              '</details>' : '') +
          '</div>'
        : '<div class="small muted" style="margin-top:3px">（理由になる材料がまだありません。①で学習DB・馬柱データ・オッズを取得すると出ます）</div>') +
      '</div>';
  }
  return '<div class="pkrow">' +
    cell(picks.axis, '🎯 軸に最適馬', 'AI勝率が一番高い馬。3連系の軸（1着固定・1頭軸）に最適') +
    cell(picks.value, '💠 妙味馬', '期待値（AI勝率×単勝オッズ）が一番高い馬。1.0以上ならオッズが実力より甘い') +
    cell(picks.hole, '🕳 穴馬', '人気薄の中でAI評価が市場評価を一番上回っている馬。3連系の相手・3連単の3着側に') +
    '</div>';
}

/* =========================================================
   保存済みの「事前予想」から、その日の全レースの 軸・妙味・穴 一覧を作る
   （①の「📥 その日の出馬表を一括取得」で保存した rec.pre.picks を読む）
   ========================================================= */
function pkDayList(d8){
  var out = [];
  try {
    d8 = String(d8 || '').replace(/[^0-9]/g, '');
    var all = (typeof apScan === 'function') ? (apScan() || {}) : {};
    Object.keys(all).forEach(function(rid){
      var rec = all[rid];
      if (!rec || !rec.pre) return;
      var pd8 = String(rec.pre.d8 || (rec.meta && rec.meta.date8) || '');
      if (d8 && pd8 !== d8) return;
      // レース番号（rec.meta.rnum か rid の末尾2桁）
      var rno = (rec.meta && rec.meta.rnum) ? parseInt(rec.meta.rnum, 10) : 0;
      if (!rno){ var rm = String(rid).match(/(\d{2})$/); if (rm) rno = parseInt(rm[1], 10); }
      var pk = rec.pre.picks || null;
      out.push({
        rid: rid, d8: pd8, rno: rno || 99,
        name: (rec.meta && rec.meta.name) || '',
        place: (rec.meta && rec.meta.place) || '',
        dist: (rec.meta && rec.meta.dist) || '',
        n: rec.pre.n || 0, at: rec.pre.at || '',
        picks: pk,
        settled: !!(rec.result),
        result: rec.result || null
      });
    });
    out.sort(function(a, b){
      return (a.place < b.place ? -1 : a.place > b.place ? 1 : 0) || (a.rno - b.rno);
    });
  } catch(e){}
  return out;
}

/* その日の一覧のHTML。結果が確定していれば当たり外れも出す */
function pkDayHTML(d8){
  var list = pkDayList(d8);
  if (!list.length){
    return '<div class="small muted">📌 この日の事前予想はまだ保存されていません。' +
      '①データ入力の「📥 その日の出馬表を一括取得」を押すと、全レースの軸・妙味・穴がここに並びます。</div>';
  }
  var h = ['<div style="overflow:auto"><table class="tbl" style="font-size:.78rem;min-width:760px"><thead><tr>' +
    '<th>場・R</th><th>レース名</th><th>🎯 軸に最適馬</th><th>💠 妙味馬</th><th>🕳 穴馬</th><th>状態</th></tr></thead><tbody>'];
  var hit = { axis: 0, value: 0, hole: 0, n: 0 };
  list.forEach(function(x){
    function td(p){
      if (!p) return '<td class="muted">—</td>';
      return '<td style="text-align:left;white-space:nowrap"><b>' + esc(p.no) + '</b> ' + esc(p.name) +
        '<span class="muted"> ' + esc(p.mark || '') + (p.oddsRaw ? ' ' + esc(p.oddsRaw) + '倍' : '') + '</span></td>';
    }
    // 結果と照合
    var st = '<span class="muted">出走前</span>';
    if (x.settled && x.result && x.result.rows){
      hit.n++;
      var orderByNo = {};
      x.result.rows.forEach(function(r){ if (r && r.no != null) orderByNo[String(r.no)] = parseInt(r.order, 10) || 0; });
      function chk(p){
        if (!p) return '';
        var o = orderByNo[String(p.no)] || 0;
        if (o === 1) return ' <span style="color:var(--ok-ink);font-weight:700">🏆1着</span>';
        if (o >= 2 && o <= 3) return ' <span style="color:var(--ok-ink)">✅' + o + '着</span>';
        if (o >= 4) return ' <span class="muted">' + o + '着</span>';
        return '';
      }
      var oa = x.picks && x.picks.axis ? (orderByNo[String(x.picks.axis.no)] || 0) : 0;
      var ov = x.picks && x.picks.value ? (orderByNo[String(x.picks.value.no)] || 0) : 0;
      var oh = x.picks && x.picks.hole ? (orderByNo[String(x.picks.hole.no)] || 0) : 0;
      if (oa >= 1 && oa <= 3) hit.axis++;
      if (ov >= 1 && ov <= 3) hit.value++;
      if (oh >= 1 && oh <= 3) hit.hole++;
      st = '照合済み';
      h.push('<tr><th style="text-align:left;white-space:nowrap">' + esc(x.place + ' ' + x.rno + 'R') + '</th>' +
        '<td style="text-align:left">' + esc(x.name || '') + '</td>' +
        td(x.picks && x.picks.axis).replace('</td>', chk(x.picks && x.picks.axis) + '</td>') +
        td(x.picks && x.picks.value).replace('</td>', chk(x.picks && x.picks.value) + '</td>') +
        td(x.picks && x.picks.hole).replace('</td>', chk(x.picks && x.picks.hole) + '</td>') +
        '<td class="muted">' + st + '</td></tr>');
      return;
    }
    h.push('<tr><th style="text-align:left;white-space:nowrap">' + esc(x.place + ' ' + x.rno + 'R') + '</th>' +
      '<td style="text-align:left">' + esc(x.name || '') + '</td>' +
      td(x.picks && x.picks.axis) + td(x.picks && x.picks.value) + td(x.picks && x.picks.hole) +
      '<td class="muted">' + st + '</td></tr>');
  });
  h.push('</tbody></table></div>');
  if (hit.n){
    h.push('<div class="small muted" style="margin-top:4px">照合済み <b>' + hit.n + '</b> レースの3着内: ' +
      '🎯軸 <b>' + hit.axis + '</b>（' + Math.round(hit.axis / hit.n * 100) + '%）／' +
      '💠妙味 <b>' + hit.value + '</b>（' + Math.round(hit.value / hit.n * 100) + '%）／' +
      '🕳穴 <b>' + hit.hole + '</b>（' + Math.round(hit.hole / hit.n * 100) + '%）' +
      '　※ 🕳穴は人気薄を狙うので3着内率が低くても、当たったときの配当で回収率に効きます。</div>');
  }
  return h.join('');
}

/* ---------- 表示 ---------- */
function pkRenderDay(){
  var box = null;
  try { box = document.getElementById('pkDayBox'); } catch(e){}
  if (!box) return;
  var d8 = '';
  try {
    var el = document.getElementById('pkDayDate');
    if (el && el.value) d8 = String(el.value).replace(/[^0-9]/g, '');
  } catch(e){}
  if (!/^\d{8}$/.test(d8)){
    try { if (typeof hfCurD8 === 'function') d8 = hfCurD8(); } catch(e){}
  }
  if (!/^\d{8}$/.test(d8)){
    try { if (typeof jlTodayD8 === 'function') d8 = jlTodayD8(); } catch(e){}
  }
  try { box.innerHTML = pkDayHTML(d8); } catch(e){ box.innerHTML = ''; }
  try {
    var c = document.getElementById('pkDayCount');
    if (c){
      var n = pkDayList(d8).length;
      c.textContent = n ? (n + ' レースぶん保存済み') : 'この日の事前予想はまだありません';
    }
    var dEl = document.getElementById('pkDayDate');
    if (dEl && /^\d{8}$/.test(d8) && !dEl.value) dEl.value = d8.slice(0, 4) + '-' + d8.slice(4, 6) + '-' + d8.slice(6, 8);
  } catch(e){}
}
function initPk(){
  try {
    var b = document.getElementById('pkDayRun');
    if (b) b.addEventListener('click', function(){ pkRenderDay(); });
    var d = document.getElementById('pkDayDate');
    if (d) d.addEventListener('change', function(){ pkRenderDay(); });
    var c = document.getElementById('pkCard');
    if (c) c.addEventListener('toggle', function(){ if (c.open) pkRenderDay(); });
    pkRenderDay();
  } catch(e){}
}
