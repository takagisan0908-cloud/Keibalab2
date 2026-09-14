/* =========================================================
   26 レースを選ぶ（日付 → 開催・1〜12R一覧 → 出馬表取込）
   netkeiba「レース一覧」(race.sp.netkeiba.com/?pid=race_list) と同じ日の
   開催データを PC版 /top/race_list_sub.html?kaisai_date=YYYYMMDD から取得し、
   「競馬場ごと × R(1〜12)」のタブで表示します。
   選んだレースの出馬表をAIラボへ読み込んだら 自動保存(saveNow)し、
   履歴(khl_kai_v2)としてこの端末にスナップショットも保存して、
   いつでもタブから復元できます。
   ========================================================= */
var KAI_LS = 'khl_kai_v2';
var KAI_DOW = ['日', '月', '火', '水', '木', '金', '土'];
var kai = {
  cache: null,      // { date:'YYYYMMDD', venues:[...] } 前回取得した一覧
  sel: null         // { venue, r, name, time, cond, count, raceId, date }
};

function kaiLs(){ try { return JSON.parse(cmpUnpack(localStorage.getItem(KAI_LS)) || 'null') || { hist: [] }; } catch(e){ return { hist: [] }; } }
function kaiLsSet(o){ try { localStorage.setItem(KAI_LS, cmpPack(JSON.stringify(o))); } catch(e){} }
function kaiDateLabel(d8){
  if (!/^\d{8}$/.test(d8 || '')) return d8 || '';
  var y = parseInt(d8.slice(0,4), 10), m = parseInt(d8.slice(4,6), 10), d = parseInt(d8.slice(6,8), 10);
  var dt = new Date(y, m - 1, d);
  return y + '年' + m + '月' + d + '日(' + (KAI_DOW[dt.getDay()] || '') + ')';
}
function kaiTo8(v){
  if (!v) return '';
  var s = String(v).trim();
  if (/^\d{8}$/.test(s)) return s;
  var m = s.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (!m) return '';
  return m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2);
}
function kaiToday8(){
  var d = new Date();
  return '' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
}
function kaiShift(date, day){
  var d8 = kaiTo8(date) || kaiToday8();
  var dt = new Date(parseInt(d8.slice(0,4), 10), parseInt(d8.slice(4,6), 10) - 1, parseInt(d8.slice(6,8), 10));
  dt.setDate(dt.getDate() + day);
  return '' + dt.getFullYear() + ('0' + (dt.getMonth() + 1)).slice(-2) + ('0' + dt.getDate()).slice(-2);
}

/* ===== 通信（既存の p12 のリレー候補を使い回す） ===== */
function kaiFetchTimeout(url, ms){
  if (typeof nkFetchTimeout === 'function') return nkFetchTimeout(url, ms);
  return new Promise(function(res, rej){
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function(){ if (ctrl) ctrl.abort(); }, ms);
    fetch(url, { signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' })
      .then(function(r){ clearTimeout(timer); if (!r.ok) throw new Error('HTTP ' + r.status); return nkRespText(r, url); })
      .then(function(t){ res(t); })
      .catch(function(e){ clearTimeout(timer); rej(e); });
  });
}
function kaiFetchAny(url){
  var cands = (typeof nkRelayCandidates === 'function') ? nkRelayCandidates() : [];
  var lastErr = null, triedDirect = false;
  return new Promise(function(res, rej){
    function direct(){
      triedDirect = true;
      kaiFetchTimeout(url, 15000).then(res).catch(function(e){
        rej(new Error('直接取得も失敗: ' + (e && e.message || e)));
      });
    }
    function next(i){
      if (i >= cands.length){ if (!triedDirect) direct(); else rej(new Error('取得に失敗しました: ' + (lastErr ? lastErr.message : '通信不可'))); return; }
      var base = cands[i];
      var full = nkRelayBuild(base, url);
      kaiFetchTimeout(full, 15000).then(function(t){
        var empty = !t || t.length < 300;
        var json = !empty && /^\s*[\{\[]/.test(t) && !/<html/i.test(t);
        if (empty || json){ lastErr = new Error('中継応答が空(' + base + ')'); next(i + 1); return; }
        res(t);
      }).catch(function(e){ lastErr = e; next(i + 1); });
    }
    next(0);
  });
}

/* レース一覧のURL候補（PC版）。中継によっては race_list_sub.html が 400 になるため、
   同じ内容の別URLを順に試す（①データ入力・④天気予報の当日開催判定で共用） */
function kaiListUrls(d8){
  return [
    'https://race.netkeiba.com/top/race_list_sub.html?kaisai_date=' + d8,
    'https://race.sp.netkeiba.com/?pid=race_list&kaisai_date=' + d8,
    'https://race.netkeiba.com/top/race_list.html?kaisai_date=' + d8,
    'https://race.netkeiba.com/?pid=race_list&kaisai_date=' + d8
  ];
}
/* SP版レース一覧（race.sp.netkeiba.com/?pid=race_list&kaisai_date=）のパース。
   PC版(race_list_sub.html)が空や400を返す中継でも、当日の開催場・レースが取れるようにするための予備。
   race_id は YYYY + 場コード(2) + 回(2) + 日(2) + R(2) なので、場と回次は race_id から復元できる。 */
function kaiParseListSp(html, d8){
  var s = String(html || ''), venues = [];
  if (!/RaceListDayWrap|jyo_tab/i.test(s)) return venues;
  var dayParts = s.split(/<div class="RaceListDayWrap"/i);
  var block = '';
  for (var i = 1; i < dayParts.length; i++){
    if (!d8 || dayParts[i].indexOf('data-kaisaidate="' + d8 + '"') >= 0){ block = dayParts[i]; break; }
  }
  // SP版は「今日＋次の開催日」を並べて返すので、指定日が無いブロックを別の日として使ってはいけない
  if (!block && !d8) block = dayParts[1] || '';
  if (!block) return venues;
  // 場コード → 場名（タブの見出し）
  var codeName = {}, cm, crx = /<li[^>]*id="cd(\d{2})"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/gi;
  while ((cm = crx.exec(block)) !== null){ var n0 = kaiClean(cm[2]); if (n0) codeName[cm[1]] = n0; }
  var byCode = {}, order = [];
  var rx = /race_id=(\d{12})[\s\S]{0,500}?<div class="Race_Num"><span>(\d{1,2})R[\s\S]{0,900}?<dt class="Race_Name">([\s\S]*?)<\/dt>\s*<dd class="Race_Data">([\s\S]*?)<\/dd>/gi, m;
  while ((m = rx.exec(block)) !== null){
    var rid = m[1], rno = parseInt(m[2], 10);
    var name = kaiClean(m[3]);
    var data = m[4];
    var time = (data.match(/(\d{1,2}:\d{2})/) || [])[1] || '';
    var course = kaiClean((data.match(/<span class="[^"]*">\s*([芝ダ障][^<]*)<\/span>/) || [])[1] || '');
    var cnt = kaiClean((data.match(/(\d+)\s*頭/) || [])[1] || '');
    var code = rid.slice(4, 6);
    if (!byCode[code]){
      byCode[code] = { venue: codeName[code] || (code + 'コード'), kaisai: '', races: [] };
      order.push(code);
    }
    var v = byCode[code];
    if (!v.kaisai) v.kaisai = (parseInt(rid.slice(6, 8), 10) || '') + '回' + (parseInt(rid.slice(8, 10), 10) || '') + '日目';
    v.races.push({ r: rno, raceId: rid, name: name, time: time, cond: course, count: (cnt ? cnt + '頭' : '') });
  }
  order.forEach(function(code){
    var v = byCode[code];
    v.races.sort(function(a, b){ return a.r - b.r; });
    v.baba = '';
    venues.push(v);
  });
  return venues;
}
/* PC版／SP版のどちらかで解釈できた方を返す → { venues, dateSeen }
   dateSeen = 「このページは指定日を確かに扱っている」＝0件なら本当に開催なし。
   SP版は今日＋次の開催日しか載らないので、指定日が無いページを「開催なし」と誤判定しないため。 */
function kaiParseAny(html, d8){
  var v = kaiParseList(html);
  if (v && v.length) return { venues: v, dateSeen: true };
  var sp = kaiParseListSp(html, d8);
  if (sp && sp.length) return { venues: sp, dateSeen: true };
  var s = String(html || '');
  var dateSeen = !d8 ? true :
    (s.indexOf('data-kaisaidate="' + d8 + '"') >= 0 || s.indexOf('kaisai_date=' + d8) >= 0 ||
     /RaceList_DataList|RaceList_DataTitle/i.test(s));
  return { venues: [], dateSeen: dateSeen };
}
/* レース一覧を取得（候補URLを順に試し、解釈できたものを採用）→ { html, venues } */
function kaiFetchListHtml(d8){
  var urls = kaiListUrls(d8);
  var errs = [];
  function next(i){
    if (i >= urls.length){
      return Promise.reject(new Error(errs.length ? errs[errs.length - 1] : '取得に失敗しました'));
    }
    return kaiFetchAny(urls[i]).then(function(html){
      var v = kaiParseAny(html, d8);
      if (v.venues.length) return { html: html, venues: v.venues };
      if (v.dateSeen && kaiListLooksValid(html)) return { html: html, venues: [] };   // 指定日の掲載あり＆0件＝開催なし
      errs.push('一覧として解釈できない応答でした（' + urls[i] + '）');
      return next(i + 1);
    }).catch(function(e){
      errs.push((e && e.message || e) + '（' + urls[i] + '）');
      return next(i + 1);
    });
  }
  return next(0);
}

/* 取得したHTMLが「レース一覧ページ」の体裁か（中継が動いているかの判定に使う）
   - 体裁あり & データ0件 → その日は開催なし
   - 体裁なし(空/エラーページ等) → 中継・通信の問題 ※以前は両方「開催なし」と表示して原因が分からなかった */
function kaiListLooksValid(html){
  return /RaceList_Body|RaceList_Box|RaceList_DataList|RaceList_DataTitle|RaceListDayWrap|jyo_tab/i.test(String(html || ''));
}
/* ===== netkeiba レース一覧HTMLのパース（PC版 race_list_sub） ===== */
function kaiClean(s){ return (typeof nkCleanName === 'function') ? nkCleanName(s) : String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function kaiParseList(html){
  var venues = [];
  if (!html || !/<dl class="RaceList_DataList">/i.test(html)) return venues;
  var parts = String(html).split(/<dl class="RaceList_DataList">/i);
  for (var k = 1; k < parts.length; k++){
    var block = parts[k];
    // 場名と「○回○日目」
    var tm = block.match(/RaceList_DataTitle[^>]*>[\s\S]*?<small>\s*([\s\S]*?)<\/small>\s*([^<]+?)\s*<small>\s*([\s\S]*?)<\/small>/i);
    var vname = tm ? kaiClean(tm[2]) : '';
    if (!vname) continue;
    var kaisaiTxt = (kaiClean(tm[1]) || '') + (kaiClean(tm[3]) || '');   // 「4回」+「1日目」
    // 馬場（芝・ダ）はヘッダ部のテキストから（重複トークンは1つに）
    var head = block.slice(0, Math.max(0, block.search(/<dd class="RaceList_Data"/i)));
    var ht = kaiClean(head);
    var baba = '';
    var seen = {};
    var bm = ht.match(/[芝ダ][^　\s，。、]{0,10}?[:：]\s*[^　\s，。、]{0,4}/g) || [];
    for (var bi = 0; bi < bm.length; bi++){
      var tok = bm[bi].trim().replace(/\s+/g, '');
      if (!tok) continue;
      if (!seen[tok]){ seen[tok] = 1; baba += (baba ? ' / ' : '') + tok; }
    }
    // レース行
    var races = [], rx = /<li class="RaceList_DataItem[^"]*"[^>]*>([\s\S]*?)<\/li>/gi, m;
    while ((m = rx.exec(block)) !== null){
      var row = m[1];
      var ridM = row.match(/race_id=(\d{10,12})/);
      var numM = row.match(/Race_Num[\s\S]*?>[\s\S]{0,40}?(\d{1,2})R\s*</i);
      var nameM = row.match(/<span class="ItemTitle">([\s\S]*?)<\/span>/i);
      var timeM = row.match(/RaceList_Itemtime[^>]*>([\s\S]*?)<\/span>/i);
      var cm = row.match(/RaceList_Itemtime[^>]*>[\s\S]*?<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>\s*<span class="RaceList_Itemnumber">([\s\S]*?)<\/span>/i);
      if (!ridM || !numM) continue;
      races.push({
        r: parseInt(numM[1], 10),
        raceId: ridM[1],
        name: kaiClean(nameM ? nameM[1] : ''),
        time: kaiClean(timeM ? timeM[1] : ''),
        cond: kaiClean(cm ? cm[1] : ''),
        count: kaiClean(cm ? cm[2] : '')
      });
    }
    races.sort(function(a, b){ return a.r - b.r; });
    venues.push({ venue: vname, kaisai: kaisaiTxt, baba: baba, races: races });
  }
  return venues;
}

/* ===== レース一覧の取得と表示 ===== */
function kaiStatus(msg, isErr){
  var el = $('kaiStatus'); if (!el) return;
  el.innerHTML = (isErr ? '⚠ ' : '') + esc(msg);
  if (isErr) el.style.color = 'var(--err-ink)'; else el.style.color = '';
}
function kaiBusy(b){
  var a = $('kaiFetch'), c = $('kaiPrev'), d = $('kaiNext'), e = $('kaiToday');
  [a, c, d, e].forEach(function(x){ if (x) x.disabled = b; });
}
function kaiLogLines(lines){
  var el = $('kaiLog'); if (!el) return;
  el.style.display = lines && lines.length ? '' : 'none';
  if (el && lines && lines.length) el.innerHTML = lines.map(function(l){ return esc(l); }).join('<br>');
}

function kaiFetchList(){
  var d8 = kaiTo8($('kaiDate') ? $('kaiDate').value : '');
  if (!d8){ kaiStatus('日付を入力してください（例: ' + kaiToday8() + ' 今日）', true); return; }
  kaiBusy(true);
  kaiStatus('開催一覧を取得中…（' + kaiDateLabel(d8) + '）');
  var log = $('kaiLog'); if (log) log.style.display = 'none';
  kaiFetchListHtml(d8).then(function(res){
    var html = res.html, venues = res.venues;
    if (!venues.length){
      kaiBusy(false);
      kai.cache = null;   // 開催なしの日は一覧を残さない
      var card = $('kaiListCard'); if (card) card.style.display = 'none';
      if (!kaiListLooksValid(html)){
        kaiStatus('⚠ レース一覧の内容を解釈できませんでした（中継(リレー)の応答が空・不正の可能性）。「①データ入力」→「URL取込の通信設定」→「🔧 中継を診断」でご確認ください。', true);
      } else {
        kaiStatus('この日は開催データがありませんでした。JRAの開催日（主に土日）を選んでください。または前日/翌日ボタンで前後を確認できます。', true);
      }
      return;
    }
    kai.cache = { date: d8, venues: venues };
    var ls = kaiLs();
    ls.cache = { date: d8, venues: venues };
    kaiLsSet(ls);
    var total = 0;
    venues.forEach(function(v){ total += v.races.length; });
    kaiStatus('✅ ' + kaiDateLabel(d8) + ' の開催 ' + venues.length + '場 / ' + total + 'レース を取得しました。レースをタブで選んでください。');
    kaiRenderVenues();
    if (venues.length && venues[0].races && venues[0].races.length){
      kaiSelectRace(venues[0].races[0].raceId);
    }
    kaiBusy(false);
  }).catch(function(e){
    kaiBusy(false);
    kaiStatus('取得に失敗: ' + (e && e.message || e) + '。この一覧の取得は出馬表と同じ中継(リレー)が必要です。「①データ入力」の「URL取込の通信設定」→「🔧 中継を診断」をご確認ください。', true);
    var log2 = $('kaiLog'); if (log2) log2.style.display = 'none';
  });
}

function kaiRenderVenues(){
  var card = $('kaiListCard'), wrap = $('kaiVenues'), chip = $('kaiListChip');
  if (!card || !wrap) return;
  if (!kai.cache || !kai.cache.venues || !kai.cache.venues.length){ card.style.display = 'none'; return; }
  card.style.display = '';
  if (chip) chip.textContent = kaiDateLabel(kai.cache.date);
  // raceId→race 索引
  var byId = {};
  kai.cache.venues.forEach(function(v){ v.races.forEach(function(r){ byId[r.raceId] = { venue: v.venue, kaisai: v.kaisai, baba: v.baba, race: r }; }); });
  var ls = kaiLs(), doneSet = {};
  (ls.hist || []).forEach(function(h){ if (h.raceId) doneSet[h.raceId] = true; });
  var html = kai.cache.venues.map(function(v){
    var btns = v.races.map(function(r){
      var on = (kai.sel && kai.sel.raceId === r.raceId) ? ' on' : '';
      var dn = doneSet[r.raceId] ? ' done' : '';
      return '<button type="button" class="kai-rbtn' + on + dn + '" data-rid="' + esc(r.raceId) + '" data-venue="' + esc(v.venue) + '" data-r="' + r.r + '" title="' + esc(r.name) + '｜' + esc((r.cond || '') + ' ' + (r.count || '')) + '">' + r.r + 'R</button>';
    }).join('');
    return '<div class="kai-venue"><div class="vh"><span class="vt">' + esc(v.venue) + '</span>' +
      (v.kaisai ? '<span class="vk">' + esc(v.kaisai) + '</span>' : '') +
      (v.baba ? '<span class="vk">' + esc(v.baba) + '</span>' : '') +
      '<span class="vk">' + v.races.length + 'レース</span></div>' +
      '<div class="kai-tabs">' + btns + '</div></div>';
  }).join('');
  wrap.innerHTML = html;
}

function kaiFindRace(rid){
  if (!kai.cache) return null;
  for (var i = 0; i < kai.cache.venues.length; i++){
    var v = kai.cache.venues[i];
    for (var j = 0; j < v.races.length; j++){
      if (v.races[j].raceId === rid) return { venue: v.venue, kaisai: v.kaisai, baba: v.baba, race: v.races[j] };
    }
  }
  return null;
}
function kaiSelectRace(rid){
  var f = kaiFindRace(rid);
  if (!f) return;
  var rr = f.race;
  kai.sel = { venue: f.venue, r: rr.r, name: rr.name, time: rr.time, cond: rr.cond, count: rr.count, raceId: rr.raceId, date: kai.cache.date };
  // タブの見た目を更新
  document.querySelectorAll('.kai-rbtn').forEach(function(b){
    var on = b.getAttribute('data-rid') === rid;
    b.classList.toggle('on', on);
  });
  kaiRenderDetail();
}
function kaiRenderDetail(){
  var el = $('kaiDetail'); if (!el) return;
  var s = kai.sel; if (!s){ el.style.display = 'none'; return; }
  var ls = kaiLs();
  var hist = (ls.hist || []).filter(function(h){ return h.raceId === s.raceId; })[0];
  var chip = hist ? '<span class="chip" style="background:var(--card2);color:var(--ok-ink)">✓ 読み込み済み（' + (hist.savedAt ? kaiTimeText(hist.savedAt) : '') + '）</span>' : '';
  var title = (s.name || 'レース名不明') + (s.venue ? '（' + s.venue + ' ' + s.r + 'R）' : '');
  el.style.display = '';
  el.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<h3 style="margin:0">' + esc(title) + '</h3>' + chip +
      '<span class="sp" style="flex:1"></span>' +
      '<a class="btn ghost" style="text-decoration:none;padding:4px 10px;font-size:.8rem" target="_blank" rel="noopener" href="https://race.netkeiba.com/race/shutuba.html?race_id=' + esc(s.raceId) + '">netkeiba出馬表 ↗</a>' +
      '<button type="button" class="btn ghost" id="kaiBtnJra" style="padding:4px 10px;font-size:.8rem" title="このレースのJRA公式結果ページを自動解決して新しいタブで開く(レース映像の▶PLAYは公式ページ内)">🎬 JRA公式映像 ↗</button>' +
    '</div>' +
    '<div class="kai-meta">' +
      '<span>開催日：<b>' + esc(kaiDateLabel(s.date)) + '</b></span>' +
      (s.venue ? '<span>競馬場：<b>' + esc(s.venue) + '</b></span>' : '') +
      (s.kaisai ? '' : '') +
      (s.time ? '<span>発走：<b>' + esc(s.time) + '</b></span>' : '') +
      (s.cond ? '<span>条件・距離：<b>' + esc(s.cond) + '</b></span>' : '') +
      (s.count ? '<span>出走予定：<b>' + esc(s.count) + '</b></span>' : '') +
    '</div>' +
    '<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<button type="button" class="btn primary" id="kaiBtnLoad">📥 このレースの出馬表を読み込む（自動保存）</button>' +
      '<span class="small muted">読み込むと現在のレースをこのレースに置き換え、履歴にも自動保存されます。</span>' +
    '</div>';
  var b = $('kaiBtnLoad'); if (b) b.onclick = function(){ kaiLoadSelected(); };
  var jb = $('kaiBtnJra');
  if (jb) jb.onclick = function(){
    // ⑤ JRA映像タブを開き、選択レースをセットして自動解決
    if (typeof goTab === 'function') goTab('t-jravideo');
    if (typeof jvQuickGo === 'function') jvQuickGo();
  };
  var log = $('kaiLog'); if (log) log.style.display = 'none';
}
function kaiTimeText(iso){
  if (!iso) return '';
  try { return String(iso).slice(5, 16).replace('T', ' '); } catch(e){ return ''; }
}

/* ===== 出馬表の読込（既存パーサ再利用）＋自動保存 ===== */
function kaiLoadSelected(){
  var s = kai.sel;
  if (!s || !s.raceId){ return; }
  var d8 = '';
  try { d8 = String((kai.cache && kai.cache.date) || s.date || ''); } catch(e){}
  kaiImportByRaceId(s.raceId, { d8: d8 });
}
function kaiImportByRaceId(rid, opt){
  opt = opt || {};
  if (typeof nkFetchCardText !== 'function' || typeof nkParseShutuba !== 'function'){
    kaiStatus('出馬表の取込機能が読み込まれていません。', true);
    return;
  }
  var log = [];
  kaiBusy(true);
  /* ★2026-09-13 第21弾①: 「📥 その日の出馬表を一括取得」で既に取ってある出馬表を、
     レース選択のたびに取り直していたのをやめました（端末内キャッシュから復元＝通信ゼロ・待ち時間ゼロ）。
     履歴の「再取得」ボタンや opt.force=true のときだけ netkeiba に取りに行きます。 */
  var hadCache = false;
  try { hadCache = !opt.force && (typeof nkCardHas === 'function') && nkCardHas(rid); } catch(e){}
  kaiLogLines([hadCache
    ? 'レースID ' + rid + ' の出馬表は<b>取得済み</b>です（端末内のキャッシュから復元します・通信しません）…'
    : 'レースID ' + rid + ' の出馬表を取得中…（初回は数秒かかります）']);
  nkFetchCardText(rid, { force: !!opt.force, d8: opt.d8 || '' }).then(function(html){
    var meta = nkParseRaceMeta(html);
    var list = nkParseShutuba(html);
    if (!list.length) throw new Error('出馬表の行を解析できませんでした（netkeiba側の表示変更の可能性）。');
    /* ★第21弾①: 出馬表を「取り直した」のか「キャッシュから復元した」のかを必ず残す
       （kaiLogLines(log) で表示ログが置き換わるため、ここに入れないと消えます） */
    log.push(hadCache
      ? '⚡ 出馬表は<b>取得済みキャッシュから復元</b>しました（netkeiba への通信なし・' + list.length + '頭）。取り直したいときは「🔄 取り直す（再取得）」を押してください。'
      : '🌐 出馬表を netkeiba から取得しました（' + list.length + '頭）。次回このレースを選ぶときは端末内キャッシュから復元します。');
    // 現在のレースとして取込（出馬表＋レース情報）
    if (!state.horses.length){
      state.horses = list.map(function(p){
        return mkHorse({ frame: p.frame, no: p.no, name: p.name, sexAge: p.sexAge, weight: p.weight, jockey: p.jockey, nk: p.nk || '' });
      });
      log.push('✅ 出馬表 ' + list.length + '頭を入力しました');
    } else {
      log.push('出馬表 ' + list.length + '頭 を読み込み → 現在の' + state.horses.length + '頭と入れ替え…');
      applyNkHorses(list, log);
      log.push('✅ 出馬表を ' + list.length + '頭に入れ替えました（同じ馬番の調教・持ちタイム等は保持）');
    }
    applyNkRaceMeta(meta);
    state.raceId = rid; state.raceAt = Date.now();
    var d8 = nkSetRaceDate8(meta);        // ★第19弾①: レース日を確定（前走データ・騎手成績・履歴特徴の基準日）
    if (d8) log.push('📅 レース日: ' + d8.slice(0,4) + '/' + d8.slice(4,6) + '/' + d8.slice(6,8) + '（前走データ・騎手成績の基準日として確定しました）');
    // 自己学習用に馬データを記録
    if (typeof apEnsureLive === 'function'){ try { apEnsureLive(rid); } catch(e){} }
    // 自動保存（現在レース）
    saveNow();
    // 履歴にもスナップショット保存
    kaiAddHist(rid);
    rebuildHorseTable();
    log.push('📋 レース情報: ' + esc(String(state.race.name || '')));
    log.push('💾 自動保存しました。「読み込み履歴」からいつでも復元できます。');
    kaiLogLines(log);
    kaiRenderVenues();
    kaiRenderHist();
    // 出馬表画面へ（内容をすぐ確認できるように）
    if (typeof goTab === 'function') goTab('t-input');

    /* ★2026-09-13 第19弾①: 日付指定・開催からの読み込みでは【出馬表しか取っていなかった】ため、
       単勝オッズ（AI印の最重要ファクター）が空のまま → ②予想タブの順位がほぼ平坦になり
       「レースが反映されていない」ように見えていました。
       ここで 🔎レース名検索（nkImportBoth）と同じようにオッズまで自動取得し、
       取得後に ②予想タブの全カードを描き直します。 */
    kaiLogLines(['👉 続けて単勝オッズを自動取得します…（発売前は空のことがあります）']);
    nkOddsApplyById(rid).then(function(r){
      var l2 = [];
      if (r && r.ok){
        l2.push('✅ ' + r.msg);
        l2.push('📈 オッズを反映して ②AI予想タブを描き直しました。');
        /* ★2026-09-13 第23弾①: いま最新を取ったばかりなので、直後に②予想タブを開いても
           同じオッズをもう一度取りに行かないように基準時刻を合わせておきます。
           （20秒以上たってから開けば、改めて最新を取り直します） */
        try { if (typeof nkOddsMarkFresh === 'function') nkOddsMarkFresh(rid); } catch(e4){}
      } else {
        l2.push('⚠ オッズを取得できませんでした: ' + esc((r && r.msg) || '不明な理由'));
        l2.push('💡 発売前（前日以前）は netkeiba のオッズAPIが空を返します。発走当日にもう一度「オッズ取得」を押してください。');
        l2.push('　※ 出馬表・レース情報は取り込み済みなので、①の「単勝オッズ」欄に手入力しても ②に反映されます。');
      }
      rebuildHorseTable();
      saveNow();
      if (typeof updateGridHints === 'function'){ try { updateGridHints(); } catch(e){} }
      // ② 予想タブのレース（AI印・軸/妙味/穴・買い目提案・前日馬場など）をまとめて描き直す
      if (typeof renderKentaiFull === 'function'){ try { renderKentaiFull(); } catch(e){} }
      kaiLogLines(l2);
      kaiBusy(false);
      /* ★2026-09-13 第20弾: 🤖自動マクロ — 出馬表＋オッズの取得に紐づけて
         (B) 全馬のプロフィール・戦績・成績分析 → 上3F・前走タイムの自動反映、
         (A) 選んだ日付の【他のレースも自動検出】（事前予想を保存）
         を直列で実行します。①の「🤖 自動マクロ」カードで個別にOFFにできます。
         (A) は state.horses を一時差し替えするので、必ず (B) が終わってから動かします（p59 amAfterImport）。 */
      try {
        if (typeof amAfterImport === 'function'){
          var amD8 = String((state.meta && state.meta.date8) || '').replace(/[^0-9]/g, '');
          if (!/^\d{8}$/.test(amD8)) amD8 = '';
          amAfterImport(rid, amD8);
        }
      } catch(e3){}
    }).catch(function(e){
      kaiLogLines(['⚠ オッズ取得でエラー: ' + esc((e && e.message) || e)]);
      if (typeof renderKentaiFull === 'function'){ try { renderKentaiFull(); } catch(e2){} }
      kaiBusy(false);
      // オッズが取れなくても出馬表は入っているので、自動マクロは動かす（発売前はオッズが空なのが普通）
      try {
        if (typeof amAfterImport === 'function'){
          var amD8b = String((state.meta && state.meta.date8) || '').replace(/[^0-9]/g, '');
          if (!/^\d{8}$/.test(amD8b)) amD8b = '';
          amAfterImport(rid, amD8b);
        }
      } catch(e3){}
    });
  }).catch(function(e){
    log.push('⚠ 出馬表取得失敗: ' + esc(e && e.message || e));
    log.push('💡 「URL取込の通信設定」→「🔧 中継を診断」で、今の公開先で出馬表の取得が動くかを確認してください。');
    kaiLogLines(log);
    kaiBusy(false);
  });
}

/* ===== 履歴（自動保存リスト） ===== */
/* ★第22弾: 履歴に載せる「開催日」を確定している情報から取ります。
   以前はここに `rid.slice(0, 8)` を入れていました。ところが
     race_id = 202609040311 = 2026年・09月・**4回**・3日目・11R
   で、**先頭8桁は日付ではありません**（YYYYMM＋回）。
   → 2026/9/12 の阪神11R が「2026年9月4日(金)」と誤表示されていました。
   日付ピッカー経由でない取込（URL取込・履歴の復元・記事からの参照）で必ず起きるため修正します。
   予想ロジックには影響しません（表示だけ）。AIが使う基準日は nkSetRaceDate8() が
   ページ本文から正しく確定して state.raceDate8 に入れています。 */
function kaiD8ok(v){ return /^\d{8}$/.test(String(v == null ? '' : v)) ? String(v) : ''; }
function kaiHistDate8(rid, entry){
  /* ① 日付ピッカーで選んだ開催日 */
  try { var d1 = kaiD8ok(kai.cache && kai.cache.date); if (d1) return d1; } catch(e){}
  /* ② 出馬表ページから確定したレース日（nkSetRaceDate8 が state.raceDate8 に入れる） */
  try { var d2 = kaiD8ok(typeof state !== 'undefined' && state && state.raceDate8); if (d2) return d2; } catch(e){}
  /* ③ state.race.date（applyNkRaceMeta がページの見出しから入れる） */
  try {
    var raw = (typeof state !== 'undefined' && state && state.race && state.race.date) || '';
    var d3 = kaiD8ok(typeof kaiTo8 === 'function' ? kaiTo8(raw) : raw);
    if (d3) return d3;
  } catch(e){}
  /* ④ 保存済みスナップショットに日付が残っていればそれ */
  try {
    var raw2 = (entry && entry.race && entry.race.date) || '';
    var d4 = kaiD8ok(typeof kaiTo8 === 'function' ? kaiTo8(raw2) : raw2);
    if (d4) return d4;
  } catch(e){}
  /* ⑤ 出馬表キャッシュのページ見出し（第22弾で追加した nkCardD8FromHtml） */
  try {
    if (rid && typeof nkCardGet === 'function' && typeof nkCardD8FromHtml === 'function'){
      var h = nkCardGet(rid);
      if (h){ var d5 = kaiD8ok(nkCardD8FromHtml(h)); if (d5) return d5; }
    }
  } catch(e){}
  /* どれも無ければ空。空なら日付を表示しないだけで、間違った日付を出すよりマシです。 */
  return '';
}
/* 既に保存されている履歴のうち、旧バグ（rid先頭8桁を日付にした）ぶんを直せるだけ直す。
   保存済みスナップショット(entry.race.date)から復元できる場合だけ上書きするので安全です。 */
function kaiFixHistDates(ls){
  if (!ls || !Array.isArray(ls.hist)) return false;
  var changed = false;
  ls.hist.forEach(function(h){
    if (!h || !h.raceId) return;
    var cur = kaiD8ok(h.date);
    if (!cur) return;                                   // もともと日付なし → 何もしない
    /* rid 先頭8桁と一致するもの＝旧フォールバックで作られた値だけを対象にする。
       一致しない（＝ちゃんとページから拾えた）日付は絶対に触りません。 */
    if (cur !== String(h.raceId).slice(0, 8)) return;
    var fixed = '';
    try {
      var raw = (h.race && h.race.date) || '';
      fixed = kaiD8ok(typeof kaiTo8 === 'function' ? kaiTo8(raw) : raw);
    } catch(e){}
    if (fixed){
      if (fixed !== h.date){ h.date = fixed; changed = true; }
    } else {
      /* 復元できない場合は空にします。曜日まで付いた**自信満々の誤表示**
         （2026年9月4日(金) など）を出すより、日付を出さないほうがマシです。 */
      h.date = ''; changed = true;
    }
  });
  return changed;
}
function kaiAddHist(rid){
  var ls = kaiLs();
  if (!Array.isArray(ls.hist)) ls.hist = [];
  var entry = {
    raceId: rid,
    savedAt: new Date().toISOString(),
    date: kaiHistDate8(rid, null),   // ★第22弾: rid先頭8桁は日付ではないので使わない
    place: state.race.place || '',
    rnum: (function(){
      var m = String(state.race.name || '').match(/(\d{1,2})R/);
      return m ? m[1] : '';
    })(),
    name: state.race.name || '',
    dist: state.race.dist || '',
    grade: state.race.grade || '',
    baba: state.race.baba || '',
    horses: state.horses.map(function(h){ return Object.assign({}, h); }),
    race: Object.assign({}, state.race)
  };
  var i = ls.hist.findIndex(function(h){ return h && h.raceId === rid; });
  if (i >= 0) ls.hist[i] = entry; else ls.hist.unshift(entry);
  // 上限50件（古いものから削除）
  if (ls.hist.length > 50) ls.hist.length = 50;
  kaiLsSet(ls);
}
/* =========================================================
   ★2026-09-13 第25弾④: 出遅れ率・予想印をつけたら読み込み履歴に自動保存
   ---------------------------------------------------------
   kaiAddHist() は state.horses を丸ごと（出遅れ率 slow / 印 mark / 脚質 / 持ちタイム 等）
   スナップショットし、kaiRestoreHist() でそのまま復元できます。
   ところが呼び出しは【取込時】と【⑤タブを開いたとき】だけだったため、
   取込後に出遅れ率や印を入力しても履歴には残りませんでした（＝あとで見返せない）。
   → saveNow()（入力のたびに呼ばれる）から、900ms の防抖でスナップショットを更新します。

   履歴に【無い】レースは、出遅れ率か印を入力したときだけ自動追加します。
   （何も入力していないレースまで履歴を増やすと、⑤の一覧がノイズで埋まるため）
   ========================================================= */
var kaiTouchT = 0;
/* 入力された「出遅れ率 or 印」があるか */
function kaiHasAnnotation(){
  try {
    return (state.horses || []).some(function(h){
      if (!h) return false;
      var sl = 0;
      try { sl = (typeof slowPctOf === 'function') ? slowPctOf(h.slow) : (parseFloat(h.slow) || 0); } catch(e){}
      if (sl > 0) return true;
      return !!String(h.mark || '').trim();
    });
  } catch(e){ return false; }
}
function kaiTouchHistNow(){
  try {
    if (!state.raceId || !state.horses || !state.horses.length) return false;
    var ls = kaiLs();
    var inHist = (ls.hist || []).some(function(h){ return h && h.raceId === state.raceId; });
    if (inHist){ kaiAddHist(state.raceId); return true; }        // 既にある → スナップショット更新
    if (kaiHasAnnotation()){ kaiAddHist(state.raceId); return true; }  // 印/出遅れ率をつけた → 自動追加
    return false;
  } catch(e){ return false; }
}
function kaiTouchHist(){
  try {
    if (!state.raceId || !state.horses || !state.horses.length) return;
    if (kaiTouchT) clearTimeout(kaiTouchT);
    kaiTouchT = setTimeout(function(){
      kaiTouchT = 0;
      kaiTouchHistNow();
      try { if (typeof kaiRenderHist === 'function') kaiRenderHist(); } catch(e){}
    }, 900);
  } catch(e){}
}
function kaiRestoreHist(rid){
  var ls = kaiLs();
  var h = (ls.hist || []).filter(function(x){ return x && x.raceId === rid; })[0];
  if (!h) return;
  if (!h.horses) h.horses = [];
  state.race = Object.assign(defaultRace(), h.race || {});
  state.horses = h.horses.map(function(x){ return Object.assign({}, x); });
  state.raceId = rid; state.raceAt = Date.now();
  syncRaceDomFromState();
  refreshRaceLine();
  rebuildHorseTable();
  saveNow();
  if (typeof goTab === 'function') goTab('t-input');
  /* ★2026-09-13 第23弾①: 履歴からの復元は「保存したときのオッズ」に戻るので、
     必ず最新の単勝オッズを取り直してから出馬表・②のAI予想に反映します。 */
  try {
    if (typeof nkOddsRefreshForView === 'function') nkOddsRefreshForView('読み込み履歴から復元しました', { force: true });
  } catch(e){}
}
function kaiDeleteHist(rid){
  var ls = kaiLs();
  ls.hist = (ls.hist || []).filter(function(h){ return h && h.raceId !== rid; });
  kaiLsSet(ls);
  kaiRenderHist();
  kaiRenderVenues();
}
function kaiRenderHist(){
  var box = $('kaiHist'), empty = $('kaiHistEmpty'); if (!box) return;
  var ls = kaiLs();
  /* ★第22弾: 旧バージョンで「rid先頭8桁＝日付」として保存された履歴を、直せるぶんだけ直す */
  try { if (kaiFixHistDates(ls)) kaiLsSet(ls); } catch(e){}
  var hist = ls.hist || [];
  if (empty) empty.style.display = hist.length ? 'none' : '';
  var curId = state.raceId || '';
  var html = hist.map(function(h){
    var ttl = (h.place ? (esc(h.place) + ((h.rnum ? ' ' + h.rnum + 'R' : ''))) : '') + '　' + (esc(h.name || ''));
    if (!h.place && !h.name) ttl = esc((h.raceId || '')) ;
    var isCur = h.raceId === curId;
    return '<div class="row">' +
      '<button type="button" class="btn primary" style="padding:4px 12px;font-size:.8rem" data-restore="' + esc(h.raceId) + '">復元</button>' +
      '<div class="hd">' + ttl +
        ' <span class="small muted">(' + (h.date ? esc(kaiDateLabel(h.date)) + ' / ' : '') + esc((h.place || '') + ((h.rnum ? h.rnum + 'R' : ''))) + ')</span>' +
        (isCur ? ' <span class="chip" style="background:var(--card2);color:var(--ok-ink)">現在のレース</span>' : '') +
        '<div class="small muted" style="margin-top:2px">' + esc(h.raceId || '') + '｜保存 ' + esc(kaiTimeText(h.savedAt)) + (h.horses ? '｜' + h.horses.length + '頭' : '') + '</div>' +
      '</div>' +
      '<button type="button" class="btn ghost" style="padding:3px 10px;font-size:.78rem" data-refetch="' + esc(h.raceId) + '">再取得</button>' +
      '<button type="button" class="kai-mini" data-del="' + esc(h.raceId) + '">削除</button>' +
    '</div>';
  }).join('');
  box.innerHTML = html;
  box.querySelectorAll('[data-restore]').forEach(function(b){ b.onclick = function(){ kaiRestoreHist(b.getAttribute('data-restore')); }; });
  // ★第21弾①: 「再取得」ボタンは名前どおり必ず netkeiba に取りに行く（キャッシュを無視）
  box.querySelectorAll('[data-refetch]').forEach(function(b){ b.onclick = function(){ kaiImportByRaceId(b.getAttribute('data-refetch'), { force: true }); }; });
  box.querySelectorAll('[data-del]').forEach(function(b){ b.onclick = function(){ kaiDeleteHist(b.getAttribute('data-del')); }; });
}

/* ===== タブ表示時の初期化・更新 ===== */
function kaiRefresh(){
  var dateEl = $('kaiDate');
  if (dateEl && !dateEl.value){
    dateEl.value = kai.cache && kai.cache.date
      ? (kai.cache.date.slice(0,4) + '-' + kai.cache.date.slice(4,6) + '-' + kai.cache.date.slice(6,8))
      : kaiToday8().slice(0,4) + '-' + kaiToday8().slice(4,6) + '-' + kaiToday8().slice(6,8);
  }
  // 現在のレースが履歴にあるなら最新状態をスナップショットへ反映（リフレッシュだけ）
  if (state.raceId && state.horses.length){
    var ls = kaiLs();
    if ((ls.hist || []).some(function(h){ return h && h.raceId === state.raceId; })) kaiAddHist(state.raceId);
  }
  var ls2 = kaiLs();
  if (ls2.cache && (!kai.cache || kai.cache.date !== ls2.cache.date)){
    kai.cache = { date: ls2.cache.date, venues: ls2.cache.venues || [] };
  }
  // 表示中の一覧にない選択（別日のキャッシュ等）は解除
  if (kai.cache && kai.sel && !kaiFindRace(kai.sel.raceId)) kai.sel = null;
  kaiRenderVenues();
  kaiRenderHist();
  kaiRenderDetail();
}
function initKaisai(){
  // ※このビルドの①のピッカーUIは p33(rK*) 側。kai* のUIがHTMLに無い場合でも
  //   例外を投げないこと（存在しないIDで on() が例外を投げると boot() の後半の
  //   初期化が全部止まり、⑥のカレンダー/分析ボタン・①のピッカーが無反応になる。#2026-09-10修正）
  var dateEl = $('kaiDate');
  if (dateEl && !dateEl.value){
    var d = kai.cache && kai.cache.date ? kai.cache.date : kaiToday8();
    dateEl.value = d.slice(0,4) + '-' + d.slice(4,6) + '-' + d.slice(6,8);
  }
  bindIf('kaiFetch', 'click', kaiFetchList);
  bindIf('kaiPrev', 'click', function(){
    var el = $('kaiDate'); if (!el) return;
    el.value = kaiShift(el.value, -1).slice(0,4) + '-' + kaiShift(el.value, -1).slice(4,6) + '-' + kaiShift(el.value, -1).slice(6,8);
  });
  bindIf('kaiNext', 'click', function(){
    var el = $('kaiDate'); if (!el) return;
    el.value = kaiShift(el.value, 1).slice(0,4) + '-' + kaiShift(el.value, 1).slice(4,6) + '-' + kaiShift(el.value, 1).slice(6,8);
  });
  bindIf('kaiToday', 'click', function(){
    var el = $('kaiDate'); if (!el) return;
    var d = kaiToday8();
    el.value = d.slice(0,4) + '-' + d.slice(4,6) + '-' + d.slice(6,8);
  });
  var venuesBox = $('kaiVenues');
  if (venuesBox) venuesBox.addEventListener('click', function(e){
    var b = e.target && e.target.closest ? e.target.closest('.kai-rbtn') : null;
    if (b) kaiSelectRace(b.getAttribute('data-rid'));
  });
  kaiRefresh();
}
