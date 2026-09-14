/* =========================================================
   39 年度の重賞カレンダー（⑥タブ内: 月別グリッド）
   ---------------------------------------------------------
   - 対象: 中央G1〜G3(芝・ダ・障害) + 代表的な地方交流Jpn1〜3
   - データ源:
     ・中央: race.netkeiba.com の「重賞日程」(calendar.html?year=Y) を年1回取得し、
        日程テーブル（日付・レース名・格・場・距離）から月別に組み立てる
        ※旧実装は同ページの race_list.html?kaisai_date= リンクを拾っていたが、
          現在のページはテーブル形式でリンクが無く常に0件になっていた（不具合修正）
        クリック時に race_id を「日別レース一覧」から名前一致で解決して分析する
     ・地方交流(Jpn): db.netkeiba.com のレース名検索を年度ぶん実行
   - 日付セル内のレース名クリック → drAnalyzeRid() で⑥分析を実行し、
     drRenderAll() でこのタブ内に表示（既存⑥と同じ表）
   ========================================================= */

var GCL_LS = 'keiba_gcl_v1';
function gcLs(){ try { return JSON.parse(cmpUnpack(localStorage.getItem(GCL_LS)) || '{}'); } catch(e){ return {}; } }
function gcSave(ls){ try { localStorage.setItem(GCL_LS, cmpPack(JSON.stringify(ls))); } catch(e){} }
function gcGet(u){
  if (typeof drGet === 'function') return drGet(u);
  return Promise.reject(new Error('netkeibaへの取得手段(中継設定等)がありません'));
}
/* 会場コード(ridの4-5桁目相当) → 競馬場名 */
function gcVenue(code){
  if (typeof bfVenueByCode === 'function'){ var v = bfVenueByCode(code); if (v) return v; }
  return ({ '01':'札幌','02':'函館','03':'福島','04':'新潟','05':'東京','06':'中山','07':'中京','08':'京都','09':'阪神','10':'小倉' }[code] || '');
}
/* ================= 中央: 年間の重賞日程テーブル ================= */
function gcParseSchedule(html, year){
  var rows = [];
  var re = /<tr[^>]*class="schedule_list[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi, m;
  while ((m = re.exec(String(html))) !== null){
    var b = m[1];
    var tds = b.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    if (tds.length < 5) continue;
    var pick = function(i){
      return String(tds[i] || '').replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    };
    var dm = pick(0).match(/(\d{1,2})\/(\d{1,2})/);
    if (!dm) continue;
    var nm = pick(1);
    if (!nm) continue;
    var grRaw = pick(2).toUpperCase();
    var g = grRaw.indexOf('G1') >= 0 ? 'G1' : (grRaw.indexOf('G2') >= 0 ? 'G2' : (grRaw.indexOf('G3') >= 0 ? 'G3' : ''));
    if (!g) continue;
    rows.push({
      date: year + ('0' + dm[1]).slice(-2) + ('0' + dm[2]).slice(-2),
      name: nm, grade: g, venue: pick(3), dist: pick(4), cond: pick(5), no: ''
    });
  }
  return rows;
}
/* 年度ぶんの日程（年1リクエスト）。空だった場合はキャッシュしない */
function gcYearSchedule(y, progress){
  var ls = gcLs();
  if (ls.sched && ls.sched[y] && ls.sched[y].length) return Promise.resolve(ls.sched[y]);
  progress = progress || function(){};
  progress(y + '年の重賞日程を取得中…（1回の通信で年間分まとめて）');
  // ※ /top/calendar.html は閲覧環境（UA）によって重賞テーブルが描画されない場合があるため、
  //   「重賞日程」(/top/schedule.html?year=Y, 2002〜今年) を使う。こちらは常にテーブルが返る。
  var urls = [
    'https://race.netkeiba.com/top/schedule.html?year=' + y,
    'https://race.netkeiba.com/top/calendar.html?year=' + y + '&month=1'
  ];
  var tryNext = function(i, lastHtml, lastErr){
    if (i >= urls.length){
      // 1つもHTMLが取れなかった = 通信/中継の問題（原因をそのまま返す）
      if (lastHtml == null && lastErr) return Promise.reject(lastErr);
      if (lastHtml && !/schedule_list|重賞|Race_Calendar/.test(String(lastHtml))){
        throw new Error('重賞日程ページの応答が不正です（中継(リレー)の設定をご確認ください）');
      }
      return [];                         // 掲載前の年度など（空はキャッシュしない）
    }
    return gcGet(urls[i]).then(function(html){
      var rows = gcParseSchedule(html, y);
      if (!rows.length) return tryNext(i + 1, html, lastErr);
      ls.sched = ls.sched || {}; ls.sched[y] = rows;
      gcSave(ls);
      return rows;
    }, function(e){ return tryNext(i + 1, lastHtml, e); });
  };
  return tryNext(0, null, null);
}
/* 日別一覧から「重賞(G1〜G3)のレース」を取り出す */
function gcParseDay(html, all){
  var out = [];
  var seen = {};
  var items = String(html).match(/<li[^>]*class="[^"]*RaceList_DataItem[^"]*"[^>]*>([\s\S]*?)<\/li>/g) || [];
  for (var i = 0; i < items.length; i++){
    var b = items[i];
    var ridM = b.match(/race_id=(\d{12})/);
    if (!ridM) continue;
    var rid = ridM[1];
    if (seen[rid]) continue; seen[rid] = 1;
    var grade = '';
    var ic = b.match(/Icon_GradeType(\d+)/g) || [];
    for (var q = 0; q < ic.length; q++){
      var n = ic[q].replace(/[^0-9]/g, '');
      if (n === '1'){ grade = 'G1'; break; }
      if (n === '2'){ grade = 'G2'; break; }
      if (n === '3'){ grade = 'G3'; break; }
    }
    if (!grade && !all) continue;
    var name = '';
    var nmM = b.match(/class="ItemTitle">([\s\S]*?)<\/span>/);
    if (nmM) name = String(nmM[1]).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    var no = '';
    var nM = b.match(/(\d{1,2})R\s*<\/span>\s*<\/div>/) || b.match(/Race_Num[^>]*>[\s\S]{0,40}?(\d{1,2})R/) || b.match(/(\d{1,2})R\s*</);
    if (nM) no = nM[1];
    out.push({ rid: rid, no: no, name: name || ('R' + no), grade: grade, venue: gcVenue(rid.substring(4, 6)) });
  }
  return out;
}
function gcDay(d8, strict){
  var ls = gcLs();
  if (ls.day && ls.day[d8] && ls.day[d8].length) return Promise.resolve(ls.day[d8]);
  return gcGet('https://race.netkeiba.com/top/race_list_sub.html?kaisai_date=' + d8).then(function(html){
    if (strict && !/RaceList_Body|RaceList_Box|RaceList_DataList/i.test(String(html || ''))){
      throw new Error('レース一覧を取得できませんでした（中継(リレー)の応答が空・不正の可能性）。「① データ入力」→「URL取込の通信設定」→「🔧 中継を診断」でご確認ください。');
    }
    var rows = gcParseDay(html, true);      // 名前解決用に重賞以外も含めて取る
    rows.forEach(function(r){ r.date = d8; });
    if (rows.length){ ls.day = ls.day || {}; ls.day[d8] = rows; gcSave(ls); }
    return rows;
  }).catch(function(e){ if (strict) throw e; return []; });
}
/* 月の中央重賞（日程テーブルから絞り込むだけ。通信は年1回） */
function gcMonth(y, m, progress){
  progress = progress || function(){};
  return gcYearSchedule(y, progress).then(function(rows){
    return (rows || []).filter(function(r){ return parseInt(String(r.date).slice(4, 6), 10) === m; });
  });
}
/* レース名の照合キー（「第◯回」「(G2)」などを落として比較） */
function gcNameCore(s){
  var t = String(s == null ? '' : s)
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/^第\s*\d+\s*回/, '')
    .replace(/[\s\u3000・･。、,]/g, '');
  // 略称の統一は drAbbrNorm に任せる（AH＝オータムハンデ などの2文字略号にも対応）。
  // 例) カレンダー「京成杯オータムハンデ」 / レース一覧「京成杯AH」 / DB「京成杯オータムH」 → すべて「京成杯オータムH」
  if (typeof drAbbrNorm === 'function'){
    try { t = drAbbrNorm(t); } catch(e){}
  } else {
    t = t.replace(/競走$/, '').replace(/ステークス/g, 'S').replace(/カップ/g, 'C');
  }
  return t.toUpperCase();
}
/* DB検索の行テキストから競馬場名を拾う（'2026-09-05 4中山1 …' → 中山） */
var GC_VEN_RE = /\d{1,2}(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉|大井|川崎|船橋|浦和|門別|盛岡|水沢|金沢|笠松|名古屋|園田|姫路|高知|佐賀|帯広)\d/;
function gcVenueOfTxt(txt){
  var m = String(txt || '').match(GC_VEN_RE);
  if (m) return m[1];
  if (typeof gcVenueInTxt === 'function'){ try { return gcVenueInTxt(txt) || ''; } catch(e){} }
  return '';
}
/* netkeiba DB をレース名で検索し、指定日(date8)のレースIDを引く（日別一覧で見つからなかったときの保険）。
   略号形(京成杯AH)・正式名(京成杯オータムハンデ)の両方で試し、開催場が分かれば一致する行を優先する。 */
function gcResolveRidDb(date8, name, venue, progress){
  if (typeof gcDbSearch !== 'function') return Promise.resolve('');
  progress = progress || function(){};
  var d8 = String(date8 || '');
  var words = [];
  var pushW = function(w){
    w = String(w == null ? '' : w).replace(/[（(][^）)]*[）)]/g, '').replace(/[\s\u3000]/g, '');
    if (w.length >= 2 && words.indexOf(w) < 0) words.push(w);
  };
  // 略号(京成杯AH 等)はDB検索で0件になりやすいので、日本語に展開した正式名を「最初に」試す
  try { if (typeof drExpandAbbr === 'function') pushW(drExpandAbbr(name)); } catch(e){}
  pushW(name);
  try { if (typeof drRaceCore === 'function') pushW(drRaceCore(name)); } catch(e){}
  try { if (typeof drAbbrNorm === 'function') pushW(drAbbrNorm(name)); } catch(e){}
  progress('レース一覧に同名が見つからないため、netkeiba DB を「' + name + '」で検索しています…');
  var seq = Promise.resolve('');
  words.forEach(function(w){
    seq = seq.then(function(found){
      if (found) return found;
      return gcDbSearch(w).then(function(list){
        var cands = (list || []).filter(function(r){ return String(r.date8) === d8; });
        if (!cands.length) return '';
        var pick = null;
        cands.forEach(function(r){
          if (pick) return;
          var v = gcVenueOfTxt(r.txt || '');
          if (!venue || !v || v === venue) pick = r;
        });
        if (!pick) pick = cands[0];
        return (pick && pick.rid) || '';
      }).catch(function(){ return ''; });
    });
  });
  return seq;
}
/* 日程テーブルには race_id が無いので、日別一覧のレース名から解決する。
   日別一覧に無い（表記違い・一覧未取得）ときは netkeiba DB のレース名検索にフォールバックする。 */
function gcResolveRid(date8, name, progress, venue){
  progress = progress || function(){};
  var d8 = String(date8 || '');
  var key = d8 + '|' + gcNameCore(name) + (venue ? '|' + venue : '');
  var ls = gcLs();
  if (ls.ridmap && ls.ridmap[key]) return Promise.resolve(ls.ridmap[key]);
  var saveRid = function(rid){
    if (!rid) return '';
    var l2 = gcLs(); l2.ridmap = l2.ridmap || {}; l2.ridmap[key] = rid; gcSave(l2);
    return rid;
  };
  progress('レースIDを照合中…（' + d8.slice(4, 6) + '/' + d8.slice(6, 8) + ' ' + name + '）');
  // 一覧取得の失敗（中継が不安定・古い日付で掲載なし）でも DB検索で解決できるように catch する
  return gcDay(d8, true).catch(function(){ return []; }).then(function(rows){
    var want = gcNameCore(name);
    var hit = null, loose = null;
    (rows || []).forEach(function(r){
      if (hit) return;
      var have = gcNameCore(r.name);
      if (!have) return;
      var exact = (have === want) || (have.indexOf(want) >= 0) || (want.indexOf(have) >= 0);
      if (!exact) return;
      if (venue && r.venue && r.venue !== venue) return;   // 同日・同名の場違いを拾わない
      if (r.grade) hit = r; else if (!loose) loose = r;
    });
    var use = hit || loose;
    if (use) return saveRid(use.rid);
    return gcResolveRidDb(d8, name, venue, progress).then(saveRid);
  });
}
/* ================= 地方交流 Jpn（db.netkeiba検索・年度ごと） ================= */
var GCL_JPN = [
  { word: '川崎記念',          level: 'Jpn1' },
  { word: 'かしわ記念',        level: 'Jpn1' },
  { word: 'さきたま杯',        level: 'Jpn1' },
  { word: '帝王賞',            level: 'Jpn1' },
  { word: '南部杯',            level: 'Jpn1' },
  { word: 'JBCクラシック',     level: 'Jpn1' },
  { word: 'JBCスプリント',     level: 'Jpn1' },
  { word: 'JBCレディスクラシック', level: 'Jpn1' },
  { word: '全日本2歳優駿',     level: 'Jpn1' },
  { word: '東京大賞典',        level: 'Jpn1' },
  { word: '名古屋大賞典',      level: 'Jpn2' },
  { word: '兵庫チャンピオンシップ', level: 'Jpn2' },
  { word: 'マーキュリーC',     level: 'Jpn2' },
  { word: '浦和記念',          level: 'Jpn2' },
  { word: '名古屋グランプリ',  level: 'Jpn2' },
  { word: 'オーバルスプリント', level: 'Jpn3' }
];
/* db.netkeiba のレース検索結果（中央・地方両方） */
function gcDbSearch(word){
  var ls = gcLs();
  var ck = 'q-' + word;
  if (ls.q && ls.q[ck]) return Promise.resolve(ls.q[ck]);
  if (typeof drGet !== 'function') return Promise.resolve([]);
  var dbUrl = 'https://db.netkeiba.com/race/list.html?word=' + encodeURIComponent(word) + '&input=UTF-8&list=1';
  // 中継の一時的な失敗(429/502/空応答)で「地方Jpnレースがカレンダーから消える」のを防ぐためリトライする。
  // 失敗は握り潰さず上位へ投げ、キャッシュにも残さない（次回やり直せる）。
  return (typeof drGetRetry === 'function' ? drGetRetry(dbUrl, 3) : gcGet(dbUrl)).then(function(html){
    var out = [];
    var parts = String(html).split(/<tr/i);
    for (var i = 0; i < parts.length; i++){
      var seg = parts[i];
      var ridM = seg.match(/href="https?:\/\/db\.netkeiba\.com\/race\/(\d{12})\//);
      if (!ridM) continue;
      var txt = seg.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      var dm = txt.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
      if (!dm) continue;
      out.push({
        rid: ridM[1],
        date8: dm[1] + ('0' + dm[2]).slice(-2) + ('0' + dm[3]).slice(-2),
        txt: txt
      });
    }
    out.sort(function(a, b){ return b.date8.localeCompare(a.date8); });
    ls.q = ls.q || {}; ls.q[ck] = out.slice(0, 60);
    gcSave(ls);
    return out.slice(0, 60);
  });
}
/* DB検索行テキストからNAR競馬場名を取り出す */
var GCL_NAR_VENUES = ['大井','川崎','船橋','浦和','盛岡','水沢','門別','帯広','金沢','笠松','名古屋','園田','姫路','佐賀','高知','福山'];
function gcVenueInTxt(txt){
  for (var i = 0; i < GCL_NAR_VENUES.length; i++){
    if (txt.indexOf(GCL_NAR_VENUES[i]) >= 0) return GCL_NAR_VENUES[i];
  }
  return '';
}
/* 地方交流Jpnレースを年度ぶん解決（各レース1年に1開催のはず）。year → entries */
function gcJpn(year){
  var ls = gcLs();
  var key = 'jpn-' + year;
  if (ls.jpn && ls.jpn[key]) return Promise.resolve(ls.jpn[key]);
  var idx = 0, out = [], errs = 0, firstErr = '';
  return new Promise(function(res){
    (function next(){
      if (idx >= GCL_JPN.length){ res(out); return; }
      var item = GCL_JPN[idx++];
      gcDbSearch(item.word).then(function(rows){
        var hit = null, fallback = null;
        for (var i = 0; i < rows.length; i++){
          var r = rows[i];
          if (r.date8.indexOf(String(year)) !== 0) continue;
          if (!fallback) fallback = r;
          // (GI)(GII)(JpnI)… などのグレード表記がある行を優先（年度内で最初の1件）
          if (/(\(|\()[A-Z]*Jpn[123ⅠⅡⅢ]|(\(|\()G?[ⅠⅡⅢ][)）]|Jpn[123ⅠⅡⅢ]/.test(r.txt)){
            hit = r; break;
          }
        }
        var use = hit || fallback;
        if (use){
          out.push({
            rid: use.rid, date: use.date8, grade: item.level,
            venue: gcVenueInTxt(use.txt) || gcVenue(use.rid.substring(4, 6)),
            name: item.word, jpn: true
          });
        }
        next();
      }, function(e){
        // 通信エラーは「そのレースは存在しない」とは違う。カウントだけして次へ進む
        errs++; if (!firstErr) firstErr = (e && e.message) || String(e);
        next();
      });
    })();
  }).then(function(rows){
    if (errs >= GCL_JPN.length){
      return Promise.reject(new Error('地方交流JpnレースのDB検索に失敗しました（' + firstErr + '）。' +
        '※「レースが見つからない」のではなく通信エラーです。数秒おいてカレンダーを開き直してください。'));
    }
    if (errs){
      // 一部だけ失敗した結果をキャッシュすると、その年のJpnレースが欠けたまま固定されるため保存しない
      return Promise.reject(new Error('地方交流Jpnレースの一部（' + errs + '/' + GCL_JPN.length + '語）を取得できませんでした（' + firstErr + '）。' +
        '中央の重賞は表示しています。カレンダーを開き直すと未取得ぶんを再取得します。'));
    }
    ls.jpn = ls.jpn || {}; ls.jpn[key] = rows;
    gcSave(ls);
    return rows;
  });
}

/* ================= 表示 ================= */
var gcUI = { y: 0, m: 0, sel: null };
function gcNowY(){ return new Date().getFullYear(); }
function gcYearOptions(){
  var sel = $('gcYear'); if (!sel) return;
  var yNow = gcNowY();
  var html = [];
  for (var y = yNow; y >= 2006; y--) html.push('<option value="' + y + '">' + y + '年</option>');
  sel.innerHTML = html.join('');
  // 初期値: 今年（あるいは現在のレースが古い年度の場合は今年のまま）
  gcUI.y = yNow;
  sel.value = String(yNow);
}
function gcMonthBar(){
  var bar = $('gcMonthBar'); if (!bar) return;
  var h = [];
  var ls = gcLs();
  var sched = (ls.sched && ls.sched[gcUI.y]) || [];
  var jpnAll = (ls.jpn && ls.jpn['jpn-' + gcUI.y]) || [];
  for (var m = 1; m <= 12; m++){
    var c = sched.filter(function(r){ return parseInt(String(r.date).slice(4, 6), 10) === m; }).length +
            jpnAll.filter(function(r){ return parseInt(String(r.date).slice(4, 6), 10) === m; }).length;
    var cnt = c ? '<span class="cnt">' + c + '</span>' : '';
    h.push('<button type="button" class="gcm' + (gcUI.m === m ? ' gcm-a' : '') + '" data-gcm="' + m + '">' + m + '月' + cnt + '</button>');
  }
  bar.innerHTML = h.join('');
}
function gcSetMsg(s, err){
  var el = $('gcMsg');
  if (el){ el.innerHTML = (err ? '<span style="color:var(--err-ink)">⚠ ' : '') + esc(s || '') + (err ? '</span>' : ''); }
}
function gcDayOfMon(y, m){
  return new Date(y, m, 0).getDate();
}
/* JRA同様「月曜始まり」の月グリッドを描画 */
function gcRenderMonth(y, m, central, jpn, needDate){
  var cal = $('gcCal'); if (!cal) return;
  var map = {};      // date8 -> entries
  central = central || [];
  jpn = jpn || [];
  central.forEach(function(r){ (map[r.date] = map[r.date] || []).push(r); });
  jpn.forEach(function(r){ (map[r.date] = map[r.date] || []).push(r); });
  var dates = Object.keys(map).sort();
  var nd = gcDayOfMon(y, m);
  var firstDow = new Date(y, m - 1, 1).getDay();          // 0=日
  var lead = (firstDow + 6) % 7;                           // 月曜始まりで1日の前の空白数
  var total = lead + nd;
  var weeks = Math.ceil(total / 7);
  var today8 = gcToday8();
  var h = ['<table class="gc-tbl"><thead><tr>',
    '<th>月</th><th>火</th><th>水</th><th>木</th><th>金</th><th>土</th><th>日</th>',
    '</tr></thead><tbody>'];
  var day = 1 - lead;
  var now = new Date();
  for (var w = 0; w < weeks; w++){
    h.push('<tr>');
    for (var c = 0; c < 7; c++){
      var d = day++;
      if (d < 1 || d > nd){ h.push('<td class="gc-cell off"></td>'); continue; }
      var d8 = y + ('0' + m).slice(-2) + ('0' + d).slice(-2);
      var inFuture = d8 > today8;
      var isToday = d8 === today8;
      h.push('<td class="gc-cell' + (isToday ? ' gc-today' : '') + '"><span class="gc-daynum">' + d + '</span>');
      var list = map[d8] || [];
      // 並び順: 中央はR番順・Jpn後
      list.sort(function(a, b){ return (a.jpn ? 90 : (parseInt(a.no,10)||0)) - (b.jpn ? 90 : (parseInt(b.no,10)||0)); });
      list.forEach(function(r){
        var key = r.rid || (r.date + '|' + r.name);
        var done = inFuture ? ' done' : '';
        var cls = (r.grade === 'G1') ? 'g1' : (r.grade === 'G2') ? 'g2' : (r.grade === 'G3') ? 'g3' : 'jpn';
        var tip = r.grade + ' ' + r.name + (r.venue ? '（' + r.venue + '）' : '') + (r.dist ? ' ' + r.dist : '') +
          (r.rid ? '' : ' ・クリックでレースIDを照合して分析します') +
          (done ? ' ・開催前でもクリックで「過去10年の同名レース」を分析できます（今年の出走馬は発走後に反映）' : '');
        h.push('<button type="button" class="gcr' + done + '" data-gcr="' + esc(key) + '" data-rid="' + esc(r.rid || '') + '"' +
          ' data-date="' + esc(r.date || '') + '" data-name="' + esc(r.name || '') + '" data-venue="' + esc(r.venue || '') + '"' +
          ' title="' + esc(tip) + '">' +
          '<span class="gb ' + cls + '">' + esc(r.grade) + '</span><span class="gn">' + esc(r.name) + '</span>' +
          (r.venue ? '<span class="gv">' + esc(r.venue) + '</span>' : '') + '</button>');
      });
      h.push('</td>');
    }
    h.push('</tr>');
  }
  h.push('</tbody></table>');
  if (!central.length && !jpn.length) h.push('<div class="small muted" style="margin-top:4px">この月の重賞はまだ netkeiba に掲載されていません（今年の後半開催などは開催日が確定してから表示されます）。「↻ 再取得」で最新を取得できます。</div>');
  cal.innerHTML = h.join('');
}
function gcToday8(){
  var d = new Date();
  return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
}
/* キャッシュ内容から月を描画（中央は必ず、Jpnは取得済みなら併記） */
function gcRenderLoaded(y, m, withJpn){
  var ls = gcLs();
  var central = ((ls.sched && ls.sched[y]) || []).filter(function(r){ return parseInt(String(r.date).slice(4, 6), 10) === m; });
  var jpnRows = (withJpn && ls.jpn && ls.jpn['jpn-' + y]) ? ls.jpn['jpn-' + y].filter(function(r){ return +r.date.slice(4, 6) === m; }) : [];
  gcRenderMonth(y, m, central, jpnRows);
  var tot = central.length + jpnRows.length;
  gcSetMsg('✅ ' + y + '年' + m + '月の重賞 ' + tot + ' 件（中央' + central.length +
    (jpnRows.length ? '・地方Jpn' + jpnRows.length : '') + '）を表示。レース名をクリックで⑥分析。');
  gcMonthBar();
}
function gcLoadMonth(y, m){
  // 中央は「重賞日程(年1取得)」から月で絞るだけ。地方交流Jpnは別経路（失敗しても中央は表示維持）
  var withJpn = !!($('gcJpn') && $('gcJpn').checked);
  gcUI.y = y; gcUI.m = m;
  var ym = $('gcYear'); if (ym) ym.value = String(y);
  gcMonthBar();
  gcSetMsg(m + '月の重賞を読み込んでいます…');
  var ls = gcLs();
  var jpnCached = !withJpn || !!(ls.jpn && ls.jpn['jpn-' + y]);
  var renderLoadedWith = function(rows){
    var ls2 = gcLs();
    var jpnRows = (withJpn && ls2.jpn && ls2.jpn['jpn-' + y])
      ? ls2.jpn['jpn-' + y].filter(function(r){ return parseInt(String(r.date).slice(4, 6), 10) === m; }) : [];
    gcRenderMonth(y, m, rows, jpnRows);
    try { if (typeof drRenderPick === 'function') drRenderPick(); } catch(e){}
    var tot = rows.length + jpnRows.length;
    gcSetMsg('✅ ' + y + '年' + m + '月の重賞 ' + tot + ' 件（中央' + rows.length +
      (jpnRows.length ? '・地方Jpn' + jpnRows.length : '') + '）を表示。レース名をクリックで⑥分析。');
    gcMonthBar();
  };
  gcUI.rows = [];
  gcMonth(y, m, function(msg){ if (gcUI.y === y && gcUI.m === m) gcSetMsg(msg); }).then(function(rows){
    if (!(gcUI.y === y && gcUI.m === m)) return;
    gcUI.rows = rows;
    renderLoadedWith(rows);
    if (withJpn && !jpnCached){
      gcSetMsg('✅ 中央の重賞 ' + rows.length + ' 件を表示。地方交流JpnレースをDB検索中（初回は十数秒ほど）…');
      gcJpn(y).then(function(){
        if (gcUI.y === y && gcUI.m === m) renderLoadedWith(rows);
      }).catch(function(e2){
        if (!(gcUI.y === y && gcUI.m === m)) return;
        renderLoadedWith(rows);
        gcSetMsg('✅ 中央の重賞 ' + rows.length + ' 件を表示。地方交流Jpnは取得できませんでした（' +
          ((e2 && e2.message) || e2) + '）。', true);
      });
    }
  }).catch(function(e){
    if (!(gcUI.y === y && gcUI.m === m)) return;
    gcSetMsg('重賞カレンダーを取得できませんでした: ' + ((e && e.message) || e) +
      '　※「① データ入力」→「URL取込の通信設定」→「🔧 中継を診断」で中継を確認し、「↻ 再取得」でやり直せます。', true);
  });
}
function gcReloadYear(){
  var y = gcUI.y;
  var ls = gcLs();
  // 旧形式(mon/dates)も含めて、この年度のキャッシュを消してから取り直す
  ['mon', 'dates', 'jpn', 'sched'].forEach(function(k){
    if (ls[k]) Object.keys(ls[k]).forEach(function(key){ if (key.indexOf(String(y)) === 0 || key.indexOf('jpn-' + y) === 0) delete ls[k][key]; });
  });
  if (ls.day){ Object.keys(ls.day).forEach(function(d8){ if (d8.indexOf(String(y)) === 0) delete ls.day[d8]; }); }
  if (ls.ridmap){ Object.keys(ls.ridmap).forEach(function(key){ if (key.indexOf(String(y)) === 0) delete ls.ridmap[key]; }); }
  gcSave(ls);
  gcSetMsg('この年度のカレンダー情報を消去しました。読み込み直します。');
  gcLoadMonth(y, gcUI.m);
}

/* ================= クリックで分析（表示先は「📊 重賞データ分析」カード1枚に統合） =================
   2026-09-11: 旧「⑥ 分析結果（カレンダーから選択したレース）」カードは📊と中身が完全に同一だったため統合。
   カレンダーから選んでも①で読み込んでも、結果は #drOut の1箇所だけに表示します（二重表示・二重通信なし）。 */
function gcDrCard(){
  var c = $('drCard');
  if (c){
    c.classList.remove('hid');
    try { c.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch(e){}
  }
  return c;
}
function gcAnalyzeRid(rid, name, venue, date8){
  gcDrCard();
  // 📊側の「対象レース」もこのレースに切り替える（①を読み込んでいなくても📊が動くように）
  try {
    if (typeof drSetTarget === 'function'){ drSetTarget(rid, name || '', { venue: venue || '', date: date8 || '' }); }
    if (typeof drRenderPick === 'function') drRenderPick();
  } catch(e){}
  var out = $('drOut'); if (out) out.innerHTML = '';
  drStat('読み込み中…');
  drMsgSet('分析を準備しています…（' + (name ? name + ' / ' : '') + rid + '）');
  drBusy(true);
  drAnalyzeRid(rid, {}, function(m){ drMsgSet(m); }).then(function(res){
    drFinishRun(res, (res && res.name) || name, rid, false);
  }).catch(function(e){
    drMsgSet('分析できませんでした: ' + ((e && e.message) || e), true);
    drStat('');
  }).finally(function(){ drBusy(false); });
}
/* 日程テーブルの行（日付＋レース名）から rid を解決して分析を実行 */
function gcAnalyzeByDate(date8, name, venue){
  gcDrCard();
  var out = $('drOut'); if (out) out.innerHTML = '';
  drStat('読み込み中…');
  drMsgSet('レースIDを照合しています…（' + String(date8).slice(4, 6) + '/' + String(date8).slice(6, 8) + ' ' + name + '）');
  gcResolveRid(date8, name, function(m2){ drMsgSet(m2); }, venue).then(function(rid){
    if (!rid){
      // race_id がまだ無いレース（今年の後半など開催前・netkeiba未掲載）。
      // 過去10年の集計に今年の race_id は不要なので、レース名から過去の同名レースを集計する。
      gcAnalyzeByName(date8, name, venue);
      return;
    }
    gcAnalyzeRid(rid, name, venue, date8);
  }).catch(function(e){
    drMsgSet(String((e && e.message) || e), true);
    drStat('');
  });
}
/* race_id が無いレースを「レース名」から分析する（開催前の重賞も過去の同名レースで集計できる） */
function gcAnalyzeByName(date8, name, venue, progress, done){
  var row = gcFindRow(date8, name);
  var v = venue || (row && row.venue) || '';
  var dist = (row && row.dist) || '';
  // 📊側の「名前だけ」経路にそのまま渡す（表示・対象レースの記憶も📊側でやる）
  if (typeof drRunForName === 'function'){
    drRunForName(name, v, date8, dist);
    if (done) done(null);
    return;
  }
  try {
    if (typeof drSetTarget === 'function') drSetTarget('', name, { venue: v, date: String(date8 || '') });
    if (typeof drRenderPick === 'function') drRenderPick();
  } catch(e){}
  if (typeof drAnalyzeByName !== 'function'){ drMsgSet('レース名からの分析が使えません。', true); return; }
  drAnalyzeByName(name, v, date8, dist, progress || function(m){ drMsgSet(m); }).then(function(res){
    drFinishRun(res, name, '', true);
    if (done) done(res);
  }).catch(function(e){
    drMsgSet('レース名からも過去の開催を見つけられませんでした（' + ((e && e.message) || e) +
      '）。①で出馬表を読み込んでから「📥 この重賞の過去10年を分析」をお試しください。', true);
    drStat('');
  });
}
/* 日程（キャッシュ）からその日・その名前の行を探す（開催場・距離を取るため） */
function gcFindRow(date8, name){
  var d8 = String(date8 || ''), want = gcNameCore(name);
  var ls = gcLs();
  var pools = [(gcUI && gcUI.rows) || []];
  var y = d8.slice(0, 4);
  if (ls.sched && ls.sched[y]) pools.push(ls.sched[y]);
  for (var i = 0; i < pools.length; i++){
    var arr = pools[i] || [];
    for (var k = 0; k < arr.length; k++){
      var r = arr[k];
      if (!r || String(r.date || '') !== d8) continue;
      if (gcNameCore(r.name) === want) return r;
    }
  }
  return null;
}
function gcEvent(){
  // 月切替
  var bar = $('gcMonthBar');
  if (bar) bar.addEventListener('click', function(e){
    var b = (e.target && e.target.closest) ? e.target.closest('[data-gcm]') : null;
    if (!b) return;
    var m = parseInt(b.getAttribute('data-gcm'), 10);
    if (!(m >= 1 && m <= 12)) return;
    gcLoadMonth(gcUI.y, m);
  });
  // 年度変更
  var yr = $('gcYear');
  if (yr) yr.addEventListener('change', function(){
    var y = parseInt(yr.value, 10) || gcNowY();
    gcLoadMonth(y, gcUI.m);
  });
  // 地方Jpn表示切替
  var jpn = $('gcJpn');
  if (jpn) jpn.addEventListener('change', function(){ gcLoadMonth(gcUI.y, gcUI.m); });
  // 再取得
  var rl = $('gcReload');
  if (rl) rl.addEventListener('click', function(){ gcReloadYear(); });
  // 分析カード内のクリック: レース選択
  var cal = $('gcCal');
  if (cal) cal.addEventListener('click', function(e){
    var b = (e.target && e.target.closest) ? e.target.closest('[data-gcr]') : null;
    if (!b) return;
    var rid = b.getAttribute('data-rid') || '';
    var date8 = b.getAttribute('data-date') || '';
    var name = b.getAttribute('data-name') || '';
    var ven = b.getAttribute('data-venue') || '';
    if (rid){ gcAnalyzeRid(rid, name, ven); return; }
    // 日程テーブルには race_id が無いので、日別レース一覧から名前一致で解決する
    if (!date8 || !name){
      gcSetMsg('このレースの情報が未確定です。日別の出馬表を①で読み込むと確実に分析できます。');
      return;
    }
    gcAnalyzeByDate(date8, name, ven);
  });
}
function initGc(){
  gcYearOptions();
  gcUI.m = new Date().getMonth() + 1;
  gcEvent();
  gcLoadMonth(gcUI.y, gcUI.m);
}
