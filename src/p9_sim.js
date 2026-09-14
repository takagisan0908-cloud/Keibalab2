/* =========================================================
   タブ③：レースシミュレーター（映像なし・結果と集計だけ）
   ---------- 2026-09-11 変更 ----------
   ・「速さ」「映像(アニメーション)」「100回集計」のUIとコードは削除しました。
   ・⚡結果を出す / 🔄もう一度 / ⏩まとめて(3〜50回) だけで、着順・タイム・着差・展開を即時表示。
   ・実行結果は「📊 シミュレーション合計集計」に積み上がり、端末に保存されます（集計リセット可能）。
   ・出遅れ率(％)と「過去戦績で脚質が安定しない馬」を反映して着順をサンプルします。
   ========================================================= */
var sim = { running:false, raf:0, parts:[], final:[], follow:null };

/* 「最後の直線」再生を始めるゴールまでの残距離(m)。会場の直線長+4コーナー残り。 */
function simFinalStartRem(D){
  /* 展開ログ（4コーナー想定隊列）を作る「ゴールまでの残距離」。
     映像は廃止したので会場別の直線長は使わず、距離から概算する。 */
  D = Math.max(200, parseFloat(D) || 2000);
  return Math.max(200, Math.min(D * 0.94, Math.max(240, D * 0.3)));
}


/* 指数分布サンプルで1レースの着順を生成 */
function sampleOneOrder(ps){
  var n = ps.length, arr = [];
  for (var i=0;i<n;i++){
    var rate = Math.max(ps[i], 0.0005);
    arr.push([ -Math.log(1 - Math.random()) / rate, i ]);
  }
  arr.sort(function(a,b){ return a[0]-b[0]; });
  return arr.map(function(x){ return x[1]; });
}

function getParticipants(){
  var res = currentAnalysis();
  if (!res.ok) return null;
  return res.rows.map(function(r){
    return { no:r.h.no, name:r.h.name||(''), frame:r.h.frame||'', mark:r.mark, odds:r.h.odds||'', prob:r.prob, idx:r.idx, slow:r.h.slow||'', style:r.h.style||'' };
  });
}

function simResetResultUI(){
  var fb = $('finBody'); if (fb) fb.innerHTML = '';
  var fm = $('finMeta'); if (fm) fm.innerHTML = '';
  var sW = $('simResultWrap'); if (sW) sW.classList.add('hid');
  var sE = $('simResultEmpty'); if (sE) sE.classList.remove('hid');
  var sx = $('simExp'); if (sx) sx.innerHTML = '';
}
function buildSimPanel(){
  SIM_SV_CACHE = {};                    // 馬柱を取り直した可能性があるので脚質ブレの判定を作り直す
  var parts = getParticipants();
  $('simEmpty').style.display = parts ? 'none' : '';
  $('simBody').classList.toggle('hid', !parts);
  if (!parts) return;
  var res = currentAnalysis();
  var ml = $('simMarkLine');
  if (ml){
    ml.innerHTML = res.rows.slice(0,5).map(function(r){
      return '<span><span class="mk0 ' + r.markCls + '">' + esc(r.mark) + '</span><b>' + esc(r.h.no) + '</b> ' + esc(r.h.name) + ' <span class="muted small">' + pct(r.prob) + '%</span></span>';
    }).join('');
  }
  simSetHint();
  simResetResultUI();
  if (typeof simAggRender === 'function') simAggRender();
}


/* ---- 展開モデル（脚質別ペース + 決着タイム固定） ---- */
function simFlowStyle(str){
  var t = String(str || '').replace(/自在.*/, '');
  if (t.indexOf('逃') >= 0) return '逃げ';
  if (t.indexOf('先') >= 0) return '先行';
  if (t.indexOf('追') >= 0) return '追込';
  if (t.indexOf('差') >= 0) return '差し';
  return (Math.random() < 0.35) ? '先行' : '差し';
}
function simFlowSpeed(st, u, paceAdj){
  // u = 走行割合(0..1)。基準速度に対する倍率。
  // 実際の競走馬の速度差は数%程度。S字カーブ(滑らか)で緩やかに順位が動くようにし、
  // 「ゴール直前だけ急加速/急失速」しない現実的な速度変化にする。
  // 逃げ・先行の先行利はレース前半で緩やかに減衰し、差し・追込の伸びは
  // 残り半分あたりからなだらかに現れてゴールへ向かう。
  u = clamp(u, 0, 1);
  function ss(a, b, x){ x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }
  var s = 1;
  // 加速・減速は「ゴール手前で完結」させる(ssの終端を1.0より手前=0.9前後に置く)。
  // そうすることで「ゴール直前にまだ急加速/急失速している」見た目が消え、
  // 逃げ・先行は最後に失速しきった速さで流し込み、差し・追込は加速しきってゴールへ持続する。
  if (st === '逃げ'){
    s = 1 + 0.045 * (1 - ss(0.0, 0.60, u)) - (0.050 + 0.020 * paceAdj) * ss(0.50, 0.94, u);
  } else if (st === '先行'){
    s = 1 + 0.032 * (1 - ss(0.0, 0.55, u)) - (0.033 + 0.012 * paceAdj) * ss(0.50, 0.94, u);
  } else if (st === '差し'){
    s = 1 - 0.030 * ss(0.0, 0.45, u) + (0.035 + 0.015 * paceAdj) * ss(0.38, 0.90, u);
  } else if (st === '追込'){
    s = 1 - 0.048 * ss(0.0, 0.38, u) + (0.048 + 0.020 * paceAdj) * ss(0.30, 0.88, u);
  } else {
    s = 1;
  }
  // ゲート直後はどの馬もわずかに遅い(共通なので隊列への影響は小さい)
  var accel = (u < 0.06) ? (0.95 + 0.05 * (u / 0.06)) : 1;
  return accel * s;
}
/* 脚質st・決着タイムF(秒)・ハイペース度paceAdj(0..1)から、0..1の位置テーブルを生成 */
function simBuildPlan(st, F, paceAdj){
  var KPLAN = 1400, M = 900, If = 0, fv = new Array(KPLAN);
  var prev = simFlowSpeed(st, 0, paceAdj);
  for (var q = 1; q <= M; q++){
    var uu = q / M, ff = simFlowSpeed(st, uu, paceAdj);
    If += (1 / Math.max(0.2, ff) + 1 / Math.max(0.2, prev)) * (0.5 / M);
    prev = ff;
  }
  var u = 0, du;
  for (var k = 0; k < KPLAN; k++){
    fv[k] = Math.min(1, u);
    du = (If / KPLAN) * Math.max(0.2, simFlowSpeed(st, Math.min(0.999, u), paceAdj));
    u += du;
  }
  return { st: st, F: Math.max(0.5, parseFloat(F) || 1), u: fv, n: KPLAN };
}
function simPlanU(pl, real){
  // 各馬は同時刻スタートで、自分の決着タイムFの瞬間にゴール(u=1)する
  var r = (real / pl.F);
  if (r <= 0) return 0;
  if (r >= 1) return 1;
  var k = Math.round(r * (pl.n - 1));
  return pl.u[k];
}

/* 出遅れ率(slow%)から「この1走でスタートに出遅れるか」を抽選。
   不利になったら実力(勝率)を下げて着順へ反映(0.5〜1.0倍)。不利なし=1 */
function simSlowRate(p){
  var sl = slowPctOf(p && p.slow);        // 出遅れ率は0〜100%（#2026-09-12 第15弾）
  if (!(sl >= 6)) return 1;
  return (Math.random() * 100 < Math.min(90, sl)) ? (0.5 + Math.random() * 0.5) : 1;
}

/* 距離から基準平均時速(m/s)を決める */
function simAvgVw(D){
  return (D > 2600 ? 15.8 : D > 2000 ? 16.4 : D > 1500 ? 16.8 : D >= 1000 ? 17.2 : 16.4);
}
/* 分析のペース予想から「ハイペース度」(0..1) を取り出す */
function simPaceAdjOf(){
  var paceAdj = 0.5;
  try {
    var _an0 = currentAnalysis();
    if (_an0 && _an0.pace && _an0.pace.score != null) paceAdj = clamp(+_an0.pace.score, 0.05, 0.95);
  } catch(e){}
  if (state.paceOverride != null) paceAdj = clamp(parseFloat(state.paceOverride) || 0.5, 0.05, 0.95);
  return paceAdj;
}
/* 1レース分の決着をサンプル: 着順order・着差m・決着タイムfinT を返す。
   出遅れ率(slow%)の高い馬は一定確率でスタート不利になり、その分だけ着順が落ちる。
   着差は現実的な「1着から順に 平均1頭1.7m前後」で、離れた馬も 0〜4% 程度の範囲に収める。 */
function simSampleFinish(parts, D){
  var n = parts.length;
  var probs = parts.map(function(p){
    var pb = (p && isFinite(p.prob)) ? Math.max(p.prob, 0.0005) : 0.0005;
    var f = simSlowRate(p);                    // 出遅れ率(％) → 一定確率でスタート不利
    var sv = simStyleVarOf(p);                 // 脚質が安定しない馬 → 結果の振れ幅を大きくする
    if (simUnstable(sv)){
      f *= 1 + (Math.random() - 0.5) * 2 * Math.min(0.6, sv.sd * 1.2);
    }
    return pb * f;
  });
  var order = sampleOneOrder(probs);
  var vw = simAvgVw(D);
  var mar = new Array(n), mmax = 0, m = 0;
  order.forEach(function(idx, rank){
    if (rank === 0){ mar[idx] = 0; }
    else {
      m += 0.7 + Math.random() * 2.1;   // 1着から数えて平均1.75m/頭(現実的な着差)
      m = Math.min(m, D * 0.04);        // 最大でも4%差まで(同着を避けるため僅かな最小差は確保)
      if (m <= mar[order[rank - 1]]) m = mar[order[rank - 1]] + 0.05;
      mar[idx] = m;
    }
    mmax = Math.max(mmax, mar[idx]);
  });
  // 基準(1着想定)タイムに毎回わずかな変動を加え、同じレースでも僅かに時計が変わるようにする
  var baseT = D / vw + (Math.random() - 0.5) * 0.6;
  var finT = new Array(n);
  order.forEach(function(idx){ finT[idx] = baseT + mar[idx] / vw; });
  return { order: order, mar: mar, mmax: mmax, vw: vw, finT: finT };
}

sim._bt = 0;

function simTimeFmt(sec){
  // 先に小数1桁へ丸めてから分秒に割る（9.97秒→"010.0"のような桁ズレを防ぐ）
  var s = Math.round((parseFloat(sec) || 0) * 10) / 10;
  var mm = Math.floor(s / 60), ss = s - mm * 60;
  return mm + ':' + (ss < 10 ? '0' : '') + ss.toFixed(1);
}
/* 着差(m)を競馬表記へ（ハナ/クビ/半馬身/馬身） */
function simMarginText(m){
  if (m == null || m <= 0.05) return '';
  if (m < 0.3) return 'ハナ';
  if (m < 0.7) return 'クビ';
  var bod = m / 2.4;
  var half = Math.round(bod * 2) / 2;
  if (half <= 0.5) return '半馬身';
  var whole = Math.floor(half), remH = half - whole;
  return whole + '馬身' + (remH > 0 ? '半' : '');
}
/* 道中の隊列記録(sim._log)から「レース展開」の文章を組み立てる */
function simExpHTML(parts, order, D){
  var STAGES = { 0.12:'序盤', 0.35:'向正面', 0.6:'3コーナー', 0.8:'4コーナー', 0.94:'直線残り少なく' };
  var html = '<div style="margin-bottom:4px;font-weight:800">🏇 この1走の道中（残り距離ごとの隊列）</div>';
  var logs = (sim && sim._log || []).slice().sort(function(a, b){ return a.g - b.g; });
  logs.forEach(function(L){
    var lab = L.lab || STAGES[L.g] || ('残り' + (L.rem || 0) + 'm');
    var names = L.top.slice(0, 4).map(function(ii, k){
      var p = parts[ii]; var rl = (k === 0 ? '先頭' : (k === 1 ? '2番手' : (k === 2 ? '3番手' : '4番手')));
      return '<span style="white-space:nowrap">' + frameChipHTML(p.frame, esc(p.no)) + ' ' + esc(p.name || '') + '</span>';
    });
    html += '<div style="margin:2px 0">・<b>' + lab + '</b>（残り約' + (L.rem || 0) + 'm）— ' + names.join(' / ') + '</div>';
  });
  var w = parts[order[0]], s2 = parts[order[1]], s3 = parts[order[2]];
  var winT = (sim._finT && sim._finT[order[0]]) ? simTimeFmt(sim._finT[order[0]]) : '';
  var d2 = simMarginText((sim._finT && sim._finT[order[1]] != null && sim._finT[order[0]] != null) ? (sim._finT[order[1]] - sim._finT[order[0]]) * sim._vw : 0);
  var d3 = simMarginText((sim._finT && sim._finT[order[2]] != null && sim._finT[order[0]] != null) ? (sim._finT[order[2]] - sim._finT[order[0]]) * sim._vw : 0);
  // 脚質的な結末の説明
  var flow = '追い込み・差しが届く形';
  if (logs.length){
    var first = logs[0], last = logs[logs.length - 1];
    var ledAll = logs.every(function(L){ return L.top[0] === order[0]; });
    if (ledAll) flow = '先頭を譲らない逃げ切り';
    else if (first.top.indexOf(order[0]) >= 0 && first.top.indexOf(order[0]) <= 1) flow = '好位から抜け出す形';
    else if (last.top.indexOf(order[0]) <= 1) flow = '中団から直線で浮上する形';
  }
  html += '<hr style="border:none;border-top:1px dashed var(--line2);margin:10px 0 8px">' +
    '<div><b>決着</b>：<span style="color:var(--err-ink);font-weight:900">' + esc(w.no) + ' ' + esc(w.name) + '</span>（' + winT + (d2 ? '、' + s2.no + '着差' + d2 : '') + (d3 ? '・' + s3.no + '着差' + d3 : '') + '）— ' + flow + '</div>' +
    '<div style="margin-top:6px;color:var(--mut)">※ この「結果想定」は1回のシミュレーション例です。複数回の傾向は下の「📊 シミュレーション合計集計」に積み上がります。</div>';
  return html;
}

/* ===== 映像なし「結果だけ」即時シミュレーション ===== */
/* 1回分のサンプリング（映像用のプラン・ログは必要時のみ作る） */
function simInstantOnce(withLogs){
  var parts = getParticipants();
  if (!parts) return null;
  var D = parseFloat(readRaceMeta().dist) || 2000;
  var F = simSampleFinish(parts, D);
  var n = parts.length;
  sim._finT = F.finT.slice();
  sim._mar = F.mar.slice();
  sim._vw = F.vw;
  sim._mmax = F.mmax;
  if (withLogs !== false){
    var paceAdj = (typeof simPaceAdjOf === 'function') ? simPaceAdjOf() : {};
    var PLAN = new Array(n);
    for (var i = 0; i < n; i++){
      PLAN[i] = simBuildPlan(simFlowStyleFor(parts[i]), F.finT[i] || 1, paceAdj);
    }
    sim._plan = PLAN;
    sim._log = simBuildLogs(parts, F, D, PLAN);
  }
  return { parts: parts, D: D, F: F, order: F.order.slice() };
}
/* 映像を描かずに、道中の隊列ログをプランの位置から合成する */
function simBuildLogs(parts, F, D, PLAN){
  var logs = [];
  var n = parts.length;
  var leaderF = F.finT[F.order[0]] || 1;
  var sRem = simFinalStartRem(D);
  var tS = Math.max(0, (1 - sRem / D)) * leaderF;
  function distAt(t){
    return PLAN.map(function(pl){ return Math.min(D, Math.max(0, simPlanU(pl, t) * D)); });
  }
  function snap(t, rem, lab){
    var dists = distAt(t);
    var top = dists.map(function(v, i){ return i; }).sort(function(a, b){ return dists[b] - dists[a]; });
    logs.push({ g: (logs.length === 0 ? 0 : (1000 + (1000 - rem))), lab: lab, rem: Math.max(0, Math.round(rem)), top: top });
  }
  snap(tS, sRem, '4コーナー（想定隊列）');
  [300, 200, 100, 50].forEach(function(rem){
    if (rem >= sRem) return;
    var lo = tS, hi = leaderF, t = tS;
    for (var k = 0; k < 14; k++){
      t = (lo + hi) / 2;
      var d = distAt(t), dmax = 0;
      for (var i = 0; i < n; i++) dmax = Math.max(dmax, d[i]);
      if (D - dmax > rem) lo = t; else hi = t;
    }
    snap((lo + hi) / 2, rem, (rem <= 50 ? 'ゴール前' : ('残り' + rem + 'm')));
  });
  return logs;
}
/* 結果（着順表・展開・印）を画面へ描く。映像なしでもそのまま使う */
function simRenderOutcome(parts, order, D){
  var meta = readRaceMeta();
  var fm = $('finMeta');
  if (fm) fm.innerHTML = esc((meta && meta.name) || 'レース') +
    ((meta && meta.place) ? ('　' + esc(String(meta.place).split(/[\s　]/)[0])) : '') +
    ((meta && meta.dist) ? ('　' + esc(meta.dist) + 'm') : '') +
    ((meta && meta.grade) ? ('　' + esc(meta.grade)) : '') +
    '<span style="margin-left:10px">この1走行の再現（ランダム要素を含む）</span>';
  var vw = sim._vw || 16.5;
  var html = '';
  var res = (typeof currentAnalysis === 'function') ? currentAnalysis() : { rows: [] };
  var mrow = {}; (res.rows || []).forEach(function(r){ mrow[r.idx] = r; });
  order.forEach(function(pi, rank){
    var p = parts[pi]; if (!p) return;
    var finS = (sim._finT && sim._finT[pi] != null) ? sim._finT[pi] : null;
    var gapM = (rank > 0 && finS != null && sim._finT[order[0]] != null) ? (finS - sim._finT[order[0]]) * vw : 0;
    var tCell = (rank === 0 && finS != null) ? '<b>' + simTimeFmt(finS) + '</b>' : (finS != null ? simTimeFmt(finS) : '');
    var odds = p.odds ? String(p.odds).replace(/[^\d.,]/g, '') : '';
    var r = mrow[p.idx] || {};
    html += '<tr><td><b>' + (rank + 1) + '</b></td><td>' + esc(p.no) + '</td>' +
      '<td style="text-align:left;font-weight:700">' + esc(p.name) + '</td>' +
      '<td>' + tCell + '</td>' +
      '<td>' + (rank === 0 ? '—' : simMarginText(gapM)) + '</td>' +
      '<td style="text-align:right">' + (odds ? esc(odds) : '—') + '</td>' +
      '<td style="text-align:right">' + pct(r.prob != null ? r.prob : p.prob) + '%</td></tr>';
  });
  var fb = $('finBody'); if (fb) fb.innerHTML = html;
  var sW = $('simResultWrap'); if (sW) sW.classList.remove('hid');
  var sE = $('simResultEmpty'); if (sE) sE.classList.add('hid');
  var sx = $('simExp'); if (sx) sx.innerHTML = simExpHTML(parts, order, D);
}
/* N回まとめて実行（合計集計にも自動で積み上がる） */
function simRunInstant(times){
  var parts = getParticipants();
  if (!parts){ buildSimPanel(); return; }
  times = Math.max(1, Math.min(500, parseInt(times, 10) || 1));
  var D = parseFloat(readRaceMeta().dist) || 2000;
  var meta = readRaceMeta();
  var key = [meta.name, meta.dist, parts.length, parts[0] && parts[0].name].join('|');
  if (sim._rsKey !== key){ sim._rsKey = key; sim._rs = null; }
  if (!sim._rs){
    sim._rs = { runs: 0, first: {}, top3: {}, sumPos: {}, best: {} };
  }
  var last = null, orders = [];
  for (var k = 0; k < times; k++){
    var one = simInstantOnce(k === times - 1);   // 道中ログは最後の1回だけ作る
    if (!one) return;
    last = one;
    orders.push(one.order);
    sim._rs.runs++;
    one.order.forEach(function(pi, rank){
      sim._rs.sumPos[pi] = (sim._rs.sumPos[pi] || 0) + (rank + 1);
      if (rank === 0) sim._rs.first[pi] = (sim._rs.first[pi] || 0) + 1;
      if (rank <= 2) sim._rs.top3[pi] = (sim._rs.top3[pi] || 0) + 1;
    });
  }
  sim._log = sim._log || [];
  simRenderOutcome(last.parts, last.order, last.D);
  simRenderRunState(last.parts);
  var agg = null, aggErr = '';                      // 📊 合計集計に積み上げ（実行した回数ぶん全部）
  try { orders.forEach(function(o){ agg = simAggAdd(parts, o); }); }
  catch(e){ aggErr = String((e && e.message) || e); }
  try { simAggRender(); } catch(e){ if (!aggErr) aggErr = String((e && e.message) || e); }
  var sx = $('simMsg');
  if (sx){
    sx.innerHTML = '⚡ ' + times + '回の結果を出しました。最後の1走を着順表・展開に表示しています。1着: ' +
      esc(last.parts[last.order[0]].no) + ' ' + esc(last.parts[last.order[0]].name) +
      '（📊 合計集計: 累計 <b>' + ((agg && agg.runs) || 0) + '</b>回）' +
      (aggErr ? '<br><span style="color:var(--bad-ink,#c00)">⚠️ 集計でエラー: ' + esc(aggErr) + '</span>' : '') +
      '<br><span class="small muted">📊 合計集計は<b>③のタブを開いている間だけ</b>のメモリ集計です（端末の保存領域は使いません）。' +
      '別のタブに移るとリセットされ、③に戻ると新しい集計から始まります。</span>';
  }
  saveNow();
}
/* 連続実行の累計を表示 */
function simRenderRunState(parts){
  var el = $('simRunState'); if (!el || !sim._rs) return;
  parts = parts || getParticipants() || [];
  var rs = sim._rs;
  var best = -1, bestN = -1;
  parts.forEach(function(p, i){
    var c = rs.first[i] || 0;
    if (c > bestN){ bestN = c; best = i; }
  });
  var lines = [];
  lines.push('<b>このレースの実行累計: ' + rs.runs + '回</b>（📊 合計集計は下の表をご覧ください）');
  if (best >= 0 && bestN > 0){
    lines.push('最多1着: <b>' + esc(parts[best].no) + ' ' + esc(parts[best].name) + '</b>（' + bestN + '回 / ' + pct(bestN / rs.runs) + '%）');
  }
  lines.push(['<button type="button" class="btn ghost" id="simResetRuns" style="font-size:.74rem;padding:2px 9px">累計をリセット</button>'].join(''));
  el.innerHTML = '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' + lines.join('<span class="muted">｜</span>') + '</div>';
}
function simRunsCount(){
  var el = $('simRuns');
  var v = el ? parseInt(el.value, 10) : 10;
  return (v >= 1 && v <= 500) ? v : 10;
}

/* ===== 脚質の安定度（馬柱の過去戦績から） =====
   過去レースの4角通過順 → 脚質（逃げ/先行/差し/追込）を復元し、
   バラつきが大きい馬は「毎回ちがう脚質で走る」ものとしてシミュレーションに反映する。 */
var SIM_SV_CACHE = {};
function simStyleHistOf(p){
  if (!p) return null;
  var h = null;
  try { h = (state.horses || [])[p.idx] || null; } catch(e){}
  if (!h || !h.nk || typeof tlStyleHist !== 'function') return null;
  if (SIM_SV_CACHE[h.nk] !== undefined) return SIM_SV_CACHE[h.nk];
  var r = null;
  try { r = tlStyleHist(h); } catch(e){ r = null; }
  SIM_SV_CACHE[h.nk] = r;
  return r;
}
function simStyleVarOf(p){
  var r = simStyleHistOf(p);
  return (r && r.n >= 3) ? r : null;
}
/* 脚質が安定しない馬かどうか（判定は p47 の tlStyleUnstable に集約） */
function simUnstable(sv){
  if (!sv) return false;
  if (typeof tlStyleUnstable === 'function') return tlStyleUnstable(sv);
  return !!(sv.n >= 3 && sv.sd >= 0.22);
}
/* その馬の今回の脚質（ブレる馬は過去に出した脚質から抽選） */
function simFlowStyleFor(p){
  var sv = simStyleVarOf(p);
  if (simUnstable(sv) && sv.styles && sv.styles.length){
    return sv.styles[Math.floor(Math.random() * sv.styles.length)];   // 過去に出した脚質から抽選
  }
  return simFlowStyle(p && p.style);
}
function simStyleNote(){
  var parts = getParticipants() || [];
  var out = [];
  parts.forEach(function(p){
    var sv = simStyleVarOf(p);
    if (simUnstable(sv)) out.push({ p: p, sv: sv });
  });
  if (!out.length) return '';
  return '　⚠️ <b>脚質が安定しない馬 ' + out.length + '頭</b>（過去戦績の4角通過順から判定・毎回ちがう脚質で走るとして振れ幅を大きくしています）: ' +
    out.slice(0, 6).map(function(x){
      return esc(x.p.no) + ' ' + esc(x.p.name) + '（4角 ' + x.sv.styles.join('→') + '・バラつき±' + Math.round(x.sv.sd * 100) + '%）';
    }).join(' / ') + (out.length > 6 ? ' ほか' + (out.length - 6) + '頭' : '');
}

/* ===== シミュレーションの合計集計（③のタブを開いている間だけ＝メモリのみ。端末の保存領域は使いません） ===== */
var SIMAGG_LS = 'khl_simagg_v1';   // 旧バージョンが使っていたキー（起動時に消して空きを作る → simAggDropOld）
/* 2026-09-11 第11弾: 端末の保存領域(localStorage)がいっぱいだと setItem が黙って失敗し、simAggCur() が
   読み直したときに null → 着順表は出るのに📊合計集計が「まだ集計がありません」のまま、になっていた。
   2026-09-11 第12弾: ご指定どおり「③のタブを開いている間だけ集計を保持し、別のタブに移ったら全部消して、
   また新しく集計し直す」方式に変更した。
   → localStorage には一切書かないので、端末の保存領域(目安5MB)を圧迫しません。
   → あわせて 学習DB・AI予想の学習データを第一優先で保存するようにした（safeSetItem / storeMakeRoom）。 */
var SIMAGG_MEM = null;
var SIMAGG_SAVE_OK = true;      // メモリ保持なので常に true（描画コードとの互換のため残している）
var SIMAGG_SAVE_ERR = '';
var SIMAGG_LIVE = false;        // ③のタブを開いている間だけ true
function simAggLs(){
  if (!SIMAGG_MEM) SIMAGG_MEM = {};
  return SIMAGG_MEM;            // メモリだけを見る（localStorage は読まない）
}
function simAggSave(o){
  if (o) SIMAGG_MEM = o;
  if (!SIMAGG_MEM) SIMAGG_MEM = {};
  SIMAGG_SAVE_OK = true; SIMAGG_SAVE_ERR = '';
  return true;                  // メモリにしか書かないので失敗しない
}
/* ③のタブを開いた／離れたときの扱い */
function simAggEnter(){ SIMAGG_LIVE = true; }
function simAggDropAll(){
  var n = 0; try { n = Object.keys(simAggLs()).length; } catch(e){}
  SIMAGG_MEM = {}; SIMAGG_LIVE = false;
  return n;                     // 消したレース数（goTab が案内に使う）
}
var SIMAGG_DROPPED = 0;         // ③を離れて消したレース数（③に戻ったときの案内に使う）
/* ③に戻ったとき「前の集計はリセットしました」と知らせる */
function simAggNoteDropped(){
  if (!SIMAGG_DROPPED) return;
  var n = SIMAGG_DROPPED; SIMAGG_DROPPED = 0;
  var sx = $('simMsg');
  if (sx) sx.innerHTML = '🔄 別のタブに移ったので、前の<b>合計集計（' + n + ' レースぶん）はリセット</b>しました。' +
    'ここから新しい集計を始めます（③のタブを開いている間だけ保持します）。';
}
/* 旧バージョンが localStorage に残した集計を消して、端末の保存領域を空ける */
function simAggDropOld(){
  try {
    var v = localStorage.getItem(SIMAGG_LS);
    if (v != null){ localStorage.removeItem(SIMAGG_LS); return (SIMAGG_LS.length + v.length) * 2; }
  } catch(e){}
  return 0;
}
/* 端末の保存領域の使用量（診断用） */
function storeUse(){
  var tot = 0, keys = [];
  try {
    for (var i = 0; i < localStorage.length; i++){
      var k = localStorage.key(i); if (k == null) continue;
      var v = ''; try { v = localStorage.getItem(k) || ''; } catch(e){}
      var n = (k.length + v.length) * 2;      // JS文字列はUTF-16＝2byte/字
      tot += n; keys.push({ k: k, n: n });
    }
  } catch(e){}
  keys.sort(function(a, b){ return b.n - a.n; });
  return { bytes: tot, mb: tot / 1048576, keys: keys };
}
function storeText(){
  var u = storeUse();
  var lim = 5;                                   // 多くのブラウザの目安（5MB）
  var pctv = Math.min(999, Math.round(u.mb / lim * 100));
  return '💾 端末の保存領域: <b>' + u.mb.toFixed(2) + 'MB</b>／目安 ' + lim + 'MB（' + pctv + '%）' +
    (u.mb >= lim * 0.9 ? ' <span style="color:var(--bad-ink,#c00)"><b>⚠️ いっぱいです</b></span>' : '') +
    (u.keys.length ? '　多い順: ' + u.keys.slice(0, 4).map(function(x){ return x.k + '(' + (x.n / 1048576).toFixed(2) + 'MB)'; }).join(' / ') : '');
}
function simAggKey(parts){
  var meta = {};
  try { meta = readRaceMeta() || {}; } catch(e){}
  var rid = '';
  try { rid = String(state.raceId || ''); } catch(e){}
  var sig = [meta.name || '', meta.dist || '', (parts || []).map(function(p){ return p.no + ':' + p.name; }).join(',')].join('|');
  return rid || sig;
}
function simAggAdd(parts, order){
  if (!parts || !order) return null;
  var ls = simAggLs();
  var k = simAggKey(parts);
  var meta = {};
  try { meta = readRaceMeta() || {}; } catch(e){}
  var a = ls[k] || (ls[k] = { key: k, name: '', dist: '', runs: 0, at: '', horses: {} });
  a.name = meta.name || a.name || '';
  a.dist = meta.dist || a.dist || '';
  a.runs = (a.runs || 0) + 1;
  a.at = new Date().toISOString();
  order.forEach(function(pi, rank){
    var p = parts[pi]; if (!p) return;
    var id = p.no + ':' + p.name;
    var h = a.horses[id] || (a.horses[id] = { no: p.no, name: p.name, runs: 0, w: 0, t2: 0, t3: 0, sum: 0, best: 99, worst: 0, odds: '', prob: 0, slow: '', sv: null });
    h.runs++; h.sum += (rank + 1);
    if (rank === 0) h.w++;
    if (rank <= 1) h.t2++;
    if (rank <= 2) h.t3++;
    h.best = Math.min(h.best, rank + 1);
    h.worst = Math.max(h.worst, rank + 1);
    h.odds = p.odds || h.odds; h.prob = p.prob;
    try {
      var hh = (state.horses || [])[p.idx] || {};
      h.slow = hh.slow || h.slow;
    } catch(e){}
    var sv = null;
    try { sv = simStyleVarOf(p); } catch(e){ sv = null; }
    h.sv = sv ? { sd: sv.sd, n: sv.n, dom: sv.dom, styles: sv.styles, bad: simUnstable(sv) } : h.sv;
  });
  ls[k] = a;
  simAggSave(ls);
  return a;
}
function simAggCur(){
  var parts = getParticipants();
  if (!parts) return null;
  var ls = simAggLs();
  return ls[simAggKey(parts)] || null;
}
function simAggRender(){
  var box = $('simAggBody');
  var sum = $('simAggSummary');
  var a = simAggCur();
  if (sum) sum.innerHTML = '';
  if (!box) return;
  if (!a || !a.runs){
    box.innerHTML = '<tr><td colspan="11" class="muted">まだ集計がありません。「⚡ 結果を出す」や「⏩ まとめて実行」を押すと、' +
      'その結果がこのレースの<b>合計集計</b>に積み上がります。' +
      '<br><span class="small">📊 合計集計は<b>③のタブを開いている間だけ</b>のメモリ集計です（端末の保存領域は使いません）。' +
      '別のタブに移るとリセットされ、③に戻ると新しい集計から始まります。</span></td></tr>';
    return;
  }
  var rows = Object.keys(a.horses).map(function(k){ return a.horses[k]; });
  rows.sort(function(x, y){
    return (y.w / y.runs) - (x.w / x.runs) || (y.t3 / y.runs) - (x.t3 / x.runs) ||
      (x.sum / x.runs) - (y.sum / y.runs) || String(x.no).localeCompare(String(y.no));
  });
  var html = rows.map(function(h){
    var r1 = h.w / h.runs, r2 = h.t2 / h.runs, r3 = h.t3 / h.runs, avg = h.sum / h.runs;
    var slow = slowPctOf(h.slow);
    var sv = (h.sv && (h.sv.bad || (h.sv.sd != null && h.sv.sd >= 0.22))) ? h.sv : null;
    return '<tr' + (r1 >= 0.2 ? ' class="leadcol"' : '') + '>' +
      '<td>' + esc(h.no) + '</td><td style="text-align:left;font-weight:700">' + esc(h.name) + '</td>' +
      '<td style="text-align:right">' + (h.odds ? esc(String(h.odds)) : '−') + '</td>' +
      '<td style="text-align:right">' + pct(h.prob) + '%</td>' +
      '<td>' + h.runs + '</td>' +
      '<td><b>' + h.w + '</b><br><span class="muted">' + pct(r1) + '%</span></td>' +
      '<td>' + h.t2 + '<br><span class="muted">' + pct(r2) + '%</span></td>' +
      '<td>' + h.t3 + '<br><span class="muted">' + pct(r3) + '%</span></td>' +
      '<td>' + avg.toFixed(1) + '<br><span class="muted">' + h.best + '〜' + h.worst + '着</span></td>' +
      '<td>' + (slow > 0 ? '<span class="tlchip slow">' + slow + '%</span>' : '<span class="muted">−</span>') + '</td>' +
      '<td style="text-align:left">' + (sv
        ? '<span class="tlchip slow" title="直近' + esc(String(sv.n || 0)) + '走の4角: ' + esc((sv.styles || []).join('→')) + '">±' + Math.round((sv.sd || 0) * 100) + '%</span>'
        : (h.sv ? '<span class="muted" title="直近' + esc(String(h.sv.n || 0)) + '走の4角: ' + esc((h.sv.styles || []).join('→')) + '">安定</span>' : '<span class="muted">−</span>')) + '</td>' +
      '</tr>';
  }).join('');
  box.innerHTML = html;
  if (sum){
    var top = rows[0];
    sum.innerHTML = '<div class="small">📊 <b>' + esc(a.name || 'このレース') + '</b>' + (a.dist ? '（' + esc(String(a.dist)) + 'm）' : '') +
      '　累計 <b>' + a.runs + '</b> 回　｜　最多1着: <b>' + esc(top.no + ' ' + top.name) + '</b>（' + top.w + '回 / ' + pct(top.w / top.runs) + '%）' +
      '　<span class="muted">更新 ' + esc(String(a.at || '').slice(0, 16).replace('T', ' ')) + '</span>' +
      '　<span class="muted small">（③のタブを開いている間だけの集計）</span></div>';
  }
}
/* 集計の実削除（確認なし） */
function simAggClear(){
  var parts = getParticipants();
  var ls = simAggLs();
  var k = simAggKey(parts || []);
  var had = ls[k] ? (ls[k].runs || 0) : 0;
  delete ls[k];
  simAggSave(ls);
  sim._rs = null; sim._rsKey = null;
  simAggRender();
  if (parts) simRenderRunState(parts);
  return had;
}
/* 集計リセットボタン（確認してから simAggClear） */
function simAggReset(){
  var a = simAggCur();
  var fn = function(){ simAggClear(); };
  if (typeof showConfirm === 'function'){
    showConfirm('このレースのシミュレーション合計集計（' + ((a && a.runs) || 0) + '回ぶん）をリセットしますか？', fn);
  } else fn();
}

/* ===== ③タブの説明文と初期化 ===== */
function simSetHint(){
  var el = $('simHint'); if (!el) return;
  var parts = getParticipants();
  var n = parts ? parts.length : 0;
  var slowN = 0;
  if (parts) parts.forEach(function(p){
    var sl = slowPctOf(p.slow);
    if (sl >= 6) slowN++;
  });
  el.innerHTML = '💡 出走馬 <b>' + n + '</b>頭を、AI印の勝率（全馬の和=100%）を実力差として1走ずつ再現します。' +
    '「⚡ 結果を出す」=1走、「⏩ まとめて」=選んだ回数だけ連続で走らせて、<b>下の「📊 合計集計」に積み上げ</b>ます。' +
    (slowN ? '　🐢 <b>出遅れ率6%以上の馬 ' + slowN + '頭</b>は、その確率でスタート不利（実力0.5〜1.0倍）になります。' : '') +
    simStyleNote();
}
function simRunPrimary(){ simRunInstant(1); }
function initSimTab(){
  var primary = function(){ simRunPrimary(); };
  on('btnRun', 'click', primary);
  on('btnRerun', 'click', primary);
  on('btnMulti', 'click', function(){ simRunInstant(simRunsCount()); });
  on('btnAggReset', 'click', function(){ simAggReset(); });
  // 累計リセット（動的に差し替わるので委譲で拾う）
  document.addEventListener('click', function(e){
    if (e.target && e.target.id === 'simResetRuns'){
      e.preventDefault();
      sim._rs = null; sim._rsKey = null;
      simRenderRunState();
    }
  });
  simSetHint();
  simAggRender();
}
