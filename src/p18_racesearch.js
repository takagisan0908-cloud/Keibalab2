/* =========================================================
   18 レース検索（年＋レース名 → 出馬表URL）
   netkeiba「重賞日程」(/top/schedule.html?year=YYYY, 2002〜今年)
   から該当レースの日程を探し、その日のレース一覧
   (/top/race_list_sub.html?kaisai_date=YYYYMMDD) から
   race_idを特定して「出馬表URL」をコピー/自動入力します。
   ※ 対象はJRAの重賞(G1〜G3/J・G)です。
   ========================================================= */
var RS_LS   = 'khl_rs_v1';
var RS_VENUES = ['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉'];
var RS_ALIAS = {
  '日本ダービー':'東京優駿', 'ダービー':'東京優駿', 'オークス':'優駿牝馬',
  'マイルCS':'マイルチャンピオンシップ', 'NHKマイルC':'NHKマイルカップ',
  '朝日杯':'朝日杯フューチュリティステークス', 'ホープフルS':'ホープフルステークス'
};

function rsLs(){ try { return JSON.parse(cmpUnpack(localStorage.getItem(RS_LS)) || '{}'); } catch(e){ return {}; } }
function rsLsSet(o){ try { localStorage.setItem(RS_LS, cmpPack(JSON.stringify(o))); } catch(e){} }

/* 全角→半角・大文字・空白除去（比較用正規化） */
function rsNorm(s){
  return String(s == null ? '' : s).toUpperCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(c){ return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[\s・−–—～〜]/g, '')
    .replace(/[－]/g, '');
}
/* レース名の短縮形⇔正式形を揃えるキー（ステークス⇔S 等） */
function rsBase(name){
  var n = rsNorm(name);
  var al = rsNorm(RS_ALIAS[n] || '');
  if (al && al.length >= 4) n = al;
  var suf = ['ステークス','カップ','ハンデキャップ','チャンピオンシップ'];
  var one = ['S','C','H','STAKES','CUP'];
  for (var i = 0; i < suf.length; i++){
    if (n.length > suf[i].length + 1 && n.slice(-suf[i].length) === suf[i]){ n = n.slice(0, -suf[i].length); break; }
  }
  for (var j = 0; j < one.length; j++){
    if (n.length > 2 && n.slice(-1) === one[j]){ n = n.slice(0, -1); break; }
  }
  return n;
}
function rsKey(name){ return rsBase(name); }
/* クエリがレース名に該当するか（正式名/通称/部分一致） */
function rsMatchName(query, raceName){
  var q = rsKey(query), r = rsKey(raceName);
  if (!q) return false;
  if (q === r) return true;
  if (r.indexOf(q) >= 0) return true;
  if (q.indexOf(r) >= 0) return true;
  return false;
}

/* ---------- 重賞日程の解析（/top/schedule.html） ---------- */
function rsParseSchedule(html){
  var rows = [];
  var re = /<tr class="schedule_list\d+"[^>]*>([\s\S]*?)<\/tr>/g, m;
  while ((m = re.exec(html))){
    var seg = m[1];
    var tds = seg.split(/<td[^>]*>/i).slice(1).map(function(x){ return x.split('</td>')[0]; });
    if (tds.length < 5) continue;
    var dateRaw = (tds[0] || '').replace(/<[^>]+>/g, '').trim();
    var nameCell = tds[1] || '';
    var nm = nameCell.match(/<a[^>]*>([\s\S]*?)<\/a>/);
    var name = (nm ? nm[1] : nameCell).replace(/<[^>]+>/g, '').replace(/[\s　]+/g, '').trim();
    var grade = (tds[2] || '').replace(/<[^>]+>/g, '').trim();
    var place = (tds[3] || '').replace(/<[^>]+>/g, '').trim();
    var dist  = (tds[4] || '').replace(/<[^>]+>/g, '').trim();
    var dm = dateRaw.match(/(\d{1,2})\/(\d{1,2})/);
    if (!dm || !name) continue;
    rows.push({ mon: +dm[1], day: +dm[2], dateRaw: dateRaw, name: name, grade: grade, place: place, dist: dist });
  }
  return rows;
}

/* ---------- 開催日のレース一覧の解析（/top/race_list_sub.html） ---------- */
function rsParseDayList(html){
  var items = [];
  var re = /<li class="RaceList_DataItem[^"]*">([\s\S]*?)<\/li>/g, m;
  while ((m = re.exec(html))){
    var seg = m[1];
    // レースID: 出馬表（未確定）or 結果（確定済）どちらのリンクにも付く
    var am = seg.match(/race_id=(\d{12})/);
    if (!am) continue;
    var rid = am[1];
    var title = (seg.match(/<span class="ItemTitle">([\s\S]*?)<\/span>/) || [])[1] || '';
    title = title.replace(/<[^>]+>/g, '').trim();
    if (!title) continue;
    var rn = (seg.match(/<span>\s*<span class="MyRace_List_Item"[^>]*><\/span>\s*(\d{1,2})R\s*<\/span>/) || [])[1];
    var tm = (seg.match(/RaceList_Itemtime">([\s\S]*?)<\//) || [])[1];
    var ln = (seg.match(/RaceList_ItemLong[^>]*>([\s\S]*?)<\/span>/) || [])[1];
    items.push({
      rid: rid,
      title: String(title).replace(/[\s　]+/g, ''),
      r: rn ? +rn : null,
      time: (tm || '').replace(/[^\d:]/g, ''),
      long: (ln || '').replace(/<[^>]+>/g, '').trim(),
      url: 'https://race.netkeiba.com/race/shutuba.html?race_id=' + rid
    });
  }
  return items;
}

/* ---------- 取得（リレー経由＋短期キャッシュ） ---------- */
function rsFetch(url){
  if (typeof histFetchHtml === 'function') return histFetchHtml(url);
  return Promise.reject(new Error('中継取得関数が見つかりません'));
}
function rsFetchCached(key, url, ttlMs){
  var o = rsLs();
  var c = o[key];
  if (c && c.at && Date.now() - c.at < ttlMs && c.data) return Promise.resolve(c.data);
  return rsFetch(url).then(function(html){
    try { o[key] = { at: Date.now(), data: html }; rsLsSet(o); } catch(e){}
    return html;
  });
}

/* 年 → 日程行一覧 */
function rsSchedule(year){
  return rsFetchCached('sch:' + year, 'https://race.netkeiba.com/top/schedule.html?year=' + year, 6 * 3600 * 1000)
    .then(function(html){ return rsParseSchedule(html); });
}
/* 日付(YYYYMMDD) → 当日のレース一覧 */
function rsDay(ymd){
  return rsFetchCached('day:' + ymd, 'https://race.netkeiba.com/top/race_list_sub.html?kaisai_date=' + ymd + '&encoding=UTF-8', 30 * 60 * 1000)
    .then(function(html){ return rsParseDayList(html); });
}

/* ---------- 検索 ---------- */
function rsSearch(year, name){
  var q = rsNorm(name);
  if (!q) return Promise.reject(new Error('レース名を入力してください'));
  if (!/^\d{4}$/.test(String(year))) return Promise.reject(new Error('年は4桁で入力してください'));
  if (+year < 2002) return Promise.reject(new Error('2002年以降のみ検索できます'));
  return rsSchedule(year).then(function(rows){
    var hit = rows.filter(function(r){ return rsMatchName(q, r.name); });
    // 日程行 → その日を日別一覧で解決
    var days = [];
    hit.forEach(function(r){
      var ymd = String(year) + ('0' + r.mon).slice(-2) + ('0' + r.day).slice(-2);
      if (days.indexOf(ymd) < 0) days.push(ymd);
    });
    var done = 0;
    return Promise.all(days.map(function(ymd){
      return rsDay(ymd).then(function(items){
        // その日程行(複数可)それぞれに対し、レース一覧から一致を探す
        var out = [];
        hit.forEach(function(r){
          if (('0' + r.mon).slice(-2) + ('0' + r.day).slice(-2) !== ymd.slice(4)) return;
          var cand = items.filter(function(it){ return rsMatchName(r.name, it.title) || rsMatchName(q, it.title); });
          // 距離も一致していれば優先
          var sameDist = cand.filter(function(it){
            var dl = rsNorm(it.long).replace(/[^0-9A-Za-z]/g, '');
            var dr = rsNorm(r.dist).replace(/[^0-9A-Za-z]/g, '');
            return dl && dr && dl === dr;
          });
          var list = sameDist.length ? sameDist : cand;
          (list.length ? list : [{ none: true }]).forEach(function(it){
            out.push({
              dateRaw: r.dateRaw, year: +year, name: r.name, grade: r.grade, place: r.place, dist: r.dist,
              dayName: it.title || '', rid: it.rid || '', r: it.r || null, time: it.time || '',
              long: it.long || '', url: it.url || '', none: !!it.none
            });
          });
        });
        return out;
      }).catch(function(){ return []; });
    })).then(function(arrs){
      var flat = [];
      arrs.forEach(function(a){ flat = flat.concat(a); });
      return { rows: rows, matches: flat, query: String(name).trim(), year: +year };
    });
  });
}

/* ---------- クリップボード ---------- */
function rsCopyText(text){
  return new Promise(function(res){
    function fallback(){
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        res(ok);
      } catch(e){ res(false); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ res(true); }).catch(fallback);
    } else fallback();
  });
}

/* ---------- UI ---------- */
function rsMsg(text, cls){
  var el = $('rsMsg'); if (!el) return;
  el.textContent = text; el.className = 'small ' + (cls || 'muted');
}
function rsEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); }

function rsStart(){
  var year = ($('rsYear') && $('rsYear').value || '').trim();
  var name = ($('rsName') && $('rsName').value || '').trim();
  var out = $('rsOut');
  if (out) out.innerHTML = '';
  rsMsg('検索中…');
  rsSearch(year, name).then(function(res){
    var m = res.matches || [];
    if (!m.length){
      rsMsg('「' + res.query + '」に一致するJRA重賞が見つかりませんでした（' + res.year + '年）。正式なレース名や別名（例: セントウルステークス / セントウルS）で試すか、年を確認してください。', 'warn');
      return;
    }
    var hasUrl = m.some(function(x){ return x.rid; });
    var rows = m.map(function(x){
      var nameTxt = rsEsc(x.name) + (x.grade ? ' <span style="color:var(--mut)">' + rsEsc(x.grade) + '</span>' : '');
      var meta = (x.place ? rsEsc(x.place) + ' ' : '') + (x.r ? x.r + 'R ' : '') +
                 (x.time ? rsEsc(x.time) + ' ' : '') + (x.long || x.dist ? rsEsc(x.long || x.dist) : '') +
                 (x.dateRaw ? '（' + res.year + '年 ' + rsEsc(x.dateRaw) + '）' : '');
      var btns = '';
      if (x.rid){
        btns = '<button type="button" class="btn primary rs-use" data-url="' + rsEsc(x.url) + '" data-name="' + rsEsc(x.name) + '">' +
                 '✅ このレースを出馬表＋オッズまで自動取込</button> ' +
               '<button type="button" class="btn rs-copy" data-url="' + rsEsc(x.url) + '">📋 URLコピー</button>';
      } else {
        btns = '<span class="small muted">出馬表は発走1〜2週間前から公開</span>';
      }
      return '<div style="border:1px solid var(--line2);border-radius:8px;padding:6px 8px;margin:4px 0;background:var(--card)">' +
             '<div><b>' + nameTxt + '</b></div>' +
             '<div class="small" style="color:var(--mut)">' + meta + '</div>' +
             '<div style="margin-top:4px">' + btns + '</div></div>';
    }).join('');
    out.innerHTML = rows;
    out.querySelectorAll('.rs-copy').forEach(function(b){
      b.addEventListener('click', function(){
        rsCopyText(b.getAttribute('data-url')).then(function(ok){
          rsMsg(ok ? 'URLをコピーしました（' + b.getAttribute('data-url') + '）' : 'コピーできませんでした。URL欄に直接貼り付けてください。');
        });
      });
    });
    out.querySelectorAll('.rs-use').forEach(function(b){
      b.addEventListener('click', function(){
        var u = b.getAttribute('data-url'), nm = b.getAttribute('data-name') || '';
        var inp = $('urlImport'); if (inp) inp.value = u;      // 失敗したときに URL 直貼り付けの枠でそのまま再実行できるように
        b.disabled = true;
        rsMsg('✅ 「' + nm + '」の<b>出馬表＋単勝オッズ</b>を自動で取り込みます…（数秒〜十数秒。進行は下のログに出ます）');
        /* 2026-09-11 第11弾: ①出馬表だけでなく②単勝オッズまで一気に取る（＝検索して選ぶだけで入力が終わる） */
        if (typeof nkImportBoth === 'function') nkImportBoth();
        else if (typeof nkImportCard === 'function'){ rsMsg('⚠️ オッズの自動取込が使えないため、出馬表だけ取り込みます。', 'warn'); nkImportCard(); }
        else rsMsg('URLを入力欄へセットしました。下の「🔗 netkeiba URLから直接取込」を開いて「①+② まとめて取込」を押してください。', 'warn');
        setTimeout(function(){ try { b.disabled = false; } catch(e){} }, 4000);
      });
    });
    rsMsg((hasUrl ? '候補 ' + m.length + ' 件（年=' + res.year + '）' : '該当レースの出馬表は未公開です（' + res.year + '年 ' + res.query + '）') +
          '。JRA重賞のみ対象です。');
  }).catch(function(e){
    rsMsg('検索に失敗しました：' + (e && e.message ? e.message : e) + '（中継が動く状態でご利用ください）', 'warn');
  });
}

function rsInitYear(){
  var y = new Date().getFullYear();
  var el = $('rsYear'); if (el && !el.value) el.value = y;
}

function initRs(){
  if (typeof on === 'function'){
    on('btnRsGo', 'click', rsStart);
    on('rsName', 'keydown', function(e){ if (e.key === 'Enter') rsStart(); });
  }
  rsInitYear();
}
