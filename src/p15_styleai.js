/* =========================================================
   脚質AI推定：netkeiba競走馬データの過去成績から脚質を推定
   - 出馬表URL取込時に保存した競走馬ID を使い、過去の
     「コーナー通過順(4角位置)」から 逃げ/先行/差し/追込 を自動分類
   - 直近レースほど重視して集計し、予測と確信度を表示
   ========================================================= */
var STYLE_LS = 'khl_style_v1';

function stLsGet(k){
  try { var o = JSON.parse(localStorage.getItem(STYLE_LS) || '{}'); return o[k] != null ? o[k] : null; } catch(e){ return null; }
}
function stLsSet(k, v){
  try {
    var o = {}; try { o = JSON.parse(localStorage.getItem(STYLE_LS) || '{}'); } catch(e){}
    o[k] = v;
    var keys = Object.keys(o);
    if (keys.length > 400) keys.slice(0, keys.length - 400).forEach(function(kk){ delete o[kk]; });
    safeSetItem(STYLE_LS, JSON.stringify(o));   /* 🥇脚質の学習＝第一優先 */
  } catch(e){}
}

/* リレー経由のHTML取得（p14と同じ仕組み） */
function stFetchHtml(url){
  if (typeof histFetchHtml === 'function') return histFetchHtml(url);
  var candidates = (typeof nkRelayCandidates === 'function') ? nkRelayCandidates() : [];
  var idx = 0, directTried = false, lastErr = null;
  return new Promise(function(res, rej){
    var attempt = function(){
      if (idx < candidates.length){
        var base = candidates[idx++];
        var full = nkRelayBuild(base, url);
        nkFetchTimeout(full, 30000).then(function(t){
          if (!t || t.length < 300 || /^\s*[\[{]/.test(t)) { attempt(); return; }
          res(t);
        }).catch(function(e){ lastErr = e; attempt(); });
      } else if (!directTried){
        directTried = true;
        nkFetchTimeout(url, 30000).then(res).catch(function(e){ lastErr = e; attempt(); });
      } else rej(lastErr || new Error('過去成績の取得に失敗しました'));
    };
    attempt();
  });
}

/* 通し番号からラベル正規化（全角・スペース除去） */
function _stNorm(s){
  return String(s == null ? '' : s).replace(/[\s\u3000]/g, '').replace(/[０-９]/g, function(c){ return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
}

/* 馬IDの過去成績ページ（ajax HTML）から出走レコードを抽出 */
function stParseHorseResults(html){
  var res = { races: [], fetched: false };
  var tm = html.match(/<table[\s\S]*?<\/table>/);
  if (!tm) return res;
  res.fetched = true;
  var rows = tm[0].split(/<tr[^>]*>/i).slice(1);
  var hdr = null, col = {};
  var dataRows = [];
  rows.forEach(function(tr){
    if (!/<t[dh]/i.test(tr)) return;
    var cells = [];
    (tr.match(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi) || []).forEach(function(cell){
      cells.push(String(cell).replace(/^<[^>]*>/i, '').replace(/<\/[^>]*>$/i, '')
        .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
        .replace(/\s+/g,' ').trim());
    });
    if (!hdr){
      var joined = cells.map(_stNorm).join('|');
      if (/着順/.test(joined) && /通過/.test(joined)){
        hdr = cells.map(_stNorm);
        ['日付','開催','レース名','頭数','枠番','馬番','オッズ','人気','着順','距離','馬場','タイム','通過','上り','馬体重'].forEach(function(k){
          var i = -1;
          for (var j = 0; j < hdr.length; j++) if (hdr[j].indexOf(k) >= 0) { i = j; break; }
          if (i >= 0) col[k] = i;
        });
      }
      return;
    }
    if (!cells.length) return;
    dataRows.push(cells);
  });
  dataRows.forEach(function(cells){
    if (col.着順 == null || col.馬番 == null) return;
    var orderRaw = cells[col.着順] || '';
    var order = parseInt(orderRaw, 10);
    var rc = {
      date: cells[col.日付] != null ? cells[col.日付] : '',
      raceName: cells[col.レース名] != null ? cells[col.レース名] : '',
      heads: cells[col.頭数] != null ? cells[col.頭数] : '',
      no: cells[col.馬番] != null ? cells[col.馬番] : '',
      dist: cells[col.距離] != null ? cells[col.距離] : '',
      baba: cells[col.馬場] != null ? cells[col.馬場] : '',
      pop: cells[col.人気] != null ? cells[col.人気] : '',
      order: isNaN(order) ? 0 : order,
      passing: (col.通過 != null && cells[col.通過]) ? cells[col.通過] : '',
      last3: (col.上り != null && cells[col.上り]) ? cells[col.上り] : ''
    };
    if (rc.date || rc.raceName) res.races.push(rc);
  });
  return res;
}

/* 出走レコードから脚質予測（直近ほど重視、4角位置を出走頭数で正規化） */
function stPredict(races){
  var rs = races.filter(function(r){ return r.order >= 1 && r.passing; });
  if (!rs.length) return null;
  var latest = rs.slice(0, Math.min(14, rs.length));
  var wsum = { 逃げ:0, 先行:0, 差し:0, 追込:0 }, total = 0, ex = [];
  latest.forEach(function(r, i){
    var n = parseInt(r.heads, 10) || 16;
    var st = (typeof histStyle === 'function') ? histStyle(r.passing, n) : { tag: '不明' };
    if (wsum[st.tag] == null) return;
    var w = Math.pow(0.92, i);
    wsum[st.tag] += w; total += w;
    ex.push({ date: r.date, name: r.raceName, tag: st.tag, pos4: st.pos4, raw: r.passing, dist: r.dist, baba: r.baba });
  });
  if (!total) return null;
  var best = null;
  ['逃げ','先行','差し','追込'].forEach(function(k){ if (!best || wsum[k] > wsum[best]) best = k; });
  var pct = {};
  ['逃げ','先行','差し','追込'].forEach(function(k){ pct[k] = Math.round(wsum[k] / total * 100); });
  return { tag: best, conf: Math.round(wsum[best] / total * 100), pct: pct, races: latest.length, all: rs.length, examples: ex.slice(0, 8) };
}

/* ---------- UI ---------- */
function _stSetModal(html){
  var b = $('modalBody'); if (b) b.innerHTML = html;
}
function stStyleBadge(tag){
  var c = STYLE_COLORS[tag] || '#999';
  return '<span style="color:' + c + ';font-weight:800">' + tag + '</span>';
}

function stStart(){
  var targets = state.horses.filter(function(h){ return h.no && h.name; });
  var withId = targets.filter(function(h){ return h.nk; });
  var noId = targets.length - withId.length;
  if (!targets.length){ _stModalMsg('脚質AI', '出馬表の馬がまだありません。'); return; }
  if (!withId.length){
    _stModalMsg('脚質AI', '各馬の「netkeiba競走馬ID」が未取得です。①の「netkeiba URLから直接取込」で出馬表を取り込んでください（OCRのみの入力では過去成績を参照できません）。');
    return;
  }
  showModal('<h2>🧠 脚質のAI推定</h2><p>netkeiba の過去成績(' + withId.length + '頭分)を取得しています…</p><p id="stProg" class="small muted"></p>', function(root){});
  var results = {}, fails = [];
  var done = 0;
  var next = function(i){
    if (i >= withId.length){
      stShowResults(results, fails, noId);
      return;
    }
    var h = withId[i];
    var prog = $('stProg'); if (prog) prog.textContent = (i+1) + ' / ' + withId.length + '　' + h.no + ' ' + h.name + ' を取得中…';
    var key = 'r:' + h.nk;
    var cached = stLsGet(key);
    var p = cached ? Promise.resolve(cached) : stFetchHtml('https://db.netkeiba.com/horse/ajax_horse_results.html?id=' + h.nk).then(function(html){
      var pr = stParseHorseResults(html);
      stLsSet(key, pr);
      return pr;
    });
    p.then(function(pr){
      var pred = stPredict(pr.races || []);
      results[h.uid] = { horse: h, pred: pred, n: pr.races ? pr.races.length : 0 };
      next(i + 1);
    }).catch(function(err){
      fails.push({ horse: h, err: err });
      results[h.uid] = { horse: h, pred: null, n: 0 };
      next(i + 1);
    });
  };
  next(0);
}

function _stModalMsg(title, msg){
  showModal('<h2>' + esc(title) + '</h2><p>' + esc(msg) + '</p><div style="text-align:right"><button class="btn primary" data-mcl>閉じる</button></div>', function(root){
    var b = root.querySelector('[data-mcl]'); if (b) b.addEventListener('click', closeModal);
  });
}

function stShowResults(results, fails, noId){
  var list = state.horses.filter(function(h){ return results[h.uid] && results[h.uid].pred; });
  var rows = '';
  state.horses.forEach(function(h){
    var r = results[h.uid];
    if (!r) return;
    if (r.pred){
      var pd = r.pred;
      var pctTxt = ['逃げ','先行','差し','追込'].map(function(k){ return k + pd.pct[k] + '%'; }).join(' / ');
      rows += '<tr><td>' + esc(h.no) + '</td><td style="text-align:left">' + esc(h.name) + '</td>' +
        '<td>' + stStyleBadge(pd.tag) + ' <span class="muted small">確信度 ' + pd.conf + '%</span></td>' +
        '<td class="small muted" style="text-align:left">' + esc(pctTxt) + '<br>判定 ' + pd.races + '走（直近を重視）</td></tr>';
    } else {
      rows += '<tr><td>' + esc(h.no) + '</td><td style="text-align:left">' + esc(h.name) + '</td>' +
        '<td class="muted">取得失敗/データなし</td><td class="small muted">' + (fails.some(function(f){ return f.horse.uid === h.uid; }) ? '取得に失敗（通信設定を確認）' : '過去成績がありません') + '</td></tr>';
    }
  });
  var html = '<h2>🧠 脚質のAI推定結果</h2>' +
    '<p class="small muted">各馬の過去の「コーナー通過順(4角位置)」から逃げ/先行/差し/追込を自動分類（直近のレースほど重視）。反映後も表で自由に修正できます。' + (noId ? '　※OCR入力の馬(' + noId + '頭)はID不明のため対象外です。' : '') + '</p>' +
    '<div class="tblwrap"><table><thead><tr><th>馬番</th><th>馬名</th><th>AI予測の脚質</th><th>内訳</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<div style="text-align:right;margin-top:12px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">' +
    '<button class="btn ghost" data-mcl>閉じる（反映しない）</button>' +
    '<button class="btn primary" data-stok>予測を脚質欄へ反映</button></div>';
  showModal(html, function(root){
    var ok = root.querySelector('[data-stok]'); if (ok) ok.addEventListener('click', function(){
      var applied = 0;
      state.horses.forEach(function(h){
        var r = results[h.uid]; if (!r || !r.pred) return;
        h.style = r.pred.tag; h.styleSrc = 'ai'; h.styleConf = r.pred.conf || 0; applied++;
      });
      rebuildHorseTable();
      closeModal();
      var el = $('pasteLog'); if (el) showLogLines(el, ['🧠 脚質AI: ' + applied + '頭の脚質を予測値で更新しました（手動で修正もできます）']);
    });
    var cl = root.querySelector('[data-mcl]'); if (cl) cl.addEventListener('click', closeModal);
  });
}

/* =========================================================
   ★2026-09-13 第21弾②: 脚質のAI推定を「通信ゼロ」で実行する（🤖自動マクロ用）
   ---------------------------------------------------------
   🧠脚質をAI推定 は db.netkeiba.com/horse/ajax_horse_results.html を取りに行きますが、
   これは ①「🧾 全馬のプロフィール・戦績・成績分析」(p34 / khl_hd_v1) や
   ①「🐎 全馬に前走の上3F・タイムを自動反映」(p40 / keiba_nk_v1) が既に取っている
   【同じ馬の同じ過去成績】です。自動マクロでは (B) で必ずそれを取った直後に走るので、
   ここでは端末内のキャッシュだけを使って推定します（＝追加通信ゼロ・数秒で終わる）。

   opt.overwrite : 既存の脚質を上書きするか（既定 true。ただし手動入力は絶対に上書きしない）
   opt.minConf   : 上書きしてよい最低確信度（既定 70%。空欄は確信度に関係なく埋めます）
   opt.fetch     : true のときだけキャッシュに無い馬を netkeiba から取りに行く（既定 false）
   戻り値 Promise<{ total, ok, filled, over, skipManual, noData }>
   ========================================================= */
function stRecsToRuns(recs){
  /* p34/p40 の戦績行（date/name/head/no/dist/baba/order/pass/last3）を
     stPredict() が使う形（raceName/heads/passing）に写す */
  return (recs || []).map(function(r){
    return {
      date: r.date || '', raceName: r.name || r.raceName || '', heads: r.head || r.heads || '',
      no: r.no || '', dist: r.dist || '', baba: r.baba || '',
      order: parseInt(r.order, 10) || 0,
      passing: r.pass || r.passing || '', last3: r.last3 || ''
    };
  });
}
function stRunsForHorse(h){
  var id = String((h && h.nk) || '').trim();
  if (!id) return null;
  // 1) ①「🧾 全馬のプロフィール・戦績・成績分析」のキャッシュ（自動マクロ (B) が必ず温めている）
  try {
    if (typeof hdLs === 'function' && typeof hdCacheKey === 'function'){
      var hr = hdLs()[hdCacheKey(id)];
      if (hr && hr.r && hr.r.length) return { runs: stRecsToRuns(hr.r), src: '🧾全馬データ' };
    }
  } catch(e){}
  // 2) ①「🐎 netkeiba 馬データ（上3F・前走）」のキャッシュ
  try {
    if (typeof nkLs === 'function'){
      var nl = nkLs(), nr = nl && nl.h && nl.h[id];
      if (nr && nr.recs && nr.recs.length) return { runs: stRecsToRuns(nr.recs), src: '🐎馬データ' };
    }
  } catch(e){}
  // 3) 脚質AI自身のキャッシュ（🧠ボタンを過去に押したことがある馬）
  try {
    var c = stLsGet('r:' + id);
    if (c && c.races && c.races.length) return { runs: c.races, src: '🧠脚質AI' };
  } catch(e){}
  return null;
}
function stRunFromCache(opt){
  opt = opt || {};
  var out = { total: 0, ok: 0, filled: 0, over: 0, skipManual: 0, noData: 0, noId: 0, lines: [] };
  if (typeof state === 'undefined' || !state.horses || !state.horses.length){
    return Promise.resolve({ skip: true, reason: '出馬表がありません', total: 0, ok: 0 });
  }
  var minConf = (opt.minConf != null) ? opt.minConf : 70;
  var allowOver = (opt.overwrite !== false);
  var targets = state.horses.filter(function(h){ return h && h.no && (h.name || h.odds); });
  out.total = targets.length;
  var needFetch = [];
  targets.forEach(function(h){
    if (!h.nk){ out.noId++; return; }
    var c = stRunsForHorse(h);
    if (!c){ out.noData++; if (opt.fetch) needFetch.push(h); return; }
    var pred = null;
    try { pred = stPredict(c.runs || []); } catch(e){ pred = null; }
    if (!pred || !pred.tag){ out.noData++; return; }
    out.ok++;
    var cur = String(h.style || '').trim();
    if (!cur){
      h.style = pred.tag; h.styleSrc = 'ai'; h.styleConf = pred.conf || 0; out.filled++;
      out.lines.push('　' + (h.no ? h.no + '番 ' : '') + (h.name || '') + ': ' + pred.tag +
        '（確信度 ' + pred.conf + '%・判定 ' + pred.races + '走・' + c.src + 'のキャッシュ）');
    } else if (cur !== pred.tag && h.styleSrc === 'manual'){
      out.skipManual++;
    } else if (cur !== pred.tag && allowOver && (pred.conf || 0) >= minConf){
      h.style = pred.tag; h.styleSrc = 'ai'; h.styleConf = pred.conf || 0; out.over++;
      out.lines.push('　' + (h.no ? h.no + '番 ' : '') + (h.name || '') + ': ' + cur + ' → ' + pred.tag +
        '（確信度 ' + pred.conf + '%・' + c.src + 'のキャッシュ）');
    } else {
      h.styleConf = pred.conf || 0;
      if (h.styleSrc !== 'manual') h.styleSrc = h.styleSrc || 'ai';
    }
  });
  var finish = function(){
    try { if (typeof rebuildHorseTable === 'function') rebuildHorseTable(); } catch(e){}
    try { if (typeof saveNow === 'function') saveNow(); } catch(e){}
    return out;
  };
  if (!needFetch.length) return Promise.resolve(finish());
  // opt.fetch=true のときだけ、キャッシュに無い馬を netkeiba から取りに行く（手動ボタン相当）
  var seq = Promise.resolve();
  needFetch.forEach(function(h){
    seq = seq.then(function(){
      return stFetchHtml('https://db.netkeiba.com/horse/ajax_horse_results.html?id=' + h.nk).then(function(html){
        var pr = stParseHorseResults(html);
        stLsSet('r:' + h.nk, pr);
        var pred = stPredict(pr.races || []);
        if (!pred || !pred.tag) return;
        out.ok++;
        var cur = String(h.style || '').trim();
        if (!cur || (allowOver && cur !== pred.tag && h.styleSrc !== 'manual' && (pred.conf || 0) >= minConf)){
          if (!cur) out.filled++; else out.over++;
          h.style = pred.tag; h.styleSrc = 'ai'; h.styleConf = pred.conf || 0;
          out.lines.push('　' + (h.no ? h.no + '番 ' : '') + (h.name || '') + ': ' + pred.tag + '（確信度 ' + pred.conf + '%・netkeiba から取得）');
        }
      }).catch(function(){ out.noData++; });
    });
  });
  return seq.then(finish);
}

function initStyleAI(){
  var b = $('btnStyleAI');
  if (b) on(b, 'click', stStart);
}
