/* =========================================================
   p62_articleref.js — 📰 記事からレース名を自動検出して「該当馬」を参照する
   （#2026-09-13 第22弾）

   ご依頼: 「記事URLを貼り付けて抽出の際に、抽出記事の中からレース名を自動検出して
            該当馬を参照する事で短評の書き込みができるようにする
            （現在は選択した出馬表に限る記事の抽出にしか対応できていない為）」

   ── 今までの問題点（p25_horsebook.js）──────────────────────────
   ・hbParseCommentArticle() は本文中の「N着」で機械的に切るだけで、
     **レースの区切りを一切見ていなかった**。
   ・hbResolveTargetVal() は **state.horses（＝今開いている出馬表）と馬ノートDB**
     しか探さない。だから記事のレースと今開いている出馬表が違うと、
     全馬が「該当する登録馬なし」で弾かれて短評を書けなかった。

   ── このファイルがやること ────────────────────────────────────
   (1) arDetectRaces()   記事本文から**レースを自動検出**。手がかりは5系統:
         ① race.netkeiba.com の結果・出馬表リンク（?pid=race&id=202609040311 / race_id=…）
         ② 「阪神11R」「小倉9R」のような 場名＋R番号
         ③ 「第77回 チャレンジカップ(GIII・芝2000m)」のような 回次＋レース名＋グレード＋距離
         ④ 【】で囲まれた見出し（「【チャレンジCレース後コメント】」等）
         ⑤ 〜ステークス/〜賞/〜記念/新馬/未勝利/N勝クラス などのレース名パターン
       検出した位置(at)を保持するので、各馬コメントを**直前のレース見出し**に紐づけられます。
   (2) arParseArticle()  「N着＋馬名（騎手）＋コメント」をレースごとにグループ化。
   (3) arBuildIndex()    **該当馬を横断検索**します（通信ゼロ）。探す順:
         ① 今開いている出馬表(state.horses)
         ② 出馬表キャッシュ(khl_card_v1・第21弾①) … 直近40レースぶん
         ③ 学習DB(khl_ap_*) … 過去に取り込んだ全レースの出走馬
         ④ 馬ノートDB(khl_horsebook_v1)
   (4) arResolveOnline() ①〜④で見つからなかったレースだけ、race_id が分かれば出馬表を、
         分からなければ**レース名検索(rsSearch・第11弾)**で race_id を解決してから
         出馬表を取りに行きます（第21弾①のキャッシュに乗るので2回目は通信ゼロ）。
   (5) arXrefAdd()       今回の出走外で見つかった馬を「x<n>」という参照値にして
         割当表のプルダウンに出せるようにします。
   (6) src:'new'         どのデータにも居ない馬は、**記事の馬名＋競走馬IDだけで
         馬ノートを新規作成**して登録できるようにします（netkeiba の馬名リンク
         /horse/2022103995/ から競走馬IDが取れているため、次回以降も同一馬として扱えます）。

   ── race_id の構造（重要・間違えやすい）────────────────────────
     202609040311 = 2026年9月 4回 3日目 11R（＝2026/9/12 阪神11R チャレンジC）
     ┌────┬──┬──┬──┬──┐
     │YYYY│MM│回│日│R │   ← **場コードは入っていません**。先頭8桁は日付でもありません。
     └────┴──┴──┴──┴──┘
     なので race_id から「場名」や「開催日」を復元することは**できません**。
     場名は記事本文から、日付は記事の配信日から取ります。

   注意: 連結ビルドはグローバル名前空間を共有するため、このファイルの識別子は
        すべて ar / AR_ で始めています（既存の hb / nk / rs / ap と衝突しません）。
   ========================================================= */

/* レース検出に使う場名 */
var AR_VENUES = ['札幌', '函館', '福島', '新潟', '東京', '中山', '中京', '京都', '阪神', '小倉'];
/* レース名の末尾パターン */
var AR_NAME_TAIL = 'ステークス|Ｓ|S|賞|記念|特別|カップ|トロフィー|ダービー|オークス|スプリント|マイル|ハンデキャップ|ハンデ|新馬|未勝利|1勝クラス|2勝クラス|3勝クラス|オープン|リステッド|トライアル';
/* 記事本文の終端（これ以降は「関連情報」「みんなのコメント」等で他レース名が大量に出てくる） */
var AR_BODY_ENDS = ['関連情報', 'みんなのコメント', 'いま読まれています', '新着ニュース', 'アクセスランキング',
  '注目数ランキング', 'ニュースを探す', 'このニュースに注目', 'コメントを投稿', 'カテゴリから探す'];
/* 横断インデックスのキャッシュ */
var AR_IDX_TTL = 60 * 1000;
var AR_STATE = { idx: null, idxAt: 0, xref: [], net: { done: 0, fail: 0 } };

function arWide(s){ return (typeof hbWide === 'function') ? hbWide(s) : String(s == null ? '' : s); }
function arNorm(s){ return (typeof hbNorm === 'function') ? hbNorm(s) : String(s == null ? '' : s).replace(/\s/g, '').toUpperCase(); }
function arEsc(s){ return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s); }

/* =========================================================
   (0) HTML → プレーンテキスト（位置マップつき）
   ---------------------------------------------------------
   タグを消すと本文の位置がずれて「どのレース見出しの後のコメントか」が
   分からなくなるので、**テキスト1文字ごとに元のHTML内の位置**を保持します。
   これにより
     ・レース名検出はキレイなテキストに対して行える（タグ跨ぎで名前が壊れない）
     ・馬名リンク(/horse/ID/)からの競走馬ID抽出は元のHTML断片に対して行える
   という両立ができます。
   ========================================================= */
function arToText(html){
  var src = String(html == null ? '' : html);
  var out = [], map = [];
  var re = /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->|<[^>]*>|[^<]+/gi;
  var m;
  while ((m = re.exec(src)) !== null){
    var t = m[0];
    if (!t || t.charAt(0) === '<') continue;      // タグ・script・style・コメントは位置だけ飛ばす
    for (var i = 0; i < t.length; i++){ out.push(t.charAt(i)); map.push(m.index + i); }
  }
  /* 空白の連続を1つに畳む（位置マップも一緒に間引く） */
  var o2 = [], m2 = [];
  for (var j = 0; j < out.length; j++){
    var c = out[j];
    if (/\s/.test(c)){
      if (!o2.length || /\s/.test(o2[o2.length - 1])) continue;
      c = ' ';
    }
    o2.push(c); m2.push(map[j]);
  }
  return { text: o2.join(''), map: m2 };
}
/* テキスト座標 → 元のHTML座標 */
function arTextToHtml(T, pos){
  if (!T || !T.map || !T.map.length) return 0;
  var p = Math.max(0, Math.min(T.map.length - 1, pos | 0));
  return T.map[p];
}

/* =========================================================
   (1) 記事本文の範囲（他レース名が混ざる「関連情報」以降を除外）
   ========================================================= */
function arBodyRange(text){
  var t = String(text == null ? '' : text);
  var from = 0, to = t.length;
  /* 配信日時の直後からが本文（見出し・日付・view数・画像キャプションを飛ばす） */
  var dm = t.match(/\d{4}年\d{1,2}月\d{1,2}日[^\d]{0,14}\d{1,2}時\d{1,2}分/);
  if (dm) from = dm.index + dm[0].length;
  AR_BODY_ENDS.forEach(function(e){
    var p = t.indexOf(e, from);
    if (p >= 0 && p < to) to = p;
  });
  if (to <= from) { from = 0; to = t.length; }
  return { from: from, to: to };
}
/* 「レース後のコメント」以降（各馬の短評が並ぶ部分） */
function arCommentRange(text, body){
  var t = String(text == null ? '' : text);
  var p = t.indexOf('レース後のコメント', body.from);
  if (p >= 0 && p < body.to) return { from: p, to: body.to };
  var q = t.indexOf('レース後', body.from);
  if (q >= 0 && q < body.to) return { from: q, to: body.to };
  return { from: body.from, to: body.to };
}

/* =========================================================
   (2) レース検出
   ========================================================= */
function arRaceKey(r){
  if (r.rid) return 'r:' + r.rid;
  if (r.venue && r.rno) return 'v:' + r.venue + r.rno;
  if (r.name) return 'n:' + arNorm(r.name);
  return '';
}
function arGradeOf(s){
  var m = String(s || '').match(/(G\s*III|G\s*II|G\s*I|G\s*[123]|Ｇ\s*[１２３123]|Jpn\s*[123]|Ｊｐｎ\s*[123]|リステッド)/);
  if (!m) return '';
  return m[1].replace(/\s/g, '').replace(/Ｇ/g, 'G').replace(/Ｊｐｎ/g, 'Jpn')
    .replace(/III/g, 'III').replace(/II/g, 'II');
}
function arDistOf(s){
  var m = String(s || '').match(/(芝|ダート|ダ|障害)[\s　]*(\d{3,4})\s*m?/);
  if (!m) return '';
  return (m[1] === 'ダ' ? 'ダート' : m[1]) + m[2] + 'm';
}
/* 見出し・ナビの定型文をレース名と誤認しないための除外 */
function arIsBoilerplate(nm){
  var s = String(nm || '');
  if (s.length < 3) return true;
  if (/^(関連|新着|最新|おすすめ|アクセス|ランキング|注目|記事|ニュース|レース結果|払戻|オッズ|予想|出走表|出馬表|開催|前日|翌日|今日の|明日の|結果|速報|全着順|みんな)/.test(s)) return true;
  if (/(レース後|コメント|騎手ら|調教師ら|全着順|払戻金|フォト|写真|動画|を見る|一覧|検索|トップ)/.test(s)) return true;
  return false;
}

/* seg = 記事本文（テキスト）／base = 全体テキスト中の開始位置（at を全体座標に揃える） */
function arDetectRaces(seg, base, htmlAll, T){
  base = base || 0;
  var t = String(seg == null ? '' : seg);
  var list = [], byKey = {};
  function add(o){
    if (!o) return null;
    o.at = (o.at || 0) + base;
    o.rid = o.rid ? String(o.rid) : '';
    o.venue = o.venue || '';
    o.rno = o.rno ? parseInt(o.rno, 10) : 0;
    o.name = String(o.name || '').replace(/[\s　・、,，.。]/g, '').slice(0, 40);
    if (o.name && arIsBoilerplate(o.name)) o.name = '';
    o.grade = o.grade || '';
    o.dist = o.dist || '';
    /* race_id から分かるのは「R番号」だけ（場名・日付は復元できない） */
    if (o.rid && /^\d{12}$/.test(o.rid)){
      if (!o.rno) o.rno = parseInt(o.rid.slice(10, 12), 10);
      o.ym = o.rid.slice(0, 6);
    }
    var k = arRaceKey(o);
    if (!k) return null;
    if (byKey[k]){
      var e = byKey[k];
      if (!e.rid && o.rid) e.rid = o.rid;
      if (!e.name && o.name) e.name = o.name;
      if (!e.venue && o.venue) e.venue = o.venue;
      if (!e.rno && o.rno) e.rno = o.rno;
      if (!e.grade && o.grade) e.grade = o.grade;
      if (!e.dist && o.dist) e.dist = o.dist;
      if (o.at < e.at) e.at = o.at;
      if (e.via.indexOf(o.via) < 0) e.via += '+' + o.via;
      return e;
    }
    o.key = k; o.via = o.via || '';
    byKey[k] = o; list.push(o);
    return o;
  }
  function mergeInto(r, extra){
    if (!r) return null;
    if (extra.name && !r.name && !arIsBoilerplate(extra.name)) r.name = extra.name;
    if (extra.grade && !r.grade) r.grade = extra.grade;
    if (extra.dist && !r.dist) r.dist = extra.dist;
    if (extra.rid && !r.rid){ r.rid = extra.rid; }
    return r;
  }

  /* ② 場名 + N R（本文の主パターン: 「阪神11Rの第77回チャレンジカップ(3歳以上GIII・芝2000m)は…」） */
  var reV = new RegExp('(' + AR_VENUES.join('|') + ')[\\s　]*(\\d{1,2})[\\s　]*R', 'g'), mv;
  while ((mv = reV.exec(t)) !== null){
    var ahead = t.slice(mv.index + mv[0].length, mv.index + mv[0].length + 90);
    var r = add({ venue: mv[1], rno: mv[2], at: mv.index, via: 'venue' });
    if (!r) continue;
    /* ③ 直後の「第N回 レース名(条件・グレード・距離)」を読む */
    var m3 = /^の?[\s　]*第[\s　]*(\d{1,3})[\s　]*回[\s　]*([^\s　、。（(]{2,24})/.exec(ahead);
    var nm = '';
    if (m3){ nm = m3[2]; r.kai = parseInt(m3[1], 10); }
    else {
      var m3b = /^の?[\s　]*([^\s　、。（(は]{2,24})/.exec(ahead);
      if (m3b && !arIsBoilerplate(m3b[1])) nm = m3b[1];
    }
    mergeInto(r, { name: nm, grade: arGradeOf(ahead), dist: arDistOf(ahead) });
  }
  /* ②' 第 N R（場名が本文に無いケース） */
  var reN = /第[\s　]*(\d{1,2})[\s　]*R/g, mn;
  while ((mn = reN.exec(t)) !== null){
    var pre = t.slice(Math.max(0, mn.index - 8), mn.index);
    if (AR_VENUES.some(function(v){ return pre.indexOf(v) >= 0; })) continue;
    add({ rno: mn[1], at: mn.index, via: 'rno' });
  }
  /* ④ 【】見出し（「【小倉9R・西部スポニチ賞】」「【チャレンジCレース後コメント】」） */
  var reB = /【([^】]{2,60})】/g, mb;
  while ((mb = reB.exec(t)) !== null){
    var inner = mb[1];
    var m4 = new RegExp('(' + AR_VENUES.join('|') + ')[\\s　]*(\\d{1,2})[\\s　]*R[\\s　・]*([^\\s　]*)?').exec(inner);
    if (m4){
      var r4 = add({ venue: m4[1], rno: m4[2], at: mb.index, via: 'bracket' });
      if (r4) mergeInto(r4, { name: (m4[3] || '').replace(/レース後コメント|コメント/g, ''), grade: arGradeOf(inner) });
      continue;
    }
    var nm4 = inner.replace(/レース後コメント|レース後|コメント|結果|速報|全着順|払戻金?/g, '').trim();
    if (nm4 && !arIsBoilerplate(nm4)){
      var dup = list.some(function(x){ return x.name && arNorm(x.name) === arNorm(nm4); });
      if (!dup) add({ name: nm4, at: mb.index, grade: arGradeOf(inner), via: 'bracket' });
    }
  }
  /* ① race.netkeiba.com の結果・出馬表リンク → race_id
        ※ リンクは「関連情報」欄（本文の外）にも出るので**ページ全体**を走査し、
           検出したレースのうち一番近い位置のものと結びつけます。 */
  var rids = [];
  try {
    var hAll = String(htmlAll == null ? '' : htmlAll);
    /* ★ &amp; でエスケープされている（href="...?pid=race&amp;id=202609040311&amp;mode=result"）ので
         &amp; / & / ? のどれでも受け付けます。ここを取りこぼすと race_id が空になり、
         ④のネット補完が「レース名検索」回り道になってしまいます。 */
    var reL = /(?:race_id=|(?:&amp;|&|\?)id=)(\d{12})/gi, ml;
    while ((ml = reL.exec(hAll)) !== null){
      /* race.netkeiba.com 系だけ（db.netkeiba.com/horse/… 等を拾わない） */
      var ctxA = hAll.slice(Math.max(0, ml.index - 120), ml.index);
      if (!/race\.netkeiba\.com|race\.sp\.netkeiba\.com|pid=race/i.test(ctxA) && !/race_id=/i.test(ml[0])) continue;
      rids.push({ rid: ml[1], hpos: ml.index });
    }
  } catch(e){}
  if (rids.length && T && T.map){
    /* race_id のリンクは「関連情報」欄（本文の外）にまとめて並ぶことが多く、
       位置が近いだけで結びつけると**別のレースのIDを拾います**（複数レース記事で実測）。
       そこで
         (a) 検出レース数とrid数が一致するなら**文書順**で対応づけ
             （関連情報の並びは本文のレース順と同じため）
         (b) そのとき race_id 下2桁のR番号が検出したR番号と食い違う場合は**採用しない**
         (c) 数が合わなければ従来どおり最も近い位置のものへ
       とします。 */
    rids.sort(function(a, b){ return a.hpos - b.hpos; });
    function ridRno(rid){ return /^\d{12}$/.test(rid) ? parseInt(rid.slice(10, 12), 10) : 0; }
    function assign(r, rid){
      if (!r || r.rid) return false;
      var rn = ridRno(rid);
      if (r.rno && rn && rn !== r.rno) return false;    // R番号が食い違う＝別レース
      r.rid = rid; r.ym = rid.slice(0, 6);
      r.key = arRaceKey(r); byKey[r.key] = r;
      return true;
    }
    if (rids.length === list.length){
      rids.forEach(function(x, i){ assign(list[i], x.rid); });
    } else {
      rids.forEach(function(x){
        var tposAll = arHtmlToTextPos(T, x.hpos);
        if (tposAll == null) return;
        var tpos = tposAll - base;
        var best = null, bd = 1e9;
        list.forEach(function(r){
          if (r.rid) return;
          var d = Math.abs((r.at - base) - tpos);
          if (d < bd){ bd = d; best = r; }
        });
        if (best && assign(best, x.rid)) return;
        if (!list.length) add({ rid: x.rid, at: Math.max(0, tpos), via: 'rid' });
      });
    }
  }
  /* ⑤ レース名パターン（①〜④で1件も見つからなかったときの保険） */
  if (!list.length){
    var reNm = new RegExp('([\\u30A0-\\u30FF\\u4E00-\\u9FA5A-Za-z0-9]{2,24}?(?:' + AR_NAME_TAIL + '))', 'g'), mn2;
    while ((mn2 = reNm.exec(t)) !== null){
      if (arIsBoilerplate(mn2[1])) continue;
      var dup2 = list.some(function(x){ return x.name && arNorm(x.name) === arNorm(mn2[1]); });
      if (dup2) continue;
      add({ name: mn2[1], at: mn2.index, grade: arGradeOf(t.slice(mn2.index, mn2.index + 60)), via: 'name' });
      if (list.length >= 8) break;
    }
  }
  list.sort(function(a, b){ return a.at - b.at; });
  return list;
}
/* HTML座標 → テキスト全体座標（map は昇順なので二分探索） */
function arHtmlToTextPos(T, hpos){
  if (!T || !T.map || !T.map.length) return null;
  var lo = 0, hi = T.map.length - 1;
  if (hpos < T.map[0]) return 0;
  if (hpos > T.map[hi]) return hi;
  while (lo < hi){
    var mid = (lo + hi) >> 1;
    if (T.map[mid] < hpos) lo = mid + 1; else hi = mid;
  }
  return lo;
}
/* レースの表示ラベル */
function arRaceLabel(r){
  if (!r) return '';
  var head = (r.venue || '') + (r.rno ? r.rno + 'R' : '');
  var nm = r.name || '';
  var g = r.grade ? '(' + r.grade + ')' : '';
  var d = r.dist ? ' ' + r.dist : '';
  if (head && nm && arNorm(nm).indexOf(arNorm(head)) < 0) return head + ' ' + nm + g + d;
  if (head && nm) return head + g + d;
  if (head) return head + g + d;
  return nm + g + d;
}
/* 位置 at（テキスト全体座標）のコメントが属するレース＝直前の見出し */
function arRaceAt(races, at){
  if (!races || !races.length) return null;
  var best = null;
  for (var i = 0; i < races.length; i++){
    if (races[i].at <= at) best = races[i]; else break;
  }
  return best || races[0] || null;   // 冒頭にまとめ書きがあるケースは先頭を採用
}

/* =========================================================
   (3) 記事パース（レースごとのグループ化）
   ========================================================= */
/* cutAts: ここで強制的にブロックを打ち切る位置（＝次のレース見出しの位置）。
   これを入れないと、あるレースの最後の馬の短評に**次のレースの概要文**が
   まるごと混ざります（「3着 …でした」 阪神10Rのローズステークス(3歳GII…」）。 */
function arSplitBlocks(text, from, to, cutAts){
  var t = String(text == null ? '' : text);
  var pos = [], re = /(\d{1,2})[\s　]*着/g, m;
  re.lastIndex = Math.max(0, from | 0);
  while ((m = re.exec(t)) !== null){
    if (m.index >= to) break;
    pos.push({ at: m.index, order: parseInt(m[1], 10) });
  }
  var cuts = (cutAts || []).filter(function(c){ return c > from && c < to; }).sort(function(a, b){ return a - b; });
  return pos.map(function(p, i){
    var nx = (i + 1 < pos.length) ? pos[i + 1].at : to;
    for (var k = 0; k < cuts.length; k++){ if (cuts[k] > p.at && cuts[k] < nx){ nx = cuts[k]; break; } }
    return { at: p.at, order: p.order, to: nx };
  });
}
/* 記事HTML → { races, entries, groups, body, dateText, title } */
function arParseArticle(html){
  var segW = arWide(html);
  var T = arToText(segW);
  var body = arBodyRange(T.text);
  var races = arDetectRaces(T.text.slice(body.from, body.to), body.from, segW, T);
  var cm = arCommentRange(T.text, body);
  /* 各レース見出しの位置を「ブロックの打ち切り点」として渡す */
  var cutAts = races.map(function(r){ return r.at; });
  var blocks = arSplitBlocks(T.text, cm.from, cm.to, cutAts);
  var entries = [];
  blocks.forEach(function(b){
    if (b.to - b.at < 4) return;
    /* テキスト座標 → 元のHTML座標に戻して切り出す（馬名リンクから競走馬IDを取るため） */
    var h0 = arTextToHtml(T, b.at);
    var h1 = (b.to < T.map.length) ? arTextToHtml(T, b.to) : segW.length;
    /* ★ 末尾を余分に足さないこと。足すと次の「N着」ブロックの本文まで巻き込んで
         5着の短評に「8着同着 ピースワン…」が混ざります（実物記事で確認済み）。 */
    var span = segW.slice(h0, Math.min(segW.length, Math.max(h1, h0 + 4)));
    var ent = null;
    try { ent = (typeof hbExtractCommentBlock === 'function') ? hbExtractCommentBlock(span, b.order) : null; } catch(e){}
    if (!ent) return;
    ent.at = b.at;
    ent.race = arRaceAt(races, b.at);
    ent.raceLabel = arRaceLabel(ent.race);
    entries.push(ent);
  });
  /* 同じ馬が同じ着順で二重に拾われたら1件に */
  var seen = {}, uniq = [];
  entries.forEach(function(e){
    var k = arNorm(e.name) + '|' + e.order + '|' + (e.race ? arRaceKey(e.race) : '');
    if (seen[k]) return;
    seen[k] = 1; uniq.push(e);
  });
  /* レースごとにグループ化 */
  var groups = [], gmap = {};
  uniq.forEach(function(e){
    var k = e.race ? arRaceKey(e.race) : '(none)';
    if (!gmap[k]){
      gmap[k] = { race: e.race || null, label: e.race ? arRaceLabel(e.race) : '（レース名の検出なし）', entries: [] };
      groups.push(gmap[k]);
    }
    gmap[k].entries.push(e);
  });
  /* 記事の配信日 */
  var dateText = '';
  var dm = T.text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (dm) dateText = dm[1] + '年' + parseInt(dm[2], 10) + '月' + parseInt(dm[3], 10) + '日';
  var title = '';
  try { title = (typeof hbPageTitle === 'function') ? hbPageTitle(segW) : ''; } catch(e){}
  return { races: races, entries: uniq, groups: groups, body: body, dateText: dateText, title: title, T: T };
}

/* =========================================================
   (4) 該当馬の横断検索（通信ゼロ）
   ========================================================= */
var AR_PRIO = { cur: 4, card: 3, learn: 2, book: 1, net: 5 };
function arIdxReset(){ AR_STATE.idx = null; AR_STATE.idxAt = 0; }
function arBuildIndex(force){
  if (!force && AR_STATE.idx && (Date.now() - AR_STATE.idxAt) < AR_IDX_TTL) return AR_STATE.idx;
  var idx = { byNk: {}, byName: {}, stat: { cur: 0, card: 0, learn: 0, book: 0 } };
  function put(o){
    if (!o || !o.name) return;
    var nk = o.nk ? String(o.nk) : '';
    var nm = arNorm(o.name);
    if (!nm) return;
    function set(map, key){
      if (!key) return;
      var ex = map[key];
      if (!ex || (AR_PRIO[o.src] || 0) > (AR_PRIO[ex.src] || 0)) map[key] = o;
    }
    set(idx.byName, nm);
    if (nk) set(idx.byNk, nk);
    idx.stat[o.src] = (idx.stat[o.src] || 0) + 1;
  }
  /* ① 今開いている出馬表 */
  try {
    var hs = (typeof state !== 'undefined' && state && state.horses) ? state.horses : [];
    var curRace = '';
    try { curRace = (typeof hbCurRaceName === 'function') ? hbCurRaceName() : ''; } catch(e){}
    hs.forEach(function(h){
      if (!h || !h.name) return;
      put({ name: h.name, nk: h.nk || '', no: h.no || '', src: 'cur',
            raceId: (typeof state !== 'undefined' && state.raceId) || '', raceName: curRace, uid: h.uid });
    });
  } catch(e){}
  /* ② 出馬表キャッシュ（第21弾①・直近40レースぶん） */
  try {
    if (typeof nkCardLs === 'function' && typeof nkCardGet === 'function' && typeof nkParseShutuba === 'function'){
      var o = nkCardLs() || {};
      Object.keys(o.h || {}).forEach(function(rid){
        var c = o.h[rid];
        var html = '';
        try { html = nkCardGet(rid) || ''; } catch(e){}
        if (!html) return;
        var rows = [];
        try { rows = nkParseShutuba(html) || []; } catch(e){}
        rows.forEach(function(r){
          if (!r || !r.name) return;
          put({ name: r.name, nk: r.nk || '', no: r.no || '', src: 'card', raceId: rid,
                raceName: (c && c.name) || '', d8: (c && c.d8) || '' });
        });
      });
    }
  } catch(e){}
  /* ③ 学習DB（過去に取り込んだ全レースの出走馬） */
  try {
    if (typeof apScan === 'function'){
      var recs = apScan() || {};
      Object.keys(recs).forEach(function(rid){
        var rec = recs[rid];
        if (!rec) return;
        var rname = (rec.meta && rec.meta.name) || '';
        var d8 = (rec.meta && rec.meta.date8) || '';
        (rec.predHorses || []).forEach(function(x){
          if (x && x.name) put({ name: x.name, nk: x.nk || '', no: x.no || '', src: 'learn', raceId: rid, raceName: rname, d8: d8 });
        });
        if (rec.result && rec.result.rows){
          rec.result.rows.forEach(function(x){
            if (x && x.name) put({ name: x.name, nk: '', no: x.no || '', src: 'learn', raceId: rid, raceName: rname, d8: d8 });
          });
        }
      });
    }
  } catch(e){}
  /* ④ 馬ノートDB */
  try {
    if (typeof hbLoad === 'function'){
      (hbLoad().horses || []).forEach(function(e){
        (e.names || []).forEach(function(nm){
          put({ name: nm, nk: e.nk || '', no: '', src: 'book', raceId: '', raceName: '', eid: e.id });
        });
      });
    }
  } catch(e){}
  AR_STATE.idx = idx; AR_STATE.idxAt = Date.now();
  return idx;
}
function arFind(name, nk){
  var idx = arBuildIndex(false);
  var nkS = nk ? String(nk) : '';
  if (nkS && idx.byNk[nkS]) return idx.byNk[nkS];
  var nm = arNorm(name);
  if (nm && idx.byName[nm]) return idx.byName[nm];
  /* 部分一致（記事側の表記ゆれ対策・長い馬名を先に） */
  if (nm && nm.length >= 4){
    var keys = Object.keys(idx.byName).sort(function(a, b){ return b.length - a.length; });
    for (var i = 0; i < keys.length; i++){
      var k = keys[i];
      if (k.length >= 4 && (k.indexOf(nm) >= 0 || nm.indexOf(k) >= 0)) return idx.byName[k];
    }
  }
  return null;
}
function arSrcLabel(src){
  return ({ cur: '✅ 今の出馬表', card: '💾 出馬表キャッシュ', learn: '📚 学習DB',
           book: '📒 馬ノート', net: '🌐 netkeiba取得', 'new': '🆕 記事から新規' })[src] || src || '';
}
/* 検索範囲の内訳（表示用） */
function arIndexStat(){
  var idx = arBuildIndex(false);
  var s = idx.stat || {};
  return '検索範囲: 今の出馬表 ' + (s.cur || 0) + '頭／出馬表キャッシュ ' + (s.card || 0) +
         '頭／学習DB ' + (s.learn || 0) + '頭／馬ノート ' + (s.book || 0) + '頭';
}

/* =========================================================
   (5) ローカルで見つからなかったレースだけ netkeiba から取りに行く
   ========================================================= */
function arNeedOnline(groups, opt){
  var out = [], seen = {};
  (groups || []).forEach(function(g){
    if (!g.race) return;
    var allMiss = (g.entries || []).length > 0 && (g.entries || []).every(function(e){ return !arFind(e.name, e.nk); });
    if (!allMiss) return;
    var k = arRaceKey(g.race);
    if (seen[k]) return;
    seen[k] = 1; out.push(g.race);
  });
  return out.slice(0, (opt && opt.cap) || 6);
}
/* レース名 → race_id（rsSearch・第11弾。localStorage キャッシュつき） */
function arRidByName(name, year){
  if (typeof rsSearch !== 'function' || !name) return Promise.resolve('');
  return rsSearch(year, name).then(function(got){
    var ms = ((got && got.matches) || []).filter(function(x){ return !x.none && x.rid; });
    if (!ms.length) return '';
    ms.sort(function(a, b){ return String(b.dateRaw || '').localeCompare(String(a.dateRaw || '')); });
    return ms[0].rid;
  }).catch(function(){ return ''; });
}
/* 未取得ぶんを取りに行く（同時実行数は2に抑える） */
function arResolveOnline(races, opt){
  opt = opt || {};
  var year = opt.year || new Date().getFullYear();
  var todo = (races || []).slice();
  var done = 0, fail = 0, added = [];
  function one(r){
    var p = r.rid ? Promise.resolve(r.rid) : (r.name ? arRidByName(r.name, year) : Promise.resolve(''));
    return p.then(function(rid){
      if (!rid){ fail++; return null; }
      if (!r.rid){ r.rid = rid; r.key = arRaceKey(r); }
      if (typeof nkFetchCardText !== 'function'){ fail++; return null; }
      return nkFetchCardText(rid, {}).then(function(html){
        var rows = [];
        try { rows = (typeof nkParseShutuba === 'function') ? (nkParseShutuba(html) || []) : []; } catch(e){}
        if (!rows.length){ fail++; return null; }
        done++; added.push({ race: r, n: rows.length });
        return rows.length;
      }).catch(function(){ fail++; return null; });
    }).catch(function(){ fail++; return null; });
  }
  var i = 0;
  function pump(){
    var batch = [];
    for (var k = 0; k < 2 && i < todo.length; k++) batch.push(one(todo[i++]));
    if (!batch.length) return Promise.resolve();
    return Promise.all(batch).then(pump);
  }
  return pump().then(function(){
    arIdxReset(); arBuildIndex(true);       // 取れたぶんをインデックスに反映
    AR_STATE.net.done += done; AR_STATE.net.fail += fail;
    return { done: done, fail: fail, added: added };
  });
}

/* =========================================================
   (6) 今回の出走外で見つかった馬をプルダウンに出す（xref）
   ========================================================= */
function arXrefReset(){ AR_STATE.xref = []; }
function arXrefAdd(o){
  if (!o || !o.name) return '';
  var nm = arNorm(o.name);
  for (var i = 0; i < AR_STATE.xref.length; i++){
    var x = AR_STATE.xref[i];
    if (arNorm(x.name) === nm && String(x.nk || '') === String(o.nk || '')) return 'x' + i;
  }
  AR_STATE.xref.push({
    name: o.name, nk: o.nk || '', no: o.no || '', src: o.src || 'ref',
    raceId: o.raceId || '', raceName: o.raceName || '', raceLabel: o.raceLabel || ''
  });
  return 'x' + (AR_STATE.xref.length - 1);
}
function arXrefGet(i){ return AR_STATE.xref[parseInt(i, 10)] || null; }
function arXrefList(){ return AR_STATE.xref.slice(); }

/* 記事の1エントリ → 割当値（u<n> / n<name> / e<id> / x<n>）
   ★ まず p25 の hbResolveTargetVal（今の出馬表＋馬ノート）で決め、
     決まらなければ横断検索 → それでも無ければ「記事から新規登録」にします。 */
function arResolveEntryVal(en){
  var base = '';
  try { base = (typeof hbResolveTargetVal === 'function') ? (hbResolveTargetVal(en.name, en.nk) || '') : ''; } catch(e){}
  if (base) return { val: base, src: (base.charAt(0) === 'e' ? 'book' : 'cur'), found: null };
  var hit = arFind(en.name, en.nk);
  if (hit){
    if (hit.eid) return { val: 'e' + hit.eid, src: hit.src, found: hit };
    return { val: arXrefAdd({ name: hit.name, nk: hit.nk, no: hit.no, src: hit.src,
                              raceId: hit.raceId, raceName: hit.raceName, raceLabel: en.raceLabel || '' }),
             src: hit.src, found: hit };
  }
  return { val: arXrefAdd({ name: en.name, nk: en.nk || '', no: '', src: 'new', raceLabel: en.raceLabel || '' }),
           src: 'new', found: null };
}
/* 短評に付記する「登録先レース情報」（検出したレース名を優先） */
function arNoteRaceLabel(en){
  /* ★ 表示ラベル(arRaceLabel)と同じ組み立てにする。別に組むと「阪神 11R」のように
     場名とR番号の間に空白が入って、画面表示と保存される付記が食い違います。 */
  var base = (en && en.race) ? arRaceLabel(en.race) : ((en && en.raceLabel) || '');
  if (!base) return '';
  return base + '（netkeiba レース後コメント）';
}
/* 記事エントリ一覧 → 割当表の行（レースごとの ctx つき） */
function arEntriesToRows(entries, dateText){
  return (entries || []).map(function(en){
    var rv = arResolveEntryVal(en);
    /* レース名は割当表の「🏁 レース区切り見出し」で出すので、行ラベルには繰り返しません */
    var label = en.order + '着　' + en.name + (en.jockey ? '（' + en.jockey + '）' : '');
    var text = (en.order ? en.order + '着 ' : '') + (en.jockey ? en.jockey + '：' : '') + en.text;
    return {
      text: text, val: rv.val, label: label, hit: null,
      src: rv.src, found: rv.found,
      raceLabel: en.raceLabel || '', raceName: (en.race && en.race.name) || '',
      raceId: (en.race && en.race.rid) || '', raceGrade: (en.race && en.race.grade) || '',
      name: en.name, nk: en.nk || '', order: en.order,
      ctx: { date: dateText || '', label: arNoteRaceLabel(en), fromNews: true }
    };
  });
}

/* =========================================================
   表示用
   ========================================================= */
function arRacesSummary(races){
  if (!races || !races.length) return '🏁 レース名の検出: <b>0</b> 件';
  var withRid = races.filter(function(r){ return r.rid; }).length;
  return '🏁 レース名の検出: <b>' + races.length + '</b> 件' +
    (withRid ? '（うち race_id 判明 ' + withRid + ' 件）' : '') + '　' +
    races.slice(0, 6).map(function(r){ return arEsc(arRaceLabel(r) || '（名称不明）'); }).join('／') +
    (races.length > 6 ? ' ほか' + (races.length - 6) + '件' : '');
}
function arGroupsHTML(groups){
  return (groups || []).map(function(g){
    var rows = (g.entries || []).map(function(en){
      var rv = arResolveEntryVal(en);
      var who = rv.found ? rv.found.name : en.name;
      var tgt = (rv.src === 'new')
        ? '<span style="color:var(--warn-ink);font-weight:700">🆕 該当データなし → 記事の馬名・競走馬IDで新規登録できます</span>'
        : '<span style="color:var(--ok-ink);font-weight:700">✓ ' + arSrcLabel(rv.src) + ': ' + arEsc(who) + '</span>';
      return '<div style="border:1px solid var(--line);border-radius:8px;padding:6px 9px;margin:4px 0;background:var(--card)">' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:.82rem">' +
        '<b>' + arEsc(en.order) + '着</b>　<b>' + arEsc(en.name) + '</b>' +
        (en.jockey ? '<span class="small muted">(' + arEsc(en.jockey) + ')</span>' : '') + '　' + tgt + '</div>' +
        '<div style="margin-top:3px;font-size:.84rem;white-space:pre-wrap">' + arEsc(en.text) + '</div></div>';
    }).join('');
    return '<div style="margin:8px 0 4px">' +
      '<div style="font-weight:800;font-size:.86rem;border-left:3px solid var(--accent);padding-left:6px">' +
      '🏁 ' + arEsc(g.label) + '　<span class="small muted">' + (g.entries || []).length + '頭ぶん</span></div>' + rows + '</div>';
  }).join('');
}
