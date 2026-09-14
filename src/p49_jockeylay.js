/* =========================================================
   p49_jockeylay.js — 騎手成績・乗り替わり・休養・鉄砲・2走目
   （#2026-09-12 第16弾）

   出馬表の「騎手」と「単勝」の間に出す情報を、
   ★ 馬柱（netkeiba 競走馬の戦績）から計算します。
     戦績は ① の「🐎 全馬プロフィール」で取得したときに
     localStorage(keiba_nk_v1) へ入っている recs をそのまま使うので、
     この表示のために追加の通信は発生しません。

   定義（netkeiba 競馬新聞の表示と一致することを
        2026-09-12 阪神11R チャレンジC(G3) の実データで検証済み）:

   ・中N週    = floor((日数 - 1) / 7)
                例: 76日 → 中10週 / 98日 → 中13週 / 62日 → 中8週
   ・○ヶ月休養 = floor(日数 / 30.44)  （90日以上のとき表示）
                例: 98日 → 3ヵ月休養
   ・鉄砲     = 90日（3ヶ月）以上の休み明け【初戦】の成績 [1着.2着.3着.着外]
                例: フィーリウス [0.0.0.1] / ジーティーダーリン [2.0.0.1]
   ・2走目    = 鉄砲のレースの【直後の1戦】の成績
                例: フィーリウス [0.0.0.0] / ジーティーダーリン [1.0.0.1]
   ・騎手成績 = 全戦績で「今回の騎手」が乗ったときの成績
                例: ガイアメンテ×武豊 [1.0.0.1]（netkeiba表示 1-0-0-1 と一致）
   ・乗り替わり = 前走の騎手 ≠ 今回の騎手（netkeiba の「替」マーク相当）
   ・初騎乗   = 今回の騎手がこの馬に一度も乗ったことがない

   ※ デビュー戦（前走が無い）は鉄砲に数えません。
   ========================================================= */

var JL_LAYOFF_DAYS = 90;    // 鉄砲＝90日(3ヶ月)以上の休み明け初戦
var JL_MONTH_DAYS = 30.44;  // 1ヶ月＝30.44日（平均）

/* '2026/06/28' / '2026-06-28' / '20260628' → '20260628'（取れなければ ''） */
function jlD8(s){
  var t = String(s == null ? '' : s).replace(/\s+/g, '');
  var m = t.match(/(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (m) return m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2);
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? t : '';
}
/* '20260628' → Date（UTCではなくローカル0時） */
function jlDate(d8){
  var s = jlD8(d8);
  if (!s) return null;
  return new Date(parseInt(s.slice(0, 4), 10), parseInt(s.slice(4, 6), 10) - 1, parseInt(s.slice(6, 8), 10));
}
/* 日数差（b - a）。どちらかが不正なら null */
function jlDays(a, b){
  var da = jlDate(a), db = jlDate(b);
  if (!da || !db) return null;
  return Math.round((db - da) / 86400000);
}
/* 中N週（netkeiba 方式: 丁度14週なら「中13週」） */
function jlWeeks(days){
  if (!(days > 0)) return 0;
  return Math.floor((days - 1) / 7);
}
/* ○ヶ月（floor） */
function jlMonths(days){
  if (!(days > 0)) return 0;
  return Math.floor(days / JL_MONTH_DAYS);
}
/* 休み明け（鉄砲）かどうか */
function jlIsLayoff(days){
  return (days != null) && days >= JL_LAYOFF_DAYS;
}

/* 騎手名の正規化。netkeiba は新聞で略称（松本大輝→松本、Ｍデムーロ→Ｍデム）を使うので、
   全角英字・中黒・スペース・点を取って「前方一致」で比べられるようにします。 */
function jlNormJ(name){
  return String(name == null ? '' : name)
    .replace(/[Ａ-Ｚａ-ｚ]/g, function(c){ return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[\s\u3000・．.、,]/g, '')
    .replace(/^J\./i, '')
    .trim();
}
/* 騎手が同じ人かどうか（略称対応・前方一致。2文字未満は照合しない） */
function jlSameJ(a, b){
  var x = jlNormJ(a), y = jlNormJ(b);
  if (!x || !y) return false;
  if (x === y) return true;
  var s = x.length <= y.length ? x : y;
  var l = x.length <= y.length ? y : x;
  if (s.length < 2) return false;
  return l.indexOf(s) === 0;
}

/* 着順リスト → [1着, 2着, 3着, 着外]（中止・取消・除外は数えない） */
function jlRec4(orders){
  var r = [0, 0, 0, 0];
  (orders || []).forEach(function(o){
    var n = parseInt(o, 10);
    if (!isFinite(n) || n < 1) return;             // 0/空/中止 → 集計しない
    if (n === 1) r[0]++; else if (n === 2) r[1]++; else if (n === 3) r[2]++; else r[3]++;
  });
  return r;
}
/* [1,0,0,1] → '1.0.0.1' */
function jlRecTxt(r){ return (r || [0,0,0,0]).join('.'); }
/* [1,0,0,1] → '1-0-0-1'（netkeiba 新聞の表記） */
function jlRecDash(r){ return (r || [0,0,0,0]).join('-'); }
function jlRecTotal(r){ return (r || []).reduce(function(a, b){ return a + (b || 0); }, 0); }

/* 戦績を「古い順」に並べ替えたコピーを返す（元は壊しません）。
   日付の取れない行は末尾へ。 */
function jlSortRecs(recs){
  var rows = (recs || []).slice();
  rows.sort(function(a, b){
    var x = jlD8(a && a.date), y = jlD8(b && b.date);
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return x.localeCompare(y);
  });
  return rows;
}

/* ★ 本体：戦績 recs から今回のレース向けの情報を計算する。
   recs   : hdParseRecords() の行（date / order / jockey / name …）
   raceD8 : 今回のレース日（'20260912' など。無ければ未来の日付として全戦績を対象に）
   jockey : 今回の騎手名（出馬表の値）
   → {
       has, prevDate, gapDays, weeks, months, layoff, second,   // 今回の間隔
       tettepo:[..], tettepoN, secondRec:[..], secondRecN,      // 鉄砲／2走目の成績
       jFit:[..], jFitN, firstRide, changed, prevJockey,        // 騎手
       layoffLabel, show                                        // 表示用
     } */
function jlAnalyze(recs, raceD8, jockey){
  var out = {
    has: false, prevDate: '', gapDays: null, weeks: 0, months: 0, layoff: false, second: false,
    tettepo: [0,0,0,0], tettepoN: 0, secondRec: [0,0,0,0], secondRecN: 0,
    jFit: [0,0,0,0], jFitN: 0, firstRide: false, changed: false, prevJockey: '',
    layoffLabel: '', show: false, curIsTettepo: false, curIsSecond: false, races: 0
  };
  var rows = jlSortRecs(recs);
  var cur = jlD8(raceD8);
  // 今回のレースより前の戦績だけを対象にする
  var past = cur ? rows.filter(function(r){ var d = jlD8(r && r.date); return d && d < cur; }) : rows;
  out.races = past.length;
  if (!past.length) return out;
  out.has = true;

  // --- 鉄砲／2走目の集計（過去戦績の中だけで完結させる。今回はまだ走っていないので数えない） ---
  var tet = [], sec = [];
  for (var i = 1; i < past.length; i++){
    var g = jlDays(past[i - 1].date, past[i].date);
    if (jlIsLayoff(g)){
      tet.push(past[i].order || 0);
      if (past[i + 1]) sec.push(past[i + 1].order || 0);   // 鉄砲の直後の1戦＝2走目
    }
  }
  out.tettepo = jlRec4(tet);
  out.tettepoN = tet.length;
  out.secondRec = jlRec4(sec);
  out.secondRecN = sec.length;

  // --- 今回の間隔 ---
  var last = past[past.length - 1];
  out.prevDate = jlD8(last.date);
  out.prevJockey = String(last.jockey || '');
  if (cur){
    out.gapDays = jlDays(last.date, cur);
    out.weeks = jlWeeks(out.gapDays);
    out.months = jlMonths(out.gapDays);
    out.layoff = jlIsLayoff(out.gapDays);
    // 前走が鉄砲だった → 今回が「2走目」
    if (past.length >= 2){
      var gp = jlDays(past[past.length - 2].date, last.date);
      out.second = jlIsLayoff(gp);
    }
  }
  out.curIsTettepo = out.layoff;
  out.curIsSecond = out.second;
  out.layoffLabel = out.layoff ? (out.months + 'ヵ月休養') : '';

  // --- 騎手 ---
  if (jockey){
    var mine = past.filter(function(r){ return jlSameJ(r.jockey, jockey); }).map(function(r){ return r.order || 0; });
    out.jFit = jlRec4(mine);
    out.jFitN = mine.length;
    out.firstRide = out.jFitN === 0;
    out.changed = !!(out.prevJockey && !jlSameJ(out.prevJockey, jockey));
  }

  // 表示するのは「今回が休み明け初戦」または「今回が2走目」のとき（netkeiba 新聞と同じ）
  out.show = out.layoff || out.second;
  return out;
}

/* 表示用HTML（出馬表の「騎手」と「単勝」の間に入る1セルぶん）。
   間隔が空いていない馬は空文字を返します（＝何も出さない）。 */
function jlHTML(info){
  if (!info || !info.has) return '';
  var h = [];
  if (info.show){
    if (info.layoff){
      h.push('<span class="jlay lay" title="前走から ' + info.gapDays + '日（中' + info.weeks + '週）の休み明け＝今回が鉄砲（休み明け初戦）です。' +
        '過去の鉄砲成績は ' + jlRecTxt(info.tettepo) + '（' + info.tettepoN + '戦）です。">🛌 <b>' + info.months + 'ヵ月休養</b></span>');
    } else if (info.second){
      h.push('<span class="jlay sec" title="前走が休み明け初戦（鉄砲）だったので、今回が休み明け2走目です。中' + info.weeks + '週。' +
        '過去の2走目成績は ' + jlRecTxt(info.secondRec) + '（' + info.secondRecN + '戦）です。">🔁 <b>2走目</b><span class="mut">中' + info.weeks + '週</span></span>');
    }
    h.push('<span class="jlay rec" title="鉄砲＝90日（3ヶ月）以上の休み明け初戦の成績／2走目＝その直後の1戦の成績（1着.2着.3着.着外）">' +
      '鉄砲 <b>' + jlRecTxt(info.tettepo) + '</b>　2走目 <b>' + jlRecTxt(info.secondRec) + '</b></span>');
  }
  return h.length ? '<span class="jlaywrap">' + h.join('') + '</span>' : '';
}

/* 騎手セルの下に出す1行（乗り替わり＋その騎手での成績）。未取得なら注意文。 */
function jlJockeyHTML(info, hasRecs){
  if (!info || !info.has){
    return hasRecs === false
      ? '<span class="jlay none" title="この馬の戦績がまだありません。①の「🐎 全馬プロフィール」で取得すると、騎手成績・乗り替わり・休養・鉄砲が表示されます">未取得</span>'
      : '';
  }
  var h = [];
  if (info.jockey === undefined){ /* 呼び出し側で jockey を渡していない場合は何もしない */ }
  if (info.changed) h.push('<span class="jlay chg" title="前走（' + (info.prevJockey || '?') + '）から騎手が替わっています">替</span>');
  if (info.firstRide) h.push('<span class="jlay first" title="この騎手がこの馬に乗るのは初めてです">初騎乗</span>');
  else if (info.jFitN) h.push('<span class="jlay jfit" title="この騎手がこの馬に乗ったときの成績（1着-2着-3着-着外・全' + info.jFitN + '戦）">' + jlRecDash(info.jFit) + '</span>');
  return h.length ? '<span class="jlaywrap">' + h.join('') + '</span>' : '';
}


/* ---------- 今回のレース日 ---------- */
/* 実際の今日（YYYYMMDD） */
function jlTodayD8(){
  var d = new Date();
  return '' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
}
/* 今回のレース日。state.raceDate8 があればそれ、無ければ今日。
   ★ netkeiba の race_id は「年+場コード+回+日+R」で【日付ではない】ため、
     race_id から8桁を切り出すと別の日付になります（旧 nkTodayD8() の不具合）。 */
function jlRaceD8(){
  try {
    if (typeof state !== 'undefined' && state && state.raceDate8){
      var d = jlD8(state.raceDate8);
      if (d) return d;
    }
  } catch(e){}
  /* ★2026-09-13 第19弾③: state.raceDate8 が未設定のときは、レース名に入っている日付を使う。
     applyNkRaceMeta が「2026年9月13日 中山11R …」の形で作るので、そこから拾えます。
     これが無いと jlRaceD8() は「今日」を返し、過去レースで
     ・前走（上3F・持ちタイム）の絞り込み日がずれる
     ・乗り替わり／○ヶ月休養／鉄砲の判定日がずれる
     という不具合になります。 */
  var dn = jlD8FromRaceName();
  if (dn) return dn;
  return jlTodayD8();
}
/* レース名（state.race.name）から開催日 8桁を探す。無ければ '' */
function jlD8FromRaceName(){
  try {
    if (typeof state === 'undefined' || !state || !state.race) return '';
    var nm = String(state.race.name || '');
    if (!nm) return '';
    var m = nm.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (m) return m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2);
    m = nm.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (m) return m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2);
  } catch(e){}
  return '';
}
/* 馬柱キャッシュ（① の「🐎 全馬プロフィール」で取得したもの）から戦績を取り出す。
   未取得なら null。この表示のための追加通信はしません。 */
function jlCacheRecs(id){
  id = String(id || '');
  if (!id) return null;
  try {
    if (typeof nkLs !== 'function') return null;
    var ls = nkLs() || {};
    var hit = ls.h && ls.h[id];
    if (hit && hit.recs && hit.recs.length) return hit.recs;
  } catch(e){}
  return null;
}

/* 出馬表の1頭ぶんをまとめて作る（p6_inputui から呼ぶ）。
   getRecs(競走馬ID) で戦績をもらう＝未取得なら null。 */
function jlInfoFor(h, raceD8, getRecs){
  var id = String((h && (h.nk || h.nkid)) || '');
  var recs = null;
  try { recs = (typeof getRecs === 'function') ? getRecs(id, h) : jlCacheRecs(id); } catch(e){ recs = null; }
  if (!recs || !recs.length) return { has: false, noRecs: true };
  var info = jlAnalyze(recs, raceD8, h && h.jockey);
  info.noRecs = false;
  info.id = id;
  return info;
}
