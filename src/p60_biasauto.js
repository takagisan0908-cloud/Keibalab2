/* =========================================================
   p60_biasauto.js — 🌊 トラックバイアスの自動取得（開催日に自動で最新化）
   （#2026-09-13 第21弾④）

   ご依頼: 「トラックバイアスもレース開催日のレース時間から確定が見込まれる時間に自動取得する事で
            常に最新の情報を取得できるようにする。なおこのデータに関しても開催終了後水曜日に一旦削除し、
            学習DB側で別の全ての確定データとして再取得する」

   やること:
   (E1) 開催日（＝今日）に、**その日のレース一覧の発走時刻を見て**、
        「発走時刻 ＋ BA_AFTER_MIN 分（既定12分＝結果が確定している見込みの時刻）」を過ぎた
        未取得レースだけを自動で取りに行きます（1分ごとにチェック）。
        → 朝イチで取ったバイアスが昼過ぎまで古いまま、ということがなくなります。
        → 未取得ぶんだけ取るので、取得済みのレースを何度も叩きません。
        → 最終レース ＋ BA_FINAL_MIN 分（既定30分）で「締め」の一通りをもう一度実行します。
   (E2) 結果が確定していない…ではなく **開催が終わった週のトラックバイアス記録は水曜日に自動削除**。
        ④のトラックバイアス記録（state.biasRaces）は「当日ぶん」を使うのが前提で、
        過去ぶんは学習DB（⑥重賞データ分析・🎓展開学習）側に確定データとして入り直します。
        → localStorage が毎週ふくらみ続けるのを止めます。

   注意: このアプリは静的ページなので、**ページを開いている間だけ**動きます（60秒ごとのタイマー）。
        開いた瞬間に「今日の未取得ぶん」をまとめて追い取得するので、途中から開いても最新化されます。
   ========================================================= */

var BA_AFTER_MIN = 12;      // 発走時刻＋この分数で「結果が確定している見込み」
var BA_FINAL_MIN = 30;      // 最終レース＋この分数で締めの一括取得
var BA_EVERY_MS = 60 * 1000; // チェック間隔（1分）
var BA_LIST_TTL = 10 * 60 * 1000;  // レース一覧のキャッシュ（10分）
var BA_STATE = { day8: '', list: null, listAt: 0, timer: null, lastTick: 0, finalDone: '', failStreak: 0 };

function baStat(t, isErr){
  var el = $('baStat'); if (!el) return;
  el.innerHTML = (isErr ? '⚠ ' : '') + String(t == null ? '' : t);
  el.style.color = isErr ? '#b3261e' : '';
}
function baToday8(){
  var d = new Date();
  return '' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
}
function baMinNow(){ var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function baMinOf(hhmm){
  var m = String(hhmm || '').match(/(\d{1,2}):(\d{2})/);
  return m ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) : null;
}
function baHM(min){
  if (min == null || !isFinite(min)) return '';
  return ('0' + Math.floor(min / 60)).slice(-2) + ':' + ('0' + (min % 60)).slice(-2);
}

/* その日のレース一覧（発走時刻つき）をセッション中キャッシュつきで取得 */
function baDayList(d8, force){
  if (!force && BA_STATE.day8 === d8 && BA_STATE.list && (Date.now() - BA_STATE.listAt) < BA_LIST_TTL){
    return Promise.resolve(BA_STATE.list);
  }
  if (typeof kaiFetchListHtml !== 'function') return Promise.resolve(BA_STATE.list || []);
  return kaiFetchListHtml(d8).then(function(got){
    var q = [];
    (((got && got.venues) || [])).forEach(function(v){
      (v.races || []).forEach(function(rr){
        q.push({ rid: String(rr.raceId || ''), rno: rr.r, venue: v.venue, time: rr.time || '', name: rr.name || '' });
      });
    });
    BA_STATE.day8 = d8; BA_STATE.listAt = Date.now();
    if (q.length) BA_STATE.list = q;
    BA_STATE.failStreak = 0;
    return q.length ? q : (BA_STATE.list || []);
  }).catch(function(){
    BA_STATE.failStreak++;
    return BA_STATE.list || [];
  });
}
function baHas(rid){
  var rs = (typeof state !== 'undefined' && state && state.biasRaces) || [];
  rid = String(rid || '');
  for (var i = 0; i < rs.length; i++){ if (String(rs[i] && rs[i].id) === rid) return true; }
  return false;
}
function baDayRaces(d8){
  var rs = (typeof state !== 'undefined' && state && state.biasRaces) || [];
  return rs.filter(function(rc){
    var rd = '';
    try { rd = (typeof biasRecDay8 === 'function') ? biasRecDay8(rc) : String(rc.date || '').replace(/[^0-9]/g, '').slice(0, 8); } catch(e){}
    return rd === String(d8 || '');
  });
}

/* 1回分のチェック。戻り値 Promise<{got, todo, future, have, skip?}> */
function baTick(d8opt, opt){
  opt = opt || {};
  if (!opt.force && (typeof amOn === 'function') && !amOn('biasAuto')) return Promise.resolve({ skip: true, reason: 'OFF' });
  var d8 = String(d8opt || baToday8());
  if (!/^\d{8}$/.test(d8)) return Promise.resolve({ skip: true, reason: '日付が分かりません' });
  if (!opt.force && d8 !== baToday8()){
    return Promise.resolve({ skip: true, reason: '当日の開催ではありません（過去ぶんは学習DB側で確定データとして取得します）' });
  }
  if (typeof nkBiasRunQueue !== 'function') return Promise.resolve({ skip: true, reason: 'トラックバイアス取得機能がありません' });
  if ((typeof AM_BUSY !== 'undefined') && AM_BUSY.bias) return Promise.resolve({ skip: true, reason: '取得中' });
  return baDayList(d8, !!opt.forceList).then(function(q){
    if (!q || !q.length){
      baStat('🌊 自動取得: ' + d8.slice(0,4) + '/' + d8.slice(4,6) + '/' + d8.slice(6,8) +
        ' のレース一覧がありません（開催なし・または未取得）。');
      return { skip: true, reason: 'レース一覧なし', got: 0 };
    }
    var nowMin = baMinNow();
    var todo = [], future = 0, have = 0, lastMin = 0;
    q.forEach(function(x){
      var mm = baMinOf(x.time);
      if (mm != null && mm > lastMin) lastMin = mm;
      if (baHas(x.rid)){ have++; return; }
      if (mm == null){ todo.push(x); return; }        // 発走時刻が分からないレースはとりあえず試す
      if (mm + BA_AFTER_MIN <= nowMin) todo.push(x);
      else future++;
    });
    var head = '🌊 トラックバイアス自動取得（' + d8.slice(4,6) + '/' + d8.slice(6,8) + '・' + q.length + 'レース）: ';
    if (!todo.length){
      baStat(head + '取得済み ' + have + '／未発走・結果未確定 ' + future +
        (lastMin ? '／最終発走 ' + baHM(lastMin) : '') + '。次回チェック ' + baHM(nowMin + 1) + ' 以降。');
      return { got: 0, todo: 0, future: future, have: have };
    }
    if (typeof AM_BUSY !== 'undefined') AM_BUSY.bias = true;
    baStat(head + '<b>' + todo.length + ' レース</b>を取りに行きます（取得済み ' + have + '／未発走 ' + future + '）…');
    return nkBiasRunQueue(todo, true, null).then(function(got){
      if (typeof AM_BUSY !== 'undefined') AM_BUSY.bias = false;
      BA_STATE.lastTick = Date.now();
      try { if (typeof renderBiasCard === 'function') renderBiasCard(); } catch(e){}
      try { if (typeof showAnalysis === 'function' && got) showAnalysis(); } catch(e){}
      try { if (typeof saveNow === 'function') saveNow(); } catch(e){}
      try { if (typeof renderKentaiFull === 'function' && got) renderKentaiFull(); } catch(e){}
      baStat(head + '✅ <b>' + got + ' レース分</b>を新規取得しました（累計 ' + (have + got) + '/' + q.length +
        '・未取得 ' + (todo.length - got) + '／未発走 ' + future + '）。' +
        (got ? '　④のトラックバイアスと②AI印を更新しました。' : '　※結果がまだ確定していない可能性があります。次のチェックで取り直します。'));
      /* 最終レース＋BA_FINAL_MIN を過ぎていたら「締め」の一通り（時刻不明・取りこぼしの救済） */
      if (lastMin && (nowMin >= lastMin + BA_FINAL_MIN) && BA_STATE.finalDone !== d8){
        BA_STATE.finalDone = d8;
        var ls = (typeof amLs === 'function') ? amLs() : {};
        ls.lastBiasDay = d8;
        if (typeof amSave === 'function') amSave(ls);
      }
      return { got: got, todo: todo.length, future: future, have: have };
    }).catch(function(e){
      if (typeof AM_BUSY !== 'undefined') AM_BUSY.bias = false;
      baStat(head + '取得できませんでした: ' + String((e && e.message) || e).replace(/</g, '&lt;'), true);
      return { got: 0, err: String((e && e.message) || e) };
    });
  });
}

/* =========================================================
   (E2) 開催週のトラックバイアス記録を水曜日に自動削除
   ---------------------------------------------------------
   ④の記録（state.biasRaces）は「当日の馬場傾向」を見るためのもの。過去ぶんは
   🎓展開学習(p50)・⑥重賞データ分析の学習DB側に【確定データ】として入り直すので、
   ここでは開催週が終わった（＝その週の水曜日が来た）記録を落とします。
   日付の分からない記録は安全側で残します。
   ========================================================= */
function baWeekClean(force, today8){
  var out = { scan: 0, del: 0, keepWeek: 0, keepNoDate: 0, list: [], ran: false };
  if (!force && (typeof amOn === 'function') && !amOn('biasClean')) return out;
  var t8 = String(today8 || baToday8());
  if (!/^\d{8}$/.test(t8)) return out;
  if (typeof state === 'undefined' || !state || !Array.isArray(state.biasRaces)) return out;
  var rs = state.biasRaces, keep = [];
  for (var i = 0; i < rs.length; i++){
    var rc = rs[i];
    out.scan++;
    var d8 = '';
    try { d8 = (typeof biasRecDay8 === 'function') ? biasRecDay8(rc) : String((rc && rc.date) || '').replace(/[^0-9]/g, '').slice(0, 8); } catch(e){}
    if (!/^\d{8}$/.test(d8)){ keep.push(rc); out.keepNoDate++; continue; }
    var cd = (typeof amCleanD8 === 'function') ? amCleanD8(d8) : '';
    if (!cd || cd > t8 || d8 >= t8){ keep.push(rc); out.keepWeek++; continue; }
    out.del++;
    if (out.list.length < 8) out.list.push(((rc.venue || '') + (rc.rno ? rc.rno + 'R' : '')) || d8);
  }
  if (out.del){
    state.biasRaces = keep;
    if (Array.isArray(state.biasTrash)) state.biasTrash = [];   // ゴミ箱に溜め直すと結局残るので空にする
    try { if (typeof saveNow === 'function') saveNow(); } catch(e){}
    try { if (typeof renderBiasCard === 'function') renderBiasCard(); } catch(e){}
  }
  out.ran = true;
  return out;
}

/* =========================================================
   起動・タイマー
   ========================================================= */
function baStart(){
  if (BA_STATE.timer) return;
  BA_STATE.timer = setInterval(function(){
    try { baTick(); } catch(e){}
  }, BA_EVERY_MS);
}
function baStop(){
  if (BA_STATE.timer){ clearInterval(BA_STATE.timer); BA_STATE.timer = null; }
}
function baInit(){
  var b = $('baNowBtn');
  if (b) b.addEventListener('click', function(){
    b.disabled = true;
    baStat('🌊 手動でトラックバイアスを取りに行きます…');
    baTick(baToday8(), { force: true, forceList: true }).then(function(){ b.disabled = false; }).catch(function(){ b.disabled = false; });
  });
  var cb = $('baCleanBtn');
  if (cb) cb.addEventListener('click', function(){
    var r = baWeekClean(true);
    baStat(r.del
      ? ('🧹 トラックバイアス <b>' + r.del + ' 件</b>を削除しました（開催週が終わったぶん）。内訳: ' + r.list.join('、') +
         (r.del > r.list.length ? ' ほか' + (r.del - r.list.length) + '件' : '') + '　過去ぶんは学習DB側で確定データとして取り直せます。')
      : ('🧹 消すものはありません（スキャン ' + r.scan + ' 件／今週ぶん・当日 ' + r.keepWeek + '／日付不明 ' + r.keepNoDate + '）。'));
    try { baRenderInfo(); } catch(e){}
  });
  var rb = $('baInfoBtn');
  if (rb) rb.addEventListener('click', function(){ baRenderInfo(); });
  var card = $('baCard');
  if (card) card.addEventListener('toggle', function(){ if (card.open){ baRenderInfo(); } });
  /* 起動時: 追い取得（今日ぶん）＋水曜掃除。
     レース一覧の取得が要るので、他の初期化が落ち着いてから（6秒後）にします。 */
  setTimeout(function(){
    try {
      var r = baWeekClean(false);
      if (r && r.del) baStat('🧹 開催週が終わったトラックバイアス ' + r.del + ' 件を自動で削除しました（過去ぶんは学習DB側で確定データとして取り直せます）。');
    } catch(e){}
    try { baRenderInfo(); } catch(e){}
    baStart();
    try { baTick(); } catch(e){}
  }, 6000);
}
function baRenderInfo(){
  var el = $('baInfo');
  if (!el) return;
  var t8 = baToday8();
  var today = baDayRaces(t8);
  var all = (typeof state !== 'undefined' && state && Array.isArray(state.biasRaces)) ? state.biasRaces.length : 0;
  var q = (BA_STATE.day8 === t8 && BA_STATE.list) ? BA_STATE.list : null;
  var lastMin = 0;
  if (q) q.forEach(function(x){ var mm = baMinOf(x.time); if (mm != null && mm > lastMin) lastMin = mm; });
  el.innerHTML = '今日の取得: <b>' + today.length + '</b> レース' +
    (q ? '（' + q.length + ' レース中' + (lastMin ? '・最終発走 ' + baHM(lastMin) : '') + '）' : '（一覧未取得）') +
    '／端末内の記録 合計 <b>' + all + '</b> 件' +
    '　次の自動チェック: ' + (BA_STATE.timer ? '1分ごと' : '停止中') +
    '　締めの一括取得: ' + (lastMin ? baHM(lastMin + BA_FINAL_MIN) + '（最終発走＋' + BA_FINAL_MIN + '分）' : '—');
}
