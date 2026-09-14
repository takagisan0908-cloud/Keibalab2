/* =========================================================
   p58_value.js — 💰 回収率チューナー
   （#2026-09-13 第19弾②：「的中率40〜60%は出ている。そこから回収率を底上げする方法」への回答）

   ---------------------------------------------------------
   ★ 何をやる機能か
   端末に貯まっている【出走前に保存した本当の予想 rec.pre】と【結果 rec.result（払戻つき）】を
   突き合わせて、「どんな買い方をすると回収率が上がるか」を**実測で**総当たりします。
   理論式（p55 の Harville + edge）はもう入っているので、ここでは
   "あなたの予想の実際の成績" でそれを検証し、一番回収率が高かった設定を探して提案します。

   ---------------------------------------------------------
   ★ 的中率が高いのに回収率が上がらない理由（この機能が暴く3つ）
   (1) 点数が多すぎる
       的中率 = 当たる割合、回収率 = 払戻 ÷ 投資額。
       10点買って6点外れれば、当たった6点の払戻が10点分の投資を上回らない限り回収率は100%を割ります。
       → 「買い目点数別の回収率」の表で、何点まで絞ると回収率が上がるかを実測で出します。
   (2) 当たりやすい＝オッズが低い（控除率ぶん確実に負ける側を買っている）
       JRAの控除は 単勝・複勝 20%／それ以外 25%。人気通りに買えば必ず长期で負けます。
       的中率を上げている買い目が「edge ≒ 1.0（市場並み）」なら、それは回収率を下げるだけの当たり方です。
       → edge の下限を上げたときに回収率がどう変わるかを実測します。
   (3) 金額の配分が均等
       妙味の大きい目も小さい目も同じ100円だと、期待値の低い買い目が回収率を薄めます。
       → 「均等 / 分数ケリー / EV上位に集中」の3方式を実測比較します。

   ---------------------------------------------------------
   ★ 実測の精度について（いかさま防止）
   ・予想は必ず rec.pre（出走前に保存したもの）。無ければ rec.preBt（第18弾のバックテスト予想）を使い、
     出所を「事前予想 / BT予想」として表示します。結果確定後に作り直した再シミュレーションは使いません。
   ・払戻は rec.result.payout（netkeiba の結果ページから取った全8券種の実払戻）を最優先にします。
     実払戻が取れていない券種だけ、着順から当たり判定をして p55 と同じ理論オッズで計算します
     （その場合は「推定」件数として内訳に出します）。
   ========================================================= */

/* 券種 → 払戻マップのキー（p31 bfPayoutMap と同じ命名） */
var VT_PAYKEY = { tan:'win', fuku:'place', wide:'wide', umaren:'umaren', umatan:'umatan', sanren:'sanfuku', santan:'santan' };
/* 候補にする券種の組み合わせ（＝「何をどれだけ買うか」の作戦） */
var VT_KINDSETS = [
  { id:'tan',       n:'単勝だけ',                 kinds:['tan'] },
  { id:'fuku',      n:'複勝だけ',                 kinds:['fuku'] },
  { id:'tanfuku',   n:'単勝＋複勝',               kinds:['tan','fuku'] },
  { id:'wide',      n:'ワイドだけ',               kinds:['wide'] },
  { id:'tanumaren', n:'単勝＋馬連',               kinds:['tan','umaren'] },
  { id:'narrow',    n:'単勝＋馬連＋ワイド',        kinds:['tan','umaren','wide'] },
  { id:'mid',       n:'単勝＋馬連＋3連複',         kinds:['tan','umaren','sanren'] },
  { id:'full',      n:'全券種（3連単まで）',       kinds:['tan','fuku','wide','umaren','umatan','sanren','santan'] }
];
var VT_POOLS  = [3, 4, 5, 6, 8];                 // AI評価の上位何頭から組むか
var VT_EDGES  = [1.00, 1.10, 1.25, 1.40];        // 妙味(edge)の下限
var VT_CAPS   = [4, 8, 16];                      // 1レースあたりの最大点数
var VT_STAKES = [
  { id:'flat',  n:'1点100円均等' },
  { id:'kelly', n:'分数ケリー(1/4)' },
  { id:'top',   n:'EV上位3点に集中' }
];
var VT_BUDGET_PER_PT = 100;                      // 1点あたりの基準額（配分方式を変えても投資額を揃える）
var VT_MAX_POOL = 8;                             // 候補を作る最大頭数（3連単の組合せ爆発を防ぐ）

function vtNum(v){
  var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
  return isFinite(n) ? n : 0;
}

/* ---------- 払戻マップ（馬番の組合せ → 100円あたりの払戻） ---------- */
function vtPayIndex(res){
  var out = {};
  var p = (res && (res.payout || res.pay)) || null;
  if (p && typeof p === 'object'){
    Object.keys(VT_PAYKEY).forEach(function(kind){
      var g = p[VT_PAYKEY[kind]];
      if (!g || !g.nos || !g.nos.length) return;
      var m = {};
      for (var i = 0; i < g.nos.length; i++){
        var key = String(g.nos[i] || '').trim();
        if (!key) continue;
        m[key] = vtNum(g.pays && g.pays[i]);
      }
      if (Object.keys(m).length) out[kind] = m;
    });
  }
  // payouts（生リスト）しか無い場合。生リストの t は netkeiba の券種コード
  // （tan / fuku / wakuren / umaren / wide / umatan / sanfuku / santan）なので、
  // こちらの kind 名（p55 BP_KIND と同じ）に読み替えます。
  if (!Object.keys(out).length && res && Array.isArray(res.payouts)){
    var RAW2KIND = { tan:'tan', fuku:'fuku', umaren:'umaren', wide:'wide',
                     umatan:'umatan', sanfuku:'sanren', santan:'santan' };
    res.payouts.forEach(function(it){
      if (!it || !it.t) return;
      var kind = RAW2KIND[it.t]; if (!kind) return;   // 枠連(wakuren)は買い目に無いので無視
      var sep = (kind === 'umatan' || kind === 'santan') ? '→' : '-';
      var key = String((it.nos || []).join(sep));
      if (!key) return;
      (out[kind] = out[kind] || {})[key] = vtNum(it.yen);
    });
  }
  return out;
}
/* 買い目のキー（払戻マップと同じ形式） */
function vtBetKey(kind, nos){
  var d = (typeof BP_KIND !== 'undefined' && BP_KIND[kind]) || {};
  var arr = nos.slice();
  if (!d.ord) arr.sort(function(a, b){ return parseInt(a, 10) - parseInt(b, 10); });
  return arr.join(d.ord ? '→' : '-');
}
/* 着順から当たり判定（実払戻が取れなかった券種の保険） */
function vtHitByOrder(kind, nos, order){
  var o = nos.map(function(x){ return order[String(x)] || 0; });
  switch (kind){
    case 'tan':    return o[0] === 1;
    case 'fuku':   return o[0] >= 1 && o[0] <= 3;
    case 'wide':   return o[0] >= 1 && o[0] <= 3 && o[1] >= 1 && o[1] <= 3;
    case 'umaren': return o[0] >= 1 && o[0] <= 2 && o[1] >= 1 && o[1] <= 2 && o[0] !== o[1];
    case 'umatan': return o[0] === 1 && o[1] === 2;
    case 'sanren': return o.every(function(x){ return x >= 1 && x <= 3; });
    case 'santan': return o[0] === 1 && o[1] === 2 && o[2] === 3;
  }
  return false;
}

/* ---------- 1レースぶんの材料を作る ----------
   → { rid, d8, src, nos, q[], mi[], order{}, pay{}, cand[] }  （作れなければ null） */
function vtRaceOf(rid, rec, resRows){
  try {
    if (!rec || !resRows || resRows.length < 3) return null;
    var PRE = (rec.pre && rec.pre.rows && rec.pre.rows.length) ? rec.pre
            : (rec.preBt && rec.preBt.rows && rec.preBt.rows.length) ? rec.preBt : null;
    if (!PRE) return null;
    var order = {}, odds = {}, inv = 0, nOdds = 0;
    resRows.forEach(function(r){
      if (!r || r.no == null) return;
      var o = parseInt(r.order, 10) || 0;
      if (o < 1) return;
      order[String(r.no)] = o;
      var od = vtNum(r.odds);
      if (od > 1){ odds[String(r.no)] = od; inv += 1 / od; nOdds++; }
    });
    if (!(inv > 0) || nOdds < 3) return null;
    var nos = [], q = [], mi = [], used = {};
    PRE.rows.forEach(function(x){
      if (!x || x.no == null) return;
      var no = String(x.no);
      if (used[no] || order[no] == null || !(odds[no] > 1)) return;
      var pr = vtNum(x.prob);
      if (!(pr > 0)) return;
      used[no] = 1; nos.push(no); q.push(pr); mi.push((1 / odds[no]) / inv);
    });
    if (nos.length < 4) return null;
    var qs = 0; q.forEach(function(v){ qs += v; });
    if (!(qs > 0)) return null;
    q = q.map(function(v){ return v / qs; });
    var MQ = bpModel(q), MM = bpModel(mi);
    // AI勝率の上位から VT_MAX_POOL 頭だけを候補に使う
    var byQ = nos.map(function(_, i){ return i; });
    byQ.sort(function(a, b){ return q[b] - q[a]; });
    var P = byQ.slice(0, Math.min(VT_MAX_POOL, nos.length));
    var qrank = {};
    P.forEach(function(i, k){ qrank[i] = k; });

    var cand = [];
    function add(kind, idx){
      var d = BP_KIND[kind];
      if (!d) return;
      var pM = bpProbOf(MQ, kind, idx);
      var pX = bpProbOf(MM, kind, idx);
      if (!(pM > 0) || !(pX > 0)) return;
      var take = (typeof BP_TAKE !== 'undefined' && BP_TAKE[kind]) || 0.25;
      var oddsT = (1 - take) / pX;
      var nosB = idx.map(function(i){ return nos[i]; });
      var qmax = 0;
      idx.forEach(function(i){ if (qrank[i] > qmax) qmax = qrank[i]; });
      cand.push({
        kind: kind, nos: nosB, key: vtBetKey(kind, nosB), ord: !!d.ord,
        pM: pM, pX: pX, edge: pM / pX, ev: pM * oddsT, oddsT: oddsT,
        kelly: oddsT > 1 ? Math.max(0, (pM * oddsT - 1) / (oddsT - 1)) : 0,
        qmax: qmax
      });
    }
    Object.keys(BP_KIND).forEach(function(kind){
      var d = BP_KIND[kind];
      if (d.k === 1){ P.forEach(function(i){ add(kind, [i]); }); return; }
      if (d.k === 2){
        for (var a = 0; a < P.length; a++) for (var b = 0; b < P.length; b++){
          if (a === b) continue;
          if (!d.ord && b < a) continue;
          add(kind, [P[a], P[b]]);
        }
        return;
      }
      if (d.k === 3){
        for (var x1 = 0; x1 < P.length; x1++) for (var x2 = 0; x2 < P.length; x2++) for (var x3 = 0; x3 < P.length; x3++){
          if (x1 === x2 || x2 === x3 || x1 === x3) continue;
          if (!d.ord && (x2 < x1 || x3 < x2)) continue;
          add(kind, [P[x1], P[x2], P[x3]]);
        }
      }
    });
    if (!cand.length) return null;
    var d8 = '';
    try { d8 = String((rec.meta && rec.meta.date8) || (PRE.d8) || ''); } catch(e){}
    return {
      rid: String(rid), d8: d8, src: (rec.pre && rec.pre.rows && rec.pre.rows.length) ? 'live' : 'bt',
      nos: nos, q: q, mi: mi, odds: odds, order: order,
      pay: vtPayIndex(rec.result || {}), cand: cand, n: nos.length
    };
  } catch(e){ return null; }
}

/* 端末に貯まっている「予想＋結果」が揃ったレースを全部集める */
function vtRaces(limit){
  var out = [];
  try {
    var list = (typeof apStoredRaceList === 'function') ? (apStoredRaceList() || []) : [];
    for (var i = 0; i < list.length; i++){
      var item = list[i];
      var rid = String((item && item.rid) || '');
      if (!rid) continue;
      var rec = null;
      try { rec = (typeof apGet === 'function') ? apGet(rid) : null; } catch(e){ rec = null; }
      if (!rec) continue;
      var p = (item && item.p) || {};
      var rows = p.rows || [];
      if ((!rows || rows.length < 3) && rec.result && rec.result.rows) rows = rec.result.rows;
      if (!rows || rows.length < 3) continue;
      /* 払戻は「学習DB(datarace)由来 → 自己検証レコード(rec.result)由来」の順で探す。
         実払戻が取れているレースほど精算が正確になります。 */
      var payout = p.payout || (rec.result && rec.result.payout) || null;
      var payouts = p.payouts || (rec.result && rec.result.payouts) || null;
      var r = vtRaceOf(rid, {
        rid: rid, pre: rec.pre, preBt: rec.preBt, meta: rec.meta || null,
        result: { rows: rows, payout: payout, payouts: payouts }
      }, rows);
      if (r){ r.hasPay = !!(payout || payouts); out.push(r); }
      if (limit && out.length >= limit) break;
    }
  } catch(e){}
  return out;
}

/* ---------- 1レース × 1設定 の精算 ---------- */
function vtEvalRace(race, st){
  var picked = [], i, c;
  var kinds = st.kinds;
  for (i = 0; i < race.cand.length; i++){
    c = race.cand[i];
    if (kinds.indexOf(c.kind) < 0) continue;
    if (c.qmax >= st.pool) continue;
    if (c.edge < st.minEdge) continue;
    picked.push(c);
  }
  if (!picked.length) return { invest:0, ret:0, pts:0, hitPts:0, raceBet:0, raceHit:0, est:0 };
  picked.sort(function(a, b){ return b.ev - a.ev; });
  if (picked.length > st.cap) picked = picked.slice(0, st.cap);

  // 金額の配分（どの方式でも投資額は「点数×100円」で揃える＝回収率を公平に比べられる）
  var budget = picked.length * VT_BUDGET_PER_PT;
  var yen = [], k;
  if (st.stake === 'kelly'){
    var fs = 0; picked.forEach(function(x){ fs += x.kelly; });
    if (fs > 0){
      // 分数ケリー（f = (P×O − 1)/(O − 1)）の「比」で配る。
      // 合計は均等張りと同じ投資額になるよう正規化するので、回収率の比較は公平になります。
      for (k = 0; k < picked.length; k++) yen.push(picked[k].kelly / fs * budget);
    } else { for (k = 0; k < picked.length; k++) yen.push(VT_BUDGET_PER_PT); }
  } else if (st.stake === 'top'){
    var topN = Math.min(3, picked.length), wsum = 0, ws = [];
    for (k = 0; k < picked.length; k++){
      var w = (k < topN) ? Math.max(0.0001, picked[k].ev - 1 + 0.05) : 0;
      ws.push(w); wsum += w;
    }
    if (wsum > 0){ for (k = 0; k < picked.length; k++) yen.push(ws[k] / wsum * budget); }
    else { for (k = 0; k < picked.length; k++) yen.push(VT_BUDGET_PER_PT); }
  } else {
    for (k = 0; k < picked.length; k++) yen.push(VT_BUDGET_PER_PT);
  }
  // 100円単位に丸めて、合計が budget に近くなるように調整（最低100円）
  var units = [], total = 0;
  for (k = 0; k < picked.length; k++){
    var u = Math.max(1, Math.round(yen[k] / 100));
    units.push(u); total += u;
  }
  var tgt = Math.max(picked.length, Math.round(budget / 100));
  var guard = 0;
  while (total > tgt && guard++ < 4000){
    var mx = -1, mi2 = -1;
    for (k = 0; k < units.length; k++){ if (units[k] > 1 && units[k] > mx){ mx = units[k]; mi2 = k; } }
    if (mi2 < 0) break;
    units[mi2]--; total--;
  }
  guard = 0;
  while (total < tgt && guard++ < 4000){
    var mxi = 0;
    for (k = 1; k < units.length; k++){ if (yen[k] > yen[mxi]) mxi = k; }
    units[mxi]++; total++;
  }

  var invest = 0, ret = 0, hitPts = 0, est = 0;
  for (k = 0; k < picked.length; k++){
    var b = picked[k], y = units[k] * 100;
    invest += y;
    var pm = race.pay[b.kind];
    if (pm){
      var pay100 = pm[b.key] || 0;
      if (pay100 > 0){ ret += Math.round(pay100 * y / 100); hitPts++; }
    } else {
      est++;
      if (vtHitByOrder(b.kind, b.nos, race.order)){
        ret += Math.round(b.oddsT * y);
        hitPts++;
      }
    }
  }
  return { invest:invest, ret:ret, pts:picked.length, hitPts:hitPts,
           raceBet:(invest > 0 ? 1 : 0), raceHit:(ret > 0 ? 1 : 0), est:est };
}

/* ---------- 集計器 ---------- */
function vtAcc(){
  return { invest:0, ret:0, pts:0, hitPts:0, raceBet:0, raceHit:0, est:0, races:0, kindHit:{}, kindPts:{} };
}
function vtMerge(a, b){
  a.invest += b.invest; a.ret += b.ret; a.pts += b.pts; a.hitPts += b.hitPts;
  a.raceBet += b.raceBet; a.raceHit += b.raceHit; a.est += b.est;
  return a;
}
function vtRates(a){
  return {
    roi: a.invest > 0 ? a.ret / a.invest : 0,
    hitRace: a.raceBet > 0 ? a.raceHit / a.raceBet : 0,
    hitPt: a.pts > 0 ? a.hitPts / a.pts : 0,
    avgPts: a.raceBet > 0 ? a.pts / a.raceBet : 0,
    avgYen: a.raceBet > 0 ? a.invest / a.raceBet : 0
  };
}

/* 全設定の総当たり */
function vtSweep(races){
  var res = [];
  VT_KINDSETS.forEach(function(ks){
    VT_POOLS.forEach(function(pool){
      VT_EDGES.forEach(function(edge){
        VT_CAPS.forEach(function(cap){
          VT_STAKES.forEach(function(sk){
            var st = { id:[ks.id, pool, edge.toFixed(2), cap, sk.id].join('/'),
                       ks:ks.id, ksName:ks.n, kinds:ks.kinds, pool:pool, minEdge:edge, cap:cap,
                       stake:sk.id, stakeName:sk.n };
            var a = vtAcc();
            for (var i = 0; i < races.length; i++){
              var r = vtEvalRace(races[i], st);
              if (r.raceBet){ a.races++; vtMerge(a, r); }
            }
            if (!a.races) return;
            st.acc = a;
            st.rate = vtRates(a);
            res.push(st);
          });
        });
      });
    });
  });
  return res;
}

/* 点数別の回収率（＝「絞り込み」の効果を一番分かりやすく出す表） */
function vtByPoints(races){
  var buckets = [
    { id:'1', n:'1点', lo:1, hi:1 },
    { id:'2-3', n:'2〜3点', lo:2, hi:3 },
    { id:'4-6', n:'4〜6点', lo:4, hi:6 },
    { id:'7-10', n:'7〜10点', lo:7, hi:10 },
    { id:'11-16', n:'11〜16点', lo:11, hi:16 },
    { id:'17+', n:'17点以上', lo:17, hi:1e9 }
  ];
  var acc = {}; buckets.forEach(function(b){ acc[b.id] = vtAcc(); });
  // 券種は全部・edge下限なし＝「AIが張ると言った目を全部張る」状態を、点数だけで分けて測る
  var allKinds = ['tan','fuku','wide','umaren','umatan','sanren','santan'];
  races.forEach(function(race){
    VT_CAPS.forEach(function(cap){
      var st = { kinds:allKinds, pool:VT_MAX_POOL, minEdge:1.0, cap:cap, stake:'flat' };
      var r = vtEvalRace(race, st);
      if (!r.raceBet) return;
      for (var i = 0; i < buckets.length; i++){
        if (r.pts >= buckets[i].lo && r.pts <= buckets[i].hi){ vtMerge(acc[buckets[i].id], r); acc[buckets[i].id].races++; break; }
      }
    });
  });
  return buckets.map(function(b){
    var a = acc[b.id]; a.rate = vtRates(a); a.label = b.n; return a;
  }).filter(function(a){ return a.races > 0; });
}

/* 券種別の実測回収率（どの券種が金を稼いでいるか） */
function vtByKind(races){
  var kinds = ['tan','fuku','wide','umaren','umatan','sanren','santan'];
  return kinds.map(function(kind){
    var a = vtAcc();
    races.forEach(function(race){
      var st = { kinds:[kind], pool:4, minEdge:1.0, cap:8, stake:'flat' };
      var r = vtEvalRace(race, st);
      if (!r.raceBet) return;
      a.races++; vtMerge(a, r);
    });
    a.rate = vtRates(a);
    a.label = (BP_KIND[kind] && BP_KIND[kind].n) || kind;
    a.kind = kind;
    return a;
  }).filter(function(a){ return a.races > 0; });
}

/* edge帯別の実測回収率（妙味の下限をどこに置くべきか） */
function vtByEdge(races){
  var bands = [
    { n:'edge 1.00未満（市場より下）', lo:0, hi:1.00 },
    { n:'edge 1.00〜1.15', lo:1.00, hi:1.15 },
    { n:'edge 1.15〜1.30', lo:1.15, hi:1.30 },
    { n:'edge 1.30〜1.60', lo:1.30, hi:1.60 },
    { n:'edge 1.60以上', lo:1.60, hi:1e9 }
  ];
  var kinds = ['tan','fuku','wide','umaren','umatan','sanren','santan'];
  return bands.map(function(bd){
    var invest = 0, ret = 0, pts = 0, hit = 0;
    races.forEach(function(race){
      race.cand.forEach(function(c){
        if (kinds.indexOf(c.kind) < 0) return;
        if (!(c.edge >= bd.lo && c.edge < bd.hi)) return;
        pts++; invest += 100;
        var pm = race.pay[c.kind];
        var pay100 = pm ? (pm[c.key] || 0) : (vtHitByOrder(c.kind, c.nos, race.order) ? Math.round(c.oddsT * 100) : 0);
        if (pay100 > 0){ ret += pay100; hit++; }
      });
    });
    return { label:bd.n, invest:invest, ret:ret, pts:pts, hitPts:hit,
             roi: invest > 0 ? ret / invest : 0, hitPt: pts > 0 ? hit / pts : 0 };
  }).filter(function(x){ return x.pts > 0; });
}

/* =========================================================
   分析と表示
   ========================================================= */
var VT_CACHE = { sig:'', data:null };

/* 今の③買い目提案の設定を vtEvalRace 用の形式に読み替える */
function vtCurrentStrategy(){
  var o = null;
  try { o = (typeof bpReadOpt === 'function') ? bpReadOpt() : null; } catch(e){ o = null; }
  o = o || {};
  var stake = (o.kelly >= 0.35) ? 'top' : (o.kelly > 0.18) ? 'kelly' : 'flat';
  return {
    id:'current', ksName:'③の今の設定', kinds:(o.kinds && o.kinds.length) ? o.kinds : ['tan'],
    pool: Math.min(VT_MAX_POOL, Math.max(3, Math.round(o.pool || BP_DEF.pool))),
    minEdge: (o.minEdge != null ? o.minEdge : BP_DEF.minEdge),
    cap: Math.max(1, Math.round(o.maxBets || BP_DEF.maxBets)),
    stake: stake, stakeName: (stake === 'flat' ? '1点100円均等' : stake === 'kelly' ? '分数ケリー' : 'EV上位に集中')
  };
}
function vtAccFor(races, st){
  var a = vtAcc();
  for (var i = 0; i < races.length; i++){
    var r = vtEvalRace(races[i], st);
    if (r.raceBet){ a.races++; vtMerge(a, r); }
  }
  a.rate = vtRates(a);
  return a;
}
function vtAnalyze(races){
  var out = { races: races.length, nLive: 0, nBt: 0, nPay: 0, sweep: [], best: null, cur: null,
              byPoints: [], byKind: [], byEdge: [], advice: [] };
  races.forEach(function(r){ if (r.src === 'live') out.nLive++; else out.nBt++; if (r.hasPay) out.nPay++; });
  out.sweep = vtSweep(races);
  out.cur = vtAccFor(races, vtCurrentStrategy());
  // 一番回収率が高い設定（レース数が少なすぎるものは除外）
  var minRaces = Math.max(1, Math.round(races.length * 0.3));
  var ok = out.sweep.filter(function(s){ return s.acc.races >= minRaces && s.acc.invest >= 1000; });
  ok.sort(function(a, b){ return b.rate.roi - a.rate.roi; });
  out.best = ok[0] || null;
  out.top = ok.slice(0, 12);
  out.byPoints = vtByPoints(races);
  out.byKind = vtByKind(races);
  out.byEdge = vtByEdge(races);
  out.advice = vtAdvice(out);
  return out;
}
function vtPct(x, d){ return (x == null || !isFinite(x)) ? '—' : (x * 100).toFixed(d == null ? 1 : d) + '%'; }
function vtYen(x){ return (x == null || !isFinite(x)) ? '—' : Math.round(x).toLocaleString('ja-JP') + '円'; }

/* 実測値から「回收率を上げるには」の提言文章を作る */
function vtAdvice(A){
  var s = [];
  if (!A.races){ return ['対象レースがありません。']; }
  if (A.races < 10){
    s.push('⚠ 対象が ' + A.races + ' レースしかありません。10レース未満の総当たりはブレが大きいので、' +
      '「📥 出馬表を一括取得」で出走前の予想を貯めてからもう一度押してください（目安30レース以上）。');
  }
  var cur = A.cur && A.cur.rate ? A.cur.rate : null;
  if (cur && A.cur.races){
    s.push('📌 <b>今の③買い目提案の設定</b>（' + vtPct(cur.hitRace) + ' 的中／' + vtPct(cur.avgPts, 1) +
      ' 点・平均）で実測すると、<b>回収率 ' + vtPct(cur.roi) + '</b>（投資 ' + vtYen(A.cur.invest) +
      ' → 払戻 ' + vtYen(A.cur.ret) + '／' + A.cur.races + 'レース）。');
  }
  if (A.best){
    var b = A.best.rate;
    var gain = cur ? (b.roi - cur.roi) : null;
    s.push('🏆 <b>一番回収率が高かった設定</b>: 【' + A.best.ksName + '／AI上位 ' + A.best.pool + ' 頭／edge ' +
      A.best.minEdge.toFixed(2) + ' 以上／最大 ' + A.best.cap + ' 点／' + A.best.stakeName + '】→ ' +
      '<b>回収率 ' + vtPct(b.roi) + '</b>・的中率 ' + vtPct(b.hitRace) + '・平均 ' + vtPct(b.avgPts, 1) + ' 点' +
      (gain != null ? '（今の設定比 <b>' + (gain >= 0 ? '+' : '') + vtPct(gain) + '</b>）' : '') + '。' +
      '　下の「✅ この設定を③に反映」でそのまま使えます。');
  }
  // 点数の効果
  if (A.byPoints.length >= 2){
    var best = A.byPoints.slice().sort(function(x, y){ return y.rate.roi - x.rate.roi; })[0];
    var worst = A.byPoints.slice().sort(function(x, y){ return x.rate.roi - y.rate.roi; })[0];
    if (best && worst && best !== worst){
      s.push('🎯 <b>点数を絞る効果</b>: ' + best.label + 'が回収率 ' + vtPct(best.rate.roi) +
        '（的中率 ' + vtPct(best.rate.hitRace) + '）で最良、' + worst.label + 'は ' + vtPct(worst.rate.roi) +
        '。<b>的中率を保ったまま点数を減らす</b>のが一番効きます（1点増やすごとに投資が100円ずつ増えるため）。');
    }
  }
  // edge の効果
  var good = null, bad = null;
  (A.byEdge || []).forEach(function(x){
    if (/1\.00未満/.test(x.label)) bad = x;
    if (/1\.30〜1\.60|1\.60以上/.test(x.label) && (!good || x.roi > good.roi)) good = x;
  });
  if (bad && bad.pts){
    s.push('🔍 <b>edge 1.00未満（AIが市場より下に見ている目）</b>は ' + bad.pts + ' 点あって回収率 ' +
      vtPct(bad.roi) + '。ここを<b>買わないだけで</b>回収率は確実に上がります（③の「妙味の下限 edge」を 1.00 以上に）。');
  }
  if (good && good.pts){
    s.push('💠 <b>' + good.label + '</b> は回収率 ' + vtPct(good.roi) + '（' + good.pts + ' 点）。' +
      '妙味の高い目に絞るほど回収率が上がるなら、③の edge 下限を 1.15〜1.25 に上げるのが有効です。');
  }
  // 券種
  if (A.byKind && A.byKind.length){
    var ks = A.byKind.slice().sort(function(a, b){ return b.rate.roi - a.rate.roi; });
    var k1 = ks[0], k2 = ks[ks.length - 1];
    if (k1 && k2 && k1 !== k2){
      s.push('🎫 <b>券種別</b>: 一番稼いでいるのは <b>' + k1.label + '</b>（回収率 ' + vtPct(k1.rate.roi) +
        '・的中率 ' + vtPct(k1.rate.hitRace) + '）、一番沈んでいるのは <b>' + k2.label + '</b>（' +
        vtPct(k2.rate.roi) + '）。的中率が高いのに回収率が伸びないときは、' +
        '<b>的中率の高い券種（複勝・ワイド）を外して妙味のある券種に寄せる</b>のが定石です。');
    }
  }
  // 配分方式
  var byStake = {};
  (A.sweep || []).forEach(function(s2){
    (byStake[s2.stake] = byStake[s2.stake] || []).push(s2.rate.roi);
  });
  var stTxt = Object.keys(byStake).map(function(k){
    var arr = byStake[k].slice().sort(function(a, b){ return b - a; });
    var med = arr[Math.floor(arr.length / 2)] || 0;
    var nm = { flat:'1点100円均等', kelly:'分数ケリー', top:'EV上位3点に集中' }[k] || k;
    return nm + ' ' + vtPct(med);
  });
  if (stTxt.length >= 2){
    s.push('💴 <b>金額の配分方式</b>（全設定の中央値）: ' + stTxt.join(' ／ ') +
      '。均等よりケリー／集中が高いなら「当たりやすい目」より「妙味のある目」に厚く張る方が回収率は伸びます。');
  }
  if (A.nPay < A.races){
    s.push('📎 実払戻が取れているのは ' + A.nPay + '/' + A.races + ' レースです。残りは着順から当たり判定をして' +
      '理論オッズで精算しています（結果ページの取込で払戻も一緒に入ると精度が上がります）。');
  }
  return s;
}

function vtStLabel(st){
  if (!st) return '（該当なし）';
  return (st.ksName || st.id || '?') + '／AI上位' + st.pool + '頭／edge≥' + Number(st.minEdge).toFixed(2) +
    '／最大' + st.cap + '点／' + (st.stakeName || st.stake || '');
}
function vtHTML(A){
  var h = [];
  if (!A || !A.races){
    return '<div class="warnbox">対象レースがありません。①データ入力の「📥 その日の出馬表を一括取得」で<b>出走前の予想</b>を貯めるか、' +
      '「学習データ」タブで過去レースを取り込んでから、もう一度「🔁 総当たりする」を押してください。</div>';
  }
  h.push('<div class="small muted" style="margin:2px 0 8px;line-height:1.7">対象 <b>' + A.races + '</b> レース' +
    '（事前予想 ' + A.nLive + '／バックテスト予想 ' + A.nBt + '・実払戻あり ' + A.nPay + '）を、' +
    '<b>' + (A.sweep ? A.sweep.length : 0) + ' 通りの買い方</b>で総当たりしました。' +
    '予想は出走前に保存したもの（rec.pre）だけを使い、結果確定後の作り直しは使っていません。</div>');
  h.push('<div class="vtadv">');
  (A.advice || []).forEach(function(t){ h.push('<div class="vtadvl">' + t + '</div>'); });
  h.push('</div>');

  // 上位設定
  if (A.top && A.top.length){
    h.push('<div class="bfdh2" style="margin-top:10px">🏅 回収率が高かった買い方 上位 ' + A.top.length + '</div>');
    h.push('<table class="lr-tbl"><thead><tr><th style="text-align:left">買い方</th><th>回収率</th><th>的中率<br>(レース)</th>' +
      '<th>的中率<br>(点数)</th><th>平均<br>点数</th><th>投資額</th><th>払戻額</th><th>対象<br>レース</th><th></th></tr></thead><tbody>');
    A.top.forEach(function(st, i){
      var r = st.rate;
      var roiCls = r.roi >= 1 ? 'good' : (r.roi >= 0.85 ? '' : 'bad');
      h.push('<tr><td style="text-align:left">' + (i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '') +
        esc(vtStLabel(st)) + '</td>' +
        '<td class="' + roiCls + '"><b>' + vtPct(r.roi) + '</b></td>' +
        '<td>' + vtPct(r.hitRace) + '</td><td>' + vtPct(r.hitPt) + '</td><td>' + r.avgPts.toFixed(1) + '</td>' +
        '<td>' + vtYen(st.acc.invest) + '</td><td>' + vtYen(st.acc.ret) + '</td><td>' + st.acc.races + '</td>' +
        '<td>' + (i === 0 ? '<button type="button" class="btn small" data-vtapply="' + esc(st.id) + '">✅ ③に反映</button>' : '') + '</td></tr>');
    });
    h.push('</tbody></table>');
  }
  // 点数別
  if (A.byPoints && A.byPoints.length){
    h.push('<div class="bfdh2" style="margin-top:10px">🎯 買い目点数別の回収率（点数を絞る効果）</div>');
    h.push('<table class="lr-tbl"><thead><tr><th style="text-align:left">1レースあたりの点数</th><th>回収率</th>' +
      '<th>的中率(レース)</th><th>的中率(点数)</th><th>投資額</th><th>払戻額</th><th>サンプル</th></tr></thead><tbody>');
    A.byPoints.forEach(function(a){
      h.push('<tr><td style="text-align:left"><b>' + a.label + '</b></td>' +
        '<td class="' + (a.rate.roi >= 1 ? 'good' : a.rate.roi >= 0.85 ? '' : 'bad') + '"><b>' + vtPct(a.rate.roi) + '</b></td>' +
        '<td>' + vtPct(a.rate.hitRace) + '</td><td>' + vtPct(a.rate.hitPt) + '</td>' +
        '<td>' + vtYen(a.invest) + '</td><td>' + vtYen(a.ret) + '</td><td>' + a.races + '</td></tr>');
    });
    h.push('</tbody></table>');
  }
  // edge帯別
  if (A.byEdge && A.byEdge.length){
    h.push('<div class="bfdh2" style="margin-top:10px">🔍 オッズ妙味(edge)帯別の回収率</div>');
    h.push('<table class="lr-tbl"><thead><tr><th style="text-align:left">edge（AI勝率 ÷ 市場期待勝率）</th><th>回収率</th>' +
      '<th>的中率(点数)</th><th>点数</th><th>投資額</th><th>払戻額</th></tr></thead><tbody>');
    A.byEdge.forEach(function(a){
      h.push('<tr><td style="text-align:left"><b>' + esc(a.label) + '</b></td>' +
        '<td class="' + (a.roi >= 1 ? 'good' : a.roi >= 0.85 ? '' : 'bad') + '"><b>' + vtPct(a.roi) + '</b></td>' +
        '<td>' + vtPct(a.hitPt) + '</td><td>' + a.pts + '</td><td>' + vtYen(a.invest) + '</td><td>' + vtYen(a.ret) + '</td></tr>');
    });
    h.push('</tbody></table>');
    h.push('<div class="small muted" style="margin-top:3px">※ JRAの控除（単勝・複勝20%／その他25%）があるので、' +
      'edge 1.00 ちょうどなら回収率は 75〜80% になります。<b>単勝系で edge 1.25 以上、3連系で 1.34 以上</b>が' +
      '回収率100%超のラインです。</div>');
  }
  // 券種別
  if (A.byKind && A.byKind.length){
    h.push('<div class="bfdh2" style="margin-top:10px">🎫 券種別の実測回収率（AI上位4頭・最大8点・均等張り）</div>');
    h.push('<table class="lr-tbl"><thead><tr><th style="text-align:left">券種</th><th>回収率</th><th>的中率(レース)</th>' +
      '<th>的中率(点数)</th><th>平均点数</th><th>投資額</th><th>払戻額</th></tr></thead><tbody>');
    A.byKind.forEach(function(a){
      h.push('<tr><td style="text-align:left"><b>' + esc(a.label) + '</b></td>' +
        '<td class="' + (a.rate.roi >= 1 ? 'good' : a.rate.roi >= 0.85 ? '' : 'bad') + '"><b>' + vtPct(a.rate.roi) + '</b></td>' +
        '<td>' + vtPct(a.rate.hitRace) + '</td><td>' + vtPct(a.rate.hitPt) + '</td><td>' + a.rate.avgPts.toFixed(1) + '</td>' +
        '<td>' + vtYen(a.invest) + '</td><td>' + vtYen(a.ret) + '</td></tr>');
    });
    h.push('</tbody></table>');
  }
  return h.join('');
}

function vtSig(races){
  var s = races.length + '|';
  for (var i = 0; i < races.length && i < 400; i++){
    s += races[i].rid + ':' + races[i].cand.length + ':' + (races[i].hasPay ? 1 : 0) + ',';
  }
  try { s += '|' + JSON.stringify(vtCurrentStrategy()); } catch(e){}
  return s;
}
function vtRender(force){
  var box = $('vtBox'); if (!box) return;
  var races = [];
  try { races = vtRaces(0); } catch(e){ races = []; }
  var sig = vtSig(races);
  if (!force && VT_CACHE.sig === sig && VT_CACHE.data){
    box.innerHTML = vtHTML(VT_CACHE.data);
    vtWire(box);
    return;
  }
  box.innerHTML = '<div class="small muted">🔁 ' + races.length + ' レースぶんを総当たりしています…（数秒）</div>';
  setTimeout(function(){
    var A = null;
    try { A = vtAnalyze(races); } catch(e){ A = null; }
    VT_CACHE.sig = sig; VT_CACHE.data = A;
    try {
      box.innerHTML = A ? vtHTML(A) : ('<div class="warnbox">計算中にエラーが出ました: ' + esc(String((window.event && window.event.message) || '不明')) + '</div>');
    } catch(e2){ box.innerHTML = '<div class="warnbox">表示中にエラー: ' + esc(String(e2 && e2.message || e2)) + '</div>'; }
    vtWire(box);
    var c = $('vtChip');
    if (c) c.textContent = A ? (A.races + 'レース / ' + (A.sweep ? A.sweep.length : 0) + '通り') : '—';
    var p = $('vtPick');
    if (p && A && A.best){
      p.innerHTML = '💰 <b>回収率の最良設定</b>: ' + esc(vtStLabel(A.best)) + ' → 回収率 <b>' + vtPct(A.best.rate.roi) +
        '</b>（的中率 ' + vtPct(A.best.rate.hitRace) + '）' +
        (A.cur && A.cur.rate ? '／今の③の設定は ' + vtPct(A.cur.rate.roi) : '');
    } else if (p && A){
      p.innerHTML = '💰 <b>回収率チューナー</b>: 対象レースは ' + A.races + ' 件。条件を満たす買い方が見つかりませんでした（レース数を増やしてもう一度）。';
    }
  }, 30);
}
function vtWire(box){
  if (!box || !box.querySelectorAll) return;
  var bs = box.querySelectorAll('[data-vtapply]');
  for (var i = 0; i < bs.length; i++){
    bs[i].addEventListener('click', function(){
      vtApply(this.getAttribute('data-vtapply'));
    });
  }
}
/* 一番回収率が高かった設定を ③買い目提案（詳細版）の入力欄に書き込む */
function vtApply(id){
  var A = VT_CACHE.data;
  if (!A || !A.top) return;
  var st = null;
  A.top.forEach(function(x){ if (x.id === id) st = x; });
  if (!st) st = A.best;
  if (!st) return;
  function setV(elId, val){ try { var el = $(elId); if (el) el.value = String(val); } catch(e){} }
  setV('bpEdge', Number(st.minEdge).toFixed(2));
  setV('bpMax', st.cap);
  setV('bpPool', Math.max(4, st.pool));
  ['tan','fuku','wide','umaren','umatan','sanren','santan'].forEach(function(k){
    try { var el = $('bpK_' + k); if (el) el.checked = (st.kinds.indexOf(k) >= 0); } catch(e){}
  });
  try {
    var m = $('bpMode');
    if (m) m.value = (st.stake === 'top') ? 'a' : (st.stake === 'kelly') ? 'b' : 'k';
  } catch(e){}
  try { if (typeof bpRender === 'function') bpRender(); } catch(e){}
  var msg = $('vtMsg');
  if (msg) msg.innerHTML = '<span style="color:var(--ok-ink)">✅ ③「買い目提案（詳細版）」に反映しました: ' +
    esc(vtStLabel(st)) + '（実測回収率 ' + vtPct(st.rate.roi) + '）</span>';
}
function initVt(){
  var c = $('vtCard');
  if (c) c.addEventListener('toggle', function(){ if (c.open) vtRender(false); });
  var b = $('vtRun');
  if (b) b.addEventListener('click', function(){ vtRender(true); });
}
