/* =========================================================
   14 レース歴史：同名レースの過去N年データ閲覧（旧④タブ → ⑥重賞データ分析タブ内に統合）
   ・netkeiba の「過去のレース結果(All_Special_Table)」を起点に、
     各年の race_id を取得し、その年の結果ページから
     3着以内(馬券内)の 脚質・人気・オッズ・コーナー通過順 を収集
   ・レース名が変わっていても netkeiba 側の系統に従い同系列として扱う
   ========================================================= */
var HIST_LS      = 'khl_hist_v1';
var HIST_DEFAULT = 10;
var STYLE_COLORS = { 逃げ:'#c0504d', 先行:'#e0912f', 差し:'#2f7fc4', 追込:'#7a6ec4', 不明:'#999' };
var STYLE_META   = { 逃げ:'4角先頭', 先行:'好位(4角2〜4割位)', 差し:'中団(4角3〜6割位)', 追込:'後方(4角6割より後ろ)', 不明:'通過順不明' };

/* ---------- キャッシュ ---------- */
function histLsGet(key){
  try { var o = JSON.parse(cmpUnpack(localStorage.getItem(HIST_LS)) || '{}'); return o[key] != null ? o[key] : null; } catch(e){ return null; }
}
function histLsSet(key, val){
  try {
    var o = {};
    try { o = JSON.parse(cmpUnpack(localStorage.getItem(HIST_LS)) || '{}'); } catch(e){}
    o[key] = val;
    // 肥大化防止: 古い詳細から削る
    var keys = Object.keys(o);
    if (keys.length > 60) keys.slice(0, keys.length - 60).forEach(function(k){ delete o[k]; });
    localStorage.setItem(HIST_LS, cmpPack(JSON.stringify(o)));
  } catch(e){}
}
function histLsClear(){ try { localStorage.removeItem(HIST_LS); } catch(e){} }

/* ---------- 取得 ---------- */
function histFetchHtml(url){
  var candidates = (typeof nkRelayCandidates === 'function') ? nkRelayCandidates() : [];
  var idx = 0, directTried = false, lastErr = null;
  return new Promise(function(res, rej){
    var attempt = function(){
      if (idx < candidates.length){
        var base = candidates[idx++];
        var full = nkRelayBuild(base, url);
        nkFetchTimeout(full, 30000).then(function(t){
          if (!t || t.length < 400 || /^\s*[\[{]/.test(t)) { attempt(); return; }
          res(t);
        }).catch(function(e){ lastErr = e; attempt(); });
      } else if (!directTried){
        directTried = true;
        nkFetchTimeout(url, 30000).then(res).catch(function(e){ lastErr = e; attempt(); });
      } else {
        rej(lastErr || new Error('netkeibaへの取得に失敗しました'));
      }
    };
    attempt();
  });
}

/* ---------- シリーズ(過去全成績表) ---------- */
function histParseSeries(html){
  var name = '', rows = [];
  var h2 = html.match(/<h2>([^<]{0,60}?)\s*過去のレース結果<\/h2>/);
  if (h2) name = h2[1];
  var tm = html.match(/<table[^>]*id="All_Special_Table"[^>]*>([\s\S]*?)<\/table>/);
  if (!tm) return { name:name, rows:[] };
  var seg = tm[1];
  var trs = seg.split(/<tr[^>]*>/i).slice(1);
  trs.forEach(function(tr){
    var tds = tr.split(/<t[dh][^>]*>/i).slice(1).map(function(x){ return x.replace(/<\/t[dh]>/i,''); });
    if (!tds.length) return;
    var cells = tds.map(function(c){ return esc2(c); });
    var yr = parseInt((cells[0] || '').match(/(\d{4})/)?.[1] || (cells[0]||''), 10);
    if (!yr || isNaN(yr)) return;
    var ridM = tr.match(/race_id=(\d{12})/);
    rows.push({
      year: yr,
      rid: ridM ? ridM[1] : '',
      winner: cells[1] || '',
      time: cells[2] || '',
      jockey: cells[3] || '',
      trainer: cells[4] || ''
    });
  });
  rows.sort(function(a,b){ return b.year - a.year; });
  return { name:name, rows:rows };
}

/* HTMLタグ除去＋空白整形（モジュール内専用） */
function esc2(s){
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, function(m, n){ try { return String.fromCharCode(parseInt(n,10)); } catch(e){ return ''; } })
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/\s+/g,' ').trim();
}

function histParseMeta(html){
  var meta = { date:'', place:'', rnum:'', dist:'', surface:'', baba:'', weather:'' };
  var title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  var dm = title.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s+(.+?)\s*(\d{1,2})R/);
  if (dm) meta.date = dm[1] + '/' + ('0'+dm[2]).slice(-2) + '/' + ('0'+dm[3]).slice(-2);
  if (dm) meta.place = dm[4];
  if (dm) meta.rnum = dm[5];
  var ds = html.match(/(芝|ダート|障害)\s*(\d{3,4})m/);
  if (ds){ meta.surface = ds[1]; meta.dist = ds[2]; }
  var bb = html.match(/馬場:([^/\n<]{1,12})/);
  if (bb) meta.baba = esc2(bb[1]);
  var we = html.match(/天候:([^/\n<]{1,12})/);
  if (we) meta.weather = esc2(we[1]);
  return meta;
}

function histParseOrder(html){
  // 「全着順」summaryを持つテーブルを優先。無ければ着順カラムを含む最初のテーブル
  var mt = html.match(/<table[^>]*summary="全着順"[^>]*>([\s\S]*?)<\/table>/);
  if (!mt){
    var tbs = html.match(/<table[^>]*>([\s\S]*?)<\/table>/g) || [];
    for (var k = 0; k < tbs.length; k++){
      if (/<th[^>]*>\s*着順\s*</.test(tbs[k])) { mt = ['', tbs[k].replace(/^<table[^>]*>/,'').replace(/<\/table>$/,'')]; break; }
    }
  }
  if (!mt) return { rows: [], n: 0 };
  var seg = mt[1];
  var ths = [];
  var thead = seg.match(/<thead[^>]*>([\s\S]*?)<\/thead>/);
  var thBlock = thead ? thead[1] : seg.slice(0, seg.indexOf('</table>'));
  ths = thBlock.split(/<th[^>]*>/i).slice(1).map(function(x){ return esc2(x.split('</th>')[0]); }).filter(Boolean);
  var idx = {};
  function col(label, fallback){
    if (idx[label] != null) return idx[label];
    return fallback;
  }
  var fix = { 着順:0, 枠:1, 馬番:2, 馬名:3, 性齢:4, 斤量:5, 騎手:6, タイム:7, 着差:8, 人気:9, '単勝オッズ':10, 後3F:11, 'コーナー通過順':12, 厩舎:13, '馬体重(増減)':14 };
  ths.forEach(function(t, k){ if (fix[t] != null) idx[t] = k; });
  function c(i_, l){ return col(l) != null ? i_[col(l)] : (i_[fix[l]] != null ? i_[fix[l]] : ''); }
  var rows = [];
  var trs = seg.split(/<tr[^>]*>/i);
  trs.forEach(function(tr){
    if (!/<t[dh]/i.test(tr)) return;
    var tds = tr.split(/<t[dh][^>]*>/i).slice(1).map(function(x){ return x.replace(/<\/t[dh]>/i,''); });
    var cells = tds.map(esc2);
    var orderRaw = c(cells, '着順');
    var name = c(cells, '馬名');
    if (!name && !orderRaw) return;
    var order = parseInt(orderRaw, 10);
    var passing = c(cells, 'コーナー通過順') || '';
    var oddsRaw = c(cells, '単勝オッズ');
    var last3 = c(cells, '後3F');
    var time = c(cells, 'タイム');
    var jockey = c(cells, '騎手');
    var sea = c(cells, '性齢');
    rows.push({
      order: isNaN(order) ? 0 : order,
      no: c(cells, '馬番'), name: name, sea: sea, jockey: jockey,
      time: time, odds: oddsRaw, pop: c(cells, '人気'),
      last3: last3, passing: passing
    });
  });
  // 取消・除外・中止は order=0 として保持。頭数は実出走馬数
  var n = rows.filter(function(r){ return r.name; }).length;
  return { rows: rows, n: n };
}

function histParseDetail(html){
  var order = histParseOrder(html);
  return { meta: histParseMeta(html), rows: order.rows, n: order.n };
}

/* ---------- 脚質判定（4角位置＋出走頭数で分類） ---------- */
function histStyle(passing, n){
  if (!passing) return { tag:'不明', pos4:null, raw:'' };
  var vals = String(passing).split(/[-\-–—～~／/、・]/).map(function(x){ return parseInt(x,10); }).filter(function(x){ return !isNaN(x); });
  if (!vals.length) return { tag:'不明', pos4:null, raw:passing };
  var pos4 = vals[vals.length - 1];
  var tag;
  if (pos4 <= 0) { tag = '不明'; }
  else if (pos4 === 1) { tag = '逃げ'; }
  else {
    var r = (n && n > 1) ? (pos4 - 1) / (n - 1) : 0.5;
    if (r <= 0.30) tag = '先行';
    else if (r <= 0.65) tag = '差し';
    else tag = '追込';
  }
  return { tag: tag, pos4: pos4, raw: passing };
}

/* ---------- 取得フロー ---------- */
function histLog(msg){
  var el = $('histLog'); if (!el) return;
  el.innerHTML += (el.innerHTML ? '<br>' : '') + '・' + esc(msg);
}
function histLogClear(){ var el = $('histLog'); if (el) el.innerHTML = ''; }

function histFetchSeries(rid){
  var key = 'series:' + rid;
  var cached = histLsGet(key);
  if (cached && cached.rows && cached.rows.length) return Promise.resolve(cached);
  histLog('過去全成績表を取得中 (race_id=' + rid + ')…');
  return histFetchHtml('https://race.netkeiba.com/race/result.html?race_id=' + rid).then(function(html){
    var parsed = histParseSeries(html);
    if (!parsed.rows.length) throw new Error('このレースの過去全成績表が見つかりませんでした。レースページを開ける週になってから試すか、race_id を確認してください');
    histLsSet(key, parsed);
    return parsed;
  });
}
function histFetchDetail(rid, label){
  var key = 'detail:' + rid;
  var cached = histLsGet(key);
  if (cached && cached.rows) return Promise.resolve(cached);
  histLog((label ? label + ' ' : '') + 'の結果詳細を取得中 (' + rid + ')…');
  return histFetchHtml('https://race.netkeiba.com/race/result.html?race_id=' + rid).then(function(html){
    var d = histParseDetail(html);
    if (!d.rows.length) throw new Error('着順表が取得できませんでした(' + rid + ')');
    histLsSet(key, d);
    return d;
  });
}

/* 現在のレースID（state or 入力欄） */
function histCurrentRid(){
  /* ⑥カレンダーで選んだレースが新しければ、そちらを追いかける */
  var rid = '';
  try { var p = (typeof drPickRid === 'function') ? drPickRid() : null; if (p && p.rid) rid = String(p.rid); } catch(e){}
  if (!rid) rid = String(state.raceId || '').trim();
  if (!rid){
    var inp = $('histUrlInp'); var v = inp ? String(inp.value).trim() : '';
    if (v && typeof nkExtractRaceId === 'function') rid = nkExtractRaceId(v);
    else rid = v;
  }
  return rid;
}

function histRaceLabel(){
  var s = state.race || {};
  var lab = '';
  var from = '';
  try {
    var p = (typeof drPickRid === 'function') ? drPickRid() : null;
    if (p && p.from === '📅カレンダー'){ lab = (typeof drTargetName === 'function') ? drTargetName() : ''; from = '（📅カレンダーで選択中）'; }
  } catch(e){}
  if (!lab) lab = s.name || '';
  var rid = histCurrentRid();
  if (lab && rid) return lab + ' (race_id=' + rid + ')' + from;
  if (lab) return lab + from;
  if (rid) return 'race_id=' + rid;
  return '';
}

/* ---------- 集計 ---------- */
function histStyleAgg(details){
  var agg = { 逃げ:0, 先行:0, 差し:0, 追込:0, 不明:0 };
  var pos = []; // 前=逃げ+先行
  details.forEach(function(d){
    d.rows.forEach(function(r){
      if (!r.order || r.order > 3 || r.order < 1) return;
      var st = histStyle(r.passing, d.n);
      if (agg[st.tag] == null) agg[st.tag] = 0;
      agg[st.tag]++;
      pos.push(st.tag === '逃げ' || st.tag === '先行');
    });
  });
  var total = pos.length;
  var front = pos.filter(Boolean).length;
  return { agg: agg, total: total, frontRate: total ? front / total : null };
}

/* ---------- 描画 ---------- */
function histBar(s){
  return '<span style="display:inline-block;min-width:10px;border-radius:3px;background:' + s.c + ';width:' + Math.max(6, s.w) + 'px"></span>';
}

function renderHist(series, selDetails){
  var out = $('histOut');
  if (!out) return;
  var curDist = parseInt((state.race || {}).dist, 10) || 0;
  var yearRows = (series.rows || []).slice();
  var sameOnly = $('histSameChk') ? $('histSameChk').checked : true;
  var html = '';

  // —— 集計カード：馬券内(3着以内)の脚質 ——
  var used = selDetails.filter(function(d){ return d && d.rows && d.rows.length; });
  var aggAll = histStyleAgg(used);
  var sameUsed = used, skipped = [];
  if (sameOnly && curDist){
    sameUsed = []; skipped = [];
    used.forEach(function(d){
      var dd = parseInt(d.meta.dist,10);
      if (dd && dd === curDist) sameUsed.push(d);
      else skipped.push(d);
    });
  } else if (sameOnly){
    sameUsed = used;
  }
  var agg = histStyleAgg(sameUsed);
  var styles = ['逃げ','先行','差し','追込'];
  html += '<div class="card">';
  html += '<h2>🎯 馬券内(3着以内)に入った馬の脚質 — 直近' + (series.rows && series.rows.length ? 'データ' : '') + '</h2>';
  var aggUsed = sameOnly ? sameUsed : used;
  var agg2 = sameOnly ? agg : aggAll;
  var sub = '過去 ' + aggUsed.length + ' レース分 × 3着以内 = ' + (aggUsed.length * 3) + ' 頭分を集計';
  if (sameOnly && curDist) sub += '（直近のうち同距離(' + curDist + 'm)の開催のみ）';
  if (sameOnly && !curDist) sub += '（現在レースの距離が未入力のため全距離を含む）';
  if (skipped.length) sub += '　※距離違い' + skipped.length + '回は除外: ' + skipped.map(function(d){ return d.meta.date || '?'; }).join(', ');
  html += '<p class="small muted">' + esc(sub) + '</p>';
  if (agg2.total){
    html += '<div style="display:grid;grid-template-columns:auto 1fr auto;gap:4px 10px;align-items:center;max-width:560px">';
    var maxN = Math.max.apply(null, styles.map(function(s){ return agg2.agg[s] || 0; }));
    styles.forEach(function(s){
      var c = agg2.agg[s] || 0;
      var pct = Math.round(c / agg2.total * 1000) / 10;
      var w = maxN ? Math.round(c / maxN * 100) : 0;
      html += '<span style="width:3.2em;font-weight:700;color:' + STYLE_COLORS[s] + '">' + s + '</span>' +
        '<span style="height:16px;display:flex">' + histBar({c:STYLE_COLORS[s], w:w}) + '</span>' +
        '<span class="small">' + c + '頭 (' + pct + '%)</span>';
    });
    var fr = Math.round(agg2.frontRate * 1000) / 10;
    html += '<span style="width:3.2em;font-weight:700">前残</span><span class="small" style="grid-column:2/4">' + fr + '%（逃げ+先行）</span>';
    html += '</div>';
    html += '<p class="small muted" style="margin-top:6px">脚質は各年の着順表の「コーナー通過順」の4角位置と出走頭数から自動判定しています（4角1位=逃げ、2〜3割=先行、3〜6割=差し、それ以外=追込）。厳密な定義と異なる場合があります。</p>';
  } else {
    html += '<p class="muted">集計できるデータがありません。</p>';
  }
  html += '</div>';

  // —— 年別詳細 ——
  html += '<div class="card"><h2>📅 年別の結果（馬券内）</h2><p class="small muted">表は、直近の年から並んでいます。脚質バッジの括弧は「コーナー通過順(4角側)」です。</p>';
  if (aggUsed.length){
    html += '<div class="tblwrap"><table style="min-width:760px"><thead><tr>' +
      '<th>開催</th><th>条件</th><th>1着(人気・オッズ)</th><th>2着</th><th>3着</th><th></th></tr></thead><tbody>';
    aggUsed.forEach(function(d){
      var f = {};
      d.rows.forEach(function(r){ if (r.order >= 1 && r.order <= 3 && !f[r.order]) f[r.order] = r; });
      var top = [1,2,3].map(function(k){
        var r = f[k]; if (!r) return '<span class="muted">—</span>';
        var st = histStyle(r.passing, d.n);
        var badge = '<span style="color:' + STYLE_COLORS[st.tag] + ';font-weight:700">' + st.tag + '</span>';
        // ここは HTML を組み立てて返す（esc した文字列にタグを混ぜると
        // 表に「<span class="muted">」などのコードがそのまま表示されてしまう）
        var nmTxt = esc(String(r.no == null ? '' : r.no) + ' ' + String(r.name == null ? '' : r.name));
        var popTxt = r.pop ? ' <span class="muted">(' + esc(String(r.pop)) + '人気' + (r.odds ? ' ' + esc(String(r.odds)) + '倍' : '') + ')</span>' : '';
        return '<div><b>' + nmTxt + '</b>' + popTxt + ' ' + badge +
          (st.pos4 ? ' <span class="muted">' + esc(st.raw) + ' 4角' + st.pos4 + '</span>' : '') + '</div>';
      });
      var condTxt = esc(String(d.meta.surface || '') + (d.meta.dist ? ' ' + d.meta.dist + 'm' : ''));
      var placeTxt = d.meta.place ? '・' + esc(String(d.meta.place)) + (d.meta.rnum ? esc(String(d.meta.rnum)) + 'R' : '') : '';
      var baba = d.meta.baba ? '<span class="chip">' + esc(d.meta.baba) + '</span>' : '';
      var link = d.rid ? '<a target="_blank" rel="noreferrer" href="https://race.netkeiba.com/race/result.html?race_id=' + d.rid + '">詳細</a>' : '';
      html += '<tr><td><b>' + esc(d.meta.date || '') + '</b><br><span class="muted small">' + esc(d.meta.weather || '') + '</span></td>' +
        '<td>' + condTxt + placeTxt + ' ' + baba + '</td>' +
        '<td>' + top[0] + '</td><td>' + top[1] + '</td><td>' + top[2] + '</td><td class="small">' + link + '</td></tr>';
    });
    html += '</tbody></table></div>';
  } else {
    html += '<p class="muted">データがありません。</p>';
  }
  html += '</div>';

  // —— 歴代優勝馬 ——
  html += '<div class="card"><h2>🏆 歴代優勝馬（取得できた範囲）</h2>';
  html += '<div class="tblwrap"><table style="min-width:520px"><thead><tr><th>年</th><th>優勝馬</th><th>タイム</th><th>騎手</th><th>調教師</th><th></th></tr></thead><tbody>';
  var shown = 0;
  yearRows.forEach(function(y){
    shown++;
    if (shown > (HIST_DEFAULT + 30)) return;
    var link = y.rid ? '<a class="small" target="_blank" rel="noreferrer" href="https://race.netkeiba.com/race/result.html?race_id=' + y.rid + '">結果</a>' : '';
    html += '<tr><td><b>' + y.year + '</b></td><td>' + esc(y.winner) + '</td><td>' + esc(y.time) + '</td>' +
      '<td>' + esc(y.jockey) + '</td><td>' + esc(y.trainer) + '</td><td>' + link + '</td></tr>';
  });
  html += '</tbody></table></div>';
  html += '<p class="small muted">同名レースは現在名と異なる名称・開催場・距離で行われた年も、netkeiba の系統に従って同系列として扱っています（例: セントウルS系列の正式名はセントウルステークス）。年度により条件が異なるため、集計は同距離のみに絞れるチェックがあります。</p>';
  html += '</div>';

  out.innerHTML = html;
}

/* ---------- 実行 ---------- */
function histStart(){
  var goBtn = $('btnHistGo');
  var rid = histCurrentRid();
  var logEl = $('histLog'); if (logEl) logEl.innerHTML = '';
  histLogClear();
  var out = $('histOut'); if (out) out.innerHTML = '';
  if (!rid){
    histLog('レースIDまたはnetkeibaのレースURLがありません。「このレースURLから設定」に入力するか、①出馬表をURL取込してください。');
    return;
  }
  if (goBtn){ goBtn.disabled = true; goBtn.textContent = '取得中…'; }
  var finish = function(){ if (goBtn){ goBtn.disabled = false; goBtn.textContent = '過去10年を取得・表示'; } };
  var range = parseInt(($('histRange') || {}).value || HIST_DEFAULT, 10) || HIST_DEFAULT;

  histFetchSeries(rid).then(function(series){
    var titleEl = $('histSeriesName');
    if (titleEl){
      titleEl.textContent = (series.name ? series.name + '（通称: ' + (state.race && state.race.name ? state.race.name : rid) + '）' : 'このレース') + ' の過去データ';
    }
    var rows = (series.rows || []).filter(function(y){ return y.rid; });
    var want = rows.slice(0, range);
    // 取得順は新しい年から。失敗した年はスキップして続行
    var seq = function(i, acc){
      if (i >= want.length){
        renderHist(series, acc);
        if (rows.length === 0) histLog('過去データ(race_id付き)が見つかりませんでした。このレースは比較的新しいレースの可能性があります。');
        finish();
        return;
      }
      var y = want[i];
      histFetchDetail(y.rid, y.year + '年').then(function(d){
        acc.push(Object.assign({}, d, { rid: y.rid, year: y.year }));
        seq(i + 1, acc);
      }).catch(function(e){
        histLog('⚠ ' + y.year + '年は取得失敗: ' + (e && e.message ? e.message : e));
        seq(i + 1, acc);
      });
    };
    seq(0, []);
  }).catch(function(err){
    histLog('⚠ ' + (err && err.message ? err.message : err));
    var titleEl = $('histSeriesName'); if (titleEl) titleEl.textContent = '取得に失敗しました';
    finish();
  });
}

function histRefreshHeader(){
  var rid = histCurrentRid();
  var inp = $('histUrlInp'); if (inp && !inp.value) inp.value = rid;
  var cur = $('histCurRace');
  var lab = histRaceLabel();
  if (cur) cur.textContent = lab ? '対象: ' + lab : '対象: （未設定。下の入力欄にURLを貼るか、①でURL取込してください）';
  var goBtn = $('btnHistGo');
  if (goBtn){ goBtn.disabled = false; goBtn.textContent = '過去10年を取得・表示'; }
  var out = $('histOut'); if (out) out.innerHTML = '';
  var log = $('histLog'); if (log) log.innerHTML = '';
  var titleEl = $('histSeriesName'); if (titleEl) titleEl.textContent = '';
}

function initHist(){
  var goBtn = $('btnHistGo');
  if (goBtn) on(goBtn, 'click', histStart);
  var setBtn = $('btnHistUrlSet');
  if (setBtn) on(setBtn, 'click', function(){
    var v = $('histUrlInp') ? String($('histUrlInp').value).trim() : '';
    var rid = v;
    if (typeof nkExtractRaceId === 'function' && v) rid = nkExtractRaceId(v);
    if (!rid){ histLog('レースURLまたは race_id=◯◯ を入力してください'); return; }
    state.raceId = rid; state.raceAt = Date.now(); saveNow();
    histRefreshHeader();
    histLog('race_id=' + rid + ' を対象に設定しました。');
    histStart();
  });
  var r = $('histRange');
  if (r){
    on(r, 'change', function(){ histStart(); });
    r.value = String(HIST_DEFAULT);
  }
  var sc = $('histSameChk');
  if (sc){ sc.checked = true; on(sc, 'change', function(){ histStart(); }); }
  var cc = $('btnHistCacheClear');
  if (cc) on(cc, 'click', function(){ histLsClear(); histLog('過去データのキャッシュを削除しました。次回「取得」で再取得します。'); });
  histRefreshHeader();
}
