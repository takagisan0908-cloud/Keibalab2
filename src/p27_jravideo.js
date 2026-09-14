/* =========================================================
   27 JRA公式レース映像 への自動ナビ（⑤ JRA映像 タブ / 各所のボタン）
   ---------------------------------------------------------
   JRAの公式映像は「レース結果ページ」内の ▶PLAY ボタンで視聴します。
   公式は iframe 埋め込みを禁止しているため、このタブは
   「日付・競馬場・レース番号」から該当レース結果ページを
   自動で探し出し、新しいタブで開く“導線”を提供します。

   解決フロー（アプリ → 中継リレー 2往復）
     1) accessS.html へ POST (cname=pw01sli00/AF)
        → 開催日リスト(直近約2ヶ月)を取得し、日付×場 → pw01srl…トークンを解決
     2) そのトークンへ POST → その開催日のレース一覧
        → レース番号に一致する 結果ページURL(CNAME=pw01sde…)を取得
     3) https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde…
        を window.open で新しいタブ表示（このURLはGETで開ける）
   掲載対象はJRAが結果ページを公開している「直近約2ヶ月」です。
   ========================================================= */
var JV_LS  = 'khl_jra_video_v1';
var JV_CACHE_MS = 4 * 60 * 60 * 1000;   // 開催日リストのキャッシュ有効時間
var JV_BASE = 'https://www.jra.go.jp/JRADB/accessS.html';
var JV_VENUES = ['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉'];
var JV_VCODE = { 札幌:'001', 函館:'002', 福島:'003', 新潟:'004', 東京:'005', 中山:'006', 中京:'007', 京都:'008', 阪神:'009', 小倉:'010' };

function jvLsGet(){ try { return JSON.parse(cmpUnpack(localStorage.getItem(JV_LS)) || '{}'); } catch(e){ return {}; } }
function jvLsSet(o){ try { localStorage.setItem(JV_LS, cmpPack(JSON.stringify(o))); } catch(e){} }
function jvD8(yyyymmdd){ // 任意の 'YYYY-MM-DD' / 'YYYYMMDD' / 和暦っぽい文字列 → YYYYMMDD
  if (!yyyymmdd) return '';
  var s = String(yyyymmdd).trim();
  if (/^\d{8}$/.test(s)) return s;
  var m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2);
  return '';
}
function jvVenueName(code){
  var n = parseInt(code, 10);
  return (n >= 1 && n <= 10) ? JV_VENUES[n - 1] : '';
}
function jvDateLabel(d8){
  if (!/^\d{8}$/.test(d8 || '')) return d8 || '';
  var y = parseInt(d8.slice(0,4),10), m = parseInt(d8.slice(4,6),10), d = parseInt(d8.slice(6,8),10);
  return y + '年' + m + '月' + d + '日';
}

/* ===== 中継リレー（POST対応） ===== */
function jvRelayBuild(base, url, method, body){
  var sep = base.indexOf('?') >= 0 ? '&' : '?';
  var s = nkRelayBuild(base, url);
  if (method && method !== 'GET'){   // nkRelayBuild で method/body を付けるため分岐は残す
    s += '&method=' + encodeURIComponent(method) + '&body=' + encodeURIComponent(body || '');
  }
  return s;
}
function jvFetchTimeout(url, ms){
  return new Promise(function(res, rej){
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function(){ if (ctrl) ctrl.abort(); }, ms || 18000);
    fetch(url, { signal: ctrl ? ctrl.signal : undefined, cache: 'no-store',
      headers: { 'Accept': 'text/html,application/json,*/*' } })
      .then(function(r){ clearTimeout(timer); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function(t){ res(typeof nkRepairText === 'function' ? nkRepairText(t) : t); })
      .catch(function(e){ clearTimeout(timer); rej(e); });
  });
}
/* url へ method(既定GET)/body でアクセスし、中継候補を順に試す */
function jvFetchAny(url, method, body){
  var cands = (typeof nkRelayCandidates === 'function') ? nkRelayCandidates() : [];
  var lastErr = null, triedDirect = false;
  return new Promise(function(res, rej){
    function direct(){
      triedDirect = true;
      jvFetchTimeout(method && method !== 'GET'
        ? url  // 直接POSTはできません（formエンコードも不可のためCORS環境のみ試す）
        : url, 12000).then(res).catch(function(e){
        rej(new Error('中継も直接も失敗: ' + (e && e.message || e)));
      });
    }
    function next(i){
      if (i >= cands.length){ if (!triedDirect) direct(); else rej(new Error('取得失敗（中継不通）: ' + (lastErr ? lastErr.message : '通信不可'))); return; }
      var full = jvRelayBuild(cands[i], url, method, body);
      jvFetchTimeout(full, 18000).then(function(t){
        var ok = t && t.length > 200 && /<html|<!doctype|<table/i.test(t);
        if (!ok){ lastErr = new Error('中継応答が不正(' + cands[i] + ')'); next(i + 1); return; }
        res(t);
      }).catch(function(e){ lastErr = e; next(i + 1); });
    }
    next(0);
  });
}

/* ===== 開催日リスト（1往復目） ===== */
function jvParseDaySelect(html){
  // accessS.html(POST pw01sli00) 内の 場×日 → doAction('...accessS.html','pw01srl…') を収集
  var map = {};
  var rx = /pw01srl1(\d{3})(\d{8})(\d{8})\/([0-9A-Z]{2})/g, m;
  while ((m = rx.exec(html || '')) !== null){
    var code = m[1], date = m[3], token = 'pw01srl1' + m[1] + m[2] + m[3] + '/' + m[4];
    map[date + '|' + code] = token;
  }
  return map;
}
function jvFetchDaySelect(){
  var ls = jvLsGet();
  if (ls && ls.d && ls.t && (Date.now() - ls.t) < JV_CACHE_MS){
    return Promise.resolve(ls.d);
  }
  return jvFetchAny(JV_BASE, 'POST', 'cname=pw01sli00/AF').then(function(html){
    var d = jvParseDaySelect(html);
    if (!Object.keys(d).length) throw new Error('JRAの開催日リストを解析できませんでした（JRA側の変更か、掲載対象外の可能性）');
    jvLsSet({ t: Date.now(), d: d });
    return d;
  });
}

/* ===== レース一覧（2往復目） ===== */
function jvParseRaceList(html){
  // 開催1日のレース結果一覧 <tr> … CNAME=pw01sde… を収集
  var out = [];
  var trs = (html || '').match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (var i = 0; i < trs.length; i++){
    var tr = trs[i];
    var cm = tr.match(/CNAME=(pw01sde1(\d{3})(\d{8})(\d{2})(\d{8})\/[0-9A-Z]{2})/i);
    if (!cm) continue;
    var r = parseInt(cm[4], 10);
    if (!r || r < 1 || r > 20) continue;
    var alt = tr.match(/alt="(\d{1,2})レース"/);
    if (alt) r = parseInt(alt[1], 10);
    var name = '';
    var nm = tr.match(/<td[^>]*class="[^"]*race_name[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    if (nm) name = (typeof nkCleanName === 'function') ? nkCleanName(nm[1]) : String(nm[1]).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    var dist = '', course = '';
    var dm = tr.match(/<td[^>]*class="[^"]*\bdist\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    if (dm) dist = (typeof nkCleanName === 'function') ? nkCleanName(dm[1]) : String(dm[1]).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    var cm2 = tr.match(/<td[^>]*class="[^"]*\bcourse\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    if (cm2) course = (typeof nkCleanName === 'function') ? nkCleanName(cm2[1]) : String(cm2[1]).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    out.push({ r: r, name: name, dist: dist, course: course, token: cm[1] });
  }
  out.sort(function(a, b){ return a.r - b.r; });
  return out;
}
function jvFetchRaceList(dayVenueToken){
  return jvFetchAny(JV_BASE, 'POST', 'cname=' + dayVenueToken).then(function(html){
    var list = jvParseRaceList(html);
    if (!list.length) throw new Error('レース一覧を解析できませんでした（JRA側の変更の可能性）');
    return list;
  });
}

/* ===== 主処理：日付+場+R → JRA結果ページURL ===== */
function jvResolve(ctx){
  ctx = ctx || {};
  var date8 = jvD8(ctx.date8 || ctx.date || '');
  var venue = String(ctx.venue || '').trim();
  var r = parseInt(ctx.r, 10);
  if (!date8) return Promise.reject(new Error('開催日が指定されていません'));
  if (!JV_VCODE[venue]) return Promise.reject(new Error('競馬場が不明です: ' + venue));
  if (!(r >= 1)) return Promise.reject(new Error('レース番号(R)が指定されていません'));
  var code = JV_VCODE[venue];
  var steps = [];
  var force = false;
  function attempt(){
    return jvFetchDaySelect().then(function(days){
      var token = days[date8 + '|' + code];
      if (!token){
        var err = new Error('この開催はJRA結果ページの掲載対象外です（掲載は直近約2ヶ月・開催済みレースのみ）。\n対象: ' + jvDateLabel(date8) + ' ' + venue + r + 'R');
        err.outOfWindow = true;
        throw err;
      }
      steps.push('開催日リスト取得OK → ' + jvDateLabel(date8) + ' ' + venue + ' を選択');
      return jvFetchRaceList(token).then(function(list){
        var hit = null;
        for (var i = 0; i < list.length; i++){ if (list[i].r === r){ hit = list[i]; break; } }
        if (!hit){
          var names = list.map(function(x){ return x.r + 'R'; }).join(' ');
          throw new Error('レース一覧に ' + r + 'R が見つかりませんでした。取得できたのは: ' + names);
        }
        steps.push('レース一覧取得OK → ' + venue + ' ' + r + 'R「' + (hit.name || '名称不明') + '」を選択');
        return 'https://www.jra.go.jp/JRADB/accessS.html?CNAME=' + hit.token;
      });
    });
  }
  return attempt().then(function(url){
    return { url: url, steps: steps };
  }).catch(function(e){
    // キャッシュが古くて対象日が無い場合だけ、再取得して1回だけリトライ
    if (!e.outOfWindow && !force){
      force = true;
      try { localStorage.removeItem(JV_LS); } catch(ex){}
      return attempt().then(function(url){ return { url: url, steps: steps }; });
    }
    throw e;
  });
}

/* ===== 現在のレース文脈の取得 ===== */
function jvCurrent(){
  // ①で選んだレース
  var o = (typeof kai !== 'undefined' && kai && kai.sel) ? kai.sel : null;
  if (o && o.date && o.venue && o.r){
    return { date8: jvD8(o.date), venue: o.venue, r: parseInt(o.r, 10), name: o.name || '', src: '①で選んだレース' };
  }
  // 現在読み込まれているレース(state.race.name = "2026年9月6日 中山11R セントウルＳ(G2)")
  var nm = (state.race && state.race.name) || '';
  var mm = nm.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*([^\s]+?)\s*(\d{1,2})R/);
  if (mm){
    var v = mm[4].replace(/^[0-9]+回/, '');  // 「4回中山」等の回号を除去
    for (var i = 0; i < JV_VENUES.length; i++){
      if (v.indexOf(JV_VENUES[i]) >= 0){ v = JV_VENUES[i]; break; }
    }
    return { date8: mm[1] + ('0' + mm[2]).slice(-2) + ('0' + mm[3]).slice(-2), venue: v, r: parseInt(mm[5], 10), name: nm, src: '現在のレース' };
  }
  // 開催日が無くても「競馬場」だけ自動（①レース情報の開催欄）
  var pl = (state.race && state.race.place) || '';
  if (pl && JV_VCODE[pl]) return { date8: '', venue: pl, r: 0, name: nm || '', src: '現在のレース' };
  if (nm) return { date8: '', venue: '', r: 0, name: nm, src: '現在のレース' };
  return null;
}

/* ===== ⑤ タブ内「JRAレース一覧(2ヶ月)」ブラウザ =====
   JRA公式ページのレース名一覧と同じ物をアプリ内に再現。
   日付 → 競馬場 → 1〜12Rのレース名、を展開して見られるようにし、
   各レースの「🎬 映像ページを開く」から結果ページを新タブで開けます。 */
var jvBrowseCache = {};   // venue-day token -> その日のレース一覧(セッション内キャッシュ)

function jvOpenResultToken(token, label){
  var url = 'https://www.jra.go.jp/JRADB/accessS.html?CNAME=' + token;
  var st = jvEl('jvStatus');
  if (st){
    st.style.display = '';
    st.innerHTML = '✅ 新しいタブで開きました → <a href="' + url + '" target="_blank" rel="noopener">' + esc(label || url) + '</a>' +
      '<br><span style="color:var(--mut)">JRAページ内の「レース映像」欄の ▶（PLAY）でレース映像・パトロールビデオが再生できます。</span>';
    st.style.color = 'var(--ok-ink)'; st.style.background = 'var(--card2)';
  }
  try { window.open(url, '_blank', 'noopener'); } catch(e){}
}
function jvBrowseEntries(days){
  var by = {};
  Object.keys(days || {}).forEach(function(k){
    var p = String(k).split('|'); if (p.length !== 2) return;
    var d = p[0], code = p[1];
    (by[d] = by[d] || []).push({ code: code, token: days[k] });
  });
  Object.keys(by).forEach(function(d){
    by[d].sort(function(a, b){ return parseInt(a.code, 10) - parseInt(b.code, 10); });
  });
  return by;
}
function jvRenderBrowse(days){
  var box = jvEl('jvBrowse'); if (!box) return;
  var by = jvBrowseEntries(days);
  var dates = Object.keys(by).sort().reverse();   // 新しい日から
  var cur = jvCurrent();
  var curKey = (cur && cur.date8 && cur.venue && cur.r) ? (cur.date8 + '|' + JV_VCODE[cur.venue] + '|' + cur.r) : '';
  var html = dates.map(function(d){
    var s = '<div style="border:1px solid var(--line);border-radius:8px;margin-bottom:6px;overflow:hidden">' +
      '<div style="padding:5px 10px;background:var(--card2);display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
      '<b style="white-space:nowrap">' + esc(jvDateLabel(d)) + '</b>';
    by[d].forEach(function(v){
      var active = (cur && cur.date8 === d && cur.venue === jvVenueName(v.code));
      s += '<button type="button" class="btn ghost jv-venue" style="padding:2px 10px;font-size:.76rem;border-color:' + (active ? '#b06a00' : '') + '"' +
        ' data-date="' + esc(d) + '" data-code="' + esc(v.code) + '" data-token="' + esc(v.token) + '">' +
        esc(jvVenueName(v.code)) + (active ? ' ★' : '') + '</button>';
    });
    s += '</div><div class="jv-date-rows" style="border-top:1px dashed var(--line)"></div></div>';
    return s;
  }).join('');
  if (!dates.length) html = '<div class="muted">該当日なし（掲載対象外）</div>';
  box.innerHTML = html;
  // 場ボタン → その日のレース一覧を開閉
  box.querySelectorAll('.jv-venue').forEach(function(b){
    b.addEventListener('click', function(){
      var rowsBox = b.closest('div').parentNode.querySelector('.jv-date-rows');
      if (!rowsBox) return;
      var host = rowsBox.querySelector('.jv-vrows[data-date="' + b.dataset.date + '"][data-code="' + b.dataset.code + '"]');
      if (!host){
        // この日付・場の行ホルダを作ってレース一覧を取得
        var hd = document.createElement('div');
        hd.className = 'jv-vrows';
        hd.setAttribute('data-date', b.dataset.date);
        hd.setAttribute('data-code', b.dataset.code);
        hd.style.cssText = 'padding:6px 10px;background:#fbfdf8;border-top:1px dashed #e2e6db';
        hd.innerHTML = '⏳ ' + esc(jvVenueName(b.dataset.code)) + ' のレース一覧を取得中…（1〜2秒）';
        rowsBox.appendChild(hd);
        jvLoadVenueRows(hd, b.dataset.date, b.dataset.code, b.dataset.token);
        return;
      }
      host.style.display = (host.style.display === 'none') ? '' : 'none';
    });
  });
}
function jvLoadVenueRows(host, date, code, token){
  var venue = jvVenueName(code);
  if (jvBrowseCache[token]){
    host.innerHTML = jvVenueRowsHTML(jvBrowseCache[token], date, venue, code);
    return;
  }
  jvFetchRaceList(token).then(function(list){
    jvBrowseCache[token] = list;
    host.innerHTML = jvVenueRowsHTML(list, date, venue, code);
  }).catch(function(e){
    host.innerHTML = '⚠ ' + esc((e && e.message) || '取得失敗') + '（この場は中継リレーが必要です）';
  });
}
function jvVenueRowsHTML(list, date, venue, code){
  var cur = jvCurrent();
  var curR = (cur && cur.date8 === date && cur.venue === venue) ? cur.r : 0;
  if (!list || !list.length) return '<div class="muted" style="padding:4px">レース情報がありません</div>';
  var head = '<div style="font-weight:bold;margin:2px 0 4px">' + esc(jvDateLabel(date) + ' ' + venue) + '</div>';
  var rows = list.map(function(x){
    var hi = (x.r === curR) ? ';background:#fff4dc;border:1px solid #e5c98a' : '';
    var num = x.r + 'R';
    return '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:3px 2px;border-bottom:1px dotted var(--line)' + hi + '">' +
      '<b style="width:34px;color:var(--info-ink)">' + num + '</b>' +
      '<span style="flex:1;min-width:180px">' + esc(x.name || '') + '</span>' +
      (x.dist ? '<span class="muted" style="font-size:.78rem;white-space:nowrap">' + esc(x.dist) + '</span>' : '') +
      (x.course ? '<span class="muted" style="font-size:.78rem;white-space:nowrap">' + esc(x.course) + '</span>' : '') +
      '<button type="button" class="btn ghost jv-open1" style="padding:1px 8px;font-size:.75rem" data-token="' + esc(x.token) + '" data-date="' + esc(date) + '" data-venue="' + esc(venue) + '" data-r="' + x.r + '">🎬 映像ページを開く ↗</button>' +
      '</div>';
  }).join('');
  return head + rows;
}
function jvBrowseLoad(force){
  var stat = jvEl('jvBrowseStat'), btn = jvEl('jvBrowseBtn'), rbtn = jvEl('jvBrowseReload');
  if (stat) stat.textContent = '開催日リストを取得中…（初回のみ数秒）';
  if (btn) btn.disabled = true; if (rbtn) rbtn.disabled = true;
  var p;
  if (force){ try { localStorage.removeItem(JV_LS); } catch(e){} jvBrowseCache = {}; }
  p = jvFetchDaySelect();
  return p.then(function(days){
    if (stat) stat.textContent = '✅ JRA結果ページ掲載分 ' + Object.keys(days).length + ' 場日（直近約2ヶ月）を表示';
    if (btn) btn.disabled = false; if (rbtn) rbtn.disabled = false;
    jvRenderBrowse(days);
    return days;
  }).catch(function(e){
    if (stat) stat.textContent = '⚠ ' + ((e && e.message) || '取得失敗');
    if (btn) btn.disabled = false; if (rbtn) rbtn.disabled = false;
  });
}

/* ===== ⑤ タブ UI ===== */
function jvEl(id){ return document.getElementById(id); }
function jvSt(msg, isErr){
  var el = jvEl('jvStatus'); if (!el) return;
  el.style.display = msg ? '' : 'none';
  el.textContent = (isErr ? '⚠ ' : '') + msg;
  el.style.color = isErr ? '#b3261e' : '';
  if (isErr) el.style.background = 'var(--card2)';
  else el.style.background = '';
}
function jvLog(lines){
  var el = jvEl('jvLog'); if (!el) return;
  if (!lines || !lines.length){ el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';
  el.innerHTML = lines.map(function(l){ return esc ? esc(l) : String(l); }).join('<br>');
}
function jvFillFromCurrent(){
  var c = jvCurrent();
  var nameEl = jvEl('jvName'), dateEl = jvEl('jvDate'), venueEl = jvEl('jvVenue'), rEl = jvEl('jvR'), srcEl = jvEl('jvSrc');
  if (c){
    if (dateEl && c.date8) dateEl.value = c.date8.slice(0,4) + '-' + c.date8.slice(4,6) + '-' + c.date8.slice(6,8);
    if (venueEl && c.venue && JV_VCODE[c.venue]) venueEl.value = c.venue;
    if (rEl && c.r) rEl.value = c.r;
    if (nameEl) nameEl.value = c.name || '';
    if (srcEl) srcEl.textContent = '自動検出: ' + c.src;
    return c;
  }
  if (nameEl) nameEl.value = '';
  if (srcEl) srcEl.textContent = '';
  return null;
}
function jvGo(){
  var dateEl = jvEl('jvDate'), venueEl = jvEl('jvVenue'), rEl = jvEl('jvR');
  var ctx = {
    date8: jvD8(dateEl ? dateEl.value : ''),
    venue: venueEl ? venueEl.value : '',
    r: parseInt(rEl && rEl.value ? rEl.value : '', 10)
  };
  var nameEl = jvEl('jvName');
  var runBtn = jvEl('jvGoBtn');
  jvSt('');
  jvLog(['JRA結果ページを自動解決します…']);
  if (runBtn) runBtn.disabled = true;
  return jvResolve(ctx).then(function(r){
    jvLog((r.steps || []).map(function(s){ return '① ' + s; }).concat([
      '② 新しいタブで公式ページを開きました（下のリンクからも開けます）。',
      '③ JRAページ内の「レース映像」欄にある ▶（PLAY）ボタンを押すと映像が再生されます。'
    ]));
    var st = jvEl('jvStatus');
    if (st){
      st.style.display = '';
      st.innerHTML = '✅ 解決成功 → <a href="' + r.url + '" target="_blank" rel="noopener">' + esc(r.url) + '</a>';
      st.style.color = 'var(--ok-ink)'; st.style.background = 'var(--card2)';
    }
    if (nameEl && ctx.date8) nameEl.value = jvDateLabel(ctx.date8) + ' ' + ctx.venue + ctx.r + 'R';
    try { window.open(r.url, '_blank', 'noopener'); } catch(e){}
    if (runBtn) runBtn.disabled = false;
    return r;
  }).catch(function(e){
    var msg = (e && e.message) || '解決に失敗しました';
    jvLog([
      (e && e.outOfWindow) ? '掲載対象外です。JRA「レース結果」は開催済みレースの直近約2ヶ月分のみです。' : '中継リレーの通信が必要です（「① データ入力」→ URL取込の通信設定 → 🔧 中継を診断 をご確認ください）。',
      (e && e.outOfWindow) ? 'JRA公式サイトの「レース結果」メニュー（https://www.jra.go.jp/keiba/）から日付を選ぶと探せます。' : ''
    ].filter(Boolean));
    jvSt(msg, true);
    if (runBtn) runBtn.disabled = false;
    throw e;
  });
}
function jvQuickGo(){
  // 各所からのショートカット: 現在のレースで即解決
  var c = jvFillFromCurrent();
  if (!c){
    if (typeof jvStatus === 'function'){ /*noop*/ }
    return jvGo();
  }
  return jvGo();
}
function jvRefresh(){
  var dateEl = jvEl('jvDate');
  if (dateEl && !dateEl.value) jvFillFromCurrent();
}
function initJv(){
  var nameEl = jvEl('jvName'), dateEl = jvEl('jvDate'), venueEl = jvEl('jvVenue'), rEl = jvEl('jvR');
  if (!dateEl) return;  // ページ構成に⑤が無い場合は何もしない
  // 競馬場セレクト
  if (venueEl){
    venueEl.innerHTML = '<option value="">競馬場を選択</option>' + JV_VENUES.map(function(v){
      return '<option value="' + v + '">' + v + '</option>';
    }).join('');
  }
  var c = jvCurrent();
  if (c){
    if (c.date8 && dateEl) dateEl.value = c.date8.slice(0,4) + '-' + c.date8.slice(4,6) + '-' + c.date8.slice(6,8);
    if (c.venue && venueEl && JV_VCODE[c.venue]) venueEl.value = c.venue;
    if (c.r && rEl) rEl.value = c.r;
    if (nameEl) nameEl.value = c.name || '';
    var srcEl = jvEl('jvSrc');
    if (srcEl) srcEl.textContent = c.src ? ('自動検出: ' + c.src) : '';
  }
  var fillBtn = jvEl('jvFillBtn'), goBtn = jvEl('jvGoBtn');
  if (fillBtn) fillBtn.addEventListener('click', function(){
    var c2 = jvFillFromCurrent();
    jvSt('');
    if (!c2){
      jvSt('開催日・競馬場・Rを自動検出できませんでした。「① データ入力」で日付入りレース名を入力するか、①のレース選択でレースを選んでください。', true);
      return;
    }
    jvSt('✅ ' + (c2.name || '') + ' をセットしました。→「開く」ボタンで解決します。');
  });
  if (goBtn) goBtn.addEventListener('click', jvGo);
  // JRAレース一覧(2ヶ月)ブラウザ
  var bb = jvEl('jvBrowseBtn');
  if (bb) bb.addEventListener('click', function(){ jvBrowseLoad(false); });
  var rb = jvEl('jvBrowseReload');
  if (rb) rb.addEventListener('click', function(){ jvBrowseLoad(true); });
  var br = jvEl('jvBrowse');
  if (br) br.addEventListener('click', function(e){
    var b = (e.target && e.target.closest) ? e.target.closest('.jv-open1') : null;
    if (!b) return;
    var d = b.getAttribute('data-date'), v = b.getAttribute('data-venue'), r = b.getAttribute('data-r');
    var de = jvEl('jvDate'), ve = jvEl('jvVenue'), re = jvEl('jvR');
    if (de && d) de.value = d.slice(0,4) + '-' + d.slice(4,6) + '-' + d.slice(6,8);
    if (ve && v) ve.value = v;
    if (re && r) re.value = r;
    jvSt('');
    jvOpenResultToken(b.getAttribute('data-token'), d + ' ' + v + ' ' + r + 'R');
  });
  jvLog([]); jvSt('');
}
