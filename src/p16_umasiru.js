/* =========================================================
   🌐 うましる(umasiru.com)の「追い切り評価」記事から調教タイムを取込
   - 対応: 重賞(G1〜G3)。「レース名 に該当する記事」を自動で探して取得
   - 記事内の最終追い切り表(例 4F54.2-3F37.9-1F11.5)を読取り、
     既存の「調教タイム」取込と同じ流れで馬名割当・反映
   ========================================================= */
var UMA_LIST = 'https://umasiru.com/archives/tag/oikiri/';

function umGradeOk(){
  var g = (state.race && state.race.grade) || '';
  var nm = (state.race && state.race.name) || '';
  if (g === 'G1' || g === 'G2' || g === 'G3') return true;
  return /\(G\s*I{1,3}\)|(G1|G2|G3|GI|GII|GIII)/.test(nm);
}
function umRaceNameToken(){
  var nm = String((state.race && state.race.name) || '');
  // 日付・開催(阪神11R)・グレード(G2)・括弧表記を除いたレース名のみ取り出す
  nm = nm
    .replace(/^\d{4}年\d{1,2}月\d{1,2}日\s*/, '')
    .replace(/^[^\s]*\d{1,2}R\s*/, '')
    .replace(/^\s*(G1|G2|G3|GI|GII|GIII|L|オープン|OP)\s*/i, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[Ｓ]/g, 'S')
    .trim();
  if (!nm) return '';
  var variants = [nm];
  if (/S$/.test(nm)) variants.push(nm.replace(/S$/, 'ステークス'));
  else if (/ステークス$/.test(nm)) variants.push(nm.replace(/ステークス$/, 'S'));
  return variants;
}
function _umClean(s){
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/* 記事タイトルが対象レースか */
function _umMatch(title, tokens){
  var t = String(title || '').replace(/[【】［］／]/g, '');
  var y = String(new Date().getFullYear());
  var y2 = y.slice(2);
  return tokens.some(function(tk){
    if (!tk) return false;
    return (t.indexOf(tk) >= 0 || t.indexOf(tk.replace(/\s/g,'')) >= 0) &&
           (t.indexOf(y) >= 0 || t.indexOf(y2) >= 0);
  });
}
/* 一覧ページから該当記事URLを探す */
function umFindArticle(listHtml, tokens){
  var best = null;
  var links = [];
  var re = /<a[^>]*href="(https:\/\/umasiru\.com\/archives\/\d+)"[^>]*>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(listHtml)) !== null){
    var title = _umClean(m[2]);
    if (title) links.push({ url: m[1], title: title });
  }
  // 絞り込み: 「追い切り/評価/全頭診断」を含み、レース名一致
  links = links.filter(function(l){ return /(追い切り|全頭診断|評価)/.test(l.title); });
  for (var i = 0; i < links.length; i++){
    if (_umMatch(links[i].title, tokens)){ best = links[i]; break; }
  }
  return best;
}

/* 記事HTMLから 各馬の 最終追切ラップ表 を抽出 */
function umParseArticle(html){
  var items = [];
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  var pendingName = null;
  var tokens = html.split(/(<h[123][^>]*>[\s\S]*?<\/h[123]>|<table[\s\S]*?<\/table>)/i);
  tokens.forEach(function(tok){
    if (/^<h[123]/i.test(tok)){
      pendingName = _umClean(tok.replace(/^<h[123][^>]*>/i,'').replace(/<\/h[123]>$/i,''));
      return;
    }
    if (!/^<table/i.test(tok)) return;
    var name = pendingName;
    var parsed = umParseTable(tok);
    if (parsed && name) items.push({ name: name, laps: parsed.laps, place: parsed.place, note: parsed.note });
  });
  return items;
}
function umParseTable(tableHtml){
  var rows = tableHtml.split(/<tr[^>]*>/i).slice(1);
  var headers = null, col = {};
  var data = [];
  rows.forEach(function(tr){
    if (!/<t[dh]/i.test(tr)) return;
    var cells = (tr.match(/<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi) || []).map(function(c){
      return _umClean(c.replace(/^<[^>]*>/i,'').replace(/<\/[^>]*>$/i,''));
    });
    if (!cells.length) return;
    if (!headers){
      var joined = cells.join('|');
      if (/場所/.test(joined) && /\d{1,2}F/.test(joined)){
        headers = cells;
        cells.forEach(function(c, i){
          var norm = c.replace(/\s/g,'');
          if (norm === '時期') col.period = i;
          if (norm === '場所') col.place = i;
          if (/^\d{1,2}F$/.test(norm) && col.laps == null) col.laps = {};
          if (/^\d{1,2}F$/.test(norm)) col.laps[i] = parseInt(norm, 10);
          if (/脚色/.test(norm)) col.leg = i;
        });
        return;
      }
      return;
    }
    data.push(cells);
  });
  if (!col.place) return null;
  // 最終追切の行を探す（無ければ最初のデータ行）
  var bestRow = null;
  for (var i = 0; i < data.length; i++){
    var period = data[i][col.period] != null ? data[i][col.period] : '';
    if (/最終追切|最終追い|最終追い切り/.test(period)){ bestRow = data[i]; break; }
  }
  if (!bestRow) bestRow = data.length ? data[0] : null;
  if (!bestRow) return null;
  var laps = [];
  var lapIdx = col.laps ? Object.keys(col.laps) : [];
  lapIdx.forEach(function(k){
    var dist = col.laps[k];
    var v = parseFloat(String(bestRow[parseInt(k,10)] == null ? '' : bestRow[parseInt(k,10)]));
    if (isFinite(v) && v > 0 && v < 200) laps.push([dist, v]);
  });
  if (!laps.length) return null;
  laps.sort(function(a, b){ return b[0] - a[0]; });
  return { laps: laps, place: (col.place != null && bestRow[col.place]) ? bestRow[col.place] : '' };
}

/* 反映（既存の調教タイム取込フローに渡す） */
function umApply(items, logEl, logLines){
  var parsed = [];
  items.forEach(function(it){
    var laps = (it.laps || []).map(function(x){ return [x[0], x[1]]; });
    parsed.push({ ok: true, kind: 'yobi', name: it.name, line: it.name + ' ' + it.laps.map(function(x){ return x[0] + 'F ' + x[1].toFixed(1); }).join('-'), ev: { laps: laps } });
  });
  if (!parsed.length){
    if (logEl) showLogLines(logEl, ['うましる記事から時計表を読み取れませんでした（記事形式の変更の可能性）。']);
    return;
  }
  // 既存の「馬名割当→調教タイム反映」モーダルへ
  mapAndApply(parsed, 'yobi', logEl, logLines || ['うましるの最終追い切りを ' + parsed.length + '頭分読み取りました。']);
}

/* ========== 実行 ========== */
function umLog(msg){
  var el = $('umaLog'); if (!el) return;
  el.innerHTML += (el.innerHTML ? '<br>' : '') + '・' + esc(msg);
}
function umLogClear(){ var el = $('umaLog'); if (el) el.innerHTML = ''; }

function umStartAuto(){
  umLogClear();
  if (!umGradeOk()){
    umLog('⚠ このレースは重賞(G1〜G3)ではありません。うましるの追い切り評価は重賞のみに対応しています。');
    return;
  }
  var tokens = umRaceNameToken();
  if (!tokens.length){ umLog('⚠ レース名が未入力です。「レース情報」にレース名を入れてください。'); return; }
  var btn = $('btnUmaAuto'); if (btn) btn.disabled = true;
  umLog('うましるの「追い切り評価」一覧を検索中…（対象: ' + tokens.join(' / ') + '）');
  var fin = function(){ if (btn) btn.disabled = false; };
  stFetchHtml(UMA_LIST).then(function(listHtml){
    var found = umFindArticle(listHtml, tokens);
    if (!found){
      umLog('⚠ 該当する記事が見つかりませんでした。レース名の表記違いが考えられます。下の「記事URLを直接指定」をお試しください。');
      fin(); return;
    }
    umLog('記事が見つかりました: ' + esc(found.title));
    umLoadArticle(found.url).then(fin).catch(function(e){
      umLog('⚠ 記事の取得に失敗: ' + (e && e.message ? e.message : e)); fin();
    });
  }).catch(function(e){
    umLog('⚠ 一覧の取得に失敗しました（通信方法の設定が必要です。①「URL取込の通信設定」をご確認ください）: ' + (e && e.message ? e.message : e));
    fin();
  });
}

function umLoadArticle(url){
  return stFetchHtml(url).then(function(html){
    var items = umParseArticle(html);
    umLog('記事を取得（' + items.length + '頭分の表を検出）');
    if (!items.length){ umLog('⚠ 時計表を検出できませんでした。'); return; }
    var logEl = $('pasteLog');
    var lines = ['🌐 うましる『' + esc(url.replace(/^.*archives\//,'記事')) + '』から調教タイムを取込（最終追い切り・重賞のみ）'];
    if (logEl) logEl.innerHTML = '';
    // 同じ画面の「調教タイム」欄に反映（馬名割当ダイアログ）
    mapAndApply(items.map(function(it){ return { ok:true, kind:'yobi', name: it.name, line: it.name, ev:{ laps: it.laps } }; }), 'yobi', logEl, lines);
    return items.length;
  });
}

function initUmasiru(){
  var b = $('btnUmaAuto');
  if (b) on(b, 'click', umStartAuto);
  var u = $('btnUmaUrl');
  if (u) on(u, 'click', function(){
    var inp = $('umaUrlInp');
    var v = inp ? String(inp.value).trim() : '';
    umLogClear();
    if (!v || !/umasiru\.com\/archives\/\d+/.test(v)){
      umLog('うましるの記事URL（例: https://umasiru.com/archives/21344 ）を貼ってください。');
      return;
    }
    if (!umGradeOk()){ umLog('⚠ このレースは重賞(G1〜G3)ではありません。重賞のみ対応です。'); return; }
    umLog('記事を取得中… ' + esc(v));
    var btn = $('btnUmaUrl'); if (btn) btn.disabled = true;
    umLoadArticle(v).then(function(){ if (btn) btn.disabled = false; }).catch(function(e){
      umLog('⚠ 記事の取得に失敗しました: ' + (e && e.message ? e.message : e));
      if (btn) btn.disabled = false;
    });
  });
}
