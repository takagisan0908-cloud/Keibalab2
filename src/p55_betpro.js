/* =========================================================
   p55_betpro.js — 買い目提案（詳細版）: 3連系・オッズ妙味・金額の自動割り振り
   （#2026-09-12 第18弾）

   ★ 従来の「買い目提案」との違い
   従来（betSheetHTML）は 単勝・複勝・馬連・3連複Box の4券種に「作戦ごとの固定比率」で予算を分け、
   券種内は1点均等でした。3連系のオッズは発走前に分からないので「的中重視の目安配分」と明記していました。

   こちらは
     1) **3連系（3連複・3連単）と馬単・ワイドまで候補に入れる**
     2) **払戻オッズを「市場のオッズから確率モデルで作って」推定する**（Harvilleモデル）
     3) **AI勝率 ÷ 市場期待勝率（＝オッズ妙味 edge）で全買い目を並べ替える**
     4) **期待値が大きい買い目に多く、小さい買い目に少なく（ケリー基準の分数配分）金額を振る**
     5) 全部 **100円単位** に丸めて、そのまま買える形に出す
   の5点をやります。

   ---------------------------------------------------------
   ★ なぜ「オッズ妙味 = AI勝率 ÷ 市場期待勝率」で並べるのか
   JRAの控除率は 単勝・複勝 20%、それ以外 25% です。つまり人気通りに買えば
   100円につき 単勝系は80円、3連系は75円しか戻ってこない計算で、**长期では必ず負けます**。
   プラスになるのは「AIの評価が市場の評価を上回っている買い目」だけです。
     edge = AI勝率 ÷ 市場期待勝率   (1.00 = 市場並み / 1.20 = AIが2割上に見ている)
     EV   = AI勝率 × 推定オッズ = edge × (1 − 控除率)
   → EV が 1.0 を超える（＝回収率100%超）には 単勝系で edge > 1.25、3連系で edge > 1.333 が必要です。
   このラインを超えた買い目だけに厚く張るのが「回収率を上げる」唯一の正攻法です。

   ★ 推定オッズの作り方（Harvilleモデル）
   発走前は馬連・3連系のオッズが分かりません。そこで
     市場期待勝率 m_i = (1/単勝オッズ_i) ÷ Σ(1/単勝オッズ)   ← 控除分を除いた「市場の見立て」
   から、着順の同時確率を Harville の式で作ります。
     P(a→b)      = m_a × m_b/(1−m_a)
     P(a→b→c)    = m_a × m_b/(1−m_a) × m_c/(1−m_a−m_b)
     馬連{a,b}   = P(a→b)+P(b→a)
     3連複{a,b,c}= 6通りの順列の合計
     複勝(a)     = a が1着/2着/3着になる確率の合計
     ワイド{a,b} = a,b がともに3着以内に入る確率（3着内の順列6通り×残り1頭）
   推定オッズ = (1 − 控除率) ÷ 確率
   ※ これは「市場が正しくて、控除だけが乗っている」ときの理論オッズです。
     実際のオッズは発売の偏りで前後するので、**確定オッズが出たら必ず実オッズで確認してください**。

   ★ AI勝率側の確率も同じ式で作る
   q_i = ①のAI印が出す勝率（analyzeRace の prob）を同じ Harville 式に通すと、
   すべての券種で「AIの的中率」が同じ物差しで出ます。
   そして edge(組み合わせ) は **おおむね edge(馬1) × edge(馬2) × edge(馬3) に近い値**になります
   （Harville は「1 − 前の馬の確率」で割るので厳密な積にはならず、少しブレます。実測では ±1割程度）。
   なので妙味のある馬を組み合わせるほど edge は大きくなります（＝3連系が有利になりやすい）。
   逆に「人気馬どうしの3連複」は edge が 1.0 前後に収まり、控除を引かれて確実に負ける側です。

   ★ 金額の割り振り（分数ケリー）
   各買い目のケリー比率 f = (P×O − 1)/(O − 1)（P=AI的中率, O=推定オッズ）。
   f がプラスの買い目だけに、f の比で予算を分け、**分数ケリー（既定 1/4）** を掛けて
   1点100円単位に丸めます。1/4にするのは、確率の見積もり違いで破産しないためです。
   f がプラスの買い目が1つも無いレースでは「張らない」が正解なので、
   その場合は edge 上位の買い目を**最小限（予算の一定割合まで）**に抑えて、期待回収率を正直に表示します。
   ========================================================= */

/* 控除率（JRA） */
var BP_TAKE = { tan: 0.20, fuku: 0.20, wide: 0.25, umaren: 0.25, umatan: 0.25, sanren: 0.25, santan: 0.25 };
var BP_KIND = {
  tan:    { n: '単勝',   k: 1, ord: false },
  fuku:   { n: '複勝',   k: 1, ord: false, top3: true },
  wide:   { n: 'ワイド', k: 2, ord: false, top3: true },
  umaren: { n: '馬連',   k: 2, ord: false },
  umatan: { n: '馬単',   k: 2, ord: true  },
  sanren: { n: '3連複',  k: 3, ord: false },
  santan: { n: '3連単',  k: 3, ord: true  }
};
var BP_DEF = {
  kelly: 0.25,      // 分数ケリー（1/4）
  maxBets: 24,      // 提案する買い目の最大点数
  minEdge: 1.00,    // これ未満の edge は候補から外す
  minProb: 0.0015,  // AI的中率がこれ未満は外す（3連単の薄すぎる目を除く）
  pool: 8,          // 候補を作るのに使う頭数（AI上位＋妙味上位）
  floorPct: 0.35    // edge 1.0超の買い目が無いとき、予算のこの割合までで「最小限」に張る
};

/* ---------- 基本 ---------- */
function bpNum(v){ var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : 0; }
function bpKey(a){ return a.slice().sort(function(x, y){ return x - y; }).join('-'); }

/* Harville で「1着=a, 2着=b, 3着=c」の確率 */
function bpP3(q, a, b, c){
  var d1 = 1 - q[a];
  if (d1 <= 1e-9) return 0;
  var d2 = d1 - q[b];
  if (d2 <= 1e-9) return 0;
  return q[a] * (q[b] / d1) * (q[c] / d2);
}
function bpP2(q, a, b){
  var d1 = 1 - q[a];
  if (d1 <= 1e-9) return 0;
  return q[a] * (q[b] / d1);
}

/* 確率モデルをまるごと作る。q = 勝率の配列（合計1）
   → { p1, p2ord, umaren, p3ord, sanren, top3, wide } */
function bpModel(q){
  var n = q.length;
  var M = {
    n: n,
    p1: q.slice(),
    p2ord: {},      // 'a-b' → P(a→b)
    umaren: {},     // 'a-b'(昇順) → P(馬連)
    p3ord: {},      // 'a-b-c' → P(a→b→c)
    sanren: {},     // 'a-b-c'(昇順) → P(3連複)
    santan: {},     // 'a-b-c'(昇順key) → { set: P(3連複), ord: { 'a-b-c': P } }
    top3: [],       // 複勝: P(3着内)
    wide: {}        // 'a-b'(昇順) → P(ワイド)
  };
  var i, j, k;
  for (i = 0; i < n; i++){
    M.top3.push(q[i]);      // 1着ぶん
  }
  for (i = 0; i < n; i++){
    for (j = 0; j < n; j++){
      if (i === j) continue;
      var p2 = bpP2(q, i, j);
      M.p2ord[i + '-' + j] = p2;
      var key = bpKey([i, j]);
      M.umaren[key] = (M.umaren[key] || 0) + p2;
    }
  }
  // 2着・3着のぶん（複勝）
  for (i = 0; i < n; i++){
    var s2 = 0, s3 = 0;
    for (j = 0; j < n; j++){
      if (j === i) continue;
      s2 += bpP2(q, j, i);                                   // j→i（i が2着）
      for (k = 0; k < n; k++){
        if (k === i || k === j) continue;
        s3 += bpP3(q, j, k, i);                              // j→k→i（i が3着）
      }
    }
    M.top3[i] = q[i] + s2 + s3;
  }
  // 3着内の全順列（3連単・3連複・ワイド）
  for (i = 0; i < n; i++){
    for (j = 0; j < n; j++){
      if (j === i) continue;
      for (k = 0; k < n; k++){
        if (k === i || k === j) continue;
        var p3 = bpP3(q, i, j, k);
        if (p3 <= 0) continue;
        M.p3ord[i + '-' + j + '-' + k] = p3;
        var skey = bpKey([i, j, k]);
        M.sanren[skey] = (M.sanren[skey] || 0) + p3;
        if (!M.santan[skey]) M.santan[skey] = { set: 0, ord: {} };
        M.santan[skey].set += p3;
        M.santan[skey].ord[i + '-' + j + '-' + k] = p3;
        // ワイド: この3着内の組から2頭を選ぶ3通り
        var prs = [[i, j], [i, k], [j, k]];
        for (var w = 0; w < 3; w++){
          var wk = bpKey(prs[w]);
          M.wide[wk] = (M.wide[wk] || 0) + p3;
        }
      }
    }
  }
  return M;
}
/* 券種と馬の組（添字の配列）→ 確率 */
function bpProbOf(M, kind, idx){
  if (!M || !idx || !idx.length) return 0;
  var d = BP_KIND[kind];
  if (!d) return 0;
  if (d.k === 1) return d.top3 ? (M.top3[idx[0]] || 0) : (M.p1[idx[0]] || 0);
  var key;
  if (d.k === 2){
    if (d.ord) return M.p2ord[idx[0] + '-' + idx[1]] || 0;
    key = bpKey(idx);
    return d.top3 ? (M.wide[key] || 0) : (M.umaren[key] || 0);
  }
  if (d.ord) return M.p3ord[idx[0] + '-' + idx[1] + '-' + idx[2]] || 0;
  key = bpKey(idx);
  return M.sanren[key] || 0;
}

/* =========================================================
   買い目プランを作る
   res  : analyzeRace() の戻り値
   opt  : { money, kelly, maxBets, minEdge, minProb, pool, kinds, mode }
   → { bets:[{kind,label,idx,nos,pM,pX,odds,ev,edge,kelly,yen}], total, evRate, hitRate, note, picks }
   ========================================================= */
function bpPlan(res, opt){
  opt = opt || {};
  var out = { ok: false, bets: [], total: 0, evRate: null, note: '', warn: '', pool: [] };
  try {
    var rows = (res && res.rows) || [];
    if (rows.length < 3){ out.warn = '馬が3頭以上いると買い目を出せます。'; return out; }
    var q = [], mi = [], nos = [], names = [], marks = [], oddsRaw = [];
    var invSum = 0, hasOdds = 0;
    rows.forEach(function(r){
      var o = bpNum(r.h.odds);
      q.push((r.prob > 0) ? r.prob : 0);
      mi.push((o > 1) ? (1 / o) : 0);
      nos.push(String(r.h.no == null ? '' : r.h.no));
      names.push(String(r.h.name || ''));
      marks.push(String(r.mark || ''));
      oddsRaw.push(o > 1 ? o : 0);
      if (o > 1){ invSum += 1 / o; hasOdds++; }
    });
    if (hasOdds < 3){ out.warn = '単勝オッズが入っている馬が3頭以上いないと妙味を計算できません（①で netkeiba URLを取込むか、オッズ欄を手入力してください）。'; return out; }
    // 正規化
    var qs = 0; q.forEach(function(v){ qs += v; });
    if (qs > 0) q = q.map(function(v){ return v / qs; });
    mi = mi.map(function(v){ return v > 0 ? v / invSum : 0; });
    // オッズが無い馬は市場期待を「AIと同じ」にしておく（edge=1.0＝妙味なし扱い）
    mi = mi.map(function(v, i){ return v > 0 ? v : q[i]; });

    var n = q.length;
    var MQ = bpModel(q), MM = bpModel(mi);

    // 候補に使う頭数（AI上位＋edge上位の和集合）
    var pool = Math.max(4, Math.min(n, opt.pool || BP_DEF.pool));
    var byQ = [], byE = [];
    for (var i = 0; i < n; i++){ byQ.push(i); byE.push(i); }
    byQ.sort(function(a, b){ return q[b] - q[a]; });
    byE.sort(function(a, b){
      var ea = mi[a] > 0 ? q[a] / mi[a] : 1, eb = mi[b] > 0 ? q[b] / mi[b] : 1;
      return eb - ea;
    });
    var poolSet = {};
    byQ.slice(0, pool).forEach(function(i){ poolSet[i] = 1; });
    byE.slice(0, Math.max(3, Math.round(pool / 2))).forEach(function(i){ poolSet[i] = 1; });
    var P = Object.keys(poolSet).map(function(x){ return parseInt(x, 10); });
    out.pool = P.map(function(i){
      return { idx: i, no: nos[i], name: names[i], mark: marks[i], odds: oddsRaw[i],
               q: q[i], mi: mi[i], edge: mi[i] > 0 ? q[i] / mi[i] : 1 };
    }).sort(function(a, b){ return b.edge - a.edge; });

    // 券種
    var kinds = (opt.kinds && opt.kinds.length) ? opt.kinds
      : ['tan', 'fuku', 'wide', 'umaren', 'umatan', 'sanren', 'santan'];

    var kellyF = (opt.kelly != null) ? opt.kelly : BP_DEF.kelly;
    var minEdge = (opt.minEdge != null) ? opt.minEdge : BP_DEF.minEdge;
    var minProb = (opt.minProb != null) ? opt.minProb : BP_DEF.minProb;
    var maxBets = Math.max(1, opt.maxBets || BP_DEF.maxBets);

    var cand = [];
    function add(kind, idx){
      var pM = bpProbOf(MQ, kind, idx);
      var pX = bpProbOf(MM, kind, idx);
      if (!(pM > 0) || !(pX > 0)) return;
      if (pM < minProb) return;
      var t = BP_TAKE[kind] || 0.25;
      var odds = (1 - t) / pX;              // 推定オッズ（市場が正しくて控除だけ乗った理論値）
      // 単勝だけは実際のオッズが画面に入っているので、そちらを優先する（推定値は market が正しければ
      // 実オッズと一致するはずだが、丸めや発売の偏りでズレるので、買える値で計算するのが正しい）
      if (kind === 'tan' && oddsRaw[idx[0]] > 1) odds = oddsRaw[idx[0]];
      var ev = pM * odds;                   // 期待回収率（1.0でトントン）
      var edge = pM / pX;                   // = AI ÷ 市場
      if (edge < minEdge) return;
      var f = (odds > 1) ? ((ev - 1) / (odds - 1)) : 0;
      if (!(f > 0)) f = 0;
      cand.push({
        kind: kind, idx: idx.slice(),
        nos: idx.map(function(x){ return nos[x]; }),
        names: idx.map(function(x){ return names[x]; }),
        marks: idx.map(function(x){ return marks[x]; }),
        pM: pM, pX: pX, odds: odds, ev: ev, edge: edge, kelly: f
      });
    }
    kinds.forEach(function(kind){
      var d = BP_KIND[kind];
      if (!d) return;
      if (d.k === 1){ P.forEach(function(i){ add(kind, [i]); }); return; }
      if (d.k === 2){
        for (var a = 0; a < P.length; a++){
          for (var b = 0; b < P.length; b++){
            if (a === b) continue;
            if (!d.ord && b < a) continue;
            add(kind, [P[a], P[b]]);
          }
        }
        return;
      }
      for (var x = 0; x < P.length; x++){
        for (var y = 0; y < P.length; y++){
          if (y === x) continue;
          for (var z = 0; z < P.length; z++){
            if (z === x || z === y) continue;
            if (!d.ord && (y < x || z < y)) continue;
            add(kind, [P[x], P[y], P[z]]);
          }
        }
      }
    });
    if (!cand.length){
      out.warn = 'edge（AI勝率 ÷ 市場期待勝率）が ' + minEdge.toFixed(2) + ' 以上の買い目がありません。' +
        'このレースは AI の評価が市場の評価を上回れていないので、**張らないのが正解**の可能性が高いです。' +
        '「妙味の下限」を下げると候補は出ますが、期待回収率は 100% を下回ります。';
      out.ok = false;
      return out;
    }
    // edge の大きい順に並べて上位を採用
    cand.sort(function(a, b){ return (b.edge - a.edge) || (b.pM - a.pM); });
    var sel = cand.slice(0, maxBets);

    /* --- 金額の割り振り --- */
    var moneyIn = (opt.money == null || opt.money === '') ? 2000 : parseInt(opt.money, 10);
    if (!isFinite(moneyIn)) moneyIn = 2000;
    var U = Math.floor(moneyIn / 100);      // 100円玉の枚数
    if (U < 1){ out.warn = '予算は100円以上（100円単位）で指定してください。'; return out; }
    var posK = sel.filter(function(b){ return b.kelly > 0; });
    var useFloor = !posK.length;            // 期待値プラスが1つも無い → 最小限に抑える
    var poolU = useFloor ? Math.max(1, Math.floor(U * BP_DEF.floorPct)) : U;
    var list = useFloor ? sel.slice(0, Math.min(sel.length, Math.max(3, Math.round(maxBets / 2)))) : posK;

    // 重み: ケリー（無いときは edge の3乗で代用）
    var w = list.map(function(b){
      return b.kelly > 0 ? b.kelly : Math.pow(Math.max(0, b.edge - 1) + 0.02, 3);
    });
    var wSum = 0; w.forEach(function(v){ wSum += v; });
    if (!(wSum > 0)){ out.warn = '配分の重みを作れませんでした。'; return out; }
    // 1点の上限（1つの買い目に予算が集中しないように）
    var capU = Math.max(1, Math.round(poolU * (useFloor ? 0.34 : 0.30)));
    var alloc = w.map(function(v){ return poolU * v / wSum; });
    // 上限をかけて、余りを2周目で配り直す
    for (var pass = 0; pass < 3; pass++){
      var over = 0, free = 0;
      alloc.forEach(function(v, i){ if (v > capU){ over += v - capU; alloc[i] = capU; } else free += v; });
      if (over <= 1e-9 || free <= 0) break;
      alloc = alloc.map(function(v){ return (v >= capU) ? v : v + over * (v / free); });
    }
    var u = alloc.map(function(v){ return Math.floor(v); });
    // 端数を最大剰余法で配る
    var rest = poolU - u.reduce(function(a, b){ return a + b; }, 0);
    if (rest > 0){
      alloc.map(function(v, i){ return { i: i, f: v - Math.floor(v) }; })
        .sort(function(a, b){ return (b.f - a.f) || (a.i - b.i); })
        .slice(0, rest).forEach(function(o){ if (u[o.i] < capU) u[o.i]++; });
    }
    // 1点=100円未満になった買い目は外す（馬券は100円単位）
    var bets = [];
    for (var bi = 0; bi < list.length; bi++){
      if (u[bi] < 1) continue;
      var b = list[bi];
      bets.push({
        kind: b.kind, kindName: BP_KIND[b.kind].n, idx: b.idx, nos: b.nos, names: b.names, marks: b.marks,
        pM: b.pM, pX: b.pX, odds: b.odds, ev: b.ev, edge: b.edge, kelly: b.kelly, yen: u[bi] * 100
      });
    }
    if (!bets.length){ out.warn = '予算が少なすぎて1点100円に割り当てられませんでした。予算を上げてください。'; return out; }
    bets.sort(function(a, b){ return b.yen - a.yen || b.edge - a.edge; });
    out.bets = bets;
    out.total = bets.reduce(function(s, b){ return s + b.yen; }, 0);
    out.moneyIn = moneyIn;
    out.useFloor = useFloor;
    out.kellyF = kellyF;
    // 期待回収率 = Σ(AI的中率 × 推定オッズ × 金額) ÷ 合計金額
    var gross = 0;
    bets.forEach(function(b){ gross += b.pM * b.odds * b.yen; });
    out.evRate = out.total > 0 ? gross / out.total : null;
    // いずれかが当たる確率（相関を無視した概算: 1 − Π(1−P)。券種間で重なるので上限値）
    var miss = 1;
    bets.forEach(function(b){ miss *= (1 - b.pM); });
    out.hitAny = 1 - miss;
    out.ok = true;
    return out;
  } catch(e){ out.warn = '買い目の計算に失敗しました: ' + ((e && e.message) || e); return out; }
}

/* ---------- 表示 ---------- */
function bpPct(x, d){ return (x == null || !isFinite(x)) ? '—' : (x * 100).toFixed(d == null ? 1 : d) + '%'; }
function bpOddsTxt(o){
  if (!(o > 0)) return '—';
  if (o >= 1000) return Math.round(o).toLocaleString('ja-JP');
  if (o >= 100) return o.toFixed(0);
  return o.toFixed(1);
}
function bpBetLabel(b){
  if (b.idx.length === 1) return b.nos[0] + ' ' + (b.names[0] || '');
  return b.nos.join(b.kind === 'umatan' || b.kind === 'santan' ? ' → ' : ' − ');
}
function bpHTML(plan){
  if (!plan) return '';
  if (!plan.ok){
    return '<div class="small" style="color:var(--warn-ink);margin:4px 0">' + esc(plan.warn || '買い目を出せませんでした。') + '</div>';
  }
  var h = [];
  h.push('<div style="overflow:auto"><table class="tbl bp-tbl" style="font-size:.78rem;min-width:820px"><thead><tr>' +
    '<th style="text-align:left">券種</th><th style="text-align:left">買い目</th><th>推定オッズ</th>' +
    '<th>AI的中率</th><th>市場期待</th><th>妙味 edge</th><th>期待回収率</th><th>ケリー</th><th>金額</th></tr></thead><tbody>');
  plan.bets.forEach(function(b){
    var good = b.ev >= 1;
    h.push('<tr>' +
      '<th style="text-align:left;white-space:nowrap">' + esc(b.kindName) + '</th>' +
      '<td style="text-align:left;white-space:nowrap"><b>' + esc(bpBetLabel(b)) + '</b>' +
        '<span class="muted"> ' + esc(b.marks.join('')) + '</span></td>' +
      '<td><b>' + bpOddsTxt(b.odds) + '</b><span class="muted">倍</span></td>' +
      '<td>' + bpPct(b.pM, 2) + '</td>' +
      '<td class="muted">' + bpPct(b.pX, 2) + '</td>' +
      '<td style="color:' + (b.edge >= 1.334 ? 'var(--ok-ink)' : b.edge >= 1.1 ? 'var(--warn-ink)' : '') + ';font-weight:700">' +
        b.edge.toFixed(2) + '</td>' +
      '<td style="color:' + (good ? 'var(--ok-ink)' : 'var(--err-ink)') + ';font-weight:800">' + bpPct(b.ev, 0) + '</td>' +
      '<td class="muted">' + (b.kelly > 0 ? (b.kelly * 100).toFixed(1) + '%' : '−') + '</td>' +
      '<td style="font-weight:800">' + b.yen.toLocaleString('ja-JP') + '円</td></tr>');
  });
  h.push('</tbody></table></div>');
  var evTxt = plan.evRate == null ? '—' : (plan.evRate * 100).toFixed(1) + '%';
  h.push('<div class="small" style="margin-top:6px">' +
    '合計 <b>' + plan.total.toLocaleString('ja-JP') + '円</b>（' + plan.bets.length + '点）／予算 ' +
    plan.moneyIn.toLocaleString('ja-JP') + '円' + (plan.total !== plan.moneyIn ? '（100円単位に丸めて ' + plan.total.toLocaleString('ja-JP') + '円）' : '') +
    '　期待回収率 <b style="color:' + ((plan.evRate || 0) >= 1 ? 'var(--ok-ink)' : 'var(--err-ink)') + '">' + evTxt + '</b>' +
    '　いずれか当たる確率（概算） <b>' + bpPct(plan.hitAny, 1) + '</b>' +
    (plan.useFloor ? '　<span style="color:var(--warn-ink)">⚠ 期待値プラスの買い目が無いので、予算の ' +
      Math.round(BP_DEF.floorPct * 100) + '% までに抑えた「最小限の張り方」にしています（残りは見送りが正解）</span>' : '') +
    '</div>');
  // 妙味のある馬（候補プール）
  if (plan.pool && plan.pool.length){
    h.push('<div class="small muted" style="margin-top:5px">🔍 オッズ妙味（AI勝率 ÷ 市場期待勝率）の上位: ' +
      plan.pool.slice(0, 6).map(function(p){
        return '<b>' + esc(p.no) + ' ' + esc(p.name) + '</b> ' + p.edge.toFixed(2) +
          '（AI ' + bpPct(p.q, 1) + ' / 市場 ' + bpPct(p.mi, 1) + (p.odds ? ' / ' + p.odds + '倍' : '') + '）';
      }).join('　') + '</div>');
  }
  h.push('<div class="small muted" style="margin-top:4px">' +
    '<b>推定オッズ</b>は「単勝オッズから控除分を除いた市場期待勝率」を Harville の式に通して作った<b>理論値</b>です' +
    '（馬連・3連系は発走前に実オッズが分からないため）。実際のオッズは発売の偏りで前後するので、' +
    '<b>確定オッズが出たら必ず実オッズで期待回収率を確認してください</b>。' +
    '<b>期待回収率</b> = AI的中率 × 推定オッズ。JRAの控除（単勝・複勝20%／その他25%）込みなので、' +
    '<b>100%を超えるには edge が 単勝系で1.25・3連系で1.34 以上</b>必要です。' +
    '金額は<b>分数ケリー（1/4）</b>で配り、1点の上限を予算の30%に抑え、<b>すべて100円単位</b>に丸めています。' +
    'あくまで参考で、購入は自己責任でお願いします。</div>');
  return h.join('');
}

/* ---------- UI ---------- */
var bpCache = { sig: '', plan: null };
function bpSig(res, opt){
  var s = [opt.money, opt.kelly, opt.maxBets, opt.minEdge, opt.pool, (opt.kinds || []).join(',')].join('|');
  ((res && res.rows) || []).forEach(function(r){
    s += '#' + r.h.no + ':' + (r.h.odds || '') + ':' + (r.prob != null ? r.prob.toFixed(5) : '');
  });
  return s;
}
function bpRender(){
  var box = null;
  try { box = document.getElementById('bpBox'); } catch(e){}
  if (!box) return;
  var res = null;
  try { res = (typeof currentAnalysis === 'function') ? currentAnalysis() : null; } catch(e){}
  if (!res) res = null;
  var opt = bpReadOpt();
  var sig = bpSig(res, opt);
  if (bpCache.sig === sig && bpCache.plan){
    try { box.innerHTML = bpHTML(bpCache.plan); } catch(e){}
    return;
  }
  var plan = null;
  try { plan = bpPlan(res, opt); } catch(e){ plan = null; }
  bpCache.sig = sig; bpCache.plan = plan;
  try { box.innerHTML = bpHTML(plan); } catch(e){}
}
function bpReadOpt(){
  function v(id, dflt){
    try { var el = document.getElementById(id); if (el && el.value !== '') return el.value; } catch(e){}
    return dflt;
  }
  function n(id, dflt){ var x = parseFloat(v(id, dflt)); return isFinite(x) ? x : dflt; }
  var kinds = [];
  try {
    ['tan', 'fuku', 'wide', 'umaren', 'umatan', 'sanren', 'santan'].forEach(function(k){
      var el = document.getElementById('bpK_' + k);
      if (!el || el.checked) kinds.push(k);
    });
  } catch(e){}
  if (!kinds.length) kinds = ['tan'];
  var mode = String(v('bpMode', 'b'));
  var o = {
    money: Math.floor(n('bpMoney', 2000)),
    kinds: kinds,
    maxBets: Math.round(n('bpMax', BP_DEF.maxBets)),
    minEdge: n('bpEdge', BP_DEF.minEdge),
    pool: Math.round(n('bpPool', BP_DEF.pool)),
    kelly: BP_DEF.kelly,
    mode: mode
  };
  // 作戦: 的中重視＝ケリーを絞って上限点数を少なく／回収率重視＝ edge の下限を上げて厚く張る
  if (mode === 'k'){ o.kelly = 0.15; o.maxBets = Math.min(o.maxBets, 10); o.minEdge = Math.max(o.minEdge, 1.0); }
  else if (mode === 'a'){ o.kelly = 0.40; o.minEdge = Math.max(o.minEdge, 1.15); }
  else { o.kelly = 0.25; }
  return o;
}
function initBp(){
  try {
    var ids = ['bpMoney', 'bpMax', 'bpEdge', 'bpPool'];
    ids.forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', bpRender);
    });
    var m = document.getElementById('bpMode');
    if (m) m.addEventListener('change', bpRender);
    ['tan', 'fuku', 'wide', 'umaren', 'umatan', 'sanren', 'santan'].forEach(function(k){
      var el = document.getElementById('bpK_' + k);
      if (el) el.addEventListener('change', bpRender);
    });
    var c = document.getElementById('bpCard');
    if (c) c.addEventListener('toggle', function(){ if (c.open) bpRender(); });
    bpRender();
  } catch(e){}
}
