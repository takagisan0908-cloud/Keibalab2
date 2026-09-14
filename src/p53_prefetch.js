/* =========================================================
   p53_prefetch.js — 出走前に「その日の出馬表＋各馬データ」を一括取得して
                     AI予想の**事前予想**を作り、保存する
   （#2026-09-12 第17弾）

   ★ なぜこれが要るか
   これまでの自己学習は「結果を取り込んだときに、結果ページの行から印を作り直す（再シミュレーション）」
   だけでした。それだと
     ・出走前に実際に出した予想が残らないので「事前予想 vs 結果」の検証ができない
     ・再シミュレーションは apUScores（3要素）なので、①のAI印（p5_engine の7要素）とは別物の成績になる
   の2つの問題がありました（→ rec.pre として保存する形に p30 を修正済み）。

   このモジュールは **レース前に** 出馬表をまとめて取得し、
     1) 出馬表（馬番・馬名・性齢・斤量・騎手・馬ID）
     2) 単勝オッズ（発売中であれば）
     3) 各馬の馬柱データ（任意。p34 のキャッシュを温める＝🏇馬柱AI評価・p43馬場・p45コース・p49騎手/鉄砲が使えるようになる）
   を取り込んで ①のAI印を計算し、`rec.pre` に保存します。
   結果が出たら（結果メモ📥／日付指定取込／年指定一括取込のどれでも）自動的に突き合わせて
   `b.pre`（事前予想の成績）と `rec.preMarks` に入り、🔬診断と提案4のファクター別学習に使われます。

   ★ トラックバイアス／展開予想の学習にもなる
   事前予想のスナップショットには `pace`（展開予想のスコアとラベル）と `bias`（当日のバイアス予想）も
   一緒に保存するので、「レース前の展開予想が実際どうだったか」を後から検証できます。
   ========================================================= */

var PRE_DELAY = 320;          // 1レースあとの待ち時間(ms)。netkeiba に負荷をかけないため
var PRE_DETAIL_DELAY = 120;   // 馬柱1頭あとの待ち時間(ms)

function preSleep(ms){
  return new Promise(function(r){ setTimeout(r, ms || 0); });
}
/* =========================================================
   ★2026-09-13 第23弾④⑤: 一括取得したレースの記録（軽い一覧）と出馬表キャッシュの確保
   ---------------------------------------------------------
   ④「その日の出馬表を一括取込で全データを取得しておき、その日のどの出馬表を選択しても
      再取得せずパッと表示される」
      → 事前予想を保存しないレース（結果確定済み・保存済みでスキップ）でも、
        **出馬表HTMLだけは必ず端末に入れる** ようにしました。これで全レースが即表示になります。
   ⑤「出馬表の自動保存はされず、読み込み履歴にも取得されたレースの一覧がない」
      → 取得したレースの一覧をここに記録して ①の画面に出します。
        読み込み履歴(kaiAddHist)は1件ごとに全馬のスナップショットを持つので、
        36レースぶん入れると localStorage を食い潰します。そこでここは
        **レース情報だけの軽い記録（1件 約60バイト・最大300件）** にしています。
        「表示」を押すと ④ の出馬表キャッシュから通信ゼロで開きます。
   ========================================================= */
var PRE_LIST_LS = 'khl_pre_list_v1';
var PRE_LIST_MAX = 300;
function preListLs(){
  try {
    var o = JSON.parse(localStorage.getItem(PRE_LIST_LS) || 'null');
    if (!o || !Array.isArray(o.items)) o = { items: [] };
    return o;
  } catch(e){ return { items: [] }; }
}
function preListSet(o){
  try { localStorage.setItem(PRE_LIST_LS, JSON.stringify(o)); return true; } catch(e){ return false; }
}
/* 一括取得で触ったレースを1件記録する（同じ race_id なら上書き＝重複しない） */
function preNoteFetched(rid, d8, info){
  rid = String(rid || '');
  if (!rid) return;
  info = info || {};
  try {
    var o = preListLs();
    var it = {
      rid: rid,
      d8: /^\d{8}$/.test(String(d8 || '')) ? String(d8) : '',
      place: String(info.place || ''),
      rnum: String(info.rnum || ''),
      name: String(info.name || ''),
      n: info.n || 0,
      at: Date.now(),
      pre: !!info.pre,          // 事前予想を保存できたか（false=結果確定済み等でスキップ）
      odds: info.oddsN || 0
    };
    var i = -1;
    for (var k = 0; k < o.items.length; k++){ if (o.items[k] && o.items[k].rid === rid){ i = k; break; } }
    if (i >= 0) o.items[i] = it; else o.items.unshift(it);
    if (o.items.length > PRE_LIST_MAX) o.items.length = PRE_LIST_MAX;
    // 新しい日付のものが上に来るように（同じ日付なら取得順）
    o.items.sort(function(a, b){
      if (a.d8 !== b.d8) return a.d8 < b.d8 ? 1 : -1;
      return (b.at || 0) - (a.at || 0);
    });
    preListSet(o);
    preListRender();
  } catch(e){}
}
function preListAll(){ return preListLs().items || []; }
function preListClear(){
  try { localStorage.removeItem(PRE_LIST_LS); } catch(e){}
  preListRender();
}
/* 出馬表HTMLが端末に入っているか（＝通信せず開けるか） */
function preHasCard(rid){
  try { return (typeof nkCardHas === 'function') && nkCardHas(rid); } catch(e){ return false; }
}
/* 事前予想を保存しないレースでも、出馬表だけは必ず端末に入れておく */
function preEnsureCard(rid, d8, force){
  try {
    if (!force && preHasCard(rid)) return Promise.resolve(false);
    if (typeof nkFetchCardText !== 'function') return Promise.resolve(false);
    return nkFetchCardText(rid, { d8: d8 || '', force: !!force })
      .then(function(){ return true; }).catch(function(){ return false; });
  } catch(e){ return Promise.resolve(false); }
}
/* ★2026-09-13 第23弾⑤: レース一覧ページ(diParseDateList)は {rid, rnum, name} しか持たないので、
   ①の「📅 日付を選んで出馬表を取込」で取得済みの開催キャッシュ（場ごとのレース一覧）から
   場名を引きます。取れなければ空のまま（一覧は race_id と R番だけでも表示できます）。 */
function preVenueOf(rid, d8){
  try {
    var caches = [];
    if (typeof kaiLs === 'function'){ var l1 = kaiLs(); if (l1 && l1.cache) caches.push(l1.cache); }
    if (typeof rk !== 'undefined' && rk && rk.cache) caches.push(rk.cache);
    for (var i = 0; i < caches.length; i++){
      var c = caches[i];
      if (!c || String(c.date || '') !== String(d8 || '') || !c.venues) continue;
      for (var v = 0; v < c.venues.length; v++){
        var ve = c.venues[v] || {};
        var rs = ve.races || [];
        for (var k = 0; k < rs.length; k++){
          if (String(rs[k].raceId || '') === String(rid)){
            return { place: ve.venue || '', rnum: String(rs[k].r || ''), name: rs[k].name || '' };
          }
        }
      }
    }
  } catch(e){}
  return { place: '', rnum: '', name: '' };
}
function preD8Label(d8){
  d8 = String(d8 || '');
  if (!/^\d{8}$/.test(d8)) return '';
  var y = d8.slice(0, 4), m = d8.slice(4, 6), d = d8.slice(6, 8);
  var wd = '';
  try { wd = '日月火水木金土'.charAt(new Date(parseInt(y,10), parseInt(m,10)-1, parseInt(d,10)).getDay()); } catch(e){}
  return y + '年' + parseInt(m,10) + '月' + parseInt(d,10) + '日' + (wd ? '(' + wd + ')' : '');
}
/* 一覧の描画（日付ごとにグループ化） */
function preListRender(){
  var box = $('preList'), empty = $('preListEmpty'), chip = $('preListChip');
  if (!box) return;
  var items = preListAll();
  if (chip) chip.textContent = items.length + '件';
  if (empty) empty.style.display = items.length ? 'none' : '';
  if (!items.length){ box.innerHTML = ''; return; }
  var byDate = {}, order = [];
  items.forEach(function(it){
    var k = it.d8 || '不明';
    if (!byDate[k]){ byDate[k] = []; order.push(k); }
    byDate[k].push(it);
  });
  var curRid = '';
  try { curRid = String((typeof state !== 'undefined' && state && state.raceId) || ''); } catch(e){}
  box.innerHTML = order.map(function(k){
    var list = byDate[k];
    var nCard = 0, nPre = 0;
    list.forEach(function(it){ if (preHasCard(it.rid)) nCard++; if (it.pre) nPre++; });
    var rows = list.map(function(it){
      var has = preHasCard(it.rid);
      var isCur = it.rid === curRid;
      var ttl = esc((it.place || '') + ' ' + (it.rnum || '') + 'R ' + (it.name || ''));
      /* ★2026-09-13 第24弾②: 最小表示（1レース=1行）。
         以前は race_id・頭数・オッズ件数・取得時刻・「端末に出馬表あり（通信せず開けます）」等の
         長文を2行目に並べていたため一覧が横に広がっていました。
         長文はやめて「頭数｜取得時刻」だけ残し、詳しい内容は title(ホバー) とボタン表記に寄せます。
         出馬表の有無はボタン（⚡表示 = 端末にある / 🌐取得 = 期限切れ）で分かるので説明文は削除。 */
      return '<div class="row">' +
        '<button type="button" class="btn ' + (has ? 'primary' : 'ghost') + '" style="padding:2px 8px;font-size:11px;white-space:nowrap" data-pshow="' + esc(it.rid) + '" data-pd8="' + esc(it.d8 || '') + '"' +
          ' title="' + (has ? '端末に出馬表があるので通信せず開けます' : '出馬表は期限切れなので開くときに取得します') + '\n' + ttl + '\nrace_id: ' + esc(it.rid) + '">' +
          (has ? '⚡表示' : '🌐取得') + '</button>' +
        '<div class="hd" title="' + ttl + '\nrace_id: ' + esc(it.rid) + (it.odds ? '\nオッズ ' + it.odds + '件' : '') + '">' + ttl +
          (isCur ? '<span class="chip" style="background:var(--card2);color:var(--ok-ink)">表示中</span>' : '') +
          (it.pre ? '<span class="badge" title="出走前のAI予想を学習DBに保存済み">事前</span>' : '') +
        '</div>' +
        '<span class="muted meta">' + (it.n ? esc(String(it.n)) + '頭｜' : '') + esc(preTimeText(it.at)) + '</span>' +
        '<button type="button" class="kai-mini" data-pdel="' + esc(it.rid) + '" title="一覧から外すだけ（出馬表キャッシュ・学習DBは消えません）">✕</button>' +
      '</div>';
    }).join('');
    return '<div class="small muted" style="margin:6px 0 1px"><b style="color:var(--ink)">' + esc(k === '不明' ? '日付不明' : preD8Label(k)) + '</b>' +
      ' ' + list.length + 'R・端末' + nCard + '・事前' + nPre + '</div>' + rows;
  }).join('');
  box.querySelectorAll('[data-pshow]').forEach(function(b){
    b.onclick = function(){
      var rid = b.getAttribute('data-pshow'), d8 = b.getAttribute('data-pd8') || '';
      if (typeof kaiImportByRaceId === 'function') kaiImportByRaceId(rid, { d8: d8 });
    };
  });
  box.querySelectorAll('[data-pdel]').forEach(function(b){
    b.onclick = function(){
      var rid = b.getAttribute('data-pdel');
      var o = preListLs();
      o.items = (o.items || []).filter(function(x){ return x && x.rid !== rid; });
      preListSet(o); preListRender();
    };
  });
}
function preTimeText(ms){
  try {
    var d = new Date(ms);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  } catch(e){ return ''; }
}

function preLog(progress, msg, isErr){
  try { if (typeof progress === 'function') progress(msg, !!isErr); } catch(e){}
}

/* DOMの input を一時的に差し替えて fn() を実行し、必ず元へ戻す */
var PRE_DOM_IDS = ['rName', 'rPlace', 'rBaba', 'rDist', 'rClass', 'rTime', 'rCushion'];
function preWithState(raceObj, horses, d8, rid, fn){
  var svH = null, svR = null, svId = null, svD8 = null, svDom = {};
  try {
    svH = state.horses; svR = state.race; svId = state.raceId; svD8 = state.raceDate8;
    PRE_DOM_IDS.forEach(function(id){ var el = $(id); if (el) svDom[id] = el.value; });
    state.horses = horses;
    state.race = raceObj;
    state.raceId = rid;
    state.raceDate8 = d8;
    function setv(id, v){ var el = $(id); if (el) el.value = (v == null ? '' : String(v)); }
    setv('rName', raceObj.name || '');
    setv('rPlace', raceObj.place || '');
    setv('rBaba', raceObj.baba || '');
    setv('rDist', raceObj.dist || '');
    setv('rClass', raceObj.grade || '');
    setv('rTime', raceObj.time || '');
    return fn();
  } finally {
    try {
      state.horses = svH; state.race = svR; state.raceId = svId; state.raceDate8 = svD8;
      PRE_DOM_IDS.forEach(function(id){ var el = $(id); if (el && svDom[id] != null) el.value = svDom[id]; });
    } catch(e){}
  }
}

/* 出馬表の行 → state.horses の形。脚質は学習DBの履歴（＝レース前情報）から補う */
function preBuildHorses(parsed, oddsMap, d8){
  var hs = (parsed || []).map(function(p){
    var no = String(p.no || '');
    var o = oddsMap && oddsMap[no];
    return mkHorse({
      frame: p.frame || '', no: no, name: p.name || '', sexAge: p.sexAge || '',
      weight: p.weight || '', jockey: p.jockey || '', nk: p.nk || '',
      odds: (o && o.odds) ? String(o.odds) : '', style: '', mark: '', yobi: '', time: ''
    });
  });
  // 脚質: 学習DBの過去戦の通過順から（p52。その日付より前の出走だけを使う＝いかさま防止）
  try {
    if (d8 && typeof hfFeatures === 'function' && hs.length){
      hfIndex(false);
      var rowsForHf = hs.map(function(h){
        return { no: h.no, name: h.name, id: h.nk || '', jockey: h.jockey || '', weightChg: '' };
      });
      var band = '';
      try {
        var dm = String((state && state.race && state.race.dist) || '').match(/(\d{3,4})/);
        band = dm ? hfBand(parseInt(dm[1], 10)) : '';
      } catch(e){}
      var map = hfFeatures(rowsForHf, d8, band);
      if (map){
        var filled = 0;
        hs.forEach(function(h){
          var f = map[String(h.no)];
          if (f && f.style && !h.style){ h.style = f.style; filled++; }
        });
        hs._styleFilled = filled;
      }
    }
  } catch(e){}
  return hs;
}

/* 1レースぶん: 出馬表→(オッズ)→AI予想→ rec.pre へ保存 */
function preOneRace(rid, d8, opt){
  opt = opt || {};
  /* ★2026-09-13 第21弾①: d8 を渡してキャッシュの期限判定（過去=7日/当日=30分）を正確にする。
     ここで取得した出馬表HTMLは端末内に残るので、あとから ①「📅 日付を選んで出馬表を取込」で
     同じレースを選んだときは【通信せず即座に復元】されます（再取得になりません）。 */
  return nkFetchCardText(rid, { d8: d8 || '', force: !!opt.forceCard }).then(function(html){
    var parsed = nkParseShutuba(html) || [];
    if (!parsed.length) throw new Error('出馬表を解析できませんでした');
    var meta = {};
    try { meta = nkParseRaceMeta(html) || {}; } catch(e){ meta = {}; }
    var oddsP = (opt.odds === false) ? Promise.resolve(null)
      : nkFetchOddsAny(rid).then(function(payload){
          try { return nkParseOddsData(payload); } catch(e){ return null; }
        }).catch(function(){ return null; });
    return oddsP.then(function(od){
      var oddsMap = {};
      ((od && od.odds) || []).forEach(function(x){ if (x && x.no != null) oddsMap[String(x.no)] = x; });
      var hs = preBuildHorses(parsed, oddsMap, d8);
      var d8m = (meta.date && typeof apDate8FromText === 'function') ? (apDate8FromText(meta.date) || d8) : d8;
      var raceName = meta.name || '';
      // レース名は apMetaCur() が日付・場・距離を拾える形にしておく
      var fullName = ((meta.date ? meta.date + ' ' : '') + (meta.place || '') + (meta.rnum || '') + 'R ' + raceName).trim();
      var raceObj = {
        name: fullName, place: meta.place || '', baba: meta.baba || '',
        dist: meta.dist || '', grade: meta.grade || meta.className || '', time: meta.startTime || ''
      };
      // 各馬の馬柱データ（任意）— p34 のキャッシュを温める
      var detP = Promise.resolve(0);
      if (opt.detail){
        var ids = hs.map(function(h){ return h.nk; }).filter(function(x){ return x; });
        detP = ids.reduce(function(chain, id){
          return chain.then(function(doneN){
            if (typeof hdLoadHorse !== 'function') return doneN;
            return hdLoadHorse(id, false).then(function(){ return doneN + 1; }).catch(function(){ return doneN; })
              .then(function(n2){ return preSleep(PRE_DETAIL_DELAY).then(function(){ return n2; }); });
          });
        }, Promise.resolve(0));
      }
      return detP.then(function(detN){
        var res = preWithState(raceObj, hs, d8m, rid, function(){ return analyzeRace(); });
        var mm = preWithState(raceObj, hs, d8m, rid, function(){
          return (typeof apMetaCur === 'function') ? apMetaCur() : null;
        });
        var rec = (typeof apSnapPred === 'function') ? apSnapPred(rid, res, mm) : null;
        if (!rec || !rec.pre) throw new Error('事前予想を保存できませんでした（すでに結果が確定している可能性があります）');
        return { rid: rid, n: hs.length, oddsN: Object.keys(oddsMap).length, detailN: detN || 0,
                 styleN: hs._styleFilled || 0, honmei: (res.rows && res.rows[0]) ? (res.rows[0].h.name + res.rows[0].mark) : '',
                 /* ★2026-09-13 第23弾⑤: 一覧に「何場 何R 何レース」を出せるように引き渡す */
                 place: meta.place || '', rnum: String(meta.rnum || '').replace(/[^0-9]/g, ''), raceName: raceName || '' };
      });
    });
  });
}

/* その日の全レースを一括取得 */
function preDayFetch(date8, opt, progress){
  opt = opt || {};
  progress = progress || function(){};
  var result = { ok: 0, skipHave: 0, skipDone: 0, fail: 0, total: 0, detailN: 0, oddsN: 0, styleN: 0, cardN: 0, errors: [] };
  var d8 = String(date8 || '').replace(/[^0-9]/g, '');
  if (!/^\d{8}$/.test(d8)){
    return Promise.reject(new Error('日付が不正です（YYYYMMDD）'));
  }
  return diNetkeibaRaces(d8).then(function(items){
    result.total = items.length;
    if (!items.length) throw new Error('この日のレース一覧をnetkeibaに見つけられませんでした');
    preLog(progress, items.length + ' レースを検出しました。出走前に出馬表を1レースずつ取得してAI予想を保存します…');
    var seq = Promise.resolve();
    items.forEach(function(it){
      seq = seq.then(function(){
        var rid = String(it.rid || it.id || '');
        if (!rid) return;
        /* ★2026-09-13 第23弾④: レース一覧(diNetkeibaRaces)が持っている情報をそのまま
           ⑤の一覧表示に使うので、ここで拾っておきます。 */
        var meta0 = { place: it.venue || it.place || '', rnum: (String(it.r || it.rnum || '').replace(/[^0-9]/g, '')), name: it.name || '' };
        try {
          var ve0 = preVenueOf(rid, d8);
          if (!meta0.place && ve0.place) meta0.place = ve0.place;
          if (!meta0.rnum && ve0.rnum) meta0.rnum = ve0.rnum;
          if (!meta0.name && ve0.name) meta0.name = ve0.name;
        } catch(e){}
        // すでに結果を知っているレースは「事前予想」にならないので必ず飛ばす
        var done = false;
        try { done = (typeof apPreAllowed === 'function') ? !apPreAllowed(rid) : false; } catch(e){}
        if (done){
          result.skipDone++;
          /* ★第23弾④: 事前予想にはならなくても、**出馬表だけは必ず端末に入れる**。
             これがないと「結果確定済みのレースを選んだときだけ毎回取り直し」になります。 */
          return preEnsureCard(rid, d8, !!opt.forceCard).then(function(got){
            if (got) result.cardN++;
            try { preNoteFetched(rid, d8, { place: meta0.place, rnum: meta0.rnum, name: meta0.name, n: 0, pre: false }); } catch(e){}
            preLog(progress, rid + ' → 結果確定済みなので事前予想はスキップ' +
              (got ? '（📄 出馬表は端末に保存したので、選ぶときは通信せず即表示されます）' : '（📄 出馬表は保存済み）'));
          }).then(function(){ return preSleep(opt.delay || PRE_DELAY); });
        }
        if (!opt.force){
          try {
            var r0 = (typeof apGet === 'function') ? apGet(rid) : null;
            if (r0 && r0.pre && r0.pre.rows && r0.pre.rows.length){
              result.skipHave++;
              /* ★第23弾④⑤: 事前予想が保存済みでも、出馬表キャッシュが期限切れなら入れ直し、
                 一覧には必ず載せます（「取得されたレースの一覧」が欠けないように） */
              return preEnsureCard(rid, d8, false).then(function(got){
                if (got) result.cardN++;
                try {
                  preNoteFetched(rid, d8, { place: meta0.place, rnum: meta0.rnum, name: meta0.name,
                    n: (r0.pre.rows || []).length, pre: true });
                } catch(e){}
                preLog(progress, rid + ' → 事前予想は保存済み' + (got ? '（📄 出馬表を端末に保存しました）' : ''));
              }).then(function(){ return preSleep(opt.delay || PRE_DELAY); });
            }
          } catch(e){}
        }
        return preOneRace(rid, d8, opt).then(function(info){
          result.ok++;
          result.detailN += info.detailN || 0;
          if (info.oddsN) result.oddsN++;
          result.styleN += info.styleN || 0;
          result.cardN++;
          /* ★第23弾⑤: 取得できたレースを一覧に記録する（読み込み履歴に載らなかった問題の対応） */
          try {
            preNoteFetched(rid, d8, {
              place: meta0.place || (info.place || ''), rnum: meta0.rnum || (info.rnum || ''),
              name: (info.raceName || meta0.name || ''), n: info.n || 0, pre: true, oddsN: info.oddsN || 0
            });
          } catch(e){}
          preLog(progress, '✅ ' + rid + '（' + info.n + '頭・オッズ' + info.oddsN + '件・脚質補完' + info.styleN +
            '頭' + (info.detailN ? '・馬柱' + info.detailN + '頭' : '') + '） 本命: ' + info.honmei);
        }).catch(function(e){
          result.fail++;
          result.errors.push(rid + ': ' + ((e && e.message) || e));
          preLog(progress, '⚠ ' + rid + ' → ' + ((e && e.message) || e), true);
        }).then(function(){ return preSleep(opt.delay || PRE_DELAY); });
      });
    });
    return seq.then(function(){
      // 事前予想のスナップショットは学習DBのインデックスを変えるので作り直しておく
      try { if (typeof hfDropCache === 'function') hfDropCache(); } catch(e){}
      try { if (typeof pfSchedule === 'function') pfSchedule(); } catch(e){}
      preLog(progress, '完了: 事前予想を保存 ' + result.ok + ' レース / 保存済みでスキップ ' + result.skipHave +
        ' / 結果確定済みでスキップ ' + result.skipDone + ' / 失敗 ' + result.fail +
        ' ／📄 出馬表は ' + result.total + ' レースぶん端末に保存済み（この日のレースはどれを選んでも通信せず即表示されます）' +
        (result.oddsN ? '（オッズ取得 ' + result.oddsN + ' レース）' : '（※オッズは発売前だと取得できないことがあります）') +
        (result.detailN ? '（馬柱 ' + result.detailN + ' 頭）' : ''));
      return result;
    });
  });
}

/* ---------- UI ---------- */
function preBusy(b){
  ['preBtn', 'preDate'].forEach(function(id){ var el = $(id); if (el) el.disabled = !!b; });
  var c = $('preChkDetail'); if (c) c.disabled = !!b;
  var f = $('preChkForce'); if (f) f.disabled = !!b;
}
function preMsg(t, isErr){
  var el = $('preMsg'); if (!el) return;
  el.innerHTML = (isErr ? '⚠ ' : '') + esc(t || '');
  el.style.color = isErr ? '#b3261e' : '';
}
function preStat(t){
  var el = $('preStat'); if (el) el.innerHTML = t || '';
}
function preRun(){
  var d8 = '';
  var el = $('preDate');
  if (el && el.value) d8 = String(el.value).replace(/[^0-9]/g, '');
  if (!/^\d{8}$/.test(d8)){
    try { if (typeof jlTodayD8 === 'function') d8 = jlTodayD8(); } catch(e){}
  }
  if (!/^\d{8}$/.test(d8)){ preMsg('日付を入力してください（YYYYMMDD）', true); return; }
  var opt = {
    odds: true,
    detail: !!($('preChkDetail') && $('preChkDetail').checked),
    force: !!($('preChkForce') && $('preChkForce').checked)
  };
  preBusy(true);
  preMsg('');
  var n = 0;
  preDayFetch(d8, opt, function(msg, isErr){
    n++;
    preStat(esc(msg));
    if (isErr) preMsg('', false);
  }).then(function(res){
    preBusy(false);
    preMsg('');
    preStat('✅ 完了: 事前予想を保存 <b>' + res.ok + '</b> レース / 保存済みスキップ ' + res.skipHave +
      ' / 結果確定済みスキップ ' + res.skipDone + ' / 失敗 ' + res.fail +
      (res.detailN ? ' / 馬柱 ' + res.detailN + ' 頭' : ''));
    try { if (typeof apRender === 'function') apRender(); } catch(e){}
    try { if (typeof apdPaint === 'function') apdPaint(); } catch(e){}
  }).catch(function(e){
    preBusy(false);
    preMsg((e && e.message) || String(e), true);
  });
}
function initPre(){
  var b = $('preBtn');
  if (b) b.addEventListener('click', preRun);
  // 日付の初期値＝今日
  try {
    var el = $('preDate');
    if (el && !el.value && typeof jlTodayD8 === 'function'){
      var t = jlTodayD8();
      if (/^\d{8}$/.test(t)) el.value = t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8);
    }
  } catch(e){}
  // 事前予想が何レース保存済みかを出す
  try { preRenderCount(); } catch(e){}
  /* ★2026-09-13 第23弾⑤: 一括取得したレースの一覧を描画＋消去ボタンを配線 */
  try { preListRender(); } catch(e){}
  try {
    var cb = $('preListClear');
    if (cb && cb.addEventListener) cb.addEventListener('click', function(){
      if (typeof window !== 'undefined' && window.confirm && !window.confirm('一括取得したレースの一覧だけ消します。\n出馬表キャッシュ・学習DB・読み込み履歴は消えません。よろしいですか？')) return;
      preListClear();
    });
  } catch(e){}
}
function preRenderCount(){
  var el = $('preCount');
  if (!el) return;
  var n = 0, settled = 0;
  try {
    var recs = (typeof apCompleted === 'function') ? (apCompleted() || []) : [];
    recs.forEach(function(r){ if (r && r.pre && r.pre.rows && r.pre.rows.length){ settled++; } });
  } catch(e){}
  try {
    var all = (typeof apScan === 'function') ? apScan() : {};
    Object.keys(all).forEach(function(k){
      var r = all[k];
      if (r && r.pre && r.pre.rows && r.pre.rows.length && !r.result) n++;
    });
  } catch(e){}
  el.textContent = (n || settled) ? ('事前予想 ' + n + ' レース保存中（結果と照合済み ' + settled + '）') : 'まだ事前予想はありません';
}

/* =========================================================
   ★2026-09-12 第18弾: バックテスト
   「結果を見ない状態で過去レースを予想し、あとで照合する」
   ---------------------------------------------------------
   ★ なぜできるのか（いかさまにならない理由）
   学習DB（diLs().races）には全レースの「オッズ・人気・斤量・性齢・騎手」と「着順・タイム・通過順」が
   入っています。このうち **結果側（着順・タイム・上り・通過順・着差）は一切使わず**、
   レース前側に当たる情報だけで予想を作り直します。

     使うもの  : 馬番 / 馬名 / 性齢 / 斤量 / 騎手 / 馬ID / 単勝オッズ / 人気 / 馬場状態 / 距離 / 面
     使わない  : 着順 / タイム / 上り3F / コーナー通過順 / 着差 / 払戻

   過去の実績（脚質・📚学習DB実績ファクター）は p52 の hfFeatures(rows, d8, band) が
   **「そのレース日より strictly 前の出走だけ」** を返すので、自分自身の結果は混ざりません
   （同日の他レースも除外される＝厳しめ）。

   ★ ただし2つだけ正直に書いておく制約
   1) 展開学習(p50 pfHorseMuls)は学習DB全体の集計で日付フィルタが無いため、
      バックテスト中は window.BT_MODE で **OFF** にします（自分自身の結果が入ってしまうため）。
   2) 出馬表には無い手入力ファクター（前走タイム・調教・出遅れ率・血統）は空になります。
      これは「①の📥一括取得を馬柱取得なしで実行したとき」と同じ条件なので、
      事前予想の実力を測るにはちょうど良い比較になります。

   ★ 保存先は rec.preBt（本物の事前予想 rec.pre は絶対に上書きしません）
     synthetic:true / src:'backtest' を必ず付けます。
     照合結果は rec.preBtMarks と月別バケットの b.bt に入り、
     🔬診断の表①〜④に「🕰バックテスト」として並びます。
     提案4のファクター別学習(p54 flLearn)は rec.pre が無いレースで rec.preBt を使うので、
     30レース待ちだった重み調整が **数千レースぶん** のデータで効くようになります。
   ========================================================= */

var BT_MIN_ROWS = 5;        // 出走頭数がこれ未満のレースは対象外
var BT_MIN_ODDS = 2;        // オッズがある馬がこれ以上いないと予想の意味が薄い

/* 対象レースを列挙する（通信ゼロ・学習DBだけを見る） */
function preBtTargets(opt){
  opt = opt || {};
  var out = [];
  try {
    var list = (typeof apStoredRaceList === 'function') ? (apStoredRaceList() || []) : [];
    list.forEach(function(x){
      try {
        if (!x || !x.rid || !x.p) return;
        var rows = x.p.rows || [];
        if (rows.length < BT_MIN_ROWS) return;
        var d8 = String(x.p.date8 || (x.p.meta && x.p.meta.date8) || '').replace(/[^0-9]/g, '');
        if (!/^\d{8}$/.test(d8)) return;
        if (opt.from && d8 < opt.from) return;
        if (opt.to && d8 > opt.to) return;
        var oddsN = 0;
        rows.forEach(function(r){ if (apNum(r.odds) > 1) oddsN++; });
        if (oddsN < BT_MIN_ODDS) return;
        out.push({ rid: String(x.rid), d8: d8, p: x.p, n: rows.length, oddsN: oddsN });
      } catch(e){}
    });
    out.sort(function(a, b){ return (a.d8 < b.d8 ? -1 : a.d8 > b.d8 ? 1 : 0) || (a.rid < b.rid ? -1 : 1); });
    if (opt.max && opt.max > 0 && out.length > opt.max) out = out.slice(out.length - opt.max);  // 新しい順に max 件
  } catch(e){}
  return out;
}

/* 学習DBの結果行 → 出走前の state.horses（結果情報は絶対に含めない） */
function preBtHorses(rows, d8, band){
  var src = (rows || []).slice().sort(function(a, b){
    var na = parseInt(a.no, 10) || 0, nb = parseInt(b.no, 10) || 0;
    return na - nb;
  });
  var hs = src.map(function(r){
    return mkHorse({
      frame: r.frame || '', no: String(r.no == null ? '' : r.no), name: String(r.name || ''),
      sexAge: String(r.sexAge || ''), weight: String(r.weight || ''), jockey: String(r.jockey || ''),
      nk: String(r.id || ''), odds: (apNum(r.odds) > 1 ? String(r.odds) : ''),
      style: '', mark: '', yobi: '', time: ''
    });
  });
  // 脚質: その日付より前の通過順だけから（p52）
  try {
    if (d8 && typeof hfFeatures === 'function' && hs.length){
      hfIndex(false);
      var rf = hs.map(function(h){
        return { no: h.no, name: h.name, id: h.nk || '', jockey: h.jockey || '', weightChg: '' };
      });
      var map = hfFeatures(rf, d8, band || '');
      if (map){
        var filled = 0;
        hs.forEach(function(h){
          var f = map[String(h.no)];
          if (f && f.style && !h.style){ h.style = f.style; filled++; }
        });
        hs._styleFilled = filled;
      }
    }
  } catch(e){}
  return hs;
}

/* 1レースぶんをバックテストして rec.preBt に保存 → 結果と照合して b.bt へ集計 */
function preBacktestOne(t){
  var p = t.p, meta = p.meta || {};
  var d8 = t.d8;
  var m = parseInt(meta.m, 10) || 0;
  if (!m && meta.dist){ var dm = String(meta.dist).match(/(\d{3,4})/); if (dm) m = parseInt(dm[1], 10); }
  var band = m ? hfBand(m) : '';
  var hs = preBtHorses(p.rows, d8, band);
  if (hs.length < 2) return null;
  // レース名は apMetaCur() が日付・場・R・距離を拾える形にしておく（📚実績ファクターが正しく引けるように）
  var ymd = d8.slice(0, 4) + '年' + (parseInt(d8.slice(4, 6), 10)) + '月' + (parseInt(d8.slice(6, 8), 10)) + '日';
  var fullName = (ymd + ' ' + (meta.place || '') + (meta.rnum || '') + 'R ' + (meta.name || '')).trim();
  var raceObj = {
    name: fullName, place: meta.place || '', baba: meta.baba || '',
    dist: meta.dist || (m ? ((meta.surface || '') + m + 'm') : ''),
    grade: meta.grade || '', time: ''
  };
  // 展開学習(p50)は全体集計で日付フィルタが無いので、バックテスト中はOFF
  var res = null, mm = null, svBt = window.BT_MODE;
  try {
    window.BT_MODE = true;
    res = preWithState(raceObj, hs, d8, t.rid, function(){ return analyzeRace(); });
    mm = preWithState(raceObj, hs, d8, t.rid, function(){
      return (typeof apMetaCur === 'function') ? apMetaCur() : null;
    });
  } finally { window.BT_MODE = svBt; }
  if (!res || !res.ok) return null;
  if (mm){
    // meta は学習DBの値を優先（日付・場・面が確実）
    mm.date8 = d8;
    if (!mm.surface && meta.surface) mm.surface = meta.surface;
    if (!mm.dist && raceObj.dist) mm.dist = raceObj.dist;
    if (!mm.place && meta.place) mm.place = meta.place;
    if (!mm.rnum && meta.rnum) mm.rnum = String(meta.rnum);
    if (!mm.baba && meta.baba) mm.baba = meta.baba;
  }
  var rec = (typeof apSnapPred === 'function') ? apSnapPred(t.rid, res, mm, { bt: true }) : null;
  if (!rec || !rec.preBt) return null;
  var ev = null;
  try { if (typeof apEvalBt === 'function') ev = apEvalBt(t.rid); } catch(e){}
  return {
    rid: t.rid, d8: d8, n: hs.length, styleN: hs._styleFilled || 0,
    top: (res.rows && res.rows[0]) ? (String(res.rows[0].h.no) + ' ' + res.rows[0].h.name + res.rows[0].mark) : '',
    hit: !!(ev && ev.preBtMarks && ev.preBtMarks.some(function(x){ return x.order === 1; })),
    top3: !!(ev && ev.preBtMarks && ev.preBtMarks.some(function(x){ return x.order >= 1 && x.order <= 3; })),
    picks: rec.preBt.picks || null
  };
}

/* バックテスト本体。progress(msg, isErr) で1レースごとに報告する */
function preBacktest(opt, progress){
  opt = opt || {};
  progress = progress || function(){};
  var result = { total: 0, ok: 0, skip: 0, fail: 0, hit: 0, top3: 0, styleN: 0, cleared: 0, errors: [] };
  var tg = preBtTargets(opt);
  result.total = tg.length;
  if (!tg.length){
    return Promise.resolve(result);
  }
  // 集計は加算式なので、やり直すときは先に b.bt をクリアする（二重計上防止）
  if (!opt.keep){
    try { result.cleared = (typeof apBtClear === 'function') ? apBtClear() : 0; } catch(e){}
  }
  preLog(progress, '🕰 バックテスト対象 <b>' + tg.length + '</b> レース（通信ゼロ・学習DBだけを使います）。' +
    '各レースを「その日付より前の出走データだけ」で予想し直し、保存済みの結果と照合します…');
  var i = 0;
  function step(){
    if (i >= tg.length) return Promise.resolve();
    var t = tg[i++];
    var r = null;
    try { r = preBacktestOne(t); } catch(e){ r = null; result.errors.push(t.rid + ': ' + ((e && e.message) || e)); }
    if (r){
      result.ok++; result.styleN += r.styleN || 0;
      if (r.hit) result.hit++;
      if (r.top3) result.top3++;
      if (result.ok % 25 === 0 || i === tg.length){
        preLog(progress, '🕰 ' + i + ' / ' + tg.length + ' レース処理（保存 ' + result.ok +
          '・印内1着 ' + result.hit + '・印内3着 ' + result.top3 + '） 直近: ' + t.rid + ' → ' + r.top);
      }
    } else {
      result.fail++;
    }
    // UIを固まらせないため、1レースごとにイベントループへ戻す
    return preSleep(0).then(step);
  }
  return step().then(function(){
    try { if (typeof hfDropCache === 'function') hfDropCache(); } catch(e){}
    try { if (typeof flDrop === 'function') flDrop(); } catch(e){}
    preLog(progress, '✅ バックテスト完了: <b>' + result.ok + '</b> レースを予想し直して照合しました' +
      (result.ok ? '（印内1着 ' + result.hit + ' = ' + Math.round(result.hit / result.ok * 100) + '% / 印内3着 ' +
        result.top3 + ' = ' + Math.round(result.top3 / result.ok * 100) + '%）' : '') +
      (result.fail ? ' / 対象外・失敗 ' + result.fail : '') +
      '。🔬診断の表①〜④に「🕰バックテスト」の行が増え、提案4のファクター別学習がこのデータで重みを調整します。');
    return result;
  });
}

/* ---------- バックテストのUI ---------- */
function btBusy(b){
  ['btBtn', 'btFrom', 'btTo', 'btMax', 'btChkKeep'].forEach(function(id){
    var el = $(id); if (el) el.disabled = !!b;
  });
}
function btStat(t){ var el = $('btStat'); if (el) el.innerHTML = t || ''; }
function btMsg(t, isErr){
  var el = $('btMsg'); if (!el) return;
  el.innerHTML = (isErr ? '⚠ ' : '') + esc(t || '');
  el.style.color = isErr ? '#b3261e' : '';
}
function btRun(){
  function d8of(id){
    var el = $(id);
    return (el && el.value) ? String(el.value).replace(/[^0-9]/g, '') : '';
  }
  var opt = { from: d8of('btFrom'), to: d8of('btTo'), keep: !!($('btChkKeep') && $('btChkKeep').checked) };
  var mx = parseInt(($('btMax') || {}).value, 10);
  if (mx && mx > 0) opt.max = mx;
  var pre = preBtTargets(opt).length;
  if (!pre){ btMsg('対象レースがありません（学習DBに結果と日付がそろったレースが必要です）', true); return; }
  btBusy(true); btMsg('');
  btStat('対象 <b>' + pre + '</b> レース。処理中…');
  preBacktest(opt, function(msg){ btStat(msg); }).then(function(r){
    btBusy(false);
    btStat('✅ 完了: <b>' + r.ok + '</b> レース予想→照合' +
      (r.ok ? '（印内1着 <b>' + r.hit + '</b> = ' + Math.round(r.hit / r.ok * 100) + '% / 印内3着内 <b>' + r.top3 +
        '</b> = ' + Math.round(r.top3 / r.ok * 100) + '%）' : '') +
      (r.fail ? ' / 対象外 ' + r.fail : '') +
      (r.cleared ? ' / 前回のバックテスト集計を ' + r.cleared + ' 月ぶんクリア' : '') +
      (r.styleN ? ' / 脚質を履歴から補完 ' + r.styleN + ' 頭' : ''));
    try { if (typeof apRender === 'function') apRender(); } catch(e){}
    try { if (typeof apdPaint === 'function') apdPaint(); } catch(e){}
    try { if (typeof flPaint === 'function') flPaint(); } catch(e){}
    try { if (typeof btRenderCount === 'function') btRenderCount(); } catch(e){}
  }).catch(function(e){
    btBusy(false);
    btMsg((e && e.message) || String(e), true);
  });
}
/* バックテストの結果をまとめて消す */
function btClearRun(){
  var n = 0, m = 0;
  try {
    var all = (typeof apScan === 'function') ? (apScan() || {}) : {};
    Object.keys(all).forEach(function(rid){
      var rec = all[rid];
      if (rec && rec.preBt){
        delete rec.preBt; delete rec.preBtMarks; delete rec.preBtSettledAt;
        try { if (typeof apPut === 'function') apPut(rec); n++; } catch(e){}
      }
    });
  } catch(e){}
  try { m = (typeof apBtClear === 'function') ? apBtClear() : 0; } catch(e){}
  try { if (typeof flDrop === 'function') flDrop(); } catch(e){}
  try { if (typeof apRender === 'function') apRender(); } catch(e){}
  try { if (typeof apdPaint === 'function') apdPaint(); } catch(e){}
  btStat('🗑 バックテストの予想を <b>' + n + '</b> レースぶん削除し、集計を ' + m + ' 月ぶんクリアしました。');
  try { btRenderCount(); } catch(e){}
}
function btRenderCount(){
  var el = $('btCount');
  if (!el) return;
  var bt = 0, ev = 0;
  try {
    var all = (typeof apScan === 'function') ? (apScan() || {}) : {};
    Object.keys(all).forEach(function(rid){
      var rec = all[rid];
      if (!rec || !rec.preBt) return;
      bt++;
      if (rec.preBtMarks) ev++;
    });
  } catch(e){}
  var tg = 0;
  try { tg = preBtTargets({}).length; } catch(e){}
  el.textContent = bt
    ? ('バックテスト ' + bt + ' レース保存中（照合済み ' + ev + '）／学習DBの対象レース ' + tg)
    : ('まだバックテストはありません（学習DBの対象レース ' + tg + '）');
}
function initBt(){
  var b = $('btBtn'); if (b) b.addEventListener('click', btRun);
  var c = $('btClear'); if (c) c.addEventListener('click', btClearRun);
  var card = $('btCard');
  if (card) card.addEventListener('toggle', function(){ if (card.open) btRenderCount(); });
  try { btRenderCount(); } catch(e){}
}
