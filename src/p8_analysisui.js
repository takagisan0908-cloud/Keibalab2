/* =========================================================
   タブ②：展開予想・AI印UI（+重み設定）
   ========================================================= */
var WEIGHT_DEFS = [
  { k:'odds',  label:'📊 単勝オッズ(人気)',  hint:'実際の支持率を参考に' },
  { k:'yobi',  label:'🏇 調教タイム',        hint:'最終追い切り等の時計' },
  { k:'time',  label:'⏱ 持ちタイム',        hint:'実力の裏付け(同距離)' },
  { k:'tenkai',label:'🧭 展開・脚質',        hint:'ペース適性・ポジション' },
  { k:'baba',  label:'🏟 バ場好走率',        hint:'同開催場×同馬場(良/稍重/重/不良)での過去3着内率。馬柱データを取得すると自動で使えます' },
  { k:'yoso',  label:'🏔 洋芝・コース適性',  hint:'今回と同じコース種別(洋芝=札幌・函館/野芝=他場)・同じ距離±200mでの最速持ちタイムと最速上がり3Fを比較。洋芝開催では洋芝での持ちタイムが最重要材料。馬柱データが必要です' },
  { k:'waku',  label:'🎯 枠順(重賞のみ)',   hint:'⑥重賞データ分析で集めた【この重賞の過去10年】の歴代結果から、有利な枠順を判定して使います。頭数が違う年を混ぜても公平になるよう「その頭数での3着内期待確率」で補正し、有利度=実際の3着内数÷期待3着内数（1.00=平均）で評価します。重賞以外、または⑥の分析データが無いときは自動的に使われません（学習DBの場×距離統計は使いません）' },
  { k:'abl',   label:'📚 学習DBの過去実績',   hint:'学習DBに取り込んだ過去レースから、この馬の「レース前の成績」を作って評価します（過去戦の3着内率・上り3Fの相対順位・同距離の実績・騎手の勝率）。そのレースの日付より前の出走だけを使うので、結果を見てから予想するいかさまになりません。学習DBに過去戦が無い馬は評価しません' }
  /* ★2026-09-13 第21弾⑤: 「🧠 あなたの印」スライダーを削除しました。
     印の入力欄は①に残ります（メモ・買い目の照合・自己学習の記録用）が、AI印の計算には使いません。
     p5_engine の中で mark の重みを常に 0 にしています。 */
];

function currentAnalysis(){ return analyzeRace(); }

/* ★2026-09-13 第24弾④a: ⏱持ちタイム セルの表示ヘルパ
   以前は (1) 馬柱ベースのとき「時計(距離)」を出すが、距離が今回と大きく違っていても
   普通の見た目だった (2) 前走タイムベースのときは距離を一切出さず時計だけ でした。
   そのため「その馬が走っていないであろう距離のタイムが持ちタイムとして出る」ように見えました。
   ここでは どの距離の時計なのかを必ず表示し、今回距離±200m を外れていたら
   薄色＋「距離外」を付けて、そのまま比較できないことを分かるようにします。 */
function yoTimeCell(r, res){
  if (res && res.yosoTimeBased){
    var it = r.yosoHit;
    if (!it || it.sec == null) return '<span class="muted">−</span>';
    var txt = esc(yoFmt(it.sec));
    var d = parseInt(it.dist, 10) || 0;
    if (!d) return txt + '<span class="muted" style="font-size:.9em">(距離不明)</span>';
    var gap = (it.gapM != null) ? it.gapM : 0;
    if (it.bandOk) return txt + '<span class="muted" style="font-size:.9em">(' + d + 'm)</span>';
    return '<span class="muted">' + txt + '(' + d + 'm' + (gap ? (gap > 0 ? '・+' : '・') + gap + 'm' : '') + ' 距離外)</span>';
  }
  if (r.timeSec == null) return '−';
  var pd = parseInt((r.h && r.h.prevD) || 0, 10) || 0;
  var t = esc(fmtTime(r.timeSec));
  if (!pd) return t + '<span class="muted" style="font-size:.9em">(前走)</span>';
  var cd = 0;
  /* 今回距離は readRaceMeta()（①の入力欄）が正。空のときは yoCourse() と同じく
     state.race.dist へフォールバックします（片方だけ見て「距離外」判定を取りこぼさないため） */
  try { cd = parseInt(readRaceMeta().dist, 10) || 0; } catch(e){}
  if (!cd){ try { cd = parseInt(String((state.race && state.race.dist) || '').replace(/[^0-9]/g, ''), 10) || 0; } catch(e){} }
  var far = !!(cd && Math.abs(pd - cd) > 200);
  return (far ? '<span class="muted">' : '') + t + '<span class="muted" style="font-size:.9em">(' + pd + 'm・前走' +
    (far ? ' 距離外' : '') + ')</span>' + (far ? '</span>' : '');
}
function yoTimeCellTip(r, res){
  if (res && res.yosoTimeBased){
    var it = r.yosoHit;
    if (!it || it.sec == null) return '今回と同じコース種別(洋芝/野芝)での持ちタイムが見つかりません（馬柱データ未取得の可能性）';
    var base = '馬柱の戦績から、今回と同じコース種別(洋芝/野芝)で最も条件が近い走りの時計。';
    var tier = (it.tier === 1) ? '同じ競馬場' : (it.tier === 2) ? '同コース種別の他場・同距離帯' : (it.tier === 3) ? '同距離帯(コース種別は不問)' : '距離不問の参考値';
    var s = base + '出どころ: ' + tier + '／' + (it.dist || '?') + 'm・' + (it.venue || '?') + '・' + (it.date || '?') + '（' + (it.n || 0) + '走から選定）';
    if (it.bandOk) return s + '。今回距離±' + 200 + 'm に入っているのでそのまま比較できます';
    return s + '。⚠ 今回距離と ' + (it.gapM != null ? Math.abs(it.gapM) + 'm' : '大きく') + ' 違うため、時計の単純比較はできません（参考表示）';
  }
  var pd = parseInt((r.h && r.h.prevD) || 0, 10) || 0;
  if (!pd) return '前走タイム（距離が特定できていないため参考値）';
  return '前走 ' + pd + 'm のタイム' + (r.h && r.h.timeSrc ? '（出どころ: ' + r.h.timeSrc + '）' : '');
}
/* 🏔 洋芝・コース適性セルの表示ヘルパ */
function yosoSub(r, res){
  var it = r.yosoHit;
  if (!it) return '';
  var lbl = (it.tier === 1) ? '同場' : (it.tier === 2) ? '同種別' : '未経験';
  var t = lbl;
  if (it.l3 != null) t += (t ? '・' : '') + '上' + it.l3.toFixed(1);
  return t;
}
function yosoTip(r, res){
  var it = r.yosoHit;
  if (!it) return '馬柱データ(競馬場別の持ちタイム)が未取得です';
  if (it.sec == null && it.l3 == null) return '今回と同じコース種別(洋芝/野芝)・同距離での持ちタイムが見つかりません';
  if (it.tier <= 2){
    var lbl = (it.tier === 1 ? '今回と同じ競馬場' : '同コース種別(洋芝/野芝)の他場');
    return lbl + 'での最速持ちタイム ' + (it.sec != null ? yoFmt(it.sec) + '（' + (it.dist || '') + 'm・' + (it.venue || '') + '）' : '−') +
      (it.l3 != null ? ' ／ 最速上がり3F ' + it.l3.toFixed(1) : '') + '（' + (it.n || 0) + '走から）';
  }
  return '今回のコース種別(洋芝/野芝)での出走が無く未証明のため控えめ評価。参考値: ' +
    (it.sec != null ? yoFmt(it.sec) + '（' + (it.dist || '') + 'm・' + (it.venue || '') + '／' + (it.tier === 3 ? '同距離' : '距離不問') + '）' : '−');
}
/* ★2026-09-13 第24弾①: 🎯枠順ファクター の表示ヘルパ
   列を増やすと表が横に広がるので、既存の「枠色」セルに小さな有利度マークを添えます。
   ▲=有利(1.18倍以上) / ▼=不利(0.82倍以下) / 無印=平均的。数字は 有利度(倍) です。 */
function wakuCell(r, res){
  if (!res || !res.wakuStat || !r.wakuHit || r.wakuHit.ratio == null) return '';
  if (!(r.wakuHit.n >= 8)) return '';
  var j = r.wakuHit.judge;
  if (!j) return '<span class="muted" style="font-size:.85em;margin-left:2px">' + r.wakuHit.ratio.toFixed(2) + '</span>';
  var col = j > 0 ? 'var(--ok-ink)' : 'var(--err-ink)';
  return '<b style="font-size:.85em;margin-left:2px;color:' + col + '">' + (j > 0 ? '▲' : '▼') + r.wakuHit.ratio.toFixed(2) + '</b>';
}
function wakuCellTip(r, res){
  var base = (r.h && r.h.frame ? (r.h.frame + '枠') : '枠');
  if (!res || !res.wakuStat) return base + '（枠順ファクターは今回使っていません。重賞で⑥の過去10年データがあるときだけ有効）';
  var g = r.wakuHit;
  if (!g || g.ratio == null || !(g.n >= 8)) return base + '（この枠は過去10年の出走数が少なく判定できません）';
  var lbl = g.judge > 0 ? '有利' : (g.judge < 0 ? '不利' : '平均的');
  return base + 'の過去10年成績（この重賞）: ' + g.n + '走 / 1着 ' + g.w + ' / 3着内 ' + g.t3 +
    '（3着内率 ' + g.pct3.toFixed(1) + '%・勝率 ' + g.pctW.toFixed(1) + '%）\n' +
    '有利度 ' + g.ratio.toFixed(2) + '倍 ＝ ' + lbl + '（1.00=平均。頭数補正済み: 実際の3着内数÷その頭数での期待3着内数）\n' +
    (typeof wakuSummaryText === 'function' ? '全体: ' + wakuSummaryText(res.wakuStat) : '');
}
function pct(p){ return (p*100).toFixed(1); }
function probBar(p){ var w = Math.max(1, Math.round(p*100)); return '<div class="barbg"><i style="width:' + w + '%;background:linear-gradient(90deg,#39a96d,#0e5e39)"></i></div>'; }
function ktMinibar(w, grad){ return '<span class="kb"><i style="width:' + Math.max(2, Math.min(100, w)) + '%;background:' + grad + '"></i></span>'; }
function ktOdds(o){ return (o && o > 1) ? esc(o) : '−'; }

var PACE_MODES = [
  { v: null, label: '自動(AI推定)', hint: '出走馬の脚質構成・オッズ・馬場・距離から自動推定' },
  { v: 0.20, label: 'スロー', hint: '淡々と流れ前残り想定' },
  { v: 0.50, label: '平均', hint: '平均ペース想定' },
  { v: 0.75, label: 'ハイ', hint: '前が潰れて差し・追込有利想定' },
  { v: 0.92, label: '超ハイ', hint: '超ハイペースで追込一発想定' }
];
function paceCur(){
  try { var v = state.paceOverride; return (v != null && isFinite(v)) ? +v : null; } catch(e){ return null; }
}
function renderPaceModes(){
  var box = $('paceModes'); if (!box) return;
  var cur = paceCur();
  box.innerHTML = PACE_MODES.map(function(m){
    var on = (m.v == null) ? (cur == null) : (cur != null && Math.abs(cur - m.v) < 0.001);
    var st = 'border:1px solid ' + (on ? '#0e5e39' : '#b9c3b2') + ';background:' + (on ? '#0e5e39' : '#fff') + ';color:' + (on ? '#fff' : '#3a4a3e') + ';border-radius:14px;padding:3px 9px;font-size:.78rem;cursor:pointer';
    return '<button type="button" data-pm="' + (m.v == null ? 'auto' : m.v) + '" style="' + st + '" title="' + esc(m.hint) + '">' + esc(m.label) + '</button>';
  }).join('');
}
function setPaceMode(v){
  if (v === 'auto' || v == null){ state.paceOverride = null; }
  else {
    var n = parseFloat(v);
    state.paceOverride = isFinite(n) ? clamp(n, 0.04, 0.96) : null;
  }
  saveNow();
  renderKentaiFull();
}

function renderPaceUI(pace){
  renderPaceModes();
  var t = $('paceTop'); if (t) t.innerHTML =
    '<div class="pacebig">' + esc(pace.label) + (pace.manual ? ' <span style="font-size:.62em;color:var(--warn-ink);font-weight:600">（手動想定）</span>' : '') + '</div>' +
    '<div class="pacesub">' + esc(pace.sub) + '</div>';
  var a = $('paceArrow'); if (a) a.style.left = clamp(pace.score*100, 2, 98) + '%';
  var d = $('paceDetail'); if (d) d.innerHTML =
    '<div class="slist">' +
    '逃げ <b>' + pace.nE + '</b>頭 / 先行 <b>' + pace.nS + '</b>頭 / 差し <b>' + pace.nK + '</b>頭 / 追込 <b>' + pace.nC + '</b>頭' +
    '　（先行意欲の高い馬の実力指数: ' + (pace.frontStrength*100).toFixed(0) + ' / 100）<br>' +
    (pace.dist ? '距離 ' + pace.dist + 'm ・ ' : '') +
    (pace.baba ? '馬場: ' + ({fast:'良',good:'稍重',yield:'重',soft:'不良',dirt_fast:'ダート良',dirt_seal:'ダート重'}[pace.baba]||pace.baba) + ' ・ ' : '') +
    '前に行きたい馬: ' + pace.nF + '頭 / 後方待機: ' + pace.nB + '頭</div>' +
    (pace.adjust && pace.adjust.length ? '<div class="small muted" style="margin-top:4px">📐 ペース補正の根拠: ' + pace.adjust.map(esc).join(' / ') + '</div>' : '');
  var sc = $('paceScenario'); if (sc) sc.innerHTML = pace.scenario + '<div style="margin-top:8px">📖 想定映像: ' + (pace.story||'') + '</div>';
  var f = $('favFlow'); if (f) f.innerHTML = esc(pace.fav);
}

function renderKentaiFull(){
  var has = state.horses.length > 0;
  $('kentaiEmpty').style.display = has ? 'none' : '';
  $('kentaiBody').classList.toggle('hid', !has);
  if (!has) return;
  buildWeightSliders();
  if (typeof renderBiasCard === 'function') renderBiasCard();
  if (typeof renderLearnCard === 'function') renderLearnCard();
  var res = currentAnalysis();
  renderPaceUI(res.pace);
  renderTables(res);
  if (typeof apRender === 'function'){ try { apRender(); } catch(e){} }
  if (typeof aihRender === 'function'){ try { aihRender(); } catch(e){} }
  /* ★2026-09-12 第17弾: ②を開くたびに「今のAI予想」を事前予想として保存しておく。
     結果が確定しているレースは apSnapPred 側で必ず断るので、いかさまにはなりません。
     同じ内容（馬番:印:オッズ が一致）なら書き直さないため、保存回数は増えません。 */
  try {
    if (typeof apSnapPred === 'function' && state && state.raceId){
      apSnapPred(String(state.raceId), res);
      if (typeof preRenderCount === 'function') preRenderCount();
    }
  } catch(e){}
}
function renderTables(res){
  // 入力状況
  var nO = state.horses.filter(function(h){ return num(h.odds) != null; }).length;
  var nY = state.horses.filter(function(h){ return evaluateLapStr(h.yobi).per != null; }).length;
  var nT = state.horses.filter(function(h){ return evaluateTimeStr(h.time) != null; }).length;
  var nS = state.horses.filter(function(h){ return styleClass(h.style); }).length;
  var nSl = state.horses.filter(function(h){ return slowPctOf(h.slow) > 0; }).length;
  var note = '入力状況: オッズ ' + nO + '頭 / 調教 ' + nY + '頭 / 持ちタイム ' + nT + '頭 / 脚質 ' + nS + '頭' + (nSl ? ' / 出遅れ率 ' + nSl + '頭' : '');
  var wN = $('wNote');
  if (wN) wN.innerHTML = '<div class="small muted">' + note + '</div>';
  /* ★2026-09-13 第21弾⑤: 重みの自動補正バーを描き直す。
     analyzeRace(res) の中で補正値を計算済みなので、ここでは描画だけ（二度計算しません）。
     renderKentaiFull は buildWeightSliders() → currentAnalysis() の順なので、
     ここで呼ばないと1回目表示が前のレースの補正値になります。 */
  try { if (typeof wtRender === 'function') wtRender(res); } catch(e){}
  if (!res.ok){ $('aiTbl').innerHTML = '<tr><td colspan="13">' + esc(res.msg) + '</td></tr>'; return; }

  var an = $('aiNote');
  if (an){
    var parts = [];
    if (res.biasAppliedNote) parts.push('<div style="background:var(--card2);border:1px solid var(--line2);border-radius:8px;padding:5px 9px;font-size:.82rem;color:var(--ok-ink);font-weight:600">' + res.biasAppliedNote + '</div>');
    if (res.learnAppliedNote) parts.push('<div style="background:var(--card2);border:1px solid var(--line2);border-radius:8px;padding:5px 9px;font-size:.82rem;color:var(--ok-ink);font-weight:600">' + res.learnAppliedNote + '</div>');
    if (res.slowAppliedNote) parts.push('<div style="background:var(--card2);border:1px solid var(--line2);border-radius:8px;padding:5px 9px;font-size:.82rem;color:var(--warn-ink);font-weight:600">' + esc(res.slowAppliedNote) + '</div>');
    if (res.paceManualNote) parts.push('<div style="background:var(--card2);border:1px solid var(--line2);border-radius:8px;padding:5px 9px;font-size:.82rem;color:var(--info-ink);font-weight:600">' + esc(res.paceManualNote) + '</div>');
    if (res.bfAppliedNote) parts.push('<div style="background:var(--card2);border:1px solid var(--line2);border-radius:8px;padding:5px 9px;font-size:.82rem;color:var(--info-ink);font-weight:600">' + res.bfAppliedNote + '</div>');
    if (res.babaAppliedNote) parts.push('<div style="background:' + (res.babaOn ? 'var(--card2)' : 'var(--card2)') + ';border:1px solid ' + (res.babaOn ? 'var(--line2)' : 'var(--line2)') + ';border-radius:8px;padding:5px 9px;font-size:.82rem;color:' + (res.babaOn ? 'var(--info-ink)' : 'var(--warn-ink)') + ';font-weight:600">' + res.babaAppliedNote + '</div>');
    /* ★2026-09-13 第25弾①: 展開短評（当日＋前日の確定結果から実測した「どんな展開になっているか」）
       ペース想定と実測馬場が食い違うときは、その警告をいちばん上に出します。 */
    if ((res.tenkaiComment && res.tenkaiComment.length) || res.tenkaiConflict){
      var tkH = '';
      if (res.tenkaiConflict) tkH += '<div style="background:var(--card2);border:1px solid var(--line2);border-radius:8px;padding:5px 9px;font-size:.82rem;color:var(--warn-ink);font-weight:600;margin-bottom:4px">' + esc(res.tenkaiConflict) + '</div>';
      var tkItems = (res.tenkaiComment || []).filter(function(x){ return x && x.k !== 'conflict'; });
      if (tkItems.length){
        var stt = res.tenkaiStat || {};
        tkH += '<div style="background:var(--card2);border:1px solid var(--line2);border-radius:8px;padding:5px 9px;font-size:.82rem">' +
          '<b style="color:var(--ok-ink)">🧭 展開短評</b>' +
          '<span class="muted">（当日＋前日の確定 ' + (stt.races || 0) + ' レース・馬券内 ' + (stt.top3 || 0) + ' 頭の実測' +
          (res.paceBiasW ? '／実測の信頼度 ' + Math.round(res.paceBiasW * 100) + '%でペース想定を上書き' : '') + '）</span>' +
          '<ul style="margin:3px 0 0;padding-left:18px;line-height:1.65">' +
          tkItems.map(function(x){ return '<li>' + esc(x.t) + '</li>'; }).join('') +
          '</ul></div>';
      }
      if (tkH) parts.push(tkH);
    }
    if (res.wakuAppliedNote) parts.push('<div style="background:var(--card2);border:1px solid var(--line2);border-radius:8px;padding:5px 9px;font-size:.82rem;color:' + (res.wakuOn ? 'var(--ok-ink)' : 'var(--muted)') + ';font-weight:600">' + res.wakuAppliedNote + '</div>');
    if (res.yosoAppliedNote) parts.push('<div style="background:' + (res.yosoOn ? 'var(--card2)' : 'var(--card2)') + ';border:1px solid ' + (res.yosoOn ? 'var(--line2)' : 'var(--line2)') + ';border-radius:8px;padding:5px 9px;font-size:.82rem;color:' + (res.yosoOn ? 'var(--ok-ink)' : 'var(--warn-ink)') + ';font-weight:600">' + res.yosoAppliedNote + '</div>');
    if (res.selfLearnNote) parts.push('<div style="background:var(--card2);border:1px solid var(--line2);border-radius:8px;padding:5px 9px;font-size:.82rem;color:var(--info-ink);font-weight:600">' + esc(res.selfLearnNote) + '</div>');
    if (res.note) parts.push('<div class="warnbox">' + esc(res.note) + '</div>');
    if (typeof hbKentaiNoteHTML === 'function'){
      var hbk = hbKentaiNoteHTML();
      if (hbk) parts.push(hbk);
    }
    an.innerHTML = parts.join('');
  }

  var tb = $('aiTbl'); if (!tb) return;
  var html = '';
  res.rows.forEach(function(r){
    var h = r.h;
    var fc = frameColor(h.frame);
    var mkName = styleLabel(h.style);
    var bH = (r.babaHit && r.babaHit.n > 0);
    var yH = (r.yosoHit && (r.yosoHit.sec != null || r.yosoHit.l3 != null) && res.yosoOn);
    var lapTxt = (r.ev && r.ev.laps && r.ev.laps.length) ? esc(fmtLap(r.ev)) : '';
    var nameFull = esc(h.name || '');
    var nameCell = '<span class="hname" title="' + nameFull.replace(/"/g, '&quot;') + '">' + nameFull +
      (typeof hbBadgeHTML === 'function' ? hbBadgeHTML(h) : '') +
      (typeof tlBadgeHTML === 'function' ? tlBadgeHTML(h) : '') + '</span>';
    html += '<tr' + (r.rank===1 ? ' class="leadcol"' : '') + '>' +
      '<td class="vm"><span class="mk0 ' + (r.markCls||'') + '">' + esc(r.mark||'') + '</span></td>' +
      '<td class="vm">' + r.rank + '</td>' +
      '<td class="vm" title="' + esc(wakuCellTip(r, res)) + '"><span class="fc" style="background:' + fc + '"></span>' + wakuCell(r, res) + '</td>' +
      '<td class="vm"><b>' + esc(h.no || '') + '</b></td>' +
      '<td class="vm" style="text-align:left">' + nameCell + '</td>' +
      '<td class="small vm">' + esc(h.odds || '−') + '</td>' +
      '<td class="vm"><b class="kt-p">' + pct(r.prob) + '%</b></td>' +
      '<td class="small vm" title="' + lapTxt + '">' + (r.ev && r.ev.per != null ? '<b>' + esc(r.ev.per) + '</b><span class="muted">s/F</span>' : '−') + '</td>' +
      '<td class="small vm" title="' + esc(yoTimeCellTip(r, res)) + '">' + yoTimeCell(r, res) + '</td>' +
      '<td class="vm" title="' + esc(mkName) + 'の展開適性">' + (mkName !== '−' ? '<span class="nowrap">' + mkName + '</span>' + ktMinibar(r.fK*100, 'linear-gradient(90deg,#f2c14e,#c78f1f)') : '−') + '</td>' +
      '<td class="small vm" title="同開催場×同馬場(良/稍重/重/不良)の過去3着内率（馬柱データから）">' + (bH ? '<b style="color:var(--info-ink)">' + r.babaHit.pct + '%</b>' + ktMinibar(r.babaHit.pct, 'linear-gradient(90deg,#8fc2e3,#14608a)') + '<span class="muted">' + r.babaHit.n + '走</span>' : '−') + '</td>' +
      '<td class="small vm" title="' + esc(yosoTip(r, res)) + '">' + (yH ? '<b style="color:var(--ok-ink)">' + (((r.fY2 || 0) * 100).toFixed(0)) + '%</b>' + ktMinibar((r.fY2 || 0) * 100, 'linear-gradient(90deg,#a8d5a2,#0d6a3c)') + '<span class="muted">' + esc(yosoSub(r, res)) + '</span>' : '−') + '</td>' +
      '<td class="scorecell vm">' + (r.U*100).toFixed(0) + '</td>' +
      '</tr>';
  });
  tb.innerHTML = html;

  /* ★2026-09-12 第18弾: 前日の馬場 → 当日のバイアス想定（学習DBから検出）を描き直す */
  try { if (typeof pbPaint === 'function') pbPaint(); } catch(e){}
  /* ★2026-09-12 第18弾: 今回のレースの「🎯軸に最適馬 / 💠妙味馬 / 🕳穴馬」を1頭ずつ出す */
  try {
    var pkBox = $('pkBox');
    if (pkBox && typeof pkHTML === 'function') pkBox.innerHTML = pkHTML(typeof pkPicks === 'function' ? pkPicks(res) : null);
  } catch(e){}
  // 買い目（予算を指定すると券種・金額を自動配分）
  var bb = $('buyBox'); if (bb){
    var mm = $('buyMoney'), md = $('buyMode');
    if (mm && mm.dataset.bound !== '1'){
      mm.dataset.bound = '1';
      mm.addEventListener('input', function(){ try { renderTables(currentAnalysis()); } catch(e){} });
    }
    if (md && md.dataset.bound !== '1'){
      md.dataset.bound = '1';
      md.addEventListener('change', function(){ try { renderTables(currentAnalysis()); } catch(e){} });
    }
    bb.innerHTML = betSheetHTML(res);
  }
  /* ★2026-09-12 第18弾: 買い目提案（詳細版）も同じ res で作り直す */
  try {
    if (typeof bpPlan === 'function' && typeof bpHTML === 'function'){
      var bpBox = $('bpBox');
      if (bpBox){
        var bpOpt = (typeof bpReadOpt === 'function') ? bpReadOpt() : {};
        var bpP = bpPlan(res, bpOpt);
        bpBox.innerHTML = bpHTML(bpP);
        try {
          if (typeof bpCache === 'object' && bpCache) { bpCache.sig = (typeof bpSig === 'function') ? bpSig(res, bpOpt) : ''; bpCache.plan = bpP; }
        } catch(e2){}
        /* 折り込んだままでも要点が読めるように文章で要約する（第15弾の🏇馬柱AI評価と同じやり方） */
        try {
          var bpPk = $('bpPick');
          if (bpPk){
            if (bpP && bpP.ok && bpP.bets.length){
              var b0 = bpP.bets[0];
              bpPk.innerHTML = '📈 <b>妙味重視の1番手</b>: ' + esc(b0.kindName + ' ' + b0.nos.join(b0.kind === 'umatan' || b0.kind === 'santan' ? '→' : '−')) +
                '（推定 ' + (b0.odds >= 100 ? Math.round(b0.odds) : b0.odds.toFixed(1)) + '倍・AI的中率 ' + (b0.pM * 100).toFixed(2) +
                '%・妙味 ' + b0.edge.toFixed(2) + '倍）に ' + b0.yen.toLocaleString('ja-JP') + '円 ／ 全 ' + bpP.bets.length + '点 ' +
                bpP.total.toLocaleString('ja-JP') + '円・期待回収率 <b>' + Math.round((bpP.evRate || 0) * 100) + '%</b>' +
                (bpP.useFloor ? '　⚠ 期待値プラスの買い目が無いので最小限の張り方' : '');
            } else {
              bpPk.innerHTML = '📈 <b>妙味重視の1番手</b>: ' + esc((bpP && bpP.warn) ? 'このレースは AI の評価が市場を上回れていません（張らないのが正解の可能性）' : 'オッズを入れると提案が出ます');
            }
          }
        } catch(e3){}
        var bpC = $('bpChip');
        if (bpC) bpC.textContent = (bpP && bpP.ok)
          ? (bpP.bets.length + '点・' + bpP.total.toLocaleString('ja-JP') + '円・期待回収率 ' + Math.round((bpP.evRate || 0) * 100) + '%')
          : '妙味なし';
      }
    }
  } catch(e){}
  // 各予想モデルの印（自己学習3モデルで現在のレースを評価）
  var mx = $('modelBox');
  if (mx){ if (typeof apModelMarksHTML === 'function'){ try { mx.innerHTML = apModelMarksHTML(); } catch(e){} } }
}

/* 買い目シート: 予算を指定すると券種ごとの金額を自動配分して返す
   2026-09-12 第15弾: 馬券は【100円単位】でしか買えないので、
   券種ごとの金額も「1点あたり100円の倍数」になるように割り当てます。
   （旧版は 400円÷3点＝133円 / 600円÷4点＝150円 のような10円単位の金額を出していました） */
function betSheetHTML(res){
  var rows = (res && res.rows) || [];
  if (rows.length < 2) return '<p class="muted small">馬を2頭以上登録すると買い目を提案します</p>';
  var moneyIn = 2000;
  try { var iv = parseInt($('buyMoney') && $('buyMoney').value, 10); if (iv && iv > 0 && iv <= 1000000) moneyIn = iv; } catch(e){}
  var mode = 'b';
  try { mode = ($('buyMode') && $('buyMode').value) || 'b'; } catch(e){}
  var frac = { k: [0.18, 0.36, 0.26, 0.20], b: [0.13, 0.23, 0.34, 0.30], a: [0.07, 0.15, 0.34, 0.44] }[mode] || [0.13, 0.23, 0.34, 0.30];

  var t1 = rows[0];
  var o1 = num(t1.h.odds), p1 = t1.prob;
  var names = {};
  rows.forEach(function(r){ names[r.h.no] = r.h.name || ''; });
  var opps = rows.slice(1, 5).map(function(r){ return r.h.no; });
  var top3no = rows.slice(0, 3).map(function(r){ return r.h.no; });
  var nP = Math.min(3, top3no.length);            // 複勝の点数
  var nU = opps.length;                           // 馬連(軸流し)の点数
  var nT = (top3no.length >= 3) ? 1 : 0;          // 3連複Boxは3頭いないと成立しない

  /* --- 予算を「100円玉」の枚数で扱う --- */
  var U = Math.floor(moneyIn / 100);
  var money = U * 100;
  if (U < 1) return '<p class="muted small">予算は100円以上（100円単位）で指定してください。馬券は100円単位でしか購入できません。</p>';
  // 1) 券種ごとに100円玉を配る（最大剰余法で端数も配り切る）
  var want = frac.map(function(f){ return U * f; });
  var u = want.map(function(v){ return Math.floor(v); });
  var rest = U - u.reduce(function(a, b){ return a + b; }, 0);
  if (rest > 0){
    want.map(function(v, i){ return { i: i, f: v - Math.floor(v) }; })
      .sort(function(a, b){ return (b.f - a.f) || (a.i - b.i); })
      .slice(0, rest)
      .forEach(function(o){ u[o.i]++; });
  }
  // 2) 点数で割り切れない券種は「1点100円の倍数」へ切り下げる（余りは単勝＝1点へ回す）
  if (nP > 0){ var pu = Math.floor(u[1] / nP); u[1] = pu * nP; } else { u[1] = 0; }
  if (nU > 0){ var mu = Math.floor(u[2] / nU); u[2] = mu * nU; } else { u[2] = 0; }
  if (!nT) u[3] = 0;
  u[0] += U - (u[0] + u[1] + u[2] + u[3]);
  var aS = u[0] * 100, aP = u[1] * 100, aU = u[2] * 100, aT = u[3] * 100;

  var ev1 = (o1 && o1 > 1 && p1 != null) ? (o1 * p1) : null;
  var out = [];
  function line(kind, set, pay, amt){
    if (!(amt > 0)) return;
    out.push('<div class="buyline"><span class="bett">' + kind + '</span><span class="set">' + set +
      '</span><span class="pay">' + pay + '</span><span class="amt">' + amt + '円</span></div>');
  }
  line('単勝', esc(t1.h.no + ' ' + (names[t1.h.no] || '')),
    (t1.h.odds ? esc(t1.h.odds) + '倍・' : 'オッズ未入力・') + '1点×' + aS + '円', aS);
  line('複勝', esc(top3no.slice(0, nP).join('・')),
    nP + '点×' + (aP / nP) + '円 の抑え', aP);
  line('馬連(軸)', esc(t1.h.no) + '−' + esc(opps.join('・')),
    nU + '点×' + (aU / nU) + '円 の流し', aU);
  line('3連複Box', esc(top3no.join('・')), 'AI上位3頭の1点×' + aT + '円', aT);
  out.push('<div class="small" style="margin-top:5px">合計 <b>' + (aS + aP + aU + aT) + '円</b> ／ 予算 ' + moneyIn + '円' +
    (money !== moneyIn ? '（<b>100円単位に切り下げて ' + money + '円</b>）' : '') + ' の自動配分。' +
    '<b>すべて100円単位</b>（1点あたり100円の倍数）なので、そのまま馬券を買えます。' +
    '点数で割り切れない端数は単勝にまとめました' + (!nT ? '（3頭未満のため3連複は外しました）' : '') + '。' +
    (ev1 != null ? '◎単勝の回収率期待は <b>' + Math.round(ev1 * 100) + '%</b>（AI勝率' + pct(p1) + '%×オッズ' + (o1 ? o1 : '') + '倍）。' : '') +
    '単勝・複勝は実オッズで判断できますが、馬連・3連複は払戻オッズが発走前は未確定のため「的中重視」の目安配分です。あくまで参考で、購入は自己責任でお願いします。</div>');
  return out.join('');
}

/* 重みスライダー生成(一度だけ作って値を同期) */
function buildWeightSliders(){
  var box = $('weightSliders');
  if (!box || box.dataset.built) { syncWeightUI(); return; }
  box.dataset.built = '1';
  var html = '';
  WEIGHT_DEFS.forEach(function(d){
    /* ★第21弾⑤: スライダーの右に「レースごとの自動補正（×倍率 → 実効値）」を出す欄を置きます */
    html += '<div class="slider" title="' + esc(d.hint) + '">' +
      '<label>' + d.label + '</label>' +
      '<input type="range" data-wk="' + d.k + '" min="0" max="10" step="1" value="' + (state.weights[d.k]||0) + '">' +
      '<output data-wo="' + d.k + '"></output>' +
      '<span class="wtbar small" id="wtBar_' + d.k + '"></span></div>';
  });
  /* 🧠 あなたの印: スライダーは削除したが「AI計算には使いません」を明示しておく */
  html += '<div class="slider" style="opacity:.6" title="第21弾⑤で重み設定から削除しました。印の入力欄は①データ入力に残ります（メモ・買い目の照合・自己学習の記録として使えます）が、AI印の計算には一切使いません">' +
    '<label>🧠 あなたの印</label>' +
    '<span class="small muted" style="flex:1">— 重み設定から削除しました（AI印の計算には使いません。印の入力欄は①に残ります）</span>' +
    '<span class="wtbar small" id="wtBar_mark"></span></div>';
  box.innerHTML = html;
  box.querySelectorAll('input[data-wk]').forEach(function(inp){
    inp.addEventListener('input', function(){
      var k = inp.dataset.wk;
      state.weights[k] = parseInt(inp.value,10) || 0;
      syncWeightUI();
      saveNow();
      renderTables(currentAnalysis());   // 即時反映(ペース診断は不変)
    });
  });
  syncWeightUI();
}
function syncWeightUI(){
  var sum = 0;
  WEIGHT_DEFS.forEach(function(d){
    var val = state.weights[d.k] || 0; sum += val;
    var o = document.querySelector('output[data-wo="' + d.k + '"]');
    if (o) o.textContent = val;
  });
  var ws = $('wSum'); if (ws) ws.textContent = sum;
  try { if (typeof wtRender === 'function') wtRender(null); } catch(e){}   // ★第21弾⑤: 自動補正バーを描き直す
}
function resetWeights(){
  state.weights = defaultWeights();
  var box = $('weightSliders');
  if (box) box.dataset.built = '';
  buildWeightSliders();
  renderTables(currentAnalysis());
  saveNow();
}

/* 「🔄 最新情報を取得して更新」: オッズ変動・出走取消・馬場変化・学習追加を
   最新の入力内容へ反映し、AI印・総合評価・買い目・各予想モデルの印をまとめて再計算する。
   - race.netkeiba の単勝オッズ(・結果)を再取得できれば state のオッズ欄へ反映(手動更新と同等)
   - その後 必ず renderKentaiFull() で全カード(ペース・AI印表・買い目・モデル印・自己学習表示)を再描画
   戻り値: なし(非同期) */
function kentaiRefreshNow(){
  var btn = $('btnKentaiRefresh');
  var msgEl = $('kentaiRefreshHint');
  function done(msg, err){
    if (btn) btn.disabled = false;
    if (msgEl){
      msgEl.innerHTML = '<span style="color:' + (err ? 'var(--err-ink)' : 'var(--ok-ink)') + '">' + esc(msg) + '</span>';
    }
    try { renderKentaiFull(); } catch(e){}
    if (typeof apRender === 'function'){ try { apRender(); } catch(e){} }
    if (typeof rnRefresh === 'function'){ try { rnRefresh(); } catch(e){} }
  }
  if (btn) btn.disabled = true;
  try {
    // ローカル状態からだけでも再計算しておく(ネット失敗時も必ず最新化)
    renderKentaiFull();
  } catch(e){}
  var rid = '';
  try { rid = (typeof nkNowRid === 'function') ? nkNowRid() : String(state.raceId || ''); } catch(e){}
  if (!rid){
    done('✅ 現在の入力内容でAI印・総合評価・買い目・各予想モデルの印を再計算しました。オッズを自動反映するには「① データ入力」で netkeiba URLを取込んでください。', false);
    return;
  }
  var msgs = [];
  var qOdds = (typeof lvRefreshOdds === 'function') ? lvRefreshOdds(true) : null;
  var pOdds = (qOdds && typeof qOdds.then === 'function') ? qOdds : Promise.resolve();
  pOdds.then(function(){
    var chg = 0;
    try {
      if (typeof lvState !== 'undefined' && lvState && lvState.prevOdds) chg = Object.keys(lvState.prevOdds).length;
    } catch(e){}
    if (typeof lvRefreshResult === 'function'){
      var qRes = lvRefreshResult(true);
      var pRes = (qRes && typeof qRes.then === 'function') ? qRes : Promise.resolve();
      return pRes.then(function(){
        done('✅ 最新オッズ・結果を取得して、AI印・総合評価・買い目・各予想モデルの印を更新しました' +
          (chg ? '（単勝 ' + chg + ' 頭分を反映）' : '') +
          '。出走取消の反映は「① データ入力」の再取込でも行えます。', false);
      });
    }
    done('✅ 最新オッズを取得して、AI印・総合評価・買い目・各予想モデルの印を更新しました' +
      (chg ? '（単勝 ' + chg + ' 頭分を反映）' : '') + '。', false);
    return null;
  }).catch(function(e){
    done('✅ 現在の入力内容で再計算しました（オッズ取得は失敗: ' + esc((e && e.message) || e) + '）。「① データ入力」の🔄手動更新や再取込もお試しください。', true);
  });
}
function initAnalysisTab(){
  on('btnWReset', 'click', resetWeights);
  var kr = $('btnKentaiRefresh');
  if (kr) kr.addEventListener('click', function(){ kentaiRefreshNow(); });
  var pmb = $('paceModes');
  if (pmb){
    pmb.addEventListener('click', function(e){
      var b = e.target && e.target.closest && e.target.closest('[data-pm]');
      if (!b) return;
      setPaceMode(b.getAttribute('data-pm'));
    });
  }
  // renderKentaiFullが呼ばれたら学習カードも更新
  if (typeof initLearn === 'function') initLearn();
}
