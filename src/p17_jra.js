/* =========================================================
   17 JRA公式の当日馬場情報を自動取得
   https://www.jra.go.jp/keiba/baba/ から当日の
   「馬場状態(芝/ダート)・天候・芝クッション値・含水率」を取得し、
   ①レース情報の「馬場状態」「クッション値」へ反映します。
   - 中継(/api/race 等)経由でShift_JIS→UTF-8変換します
   - JRAの開催日/開催場が対象です（JRA開催のない日・場は取得不可）
   ========================================================= */
var JRA_LS        = 'khl_jra_v1';
var JRA_VENUES    = ['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉'];
var JRA_COND_JPN  = { hard:'良', wet:'稍重', soft:'重', heavy:'不良' };
var JRA_TURF_KEY  = { 良:'fast', 稍重:'good', 重:'yield', 不良:'soft' };

function jraLsGet(){ try { return JSON.parse(cmpUnpack(localStorage.getItem(JRA_LS)) || '{}'); } catch(e){ return {}; } }
function jraLsSet(o){ try { localStorage.setItem(JRA_LS, cmpPack(JSON.stringify(o))); } catch(e){} }
function jEsc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); }

/* ---------- 対象レースの開催場 / コース種別 ---------- */
function jraRaceVenue(){
  var hay = [state.race.place || '', state.race.name || ''].join(' ');
  for (var i = 0; i < JRA_VENUES.length; i++){
    if (hay.indexOf(JRA_VENUES[i]) >= 0) return JRA_VENUES[i];
  }
  return '';
}
function jraRaceSurface(){
  var hay = [state.race.place || '', state.race.name || ''].join(' ');
  return hay.indexOf('ダート') >= 0 ? 'dirt' : 'turf';
}

/* ---------- index.html の開催場→index番号 対応 ---------- */
function jraParseVenueIndex(html){
  var map = {}, title = '';
  var tm = html.match(/<title>([\s\S]*?)<\/title>/);
  if (tm) title = tm[1];
  var re = /<a[^>]*href="(index(\d*)\.html)"[^>]*>([\s\S]*?)<\/a>/g, m;
  while ((m = re.exec(html))){
    var txt = String(m[3]).replace(/<[^>]+>/g, '').replace(/[\s　]/g, '');
    var mm = txt.match(/^(.+?)競馬場$/);
    if (mm) map[mm[1]] = m[2];   // index.html→''
  }
  var tt = title.match(/馬場情報（(.+?)競馬場）/);
  if (tt && !(tt[1] in map)) map[tt[1]] = '';
  return { title: title, map: map };
}
/* index.html(または任意の開催場ページ)のHTMLから対象開催場の番号を探す */
function jraVenueIndexNo(html, venue){
  var map = jraParseVenueIndex(html).map;
  return (venue in map) ? map[venue] : null;
}

/* ---------- 開催場ページの解析（公式発表の馬場状態等） ---------- */
function jraParseVenuePage(html){
  var out = { venue: '', meetingText: '', course: '', announce: null, surfaceJpn: null };
  var tm = html.match(/<title>([\s\S]*?)<\/title>/);
  if (tm){
    var tv = tm[1].match(/馬場情報（(.+?)競馬場）/);
    if (tv) out.venue = tv[1];
  }
  var h2 = html.match(/<h2>([\s\S]*?)<\/h2>/);
  if (h2) out.meetingText = String(h2[1]).replace(/<[^>]+>/g, '').replace(/[\s　]+/g, ' ').trim();
  var cm = html.match(/<div id="baba" data-current-course="([A-Za-z0-9]+)"/);
  if (cm) out.course = cm[1];

  var mC = html.match(/<div class="line condition" id="course_condition"[\s\S]*?<\/div><!-- \/\[\.line\] -->/);
  var seg = mC ? mC[0] : '';
  var a = { time: '', tenki: '', turf: '', dirt: '' };
  var mt = seg.match(/<span class="time">（([^<]*?)）<\/span>/); if (mt) a.time = mt[1].trim();
  var mt2 = seg.match(/天候[：:]\s*<strong>([^<]*?)<\/strong>/); if (mt2) a.tenki = mt2[1].trim();
  var mt3 = seg.match(/<h4>芝<\/h4>[\s\S]*?<p>([^<]*?)<\/p>/); if (mt3) a.turf = mt3[1].trim();
  var mt4 = seg.match(/<h4>ダート<\/h4>[\s\S]*?<p>([^<]*?)<\/p>/); if (mt4) a.dirt = mt4[1].trim();
  if (a.time || a.turf || a.dirt) out.announce = a;
  return out;
}

/* ---------- _data_cushion / _data_moist の会場ブロック抽出 ---------- */
function jraVenueBlock(html, venue){
  var ev = String(venue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re = new RegExp('<div id="rc[A-Za-z0-9]+" title="' + ev + '"[^>]*>([\\s\\S]*?)(?=<div id="rc[A-Za-z0-9]|<!-- /\\[#)');
  var m = html.match(re);
  return m ? m[1] : '';
}
/* "9月6日（日曜）7時30分" → {m,d,h,min} */
function jraTimeParts(label){
  var m = String(label).match(/(\d{1,2})月(\d{1,2})日[\s\S]*?(\d{1,2})時(?:(\d{1,2})分)?/);
  if (!m) return null;
  return { m: +m[1], d: +m[2], h: +m[3], min: m[4] ? +m[4] : 0 };
}
function jraDateOf(u, year){
  if (year == null) year = new Date().getFullYear();
  return new Date(year, u.m - 1, u.d, u.h || 0, u.min || 0).getTime();
}
/* 候補一覧から「対象開催日に近い最新測定」を選ぶ */
function jraPick(units, meetDate){
  var now = Date.now();
  function sameDay(u){ return meetDate && u.m === meetDate.m && u.d === meetDate.d; }
  var cand = units.filter(function(u){ return sameDay(u) || !meetDate; });
  if (!cand.length) cand = units;
  if (!cand.length) return null;
  var past = cand.filter(function(u){ return jraDateOf(u) <= now + 30 * 60 * 1000; });
  past.sort(function(a,b){ return jraDateOf(b) - jraDateOf(a); });
  if (past.length) return past[0];
  var fut = cand.slice().sort(function(a,b){ return jraDateOf(a) - jraDateOf(b); });
  return fut[0];
}

/* ---------- クッション値ファイル解析 ---------- */
function jraParseCushion(html, venue){
  var block = jraVenueBlock(html, venue);
  if (!block) return [];
  var times = [], vals = [];
  var re, m;
  re = /<div class="time">([^<]+?)<\/div>/g; while ((m = re.exec(block))) times.push(m[1].trim());
  re = /<div class="cushion">([\d.]+)<\/div>/g; while ((m = re.exec(block))) vals.push(parseFloat(m[1]));
  var n = Math.min(times.length, vals.length), units = [];
  for (var i = 0; i < n; i++){
    var tp = jraTimeParts(times[i]);
    if (!tp) continue;
    units.push({ label: times[i], m: tp.m, d: tp.d, h: tp.h, min: tp.min, v: vals[i] });
  }
  return units;
}

/* ---------- 含水率ファイル解析 ---------- */
function jraParseMoist(html, venue){
  var block = jraVenueBlock(html, venue);
  if (!block) return [];
  var times = [], turfs = [], dirts = [], notes = [];
  var re, m;
  re = /<div class="time">([^<]+?)<\/div>/g; while ((m = re.exec(block))) times.push(m[1].trim());
  re = /<div class="turf">\s*<span class="mg" data-condition="(\w+)">([\d.]+)<\/span>\s*<span class="m4c" data-condition="(\w+)">([\d.]+)<\/span>/g;
  while ((m = re.exec(block))) turfs.push({ cond: m[1], mg: parseFloat(m[2]), m4c: parseFloat(m[4]) });
  re = /<div class="dirt">\s*<span class="mg" data-condition="(\w+)">([\d.]+)<\/span>\s*<span class="m4c" data-condition="(\w+)">([\d.]+)<\/span>/g;
  while ((m = re.exec(block))) dirts.push({ cond: m[1], mg: parseFloat(m[2]), m4c: parseFloat(m[4]) });
  re = /<li>注記：([^<]*?)<\/li>/g; while ((m = re.exec(block))) notes.push(m[1].trim());
  var n = Math.min(times.length, turfs.length, dirts.length), units = [];
  for (var i = 0; i < n; i++){
    var tp = jraTimeParts(times[i]);
    if (!tp) continue;
    units.push({
      label: times[i], m: tp.m, d: tp.d, h: tp.h, min: tp.min,
      turf: turfs[i], dirt: dirts[i], note: notes[i] || ''
    });
  }
  return units;
}

/* ---------- 開催日の解析（ページ本文から「2026年9月6日」等） ---------- */
function jraMeetDate(meetingText){
  var m = String(meetingText).match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

/* ---------- 取得 ---------- */
function jraFetch(url){
  if (typeof histFetchHtml === 'function') return histFetchHtml('https://www.jra.go.jp' + url);
  return Promise.reject(new Error('中継取得関数が見つかりません'));
}

/* ---------- 反映 ---------- */
function jraFillResult(res, venue){
  var st = [];
  if (res.page && res.page.announce){
    var a = res.page.announce;
    st.push('公式発表(' + a.time + ')：天候 ' + a.tenki + ' / 芝 ' + a.turf + ' / ダート ' + a.dirt);
  }
  var mu = res.moistPick, cu = res.cushionPick;
  if (mu){
    var line = '測定(' + mu.label + ')：芝 ' + JRA_COND_JPN[mu.turf.cond] +
      '（含水率 ' + mu.turf.mg + '〜' + mu.turf.m4c + '％）・ダート ' + JRA_COND_JPN[mu.dirt.cond] +
      '（' + mu.dirt.mg + '〜' + mu.dirt.m4c + '％）';
    if (mu.note) line += ' ／ ' + mu.note;
    st.push(line);
  }
  if (cu) st.push('芝クッション値 ' + cu.v + '（測定 ' + cu.label + '）');

  // 反映: 馬場状態(レースが芝なら芝、ダートならダート)
  var surface = jraRaceSurface();
  if (mu){
    var cond = surface === 'dirt' ? mu.dirt.cond : mu.turf.cond;
    var jpn  = JRA_COND_JPN[cond] || '';
    if (surface === 'dirt'){
      var bv = (jpn === '良') ? 'dirt_fast' : 'dirt_seal';
      var sel = $('rBaba');
      if (sel) { sel.value = bv; }
      st.push('→「馬場状態」を「ダート・' + (jpn === '良' ? '良' : '含水多め') + '」に設定しました。');
    } else {
      var key = JRA_TURF_KEY[jpn] || '';
      if (key){
        var sel2 = $('rBaba');
        if (sel2) sel2.value = key;
        st.push('→「馬場状態」を「' + jpn + '」に設定しました。');
      }
    }
  }
  if (cu){
    var cin = $('rCushion');
    if (cin){ cin.value = cu.v; st.push('→「芝のクッション値」に ' + cu.v + ' を入力しました。'); }
  }
  if (typeof raceInputChanged === 'function') raceInputChanged();
  return st;
}

/* ---------- ボタン処理 ---------- */
function jraStart(){
  var info = $('jraBabaInfo');
  function put(msg, cls){
    if (info) { info.className = 'small ' + (cls || ''); info.textContent = msg; }
  }
  var venue = jraRaceVenue();
  if (!venue){
    put('対象レースの「開催」欄に競馬場名（例：阪神 芝 1400m）を入力してから取得してください。', 'warn');
    return;
  }
  put('JRA公式(' + venue + ')から取得中…');
  jraFetch('/keiba/baba/index.html').then(function(html){
    var no = jraVenueIndexNo(html, venue);
    if (no === null) throw new Error(venue + ' は本日のJRA開催場にありません（開催のない日は取得不可）');
    var pageUrl = '/keiba/baba/index' + (no === '' ? '' : no) + '.html';
    return jraFetch(pageUrl).then(function(pg){
      var page = jraParseVenuePage(pg);
      return Promise.all([
        jraFetch('/keiba/baba/_data_cushion.html'),
        jraFetch('/keiba/baba/_data_moist.html')
      ]).then(function(arr){
        var md = jraMeetDate(page.meetingText);
        var meet = md ? { m: md.m, d: md.d } : null;
        return {
          page: page,
          cushionPick: jraPick(jraParseCushion(arr[0], venue), meet),
          moistPick:   jraPick(jraParseMoist(arr[1], venue), meet)
        };
      });
    });
  }).then(function(res){
    var lines = jraFillResult(res, venue);
    var t = 'JRA公式 ' + venue + '｜' + (res.page && res.page.meetingText ? res.page.meetingText : '開催日不明');
    var full = t;
    if (lines.length) full += '｜' + lines.join('｜');
    put(full.replace(/｜/g, ' ／ '));
    try {
      var o = jraLsGet();
      o['last:' + venue] = { at: Date.now(), text: full };
      jraLsSet(o);
    } catch(e){}
  }).catch(function(e){
    put('取得に失敗しました：' + (e && e.message ? e.message : e) +
        '（中継が動く状態＝ローカルサーバー or Vercel/Cloudflare Pages へ再デプロイでご利用ください）', 'warn');
  });
}
function initJra(){
  var b = $('btnJraBaba');
  if (b && typeof on === 'function') on('btnJraBaba', 'click', jraStart);
  // 前回の取得成功があれば起動時に表示だけしておく
  try {
    var venue = jraRaceVenue();
    if (venue){
      var o = jraLsGet(), k = 'last:' + venue;
      if (o && o[k] && $('jraBabaInfo')){
        var info = $('jraBabaInfo');
        info.className = 'small muted';
        info.textContent = '前回取得(' + new Date(o[k].at).toLocaleString() + ') ／ ' + o[k].text + '（再取得で更新）';
      }
    }
  } catch(e){}
}
