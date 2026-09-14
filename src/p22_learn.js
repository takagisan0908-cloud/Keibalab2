/* =========================================================
   22 展開学習（レース結果からAI予想を修正）
   - このレースの「直近の結果（過去最大8回）」の馬券内の脚質・
     4角位置を集計し、どの脚質に展開が向く傾向かを学習
   - 「本日の他レース」は p13(トラックバイアス) が同じデータ基盤
     （同日・同開催の前レース結果）で判定し、AI印へ反映
   - 補正は state.learn.hist に入り p5 analyzeRace が乗算します
   ========================================================= */
var LEARN_LS = 'khl_learn_v1';
var LEARN_COLORS = { 逃げ:'#c0504d', 先行:'#e0912f', 差し:'#2f7fc4', 追込:'#7a6ec4' };

function lnLoad(){
  try { var o = JSON.parse(localStorage.getItem(LEARN_LS) || '{}'); if (!o || !Array.isArray(o.entries)) return { entries: [] }; return o; }
  catch(e){ return { entries: [] }; }
}
function lnSave(o){ try { safeSetItem(LEARN_LS, JSON.stringify(o))   /* 🥇予想の学習＝第一優先 */; } catch(e){} }
function lnLog(msg){
  var el = $('learnLog'); if (!el) return;
  el.innerHTML += (el.innerHTML ? '<br>' : '') + '・' + esc(msg);
}
function lnLogClear(){ var el = $('learnLog'); if (el) el.innerHTML = ''; }
function lnBusy(b){
  ['btnLearnHist','btnLearnDay'].forEach(function(id){ var el = $(id); if (el) el.disabled = b; });
}
function lnCurrentRid(){
  var rid = String((state && state.raceId) || '').trim();
  if (!rid){
    var inp = $('urlImport'); var v = inp ? String(inp.value).trim() : '';
    if (v && typeof nkExtractRaceId === 'function') rid = nkExtractRaceId(v);
  }
  return rid;
}

/* 1レース分(結果詳細)を学習DBへ */
function lnIngest(d, rid){
  if (!d || !rid) return;
  var st = lnLoad();
  st.entries = (st.entries || []).filter(function(e){ return e.rid !== rid; });
  var money = [];
  (d.rows || []).forEach(function(r){
    if (r.order >= 1 && r.order <= 3){
      var sty = (typeof histStyle === 'function') ? histStyle(r.passing, d.n) : null;
      var tag = sty ? sty.tag : '不明';
      var pos4 = sty ? sty.pos4 : null;
      var bucket = pos4 ? (pos4 <= 2 ? 'front' : pos4 <= 6 ? 'mid' : 'back') : '';
      money.push({ order: r.order, no: r.no, name: r.name, style: tag, pos4: pos4, bucket: bucket });
    }
  });
  var meta = d.meta || {};
  st.entries.push({
    rid: rid, date: meta.date || '', place: meta.place || '', dist: meta.dist || '',
    surface: meta.surface || '', baba: meta.baba || '', n: d.n || 0, money: money
  });
  lnSave(st);
}

/* =========================================================
   学習DBから「今のレース文脈」に合う展開傾向を計算し、state.learn.hist へ
   - 本日のレースの 馬場(芝/ダ・良/稍重/重/不良) と過去各年の馬場・表面を比較し、
     「本日と似た条件の年ほど重視」する重み付き集計にする
   - 当日のトラックバイアス(biasVerdict)とはエンジン側で「本日バイアス×学習」の
     両方を乗算するため、ここでは過去年分の条件補正のみを行う
   ========================================================= */
function lnBabaRank(l){
  l = String(l == null ? '' : l).replace(/^ダート/, '').replace(/^ダ/, '').trim();
  return { '良':0, '稍重':1, '重':2, '不良':3 }[l];
}
function lnCurBaba(){
  // 入力(コード or 日本語) → 日本語馬場ラベル
  var code = '';
  try { code = String(readRaceMeta().baba || '').trim(); } catch(e){}
  var map = { fast:'良', good:'稍重', yield:'重', soft:'不良', 'dirt_fast':'良', 'dirt_seal':'重', 芝:'良' };
  if (map[code]) return map[code];
  return lnBabaRank(code) != null ? code : '';
}
function lnCurSurf(){
  var code = '';
  try { code = String(readRaceMeta().place || (state.race && state.race.place) || ''); } catch(e){}
  if (/ダ/.test(code)) return 'ダ';
  if (/芝/.test(code)) return '芝';
  var c = '';
  try { c = String(state.race && state.race.dist || readRaceMeta().dist || ''); } catch(e){}
  return ''; // 不明
}
function lnCurDist(){
  try {
    var d = parseInt((state.race && state.race.dist) || readRaceMeta().dist || '', 10);
    return isNaN(d) ? 0 : d;
  } catch(e){ return 0; }
}
function lnCompute(){
  var st = lnLoad();
  var rid = lnCurrentRid();
  var entries = (st.entries || []);
  if (!entries.length){ state.learn.hist = null; saveNow(); return null; }
  var curDist = lnCurDist();
  var curPlace = String((state.race && state.race.place) || '').trim();
  var tSurf = lnCurSurf();   // '芝'/'ダ'/''(不明)
  var tBaba = lnCurBaba();   // '良'/'稍重'/'重'/'不良'/''(不明)
  var cand = entries.slice();
  if (curPlace) cand = cand.filter(function(e){ return e.place === curPlace; });
  if (curDist){
    var withD = cand.filter(function(e){ return Math.abs((parseInt(e.dist,10) || 0) - curDist) <= 300; });
    if (withD.length >= 2) cand = withD;
  }
  if (!cand.length) cand = entries.slice().slice(0, 8);
  // 新しい年ほど重み大(日付降順に整列)
  cand.sort(function(a,b){ return String(b.date||'').localeCompare(String(a.date||'')); });
  function entryWeight(e, idx){
    var w = 1;
    // 表面(芝/ダ)の一致
    if (tSurf && e.surface){
      w *= (String(e.surface).indexOf(tSurf.charAt(0)) >= 0) ? 1 : 0.4;
    }
    // 馬場の近さ(良→稍重→重→不良 の差)
    if (tBaba){
      var er = lnBabaRank(e.baba);
      if (er != null){
        var diff = Math.abs(er - lnBabaRank(tBaba));
        w *= diff === 0 ? 1 : (diff === 1 ? 0.75 : 0.5);
      } else {
        w *= 0.7; // 過去の馬場不明は少し軽視
      }
    }
    // 新しい年をやや重視
    w *= Math.pow(0.94, idx);
    return w;
  }
  var counts = { 逃げ:0, 先行:0, 差し:0, 追込:0 };   // 生の頭数
  var wCounts = { 逃げ:0, 先行:0, 差し:0, 追込:0 };  // 条件重み付き
  var bucket = { front:0, mid:0, back:0 };
  var total = 0, totalW = 0, usedW = [];
  cand.forEach(function(e, idx){
    var w = entryWeight(e, idx);
    usedW.push({ date: e.date || '?', place: e.place || '', surface: e.surface || '', baba: e.baba || '', dist: e.dist || '', w: w });
    (e.money || []).forEach(function(m){
      if (!m || m.order < 1 || m.order > 3) return;
      if (counts[m.style] != null) counts[m.style]++;
      if (wCounts[m.style] != null) wCounts[m.style] += w;
      if (m.bucket) bucket[m.bucket]++;
      total++;
      totalW += w;
    });
  });
  if (!total){ state.learn.hist = null; saveNow(); return null; }
  function shareW(k){ return totalW ? wCounts[k] / totalW : 0; }
  var frontW = shareW('逃げ') + shareW('先行');
  var frontRaw = (counts['逃げ'] + counts['先行']) / total;
  var mul = {};
  ['逃げ','先行','差し','追込'].forEach(function(k){
    mul[k] = clamp(shareW(k) / 0.25, 0.70, 1.45);
  });
  var topS = null, topN = 0;
  ['逃げ','先行','差し','追込'].forEach(function(k){ if (wCounts[k] > topN){ topN = wCounts[k]; topS = k; } });
  var cond = [];
  if (tSurf) cond.push(tSurf);
  if (tBaba) cond.push(tBaba);
  var condTxt = cond.length ? cond.join('') : '条件不明(全過去年を均等)';
  var label = '';
  if (frontW >= 0.58) label = '「前残り気味」で逃げ・先行に分がある決着が多い';
  else if (frontW <= 0.42) label = '「差し・追込の台頭」が目立つ決着が多い';
  else if (topS) label = topS + 'の成績がやや良い（条件補正後 ' + Math.round(shareW(topS)*100) + '%）';
  else label = '脚質は比較的フラット';
  var label2 = '直近' + cand.length + '回・本日想定' + condTxt + ': ' + label;
  var ctxNote = [];
  ctxNote.push('本日の想定条件: ' + condTxt + (curDist ? ' ・ ' + curDist + 'm' : ''));
  ctxNote.push('過去条件の近さと新しさで重み付けして集計（馬場が近い年ほど重視）。前残り率(条件補正後) = ' + Math.round(frontW*100) + '%');
  ctxNote.push('脚質: 逃げ' + counts['逃げ'] + '・先行' + counts['先行'] + '・差し' + counts['差し'] + '・追込' + counts['追込'] + '（馬券内' + total + '頭）');
  var bn = bucket.front + bucket.mid + bucket.back;
  if (bn) ctxNote.push('4角位置(馬券内): 前' + bucket.front + '・中' + bucket.mid + '・後' + bucket.back);
  var yrList = usedW.slice(0, 8).map(function(u){
    var conds = [];
    if (u.surface) conds.push(u.surface);
    if (u.baba) conds.push(u.baba);
    if (u.dist) conds.push(u.dist + 'm');
    return u.date + '(' + (conds.join(' ') || '?') + ')×' + (+u.w.toFixed(2));
  }).join('  ');
  ctxNote.push('対象(×重み): ' + (yrList || 'なし'));
  if (curDist && cand.some(function(e){ return Math.abs((parseInt(e.dist,10)||0) - curDist) > 300; }))
    ctxNote.push('※距離違いの年も含む（同距離のみが ' + withDCount(cand, curDist) + '回）');

  var res = {
    n: cand.length, total: total, counts: counts, bucket: bucket, frontRate: frontRaw,
    mul: mul, label: label2, note: ctxNote, rid: rid, entries: cand.length,
    frontW: frontW, tSurf: tSurf, tBaba: tBaba
  };
  state.learn.hist = {
    rid: rid,
    n: cand.length, total: total, counts: counts,
    mul: { E: mul['逃げ'], S: mul['先行'], K: mul['差し'], C: mul['追込'] },
    label: label2, note: ctxNote, frontRate: frontRaw, updated: new Date().toISOString(),
    cond: { surface: tSurf, baba: tBaba, dist: curDist }
  };
  saveNow();
  return res;
}
function withDCount(cand, curDist){
  return cand.filter(function(e){ return Math.abs((parseInt(e.dist,10)||0) - curDist) <= 300; }).length;
}

/* このレースの過去結果を取得して学習 */
function learnFromHistory(){
  lnLogClear();
  var rid = lnCurrentRid();
  if (!/^\d{12}$/.test(rid || '')){
    lnLog('⚠ レースIDが分かりません。①で netkeiba URL取込をするか、race_id を設定してください。');
    return;
  }
  if (typeof histFetchHtml !== 'function' || typeof histParseSeries !== 'function' || typeof histParseDetail !== 'function'){
    lnLog('⚠ 必要な取得機能がありません。');
    return;
  }
  lnBusy(true);
  lnLog('このレースの過去全成績表を取得中… (race_id=' + rid + ')');
  histFetchHtml('https://race.netkeiba.com/race/result.html?race_id=' + rid).then(function(html){
    var series = histParseSeries(html);
    if (!series.rows || !series.rows.length) throw new Error('過去全成績表が見つかりません（新しいレース・出馬表公開前の可能性）');
    if (typeof histLsSet === 'function') histLsSet('series:' + rid, series);
    var rows = series.rows.filter(function(y){ return y.rid; }).slice(0, 8);
    if (!rows.length) throw new Error('race_id付きの過去結果がありません');
    lnLog('過去 ' + rows.length + ' 回分の結果を取得して学習します…');
    var i = 0;
    function next(){
      if (i >= rows.length){
        lnLog('取得完了。傾向を集計しています…');
        var s = lnCompute();
        lnBusy(false);
        lnLog(s ? '✅ 学習しました: ' + s.label : '集計できるデータがありませんでした。');
        renderLearnCard();
        if (typeof showAnalysis === 'function') showAnalysis();
        return;
      }
      var y = rows[i++];
      histFetchHtml('https://race.netkeiba.com/race/result.html?race_id=' + y.rid).then(function(h2){
        var d = histParseDetail(h2);
        if (!d.rows || !d.rows.length) throw new Error('着順なし');
        if (typeof histLsSet === 'function') histLsSet('detail:' + y.rid, d);
        lnIngest(d, y.rid);
        lnLog(y.year + '年 (' + y.rid + ') を学習');
        next();
      }).catch(function(err){
        lnLog('⚠ ' + y.year + '年は取得失敗: ' + String(err && err.message || err));
        next();
      });
    }
    next();
  }).catch(function(err){
    lnBusy(false);
    lnLog('⚠ ' + String(err && err.message || err));
  });
}

function learnDayRun(){
  if (typeof nkBiasFetchAll !== 'function'){ lnLog('本日のレース取込は使えません'); return; }
  lnLog('本日の前レース結果を自動取得しています（トラックバイアスの取得と同時に展開学習も取り込みます）…');
  var r = null;
  try { r = nkBiasFetchAll(); } catch(e){}
  if (r && typeof r.then === 'function'){
    r.then(function(){ setTimeout(function(){ renderLearnCard(); if (typeof showAnalysis === 'function') showAnalysis(); }, 60); })
     .catch(function(){ setTimeout(renderLearnCard, 60); });
  } else {
    setTimeout(function(){ renderLearnCard(); }, 2500);
  }
}
function learnReset(){
  var go = function(){
    try { localStorage.removeItem(LEARN_LS); } catch(e){}
    state.learn.hist = null; state.learn.updated = '';
    saveNow();
    renderLearnCard();
    if (typeof showAnalysis === 'function') showAnalysis();
  };
  if (typeof showConfirm === 'function') showConfirm('学習した展開傾向と保存済み結果をすべて消去しますか？', go);
  else go();
}

function learnStyleCountsBar(){
  var h = state.learn && state.learn.hist && state.learn.hist.counts;
  var total = (state.learn && state.learn.hist && state.learn.hist.total) || 0;
  if (!h || !total) return '';
  var html = '<div style="display:grid;grid-template-columns:3.2em 1fr auto;gap:3px 8px;align-items:center;max-width:520px;margin-top:4px">';
  ['逃げ','先行','差し','追込'].forEach(function(s){
    var c = h[s] || 0;
    var w = total ? Math.round(c / total * 100) : 0;
    html += '<span style="font-weight:700;color:' + (LEARN_COLORS[s]||'var(--mut)') + '">' + s + '</span>' +
      '<span style="height:13px;display:flex"><i style="width:' + w + '%;background:' + (LEARN_COLORS[s]||'#666') + ';border-radius:3px;display:inline-block"></i></span>' +
      '<span class="small">' + c + '頭 (' + w + '%)</span>';
  });
  html += '</div>';
  return html;
}

function renderLearnCard(){
  var out = $('learnOut'), chip = $('learnChip'), chk = $('learnUseChk');
  var hist = state.learn && state.learn.hist;
  var learnOn = (state.learn.useHist !== false);
  if (!out) return;
  if (chk) chk.checked = learnOn;
  if (chip) chip.textContent = hist ? '学習済 ' + hist.n + '回' : '未学習';
  var html = '';
  var curRid = lnCurrentRid();
  if (!learnOn && hist){
    html += '<div style="color:var(--warn-ink)">ℹ 「反映する」がOFFのため、学習結果は記録のみで <b>AI印には反映していません</b>。「反映する」に戻すと自動で再計算します。</div>';
  }
  if (hist){
    var valid = !!(hist.rid && curRid && hist.rid === curRid);
    if (!valid){
      html += '<div style="color:var(--warn-ink)">⚠ この学習結果は「race_id=' + esc(hist.rid) + '」のものです。現在のレースと異なるため <b>AI印には反映していません</b>。もう一度「過去結果で学習」してください。</div>';
    }
    html += '<div><b>' + esc(hist.label || '') + '</b></div>';
    html += learnStyleCountsBar();
    if (hist.frontRate != null){
      var fr = Math.round(hist.frontRate * 100);
      html += '<div class="small muted" style="margin-top:3px">前残り率（馬券内のうち逃げ+先行）= ' + fr + '%。補正倍率 → 逃げ×' + (+(hist.mul.E).toFixed(2)) + ' / 先行×' + (+(hist.mul.S).toFixed(2)) + ' / 差し×' + (+(hist.mul.K).toFixed(2)) + ' / 追込×' + (+(hist.mul.C).toFixed(2)) + '</div>';
    }
    if (hist.note && hist.note.length){
      html += '<div class="small muted" style="margin-top:3px">' + hist.note.map(function(n){ return '・' + esc(n); }).join('<br>') + '</div>';
    }
    html += '<div class="small muted" style="margin-top:3px">学習日時: ' + esc((hist.updated || '').slice(0, 16).replace('T', ' ')) + '</div>';
  } else {
    html += '<span class="muted">まだ学習していません。「このレースの過去結果で学習」を押すと、直近の同レース結果（最大8回）から展開傾向を集計します。当日分は上のトラックバイアス取得時に自動で同時学習されます。</span>';
  }
  // 本日の他レース（バイアス）の状態
  var br = (state.biasRaces || []).length;
  var bv = null;
  try { if (typeof biasVerdict === 'function') bv = biasVerdict(); } catch(e){}
  html += '<div style="margin-top:8px;border-top:1px dashed var(--line2);padding-top:6px"><b>本日の他レース（同じ開催の前レース）:</b> ';
  if (br){
    html += '記録 ' + br + 'レース' + (bv && bv.posLabel ? ' → 「' + esc(bv.posLabel) + '」と判定。' + (learnOn ? 'AI印の脚質評価に反映中' : '※「反映する」OFFのため AI印には反映していません') : '（脚質が未設定のため判定待ち）');
  } else {
    html += '<span class="muted">記録なし。「🔍 前レース結果を自動取込（トラックバイアス）」を実行すると、<b>同じ通信で展開学習にも同時に取り込まれます</b>（「📥 本日の他レースを学習」ボタンでも同じ処理を実行します）。</span>';
  }
  html += '</div>';
  out.innerHTML = html;
}

function initLearn(){
  var b1 = $('btnLearnHist'); if (b1) on(b1, 'click', learnFromHistory);
  var b2 = $('btnLearnDay'); if (b2) on(b2, 'click', learnDayRun);
  var b3 = $('btnLearnReset'); if (b3) on(b3, 'click', learnReset);
  var ck = $('learnUseChk'); if (ck) on(ck, 'change', function(){
    state.learn.useHist = !!ck.checked;
    saveNow();
    renderLearnCard();
    if (typeof showAnalysis === 'function') showAnalysis();
  });
}
