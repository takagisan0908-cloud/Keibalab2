/* =========================================================
   32 日付指定で「その日の1〜12R」を学習DBへ一括取込
   ---------------------------------------------------------
   パトロールビデオ・レース映像を見た日付を指定すると、
   その日のJRA全レース(場ごと1〜12R)の
     着順・枠・馬番・馬名・性齢・斤量・騎手名・タイム・
     コーナー通過順位・上り(推定上がり)・単勝・人気・
     馬体重(増減)・調教師
   を検出し、学習DB(khl_date_v1)へ自動保存します。
   - 主経路: netkeiba（過去の開催日にも対応。全項目そろう）
   - 補助: JRA公式（直近約2ヶ月。上り3Fが無い等は項目欠け）
   - 重複防止: 同じレース(race_id)・同じ内容は保存しません
     （着順データが全項目一致＝同一内容としてスキップ）
   ========================================================= */
var DI_LS = 'khl_date_v1';          // 旧形式: 1キーに全レースをまとめて保存（移行元）
var DI_PREFIX = 'khl_di_';          // 従来方式: 1レース1キー（localStorage移行元・フォールバック）
/* =========================================================
   保存領域の本命: IndexedDB（大容量）
   ---------------------------------------------------------
   localStorage は「サイトごとの合計」に容量制限(通常5〜10MB)があり、
   キーをいくつに分けても(「別ファイル」に分けても)合計は増えない。
   そこで日別レースDBは IndexedDB(通常 数百MB〜数GB)へ保存する。
   - 起動時に自動で IndexedDB を開き、localStorage に残っていた
     旧データ(khl_di_* / khl_date_v1)を自動移行する
   - IndexedDB が使えない環境では従来どおり localStorage へ保存し、
     UI に「使えていない」と案内する
   ========================================================= */
var DI_IDB_NAME = 'keiba_date_v1';
var DI_IDB_STORE = 'races';
var DI_IDB_MARK = 'khl_date_idb_on';   // IndexedDB に保存中である印（非対応環境での案内用）
var diDb = null;           // IDBDatabase
var diMem = null;          // {rid: rec} 一覧キャッシュ（IDBモード時のみ）
var diAt = 0;              // 最新の at（表示用）
var diMode = 'ls';         // 'ls'(従来) | 'idb'(大容量)
var diBootP = null;
var diBytes = 0, diBytesDirty = false;
var diEvictedRun = 0;      // 今回の取込で「満杯→古い順に自動削除」した件数

function diIdbAvail(){
  try { return !!(typeof indexedDB !== 'undefined' && indexedDB && indexedDB.open); } catch(e){ return false; }
}
function diLsRaw(rid){
  try { var raw = localStorage.getItem(DI_PREFIX + rid); if (raw){ var r = JSON.parse(raw); if (r && r.rid === rid) return r; } } catch(e){}
  return null;
}
function diLsAll(){
  var races = {};
  try { for (var i = 0; i < localStorage.length; i++){ var k = localStorage.key(i); if (k && k.indexOf(DI_PREFIX) === 0){ try { var rec = JSON.parse(localStorage.getItem(k)); if (rec && rec.rid) races[rec.rid] = rec; } catch(e){} } } } catch(e){}
  return races;
}
/* ★2026-09-13 第23弾⑥: diLs() は呼ぶたびに localStorage 全体を走査して
   学習DBの全レコードを JSON.parse していました（diLsAll + diLegacy）。
   学習DBは apStoredRaceList / hfBuildIndex / tl* / pf* / vt* などあちこちから読まれるので、
   ここが効いてくるとサイト全体が重くなります。
   → パース済みの結果を覚えておき、**書き込みがあったときだけ**捨てて作り直します。
   呼び出し側はすべて読み取り専用（filter / map / JSON.stringify）なので使い回して安全です。 */
var diLsMem = null;
function diLsDrop(){ diLsMem = null; }
function diLsSet(rid, rec){
  diLsDrop();
  try { return safeSetItem(DI_PREFIX + rid, JSON.stringify(rec));   /* 🥇学習DB＝第一優先 */ }
  catch(e){ return false; }
}
function diLsDel(rid){ diLsDrop(); try { localStorage.removeItem(DI_PREFIX + rid); } catch(e){} }
function diLsClear(){
  diLsDrop();
  try { var n = localStorage.length, ks = []; for (var i = 0; i < n; i++){ var k = localStorage.key(i); if (k && k.indexOf(DI_PREFIX) === 0) ks.push(k); } ks.forEach(function(k){ try { localStorage.removeItem(k); } catch(e){} }); } catch(e){}
}
function diLegacy(){
  try { var o = JSON.parse(localStorage.getItem(DI_LS) || 'null'); if (o && o.races && Object.keys(o.races).length) return o; } catch(e){}
  return null;
}
function diLsBytes(){
  var s = 0;
  try { for (var i = 0; i < localStorage.length; i++){ var k = localStorage.key(i); if (k && k.indexOf(DI_PREFIX) === 0){ var v = localStorage.getItem(k) || ''; s += (k.length + v.length) * 2; } } } catch(e){}
  try { var o = localStorage.getItem(DI_LS); if (o) s += (DI_LS.length + o.length) * 2; } catch(e){}
  return s;
}
function diStorageOK(){
  if (diMode === 'idb') return true;
  try { var k = DI_PREFIX + '__probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch(e){ return false; }
}

/* ---------- IndexedDB ラッパー ---------- */
function diOpenDb(){
  return new Promise(function(res, rej){
    try {
      var rq = indexedDB.open(DI_IDB_NAME, 1);
      rq.onupgradeneeded = function(){
        var d = rq.result;
        if (!d.objectStoreNames.contains(DI_IDB_STORE)) d.createObjectStore(DI_IDB_STORE, { keyPath: 'rid' });
      };
      rq.onsuccess = function(){ res(rq.result); };
      rq.onerror = function(){ rej(rq.error || new Error('idb-open')); };
      rq.onblocked = function(){ rej(new Error('idb-blocked')); };
    } catch(e){ rej(e); }
  });
}
function diIdbPut(rec){
  return new Promise(function(res, rej){
    if (!diDb) return rej(new Error('no-db'));
    try {
      var tx = diDb.transaction(DI_IDB_STORE, 'readwrite');
      tx.objectStore(DI_IDB_STORE).put(rec);
      tx.oncomplete = function(){ res(true); };
      tx.onerror = function(){ rej(tx.error || new Error('tx')); };
      tx.onabort = function(){ rej(tx.error || new Error('tx-abort')); };
    } catch(e){ rej(e); }
  });
}
function diIdbGetAll(){
  return new Promise(function(res, rej){
    if (!diDb) return rej(new Error('no-db'));
    try {
      var tx = diDb.transaction(DI_IDB_STORE, 'readonly');
      var rq = tx.objectStore(DI_IDB_STORE).getAll();
      rq.onsuccess = function(){ res(rq.result || []); };
      rq.onerror = function(){ rej(rq.error || new Error('get')); };
    } catch(e){ rej(e); }
  });
}
function diIdbClear(){
  return new Promise(function(res, rej){
    if (!diDb) return rej(new Error('no-db'));
    try {
      var tx = diDb.transaction(DI_IDB_STORE, 'readwrite');
      tx.objectStore(DI_IDB_STORE).clear();
      tx.oncomplete = function(){ res(true); };
      tx.onerror = function(){ rej(tx.error || new Error('clear')); };
    } catch(e){ rej(e); }
  });
}
function diIdbDel(rid){
  return new Promise(function(res, rej){
    if (!diDb) return rej(new Error('no-db'));
    try {
      var tx = diDb.transaction(DI_IDB_STORE, 'readwrite');
      tx.objectStore(DI_IDB_STORE).delete(rid);
      tx.oncomplete = function(){ res(true); };
      tx.onerror = function(){ rej(tx.error || new Error('del')); };
      tx.onabort = function(){ rej(tx.error || new Error('del-abort')); };
    } catch(e){ rej(e); }
  });
}

/* ---------- 満杯時の自動整理: 一番古いレースから順に上書き ---------- */
function diRaceSort(db){
  // 開催日(date8)が古い順 → 同じ日なら取込順(at)の古い順
  var arr = [];
  for (var rid in (db.races || {})){
    var r = db.races[rid];
    arr.push({ rid: rid, date: String(r && r.date8 || ''), at: (r && r.at) || 0 });
  }
  arr.sort(function(a, b){
    return (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.at - b.at) || (a.rid < b.rid ? -1 : 1);
  });
  return arr;
}
/* 指定ridを localStorage キー・旧形式・IndexedDB・メモリから削除 */
function diRemoveRace(rid){
  diLsDrop();   // 旧索引(DI_LS)側も書き換えるので必ず捨てる
  diLsDel(rid);
  var leg = diLegacy();
  if (leg && leg.races && leg.races[rid]){
    try {
      delete leg.races[rid];
      if (Object.keys(leg.races).length) safeSetItem(DI_LS, JSON.stringify(leg));   /* 🥇学習DBの索引 */
      else localStorage.removeItem(DI_LS);
    } catch(e){}
  }
  if (diMode === 'idb' && diMem){
    if (diMem[rid]){ delete diMem[rid]; diBytesDirty = true; }
    try { diIdbDel(rid); } catch(e){}
  }
}
/* localStorageモード: 満杯なら古い順に消してでも1件は保存する */
function diLsSetEvict(rid, rec){
  if (diLsSet(rid, rec)) return true;
  var guard = 0;
  while (!diLsSet(rid, rec)){
    var db = diLs();
    var old = diRaceSort(db).filter(function(x){ return x.rid !== rid; })[0];
    if (!old){ return false; }   // 消せる古いデータが残っていない（＝1件も保存不能）
    diRemoveRace(old.rid);
    diEvictedRun++;
    if (++guard > 50000) return false;   // 安全弁
  }
  return true;
}
/* IndexedDBモード: put失敗→localStorage退避→それも満杯なら古い順に削除して再put */
function diSetIdbEvictRetry(rid, rec, depth){
  var db = { races: diMem || {} };
  var targets = diRaceSort(db).filter(function(x){ return x.rid !== rid; });
  if (!targets.length || depth > Math.min(200, targets.length)) return;
  diRemoveRace(targets[0].rid);
  diEvictedRun++;
  diIdbPut(rec).then(function(){
    diLsDel(rid);
  }).catch(function(){
    if (diLsSetEvict(rid, rec)) return;
    diSetIdbEvictRetry(rid, rec, depth + 1);
  });
}

/* ---------- 起動時の読込＋localStorage→IndexedDB 自動移行 ---------- */
function diBoot(){
  if (diBootP) return diBootP;
  diBootP = new Promise(function(resolve){
    if (!diIdbAvail()){ diMode = 'ls'; resolve(false); return; }
    diOpenDb().then(function(db){
      diDb = db;
      return diIdbGetAll();
    }).then(function(recs){
      diMem = {}; var at = 0;
      (recs || []).forEach(function(r){ if (r && r.rid){ diMem[r.rid] = r; if ((r.at || 0) > at) at = r.at; } });
      // localStorage に残っているデータ(旧形式・従来1レース1キー)を併合
      var add = [];
      function merge(rid, rec){
        if (!diMem[rid]){ diMem[rid] = rec; add.push(rec); }
        else if (String(rec.at || '') > String(diMem[rid].at || '')){ diMem[rid] = rec; add.push(rec); }
        if ((rec.at || 0) > at) at = rec.at;
      }
      var lsAll = diLsAll();
      Object.keys(lsAll).forEach(function(rid){ merge(rid, lsAll[rid]); });
      var leg = diLegacy();
      if (leg){ Object.keys(leg.races || {}).forEach(function(rid){ merge(rid, leg.races[rid]); }); }
      diAt = at;
      diBytesDirty = true;
      var flush = Promise.resolve();
      var failed = false;
      add.forEach(function(rec){ flush = flush.then(function(){ return diIdbPut(rec).catch(function(){ failed = true; }); }); });
      return flush.then(function(){
        if (failed){ diMode = 'ls'; diDb = null; diMem = null; return false; }   // 移行に失敗したら従来動作
        diLsClear();
        try { localStorage.removeItem(DI_LS); } catch(e){}
        try { safeSetItem(DI_IDB_MARK, '1'); } catch(e){}   /* 🥇学習DBの設定 */
        diMode = 'idb';
        return true;
      });
    }).then(function(){
      diRenderStat();
      resolve(true);
    }).catch(function(){
      diMode = 'ls'; diDb = null; diMem = null;
      diRenderStat();
      resolve(false);
    });
  });
  return diBootP;
}

/* ---------- 同期読み書き API（内部は diMode で分岐） ---------- */
function diLs(){
  if (diMode === 'idb' && diMem) return { races: diMem, at: diAt };
  if (diLsMem) return diLsMem;              // ★第23弾⑥: 前回パースした結果を使い回す
  var races = diLsAll();
  var leg = diLegacy(), at = 0;
  if (leg){ for (var rid in leg.races){ if (!races[rid]) races[rid] = leg.races[rid]; } }
  for (var k in races){ if ((races[k].at || 0) > at) at = races[k].at; }
  diLsMem = { races: races, at: at };
  return diLsMem;
}
function diGet(rid){
  if (diMode === 'idb' && diMem && diMem[rid]) return diMem[rid];
  var r = diLsRaw(rid); if (r) return r;
  var leg = diLegacy(); return (leg && leg.races[rid]) || null;
}
function diSet(rid, rec){
  // 満杯になったら「一番古いデータから上書き」：容量不足時は古い順に自動削除して保存する
  if (diMode === 'idb' && diMem){
    diMem[rid] = rec;
    if ((rec.at || 0) > diAt) diAt = rec.at;
    diBytesDirty = true;
    diIdbPut(rec).then(function(){ diLsDel(rid); }).catch(function(){
      // IDB保存に失敗(満杯等)→localStorageへ退避→それもダメなら古い順に削除して再保存
      if (diLsSetEvict(rid, rec)) return;
      diSetIdbEvictRetry(rid, rec, 0);
    });
    return true;
  }
  return diLsSetEvict(rid, rec);
}
function diSave(o){ return diStorageOK(); }
function diRemoveAll(){
  diMem = null; diAt = 0; diBytesDirty = true; diLsDrop();
  if (diDb){ try { diIdbClear(); } catch(e){} }
  diLsClear();
  try { localStorage.removeItem(DI_LS); } catch(e){}
  try { localStorage.removeItem(DI_IDB_MARK); } catch(e){}
}
function diUsedBytes(){
  if (diMode === 'idb' && diMem){
    if (diBytesDirty){
      var s = 0;
      for (var k in diMem){ try { s += JSON.stringify(diMem[k]).length * 2; } catch(e){} }
      diBytes = s; diBytesDirty = false;
    }
    return diBytes;
  }
  return diLsBytes();
}
function diProbeFree(){
  if (diMode === 'idb') return diEstimateSync();   // estimate非同期のため同期は目安
  try {
    if (!diStorageOK()) return 0;
    var okKB = 0, sizes = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096], k = DI_PREFIX + '__cap';
    for (var q = 0; q < sizes.length; q++){
      var kb = sizes[q];
      try { var s = new Array(kb * 512 + 1).join('a'); localStorage.setItem(k, s); localStorage.removeItem(k); okKB = kb; }
      catch(e){ break; }
    }
    return okKB * 1024;
  } catch(e){ return 0; }
}
/* ブラウザが教えてくれる「このサイトの保存上限と使用量」(StorageManager) */
function diEstimate(){
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function'){
      return navigator.storage.estimate().then(function(info){
        return { quota: (info && info.quota) || 0, usage: (info && info.usage) || 0 };
      }).catch(function(){ return null; });
    }
  } catch(e){}
  return Promise.resolve(null);
}
function diEstimateSync(){
  try { return 536870912; } catch(e){ return 536870912; }
}
var DI_PER_RACE = 4600;   // 実測: 1レース(約16頭)で約4.7KB
/* 残量の説明文を生成してコールバックへ */
function diFreeNote(cb){
  cb = cb || function(){};
  if (diMode !== 'idb'){
    var free = diProbeFree();
    cb('この環境は従来の保存領域（通常5〜10MB）です。空き: 約 ' + Math.round(free / 1024) + ' KB（およそ ' + Math.floor(free / DI_PER_RACE) + ' レース分）');
    return;
  }
  diEstimate().then(function(e){
    if (!e || !e.quota){
      cb('このブラウザは残量の実測に対応していませんが、IndexedDBは数百MB〜数GBまで保存できます');
      return;
    }
    var used = e.usage || 0, quota = e.quota || 0;
    var remain = Math.max(0, quota - used);
    var n = Math.floor(remain / DI_PER_RACE);
    cb('このサイトの保存上限 約 ' + (quota / 1048576).toFixed(0) + ' MB ／ 使用中 約 ' + (used / 1048576).toFixed(1) + ' MB ／ 残り 約 ' + (remain / 1048576).toFixed(0) + ' MB ≒ あと約 ' + n + ' レース分（1レース約4.7KBで計算）');
  });
}

function diHash(pr){
  // 全項目(着順関連)が一致するとき=「同一内容」とみなすハッシュ
  var s = JSON.stringify((pr.rows || []).map(function(r){
    return [r.order, r.no, r.name, r.id || '', r.sexAge, r.weight, r.jockey, r.time,
            r.passing, r.last3, r.odds, r.pop, r.weightChg, r.trainer, r.margin];
  })) + '|pay=' + JSON.stringify(pr.payout || null);
  var h = 5381;
  for (var i = 0; i < s.length; i++){ h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; }
  return 'h' + h.toString(36);
}

/* JRA(中央)開催場と、学習DBから除外する地方競馬の開催場 */
var DI_CENTRAL = ['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉'];
var DI_LOCAL_V = ['ホッカイドウ','ばんえい','帯広','門別','盛岡','水沢','船橋','川崎','浦和','大井','金沢','笠松','名古屋','園田','姫路','高知','佐賀','荒尾','福山','益田','その他'];
/* 本文に「地方場名だけ」が出ているとき=地方競馬のレースとみなし除外 */
function diIsLocalRace(txt){
  var cen = 0, loc = 0;
  for (var i = 0; i < DI_CENTRAL.length; i++){ if (txt.indexOf(DI_CENTRAL[i]) >= 0){ cen++; break; } }
  for (var j = 0; j < DI_LOCAL_V.length; j++){ if (txt.indexOf(DI_LOCAL_V[j]) >= 0){ loc++; break; } }
  return !cen && loc > 0;
}
/* 開催日の一覧(netkeiba) → [{rid, rnum, name}] （JRA=中央開催のみ・地方は除外） */
function diParseDateList(html){
  var out = [], seen = {};
  // 各レースは <li class="RaceList_DataItem…"> … <span class="ItemTitle">レース名</span> … </li>
  var re = /<li[^>]*class="[^"]*RaceList_DataItem[^"]*"[^>]*>([\s\S]*?)<\/li>/gi, lm;
  while ((lm = re.exec(html || '')) !== null){
    var body = lm[1];
    if (diIsLocalRace(bfStrip(body))) continue;   // 地方競馬のレースは学習DBへ入れない
    var idM = body.match(/race_id=(\d{12})/);
    if (!idM) continue;
    var rid = idM[1];
    if (seen[rid]) continue;
    seen[rid] = 1;
    // R番号はrace_id末尾2桁が正
    var rn = parseInt(rid.slice(-2), 10);
    var name = '';
    var nms = body.match(/ItemTitle">([\s\S]*?)<\/span>/gi) || [];
    for (var q = nms.length - 1; q >= 0; q--){
      var t = bfStrip(nms[q].replace(/^ItemTitle">/i, ''));
      if (t){ name = t; break; }
    }
    out.push({ rid: rid, rnum: rn, name: name });
  }
  out.sort(function(a, b){ return (a.rnum || 0) - (b.rnum || 0) || (a.rid < b.rid ? -1 : 1); });
  return out;
}
function diNetkeibaRaces(date8){
  return bfGet('https://race.netkeiba.com/top/race_list_sub.html?kaisai_date=' + date8).then(function(html){
    var items = diParseDateList(html);
    if (!items.length){
      // 古いフォーマット(トップの日別JSページ)へフォールバック
      return bfGet('https://race.netkeiba.com/top/race_list.html?kaisai_date=' + date8).then(function(h2){
        var items2 = diParseDateList(h2);
        if (items2.length) return items2;
        throw new Error('この開催日のレース一覧をnetkeibaに見つけられませんでした');
      });
    }
    return items;
  });
}

/* JRAフォールバック(直近約2ヶ月・開催済みのみ): 場ごとの全レースを列挙 */
function diJraVenueRaces(date8){
  if (typeof jvFetchDaySelect !== 'function' || typeof jvFetchRaceList !== 'function') return Promise.resolve([]);
  return jvFetchDaySelect().then(function(days){
    var codes = [];
    Object.keys(days).forEach(function(k){ if (k.indexOf(date8 + '|') === 0) codes.push(k.split('|')[1]); });
    if (!codes.length) return [];
    var seq = Promise.resolve();
    var out = [];
    codes.forEach(function(code){
      seq = seq.then(function(){
        return jvFetchRaceList(days[date8 + '|' + code]).then(function(list){
          list.forEach(function(r){ out.push({ r: r.r, name: r.name || '', token: r.token, code: code }); });
        }).catch(function(){});
      });
    });
    return seq.then(function(){ return out; });
  }).catch(function(){ return []; });
}
function diParseJraResult(html, venue, rnum, date8){
  // JRA レース結果の表: 着順/枠/馬番/馬名/性齢/負担重量/騎手名/タイム/着差/
  // コーナー通過順位/平均1F/馬体重(増減)/調教師名/単勝人気
  var out = { rows: [], n: 0 };
  var tbs = (html || '').match(/<table[^>]*>([\s\S]*?)<\/table>/gi) || [];
  var seg = null;
  for (var i = 0; i < tbs.length; i++){
    if (/class="place"|>着順<|コーナー/.test(tbs[i]) && /class="horse"/.test(tbs[i])){ seg = tbs[i]; break; }
  }
  if (!seg) return out;
  var trs = seg.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
  for (var k = 0; k < trs.length; k++){
    var tr = trs[k];
    if (!/<td[^>]*class="place"/.test(tr)) continue;
    var g = function(cls){
      var m = tr.match(new RegExp('<td[^>]*class="' + cls + '"[^>]*>([\\s\\S]*?)<\\/td>', 'i'));
      return m ? bfStrip(m[1]) : '';
    };
    var order = parseInt(g('place'), 10);
    if (isNaN(order)) continue;
    var no = g('num');
    var name = '';
    var nm = tr.match(/<td[^>]*class="horse"[^>]*>([\s\S]*?)<\/td>/i);
    if (nm){
      var am = nm[1].match(/<a[^>]*>([\s\S]*?)<\/a>/i);
      name = bfStrip(am ? am[1] : nm[1]);
    }
    var corner = '';
    var cm = tr.match(/<td[^>]*class="corner"[^>]*>([\s\S]*?)<\/td>/i);
    if (cm){
      var cs = cm[1].match(/<li[^>]*>([^<]*)<\/li>/g) || [];
      corner = cs.map(function(x){ return bfStrip(x); }).filter(Boolean).join('-');
    }
    var wt = g('h_weight').replace(/\s+/g, '');
    var pop = g('pop');
    out.rows.push({
      order: order, frame: '', no: no, name: name, id: '',
      sexAge: g('age'), weight: g('weight'), jockey: g('jockey'), time: g('time'),
      margin: g('margin'), passing: corner, last3: '', odds: '', pop: pop,
      weightChg: wt, trainer: g('trainer')
    });
  }
  out.rows.sort(function(a, b){ return a.order - b.order; });
  out.n = out.rows.length;
  /* ★2026-09-12 第16弾（第14弾の残件を解消）: JRA版でも meta.surface を埋めます。
     これが空だと「障害レースは障害同士だけで比較する」判定がレース名だけに頼ることになり、
     芝2860m のような障害専用距離を平地の時計と混ぜてしまうおそれがあります。
     JRA の結果ページには「芝 2000m」「ダート 1800m」「障害 2850m」と距離が書いてあるので、
     そこから 面(芝/ダート/障害)・距離(m)・馬場状態・天候 を拾います。 */
  var meta = { name: '', date8: date8 || '', place: venue || '', rnum: String(rnum || ''), grade: '',
               surface: '', m: 0, dist: '', baba: '', tenko: '' };
  var whole = bfStrip(html || '');
  var nmM = whole.match(/(\d{1,2})\s*R\s*([\s\S]{0,40}?)(?:\s|$)/);
  var tM = whole.match(/(芝|ダート|障(?:害)?)\s*(?:右|左|直|内|外)?\s*(\d{3,4})\s*m/);
  if (tM){
    meta.surface = /障/.test(tM[1]) ? '障' : (/ダ/.test(tM[1]) ? 'ダ' : '芝');
    meta.m = parseInt(tM[2], 10) || 0;
    meta.dist = meta.surface + meta.m + 'm';
  } else {
    // 距離が取れないときはレース名から面だけ推定（「障害〜」を含む場合は障害）
    var rn = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    rn = bfStrip(rn);
    meta.name = rn;
    if (/障害/.test(whole)) meta.surface = '障';
  }
  var bM = whole.match(/(?:芝|ダート|障害)\s*[:：]?\s*(良|稍重|重|不良)/);
  if (bM) meta.baba = bM[1];
  var wM = whole.match(/天候\s*[:：]?\s*(晴|曇|雨|小雨|雪|小雪|霧)/);
  if (wM) meta.tenko = wM[1];
  if (!meta.name){
    var h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '';
    meta.name = bfStrip(h1);
  }
  out.meta = meta;
  return out;
}

/* ===== 実行 ===== */
/* ★2026-09-12 第16弾: 学習DBのレコードに「追加情報」も保存します。
   追加情報(xd) = コーナー通過順（1〜4角の生テキスト＋馬番ごとの位置）
                + ペース（S/M/H）+ 200mごとのラップタイム + 払戻（全8券種）
   目的: ・展開が向く/向かない（ハイペースだと走る、スローだと届かない）の学習
        ・開催日が経つにつれて「コーナー通過順による有利不利（バイアス）」を判別する
        ・オッズ妙味・回収率の精度を上げる（払戻を全レースぶん持つ）
   ※ ラップもコーナーも同じ結果ページのHTMLに入っているので、追加の通信は不要です。 */
var DI_XD_EXTRA = true;   // DB結果ページにラップ/コーナーが無かったとき、PC結果ページを1回だけ取りに行く

/* 結果ページHTMLから追加情報を抜き出して、保存用のコンパクト形式にする */
function diExtractXD(html, pr){
  if (typeof rdParseExtra !== 'function' || typeof rdCompact !== 'function') return null;
  try {
    var ex = rdParseExtra(html, { dist: (pr && pr.meta && pr.meta.m) || 0 });
    if (!ex || !ex.ok) return null;
    var xd = rdCompact(ex, (pr && pr.rows && pr.rows.length) || 0);
    if (pr && pr.payout) xd.payout = pr.payout;   // 払戻は既存パーサの結果を優先
    return xd;
  } catch(e){ return null; }
}

/* 1レースぶんの保存（diImportDate のループから呼ばれる） */
function diSaveOne(it, date8, pr, xd, result, progress){
  var h = diHash(pr);
  var old = diGet(it.rid);   // 既存の保存レコード（旧形式なら更新して払戻＋追加情報を付ける）
  // すでに「払戻対応版(payv=1)＋追加情報版(xdv=1)」で内容も同一なら何もしない。
  // 旧版(払戻なし / ラップ・コーナーなし)は内容が同一でも保存し直して、
  // 全券種の払戻＋コーナー通過順・ペース・200mラップつきデータへ更新する。
  if (old && old.payv === 1 && old.xdv === 1 && old.h === h){ result.dup++; return; }
  var rec = {
    rid: it.rid, date8: date8, at: new Date().toISOString(), h: h,
    meta: { name: pr.meta.name, date8: pr.meta.date8 || date8, date: pr.meta.date,
            place: pr.meta.place, rnum: pr.meta.rnum, grade: pr.meta.grade,
            // 🎓タイム換算の学習に使う（面・距離・馬場状態・天候）
            surface: pr.meta.surface || '', m: pr.meta.m || 0, dist: pr.meta.dist || '',
            baba: pr.meta.baba || '', tenko: pr.meta.tenko || '' },
    n: pr.n, source: 'netkeiba', rows: pr.rows,
    // 払戻(全券種): payout=券種別{nos,pays} 正規化 / payouts=的中1件ごとの生リスト
    payout: pr.payout || null, payouts: pr.payouts || null,
    payv: 1,  // 全券種払戻対応版で保存したバージョン印(1=対応済み)
    // 第16弾: コーナー通過順・ペース(S/M/H)・200mごとのラップタイム（展開学習とバイアス判別用）
    xd: xd || null, xdv: xd ? 1 : 0
  };
  if (diSet(it.rid, rec)){
    if (old){ result.upg++; }   // 旧保存レコードを払戻つきへ更新
    else { result.ok++; }
    // 既存の自己検証レコードにも全券種払戻を反映(あれば)
    if (typeof apPatchPayout === 'function'){ try { apPatchPayout(it.rid, rec.payout, rec.payouts); } catch(e){} }
    // 第16弾: 自己検証レコードにもコーナー通過順・ペース・ラップを反映(あれば)
    if (xd && typeof apPatchExtra === 'function'){ try { apPatchExtra(it.rid, xd); } catch(e){} }
  }
  else { result.limit++; }   // この1件だけ保存不可（既存データは無傷）
  // 自動: AI印を合成して払戻結果と比較・実績DBへ（重複は内部でスキップ）
  // 出遅れ率(手動入力/自動検出の両方)も馬番対応で渡し、予想の学習に使う
  if (typeof apEval === 'function'){
    try {
      var slowMap2 = (it.slowMap || null);
      if (!slowMap2 && typeof state !== 'undefined' && state && Array.isArray(state.horses)){
        slowMap2 = [];
        state.horses.forEach(function(hx){ if (hx && hx.no != null) slowMap2.push({ no: hx.no, slow: hx.slow }); });
      }
      if (slowMap2) pr = Object.assign({}, pr, { slowMap: slowMap2 });
      apEval(pr, it.rid);
    } catch(e){}
  }
}

function diImportDate(date8, progress){
  progress = progress || function(){};
  diEvictedRun = 0;
  var result = { ok: 0, dup: 0, upg: 0, skip: 0, errors: 0, source: '', limit: 0, evicted: 0, xdExtra: 0 };
  if (!diStorageOK()){
    progress('⚠ この環境では保存領域(localStorage)が使えないため保存できません。このプレビュー画面ではなく、ダウンロードした index.html をブラウザで直接開いて実行してください。', true);
  }
  return diNetkeibaRaces(date8).then(function(items){
    result.source = 'netkeiba';
    if (!items.length) throw new Error('この日のレースが見つかりません');
    progress(items.length + ' レースを検出しました（netkeiba）。結果を1レースずつ取得中…');
    var seq = Promise.resolve();
    items.forEach(function(it){
      seq = seq.then(function(){
        return bfGet('https://db.netkeiba.com/race/' + it.rid + '/').then(function(html){
          var pr = bfParseDbResult(html);
          if (!pr.rows.length || !pr.n){ result.errors++; return; }
          /* ★2026-09-12 第16弾: コーナー通過順・ペース(S/M/H)・200mごとのラップタイム・払戻 を
             「すでに取得した同じHTML」から追加で抜き出します（追加通信ゼロ）。
             DB結果ページにラップ／コーナーのブロックが無かった場合だけ、
             レース結果ページ(PC版)を1回取りに行きます（DI_XD_EXTRA=false で止められます）。 */
          var xd = diExtractXD(html, pr);
          var needXD = !xd || (!(xd.laps && xd.laps.length) && !(xd.corners && xd.corners.length));
          var pXD = (needXD && DI_XD_EXTRA && typeof bfGet === 'function')
            ? bfGet('https://race.netkeiba.com/race/result.html?race_id=' + it.rid).then(function(h2){
                var x2 = diExtractXD(h2, pr);
                if (x2 && ((x2.laps && x2.laps.length) || (x2.corners && x2.corners.length))){
                  xd = x2; result.xdExtra++;
                }
                return null;
              }).catch(function(){ return null; })
            : Promise.resolve(null);
          return pXD.then(function(){ return diSaveOne(it, date8, pr, xd, result, progress); });
        }).catch(function(){ result.errors++; });
      });
    });
    return seq.then(function(){
      result.evicted = diEvictedRun;
      if (typeof tlLearnSchedule === 'function'){ try { tlLearnSchedule(6000); } catch(e){} }   // 🎓タイム換算の学習（連続取込中はまとめて1回）
      var evMsg = result.evicted
        ? '　⚠ 保存領域が満杯になったため、最も古いレースから ' + result.evicted + ' 件を自動で削除して新しい分を保存しました（古い順に上書き）。' : '';
      if (typeof apRender === 'function'){ try { apRender(); } catch(e){} }   // 自己学習(3モデル・年月集計)の表示更新
    if (typeof pfSchedule === 'function'){ try { pfSchedule(); } catch(e){} } // ★第16弾: 展開学習(ペース適性・コーナー通過順バイアス)を再集計
    if (typeof hfDropCache === 'function'){ try { hfDropCache(); } catch(e){} } // ★第17弾: 履歴特徴のインデックスを作り直す
    if (typeof flDrop === 'function'){ try { flDrop(); } catch(e){} } // ★第17弾・提案4: ファクター別学習を集計し直す
      var sessTx1 = (typeof apSessText === 'function') ? apSessText() : '';
      progress('完了: 保存 ' + (result.ok + result.upg) + ' レース（新規 ' + result.ok +
        (result.upg ? ' / 旧保存データを全券種払戻つきへ更新 ' + result.upg : '') +
        (result.dup ? ' / 同一のためスキップ ' + result.dup : '') +
        ' / 取得失敗 ' + result.errors +
        '）※各レースに単勝・複勝・枠連・ワイド・馬連・馬単・3連複・3連単の払戻金も保存しました' +
        (result.upg ? '。自己検証レコードへも反映済みです。すでに保存済みの過去分をまとめて全券種払戻つきへ補完するには、同じ年を「年指定一括取込」で再実行してください' : '') +
        (sessTx1 ? '　🔁 今回の3モデル実測: ' + sessTx1 + '（的中率・回収率の詳細は自己学習欄）' : '') +
        evMsg +
        (result.limit ? '　⚠ 消去できる古いデータが残っておらず ' + result.limit + ' 件は保存できませんでした。' : ''));
      return result;
    });
  }).catch(function(netErr){
    // フォールバック: JRA公式（直近約2ヶ月のみ）
    return diJraVenueRaces(date8).then(function(races){
      if (!races.length) throw netErr;
      result.source = 'jra';
      progress(races.length + ' レースを検出しました（JRA公式・直近約2ヶ月のみ）。結果を取得中…');
      var seq = Promise.resolve();
      races.forEach(function(r){
        seq = seq.then(function(){
          var url = 'https://www.jra.go.jp/JRADB/accessS.html?CNAME=' + r.token;
          return bfGet(url).then(function(html){
            var pr = diParseJraResult(html, '', r.r, date8);
            if (!pr.rows.length){ result.errors++; return; }
            var h = diHash(pr);
            var rid = 'JRA' + date8 + r.code + ('0' + (r.r || 0)).slice(-2);
            var old = diGet(rid);
            var xdJ = diExtractXD(html, pr);   // 第16弾: JRAページにもコーナー/ラップがあれば拾う
            var xdvJ = xdJ ? 1 : 0;
            if (old && old.payv === 1 && (old.xdv || 0) === xdvJ && old.h === h){ result.dup++; return; }
            var mJ = pr.meta || {};
            var rec = {
              rid: rid, date8: date8, at: new Date().toISOString(), h: h,
              // 第16弾: meta.surface/m/dist/baba/tenko を追加（第14弾の残件＝障害の区別を確実にする）
              meta: { name: r.name || mJ.name || '', date8: date8, place: mJ.place || '', rnum: String(r.r || ''), grade: '',
                      surface: mJ.surface || '', m: mJ.m || 0, dist: mJ.dist || '',
                      baba: mJ.baba || '', tenko: mJ.tenko || '' },
              n: pr.n, source: 'jra', rows: pr.rows,
              payout: pr.payout || null, payouts: pr.payouts || null,
              payv: 1,
              xd: xdJ || null, xdv: xdvJ
            };
            if (diSet(rid, rec)){
              if (old){ result.upg++; } else { result.ok++; }
              if (typeof apPatchPayout === 'function'){ try { apPatchPayout(rid, rec.payout, rec.payouts); } catch(e){} }
              if (xdJ && typeof apPatchExtra === 'function'){ try { apPatchExtra(rid, xdJ); } catch(e){} }
            }
            else { result.limit++; }
          }).catch(function(){ result.errors++; });
        });
      });
      return seq.then(function(){
        result.evicted = diEvictedRun;
        if (typeof tlLearnSchedule === 'function'){ try { tlLearnSchedule(6000); } catch(e){} }   // 🎓タイム換算の学習
        var evMsg2 = result.evicted
          ? '　⚠ 保存領域が満杯になったため、最も古いレースから ' + result.evicted + ' 件を自動で削除して新しい分を保存しました。' : '';
        if (typeof apRender === 'function'){ try { apRender(); } catch(e){} }
        var sessTx2 = (typeof apSessText === 'function') ? apSessText() : '';
        progress('完了(JRA): 保存 ' + result.ok + ' / 同一内容でスキップ ' + result.dup + ' / 失敗 ' + result.errors + ' レース（上り3FはJRA表に無いため空欄）' +
          (sessTx2 ? '　🔁 今回の3モデル実測: ' + sessTx2 + '（詳細は自己学習欄）' : '') +
          evMsg2 +
          (result.limit ? '　⚠ 消去できる古いデータがなく ' + result.limit + ' 件は保存できませんでした。' : ''));
        return result;
      });
    });
  });
}

/* ===== バックアップ(JSON) 保存 / 復元 ===== */
function diExport(){
  var db = diLs();
  var blob;
  try {
    var json = JSON.stringify({ app: 'keiba-date-db', exported: new Date().toISOString(), count: Object.keys(db.races).length, races: db.races });
    blob = new Blob([json], { type: 'application/json' });
  } catch(e){ diStatus('バックアップの生成に失敗しました: ' + (e && e.message || e), true); return; }
  try {
    var a = document.createElement('a');
    var d = new Date();
    var fname = 'keiba_date_backup_' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '.json';
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    (document.body || document.documentElement).appendChild(a);
    a.click();
    diStatus('💾 バックアップを保存しました（' + Object.keys(db.races).length + ' レース）。ダウンロードが始まります。');
  } catch(e){ diStatus('ダウンロードに失敗しました: ' + (e && e.message || e), true); }
}
function diImportFile(file){
  if (!file) return;
  var rd = new FileReader();
  rd.onload = function(){
    try {
      var o = JSON.parse(String(rd.result || ''));
      var races = (o && o.races) ? o.races : (Array.isArray(o) ? o : null);
      if (!races){ diStatus('バックアップファイルの形式が違います', true); return; }
      var add = 0, exist = 0;
      Object.keys(races).forEach(function(rid){
        var rec = races[rid];
        if (!rec || !rec.rid) return;
        if (diGet(rid)){ exist++; return; }
        if (diSet(rid, rec)) add++;
      });
      var tot = 0; try { tot = diCount(); } catch(e){}
      diStatus('📥 <b>バックアップから復元しました</b>: 追加 <b>' + add + ' レース</b>／既にあったのでスキップ ' + exist + ' レース。' +
        '　学習DBは合計 <b>' + tot + ' レース</b>になりました。' +
        (add ? '<br>🎓 <b>タイム換算の学習を自動でやり直します</b>（数秒かかります。②の⏱評価と🎯/⚠️の基準が新しくなります）。' :
               '<br>（新しいデータが無かったので、学習はやり直していません）') +
        (typeof diMode !== 'undefined' && diMode === 'ls' ? '<br><span class="small">※ いまの保存先は localStorage（5MB制限）です。IndexedDB が使えるブラウザなら容量は実質無制限になります。</span>' : ''));
      diRenderStat();
      if (typeof tlLearnSchedule === 'function' && add){ try { tlLearnSchedule(1500); } catch(e){} }   // 🎓タイム換算の学習
    } catch(e){ diStatus('バックアップの読込に失敗しました: ' + (e && e.message || e), true); }
  };
  rd.onerror = function(){ diStatus('ファイルを読み込めませんでした', true); };
  rd.readAsText(file);
}
function diBindStatBtns(){
  var cap = $('diCap');
  if (cap) cap.addEventListener('click', function(){
    if (diMode === 'idb'){
      diStatus('📏 IndexedDB（大容量）に保存されています。残量を実測中…');
      diFreeNote(function(txt){
        diStatus('📏 ' + txt + '。IndexedDBはブラウザの空きディスク容量に応じて実用上 数百MB〜数GB まで増やせます（キーやファイルを分ける必要なし）。念のため定期的に「💾 バックアップ保存」もおすすめします。', false);
      });
    } else {
      var free = diProbeFree();
      var n = Math.floor(free / DI_PER_RACE);
      diStatus('📏 この環境では IndexedDB が使えないため、従来の保存領域（通常5〜10MB）です。空き: 約 ' + Math.round(free / 1024) + ' KB（= およそ ' + n + ' レースぶん）。大容量で保存したい場合は、ダウンロードした index.html を Chrome/Edge/Firefox などで直接開き直してください（開いた時点で自動で IndexedDB へ移行します）。', free < 100000);
    }
  });
  var exp = $('diExp');
  if (exp) exp.addEventListener('click', diExport);
  var imp = $('diImp');
  if (imp) imp.addEventListener('click', function(){ var f = $('diFile'); if (f) f.click(); });
  var fi = $('diFile');
  if (fi) fi.addEventListener('change', function(){ diImportFile(fi.files && fi.files[0]); fi.value = ''; });
}

/* ===== 年指定バルク取得（タスク4） ===== */
var DI_YEAR_BUSY = false, DI_YEAR_CANCEL = false;
function diYearMsgSet(msg, isErr){
  var el = $('diYearMsg'); if (!el) return;
  el.innerHTML = (isErr ? '⚠ ' : '') + esc(msg);
  el.style.color = isErr ? '#b3261e' : '';
}
function diYearBar(pct, show){
  var w = $('diYearBarWrap'), b = $('diYearBar');
  if (w) w.classList.toggle('hid', !show);
  if (b) b.style.width = Math.max(0, Math.min(100, pct)) + '%';
}
function diYearUiBusy(b){
  var btn = $('diYearBtn'), stp = $('diYearStop');
  if (btn) btn.disabled = b;
  if (stp) stp.classList.toggle('hid', !b);
}
function diYearBuild(){
  var sel = $('diYear'); if (!sel) return;
  var nowY = new Date().getFullYear();
  var html = '';
  // netkeibaが日別一覧を返せる範囲(およそ2006年以降)を下限に、今年-1を初期選択
  for (var y = nowY; y >= 2006; y--){
    var isDef = (y === nowY - 1) ? ' selected' : '';
    html += '<option value="' + y + '"' + isDef + '>' + y + '年</option>';
  }
  sel.innerHTML = html;
  var btn = $('diYearBtn');
  if (btn) btn.addEventListener('click', function(){
    if (DI_YEAR_BUSY) return;
    var y = parseInt(sel.value, 10);
    if (!y){ diYearMsgSet('年を選択してください', true); return; }
    DI_YEAR_BUSY = true; DI_YEAR_CANCEL = false;
    diYearUiBusy(true);
    diYearMsgSet(y + '年の開催日を検出しています（netkeibaカレンダー）…');
    diImportYear(y, function(m, err){ diYearMsgSet(m, !!err); }).then(function(tot){
      diYearUiBusy(false);
      DI_YEAR_BUSY = false;
      diRenderStat();
      // 🎓 タイム換算の学習: 取り込んだ全レースの勝ち時計から「距離×クラス×競馬場×年×馬場」の基準時計を学び直す
      if (typeof tlLearnRun === 'function'){
        try { tlLearnRun(false); } catch(e){ diYearMsgSet('⚠ タイム換算の学習でエラー: ' + (e && e.message || e), true); }
      }
      if (typeof diCount === 'function'){ var cur = diCount(); diYearMsgSet('累計保存レース数: ' + cur + '（この回: 追加 ' + tot.ok + ' / 旧データを全券種払戻つきへ更新 ' + tot.upg + ' / スキップ ' + tot.dup + ' / 失敗 ' + tot.fail + '）'); }
    });
  });
  var stp = $('diYearStop');
  if (stp) stp.addEventListener('click', function(){
    if (DI_YEAR_BUSY){ DI_YEAR_CANCEL = true; diYearMsgSet('⏹ 中断しています…（現在の1日分の取込が終わり次第停止します）', false); stp.disabled = true; }
  });
  diYearMsgSet('年を選んで「📥 この年の全レースを一括取得・学習DBへ保存」を押すと、その年のJRA開催日・JRA全レース（場ごと1〜12R）を自動検出して学習DBへ保存します。', false);
}
/* 指定年の開催日一覧を netkeibaカレンダー(年×月)から収集 */
function diYearDates(year){
  var seq = Promise.resolve(), dates = [], seen = {};
  function push(d){
    if (!seen[d] && String(d).indexOf(String(year)) === 0){ seen[d] = 1; dates.push(d); }
  }
  for (var m = 1; m <= 12; m++){
    (function(month){
      seq = seq.then(function(){
        return bfGet('https://race.netkeiba.com/top/calendar.html?year=' + year + '&month=' + month).then(function(html){
          var re = /kaisai_date=(\d{8})/g, mm;
          while ((mm = re.exec(html || '')) !== null) push(mm[1]);
        }).catch(function(){});
      });
    })(m);
  }
  return seq.then(function(){
    dates.sort();
    // 未来日・未実施日は除外（当日より前のみ）
    var d = new Date();
    var today = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    return dates.filter(function(x){ return parseInt(x, 10) < today; });
  });
}
/* 年指定バルク本体: 開催日→diImportDateを1日ずつ直列実行（重複は内部で自動スキップ） */
function diImportYear(year, msg){
  msg = msg || function(){};
  var totals = { ok: 0, dup: 0, upg: 0, fail: 0, noRace: 0, limit: 0, evicted: 0 };
  return diYearDates(year).then(function(dates){
    if (!dates.length){
      msg(year + '年の開催日が見つかりませんでした（netkeibaカレンダーに未掲載の年です）', true);
      return totals;
    }
    msg(year + '年のJRA開催日を ' + dates.length + ' 日 検出しました。すでに全券種払戻つきで保存済みの日は飛ばして、未取得の日と旧形式（払戻未保存）で保存されている日だけを取り込みます…');
    // スキップ判定: 日付ごとに「全券種払戻つきで保存済み(payv=1)」のレコードだけが揃っている日は
    // 読み飛ばし、①まだ1件も保存のない日、②旧バージョンで保存した払戻なしレコード(payv無し)を
    // 含む日 を取り込む。②は全券種の払戻を補完するための再取得(内部で同一レコードはスキップ/更新)。
    var savedDates = {};
    var needDate = {};
    var _db = diLs();
    var _ks = Object.keys(_db.races || {});
    for (var _q = 0; _q < _ks.length; _q++){
      var _r = _db.races[_ks[_q]];
      if (!_r) continue;
      var _d8 = String(_r.date8 || '');
      savedDates[_d8] = 1;
      if (_r.payv !== 1) needDate[_d8] = (needDate[_d8] || 0) + 1;   // 旧形式レコードあり
    }
    var pending = dates.filter(function(d8){
      if (!savedDates[d8]) return true;         // 未取得の日
      if (needDate[d8]) return true;            // 払戻未保存レコードを含む日 → 補完のため再取込
      return false;
    });
    var skippedDays = dates.length - pending.length;
    if (typeof apSessReset === 'function'){ try { apSessReset(); } catch(e){} }   // 今回の一括取込セッションとして集計開始
    diYearBar(0, true);
    if (!pending.length){
      diYearBar(0, false);
      if (typeof apRender === 'function'){ try { apRender(); } catch(e){} }
      msg('✅ ' + year + '年のレースはすべて全券種払戻つきで保存済みです（' + skippedDays + '開催日・重複なし）。取得・再保存は行いません。新たに取り込みたい年を選んでください。' +
        apYearInfo(year));
      return totals;
    }
    msg(year + '年のうち、未取得または旧形式(払戻未保存)の ' + pending.length + ' 開催日（全 ' + dates.length + ' 日のうち全券種払戻つき保存済み ' + skippedDays + ' 日はスキップ）を1日ずつ取り込みます…');
    var seq = Promise.resolve();
    pending.forEach(function(d8, idx){
      seq = seq.then(function(){
        if (DI_YEAR_CANCEL) return;
        return diImportDate(d8, function(/* dayMsg */){ /* 日ごとの詳細は累計表示に集約 */ })
          .then(function(r){
            totals.ok += r.ok; totals.upg += r.upg || 0; totals.dup += r.dup; totals.fail += r.errors;
            totals.limit += r.limit || 0; totals.evicted += r.evicted || 0;
            var dstr = d8.slice(0, 4) + '/' + (+d8.slice(4, 6)) + '/' + (+d8.slice(6, 8));
            var pct = ((idx + 1) / dates.length) * 100;
            diYearBar(pct, true);
            msg('（' + (idx + 1) + '/' + pending.length + '日目）' + dstr + ' … 追加 ' + r.ok + (r.upg ? ' / 旧データを払戻つきへ更新 ' + r.upg : '') + ' / 同一スキップ ' + r.dup + ' / 失敗 ' + r.errors + ' ／ 累計保存 ' + totals.ok +
              (r.evicted ? '　⚠ この日は満杯のため古いデータを ' + r.evicted + ' 件削除して保存（古い順に上書き）' : ''));
            return r;
          })
          .catch(function(e){
            totals.noRace++;
            msg('（' + (idx + 1) + '/' + dates.length + '日目）' + d8 + ' は取り込めませんでした（開催なし・ページ無し等）', false);
            return null;
          });
      });
    });
    return seq.then(function(){
      diYearBar(0, false);
      if (typeof apRender === 'function'){ try { apRender(); } catch(e){} }   // 自己学習(3モデル・年月集計)表示
      var apInfo = '';
      try {
        if (typeof apYms === 'function'){
          var mcs = apYms().filter(function(y){ return String(y).indexOf(String(year)) === 0; }).length;
          if (mcs) apInfo = '　🔁 自己学習(🎯的中率重視/💰回収率重視/🔰ハイブリッド)を' + year + '年分の月ごとに自動集計しました（' + mcs + 'か月分・DB保存）。翌月以降の予想へ自動反映されます。';
          if (typeof apSessText === 'function'){ var sTy = apSessText(); if (sTy) apInfo += '　📊 今回一括取得したデータでの実測: ' + sTy + '（詳細は「AI予想の自己学習」欄）'; }
        }
      } catch(e){}
      var tail = DI_YEAR_CANCEL ? '（⏹ 中断しました。再実行すると未取込・未更新の日から続行できます）' : '';
      msg('✅ ' + year + '年の取込を終了: 追加 ' + totals.ok + ' / 旧保存データを全券種払戻つきへ更新 ' + totals.upg + ' / 既存スキップ ' + totals.dup + ' / 失敗 ' + totals.fail + ' レース' + tail +
        (totals.evicted ? '　⚠ 途中で保存領域が満杯になったため、最も古いレースから計 ' + totals.evicted + ' 件を自動削除して新しい分を保存しました（古い順に上書き）。' : '') +
        (totals.limit ? '　⚠ 消去できる古いデータが残っておらず ' + totals.limit + ' 件は保存できませんでした。' : '') + apInfo);
      return totals;
    });
  });
}

/* 年の取り込み後に自己学習の集計状況を表示するヘルパー */
function apYearInfo(year){
  var s2 = '';
  try {
    if (typeof apYms === 'function'){
      var mcs = apYms().filter(function(y){ return String(y).indexOf(String(year)) === 0; }).length;
      if (mcs) s2 += '　🔁 自己学習を' + year + '年分の月ごとに集計済み（' + mcs + 'か月分・DB保存）。';
      if (typeof apSessText === 'function'){ var sTy = apSessText(); if (sTy) s2 += '　📊 今回一括取得したデータでの実測: ' + sTy; }
    }
  } catch(e){}
  return s2;
}

function diStatus(msg, isErr){
  var el = $('diMsg'); if (!el) return;
  el.innerHTML = (isErr ? '⚠ ' : '') + esc(msg);
  el.style.color = isErr ? '#b3261e' : '';
}
function diRenderStat(){
  var el = $('diStat'); if (!el) return;
  var db = diLs();
  var n = Object.keys(db.races).length;
  var last = null, t = 0;
  for (var k in db.races){ var r = db.races[k]; if (r.at > t){ t = r.at; last = r; } }
  var work = diStorageOK();
  var mb = (diUsedBytes() / 1048576).toFixed(1);
  var sizeTxt = '';
  if (!work){
    sizeTxt = '　<span style="color:var(--err-ink)">⚠ このプレビュー環境では保存できません（ダウンロードした index.html をブラウザで直接開いてください）</span>';
  } else if (diMode === 'idb'){
    sizeTxt = '　（IndexedDB 大容量保存中: 目安 <b>' + mb + ' MB</b> 使用 ／ 残量は下で実測表示 <span id="diRest"></span>）';
  } else {
    var hiddenIdb = false;
    try { hiddenIdb = !!localStorage.getItem(DI_IDB_MARK); } catch(e){}
    if (hiddenIdb){
      sizeTxt = '　<span style="color:var(--err-ink)">⚠ 以前は IndexedDB（大容量）に保存されていましたが、現在の環境では IndexedDB が使えないため大容量側のデータが表示できません。Chrome/Edge/Firefox などで index.html を直接開いてください（データは消えていません）。</span>';
    } else {
      sizeTxt = '　（この端末で約 <b>' + mb + ' MB</b> を使用中。この環境は IndexedDB 未使用のため通常 5〜10MB 制限です）';
    }
  }
  el.innerHTML =
    '保存済み: <b>' + n + '</b> レース' + sizeTxt +
    (last ? '<br>最後の取込: ' + esc(String(last.date8 || '')) + '（' + esc(String(last.meta && last.meta.name || '').slice(0, 18) || last.rid) + ' など）' : '') +
    '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' +
      (n ? '<button type="button" class="btn ghost" id="diClr" style="font-size:.72rem;padding:1px 8px">🗑 全消去</button>' : '') +
      '<button type="button" class="btn ghost" id="diCap" style="font-size:.72rem;padding:1px 8px">📏 保存できる量を確認</button>' +
      (n ? '<button type="button" class="btn ghost" id="diExp" style="font-size:.72rem;padding:1px 8px" title="学習DBの全レースを keiba_date_backup_YYYYMMDD.json としてダウンロードします。端末を変えたり保存領域が消えたときの保険です。">💾 バックアップ保存(JSON)</button>' : '') +
      '<button type="button" class="btn ghost" id="diImp" style="font-size:.72rem;padding:1px 8px" title="「💾 バックアップ保存(JSON)」で下载した keiba_date_backup_YYYYMMDD.json を選ぶと、中身のレースを学習DBに戻します。既にあるレースはスキップされ、追加があったときは🎓タイム換算の学習を自動でやり直します。">📥 バックアップから復元(JSON)</button>' +
      '<input type="file" id="diFile" accept=".json" style="display:none">' +
    '</div>' +
    '<div style="margin-top:4px;font-size:10px;color:var(--mut);line-height:1.55">' +
      '☛ 日別の学習データは index.html の中ではなく <b>この端末のブラウザ保存領域</b> に蓄積されます。index.html を新しいファイルに差し替えても消えません。' +
      '消えるのは「ファイルを開く場所(URL)が変わったとき」「iOS Safari が長期間使われない保存データを自動整理したとき」「保存領域が一杯で古い順に自動整理されたとき」です。' +
      '<br>※ 自動整理は日付の古い順(今季より昨季、昨季より一昨季が先)。確実に年単位で残したいレースは、この下の“💾 バックアップ保存(JSON)”を定期的に押してJSONファイルで持っておいてください。' +
    '</div>';
  var cb = $('diClr');
  if (cb) cb.addEventListener('click', function(){
    if (!window.confirm || window.confirm('学習DB(日別結果)を本当に全消去しますか？ 必要なら先に「💾 バックアップ保存」をおすすめします。')) {
      diRemoveAll();
      diRenderStat();
      diStatus('学習DB(日別結果)を全消去しました。');
    }
  });
  diBindStatBtns();
  // IndexedDBモード時は「あとどれくらい保存できるか」を実測して下に表示
  if (diMode === 'idb' && diStorageOK()){
    diFreeNote(function(txt){
      var e2 = $('diRest');
      if (e2) e2.textContent = txt;
    });
  }
}
function initDi(){
  /* 過去レースの学習DB取込は「年指定の一括取得」へ一本化（旧: 日付指定の1日分ボタンは廃止）。
     diImportDate は年指定バルク(diImportYear)から1日単位で引き続き利用される。 */
  diRenderStat();
  diYearBuild();
  diBoot();   // IndexedDB 大容量保存を開く（localStorage の旧データは自動移行）
}
/* p30(predict-result)や学習で利用できるようDB名だけ公開 */
function diCount(){ return Object.keys(diLs().races).length; }
