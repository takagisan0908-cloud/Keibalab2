/* =========================================================
   46 天気予報タブ（tenki.jp の地点を「競馬場の郵便番号」で引く）
   ---------------------------------------------------------
   ・当日開催の競馬場を netkeiba のレース一覧から自動判定
   ・競馬場 → 郵便番号は「ホームメイト 全国の競馬場一覧」の所在地の郵便番号
       https://www.homemate-research-keiba.com/list/
   ・郵便番号を tenki.jp の地点検索に投げ、1時間ごとページ
       https://tenki.jp/lite/forecast/<path>/1hour.html
     から「天気・気温・湿度・降水量・降水確率・風向風速」を取り出して表にする
   ・取得は既存の中継(リレー)設定をそのまま使う
   ========================================================= */

var TK_LS = 'keiba_tenki_v1';
function tkLs(){ try { return JSON.parse(cmpUnpack(localStorage.getItem(TK_LS)) || '{}') || {}; } catch(e){ return {}; } }
function tkSave(o){ try { localStorage.setItem(TK_LS, cmpPack(JSON.stringify(o))); } catch(e){} }

/* 競馬場 → 郵便番号（出典: ホームメイト 全国の競馬場一覧の所在地）
   ※ 施設専用の大口郵便番号(例: 函館競馬場 042-8585)は tenki.jp の地点に無いことがあるため、
     その場合は所在地の町域郵便番号を使う（函館＝駒場町 042-0935）。 */
var TK_TRACKS = [
  { name:'札幌',   label:'札幌競馬場',         pc:'060-0016', kind:'中央' },
  { name:'函館',   label:'函館競馬場',         pc:'042-0935', kind:'中央', note:'所在地は駒場町（専用番号042-8585は地点なし）' },
  { name:'福島',   label:'福島競馬場',         pc:'960-8114', kind:'中央' },
  { name:'新潟',   label:'新潟競馬場',         pc:'950-3301', kind:'中央' },
  { name:'東京',   label:'東京競馬場',         pc:'183-0024', kind:'中央' },
  { name:'中山',   label:'中山競馬場',         pc:'273-0037', kind:'中央' },
  { name:'中京',   label:'中京競馬場',         pc:'470-1132', kind:'中央' },
  { name:'京都',   label:'京都競馬場',         pc:'612-8265', kind:'中央' },
  { name:'阪神',   label:'阪神競馬場',         pc:'665-0053', kind:'中央' },
  { name:'小倉',   label:'小倉競馬場',         pc:'802-0841', kind:'中央' },
  { name:'大井',   label:'大井競馬場（東京シティ競馬）', pc:'140-0012', kind:'地方' },
  { name:'川崎',   label:'川崎競馬場',         pc:'210-0011', kind:'地方' },
  { name:'船橋',   label:'船橋競馬場',         pc:'273-0013', kind:'地方' },
  { name:'浦和',   label:'浦和競馬場',         pc:'336-0016', kind:'地方' },
  { name:'園田',   label:'園田競馬場',         pc:'661-0951', kind:'地方' },
  { name:'姫路',   label:'姫路競馬場',         pc:'670-0952', kind:'地方' },
  { name:'名古屋', label:'名古屋競馬場',       pc:'498-0065', kind:'地方' },
  { name:'笠松',   label:'笠松競馬場',         pc:'501-6036', kind:'地方' },
  { name:'金沢',   label:'金沢競馬場',         pc:'920-3106', kind:'地方' },
  { name:'水沢',   label:'水沢競馬場',         pc:'023-0831', kind:'地方' },
  { name:'盛岡',   label:'盛岡競馬場',         pc:'020-0803', kind:'地方' },
  { name:'門別',   label:'門別競馬場',         pc:'055-0008', kind:'地方' },
  { name:'帯広',   label:'ばんえい十勝（帯広競馬場）', pc:'080-0023', kind:'地方' },
  { name:'高知',   label:'高知競馬場',         pc:'781-0271', kind:'地方' },
  { name:'佐賀',   label:'佐賀競馬場',         pc:'841-0073', kind:'地方' },
  { name:'荒尾',   label:'J-PLACE荒尾（旧荒尾競馬場）', pc:'864-0003', kind:'地方', note:'2012年に開催終了' }
];
/* ===== 0) 競馬場の住所（郵便番号）を「初めの一回だけ」コピーして保存 =====
   出典: ホームメイト 全国の競馬場一覧  https://www.homemate-research-keiba.com/list/
   ・初回だけ一覧ページを取得し、各競馬場の「所在地（〒郵便番号＋住所）」を localStorage に保存
   ・2回目以降（再起動後も保存済み）は取得せず、当日開催の競馬場名ボタンを押すと天気予報が出る */
var TK_ADDR_URL = 'https://www.homemate-research-keiba.com/list/';
function tkHalf(s){
  return String(s == null ? '' : s).replace(/[\uFF21-\uFF3A\uFF41-\uFF5A\uFF10-\uFF19\uFF0D]/g, function(c){
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  });
}
/* 一覧の施設名 → 当アプリの競馬場キー
   中京競馬場→中京 / ばんえい十勝（帯広競馬場）→帯広 / Ｊ－ＰＬＡＣＥ荒尾→荒尾 */
function tkNameKey(name){
  var s = tkHalf(String(name || '')).replace(/&nbsp;|&#160;/g, ' ').replace(/[\s\u3000]/g, '');
  var m = s.match(/[（(]([^（()）]+)[)）]/);
  var cand = m ? m[1] : s;
  cand = cand.replace(/競馬場$/, '').replace(/^J-?PLACE/i, '').replace(/^ばんえい十勝/, '');
  if (!cand) return '';
  for (var i = 0; i < TK_TRACKS.length; i++){
    var n = TK_TRACKS[i].name;
    if (cand === n || cand.indexOf(n) === 0 || n.indexOf(cand) === 0) return n;
  }
  return cand;
}
/* 一覧ページから「施設名＋所在地（〒＋住所）」を取り出す */
function tkParseAddrList(html){
  var s = String(html || ''), out = [], seen = {};
  var parts = s.split(/<h2 class="fa_ttl">/i);
  for (var k = 1; k < parts.length; k++){
    var b = parts[k];
    var nm = (b.match(/<span class="fa_name">[\s\S]{0,400}?>([^<]+)<\/a>/i) || [])[1] ||
             (b.match(/<span class="fa_name">([\s\S]*?)<\/span>/i) || [])[1] || '';
    nm = tkClean(nm).replace(/<[^>]*>/g, '');
    var ad = (b.match(/<p class="fa_address">[\s\S]{0,300}?<span>\s*(〒[\s\S]*?)<\/span>/i) || [])[1] || '';
    ad = tkClean(ad).replace(/&#160;|&nbsp;/g, ' ');
    if (!nm || !ad) continue;
    var pcm = ad.match(/〒\s*([0-9]{3})[-－]\s*([0-9]{4})/);
    var pc = pcm ? (pcm[1] + '-' + pcm[2]) : '';
    var addr = ad.replace(/〒\s*[0-9]{3}[-－][0-9]{4}/, '').replace(/^[\s\u3000]+/, '');
    var key = tkNameKey(nm);
    if (!key || !pc || seen[key]) continue;
    seen[key] = 1;
    out.push({ key: key, name: nm, pc: pc, addr: addr });
  }
  return out;
}
function tkAddr(){ var ls = tkLs(); return (ls.addr && typeof ls.addr === 'object') ? ls.addr : null; }
function tkAddrCount(){ var a = tkAddr(); return a ? Object.keys(a).length : 0; }
/* 住所のコピー（force=false なら保存済みがあるときは取得しない＝初回の1回だけ） */
function tkImportAddr(force, msg){
  var ls = tkLs();
  if (!force && ls.addrAt && ls.addr && Object.keys(ls.addr).length){
    return Promise.resolve({ cached: true, n: Object.keys(ls.addr).length, at: ls.addrAt });
  }
  msg && msg('初回のみ: ホームメイト「全国の競馬場一覧」から各競馬場の住所（郵便番号）をコピーしています…');
  return tkGet(TK_ADDR_URL).then(function(html){
    var list = tkParseAddrList(html);
    if (!list.length) throw new Error('住所の一覧を読み取れませんでした（ページの形式が変わったかもしれません）');
    var at = new Date().toISOString().slice(0, 16).replace('T', ' ');
    var addr = {};
    list.forEach(function(x){ addr[x.key] = { name: x.name, pc: x.pc, addr: x.addr, at: at }; });
    ls.addr = addr; ls.addrAt = at; ls.addrN = list.length;
    tkSave(ls);
    return { cached: false, n: list.length, at: at, list: list };
  });
}
function tkAddrStatusText(){
  var ls = tkLs(), n = tkAddrCount();
  if (ls.addrAt && n){
    return '✅ 競馬場の住所（郵便番号）はコピー済み: <b>' + n + '場</b>／' + esc(ls.addrAt) +
      '　出典: ホームメイト「全国の競馬場一覧」（' + esc(TK_ADDR_URL) + '）の所在地。' +
      '　※ 取得は<b>初回の1回だけ</b>。2回目以降（再起動後も）は保存済みの住所を使い、競馬場名ボタンを押すだけで天気予報が出ます。';
  }
  return '⚠ まだ住所をコピーしていません。初回に自動でホームメイト「全国の競馬場一覧」から各競馬場の所在地（〒）をコピーします。' +
    '（取得できなかった場合は同梱の郵便番号一覧で動作します）';
}
/* 内蔵一覧（フォールバック用） */
function tkBuiltIn(name){
  var s = String(name || '');
  if (!s) return null;
  for (var i = 0; i < TK_TRACKS.length; i++){
    if (TK_TRACKS[i].name === s || s.indexOf(TK_TRACKS[i].name) >= 0) return TK_TRACKS[i];
  }
  return null;
}
/* 競馬場名 → { name,label,pc,pcAlt,addr,kind,copied }
   pc は「コピーした住所」を優先し、tenki.jp に地点が無ければ pcAlt（同梱の番号）で再検索する */
function tkTrackOf(name){
  var key = tkNameKey(name) || String(name || '');
  var b = tkBuiltIn(key);
  var a = tkAddr();
  var rec = (a && a[key]) ? a[key] : null;
  var pc = (rec && rec.pc) ? rec.pc : (b ? b.pc : '');
  if (!pc) return null;
  var alt = '';
  if (b && b.pc && b.pc !== pc) alt = b.pc;             // 例: 函館 〒042-8585(施設) → 042-0935(駒場町)
  if (!alt && b && b.pcAlt) alt = b.pcAlt;
  return { name: key, label: (rec && rec.name) || (b ? b.label : (key + '競馬場')), pc: pc, pcAlt: alt,
    addr: rec ? (rec.addr || '') : '', kind: b ? (b.kind || '') : '', copied: !!rec, note: b ? (b.note || '') : '' };
}
function tkGet(url){
  if (typeof kaiFetchAny === 'function') return kaiFetchAny(url);
  if (typeof drGet === 'function') return drGet(url);
  return Promise.reject(new Error('通信(中継)が未設定です'));
}
function tkLog(lines){
  var el = $('tkMsg'); if (!el) return;
  el.innerHTML = lines.map(function(l){ return esc(l); }).join('<br>');
}
function tkToday8(){
  if (typeof gcToday8 === 'function') return gcToday8();
  var d = new Date();
  return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
}
function tkDateInput8(){
  var el = $('tkDate');
  var v = el ? String(el.value || '').replace(/[^0-9]/g, '') : '';
  return /^\d{8}$/.test(v) ? v : tkToday8();
}
function tkDateLabel(d8){ return d8.slice(0, 4) + '/' + (+d8.slice(4, 6)) + '/' + (+d8.slice(6, 8)); }

/* ===== 1) 当日の開催場（netkeiba レース一覧） ===== */
function tkKaisai(d8){
  var ls = tkLs();
  if (ls.kai && ls.kai[d8] && ls.kai[d8].length) return Promise.resolve(ls.kai[d8]);
  var getP = (typeof kaiFetchListHtml === 'function')
    ? kaiFetchListHtml(d8).then(function(res){ return res.venues; })
    : tkGet('https://race.netkeiba.com/top/race_list_sub.html?kaisai_date=' + d8)
        .then(function(html){ return (typeof kaiParseAny === 'function') ? kaiParseAny(html, d8) : []; });
  return getP.then(function(venues){
    venues = venues || [];
    var out = venues.map(function(v){
      var tr = tkTrackOf(v.venue);
      return { venue:v.venue, kaisai:v.kaisai || '', baba:v.baba || '',
        pc: tr ? tr.pc : '', label: tr ? tr.label : (v.venue + '競馬場'), kind: tr ? tr.kind : '',
        races:(v.races || []).map(function(r){ return { r:r.r, time:r.time || '', name:r.name || '', raceId:r.raceId }; }) };
    }).filter(function(v){ return v.races.length; });
    if (out.length){ ls.kai = ls.kai || {}; ls.kai[d8] = out; tkSave(ls); }
    return out;
  });
}

/* ===== 2) 郵便番号 → tenki.jp の地点 ===== */
function tkSearchPoint(pc, msg){
  var ls = tkLs();
  var key = String(pc).replace(/[^0-9]/g, '');
  if (ls.pt && ls.pt[key]) return Promise.resolve(ls.pt[key]);
  if (ls.ptNo && ls.ptNo[key]) return Promise.resolve(null);   // 「地点なし」も覚える（毎回検索しない）
  msg && msg('tenki.jp で郵便番号 ' + pc + ' の地点を検索中…');
  return tkGet('https://tenki.jp/lite/search/?keyword=' + encodeURIComponent(key)).then(function(html){
    var m = String(html).match(/href="(\/lite\/forecast\/[^"]*?)"/);
    if (!m){ ls.ptNo = ls.ptNo || {}; ls.ptNo[key] = 1; tkSave(ls); return null; }
    var path = m[1];
    var nm = '';
    var nmM = String(html).match(new RegExp('href="' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>([\\s\\S]{0,160}?)</a>'));
    if (nmM) nm = nmM[1].replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    var out = { pc: pc, path: path, title: nm, at: new Date().toISOString() };
    ls.pt = ls.pt || {}; ls.pt[key] = out; tkSave(ls);
    return out;
  });
}

/* 郵便番号 → 地点（コピーした番号に地点が無ければ予備の番号で再検索） */
function tkPointForTrack(track, msg){
  var pcs = [];
  if (track && track.pc) pcs.push(track.pc);
  if (track && track.pcAlt && track.pcAlt !== track.pc) pcs.push(track.pcAlt);
  function go(i){
    if (i >= pcs.length) return Promise.resolve(null);
    return tkSearchPoint(pcs[i], msg).then(function(pt){ return pt || go(i + 1); });
  }
  return go(0);
}

/* ===== 3) 1時間ごとの天気ページを解析 ===== */
function tkWeatherEmoji(telop){
  var t = String(telop || '');
  if (/雪/.test(t)) return '❄️';
  if (/雷/.test(t)) return '⚡';
  if (/大雨|強い雨|雨/.test(t)){ return /時々|一時|のち/.test(t) ? '🌦️' : '☔'; }
  if (/晴れ/.test(t) && /時々|一時|のち/.test(t)) return '🌤️';
  if (/晴れ/.test(t)) return '☀️';
  if (/曇り/.test(t)) return '☁️';
  return '🌡️';
}
function tkClean(s){ return String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }
function tkParse1h(html){
  var days = [];
  var re = /<table[^>]*id="forecast-point-1h-(today|tomorrow|dayaftertomorrow)"[^>]*>([\s\S]*?)<\/table>/gi, m;
  while ((m = re.exec(String(html))) !== null){
    var which = m[1], block = m[2];
    var dm = block.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
    var d8 = dm ? (dm[1] + ('0' + dm[2]).slice(-2) + ('0' + dm[3]).slice(-2)) : '';
    var rows = block.match(/<tr class="(?:entry|past-entry)">[\s\S]*?<\/tr>/g) || [];
    var list = [];
    rows.forEach(function(r){
      var hour = (r.match(/class="hour">\s*(\d{1,2})/) || [])[1];
      if (hour == null) return;
      var telop = tkClean((r.match(/class="weather-telop">([\s\S]*?)<\/p>/) || [])[1] || '');
      var temp = (r.match(/class="temperature(?:-past)?">\s*(?:<span[^>]*>\s*)?(-?[\d.]+)/) || [])[1];
      var pop = (r.match(/class="prob-precip">\s*([\d\-]+)/) || [])[1];
      var precip = (r.match(/class="precip[^"]*">\s*([\d.\-]+)/) || [])[1];
      var hum = (r.match(/class="humidity">\s*([\d\-]+)/) || [])[1];
      // 風向はアイコンの alt（例: 北北東）。過去の時間は 1_01_past.gif のように _past が付く
      var wDir = (r.match(/forecast-point-wind\/[\dA-Za-z_]+\.gif"[^>]*?alt="([^"]*)"/) || [])[1] ||
                 (r.match(/alt="([^"]*)"[^>]*?src="[^"]*forecast-point-wind/) || [])[1] || '';
      if (wDir && /^\d+$/.test(wDir)) wDir = '';
      var wSpd = (r.match(/class="wind-box-speed">\s*(?:<span[^>]*>\s*)?([\d.\-]+)/) || [])[1];
      list.push({ hour: parseInt(hour, 10), telop: telop, temp: (temp == null ? null : parseFloat(temp)),
        pop: (pop == null ? null : parseInt(pop, 10)), precip: (precip == null ? null : parseFloat(precip)),
        hum: (hum == null ? null : parseInt(hum, 10)), wind: wDir, wspd: (wSpd == null ? null : parseFloat(wSpd)),
        past: /past-entry/.test(r.slice(0, 40)) });
    });
    if (list.length) days.push({ which: which, d8: d8, rows: list });
  }
  return days;
}
/* 日付ぶんを取得（キャッシュ: 同じ地点×日付は再取得しない） */
function tkHourly(track, d8, force, msg){
  var ls = tkLs();
  var key = track.pc + '|' + d8;
  if (!force && ls.h && ls.h[key] && ls.h[key].at && ls.h[key].days) return Promise.resolve(ls.h[key]);
  return tkPointForTrack(track, msg).then(function(pt){
    if (!pt) return null;
    msg && msg(track.name + '（' + pt.title + '）の1時間ごと天気を取得中…');
    var url = 'https://tenki.jp' + pt.path + '1hour.html';
    return tkGet(url).then(function(html){
      var days = tkParse1h(html);
      var rec = { pc: pt.pc || track.pc, point: pt, url: url, days: days, at: new Date().toISOString() };
      ls.h = ls.h || {}; ls.h[key] = rec; tkSave(ls);
      return rec;
    });
  });
}

/* ===== 4) 表示 ===== */
function tkDayFor(rec, d8){
  if (!rec || !rec.days || !rec.days.length) return null;
  for (var i = 0; i < rec.days.length; i++) if (rec.days[i].d8 === d8) return rec.days[i];
  return null;
}
function tkSummary(rows){
  var s = { tmax:null, tmin:null, popMax:null, rain:0, wmax:null, hum:null, telops:{} };
  rows.forEach(function(r){
    if (r.temp != null){ s.tmax = (s.tmax == null) ? r.temp : Math.max(s.tmax, r.temp); s.tmin = (s.tmin == null) ? r.temp : Math.min(s.tmin, r.temp); }
    if (r.pop != null) s.popMax = (s.popMax == null) ? r.pop : Math.max(s.popMax, r.pop);
    if (r.precip != null) s.rain += r.precip;
    if (r.wspd != null) s.wmax = (s.wmax == null) ? r.wspd : Math.max(s.wmax, r.wspd);
    if (r.hum != null) s.hum = (s.hum == null) ? r.hum : (s.hum + r.hum) / 2;
    if (r.telop) s.telops[r.telop] = (s.telops[r.telop] || 0) + 1;
  });
  return s;
}
/* 開催のコメント（馬場への影響の目安） */
function tkComment(s, raceTimes){
  var out = [];
  if (s.rain >= 5) out.push('⚠ 1時間降水量の合計が ' + s.rain.toFixed(1) + 'mm/h。<b>馬場が渋る（稍重〜重）可能性</b>が高い状況です。');
  else if (s.rain >= 1) out.push('☔ 降雨が予想されています（合計 ' + s.rain.toFixed(1) + 'mm/h）。馬場悪化に注意。');
  else out.push('☀ まとまった雨の予想はありません（降水確率の最大 ' + (s.popMax == null ? '−' : s.popMax + '%') + '）。良馬場の見込み。');
  if (s.wmax != null && s.wmax >= 8) out.push('🌪 最大風速 ' + s.wmax + 'm/s。<b>向正面・直線の向かい風で時計がかかる／先行有利</b>になりやすい強さです。');
  else if (s.wmax != null && s.wmax >= 5) out.push('💨 最大風速 ' + s.wmax + 'm/s。風の影響がやや出ます（当日の時計チェックと併用してください）。');
  if (s.hum != null && s.hum >= 85) out.push('💧 湿度が高め（平均 ' + s.hum.toFixed(0) + '%）。夏は暑熱対策・体力消耗に注意。');
  if (s.tmax != null && s.tmax >= 33) out.push('🥵 最高気温 ' + s.tmax + '℃。暑熱で時計・体力への影響が大きい一日です。');
  if (s.tmin != null && s.tmin <= 3) out.push('🥶 最低気温 ' + s.tmin + '℃。冬場は馬体調・時計に影響します。');
  if (raceTimes && raceTimes.length) out.push('🕐 発走時刻: ' + raceTimes.join(' / '));
  return out;
}
function tkTableHTML(day, races){
  var hours = day.rows.map(function(r){ return r.hour; });
  function hostOf(h){
    var hit = (races || []).filter(function(x){ return x.time && parseInt(String(x.time).split(':')[0], 10) === h; });
    return hit.length ? hit.map(function(x){ return x.r + 'R'; }).join(',') : '';
  }
  var head = '<tr><th style="text-align:left;position:sticky;left:0;background:var(--card2);z-index:1">時刻</th>' +
    hours.map(function(h){
      var hs = hostOf(h);
      return '<th' + (hs ? ' style="color:var(--ok-ink)"' : '') + '>' + (h < 10 ? '0' + h : h) + '時' +
        (hs ? '<br><span style="font-weight:400;font-size:.6rem">' + esc(hs) + '</span>' : '') + '</th>';
    }).join('') + '</tr>';
  function row(label, fn){
    return '<tr><th style="text-align:left;position:sticky;left:0;background:var(--card);z-index:1">' + label + '</th>' +
      day.rows.map(function(r){ return '<td>' + fn(r) + '</td>'; }).join('') + '</tr>';
  }
  var body = '';
  body += row('天気', function(r){ return r.telop ? (tkWeatherEmoji(r.telop) + '<br><span style="font-size:.62rem">' + esc(r.telop) + '</span>') : '−'; });
  body += row('気温(℃)', function(r){ return r.temp == null ? '−' : esc(r.temp); });
  body += row('降水確率(%)', function(r){ return r.pop == null ? '−' : esc(r.pop); });
  body += row('降水量(mm/h)', function(r){
    var v = (r.precip == null) ? 0 : r.precip;
    return '<span' + (v >= 1 ? ' style="color:var(--info-ink);font-weight:700"' : '') + '>' + esc(v) + '</span>';
  });
  body += row('湿度(%)', function(r){ return r.hum == null ? '−' : esc(r.hum); });
  body += row('風向', function(r){ return r.wind ? esc(r.wind) : '−'; });
  body += row('風速(m/s)', function(r){
    var v = r.wspd;
    return '<span' + (v != null && v >= 8 ? ' style="color:var(--err-ink);font-weight:700"' : (v != null && v >= 5 ? ' style="color:var(--warn-ink);font-weight:700"' : '')) + '>' + (v == null ? '−' : esc(v)) + '</span>';
  });
  return '<div class="tblwrap" style="overflow-x:auto"><table style="font-size:.72rem;white-space:nowrap;min-width:0">' +
    '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
}
function tkVenueCardHTML(v, rec, d8){
  var day = tkDayFor(rec, d8);
  var h = [];
  h.push('<details class="card fold" open style="border-color:var(--line2);background:linear-gradient(180deg,var(--card),var(--card))">');
  h.push('<summary class="foldhead">' +
    '<span class="fmark"></span>' +
    '<b>' + esc(v.venue) + '</b>' +
    '<span class="chip">' + esc(v.kind || '') + '</span>' +
    (v.kaisai ? '<span class="small" style="font-weight:400">' + esc(v.kaisai) + '</span>' : '') +
    (v.baba ? '<span class="small muted" style="font-weight:400">' + esc(v.baba) + '</span>' : '') +
    (rec && rec.point ? '<span class="small" style="font-weight:400">📍 ' + esc(rec.point.title || '') + '（〒' + esc(rec.point.pc) + '）' + (v.addr ? '／' + esc(v.addr) : '') + '</span>' : '') +
    '<span class="sp"></span><span class="foldhint"></span></summary>');
  h.push('<div class="foldbody">');
  if (!rec){
    h.push('<div class="small muted">地点を取得できませんでした（郵便番号 ' + esc(v.pc || '未設定') + '）。下の「その他の競馬場」から手動で選ぶか、tenki.jp の地点検索で見つからない郵便番号かもしれません。</div>');
  } else if (!day){
    h.push('<div class="small muted">この日（' + esc(tkDateLabel(d8)) + '）の1時間ごとデータが tenki.jp にありません。tenki.jp の1時間ごと予報は<b>今日〜明後日</b>の3日分だけです。日付を今日／明日／明後日に変えてください。</div>');
    if (rec.days && rec.days.length){
      h.push('<div class="small">取得できた日: ' + rec.days.map(function(d){ return esc(d.d8 ? tkDateLabel(d.d8) : d.which); }).join(' / ') + '</div>');
      var alt = rec.days[0];
      h.push('<div class="small" style="margin-top:4px;font-weight:700">参考: ' + esc(alt.d8 ? tkDateLabel(alt.d8) : '') + ' の1時間ごと</div>');
      h.push(tkTableHTML(alt, null));   // 別の日の表なので発走Rの印は付けない
    }
  } else {
    var s = tkSummary(day.rows.filter(function(r){ return !r.past; }).length ? day.rows.filter(function(r){ return !r.past; }) : day.rows);
    var telops = Object.keys(s.telops).sort(function(a, b){ return s.telops[b] - s.telops[a]; });
    h.push('<div class="small" style="margin:2px 0 6px">' +
      '当日の天気: <b>' + (telops.length ? esc(telops[0]) : '−') + '</b>' +
      (telops.length > 1 ? '（他 ' + telops.slice(1, 3).map(esc).join('・') + '）' : '') +
      ' ／ 気温 <b>' + (s.tmin == null ? '−' : s.tmin) + '〜' + (s.tmax == null ? '−' : s.tmax) + '℃</b>' +
      ' ／ 降水確率 最大 <b>' + (s.popMax == null ? '−' : s.popMax + '%') + '</b>' +
      ' ／ 降水量 ' + s.rain.toFixed(1) + 'mm/h' +
      ' ／ 最大風速 <b>' + (s.wmax == null ? '−' : s.wmax + 'm/s') + '</b>' +
      ' ／ 湿度 ' + (s.hum == null ? '−' : s.hum.toFixed(0) + '%') + '</div>');
    var notes = tkComment(s, (v.races || []).map(function(x){ return x.r + 'R ' + x.time; }).slice(0, 14));
    h.push('<div class="small" style="border:1px solid var(--line2);background:var(--card);border-radius:10px;padding:7px 10px;margin-bottom:6px;line-height:1.7">' +
      notes.map(function(n){ return '・' + n; }).join('<br>') + '</div>');
    h.push(tkTableHTML(day, v.races));
    h.push('<div class="small muted" style="margin-top:4px">出典: tenki.jp（1時間ごとの天気）／地点: ' + esc(rec.point.title || '') +
      '（郵便番号 ' + esc(rec.point.pc) + '）／取得: ' + esc(String(rec.at || '').replace('T', ' ').slice(0, 16)) +
      '　※ ' + ((rec.point.pc && v.pc && String(rec.point.pc).replace(/[^0-9]/g,'') !== String(v.pc).replace(/[^0-9]/g,''))
        ? ('郵便番号 ' + esc(v.pc) + ' の地点が tenki.jp に無いため、' + esc(rec.point.pc) + ' を使用。')
        : '郵便番号はホームメイト「全国の競馬場一覧」の所在地（初回の1回だけコピーして保存）。') + '</div>');
  }
  h.push('</div></details>');
  return h.join('');
}

/* ===== 5) 表示（当日開催の競馬場名ボタン → 押すと天気予報が出る） ===== */
/* 表示状態は JS 側(tkUI)を正とする（描画のたびに DOM から読み直さない＝挙動が安定） */
var tkUI = { d8:'', venues:[], cards:{}, order:[], autoKai:'' };

/* 競馬場名 → 表示用の情報（当日開催のレース時刻・馬場があれば載せる） */
function tkVenueInfo(name){
  var tr = tkTrackOf(name) || { name: tkNameKey(name), label: String(name || '') + '競馬場', pc:'', kind:'' };
  var v = { venue: tr.name, label: tr.label || (tr.name + '競馬場'), pc: tr.pc || '', pcAlt: tr.pcAlt || '',
    addr: tr.addr || '', kind: tr.kind || '', copied: !!tr.copied, races: [], kaisai:'', baba:'' };
  var hit = (tkUI.venues || []).filter(function(x){
    return String(x.venue || '') === v.venue || String(x.venue || '').indexOf(v.venue) === 0;
  })[0];
  if (hit){
    v.races = hit.races || []; v.kaisai = hit.kaisai || ''; v.baba = hit.baba || '';
    if (hit.pc && !v.pc) v.pc = hit.pc;
    if (hit.label) v.label = hit.label;
    if (hit.kind) v.kind = hit.kind;
  }
  return v;
}
/* ボタンに並べる競馬場（当日開催 → 内蔵一覧 → コピーした住所の一覧） */
function tkAllVenueKeys(){
  var keys = [], seen = {};
  (tkUI.venues || []).forEach(function(x){
    var t = tkTrackOf(x.venue); var k = t ? t.name : String(x.venue || '');
    if (k && !seen[k]){ seen[k] = 1; keys.push(k); }
  });
  TK_TRACKS.forEach(function(t){ if (!seen[t.name]){ seen[t.name] = 1; keys.push(t.name); } });
  var a = tkAddr() || {};
  Object.keys(a).forEach(function(k){ if (!seen[k]){ seen[k] = 1; keys.push(k); } });
  return keys;
}
function tkBtn(nm, txt, sub, primary){
  return '<button type="button" class="btn' + (primary ? ' primary' : '') + '" data-tkv="' + esc(nm) + '" ' +
    'style="font-size:.8rem;padding:4px 10px" title="' + esc(sub || '') + '">' + esc(txt) +
    (sub ? ' <span class="small muted" style="font-weight:400">' + esc(sub) + '</span>' : '') + '</button>';
}
function tkRenderVenueBar(){
  var bar = $('tkVenueBar'); if (!bar) return;
  var h = [];
  h.push('<div style="font-weight:700;margin-bottom:4px">当日の開催場（<b>競馬場名のボタンを押すと天気予報が出ます</b>）</div>');
  if ((tkUI.venues || []).length){
    h.push('<div class="simrow" style="gap:6px">');
    (tkUI.venues || []).forEach(function(v){
      var t = tkTrackOf(v.venue); var nm = t ? t.name : String(v.venue || '');
      var sub = (v.kaisai ? v.kaisai + '・' : '') + (v.races || []).length + 'R' + (t && t.pc ? '' : ' ※郵便番号なし');
      h.push(tkBtn(nm, '🏇 ' + nm, sub, false));
    });
    h.push('<button type="button" class="btn primary" data-tkact="today" style="font-size:.8rem;padding:4px 10px">☀️ 当日開催を全部表示</button>');
    h.push('</div>');
  } else {
    h.push('<div class="small muted">当日の開催情報がまだありません。「🔍 当日の開催場を取得」を押すと、開催場のボタンがここに並びます（下の「その他の競馬場」のボタンはすぐ使えます）。</div>');
  }
  h.push('<details style="margin-top:8px"><summary class="small" style="cursor:pointer;font-weight:700">その他の競馬場（開催がない日でも天気だけ見られます）</summary>' +
    '<div class="simrow" style="gap:6px;margin-top:6px">');
  var known = {};
  (tkUI.venues || []).forEach(function(v){ var t = tkTrackOf(v.venue); known[t ? t.name : v.venue] = 1; });
  tkAllVenueKeys().forEach(function(k){
    if (known[k]) return;
    var t = tkTrackOf(k);
    h.push(tkBtn(k, k, t && t.pc ? ('〒' + t.pc) : '※郵便番号なし', false));
  });
  h.push('</div></details>');
  h.push('<div class="small muted" style="margin-top:8px;border-top:1px dashed var(--line2);padding-top:6px;line-height:1.7">' + tkAddrStatusText() + '</div>');
  h.push('<div class="simrow" style="margin-top:4px;gap:6px">' +
    '<button type="button" class="btn ghost" data-tkact="addr" style="font-size:.76rem;padding:3px 10px">📋 住所をコピーし直す</button>' +
    '<button type="button" class="btn ghost" data-tkact="clear" style="font-size:.76rem;padding:3px 10px">表示をクリア</button></div>');
  bar.innerHTML = h.join('');
}
function tkRenderOut(){
  var out = $('tkOut'); if (!out) return;
  var h = (tkUI.order || []).map(function(k){ return tkUI.cards[k] || ''; }).join('');
  out.innerHTML = h || '<div class="card"><div class="small muted">上の<b>競馬場名のボタン</b>を押すと、その場の天気（1時間ごと）がここに表示されます。</div></div>';
}
function tkUpsertCard(venue, html){
  if (tkUI.cards[venue] == null) tkUI.order.push(venue);
  tkUI.cards[venue] = html + '<div style="text-align:right;margin:-4px 0 12px">' +
    '<button type="button" class="btn ghost" data-tkclose="' + esc(venue) + '" style="font-size:.72rem;padding:2px 8px">' + esc(venue) + 'の表示を閉じる</button></div>';
  tkRenderOut();
}
function tkCloseCard(venue){
  delete tkUI.cards[venue];
  tkUI.order = (tkUI.order || []).filter(function(k){ return k !== venue; });
  tkRenderOut();
}
/* 競馬場1つの天気を表示（地点・1時間ごとデータはキャッシュ済みなら再取得しない） */
function tkShowVenue(name, force){
  var d8 = tkDateInput8();
  tkUI.d8 = d8;
  var v = tkVenueInfo(name);
  if (!v.pc){
    tkLog(['⚠ ' + v.venue + ' の郵便番号がありません。「📋 住所をコピーし直す」でホームメイトの一覧から住所を取り直してください。']);
    return Promise.resolve(null);
  }
  tkLog([v.venue + '（' + (v.addr || ('〒' + v.pc)) + '）の天気を取得しています…（' + tkDateLabel(d8) + '）']);
  return tkHourly(v, d8, !!force, function(m){ tkLog([m]); }).then(function(rec){
    tkUpsertCard(v.venue, tkVenueCardHTML(v, rec, d8));
    var pt = rec && rec.point ? rec.point : null;
    tkLog(['✅ ' + v.venue + ' の天気予報を表示しました。' +
      (pt ? ('地点: ' + (pt.title || '') + '（〒' + pt.pc + '）') : '') +
      '　※ tenki.jp の1時間ごと予報は今日〜明後日の3日分です。']);
    return rec;
  }).catch(function(e){
    tkLog(['⚠ ' + v.venue + ' の天気を取得できませんでした: ' + ((e && e.message) || e),
      '（「① データ入力」→「URL取込の通信設定」→「🔧 中継を診断」で通信をご確認ください）']);
    return null;
  });
}
/* 当日開催の場をまとめて表示 */
function tkShowToday(force){
  var d8 = tkDateInput8();
  tkUI.d8 = d8;
  var list = (tkUI.venues || []).map(function(v){ return tkVenueInfo(v.venue); });
  if (!list.length){
    tkLog(['当日の開催場が未取得です。「🔍 当日の開催場を取得」を押すか、下の競馬場名ボタンを individually 押してください。']);
    return Promise.resolve(0);
  }
  var seq = Promise.resolve(), n = 0;
  list.forEach(function(v, i){
    seq = seq.then(function(){
      return tkHourly(v, d8, !!force, function(m){ tkLog([m + '（' + (i + 1) + ' / ' + list.length + '場）']); }).then(function(rec){
        tkUpsertCard(v.venue, tkVenueCardHTML(v, rec, d8)); n++;
      }).catch(function(e){
        tkUpsertCard(v.venue, '<div class="card"><div class="small" style="color:var(--err-ink)">⚠ ' + esc(v.venue) + ' の天気を取得できませんでした: ' + esc((e && e.message) || e) + '</div></div>');
      });
    });
  });
  return seq.then(function(){
    tkLog(['✅ ' + tkDateLabel(d8) + ' の開催 ' + list.length + '場の天気を表示しました（' + n + '場取得成功）。']);
    return n;
  });
}
/* 互換: 旧「天気を表示」ボタン */
function tkShowAll(force){ return tkShowToday(force); }
/* 当日の開催場を netkeiba から取得（取得済みなら保存分からすぐボタンを出す） */
function tkLoadCachedKaisai(d8){
  var dd = d8 || tkDateInput8();
  var ls = tkLs();
  if (ls.kai && ls.kai[dd] && ls.kai[dd].length){
    tkUI.d8 = dd; tkUI.venues = ls.kai[dd];
    return true;
  }
  return false;
}
function tkFetchKaisai(){
  var d8 = tkDateInput8();
  tkLog(['当日の開催場を取得しています…（' + tkDateLabel(d8) + '）']);
  return tkKaisai(d8).then(function(venues){
    tkUI.d8 = d8; tkUI.venues = venues || [];
    if (!tkUI.venues.length){
      tkLog(['この日は（中央の）開催情報が見つかりませんでした。「その他の競馬場」のボタンから場を選んでください。']);
    } else {
      tkLog(['✅ ' + tkDateLabel(d8) + ' の開催 ' + tkUI.venues.length + '場を検出: ' +
        tkUI.venues.map(function(v){ return v.venue + '(' + v.races.length + 'R)'; }).join('・') +
        '　→ 競馬場名のボタンを押すと天気予報が出ます。']);
    }
    tkRenderVenueBar();
    return tkUI.venues;
  }).catch(function(e){
    tkLog(['⚠ 開催情報を取得できませんでした: ' + ((e && e.message) || e),
      '（「① データ入力」→「URL取込の通信設定」→「🔧 中継を診断」で通信をご確認ください。天気だけを見る場合は「その他の競馬場」のボタンが使えます。）']);
    tkRenderVenueBar();
    return [];
  });
}

/* ===== 6) 初期化 ===== */
function tkSetDate(d8){
  var el = $('tkDate');
  if (!el) return;
  el.value = d8.slice(0, 4) + '-' + d8.slice(4, 6) + '-' + d8.slice(6, 8);
}
function tkRenderPcList(){
  var el = $('tkPcList'); if (!el) return;
  var a = tkAddr() || {};
  var keys = tkAllVenueKeys();
  el.innerHTML = keys.map(function(k){
    var t = tkTrackOf(k);
    if (!t || !t.pc) return esc(k) + ' 〒−';
    var extra = t.copied && t.addr ? ('（' + t.addr + '）') : (t.pcAlt ? ('（予備 ' + t.pcAlt + '）') : '');
    return esc(k) + ' 〒' + esc(t.pc) + esc(extra);
  }).join(' ／ ') + (Object.keys(a).length ? '' : '　※ まだ住所をコピーしていないため、同梱の一覧を使用しています。');
}
function tkAddrCopy(){
  return tkImportAddr(true, function(m){ tkLog([m]); }).then(function(r){
    tkLog(['✅ 住所をコピーしました: ' + r.n + '場（' + r.at + '）　出典: ホームメイト「全国の競馬場一覧」の所在地。次回以降はこの保存済みを使います。']);
    tkRenderPcList(); tkRenderVenueBar();
    return r;
  }).catch(function(e){
    tkLog(['⚠ 住所をコピーできませんでした: ' + ((e && e.message) || e), '→ 同梱の郵便番号一覧で動作します。']);
    return null;
  });
}
/* ボタンクリックの委譲（data-tkv＝天気表示 / data-tkclose＝閉じる / data-tkact＝操作） */
function tkAttrUp(tg, bar, attr){
  var n = 0;
  while (tg && tg !== bar && n < 8){
    if (tg.getAttribute){ var v = tg.getAttribute(attr); if (v) return v; }
    tg = tg.parentNode; n++;
  }
  return '';
}
/* 競馬場名ボタン／閉じる／操作ボタンのクリック処理（#tkVenueBar 内の委譲） */
function tkBarClick(tg){
  if (!tg) return false;
  var bar = $('tkVenueBar');
  var cl = tkAttrUp(tg, bar, 'data-tkclose');
  if (cl){ tkCloseCard(cl); return true; }
  var nm = tkAttrUp(tg, bar, 'data-tkv');
  if (nm){ tkShowVenue(nm, false); return true; }
  var act = tkAttrUp(tg, bar, 'data-tkact');
  if (act === 'today'){ tkShowToday(false); return true; }
  if (act === 'addr'){ tkAddrCopy(); return true; }
  if (act === 'clear'){ tkUI.cards = {}; tkUI.order = []; tkRenderOut(); return true; }
  return false;
}
/* 天気タブを開いた時に呼ぶ（保存済みなら通信せず、当日開催の場名ボタンをすぐ出す） */
function tkOnTabOpen(){
  var d8 = tkDateInput8();
  tkRenderPcList();
  if (tkLoadCachedKaisai(d8)){ tkRenderVenueBar(); tkRenderOut(); return; }
  if ((tkUI.venues || []).length){ tkRenderVenueBar(); tkRenderOut(); return; }
  if (tkUI.autoKai === d8){ tkRenderVenueBar(); tkRenderOut(); return; }   // 同じ日は自動取得を繰り返さない
  tkUI.autoKai = d8;
  if (!tkAddrCount()){
    // 初回は「住所のコピー → 当日開催の取得」の順で1回だけ自動実行
    tkImportAddr(false, function(m){ tkLog([m]); }).then(function(r){
      tkLog(['✅ 初回コピー完了: ' + r.n + '場の住所（郵便番号）を保存しました（' + r.at + '）。次回以降（再起動後も）はこの保存済みを使い、取得しません。']);
      tkRenderPcList(); tkRenderVenueBar();
      return tkFetchKaisai();
    }).catch(function(e){
      tkLog(['⚠ 住所のコピーに失敗: ' + ((e && e.message) || e) + '　→ 同梱の郵便番号一覧で動作します。']);
      tkRenderVenueBar();
      return tkFetchKaisai();
    });
    return;
  }
  tkFetchKaisai();
}
function initTenki(){
  tkSetDate(tkToday8());
  // ① 初回の1回だけ: ホームメイトの一覧から各競馬場の住所（郵便番号）をコピーして保存
  tkImportAddr(false, function(m){ tkLog([m]); }).then(function(r){
    if (r && !r.cached){
      tkLog(['✅ 初回コピー完了: ' + r.n + '場の住所（郵便番号）を保存しました（' + r.at + '）。',
        '次回以降（再起動後も）は保存済みの住所を使うので、この取得は行いません。当日開催の競馬場名ボタンを押すだけで天気予報が出ます。']);
    }
    tkRenderPcList(); tkRenderVenueBar(); tkRenderOut();
    if (tkLoadCachedKaisai()) tkRenderVenueBar();
  }).catch(function(e){
    tkLog(['⚠ 住所のコピーに失敗しました: ' + ((e && e.message) || e),
      '→ 同梱の郵便番号一覧で動作します（「📋 住所をコピーし直す」で再実行できます）。']);
    tkRenderPcList(); tkRenderVenueBar(); tkRenderOut();
    if (tkLoadCachedKaisai()) tkRenderVenueBar();
  });
  // ①でレースを取り込んでいれば、その日付を既定にする（当日開催の判定に使う）
  try {
    var dt = (typeof state !== 'undefined' && state && state.race && state.race.date) || '';
    var mm = String(dt).match(/(\d{4})[\/年-](\d{1,2})[\/月-](\d{1,2})/);
    if (mm) tkSetDate(mm[1] + ('0' + mm[2]).slice(-2) + ('0' + mm[3]).slice(-2));
  } catch(e){}
  on('tkFetch', 'click', function(){ tkFetchKaisai(); });
  on('tkShow', 'click', function(){ tkShowToday(false); });
  on('tkReload', 'click', function(){ tkShowToday(true); });
  on('tkClr', 'click', function(){
    var ls = tkLs();
    ls.h = {}; ls.kai = {};
    tkSave(ls);
    tkUI.venues = [];
    tkLog(['取得済みの天気・開催キャッシュを消しました（住所と地点のキャッシュは残しています）。']);
    tkRenderVenueBar();
  });
  on('tkClrAll', 'click', function(){
    tkSave({});
    tkUI.venues = []; tkUI.cards = {}; tkUI.order = [];
    tkLog(['tenki.jp の地点・天気キャッシュと、コピーした住所をすべて消しました。次回この画面を開いた時に住所を再コピーします。']);
    tkRenderPcList(); tkRenderVenueBar(); tkRenderOut();
    tkImportAddr(false, function(m){ tkLog([m]); }).then(function(r){
      tkLog(['✅ 住所を再コピーしました: ' + r.n + '場（' + r.at + '）']);
      tkRenderPcList(); tkRenderVenueBar();
    }).catch(function(){});
  });
  // 競馬場名ボタン（当日開催＋その他）／閉じるボタン
  var bar = $('tkVenueBar');
  if (bar && bar.addEventListener) bar.addEventListener('click', function(e){ tkBarClick(e && e.target); });
  var dt = $('tkDate');
  if (dt && dt.addEventListener) dt.addEventListener('change', function(){
    tkUI.venues = [];
    if (!tkLoadCachedKaisai()) tkUI.venues = [];
    tkRenderVenueBar();
    tkLog(['日付を ' + tkDateLabel(tkDateInput8()) + ' に変えました。「🔍 当日の開催場を取得」でこの日の開催場ボタンを出せます。']);
  });
}
