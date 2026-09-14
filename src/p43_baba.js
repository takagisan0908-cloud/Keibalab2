/* =========================================================
   43 バ場・馬場別の好走率ファクター（同開催場×同馬場の3着内率）
   ---------------------------------------------------------
   各馬の馬柱戦績（db.netkeiba.com/horse/result/{馬ID}/ を
   p34 の hdParseRecords が解析・khl_hd_v1 にキャッシュした行）から、
   現在のレースと同じ
     ・開催場（札幌〜小倉） かつ
     ・馬場状態（良 / 稍重 / 重 / 不良）〔馬場状態が未入力なら全馬場合算〕
   の直近レース（最大20走）について 3着内率 を集計します。
   集計結果は p5(analyzeRace) が「バ場好走率」重みとして AI印へ反映。
   - サンプルが少なすぎる / 馬ID無し / データ未取得 のときは自動OFF
     （対象外の馬は全馬の平均値へ縮退させ、レース全体の序列は崩さない）
   - データの取得は「📊 バ場好走率データを取得」ボタンから
     （p34 と同じ馬柱キャッシュ khl_hd_v1 を使うため重複取得なし）
   ========================================================= */
var BB_PRIOR = 2;                 // 縮退の擬似サンプル数
var BB_MAXRUN = 20;               // 直近対象走数
var BB_MEMO = { key: '', val: null };
var BB_LS = 'khl_baba_v1';        // 設定等は無し（統計ログ用に確保）

/* ---------- 現在レースの文脈 ---------- */
function bbCurCtx(){
  var place = '', babaCode = '', i;
  try {
    var rm = readRaceMeta();
    place = String(rm.place || '');
    babaCode = String(rm.baba || '');
  } catch(e){}
  try { if (!place) place = String((state.race && state.race.place) || ''); } catch(e){}
  try { if (!babaCode) babaCode = String((state.race && state.race.baba) || ''); } catch(e){}
  var venue = '';
  var vlist = ['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉'];
  for (i = 0; i < vlist.length; i++){
    if (place.indexOf(vlist[i]) >= 0){ venue = vlist[i]; break; }
  }
  var map = { fast:'良', good:'稍重', yield:'重', soft:'不良', dirt_fast:'良', dirt_seal:'重' };
  var baba = map[babaCode] || '';
  var surf = '';
  if (/芝/.test(place)) surf = '芝';
  else if (/ダ/.test(place)) surf = 'ダ';
  return { venue: venue, baba: baba, surf: surf, placeTxt: place };
}
function bbNormBaba(s){
  s = String(s == null ? '' : s).replace(/[\s\u3000]/g, '');
  // netkeiba の馬柱は「稍」「不」のように省略表記されるので、正式名に揃える
  var m = s.match(/^(良|稍重|稍|重|不良|不)/);
  if (!m) return '';
  return ({ '稍': '稍重', '不': '不良' })[m[1]] || m[1];
}

/* ---------- 集計（同期・キャッシュのみ。ネットワーク不可） ---------- */
function bbRates(hs, ctx){
  var n0 = hs.length;
  var out = {
    usable: false, why: '', items: [], usedN: 0, usedR: 0,
    babaLabel: '', venue: ctx.venue || '', placeTxt: ctx.placeTxt || ''
  };
  var ids = hs.filter(function(h){ return h && h.nk; }).length;
  if (!ids){
    out.why = '出走馬に netkeiba の馬IDがありません（「netkeiba URLから直接取込」で出馬表を読込むと馬IDが付き、集計できます）';
    for (var z = 0; z < n0; z++) out.items.push({ n:0, top3:0, pct:0, rate:0.5, no:'', name:'' });
    return out;
  }
  if (!ctx.venue){
    out.why = '現在の開催場が未設定です（対象レースの開催場を入力してください）';
    for (var z2 = 0; z2 < n0; z2++) out.items.push({ n:0, top3:0, pct:0, rate:0.5, no:'', name:'' });
    return out;
  }
  out.babaLabel = ctx.baba
    ? '同開催「' + ctx.venue + '」×馬場「' + ctx.baba + '」' + (ctx.surf ? '（' + ctx.surf + '）' : '')
    : '同開催「' + ctx.venue + '」の全馬場合算（馬場状態が未入力のため）';
  var ls = hdLs();
  var poolN = 0, poolTop3 = 0;
  var per = [];
  hs.forEach(function(h, idx){
    var it = { n:0, top3:0, pct:0, rate:0.5, no: h && h.no || '', name: h && h.name || '' };
    if (!h || !h.nk){ per.push(it); return; }
    var rec = ls[String(h.nk).trim()];
    if (!rec || !Array.isArray(rec.r)){ per.push(it); return; }
    var rows = rec.r.filter(function(r){
      if (!r || r.order < 1) return false;
      if (r.venueName !== ctx.venue) return false;
      if (ctx.surf && r.surface && r.surface !== ctx.surf) return false;
      if (ctx.baba){ var rb = bbNormBaba(r.baba); if (rb !== ctx.baba) return false; }
      return true;
    });
    if (!rows.length){ per.push(it); return; }
    var latest = rows.slice(-BB_MAXRUN);   // hdParseRecords は日付昇順
    it.n = latest.length;
    it.top3 = latest.filter(function(r){ return r.order >= 1 && r.order <= 3; }).length;
    it.pct = Math.round(it.top3 / it.n * 100);
    per.push(it);
    poolN += it.n; poolTop3 += it.top3;
  });
  var vAvg = poolN > 0 ? poolTop3 / poolN : 0.33;
  per.forEach(function(it){
    it.rate = it.n > 0 ? ((it.top3 + BB_PRIOR * vAvg) / (it.n + BB_PRIOR)) : vAvg;
  });
  var hasAny = per.filter(function(it){ return it.n > 0; }).length;
  var rich = per.filter(function(it){ return it.n >= 2; }).length;
  out.usedN = poolN;
  out.usedR = hasAny;
  out.items = per;
  if (poolN >= 4 && rich >= 1){
    out.usable = true;
  } else if (poolN === 0){
    out.why = (ctx.baba
      ? '「' + ctx.venue + '」×馬場「' + ctx.baba + '」'
      : '「' + ctx.venue + '」') + 'での出走馬の成績が見つかりません（「📊 データを取得」で馬柱を取込むと集計できます）';
  } else {
    out.why = 'サンプルが少なすぎるため自動OFF（対象 ' + poolN + '走 / ' + hasAny + '頭）';
  }
  return out;
}

/* ---------- エンジン用エントリ（メモ化） ---------- */
function bbComputeFor(hs){
  var ctx = bbCurCtx();
  var nk = '';
  (hs || []).forEach(function(h){ nk += '|' + (h && h.nk ? h.nk : '-'); });
  var key = String((state && state.raceId) || '') + '|' + ctx.venue + '|' + ctx.baba + '|' + ctx.surf + '|' + nk;
  if (BB_MEMO.key === key && BB_MEMO.val) return BB_MEMO.val;
  var val = bbRates(hs || [], ctx);
  BB_MEMO = { key: key, val: val };
  return val;
}
function bbInvalidate(){
  BB_MEMO = { key: '', val: null };
  // 馬柱を取り直したら、コース種別(洋芝/野芝)適性の計算結果も捨てる
  try { if (typeof yoInvalidate === 'function') yoInvalidate(); } catch(e){}
}

/* ---------- データ取得（ボタン用） ---------- */
function bbNeedHorses(){
  var arr = [];
  (state && state.horses || []).forEach(function(h){
    if (h && h.nk) arr.push({ nk: String(h.nk).trim(), no: h.no || '', name: h.name || '' });
  });
  return arr;
}
function bbEnsure(force, onMsg){
  var horses = bbNeedHorses();
  if (!horses.length){
    if (onMsg) onMsg('netkeiba の馬ID付きの馬がいません（スクショOCR・手入力で登録した馬は対象外です）');
    return Promise.resolve({ ok: 0, err: 0, noId: true });
  }
  var ls = hdLs();
  var freshMs = (typeof HD_FRESH_MS !== 'undefined') ? HD_FRESH_MS : 7200000;
  var todo = horses.filter(function(x){
    return force || !ls[x.nk] || !ls[x.nk].r || !ls[x.nk].p ||
      (Date.now() - (ls[x.nk].at || 0)) >= freshMs;
  });
  if (!todo.length){
    bbInvalidate();
    if (onMsg) onMsg('全頭の馬柱データは取得済みです（重みスライダーを0より上にするとAI印へ反映されます）');
    return Promise.resolve({ ok: 0, err: 0, noId: false });
  }
  if (onMsg) onMsg('0 / ' + todo.length + ' 頭を取得中…（netkeiba 馬ページ。初回は1頭あたり約1〜2秒）');
  var done = 0, errs = 0, errNames = [];
  var seq = Promise.resolve();
  todo.forEach(function(x){
    seq = seq.then(function(){
      return hdLoadHorse(x.nk, force).then(function(){
        done++;
        if (onMsg) onMsg(done + ' / ' + todo.length + ' 頭取得（' + (x.name || x.nk) + ' など）…');
      }).catch(function(){
        errs++; done++;
        if (errNames.length < 6) errNames.push(x.name || x.nk);
      });
    });
  });
  return seq.then(function(){
    bbInvalidate();
    var m = '✅ 馬柱データを更新しました（' + (done - errs) + ' / ' + todo.length + '頭）。';
    if (errNames.length) m += '取得できなかった馬: ' + errNames.join('・');
    if (onMsg) onMsg(m);
    try {
      if (typeof currentAnalysis === 'function' && typeof renderTables === 'function') renderTables(currentAnalysis());
    } catch(e){}
    return { ok: done - errs, err: errs, noId: false };
  });
}

/* ---------- UI ---------- */
function bbStatusMsg(m){
  var el = $('bbDataMsg'); if (!el) return;
  el.innerHTML = esc(m);
}
function initBb(){
  var btn = $('btnBbData'); if (!btn) return;
  btn.addEventListener('click', function(){
    if (btn.disabled) return;
    btn.disabled = true;
    bbStatusMsg('馬柱データを確認しています…');
    bbEnsure(false, function(m){ bbStatusMsg(m); }).then(function(){
      btn.disabled = false;
    });
  });
}
