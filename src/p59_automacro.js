/* =========================================================
   p59_automacro.js — 🤖 自動マクロ（手数を減らす）
   （#2026-09-13 第20弾）

   やることは4つ。全部「ON/OFFできる・勝手に暴走しない・同じことを2回やらない」を守ります。

   (A) 日付からレースを選んだら、**選んでいない他のレースも自動で検出**する
       → ①「📥 その日の出馬表を一括取得」(p53 preDayFetch) を裏で実行し、
         その日の全レースの事前予想(rec.pre)を保存します。
         💰回収率チューナー(p58)は rec.pre × 結果 が無いと測れないので、
         これを自動にしておくと「回収率を測るためにわざわざ一括取得する」手間が消えます。
         すでに事前予想があるレース・結果が確定しているレースは必ずスキップします（いかさま防止）。

   (B) 出馬表＋オッズの取得に**紐づけて**、
       「🧾 全馬のプロフィール・戦績・成績分析」→「📡 全馬に前走の上3F・タイムを自動反映」
       を**マクロのように自動実行**する
       → ①「📥 出馬表の全馬データを取得・表示」(p34 hdLoadAll)
         → ①「🐎 全馬に前走の上3F・タイムを自動反映」(p40 nkFetchAll) の順に連鎖させます。
       ★ 通信回数を半分に: p34(khl_hd_v1) と p40(keiba_nk_v1) は同じURL・同じパーサなのに
         キャッシュが別でした。p40 側が p34 のキャッシュを写して使うようにしたので、
         マクロで両方走らせても 1頭あたり 1回の取得で済みます（p40 nkFetchHorsePages）。

   (C) **結果が確定していない開催週の出馬表は、その週の水曜日に自動で消す**
       → 毎週 localStorage が膨らんで「💾 保存領域がいっぱい」になるのを防ぎます。
         過去レースは学習DB(diLs)からいつでも取り込み直せるので、消して問題ありません。
         結果と照合済み（rec.result がある＝学習に使う）レコードは**絶対に消しません**。

   (D) 重賞カレンダーでレースを選んだら「📥 この重賞の過去10年を分析」が自动で走り、
       **分析が終わり次第「🧬 血統ファクターの抽出」も自动で走る**
       → 📅カレンダーのクリックはすでに drAnalyzeRid → drFinishRun まで自動です。
         ここでは drFinishRun の直後に bfRunExtract() を連鎖させます。

   ---------------------------------------------------------
   ★ 実行順の注意
   (B) と (A) は両方 state.horses を触ります。(A) の preDayFetch は preWithState() で
   state を一時差し替えするので、**必ず (B) が終わってから (A)** を動かします（直列）。
   ========================================================= */

var AM_LS = 'khl_am_v1';
var AM_DEF = {
  dayAll: true,      // (A) 選んだ日付の他のレースも自動検出
  horse: true,       // (B) 全馬データ → 上3F・前走タイム の自動マクロ
  style: true,       // (B2) ★第21弾②: 脚質のAI推定も同じマクロに紐づける（通信ゼロ・キャッシュ利用）
  detail: false,     // (A) のときに各馬の馬柱も取るか（時間がかかるので既定OFF。Bで取るので不要）
  weekClean: true,   // (C) 未確定の開催週データを水曜日に自動削除
  biasClean: true,   // (C2) ★第21弾④: トラックバイアスの記録も水曜日に削除（学習DB側に確定データが残る）
  drChain: true,     // (D) ⑥の分析が終わったら血統抽出を自動で続ける
  biasAuto: true,    // (E) ★第21弾④: 開催日に発走時刻＋12分ごとにトラックバイアスを自動取得
  wtAuto: true,      // (F) ★第21弾⑤: 重みをレースごとにAIが自動補正する（スライダーは動かさない）
  lastClean: '',     // 最後に掃除した日（同じ日に何度も走らせない）
  lastBiasDay: ''    // 最後にトラックバイアスの締め取得をした日
};
var AM_BUSY = { horse: false, day: false, bf: false, bias: false };
/* 設定☑と state キーの対応（UI生成・同期・初期化の3か所で同じ表を使う） */
var AM_PAIRS = [
  ['amChkDay','dayAll'], ['amChkHorse','horse'], ['amChkStyle','style'], ['amChkDetail','detail'],
  ['amChkClean','weekClean'], ['amChkBiasClean','biasClean'], ['amChkBias','biasAuto'],
  ['amChkDr','drChain'], ['amChkWt','wtAuto']
];
var AM_KEYS = ['dayAll','horse','style','weekClean','biasClean','biasAuto','drChain','wtAuto'];

function amLs(){
  try {
    var o = JSON.parse(localStorage.getItem(AM_LS) || 'null');
    if (!o || typeof o !== 'object') o = {};
    Object.keys(AM_DEF).forEach(function(k){ if (o[k] == null) o[k] = AM_DEF[k]; });
    return o;
  } catch(e){
    var d = {}; Object.keys(AM_DEF).forEach(function(k){ d[k] = AM_DEF[k]; }); return d;
  }
}
function amSave(o){
  try { localStorage.setItem(AM_LS, JSON.stringify(o || {})); } catch(e){}
}
function amOn(k){ return !!amLs()[k]; }
function amSet(k, v){ var o = amLs(); o[k] = !!v; amSave(o); return o; }

function amMsg(t, isErr){
  var el = $('amMsg'); if (!el) return;
  el.innerHTML = (isErr ? '⚠ ' : '') + String(t == null ? '' : t);
  el.style.color = isErr ? '#b3261e' : '';
}
function amStat(t, isErr){
  var el = $('amStat'); if (!el) return;
  el.innerHTML = (isErr ? '⚠ ' : '') + String(t == null ? '' : t);
  el.style.color = isErr ? '#b3261e' : '';
}

/* ---------- 日付ユーティリティ ---------- */
function amToday8(){
  var d = new Date();
  return '' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
}
function amDateOf(d8){
  var s = String(d8 || '').replace(/[^0-9]/g, '');
  if (!/^\d{8}$/.test(s)) return null;
  return new Date(parseInt(s.slice(0,4),10), parseInt(s.slice(4,6),10) - 1, parseInt(s.slice(6,8),10));
}
function amD8Of(d){
  if (!d) return '';
  return '' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
}
/* その日を含む「開催週」の土曜日（JRAの開催は基本 土〜月）。日〜金はその前の土曜に归属 */
function amWeekSat(d8){
  var d = amDateOf(d8);
  if (!d) return '';
  var wd = d.getDay();                 // 0=日 1=月 2=火 3=水 4=木 5=金 6=土
  var back = (wd + 1) % 7;               // 土→0 / 日→1 / 月→2 / 火→3 / 水→4 / 木→5 / 金→6
  d.setDate(d.getDate() - back);
  return amD8Of(d);
}
/* その開催のデータを消してよい日＝**開催週が終わったあとの水曜日**
   ・土〜火の開催（ふつうの土日開催＋月曜振替）→ 同じ週の水曜日（土曜+4日）
     例: 9/12(土)・9/13(日)・9/14(月) の開催 → 9/16(水) に削除
   ・水〜金の単独開催（まれな平日開催）→ **当日より後の最初の水曜日**
     これを土曜起点で計算すると「削除日＝開催当日」になってしまい、
     レースが終わる前に出馬表を消してしまうので必ず分けて扱います。 */
function amCleanD8(d8){
  var d = amDateOf(d8);
  if (!d) return '';
  var wd = d.getDay();                       // 0=日 1=月 2=火 3=水 4=木 5=金 6=土
  if (wd === 6 || wd === 0 || wd === 1 || wd === 2){
    d.setDate(d.getDate() - ((wd + 1) % 7)); // → 開催週の土曜
    d.setDate(d.getDate() + 4);              // → その週の水曜
  } else {
    var add = (3 - wd + 7) % 7;              // 水(3)→0 / 木(4)→6 / 金(5)→5
    if (add === 0) add = 7;                  // 水曜開催は「翌週の水曜」まで残す
    d.setDate(d.getDate() + add);
  }
  return amD8Of(d);
}
function amLabel(d8){
  var s = (typeof amNormDate === 'function') ? (amNormDate(d8) || String(d8 || '')) : String(d8 || '');
  return /^\d{8}$/.test(s) ? (s.slice(0,4) + '/' + s.slice(4,6) + '/' + s.slice(6,8)) : s;
}
/* 日付文字列を YYYYMMDD に直す（2026/9/12・2026-09-12・20260912・2026年9月12日 すべて） */
function amNormDate(s){
  var t = String(s == null ? '' : s).trim();
  if (!t) return '';
  var m = t.match(/(20\d{2})[^0-9]{0,2}(\d{1,2})[^0-9]{0,2}(\d{1,2})/);
  if (m) return m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2);
  var n = t.replace(/[^0-9]/g, '');
  return /^\d{8}$/.test(n) ? n : '';
}
/* レコードのレース日を探す。race_id の先頭8桁は【日付ではない】ので絶対に使わない */
function amRecD8(rec, rid){
  var cands = [];
  try {
    if (rec && rec.meta) cands.push(rec.meta.date8, rec.meta.date);
    if (rec && rec.pre) cands.push(rec.pre.d8, rec.pre.date8);
    if (rec && rec.preBt) cands.push(rec.preBt.d8);
    if (rec) cands.push(rec.date8, rec.d8);
  } catch(e){}
  for (var i = 0; i < cands.length; i++){
    var d8 = amNormDate(cands[i]);
    if (d8) return d8;
  }
  return '';
}

/* =========================================================
   (C) 未確定の開催週データの自動掃除
   ========================================================= */
function amWeekClean(force, today8){
  var out = { scan:0, del:0, keepSettled:0, keepWeek:0, keepNoPre:0, noDate:0, list:[], ran:false };
  if (!force && !amOn('weekClean')) return out;
  var t8 = String(today8 || amToday8());
  if (!/^\d{8}$/.test(t8)) return out;
  /* 同じ日に2回も全スキャンしない（起動のたび・タブを開くたびに走るため） */
  var ls = amLs();
  if (!force && ls.lastClean === t8){ out.ran = false; return out; }
  var all = null;
  try { all = (typeof apScan === 'function') ? (apScan() || {}) : {}; } catch(e){ all = {}; }
  var keys = Object.keys(all);
  for (var i = 0; i < keys.length; i++){
    var rid = keys[i], rec = all[rid];
    out.scan++;
    if (!rec) continue;
    if (rec.result){ out.keepSettled++; continue; }                    // 結果と照合済み＝学習に使うので残す
    var hasPre = !!(rec.pre && rec.pre.rows && rec.pre.rows.length);
    if (!hasPre){ out.keepNoPre++; continue; }                         // 事前予想が無いものは対象外
    var d8 = amRecD8(rec, rid);
    if (!d8){ out.noDate++; continue; }                                // 日付が分からないものは消さない（安全側）
    var cd = amCleanD8(d8);
    if (!cd || cd > t8){ out.keepWeek++; continue; }                   // まだその開催の水曜日が来ていない
    if (d8 >= t8){ out.keepWeek++; continue; }                         // 当日・未来のレースは絶対に消さない
    try { if (typeof apDelRec === 'function') apDelRec(rid); else continue; } catch(e){ continue; }
    out.del++;
    if (out.list.length < 12) out.list.push(rid + '（' + amLabel(d8) + '）');
  }
  ls.lastClean = t8;
  amSave(ls);
  out.ran = true;
  if (out.del){
    try { if (typeof preRenderCount === 'function') preRenderCount(); } catch(e){}
    try { if (typeof vtRender === 'function') vtRender(false); } catch(e){}
  }
  return out;
}
function amCleanText(r){
  if (!r) return '';
  if (!r.ran) return '🧹 掃除は今日はすでに実行済みです（もう一度やるには「今すぐ掃除する」を押してください）。';
  if (!r.del){
    return '🧹 消すものはありませんでした（スキャン ' + r.scan + ' 件／結果照合済みで保持 ' + r.keepSettled +
      '／まだ今週ぶん ' + r.keepWeek + '／事前予想なし ' + r.keepNoPre + '／日付不明 ' + r.noDate + '）。';
  }
  return '🧹 <b>' + r.del + ' 件</b>削除しました（結果が確定していない過去の開催週の事前予想）。内訳: ' +
    r.list.join('、') + (r.del > r.list.length ? ' ほか' + (r.del - r.list.length) + '件' : '') +
    '　／結果照合済み ' + r.keepSettled + ' 件は学習に使うので残しています。';
}
/* 未確定の事前予想が何件貯まっているか（表示用） */
function amPending(){
  var n = 0, oldest = '', weeks = {};
  try {
    var all = (typeof apScan === 'function') ? (apScan() || {}) : {};
    Object.keys(all).forEach(function(rid){
      var rec = all[rid];
      if (!rec || rec.result) return;
      if (!(rec.pre && rec.pre.rows && rec.pre.rows.length)) return;
      n++;
      var d8 = amRecD8(rec, rid);
      if (d8){
        var w = amWeekSat(d8);
        weeks[w] = (weeks[w] || 0) + 1;
        if (!oldest || d8 < oldest) oldest = d8;
      }
    });
  } catch(e){}
  return { n:n, oldest:oldest, weeks:Object.keys(weeks).length };
}

/* =========================================================
   (B) 出馬表＋オッズ → 全馬データ → 上3F・前走タイム の自動マクロ
   ========================================================= */
function amHorseMacro(rid){
  if (!amOn('horse')) return Promise.resolve({ skip:true, reason:'OFF' });
  if (AM_BUSY.horse) return Promise.resolve({ skip:true, reason:'実行中' });
  if (typeof state === 'undefined' || !state.horses || !state.horses.length){
    return Promise.resolve({ skip:true, reason:'出馬表がありません' });
  }
  var nNk = state.horses.filter(function(h){ return h && h.nk; }).length;
  if (!nNk) return Promise.resolve({ skip:true, reason:'netkeiba競走馬IDがありません' });
  AM_BUSY.horse = true;
  var steps = amOn('style') ? 3 : 2;
  amStat('🤖 自動マクロ 1/' + steps + ': 🧾 全馬のプロフィール・戦績・成績分析を取得中（' + nNk + '頭・初回は1頭1〜2秒）…');
  var p;
  try { p = (typeof hdLoadAll === 'function') ? hdLoadAll(false) : null; } catch(e){ p = null; }
  return Promise.resolve(p || { skip:true }).then(function(r1){
    amStat('🤖 自動マクロ 2/' + steps + ': 📡 全馬に前走の上3F・タイムを反映中…');
    var q;
    try { q = (typeof nkFetchAll === 'function') ? nkFetchAll() : null; } catch(e){ q = null; }
    return Promise.resolve(q || { skip:true }).then(function(r2){
      /* ★2026-09-13 第21弾②: 🧠脚質のAI推定もマクロに紐づける。
         (B) で past成績を全部取った直後なので、ここでは【端末内キャッシュだけ】を使って推定します
         （netkeiba への追加通信ゼロ＝数秒で終わる）。手動入力した脚質は絶対に上書きしません。 */
      if (!amOn('style') || typeof stRunFromCache !== 'function'){
        return { hd:r1, nk:r2, st:{ skip:true } };
      }
      amStat('🤖 自動マクロ 3/' + steps + ': 🧠 脚質をAI推定中（取得済みデータから・通信なし）…');
      var r3;
      try { r3 = stRunFromCache({ overwrite: true, minConf: 70, fetch: false }); } catch(e){ r3 = null; }
      return Promise.resolve(r3 || { skip:true }).then(function(rs){ return { hd:r1, nk:r2, st:rs }; });
    }).then(function(all){
      AM_BUSY.horse = false;
      try { if (typeof nkAutoFill === 'function') nkAutoFill(true); } catch(e){}
      try { if (typeof rebuildHorseTable === 'function') rebuildHorseTable(); } catch(e){}
      try { if (typeof renderKentaiFull === 'function') renderKentaiFull(); } catch(e){}
      try { if (typeof aihRender === 'function') aihRender(); } catch(e){}
      var r1 = all.hd, r2 = all.nk, rs = all.st || {};
      var t1 = (r1 && r1.total != null) ? (r1.ok + '/' + r1.total + '頭') : '—';
      var t2 = (r2 && r2.ok != null) ? (r2.ok + '頭') : '—';
      var t3 = (rs && !rs.skip)
        ? ('脚質AI ' + ((rs.filled || 0) + (rs.over || 0)) + '頭' +
           (rs.filled ? '（空欄に補完 ' + rs.filled + '）' : '') + (rs.over ? '（上書き ' + rs.over + '）' : '') +
           (rs.noData ? '／データなし ' + rs.noData : ''))
        : '脚質AI —';
      amStat('✅ 自動マクロ完了: 全馬データ ' + t1 + ' → 上3F・前走タイム反映 ' + t2 + ' → ' + t3 +
        '。②AI予想も描き直しました。');
      return all;
    });
  }).catch(function(e){
    AM_BUSY.horse = false;
    amStat('自動マクロが止まりました: ' + esc(String((e && e.message) || e)) +
      '（①の各ボタンから手動で実行できます）', true);
    return { err: String((e && e.message) || e) };
  });
}

/* =========================================================
   (A) 選んだ日付の「他のレース」も自動検出（事前予想を保存）
   ========================================================= */
function amDayAuto(d8, pickedRid){
  if (!amOn('dayAll')) return Promise.resolve({ skip:true, reason:'OFF' });
  if (AM_BUSY.day) return Promise.resolve({ skip:true, reason:'実行中' });
  var s8 = String(d8 || '').replace(/[^0-9]/g, '');
  if (!/^\d{8}$/.test(s8)) return Promise.resolve({ skip:true, reason:'日付が分かりません' });
  if (typeof preDayFetch !== 'function') return Promise.resolve({ skip:true, reason:'一括取得の仕組みがありません' });
  AM_BUSY.day = true;
  amStat('🤖 自動: ' + amLabel(s8) + ' の<b>他のレースも検出</b>しています（事前予想を保存 → 💰回収率チューナーの材料になります）…');
  return preDayFetch(s8, { odds:true, detail: amOn('detail'), force:false }, function(msg){
    amStat('🤖 ' + String(msg == null ? '' : msg).replace(/</g, '&lt;'));
  }).then(function(res){
    AM_BUSY.day = false;
    amStat('✅ 自動検出 完了: 事前予想を保存 <b>' + (res.ok || 0) + '</b> レース／保存済みスキップ ' +
      (res.skipHave || 0) + '／結果確定済みスキップ ' + (res.skipDone || 0) + '／失敗 ' + (res.fail || 0) +
      (pickedRid ? '（選択中の ' + esc(String(pickedRid)) + ' は読み込み済みなのでスキップ）' : ''));
    try { if (typeof preRenderCount === 'function') preRenderCount(); } catch(e){}
    try { if (typeof apRender === 'function') apRender(); } catch(e){}
    amRenderPending();
    return res;
  }).catch(function(e){
    AM_BUSY.day = false;
    amStat('自動検出が止まりました: ' + esc(String((e && e.message) || e)) +
      '（①の「📥 その日の出馬表を一括取得」から手動で実行できます）', true);
    return { err: String((e && e.message) || e) };
  });
}

/* (B)→(A) の直列実行（両方 state.horses を触るので必ず順番に） */
function amAfterImport(rid, d8){
  var p;
  try { p = amHorseMacro(rid); } catch(e){ p = Promise.resolve({ skip:true }); }
  return Promise.resolve(p).then(function(){
    return amDayAuto(d8, rid);
  }).catch(function(){ return null; });
}

/* =========================================================
   (D) ⑥の過去10年分析 → 🧬血統ファクター抽出 の自動連鎖
   ========================================================= */
function amDrChain(res){
  if (!amOn('drChain')) return;
  if (AM_BUSY.bf) return;
  if (!res || !res.samples || !res.samples.length) return;
  if (typeof bfRunExtract !== 'function') return;
  AM_BUSY.bf = true;
  amStat('🤖 自動: ⑥の過去10年分析が終わったので、そのまま <b>🧬血統ファクターの抽出</b>に入ります…');
  // 血統ブロックが見えるようにしておく（結果が出たのに見えない、を防ぐ）
  try {
    var bb = $('bfBlock');
    if (bb && bb.style) bb.style.display = '';
    var dc = $('drCard');
    if (dc && dc.classList) dc.classList.remove('hid');
  } catch(e){}
  Promise.resolve().then(function(){
    return bfRunExtract(true);
  }).then(function(r){
    AM_BUSY.bf = false;
    if (r && r.skip){
      amStat('🧬 血統の自動抽出はスキップしました（' + esc(String(r.reason || '')) + '）。⑦のボタンから実行できます。');
    } else {
      amStat('✅ 自動: 過去10年分析 → 🧬血統ファクター抽出（6〜10代目の人気馬比リフトつき）まで完了しました。');
    }
  }).catch(function(e){
    AM_BUSY.bf = false;
    amStat('🧬 血統の自動抽出でエラー: ' + esc(String((e && e.message) || e)), true);
  });
}

/* =========================================================
   UI
   ========================================================= */
function amRenderPending(){
  var el = $('amPending');
  if (!el) return;
  var p = amPending();
  if (!p.n){ el.textContent = '結果が確定していない事前予想: 0 件'; return; }
  el.innerHTML = '結果が確定していない事前予想: <b>' + p.n + '</b> 件（' + p.weeks + ' 開催週ぶん・最も古い ' +
    amLabel(p.oldest) + '）。<b>' + amLabel(amCleanD8(p.oldest)) + '（水）以降に自動で消えます</b>。' +
    '　※結果と照合済みのレコードは学習に使うので消えません。';
}
function amSyncUI(){
  var o = amLs();
  AM_PAIRS.forEach(function(pair){
    var el = $(pair[0]);
    if (el && typeof el.checked === 'boolean') el.checked = !!o[pair[1]];
  });
  // 見出しのチップに「今いくつONか」を出す（全部OFFなのに自動で動くと思わせないため）
  var chip = $('amChip');
  if (chip){
    var on = AM_KEYS.filter(function(k){ return !!o[k]; }).length;
    chip.textContent = on === AM_KEYS.length ? (on + 'つとも自動ON')
      : (on === 0 ? '全部OFF（手動のみ）' : (on + '/' + AM_KEYS.length + ' 自動ON'));
    chip.style.color = on === 0 ? 'var(--muted)' : '';
  }
}
function amInit(){
  amSyncUI();
  AM_PAIRS.forEach(function(pair){
    var el = $(pair[0]);
    if (el) el.addEventListener('change', function(){
      amSet(pair[1], !!el.checked);
      amMsg('');
      amSyncUI();
      amRenderPending();
    });
  });
  var b = $('amCleanBtn');
  if (b) b.addEventListener('click', function(){
    var r = amWeekClean(true);
    /* ★2026-09-13 第21弾④: トラックバイアスの記録も一緒に掃除する（同じ水曜日ルール） */
    var rb = null;
    try { if (typeof baWeekClean === 'function') rb = baWeekClean(true); } catch(e){}
    amMsg(amCleanText(r) + (rb ? ('<br>🌊 トラックバイアス: ' + (rb.del
      ? ('<b>' + rb.del + ' 件</b>削除しました（開催週が終わったぶん）。過去ぶんは学習DB側で確定データとして取り直せます。')
      : ('消すものはありません（記録 ' + rb.scan + ' 件／当日・今週ぶん ' + rb.keepWeek + '／日付不明 ' + rb.keepNoDate + '）。'))) : ''));
    amRenderPending();
    try { if (typeof baRenderInfo === 'function') baRenderInfo(); } catch(e){}
  });
  var pb = $('amPendingBtn');
  if (pb) pb.addEventListener('click', function(){ amRenderPending(); });
  var card = $('amCard');
  if (card) card.addEventListener('toggle', function(){ if (card.open){ amSyncUI(); amRenderPending(); } });
  /* 起動時に「水曜日の自動掃除」をチェック（1日1回だけ）。
     自己検証レコードは IndexedDB に入っているので、apInit の読み込みが終わってからでないと
     apScan() が空を返して「消すものなし」と誤判定します。→ 4秒あけて実行。 */
  setTimeout(function(){
    try {
      var r0 = amWeekClean(false);
      if (r0 && r0.del) amMsg(amCleanText(r0));
    } catch(e){}
    try { amRenderPending(); } catch(e){}
  }, 4000);
  try { amRenderPending(); } catch(e){}
}
