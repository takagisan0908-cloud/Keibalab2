/* =========================================================
   33 ①タブ用「日付 → その日の1〜12R → 出馬表取込」の簡易ピッカー
   ---------------------------------------------------------
   netkeiba race_list_sub から、指定日の全開催(場ごと1〜12R)を取得し、
   ①データ入力タブ内でもレースを選んで出馬表を読み込めるようにします。
   内部は p26 の kai* と同一データ(kai.cache)・同一読込(kaiImportByRaceId)を共有します
   （旧「レースを選ぶ」タブはこの①のピッカーと重複していたため削除しました）。
   ========================================================= */
var rk = { cache: null, sel: null, busy: false };
function rkDate8(){
  var el = $('rkDate');
  var v = (el && el.value) || '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.replace(/-/g, '');
  return '';
}
function rkToday8(){ var d = new Date(); return '' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
function rkDateLabel(d8){
  if (!/^\d{8}$/.test(d8 || '')) return d8 || '';
  var y = parseInt(d8.slice(0,4), 10), m = parseInt(d8.slice(4,6), 10), d = parseInt(d8.slice(6,8), 10);
  return y + '年' + m + '月' + d + '日';
}
function rkMsg(msg, isErr){
  var el = $('rkMsg'); if (!el) return;
  el.innerHTML = (isErr ? '⚠ ' : '') + esc(msg);
  el.style.color = isErr ? '#b3261e' : '';
  el.style.fontWeight = isErr ? '600' : '';
}
function rkBusy(b){
  rk.busy = b;
  var f = $('rkFetch'); if (f) f.disabled = b;
  var t = $('rkToday'); if (t) t.disabled = b;
}
function rkFetch(){
  if (rk.busy) return;
  var d8 = rkDate8();
  if (!d8){ rkMsg('日付を入力してください', true); return; }
  if (typeof kaiFetchAny !== 'function' || typeof kaiParseList !== 'function'){
    rkMsg('出馬表一覧の取得機能が読み込まれていません。', true);
    return;
  }
  rkBusy(true);
  rkMsg('開催一覧を取得中…（' + rkDateLabel(d8) + '）');
  kaiFetchAny('https://race.netkeiba.com/top/race_list_sub.html?kaisai_date=' + d8).then(function(html){
    var venues = kaiParseList(html);
    if (!venues.length){
      rkBusy(false);
      rk.cache = null; rk.sel = null;
      var b = $('rkList'); if (b) b.innerHTML = '';
      var dd = $('rkDetail'); if (dd) dd.innerHTML = '';
      var looksOk = (typeof kaiListLooksValid === 'function') ? kaiListLooksValid(html) : true;
      rkMsg(looksOk
        ? 'この日は開催データがありません。JRA開催日（主に土日）を選んでください。'
        : '⚠ レース一覧を取得できましたが内容を解釈できませんでした（中継(リレー)の応答が空・不正の可能性）。「URL取込の通信設定」→「🔧 中継を診断」でご確認ください。', true);
      return;
    }
    rk.cache = { date: d8, venues: venues };
    if (typeof kaiLs === 'function' && typeof kaiLsSet === 'function'){
      var ls = kaiLs(); ls.cache = { date: d8, venues: venues }; kaiLsSet(ls);
    }
    var total = 0; venues.forEach(function(v){ total += v.races.length; });
    rkMsg('✅ ' + rkDateLabel(d8) + ' の開催 ' + venues.length + '場 / ' + total + 'レース。Rボタン（タブ）で選択してください。');
    rkRender();
    rkBusy(false);
  }).catch(function(e){
    rkBusy(false);
    rkMsg('取得に失敗: ' + (e && e.message || e) + '。出馬表と同じ中継(リレー)が必要です。①上部の「URL取込の通信設定」→「🔧 中継を診断」をご確認ください。', true);
  });
}
function rkFindRace(rid){
  if (!rk.cache) return null;
  for (var i = 0; i < rk.cache.venues.length; i++){
    var v = rk.cache.venues[i];
    for (var j = 0; j < v.races.length; j++){
      if (v.races[j].raceId === rid) return { venue: v.venue, kaisai: v.kaisai, baba: v.baba, race: v.races[j] };
    }
  }
  return null;
}
function rkRender(){
  var box = $('rkList'); if (!box) return;
  if (!rk.cache || !rk.cache.venues || !rk.cache.venues.length){ box.innerHTML = ''; return; }
  // 読み込み済み(履歴)マーク
  var doneSet = {};
  try {
    var ls = (typeof kaiLs === 'function') ? kaiLs() : { hist: [] };
    (ls.hist || []).forEach(function(h){ if (h.raceId) doneSet[h.raceId] = 1; });
  } catch(e){}
  /* ★2026-09-13 第23弾④: 「端末に出馬表が入っている＝選んでも通信せず即表示」の印を付ける。
     📥一括取得 した日は全部に ⚡ が付くので、どれがパッと開けるか一目で分かります。 */
  var cardSet = {};
  try {
    var pl = (typeof preListAll === 'function') ? (preListAll() || []) : [];
    pl.forEach(function(it){ if (it && it.rid && (typeof preHasCard === 'function') && preHasCard(it.rid)) cardSet[it.rid] = 1; });
  } catch(e){}
  var nCard = 0;
  var html = rk.cache.venues.map(function(v){
    var btns = v.races.map(function(r){
      var on = (rk.sel && rk.sel.raceId === r.raceId) ? ' on' : '';
      var dn = doneSet[r.raceId] ? ' done' : '';
      var hc = !!cardSet[r.raceId];
      if (hc) nCard++;
      return '<button type="button" class="kai-rbtn' + on + dn + '" data-rid="' + esc(r.raceId) + '" title="' +
        (hc ? '⚡ 出馬表は端末に保存済み（通信せず即表示されます）｜' : '') +
        esc(r.name) + '｜' + esc((r.cond || '') + ' ' + (r.count || '')) + '">' + (hc ? '⚡' : '') + r.r + 'R</button>';
    }).join('');
    return '<div class="kai-venue"><div class="vh"><span class="vt">' + esc(v.venue) + '</span>' +
      (v.kaisai ? '<span class="vk">' + esc(v.kaisai) + '</span>' : '') +
      (v.baba ? '<span class="vk">' + esc(v.baba) + '</span>' : '') +
      '<span class="vk">' + v.races.length + 'レース</span></div>' +
      '<div class="kai-tabs">' + btns + '</div></div>';
  }).join('');
  /* ★2026-09-13 第23弾④: 「この日の出馬表がどれだけ端末に入っているか」を先頭に出す */
  var total = 0;
  rk.cache.venues.forEach(function(v){ total += (v.races || []).length; });
  var head = nCard
    ? '<div class="small" style="margin:0 0 6px;color:var(--ok-ink)">⚡ <b>' + nCard + ' / ' + total +
      ' レースの出馬表が端末に保存済み</b> ― ⚡の付いたRは netkeiba に取りに行かず<b>パッと表示</b>されます（出走取消などがあったときだけ「🔄 取り直す」）。</div>'
    : '<div class="small muted" style="margin:0 0 6px">まだ端末に出馬表がありません。レースを選ぶと取得します（一度取得したレースは次回から即表示）。' +
      'その日の全レースを先にまとめて入れておくには <b>📥 一括取得して事前予想を保存</b> を押してください。</div>';
  box.innerHTML = head + html;
}
function rkSelect(rid){
  var f = rkFindRace(rid);
  if (!f) return;
  rk.sel = { venue: f.venue, r: f.race.r, name: f.race.name, time: f.race.time, cond: f.race.cond, count: f.race.count, raceId: f.race.raceId, date: rk.cache.date };
  document.querySelectorAll('#rkList .kai-rbtn').forEach(function(b){
    b.classList.toggle('on', b.getAttribute('data-rid') === rid);
  });
  // p26(kai)側の選択も同期（読み込み履歴と状態を一致させる）
  try { if (typeof kaiSelectRace === 'function') kaiSelectRace(rid); } catch(e){}
  rkRenderDetail();
}
function rkRenderDetail(){
  var el = $('rkDetail'); if (!el) return;
  var s = rk.sel; if (!s){ el.innerHTML = ''; return; }
  var hist = null;
  try {
    var ls = (typeof kaiLs === 'function') ? kaiLs() : { hist: [] };
    hist = (ls.hist || []).filter(function(h){ return h.raceId === s.raceId; })[0] || null;
  } catch(e){}
  var chip = hist ? '<span class="chip" style="background:var(--card2);color:var(--ok-ink)">✓ 読み込み済み</span>' : '';
  var cur = (state && state.raceId === s.raceId) ? '<span class="chip" style="background:var(--card2);color:var(--info-ink)">現在のレース</span>' : '';
  var title = esc((s.name || 'レース名不明') + '（' + (s.venue || '?') + ' ' + s.r + 'R）');
  el.innerHTML =
    '<div style="border:1px dashed var(--line2);border-radius:10px;padding:8px 10px;margin-top:6px;background:var(--card)">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
        '<b>' + title + '</b>' + chip + cur +
        '<span class="sp" style="flex:1"></span>' +
        '<a class="btn ghost" style="text-decoration:none;padding:3px 10px;font-size:.8rem" target="_blank" rel="noopener" href="https://race.netkeiba.com/race/shutuba.html?race_id=' + esc(s.raceId) + '">netkeiba出馬表 ↗</a>' +
      '</div>' +
      '<div class="kai-meta" style="font-size:.82rem;margin-top:2px">' +
        '<span>' + esc(rkDateLabel(s.date)) + '</span>' +
        (s.time ? ' / 発走 ' + esc(s.time) : '') +
        (s.cond ? ' / ' + esc(s.cond) : '') +
        (s.count ? ' / ' + esc(s.count) : '') +
      '</div>' +
      '<div style="margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
      '<button type="button" class="btn primary" id="rkLoad">📥 このレースの出馬表を読み込む（自動保存）</button>' +
      '<button type="button" class="btn ghost" id="rkLoadForce" title="端末内のキャッシュを使わず、netkeiba から出馬表を取り直します（出走取消・馬場変更があったとき）">🔄 取り直す（再取得）</button>' +
      '<span class="small muted" id="rkCacheNote"></span></div>' +
      '<div class="small muted" style="margin-top:2px">読み込むと下の出馬表・②AI印などがこのレースに切り替わります。' +
      '★「📥 その日の出馬表を一括取得」で取得済みのレースは<b>通信せず即座に復元</b>されます。</div>' +
    '</div>';
  var lb = $('rkLoad');
  if (lb) lb.onclick = function(){ rkLoad(false); };
  var lbf = $('rkLoadForce');
  if (lbf) lbf.onclick = function(){ rkLoad(true); };
  // ★第21弾①: 出馬表が端末内に取得済みかどうかを出す（取得済みなら通信せず復元できます）
  try {
    var cn = $('rkCacheNote');
    if (cn && typeof nkCardHas === 'function'){
      cn.innerHTML = nkCardHas(s.raceId)
        ? '<span style="color:var(--ok-ink)">⚡ 出馬表は取得済み（キャッシュあり）</span>'
        : '<span class="muted">未取得（読み込むと netkeiba から取得します）</span>';
    }
  } catch(e){}
}
function rkLoad(force){
  var s = rk.sel;
  if (!s || !s.raceId) return;
  if (typeof kaiImportByRaceId !== 'function'){ rkMsg('出馬表の取込機能がありません。', true); return; }
  if (!force && state && state.raceId === s.raceId && state.horses && state.horses.length){
    rkMsg('このレースは既に読み込まれています（馬番号順の出馬表が下に表示中）。取り直す場合は「🔄 取り直す（再取得）」を押してください。', false);
    return;
  }
  rkBusy(true);
  var cached = false;
  try { cached = !force && (typeof nkCardHas === 'function') && nkCardHas(s.raceId); } catch(e){}
  rkMsg(cached
    ? '⚡ 取得済みの出馬表を復元しています…（' + esc(s.name || s.raceId) + '・通信なし）'
    : '出馬表を取得中…（' + esc(s.name || s.raceId) + '）');
  // kaiImportByRaceId は内部で非同期に処理し rebuildHorseTable・自動保存まで行う
  // ★第21弾①: 日付(d8)を渡すことでキャッシュの期限判定（過去7日/当日30分）が正確になります
  kaiImportByRaceId(s.raceId, { force: !!force, d8: rkDate8() || s.date || '' });
  var t0 = Date.now();
  var iv = setInterval(function(){
    var ok = (state && state.raceId === s.raceId && state.horses && state.horses.length > 0);
    if (ok || Date.now() - t0 > 45000){
      clearInterval(iv);
      rkBusy(false);
      if (ok){
        rkMsg('✅ 読み込みました。下の出馬表（最大18頭）と、その下の「全馬のプロフィール・戦績・成績分析」をご利用ください。');
        rkRender(); rkRenderDetail();
        try { if (typeof hdRefreshHint === 'function') hdRefreshHint(); } catch(e){}
      } else {
        rkMsg('出馬表の取得が完了しませんでした。詳細は①上部の「URL取込の通信設定」→「🔧 中継を診断」をご確認ください。', true);
      }
    }
  }, 500);
}
function initRk(){
  var de = $('rkDate');
  if (de && !de.value){
    var d8 = (typeof kaiLs === 'function') ? (function(){ try { var l = kaiLs(); return (l.cache && l.cache.date) || ''; } catch(e){ return ''; } })() : '';
    var dd8 = d8 || rkToday8();
    de.value = dd8.slice(0,4) + '-' + dd8.slice(4,6) + '-' + dd8.slice(6,8);
  }
  on('rkFetch', 'click', rkFetch);
  on('rkToday', 'click', function(){
    var el = $('rkDate'); if (!el) return;
    var d = rkToday8();
    el.value = d.slice(0,4) + '-' + d.slice(4,6) + '-' + d.slice(6,8);
  });
  var box = $('rkList');
  if (box) box.addEventListener('click', function(e){
    var b = e.target && e.target.closest ? e.target.closest('.kai-rbtn') : null;
    if (b) rkSelect(b.getAttribute('data-rid'));
  });
}
