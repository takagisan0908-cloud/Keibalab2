/* ============================================================
   p63_jockeydb.js — ★2026-09-13 第25弾②: 🏇 騎手・調教師DB（keibalab.jp）
   ------------------------------------------------------------
   【目的】keibalab.jp のDBから騎手・調教師の成績を取得してキャッシュし、
           AI予想のファクター（③）に使えるようにする。

   【確定したURL体系】（手順書 §59-1・実測確認済み）
     一覧    https://www.keibalab.jp/db/leading.html?kind=jockey&page=N
     詳細    https://www.keibalab.jp/db/jockey/{5桁ID}/
     履歴    /db/jockey/{ID}/history.html?year=2026&ar=1   (ar=1/2/3/4=1着/2着/3着/着外)
     調教師  kind=trainer / /db/trainer/{ID}/

   【パーサの方針 ★重要】
     クラス名・id名には**依存しません**（実物のHTML構造を確認できていないため）。
     実測で確定している
       ・リンクの href パターン（/db/jockey/(\d{5})/ 等）
       ・見出しテキスト（基本情報 / イチ推しアビリティ / 本年成績 / 累計成績 / 今週の騎乗馬）
       ・テーブルの列順
     だけを頼りに、正規表現＋DOMの両方で拾います。
     → クラス名が違っても動きます。逆にテーブルの列順が変わると壊れるので、
       列は「先頭のth/tdのラベル」で照合します。

   【注意】騎手IDと調教師IDは**別体系で番号が衝突します**
           （田辺裕信=騎手01075 / 矢作芳=調教師01075）。
           → キャッシュのキーは必ず kind を含めます。
   ============================================================ */

var KL_BASE = 'https://www.keibalab.jp';
/* キャッシュのキー（kind別に分離） */
var KL_REG_KEY = 'khl_jdb_reg';       // 名前→ID 登録簿
var KL_ENT_KEY = 'khl_jdb_ent';       // 騎手/調教師ごとの詳細キャッシュ
/* ★2026-09-13 第26弾①: キャッシュは【極力削除しない】方針に変更しました。
   従来は 12時間で期限切れにして null を返していましたが、それだと
   「いつでも色々な検索を可能とする」に反します（再取得が必要になり、通信も増える）。
   → **期限切れでもデータは捨てず、そのまま返します。** TTLは「鮮度の目安」に格下げし、
     klEntAge() で経過時間を出して画面に表示、更新したいときだけ force で取り直します。
   保存領域の逼迫時にも、STORE_DESC で 'keep'（🥇第一優先）に分類したので自動削除されません。 */
var KL_TTL_MS = 12 * 3600 * 1000;      // 鮮度の目安（これを超えても削除はしない）
var KL_REG_TTL_MS = 7 * 24 * 3600 * 1000;   // 登録簿の鮮度の目安（IDはほぼ不変）

/* ---- URL生成 ---- */
function klKind(kind){ return String(kind || 'jockey') === 'trainer' ? 'trainer' : 'jockey'; }
function klListUrl(kind, page){
  var u = KL_BASE + '/db/leading.html?kind=' + klKind(kind);
  if (page && page > 1) u += '&page=' + page;
  return u;
}
function klDetailUrl(kind, id){ return KL_BASE + '/db/' + klKind(kind) + '/' + klId(id) + '/'; }
function klHistoryUrl(kind, id, year, ar){
  var u = KL_BASE + '/db/' + klKind(kind) + '/' + klId(id) + '/history.html';
  var q = [];
  if (year) q.push('year=' + year);
  if (ar) q.push('ar=' + ar);
  return u + (q.length ? '?' + q.join('&') : '');
}
function klId(id){
  var s = String(id == null ? '' : id).replace(/[^0-9]/g, '');
  return s ? ('00000' + s).slice(-5) : '';
}
function klValidId(id){ return /^\d{5}$/.test(klId(id)); }

/* ---- 汎用ユーティリティ ---- */
function klNum(v){
  if (v == null) return null;
  var s = String(v).replace(/[,，\s]/g, '');
  if (s === '' || s === '-' || s === '―' || s === '--') return null;   // 「-」は数値ではない（障害0戦など）
  var m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function klStr(v){ return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
function klStripTags(h){
  return klStr(String(h == null ? '' : h).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' '));
}
/* テキストを正規化して比較用にする（全角/半角・空白） */
function klNorm(s){
  return String(s == null ? '' : s)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(c){ return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[\s\u3000]/g, '')
    .replace(/[．.]/g, '．');
}
/* 騎手名の表記ゆれを吸収（Ｃ．ルメール / C.ルメール / ｸﾘｽﾄﾌｧｰ･ﾙﾒｰﾙ など） */
function klNameKey(name){
  var s = klNorm(name);
  s = s.replace(/[･・．\.,、]/g, '');
  s = s.replace(/[Ａ-Ｚａ-ｚ]/g, function(c){ return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).toUpperCase();
  return s;
}

/* =========================================================
   リーディング一覧のパース（名前→ID 登録簿を作る）
   ========================================================= */
function klParseLeading(html, kind){
  kind = klKind(kind);
  var out = { kind: kind, rows: [], trainers: [], hasNext: false, page: 1, err: '' };
  if (!html) { out.err = 'empty'; return out; }
  var h = String(html);
  /* 次のページがあるか */
  out.hasNext = /page=\d+&(?:amp;)?kind=/.test(h) || /NEXT/.test(h);

  /* テーブル行を総ざらいする。
     騎手リンク（/db/jockey/(\d{5})/）を含む行から、行内の全セルを順に読む。 */
  var reRow = /<tr\b[\s\S]*?<\/tr>/gi;
  var m;
  var seen = {};
  while ((m = reRow.exec(h)) !== null){
    var row = m[0];
    var linkRe = new RegExp('/db/' + kind + '/(\\d{5})/', 'i');
    var lm = row.match(linkRe);
    if (!lm) continue;
    var id = lm[1];
    /* セルを順に抜く */
    var cells = [];
    var cre = /<t[dh]\b[\s\S]*?<\/t[dh]>/gi, cm;
    while ((cm = cre.exec(row)) !== null) cells.push(cm[0]);
    if (cells.length < 5) continue;
    /* 騎手名: IDリンクを含むセルのテキスト */
    var name = '';
    for (var i = 0; i < cells.length; i++){
      if (cells[i].indexOf('/db/' + kind + '/' + id) >= 0){
        name = klStripTags(cells[i]);
        if (name) { out.nameCol = i; break; }
      }
    }
    if (!name){
      var am = row.match(new RegExp('href="[^"]*/db/' + kind + '/' + id + '/?"[^>]*>([\\s\\S]*?)</a>', 'i'));
      name = am ? klStripTags(am[1]) : '';
    }
    if (!name) continue;
    if (seen[id]) continue;
    seen[id] = 1;
    /* 数字セルを後ろから拾う（列ズレに強くするため、末尾8個を成績とみなす） */
    var nums = [];
    for (var j = 0; j < cells.length; j++){
      var t = klStripTags(cells[j]);
      nums.push(t);
    }
    var tail = nums.slice(-9);                 // 1着,2着,3着,着外,騎乗回数,勝率,連対率,複勝率,賞金
    var r = {
      kind: kind, id: id, name: name,
      w1: klNum(tail[0]), w2: klNum(tail[1]), w3: klNum(tail[2]), out: klNum(tail[3]),
      rides: klNum(tail[4]), winRate: klNum(tail[5]), placeRate: klNum(tail[6]),
      showRate: klNum(tail[7]), money: klNum(tail[8])
    };
    /* 順位（先頭セルが数字なら順位。1〜3位は画像なので数字が無い） */
    var rank = klNum(nums[0]);
    r.rank = (rank && rank > 0 && rank < 1000) ? rank : null;
    /* 所属 */
    r.branch = (nums.length > 2) ? klStripTags(nums[2]) : '';
    out.rows.push(r);
    /* 同じ行に調教師リンクがあれば一緒に収穫 */
    var tre = /\/db\/trainer\/(\d{5})\/"[\s\S]*?<\/a>/gi, tm;
    while ((tm = tre.exec(row)) !== null){
      var tid = tm[1];
      var tn = row.slice(tm.index).match(/>([^<]{1,30})<\/a>/);
      out.trainers.push({ kind: 'trainer', id: tid, name: tn ? klStripTags(tn[1]) : '' });
    }
  }
  /* 所属セルの調教師リンク（騎手と同じセルに混ざる） */
  var tre2 = /\/db\/trainer\/(\d{5})\/"[^>]*>([\s\S]*?)<\/a>/gi, tm2;
  var tseen = {};
  while ((tm2 = tre2.exec(h)) !== null){
    if (tseen[tm2[1]]) continue;
    tseen[tm2[1]] = 1;
    out.trainers.push({ kind: 'trainer', id: tm2[1], name: klStripTags(tm2[2]) });
  }
  if (!out.rows.length) out.err = 'no rows';
  return out;
}

/* =========================================================
   イチ推しアビリティの分類（得意コース・得意馬場・条件・時間帯）
   ========================================================= */
function klClassifyAbility(items){
  var o = { courses: [], baba: [], cond: [], time: [], raw: items || [], unknown: [] };
  (items || []).forEach(function(t){
    var s = klStr(t);
    if (!s) return;
    /* 1) 得意コース: 阪神ダ1400m / 東京芝2400m */
    var m = s.match(/^([^\s\d]{2,6}?)\s*(芝|ダ|ダート|障)\s*(\d{3,4})\s*m?$/);
    if (m){
      o.courses.push({ venue: klNorm(m[1]), surface: (m[2] === '障') ? '障' : (m[2] === '芝' ? '芝' : 'ダ'), dist: parseInt(m[3], 10), text: s });
      return;
    }
    /* 2) 得意馬場: 芝重・不良◎ / ダ稍重◎ */
    var mb = s.match(/^(芝|ダ|ダート)?\s*(重|不良|稍重|稍々重|良)\s*[・,、]?\s*(重|不良|稍重|稍々重|良)?/);
    if (mb && /◎|○|▲/.test(s)){
      o.baba.push({ surface: mb[1] ? (mb[1] === '芝' ? '芝' : 'ダ') : '', states: [mb[2], mb[3]].filter(Boolean), text: s });
      return;
    }
    /* 3) 時間帯: 序盤戦(1～3R)◎ / メイン◎ */
    if (/(\d+\s*[～~\-]\s*\d+\s*R|序盤|中盤|終盤|メイン|前半戦|後半戦)/.test(s)){ o.time.push(s); return; }
    /* 4) 条件: 軽斤量◎ 小型馬◎ 少頭数◎ 多頭数◎ */
    if (/(斤量|頭数|小型馬|大型馬|人気|間隔|連闘|休み明け|鉄砲)/.test(s)){ o.cond.push(s); return; }
    o.unknown.push(s);
  });
  return o;
}

/* 見出し（h2/h3/h5等）の直後にある <ul> の項目を拾う */
function klListAfterHeading(html, heading){
  var h = String(html || '');
  /* ★末尾キャプチャは**貪欲**にすること。遅延量指定子 `([\s\S]{0,3000}?)` だと
     後続アンカーが無いため**空文字にマッチ**し、項目が1つも取れません（実測で判明）。 */
  var re = new RegExp('<h[1-6][^>]*>[\\s\\S]{0,80}?' + heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]{0,120}?</h[1-6]>([\\s\\S]{0,4000})', 'i');
  var m = h.match(re);
  if (!m) return [];
  var seg = m[1];
  /* 次の見出しより手前だけに絞る（別のセクションの <ul> を拾わない） */
  var nh = seg.search(/<h[1-6][\s>]/i);
  if (nh > 0) seg = seg.slice(0, nh);
  var items = [], re2 = /<li\b[\s\S]*?<\/li>/gi, mm;
  var um = seg.match(/<ul\b[\s\S]*?<\/ul>/i) || seg.match(/<ol\b[\s\S]*?<\/ol>/i);
  var src = um ? um[0] : seg;                 // <ul>/<ol> が無い作りでも <li> を拾う
  while ((mm = re2.exec(src)) !== null){
    var t = klStripTags(mm[0]);
    if (t && items.indexOf(t) < 0) items.push(t);
  }
  return items;
}

/* 2列テーブル（th|td）を { ラベル: 値 } にする */
function klParseKvTables(html){
  var o = {}, h = String(html || '');
  var re = /<tr\b[\s\S]*?<\/tr>/gi, m;
  while ((m = re.exec(h)) !== null){
    var row = m[0];
    var th = row.match(/<th\b[\s\S]*?<\/th>/i);
    var tds = row.match(/<td\b[\s\S]*?<\/td>/gi);
    if (!th || !tds || tds.length !== 1) continue;
    var k = klStripTags(th[0]);
    if (!k || o[k] != null) continue;
    o[k] = { html: tds[0], text: klStripTags(tds[0]) };
  }
  return o;
}

/* 成績テーブル（本年成績 / 累計成績）をパース
   列: ラベル | 1着 | 2着 | 3着 | 着外 | 騎乗回数 | 勝率 | 連対率 | 3着内率
   行: 平地 / 障害 / 全レース */
function klParseRecordTable(html, caption){
  var h = String(html || '');
  /* キャプション（本年成績 / 累計成績）を含むテーブルを探す */
  var re = /<table\b[\s\S]*?<\/table>/gi, m, seg = '';
  while ((m = re.exec(h)) !== null){
    if (m[0].indexOf(caption) >= 0){ seg = m[0]; break; }
  }
  if (!seg) return null;
  var out = { caption: caption, 平地: null, 障害: null, 全レース: null };
  var rows = seg.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  rows.forEach(function(row){
    var cells = row.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) || [];
    if (cells.length < 6) return;
    var label = klStripTags(cells[0]);
    if (label !== '平地' && label !== '障害' && label !== '全レース') return;
    var v = cells.slice(1).map(klStripTags);
    out[label] = {
      w1: klNum(v[0]), w2: klNum(v[1]), w3: klNum(v[2]), out: klNum(v[3]),
      rides: klNum(v[4]), winRate: klNum(v[5]), placeRate: klNum(v[6]), showRate: klNum(v[7])
    };
  });
  return out;
}

/* 今週の騎乗馬（日付ごとの見出し＋テーブル）をパース
   ★「8戦4勝」から当日の調子が即計算できる（③に直結） */
function klParseWeekly(html){
  var h = String(html || ''), out = [];
  var re = /(\d{4})年(\d{1,2})月(\d{1,2})日([\s\S]{0,80}?)(\d+)戦(\d+)勝([\s\S]*?)(?=(\d{4}年\d{1,2}月\d{1,2}日)|$)/g;
  var m;
  while ((m = re.exec(h)) !== null){
    var day = {
      y: parseInt(m[1], 10), mo: parseInt(m[2], 10), d: parseInt(m[3], 10),
      date8: m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2),
      head: klStripTags(m[4]), runs: parseInt(m[5], 10), wins: parseInt(m[6], 10),
      races: []
    };
    /* 回・場・日目 */
    var hm = day.head.match(/(\d+)回\s*(\S{2,4}?)\s*(\d+)日目/);
    if (hm){ day.kai = parseInt(hm[1], 10); day.venue = hm[2]; day.dayNo = parseInt(hm[3], 10); }
    /* その日のテーブルからレース行を拾う */
    var seg = m[7] || '';
    var rows = seg.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
    rows.forEach(function(row){
      var cells = row.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) || [];
      if (cells.length < 10) return;
      /* ★ヘッダ行（<th>場</th><th>R</th>…）をデータとして拾わないこと。
         先頭セルが <th> の行、または R列が数値でない行はスキップします。 */
      if (/^<th\b/i.test(cells[0])) return;
      var t = cells.map(klStripTags);
      if (!(klNum(t[1]) > 0)) return;                            // R列が数字でなければ見出し行
      var rid = '';
      var rm = row.match(/\/db\/race\/(\d{12})\//);
      if (rm) rid = rm[1];
      var hid = '';
      var hmt = row.match(/\/db\/horse\/(\d+)\//);
      if (hmt) hid = hmt[1];
      var trid = '';
      var tm2 = row.match(/\/db\/trainer\/(\d{5})\//);
      if (tm2) trid = tm2[1];
      /* 列順: 場 R レース名 コース 人 着 馬名 枠 馬 性齢 斤量 厩舎 コンビ 間隔 前走 前人 前着 */
      day.races.push({
        venue: t[0], rnum: klNum(t[1]), raceName: t[2], course: t[3],
        pop: klNum(t[4]), rank: klNum(t[5]), horseName: t[6], frame: klNum(t[7]),
        horseNo: klNum(t[8]), sexAge: t[9], weight: klNum(t[10]), trainer: t[11],
        combo: t[12], interval: t[13], prevRace: t[14], prevPop: klNum(t[15]), prevRank: klNum(t[16]),
        raceId: rid, horseId: hid, trainerId: trid
      });
    });
    out.push(day);
  }
  return out;
}

/* =========================================================
   騎手/調教師 詳細ページの総合パース
   ========================================================= */
function klParseDetail(html, kind, id){
  kind = klKind(kind);
  var o = { kind: kind, id: klId(id), name: '', yomi: '', basic: {}, ability: null,
            thisYear: null, career: null, weekly: [], err: '' };
  if (!html) { o.err = 'empty'; return o; }
  var h = String(html);
  /* 名前と読み: <h1>松山 弘平 <span>(まつやま こうへい)</span></h1> */
  var h1 = h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1){
    var seg = h1[1];
    var ym = seg.match(/[（(]([^）)]{2,40})[）)]/);
    o.yomi = ym ? klStripTags(ym[1]) : '';
    o.name = klStripTags(seg.replace(/[（(][^）)]*[）)]/g, ''));
  }
  if (!o.name){
    /* パンくずの「騎手:松山 弘平」から */
    var tm = h.match(/(騎手|調教師)\s*[:：]\s*([^<\n]{1,30})/);
    if (tm) o.name = klStripTags(tm[2]);
  }
  /* 基本情報（2列テーブル） */
  var kv = klParseKvTables(h);
  ['生年月日','初免許年','所属','所属厩舎','平地初騎乗','平地初勝利','障害初騎乗','障害初勝利'].forEach(function(k){
    if (kv[k]) o.basic[k] = kv[k].text;
  });
  /* 生年月日から年齢・免許年 */
  if (o.basic['生年月日']){
    var bm = o.basic['生年月日'].match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (bm) o.birth = bm[1] + ('0' + bm[2]).slice(-2) + ('0' + bm[3]).slice(-2);
    var am = o.basic['生年月日'].match(/[(（](\d{1,3})歳[)）]/);
    if (am) o.age = parseInt(am[1], 10);
  }
  if (o.basic['初免許年']){ var lm = o.basic['初免許年'].match(/(\d{4})/); if (lm) o.firstYear = parseInt(lm[1], 10); }
  /* イチ推しアビリティ */
  var ab = klListAfterHeading(h, 'イチ推しアビリティ');
  o.abilityItems = ab;
  o.ability = klClassifyAbility(ab);
  /* 成績テーブル2本 */
  o.thisYear = klParseRecordTable(h, '本年成績');
  o.career = klParseRecordTable(h, '累計成績');
  /* 今週の騎乗馬 */
  o.weekly = klParseWeekly(h);
  if (!o.name) o.err = 'no name';
  return o;
}

/* =========================================================
   ③ 騎手の調子（乗れている / 買いづらい）を数値化する
   ------------------------------------------------------------
   すべて実測値から計算します（推測しません）:
     formYear = 本年勝率 ÷ 累計勝率   … 1.2超で「乗れている」/ 0.8未満で「買いづらい」
     formDay  = 当日(今週)の勝率      … 見出しの「8戦4勝」から
   ========================================================= */
function klFormOf(d){
  var o = { ratio: null, todayRuns: 0, todayWins: 0, todayRate: null, label: '', note: '' };
  if (!d) return o;
  var ty = d.thisYear && d.thisYear['全レース'];
  var ca = d.career && d.career['全レース'];
  if (ty && ca && ty.winRate != null && ca.winRate != null && ca.winRate > 0){
    o.ratio = ty.winRate / ca.winRate;
    o.yearWin = ty.winRate; o.careerWin = ca.winRate;
  }
  (d.weekly || []).forEach(function(day){ o.todayRuns += (day.runs || 0); o.todayWins += (day.wins || 0); });
  if (o.todayRuns > 0) o.todayRate = o.todayWins / o.todayRuns;
  var r = o.ratio;
  if (r != null && r >= 1.30) o.label = '絶好調';
  else if (r != null && r >= 1.10) o.label = '好調';
  else if (r != null && r <= 0.75) o.label = '不調（買いづらい）';
  else if (r != null && r <= 0.90) o.label = 'やや不調';
  else o.label = '平常';
  return o;
}
/* 今回のレース条件と得意アビリティの一致を見る */
function klAbilityMatch(d, race){
  var o = { course: false, surface: '', dist: 0, baba: false, time: false, cond: [], hits: 0, notes: [] };
  if (!d || !d.ability || !race) return o;
  var ven = klNorm(race.venue || race.place || '');
  var sf = (race.surface === 'ダ' || /ダ/.test(String(race.surface || ''))) ? 'ダ' : '芝';
  var dist = parseInt(race.dist || race.distance || 0, 10);
  (d.ability.courses || []).forEach(function(c){
    if (ven && c.venue === ven && c.surface === sf && dist && c.dist === dist){
      o.course = true; o.surface = sf; o.dist = dist;
      o.notes.push('得意コース（' + c.text + '）が今回の条件と一致');
    }
  });
  var baba = klNorm(race.baba || '');
  (d.ability.baba || []).forEach(function(b){
    if (baba && (b.states || []).some(function(s){ return baba.indexOf(klNorm(s)) >= 0; })){
      o.baba = true; o.notes.push('得意馬場（' + b.text + '）と一致');
    }
  });
  var rn = parseInt(race.rnum || 0, 10);
  if (rn){
    (d.ability.time || []).forEach(function(t){
      var m = String(t).match(/(\d+)\s*[～~\-]\s*(\d+)\s*R/);
      if (m && rn >= parseInt(m[1], 10) && rn <= parseInt(m[2], 10)){ o.time = true; o.notes.push('得意時間帯（' + t + '）'); }
      else if (/序盤/.test(t) && rn <= 3){ o.time = true; o.notes.push('得意時間帯（' + t + '）'); }
      else if (/メイン/.test(t) && rn >= 9){ o.time = true; o.notes.push('得意時間帯（' + t + '）'); }
    });
  }
  var heads = parseInt(race.heads || 0, 10);
  if (heads){
    (d.ability.cond || []).forEach(function(c){
      if (/少頭数/.test(c) && heads <= 10){ o.hits++; o.notes.push(c + '（今回' + heads + '頭）'); }
      if (/多頭数/.test(c) && heads >= 16){ o.hits++; o.notes.push(c + '（今回' + heads + '頭）'); }
    });
  }
  return o;
}

/* =========================================================
   キャッシュ（localStorage・kind別に分離）
   ========================================================= */
function klLoad(key){
  try { var r = localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch(e){ return null; }
}
function klSave(key, v){
  try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch(e){ return false; }
}
function klRegLoad(){ var o = klLoad(KL_REG_KEY); return (o && typeof o === 'object') ? o : { jockey: {}, trainer: {}, at: 0, pages: 0 }; }
function klRegSave(reg){ return klSave(KL_REG_KEY, reg); }
/* 名前からIDを引く（表記ゆれ吸収）。★戻り値は **ID文字列**（エントリオブジェクトではない） */
function klFindId(name, kind){
  kind = klKind(kind);
  var reg = klRegLoad();
  var bag = (reg && reg[kind]) || {};
  var k = klNameKey(name);
  if (!k) return null;
  function idOf(e){ return (e && typeof e === 'object') ? (e.id || null) : (e || null); }
  if (bag[k]) return idOf(bag[k]);
  /* 前方一致（'Ｃ．ルメール' ↔ 'クリストフ・ルメール' のような完全不一致を救う） */
  var keys = Object.keys(bag);
  for (var j = 0; j < keys.length; j++){
    var a = keys[j];
    if (a.length >= 3 && k.length >= 3 && (a.indexOf(k) === 0 || k.indexOf(a) === 0)) return idOf(bag[a]);
  }
  return null;
}
function klRegPut(kind, name, id, extra){
  kind = klKind(kind);
  var reg = klRegLoad();
  if (!reg[kind]) reg[kind] = {};
  var k = klNameKey(name);
  if (!k || !klValidId(id)) return false;
  var e = reg[kind][k] || { id: klId(id), name: name };
  e.id = klId(id);
  if (!e.name) e.name = name;
  if (extra) Object.keys(extra).forEach(function(x){ if (extra[x] != null) e[x] = extra[x]; });
  reg[kind][k] = e;
  klRegSave(reg);
  return true;
}
function klRegCount(kind){
  var reg = klRegLoad();
  return Object.keys((reg && reg[klKind(kind)]) || {}).length;
}
/* 詳細キャッシュ */
function klEntKey(kind, id){ return klKind(kind) + ':' + klId(id); }
function klEntGet(kind, id){
  if (!klValidId(id)) return null;
  var bag = klLoad(KL_ENT_KEY) || {};
  var e = bag[klEntKey(kind, id)];
  if (!e || !e.data) return null;
  /* ★第26弾①: 期限切れでも捨てない（いつでも検索できるように） */
  return e.data;
}
/* 保存からの経過ミリ秒（未取得なら null） */
function klEntAge(kind, id){
  if (!klValidId(id)) return null;
  var bag = klLoad(KL_ENT_KEY) || {};
  var e = bag[klEntKey(kind, id)];
  if (!e || !e.at) return null;
  return Date.now() - e.at;
}
/* 経過時間の表示用テキスト（例: 「3時間前」「2日前」） */
function klAgeText(ms){
  if (ms == null) return '';
  var m = Math.floor(ms / 60000);
  if (m < 1) return 'たった今';
  if (m < 60) return m + '分前';
  var h = Math.floor(m / 60);
  if (h < 24) return h + '時間前';
  return Math.floor(h / 24) + '日前';
}
/* 鮮度が目安を超えているか（更新をすすめる表示用。削除はしない） */
function klEntStale(kind, id){
  var a = klEntAge(kind, id);
  return a != null && a > KL_TTL_MS;
}
/* キャッシュ件数（画面の状況表示用） */
function klEntCount(kind){
  var bag = klLoad(KL_ENT_KEY) || {};
  var pre = klKind(kind) + ':';
  return Object.keys(bag).filter(function(k){ return k.indexOf(pre) === 0; }).length;
}
function klEntSet(kind, id, data){
  if (!klValidId(id)) return false;
  var bag = klLoad(KL_ENT_KEY) || {};
  bag[klEntKey(kind, id)] = { at: Date.now(), data: data };
  return klSave(KL_ENT_KEY, bag);
}
function klEntDrop(){ try { localStorage.removeItem(KL_ENT_KEY); } catch(e){} }
function klRegDrop(){ try { localStorage.removeItem(KL_REG_KEY); } catch(e){} }

/* 取得（既存の中継 bfGet / histFetchHtml をそのまま使う。ホスト制限なしで任意URL可） */
function klGet(url){
  if (typeof bfGet === 'function') return bfGet(url);
  return new Promise(function(res, rej){
    try {
      fetch(url).then(function(r){ return r.text(); }).then(res).catch(rej);
    } catch(e){ rej(e); }
  });
}
/* 登録簿を作る（リーディングを page=1..maxPage まで取得） */
function klBuildRegistry(kind, maxPage, onProgress){
  kind = klKind(kind);
  var pages = Math.max(1, parseInt(maxPage || 12, 10));
  var reg = klRegLoad();
  if (!reg[kind]) reg[kind] = {};
  var got = 0, done = 0;
  function next(p){
    if (p > pages){
      reg.at = Date.now(); reg.pages = pages;
      klRegSave(reg);
      return Promise.resolve({ kind: kind, added: got, total: Object.keys(reg[kind]).length, pages: done });
    }
    return klGet(klListUrl(kind, p)).then(function(html){
      var r = klParseLeading(html, kind);
      (r.rows || []).forEach(function(x){
        if (klRegPut(kind, x.name, x.id, { rank: x.rank, branch: x.branch, w1: x.w1, rides: x.rides,
          winRate: x.winRate, placeRate: x.placeRate, showRate: x.showRate, money: x.money })) got++;
      });
      (r.trainers || []).forEach(function(x){ if (x.name) klRegPut('trainer', x.name, x.id); });
      done++;
      if (typeof onProgress === 'function') onProgress(done, pages, got);
      if (!r.hasNext && done >= 1) return next(pages + 1);      // 次ページが無ければ終了
      return next(p + 1);
    }).catch(function(){ return next(p + 1); });
  }
  return next(1);
}
/* 詳細を取得してキャッシュ */
function klFetchDetail(kind, id, force){
  kind = klKind(kind);
  if (!klValidId(id)) return Promise.reject(new Error('invalid id'));
  if (!force){
    var c = klEntGet(kind, id);
    if (c) return Promise.resolve(c);
  }
  return klGet(klDetailUrl(kind, id)).then(function(html){
    var d = klParseDetail(html, kind, id);
    if (d && d.name && !d.err) klEntSet(kind, id, d);
    return d;
  });
}
/* 名前から詳細を引く（登録簿→ID→詳細キャッシュ/取得） */
function klDetailByName(name, kind, force){
  kind = klKind(kind);
  var id = klFindId(name, kind);
  if (!id) return Promise.resolve(null);
  return klFetchDetail(kind, id, force);
}
