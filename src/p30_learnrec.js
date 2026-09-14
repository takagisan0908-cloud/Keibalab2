/* =========================================================
   30 AI予想の自己学習（3モデル印評価 × 年月ごと学習 → DB保存）
   ---------------------------------------------------------
   過去データ(日付指定・年指定の一括取込)で1レース取込むたびに、
   そのレースを「3種類のコンセプト(印評価モデル)」それぞれで
   AIが予想し直し、実際の着順・払戻と照合して学習する。

   ■ 3モデル（印評価の考え方）
     1. 的中率重視 (hit) : 単勝オッズ＋脚質から「当たりそうな馬」順に印
     2. 回収率重視 (roi) : 人気薄(中穴〜大穴＝およそ5番人気以下)から本命を選び、
        配当の大きい馬を狙う（印に単勝を賭けたと仮定した回収率を測る）
     3. ハイブリッド (hyb) : 上記2つをλで混ぜ、回収率100%以上を目指す
        （達成できなければ的中寄りへ、達成なら妙味寄りへ自動調整）

   ■ 学習は「年月ごと」
     - レースの開催年月(YYYYMM)ごとに成績を集計(DB: khl_apm_<ym> /
       IndexedDB store「learn」)し、開催が新しい月ほど直近の学習結果を参照
     - 「前の月まで」の集計から次に使うパラメータ(展開/脚質の信頼度 tm、
       妙味の上乗せ強さ rho、ハイブリッドの混合比 λ)を学習し、
       「今月・今後の予想」に反映する(過去の月を未来予想に使わない/のぞき見なし)
     - 成績・パラメータはその場の軽量キー＋IndexedDB の両方へ保存
       (IndexedDB 対応ブラウザでは自動で DB モードになり localStorage から移行)

   - 現在開いているレースは apEnsureLive() で自動記録し、結果取込時(結果メモ📥/
     日付・年指定取込)に同じように自己検証する（血統ファクター⑥の母集団としてこの記録を参照）
   ========================================================= */
var AP_PREFIX = 'khl_ap_';          // 記録本体: 1レース1キー
var AP_LEARN_LS = 'khl_aplearn_v1'; // 旧: 全期間の累積集計キー(移行確認に使用・以後は使わない)
var AP_YM_PREFIX = 'khl_apm_';      // 年月ごとの学習集計キー(localStorage 側)
var AP_DB = 'keiba_ap_v1';          // IndexedDB データベース名
var AP_REC_STORE = 'rec';           // レース記録本体
var AP_LRN_STORE = 'learn';         // 年月ごとの学習集計
var AP_MARK_ORDER = ['◎','○','▲','☆','△'];
var AP_MARK_STR = { '◎':5, '○':4, '▲':3, '☆':2, '△':1 };   // 印の強さ(単勝賭金ユニット)
var AP_CONCEPTS = [
  { id: 'hit', name: '的中率重視', color: '#1d4ed8', tag: '当たり重視', emoji: '🎯' },
  { id: 'roi', name: '回収率重視', color: '#b45309', tag: '中穴〜大穴狙い', emoji: '💰' },
  { id: 'hyb', name: 'ハイブリッド(回収率100%目標)', color: '#047857', tag: 'バランス', emoji: '🔰' }
];
/* 学習DBの保存モード('ls'=軽量キー / 'idb'=IndexedDB大容量) */
var apDb = null, apMode = 'ls', apRecMem = null, apLrnMem = null, apBootP = null;

/* ---------- 基本ヘルパ ---------- */
function apNow(){ try { return new Date().toISOString(); } catch(e){ return ''; } }
function apNum(s){ var x = parseFloat(String(s == null ? '' : s).replace(/[^0-9.]/g, '')); return isNaN(x) ? 0 : x; }
function apPct(a, b){ return b > 0 ? (a / b * 100).toFixed(1) : '0.0'; }
function apPct1(a, b){ return b > 0 ? (a / b * 100).toFixed(0) : '0'; }
function apDate8FromText(s){
  var m = String(s || '').match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  return m ? m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2) : '';
}
var AP_VENUES = ['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉'];
/* 開催年月(YYYYMM): date8 → 先頭6桁。rid(12桁: 先頭8桁が日付)からも拾う */
function apYmOf(date8, rid){
  var s = String(date8 || '');
  if (/^\d{8}$/.test(s)) return s.substring(0, 6);
  /* ★2026-09-12 修正: race_id の5〜6桁目は「月」ではなく**場コード**です
     (01札幌 02函館 03福島 04新潟 05東京 06中山 07中京 08京都 09阪神 10小倉)。
     従来はここを月として使っていたため、例) 東京のレースが全部「5月」に分類されていました。
     → 月が特定できないときは空を返し、そのレースは年月別の学習バケットに入れません
       （間違った月に入れて他の月の学習を汚すより安全）。 */
  return '';
}
/* 2026-09-11 第14弾: 障害レースは学習バケットを分けます。
   平地と障害はオッズの付き方も人気側の信頼度もまったく違うので、
   障害で学習したファクターは障害の予想にだけ、平地で学習したファクターは平地の予想にだけ使います。
   キーは 平地＝'202501'（従来どおり＝既存データはそのまま平地として読めます）／障害＝'202501#障'。 */
function apSurfOf(surface, name){
  var sf = String(surface || ''), n = String(name || '');
  if (/障害/.test(n)) return '障';
  if (sf.indexOf('障') >= 0) return '障';
  return '平地';
}
function apYmSurf(date8, rid, surface, name){
  var ym = apYmOf(date8, rid);
  if (!ym) return ym;
  return apSurfOf(surface, name) === '障' ? (ym + '#障') : ym;
}
function apYmIsSho(ym){ return String(ym || '').indexOf('#障') >= 0; }
function apYmTxt(ym){
  var s = String(ym || '');
  var d = s.replace(/#.*$/, '');
  var t = (d.length >= 6 && /^\d{6}$/.test(d)) ? (d.substring(0, 4) + '年' + parseInt(d.substring(4, 6), 10) + '月') : s;
  return apYmIsSho(s) ? (t + '（🚧障害）') : t;
}
function apCurYm(){
  var mm;
  try { mm = apMetaCur(); } catch(e){ mm = { date8: '' }; }
  var ym = apYmSurf(mm.date8, state && state.raceId || '', mm.surface, mm.name);
  if (ym) return ym;
  return apNowYm();
}
/* 今日の年月(yyyymm)。レースの開催日ではなく「実際のカレンダー」で見る。 */
function apNowYm(){
  var d = new Date();
  return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2);
}
/* バケットの年月部分（'#障' の区分を除いた6桁） */
function apYmNum(ym){
  var s = String(ym || '').replace(/#.*$/, '');
  return /^\d{6}$/.test(s) ? s : '';
}
/* 結果が確定している月かどうか。
   - future : 今日はまだ来ていない月（例: 9月なのに10月ぶんがある）＝結果が確定していない
   - cur    : 今月（開催途中＝結果が確定していない）
   - past   : 先月以前（結果確定）
   2026-09-12 第15弾: 月別の回収率表に「結果が確定していない月」を出さないための判定。 */
function apYmState(ym){
  var s = apYmNum(ym);
  if (!s) return 'past';
  var now = apNowYm();
  return (s > now) ? 'future' : (s === now ? 'cur' : 'past');
}
function apYmIsFinal(ym){ return apYmState(ym) === 'past'; }

/* ================= IndexedDB ラッパー(p32と同方式) ================= */
function apIdbAvail(){
  try { return !!(typeof indexedDB !== 'undefined' && indexedDB && indexedDB.open); } catch(e){ return false; }
}
function apOpenDb(){
  return new Promise(function(res, rej){
    try {
      var rq = indexedDB.open(AP_DB, 1);
      rq.onupgradeneeded = function(){
        var d = rq.result;
        if (!d.objectStoreNames.contains(AP_REC_STORE)) d.createObjectStore(AP_REC_STORE, { keyPath: 'rid' });
        if (!d.objectStoreNames.contains(AP_LRN_STORE)) d.createObjectStore(AP_LRN_STORE, { keyPath: 'ym' });
      };
      rq.onsuccess = function(){ res(rq.result); };
      rq.onerror = function(){ rej(rq.error || new Error('ap-open')); };
      rq.onblocked = function(){ rej(new Error('ap-blocked')); };
    } catch(e){ rej(e); }
  });
}
function apIdbPutS(store, obj){
  return new Promise(function(res, rej){
    if (!apDb) return rej(new Error('no-db'));
    try {
      var tx = apDb.transaction(store, 'readwrite');
      tx.objectStore(store).put(obj);
      tx.oncomplete = function(){ res(true); };
      tx.onerror = function(){ rej(tx.error || new Error('tx')); };
      tx.onabort = function(){ rej(tx.error || new Error('tx-abort')); };
    } catch(e){ rej(e); }
  });
}
function apIdbGetAllS(store){
  return new Promise(function(res, rej){
    if (!apDb) return rej(new Error('no-db'));
    try {
      var tx = apDb.transaction(store, 'readonly');
      var rq = tx.objectStore(store).getAll();
      rq.onsuccess = function(){ res(rq.result || []); };
      rq.onerror = function(){ rej(rq.error || new Error('get')); };
    } catch(e){ rej(e); }
  });
}
function apIdbDelS(store, key){
  return new Promise(function(res){
    if (!apDb) return res(false);
    try {
      var tx = apDb.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = function(){ res(true); };
      tx.onerror = function(){ res(false); };
    } catch(e){ res(false); }
  });
}
function apIdbClearAll(){
  if (!apDb) return;
  try { var tx = apDb.transaction([AP_REC_STORE, AP_LRN_STORE], 'readwrite'); tx.objectStore(AP_REC_STORE).clear(); tx.objectStore(AP_LRN_STORE).clear(); } catch(e){}
}

/* ---------- localStorage 側のレコード操作 ---------- */
function apLsRaw(rid){
  try { var raw = localStorage.getItem(AP_PREFIX + rid); if (raw){ var r = JSON.parse(raw); if (r && r.rid === rid) return r; } } catch(e){}
  return null;
}
/* ★2026-09-13 第23弾⑥: apScan()（＝localStorageモードの apLsAllRec）は
   呼ぶたびに localStorage 全体を走査して 自己検証レコードを全部 JSON.parse していました。
   apScan は11箇所・apCompleted は8箇所から呼ばれ、apStoredRaceList の中でも走るので、
   学習DBが育つほどサイト全体が重くなります（diLs() と同じ問題）。
   → パース済みの結果を覚えておき、**書き込みがあったときだけ**捨てます。 */
var apScanMem = null;
function apScanDrop(){ apScanMem = null; }
function apLsAllRec(){
  if (apScanMem) return apScanMem;             // ★第23弾⑥: 前回パースした結果を使い回す
  var out = {};
  try { for (var i = 0; i < localStorage.length; i++){ var k = localStorage.key(i); if (k && k.indexOf(AP_PREFIX) === 0){ try { var o = JSON.parse(localStorage.getItem(k)); if (o && o.rid) out[o.rid] = o; } catch(e){} } } } catch(e){}
  apScanMem = out;
  return out;
}
function apLsSetRec(rid, rec){ apScanDrop(); try { safeSetItem(AP_PREFIX + rid, JSON.stringify(rec))   /* 🥇AI印の学習＝第一優先 */; return true; } catch(e){ return false; } }
function apLsDelRec(rid){ apScanDrop(); try { localStorage.removeItem(AP_PREFIX + rid); } catch(e){} }
/* 年月ごとの学習集計(localStorage 側) */
function apMBLs(ym){ try { var o = JSON.parse(localStorage.getItem(AP_YM_PREFIX + ym) || 'null'); return (o && o.ym) ? o : null; } catch(e){ return null; } }
function apMBSaveLs(b){ try { safeSetItem(AP_YM_PREFIX + b.ym, JSON.stringify(b))   /* 🥇AI印の学習＝第一優先 */; return true; } catch(e){ return false; } }
function apYmsLs(){
  var out = [];
  try { for (var i = 0; i < localStorage.length; i++){ var k = localStorage.key(i); if (k && k.indexOf(AP_YM_PREFIX) === 0) out.push(k.slice(AP_YM_PREFIX.length)); } } catch(e){}
  return out;
}

/* ---------- 起動: IDBへ開く＋localStorage記録を移行 ---------- */
function apBoot(){
  if (apBootP) return apBootP;
  apBootP = new Promise(function(resolve){
    if (!apIdbAvail()){ apMode = 'ls'; apRecMem = null; apLrnMem = null; resolve(false); return; }
    apOpenDb().then(function(db){
      apDb = db;
      return Promise.all([ apIdbGetAllS(AP_REC_STORE), apIdbGetAllS(AP_LRN_STORE) ]);
    }).then(function(pair){
      apRecMem = {}; apLrnMem = {};
      (pair[0] || []).forEach(function(r){ if (r && r.rid) apRecMem[r.rid] = r; });
      (pair[1] || []).forEach(function(b){ if (b && b.ym) apLrnMem[b.ym] = b; });
      // localStorage に残っている記録(旧形式・従来1レース1キー・年月集計)を併合して移行
      var add = [], flush = Promise.resolve(), failed = false;
      var lsAll = apLsAllRec();
      Object.keys(lsAll).forEach(function(rid){
        if (!apRecMem[rid]){ apRecMem[rid] = lsAll[rid]; add.push(lsAll[rid]); }
      });
      var lsYms = apYmsLs();
      lsYms.forEach(function(ym){
        var b = apMBLs(ym);
        if (b && !apLrnMem[ym]){ apLrnMem[ym] = b; add.push({ __lrn: 1, b: b }); }
      });
      add.forEach(function(o){
        flush = flush.then(function(){
          var isLrn = o.__lrn;
          return apIdbPutS(isLrn ? AP_LRN_STORE : AP_REC_STORE, isLrn ? o.b : o).catch(function(){ failed = true; });
        });
      });
      return flush.then(function(){
        if (failed){ apMode = 'ls'; apDb = null; apRecMem = null; apLrnMem = null; return false; }
        apLsClearRec();
        try {
          var ks = [];
          var n = localStorage.length;
          for (var i = 0; i < n; i++){ var k = localStorage.key(i); if (k && k.indexOf(AP_YM_PREFIX) === 0) ks.push(k); }
          ks.forEach(function(k){ try { localStorage.removeItem(k); } catch(e){} });
        } catch(e){}
        apMode = 'idb';
        return true;
      });
    }).then(function(){
      try { apRender(); } catch(e){}
      resolve(true);
    }).catch(function(){
      apMode = 'ls'; apDb = null; apRecMem = null; apLrnMem = null;
      try { apRender(); } catch(e){}
      resolve(false);
    });
  });
  return apBootP;
}
function apLsClearRec(){
  apScanDrop();
  try {
    var n = localStorage.length, ks = [];
    for (var i = 0; i < n; i++){ var k = localStorage.key(i); if (k && k.indexOf(AP_PREFIX) === 0) ks.push(k); }
    ks.forEach(function(k){ try { localStorage.removeItem(k); } catch(e){} });
  } catch(e){}
}

/* ---------- 記録本体(1レース1キー)の同期CRUD ---------- */
function apGet(rid){
  if (apMode === 'idb' && apRecMem) return apRecMem[rid] || null;
  return apLsRaw(rid);
}
function apPut(rec){
  if (!rec || !rec.rid) return false;
  /* ★2026-09-13 第23弾③: 学習DBに書き込んだら回収率チューナーのレース束キャッシュを捨てる
     （捨てないと「事前予想を保存したのに回収率チューナーが古い束を使い回す」ことになります） */
  try { if (typeof vtDropRCache === 'function') vtDropRCache(); } catch(e){}
  if (apMode === 'idb' && apRecMem){
    apRecMem[rec.rid] = rec;
    apIdbPutS(AP_REC_STORE, rec).then(function(){ apLsDelRec(rec.rid); }).catch(function(){ apLsSetRec(rec.rid, rec); });
    return true;
  }
  return apLsSetRec(rec.rid, rec);
}
/* ★2026-09-13 第20弾: 1レースぶんの自己検証レコードを削除する（IndexedDB / localStorage 両対応）。
   「結果が確定していない開催週の出馬表(rec.pre)を水曜日に自動で消す」ために追加しました。
   年月バケット(apMB*)の集計には触りません（未確定レースは集計に入っていないため）。 */
function apDelRec(rid){
  rid = String(rid || '');
  if (!rid) return false;
  try { if (typeof vtDropRCache === 'function') vtDropRCache(); } catch(e){}   /* ★第23弾③ */
  try {
    if (apMode === 'idb' && apRecMem){
      delete apRecMem[rid];
      apIdbDelS(AP_REC_STORE, rid).catch(function(){});
      apLsDelRec(rid);
      return true;
    }
  } catch(e){}
  apLsDelRec(rid);
  return true;
}
/* 旧バージョンで保存した自己検証レコードへ、全券種の払戻(payout=正規化 / payouts=生リスト)を
   あとから反映する。日付・年指定の一括取込が旧保存レコードを「全券種払戻つき」へ更新したときに呼ばれる。
   年月バケット等の集計には触れないため、再学習や二重計上は不要。 */
function apPatchPayout(rid, payout, payouts){
  try {
    var rec = apGet(rid);
    if (!rec || !rec.result) return false;
    var cur = rec.result.payout || null;
    var curFull = !!(cur && typeof cur === 'object' && ('santan' in cur) && cur.win && cur.place);
    var newFull = !!(payout && typeof payout === 'object' && ('santan' in payout) && payout.win && payout.place);
    var changed = false;
    if (newFull && !curFull){ rec.result.payout = payout; changed = true; }
    if (payouts && !rec.result.payouts){ rec.result.payouts = payouts; changed = true; }
    if (changed) apPut(rec);
    return changed;
  } catch(e){ return false; }
}
/* ★2026-09-12 第16弾: 自己検証レコードにも「コーナー通過順・ペース・200mラップ」を反映する。
   学習DB(p32)でレースを取り直したときに、すでに結果が入っている記録へ後から足します。
   → 🔁AI予想の自己学習が「展開（ペース）が向いたか」まで見て成績を数えられるようになります。 */
// ★2026-09-12 第16弾: 学習DBに1レース入るたびに「展開学習」を再集計する予約を入れる。
// 取込の最中はDBアクセスで混むので、2.5秒あけて1回にまとめる（p50_pacefit.js の pfSchedule）。
try { if (typeof pfSchedule === 'function') pfSchedule(); } catch(e){}

function apPatchExtra(rid, xd){
  try {
    if (!xd) return false;
    var rec = apGet(rid);
    if (!rec) return false;
    rec.result = rec.result || {};
    var cur = rec.result.xd || null;
    var curN = (cur && cur.laps ? cur.laps.length : 0) + (cur && cur.corners ? cur.corners.length : 0);
    var newN = (xd.laps ? xd.laps.length : 0) + (xd.corners ? xd.corners.length : 0);
    if (curN >= newN && curN > 0) return false;      // すでに入っている方が充実していれば何もしない
    rec.result.xd = xd;
    apPut(rec);
    return true;
  } catch(e){ return false; }
}
function apScan(){
  if (apMode === 'idb' && apRecMem) return apRecMem;
  return apLsAllRec();
}
function apClear(){
  if (apMode === 'idb'){
    apRecMem = null; apLrnMem = null;
    try { if (apDb) apIdbClearAll(); } catch(e){}
    apRecMem = {}; apLrnMem = {};
  }
  apLsClearRec();
  try {
    var n2 = localStorage.length, ks2 = [];
    for (var i = 0; i < n2; i++){ var k = localStorage.key(i); if (k && (k.indexOf(AP_YM_PREFIX) === 0 || k === AP_LEARN_LS)) ks2.push(k); }
    ks2.forEach(function(k){ try { localStorage.removeItem(k); } catch(e){} });
  } catch(e){}
}
/* 結果ありの記録のみ */
function apCompleted(){ var s = apScan(), out = []; for (var rid in s){ if (s[rid] && s[rid].result) out.push(s[rid]); } return out; }

/* 現在開いているレースを記録（結果が来たときの自己検証用） */
function apEnsureLive(rid){
  rid = rid || (state && state.raceId) || '';
  if (!rid) return null;
  var rec = apGet(rid);
  if (rec && rec.result) return rec;
  var mm = apMetaCur();
  if (!rec){
    rec = { rid: rid, created: apNow(), auto: false, meta: mm, predHorses: apSnapHorses(), result: null,
            ym: apYmSurf(mm.date8, rid, mm.surface, mm.name) || apCurYm() };   /* 第14弾: 障害は別バケット */
  } else {
    rec.meta = rec.meta || mm;
    var snap = apSnapHorses();
    if (snap.length) rec.predHorses = snap;
  }
  rec.lastAt = apNow();
  apPut(rec);
  return rec;
}
/* =========================================================
   ★2026-09-12 第17弾: 事前予想のスナップショットと結果照合
   ---------------------------------------------------------
   これまでは「結果を取り込んだときに、結果ページの行から印を作り直す（再シミュレーション）」
   だけでした。それだと次の2つの問題があります。
     (1) 再シミュレーションは apUScores（オッズ・脚質・出遅れの3要素）で動くので、
         ①のAI印（p5_engine の7要素＋展開学習＋馬柱）とは**別物の成績**になってしまう
     (2) 出走前に実際に何を出したかが残らないので、「事前予想 vs 結果」の検証ができない
   → 出走前に analyzeRace() が出した印・確率・各ファクターの値をそのまま rec.pre に保存し、
     結果が来たらそれと突き合わせます。これが「本当の成績」になります。
   ========================================================= */

/* 事前予想を保存してよいか（＝まだ結果を知らないか） */
function apPreAllowed(rid){
  try {
    var rec = apGet(rid);
    if (rec && rec.result) return false;                 // すでに結果と照合済み
    if (typeof diGet === 'function' && diGet(rid)) return false;   // 学習DBに結果がある＝レース済み
    return true;
  } catch(e){ return true; }
}

/* analyzeRace() の結果を rec.pre として保存する。
   res … analyzeRace() の戻り値 / meta … apMetaCur() 等 */
function apSnapPred(rid, res, meta, opt){
  try {
    if (!rid || !res || !res.ok || !res.rows || !res.rows.length) return null;
    /* ★2026-09-12 第18弾: opt.bt=true は「バックテスト」（過去レースを、その日付より前の
       出走データだけで予想し直す）。この場合は結果が確定済みでも構わない（むしろ前提）が、
       本物の事前予想(rec.pre)を絶対に壊さないよう **別の欄 rec.preBt** に保存します。
       synthetic:true / src:'backtest' を必ず付けるので、後から見て区別できます。 */
    var isBt = !!(opt && opt.bt);
    var PK = isBt ? 'preBt' : 'pre';
    if (!isBt && !apPreAllowed(rid)) return null;
    var rec = apGet(rid);
    var mm = meta || null;
    try { if (!mm && typeof apMetaCur === 'function') mm = apMetaCur(); } catch(e){}
    if (!rec){
      rec = { rid: rid, created: apNow(), auto: false, meta: mm || {}, predHorses: apSnapHorses(),
              result: null, ym: '' };
      try { rec.ym = apYmSurf((mm && mm.date8) || '', rid, mm && mm.surface, mm && mm.name) || apCurYm() || ''; } catch(e){}
    }
    if (mm) rec.meta = Object.assign({}, mm, rec.meta || {});
    var d8 = (rec.meta && rec.meta.date8) || '';
    var snap = {
      at: apNow(), d8: d8, engine: 'v18',
      synthetic: isBt, src: (isBt ? 'backtest' : 'live'),
      firstAt: (rec[PK] && rec[PK].firstAt) || apNow(),
      n: res.rows.length,
      pace: res.pace ? { score: res.pace.score, label: res.pace.label || '', manual: !!res.pace.manual } : null,
      bias: null,
      rows: res.rows.map(function(r){
        var h = r.h || {};
        return {
          no: String(h.no == null ? '' : h.no), name: String(h.name || ''),
          odds: (h.odds == null ? '' : String(h.odds)), style: String(h.style || ''),
          slow: (h.slow == null ? '' : String(h.slow)),
          rank: r.rank || 0, mark: r.mark || '', prob: r.prob || 0, U: r.U || 0,
          mine: (r.mine == null ? null : r.mine),
          // 各ファクターの正規化値（提案4: ファクター別学習で「どの材料が効いたか」を測るのに使う）
          f: { O: nz(r.fO), Y: nz(r.fY), T: nz(r.fT), K: nz(r.fK), B: nz(r.fB), Y2: nz(r.fY2), A: nz(r.fA) },
          ablTxt: (r.ablHit && typeof hfTxt === 'function') ? hfTxt(r.ablHit) : ''
        };
      })
    };
    // トラックバイアスの事前予想（当日ぶん）も一緒に残す（展開予想の学習に使う）
    try {
      // バックテストでは「今の画面に入力されているバイアス」を混ぜない（そのレース当日の値ではないため）
      if (!isBt && typeof biasSnapshotFor === 'function') snap.bias = biasSnapshotFor();
    } catch(e){}
    /* ★2026-09-12 第18弾: このレースの「🎯軸に最適馬 / 💠妙味馬 / 🕳穴馬」を1頭ずつ残す。
       一括取得した日の全レースぶんを ② の一覧表にまとめて出せるようにするため。 */
    try {
      if (typeof pkPicks === 'function') snap.picks = pkPicks(res);
    } catch(e){}
    function nz(v){ return (typeof v === 'number' && isFinite(v)) ? Math.round(v * 10000) / 10000 : null; }
    // 同じ内容なら書き直さない（保存回数を抑える）
    var sig = snap.rows.map(function(x){ return x.no + ':' + x.mark + ':' + (x.odds || ''); }).join('|');
    if (rec[PK] && rec[PK].sig === sig && rec[PK].rows.length === snap.rows.length){
      rec[PK].at = snap.at;            // 時刻だけ更新
      return rec;
    }
    snap.sig = sig;
    rec[PK] = snap;
    if (!(rec.predHorses || []).length) rec.predHorses = apSnapHorses();
    rec.lastAt = apNow();
    apPut(rec);
    return rec;
  } catch(e){ return null; }
}

/* rec.pre の印（上位5頭）を、結果と突き合わせられる形にする */
function apPreMarks(rec, orderMap, oddsRankMap, miByNo, key){
  try {
    var PK2 = (key === 'preBt') ? 'preBt' : 'pre';
    var pre2 = rec ? rec[PK2] : null;
    if (!pre2 || !pre2.rows || !pre2.rows.length) return null;
    var arr = pre2.rows.slice().sort(function(a, b){ return (a.rank || 99) - (b.rank || 99); });
    var k = Math.min(5, arr.length);
    var psum = 0;
    for (var i = 0; i < k; i++) psum += (arr[i].prob > 0 ? arr[i].prob : 0);
    var out = [];
    for (var r = 0; r < k; r++){
      var x = arr[r];
      var no = String(x.no);
      out.push({
        no: no, name: x.name || '', mark: AP_MARK_ORDER[r], style: x.style || '',
        odds: apNum(x.odds), oddsRaw: String(x.odds == null ? '' : x.odds),
        aiRank: r + 1, u: x.U || 0,
        pu: (psum > 0 && x.prob > 0) ? (x.prob / psum) : (1 / k),
        prob: x.prob || 0,
        order: orderMap && orderMap[no] != null ? orderMap[no] : 0,
        oddsRank: oddsRankMap && oddsRankMap[no] ? oddsRankMap[no] : 99,
        mi: (miByNo && miByNo[no] != null) ? miByNo[no] : 0,
        f: x.f || null
      });
    }
    return out;
  } catch(e){ return null; }
}

/* =========================================================
   ★2026-09-12 第18弾: バックテストの照合
   ---------------------------------------------------------
   rec.preBt（過去レースを「その日付より前の出走データだけ」で予想し直したもの）を、
   すでに保存されている rec.result と突き合わせて rec.preBtMarks を作り、b.bt へ集計する。
   apEval() は「結果を取り込んだ瞬間」に走るので、バックテストは結果が先にある。
   そのためこちらを別途呼ぶ。
   ========================================================= */
function apEvalBt(rid){
  try {
    var rec = apGet(rid);
    if (!rec || !rec.preBt || !rec.preBt.rows || !rec.preBt.rows.length) return null;
    var rows = (rec.result && rec.result.rows) || [];
    /* ★結果がまだ rec.result に入っていないレース（学習DBにだけあるレース）は、
       学習DBの結果行を直接見る。バックテストの対象は「学習DBにある全レース」なので
       apEval() が走っていないものが大半です。 */
    if (!rows.length){
      try {
        var dbr = (typeof diGet === 'function') ? diGet(rid) : null;
        if (dbr && dbr.rows) rows = dbr.rows;
      } catch(e){}
    }
    rows = (rows || []).filter(function(r){ return r && r.no != null && parseInt(r.order, 10) >= 1; });
    if (rows.length < 3) return null;
    var orderMap = {}, oddsRankMap = {}, miByNo = {};
    rows.forEach(function(r){ orderMap[String(r.no)] = parseInt(r.order, 10) || 0; });
    var wo = rows.filter(function(r){ return apNum(r.odds) > 1; })
      .slice().sort(function(a, b){ return apNum(a.odds) - apNum(b.odds); });
    wo.forEach(function(r, i){ oddsRankMap[String(r.no)] = i + 1; });
    var inv = 0;
    rows.forEach(function(r){ var o = apNum(r.odds); if (o > 1) inv += 1 / o; });
    if (inv > 0) rows.forEach(function(r){ var o = apNum(r.odds); if (o > 1) miByNo[String(r.no)] = (1 / o) / inv; });
    var marks = apPreMarks(rec, orderMap, oddsRankMap, miByNo, 'preBt');
    if (!marks || !marks.length) return null;
    rec.preBtMarks = marks;
    rec.preBtSettledAt = apNow();
    apPut(rec);
    var mm = rec.meta || {};
    var ym = apYmSurf(mm.date8 || '', rid, mm.surface || '', mm.name || '') || rec.ym || '';
    if (ym) apAggAddPre(ym, marks, 'preBt');
    return rec;
  } catch(e){ return null; }
}
/* バックテスト集計(b.bt)を全月からクリアする。
   apAggAddPre は加算式なので、バックテストを最初からやり直すときは必ず先にこれを呼ぶ。 */
function apBtClear(){
  var n = 0;
  try {
    apYms().forEach(function(ym){
      var b = apMB(ym);
      if (b && b.bt){ delete b.bt; apMBSave(b); n++; }
    });
  } catch(e){}
  return n;
}
/* バックテスト済みレース数（rec.preBt を持つもの） */
function apBtCount(){
  var n = 0;
  try {
    var all = apScan() || {};
    Object.keys(all).forEach(function(rid){
      var rec = all[rid];
      if (rec && rec.preBt && rec.preBt.rows && rec.preBt.rows.length) n++;
    });
  } catch(e){}
  return n;
}

/* 事前予想ぶんの集計（3モデルとは別に b.pre として持つ。学習パラメータは動かさない＝計測専用） */
function apAggAddPre(ym, marks, key){
  try {
    if (!ym) return;
    var b = apMB(ym);
    if (!b) b = apBucket(ym);
    var BK = (key === 'preBt') ? 'bt' : 'pre';
    if (!b[BK]) b[BK] = apCBInit();
    var cb = b[BK];
    var ms = (marks || []).filter(function(m){ return m && m.order >= 1; });
    if (!ms.length) return;
    cb.n++;
    var winFlag = false, top3Flag = false;
    ms.forEach(function(m){
      cb.horseN++;
      var o = m.order;
      if (o === 1){ cb.horseWin++; winFlag = true; }
      if (o <= 3){ cb.horseTop3++; top3Flag = true; }
      var g = cb.byMark[m.mark] = cb.byMark[m.mark] || { n: 0, win: 0, top3: 0 };
      g.n++; if (o === 1) g.win++; if (o <= 3) g.top3++;
      var mi = (typeof m.mi === 'number' && isFinite(m.mi)) ? m.mi : 0;
      if (m.aiRank && m.oddsRank && m.aiRank < m.oddsRank){
        cb.boostN++; if (o <= 3) cb.boostTop3++;
        if (o === 1) cb.boostWin++; cb.boostExp += mi;
      } else if (m.aiRank && m.oddsRank && m.aiRank > m.oddsRank){
        cb.dropN++; if (o <= 3) cb.dropTop3++;
        if (o === 1) cb.dropWin++; cb.dropExp += mi;
      } else {
        cb.sameN++; if (o <= 3) cb.sameTop3++;
        if (o === 1) cb.sameWin++; cb.sameExp += mi;
      }
    });
    if (winFlag) cb.winR++;
    if (top3Flag) cb.top3R++;
    var pl = apBetPlan(ms);
    if (pl){
      cb.costU += 10000;
      for (var wi = 0; wi < ms.length; wi++){
        if (ms[wi].order === 1) cb.grossU += pl.stakeOf(ms[wi].no) * ((ms[wi].odds > 1) ? ms[wi].odds : 0);
      }
    }
    apMBSave(b);
  } catch(e){}
}

/* 血統(父/母父)が取れたとき、記録中の予想馬にも反映 */
function apSyncPedi(){
  var rid = (state && state.raceId) || ''; if (!rid) return;
  var rec = apGet(rid); if (!rec) return;
  var map = {};
  ((state && state.horses) || []).forEach(function(h){ if (h.no && h.pedi) map[h.no] = h.pedi; });
  var changed = false;
  (rec.predHorses || []).forEach(function(x){
    if (map[x.no] && (!x.pedi || x.pedi.sire !== map[x.no].sire)){ x.pedi = { sire: map[x.no].sire || '', msire: map[x.no].msire || '' }; changed = true; }
  });
  if (changed) apPut(rec);
}

/* ---------- メタ・馬スナップショット ---------- */
function apMetaCur(){
  var m = { date8:'', place:'', rnum:'', name:'', dist:'', surface:'', baba:'' };
  var nm = (state && state.race && state.race.name) || '';
  m.name = nm;
  m.date8 = apDate8FromText(nm);
  var dm = nm.match(/(?:\d{4}年\s*\d{1,2}月\s*\d{1,2}日)?\s*(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉)\s*(\d{1,2})R/);
  if (dm){ m.place = dm[1]; m.rnum = dm[2]; }
  var pl = (state && state.race && state.race.place) || '';
  if (!m.place && pl){ for (var i = 0; i < AP_VENUES.length; i++) if (pl.indexOf(AP_VENUES[i]) >= 0){ m.place = AP_VENUES[i]; break; } }
  m.dist = (state && state.race && state.race.dist) || '';
  if (nm && !m.dist){ var dm2 = nm.match(/[芝ダ](?:ート)?\s*(\d{3,4})m/); if (dm2) m.dist = dm2[1]; }
  if (nm){ if (/ダート|ダ/.test(nm)) m.surface = 'ダ'; else if (/障害|障/.test(nm)) m.surface = '障'; else if (/芝/.test(nm)) m.surface = '芝'; }
  var rc = { fast:'良', good:'稍重', yield:'重', soft:'不良' };
  var bc = '';
  try { bc = String(readRaceMeta().baba || ''); } catch(e){}
  m.baba = (bc && (state && state.race && state.race.baba)) ? String((state.race.baba || '')).trim() : bc;
  if (!m.baba && state && state.race && state.race.baba) m.baba = String(state.race.baba || '');
  return m;
}
function apSnapHorses(){
  return ((state && state.horses) || []).map(function(h){
    return {
      no: h.no || '', name: h.name || '', odds: h.odds || '', style: h.style || '',
      mark: '', nk: h.nk || '', pedi: h.pedi ? { sire: h.pedi.sire || '', msire: h.pedi.msire || '' } : null
    };
  }).filter(function(x){ return x.no; });
}
/* 結果ページから: レースのメタを整形(旧互換) */
function apRaceMeta(p, rid){
  var m = { date8:'', place:'', rnum:'', name:'', dist:'', surface:'', baba:'' };
  /* ★2026-09-12 第17弾: 学習DBに保存されている date8 / meta をそのまま受け取れるようにした。
     再学習(apRelearn)は学習DBからレースを組み立てるため、日付を渡さないと
     race_id から捏造するしかなく、年月別の学習バケットが壊れていた（下記参照）。 */
  if (p && p.date8 && /^\d{8}$/.test(String(p.date8))) m.date8 = String(p.date8);
  if (!m.date8 && p && p.meta && /^\d{8}$/.test(String(p.meta.date8 || ''))) m.date8 = String(p.meta.date8);
  if (p && p.date) m.date8 = m.date8 || apDate8FromText(p.date);
  var pm = (p && p.meta) || {};
  if (p && p.place) m.place = p.place;
  if (!m.place && pm.place) m.place = pm.place;
  if (p && p.rnum != null) m.rnum = String(p.rnum);
  if (!m.rnum && pm.rnum != null) m.rnum = String(pm.rnum);
  if (p && p.name) m.name = p.name;
  if (!m.name && pm.name) m.name = pm.name;
  if (p && p.dist) m.dist = String(p.dist);
  if (!m.dist && pm.dist) m.dist = String(pm.dist);
  if (!m.dist && pm.m) m.dist = String(pm.m);
  if (p && p.surface) m.surface = p.surface;
  if (!m.surface && pm.surface) m.surface = pm.surface;
  if (p && p.baba) m.baba = p.baba;
  if (!m.baba && pm.baba) m.baba = pm.baba;
  if (!m.date8 && p && p.meta && p.meta.date8) m.date8 = p.meta.date8;
  if (!m.date8 && p && p.meta && p.meta.date) m.date8 = apDate8FromText(p.meta.date);
  /* ★2026-09-12 修正: race_id の先頭8桁は日付ではありません。
     race_id = YYYY(4) + 場コード(2) + 回(2) + 日(2) + R(2) なので、
     従来ここで作っていた date8 は「年 + 場コード + 回」＝デタラメな日付でした。
     例: 202609040311(阪神) → '20260904' と読めてしまうが、実際は 2026-09-12。
     東京(場コード05)なら全て 5 月に分類されてしまい、年月別の学習バケットが壊れます。
     → 日付が分からないときは **捏造せず空のまま**にします（空なら学習バケットに入れないだけ。
       誤った月に入れるより安全）。年だけ欲しい場合は apYmOf 側が rid から拾います。 */
  if (!m.name && p && p.meta && p.meta.name) m.name = p.meta.name;
  var cur = apGet(rid);
  if (cur && cur.meta){
    if (!m.place && cur.meta.place) m.place = cur.meta.place;
    if (!m.dist && cur.meta.dist) m.dist = cur.meta.dist;
    if (!m.baba && cur.meta.baba) m.baba = cur.meta.baba;
    if (!m.surface && cur.meta.surface) m.surface = cur.meta.surface;
    if (!m.date8 && cur.meta.date8) m.date8 = cur.meta.date8;
    if (!m.name) m.name = cur.meta.name;
  }
  return m;
}
function apStyleOf(item, headN){
  var tag = '';
  if (item && item.style){ var sv = String(item.style); if (/逃|先|差|追|好位|自在|前/.test(sv)) tag = sv; }
  if (!tag && typeof histStyle === 'function' && item && item.passing){
    try { var st = histStyle(item.passing, headN || item.head || 16); if (st && st.tag && st.tag !== '不明') tag = st.tag; } catch(e){}
  }
  return tag;
}
function apStyleVal(tag){
  var c = styleClass ? styleClass(tag) : '';
  if (c === 'E') return 0.63;
  if (c === 'S') return 0.59;
  if (c === 'K') return 0.51;
  if (c === 'C') return 0.43;
  return 0.5;
}

/* ---------- 3モデルの印評価 ----------
   feats: 各馬 { no, name, odds(数値), m(1/odds or null), colO, colK }
   S: 学習パラメータ { hitTm, roiRho, hybLam }。S なし=標準(従来と同じ印)。 */
/* ctx = { d8: 'YYYYMMDD', band: 'm2' } … 学習DBから「その日付より前の出走だけ」を引くための情報。
   ★2026-09-12 第17弾・提案3 で 2 つ直しました。
   (1) いかさま(look-ahead bias)の修正
       従来は脚質を apStyleOf() 経由で『そのレース自身の通過順(result の passing)』から判定していました。
       つまり「自分が当てに行くレースで、その馬が実際にどこを走ったか」を事前情報として使っており、
       学習DBの的中率・回収率が見かけ上よく出ていました。
       → 脚質は **過去戦の通過順**(p52) から、それも無ければ **出馬表の入力(item.style)** だけを使い、
         結果の passing は一切使いません。
   (2) 特徴量の増強
       従来は「オッズ・脚質(4段階固定値)・出遅れ率」の3つだけでした。
       p52_histfeat.js が学習DBから作る「総合能力 colAbl」（過去戦の3着内率・上りの相対順位・
       同距離適性・騎手勝率）と「休養/鉄砲/2走目 restMul」を追加します。 */
function apFeats(items, ctx){
  var headN = 0;
  try { headN = parseInt(String(items.length), 10) || 0; } catch(e){}
  var list = (items || []).slice().filter(function(x){ return x && x.no; });
  var oV = list.map(function(x){
    var o = apNum(x.odds);
    if (!o || o <= 1) return null;
    return 1 / o;
  });
  var colO;
  try { colO = normCol(oV, false, 0.25); } catch(e){ colO = oV.map(function(){ return 0.4; }); }
  // 学習DBの履歴から「レース前の特徴」を引く（ctx.d8 が無い＝当日のライブ予想では引けない）
  var hf = null;
  try {
    if (ctx && ctx.d8 && typeof hfFeatures === 'function') hf = hfFeatures(list, ctx.d8, ctx.band || '');
  } catch(e){ hf = null; }
  function stylePre(x){
    var no = String(x.no);
    if (hf && hf[no] && hf[no].style) return hf[no].style;      // 過去戦の通過順から（最優先）
    if (x && x.style){ var sv = String(x.style); if (/逃|先|差|追|好位|自在|前/.test(sv)) return sv; }  // 出馬表の入力
    return '';                                                   // ★ 結果の passing は使わない
  }
  var sV = list.map(function(x){ return apStyleVal(stylePre(x)); });
  var colK;
  try { colK = normCol(sV, false, 0.5); } catch(e){ colK = sV.map(function(){ return 0.5; }); }
  // 総合能力（学習DBの過去戦から。材料が無い馬は null → 0.5 の中立扱い）
  var aV = list.map(function(x){ return (hf && hf[String(x.no)]) ? hf[String(x.no)].abl : null; });
  var colAbl;
  try { colAbl = normCol(aV, false, 0.5); } catch(e){ colAbl = aV.map(function(){ return 0.5; }); }
  return list.map(function(x, i){
    var o = apNum(x.odds);
    var f = (hf && hf[String(x.no)]) ? hf[String(x.no)] : null;
    return { no: String(x.no), name: x.name || '', odds: o, oddsRaw: x.odds != null ? String(x.odds) : '',
      m: (o && o > 1) ? 1 / o : null, colO: colO[i], colK: colK[i], styleTag: stylePre(x),
      slowW: apSlowWinMul(x.slow), slow: x.slow,
      colAbl: colAbl[i], hf: f, restMul: (f && f.restMul) ? f.restMul : 1,
      ablTxt: (f && typeof hfTxt === 'function') ? hfTxt(f) : '' };
  });
}
/* ソフトマックス(数値安定化) */
function apSoft(points, tau){
  var mx = -1e9;
  points.forEach(function(u){ if (u > mx) mx = u; });
  var ex = points.map(function(u){ return Math.exp((u - mx) / tau); });
  var se = 0; ex.forEach(function(e){ se += e; });
  if (!se || !isFinite(se)) return points.map(function(){ return 1 / points.length; });
  return ex.map(function(e){ return e / se; });
}
/* 妙味評価値: 市場(単勝オッズ, colO)と比べて「脚質実力評価(colK)」がどれだけ上回っているか。
   上回っている馬ほどオッズ(配当)に見合う実力＝妙味が高いとみなす。オッズ不明馬は0。 */
function apEV(feats){
  return feats.map(function(f){ return f.m ? clamp((f.colK - f.colO) * 1.6, -1, 1) : 0; });
}
/* 出遅れ率(slow %)を「勝率ペナルティ」へ換算。
   出遅れはどの脚質でもスタート後の不利で、勝率・複勝率を下げる(先行型だけの話ではない)。
   - 率3%未満: ほぼ無視(実際のばらつき)
   - 率3%以上: 1 - ((率-3)/100)^0.7 × 0.85 を勝率倍率に(10%で約0.87、25%で約0.71、50%で約0.55)
   - オッズ不明馬・未入力(0%)はそのまま
   ※ 出遅れ率は「割合」なので 0〜100% の範囲で扱う（#2026-09-12 第15弾・旧0〜999を廃止）。
     slowPctOf() で 100% 超を 100% に丸めてから評価するため、999 のような値が
     過大なペナルティ（＝ファクターの下限0.45への張り付き）を起こしません。
   ※ 第15弾で式も修正: 以前は Math.pow(x - 3, 0.7) だったため「率を小数(0〜1)で渡した式」に
     なっていて、出遅れ率3.6%以上がすべて下限0.45へ張り付いていました（0〜100%の
     扱いになっていなかった）。率を 0〜1 に直してから累乗します。 */
function apSlowWinMul(slowPct){
  var x = slowPctOf(slowPct);
  if (x < 3) return 1;
  return Math.max(0.45, 1 - Math.pow((x - 3) / 100, 0.7) * 0.85);
}
/* 実力(総合能力)が市場確率を動かせる幅。
   従来は脚質4段階(0.43〜0.63)を 0.5 倍していたので ±0.25 しか動かず、
   1番人気と2番人気の marketU 差(普通0.27前後)を覆せませんでした。
   第17弾で「学習DBの過去戦から作った総合能力」に置き換えたので、幅を広げて 0.42 にしています
   （±0.21 → 実力差が大きいレースでは市場をちゃんと逆転できる）。 */
var AP_W_ABL = 0.42;
/* S → 各馬のモデルU。mode: 'hit'|'roi'|'hyb'
   3モデルの「考え方」は意図的に異なるスコア式にする:
   - hit(的中率重視): オッズ(市場確率)を主軸に脚質を少し加味 → 「当たりそうな馬」順
   - roi(回収率重視) : 本命(◎)をおよそ5番人気以下の中穴〜大穴から選ぶ。
                       上位人気(1〜4番)は本命候補から割り引き、中〜大穴の中から
                       配当の大きさ×AI実力評価×妙味×出遅れで順位をつける
   - hyb(ハイブリッド): hit と roi を λ で混合(回収率側の演算は roi と同じ中穴〜大穴)
   ※ 同じ馬でもモデルによって印(◎〜△)が変わり得る(特に中〜上位人気の取捨)。 */
function apUScores(feats, S, mode){
  S = S || {};
  /* ★第17弾・提案3: 「実力」の列。学習DBの履歴から総合能力(colAbl)を作れた馬はそれを使い、
     作れなかった馬（初出走・学習DBに過去戦が無い）は従来どおり脚質(colK)で代用します。 */
  function ablOf(f){ return (f && f.colAbl != null) ? f.colAbl : (f ? f.colK : 0.5); }
  // 市場確率(m)を「馬同士で比較しやすい信頼度」へ: 1〜3番人気は上に間延びしないよう log で圧縮
  // 例: 1.5倍→0.67 / 3倍→0.33 / 6倍→0.17 / 12倍→0.08 / 30倍→0.03
  var marketU = feats.map(function(f){ return f.m ? Math.log(1 + f.m * 4) : 0; });
  var muMax = 1e-9; marketU.forEach(function(v){ if (v > muMax) muMax = v; });
  marketU = marketU.map(function(v){ return muMax ? (v / muMax) : 0; });
  // 勝率・複勝へ効く共通ペナルティ(出遅れ率)は全モデルへ先に適用
  function effProb(f, base){
    var p = base;
    if (f.slowW < 1) p *= f.slowW;
    return Math.max(0, p);
  }
  // hit: 「市場確率(信頼度)が高い」馬を軸に、そこから大きく逸脱しない範囲で脚質を少し加味
  var Uh = feats.map(function(f, i){
    var p = marketU[i];
    // 実力(総合能力)は市場を上下に動かすだけ。従来は脚質4段階の固定値だったのでほぼ動かなかった
    var k = (ablOf(f) - 0.5) * AP_W_ABL;
    var v = effProb(f, p + k);
    // 休養・鉄砲・2走目（学習DB内の鉄砲成績から。p49 の定義と同じ 90日以上）
    if (f.restMul && f.restMul !== 1) v *= f.restMul;
    return v;
  });
  if (mode === 'hit') return Uh;
  // roi(回収率重視): 本命(◎)をおよそ5番人気以下(中穴〜大穴)から選ぶスコア式。
  //   - 配当の魅力 pay: オッズが大きいほど大きい(対数。1〜80倍を 0..1 に)
  //   - AI実力評価 str: colK(脚質評価)が高いほど信頼
  //   - 1〜4番人気は「本命にならない」よう強めに割引 → 本命はほぼ5番人気以下になる
  //   - 妙味(AI評価が人気より上)と出遅れ率で同格の中穴の中から順位をつける
  var rho = (S.roiRho == null) ? 1.0 : S.roiRho;  // 妙味の効かせ(学習で0.1〜1.6に調整)
  rho = clamp(rho, 0.1, 1.6);
  var ordIdx = feats.map(function(_, i){ return i; })
    .filter(function(i){ return feats[i].odds > 1; })
    .sort(function(a, b){ return feats[a].odds - feats[b].odds; });
  var mRank = feats.map(function(){ return 99; });
  ordIdx.forEach(function(i, r){ mRank[i] = r + 1; });
  function apPayoutU(o){ return (o && o > 1) ? Math.min(1, Math.log(o) / Math.log(80)) : 0; }
  var Ur = feats.map(function(f, i){
    var pay = apPayoutU(f.odds);
    var s = 0.55 * ablOf(f) + 0.45 * pay;       // 実力×配当の魅力(0.3〜1の範囲)
    var r = mRank[i];
    if (r <= 4){
      // 1〜4番人気は本命(◎)候補から外す: 強く割り引く
      var sup = (r === 1) ? 0.18 : (r === 2) ? 0.30 : (r === 3) ? 0.46 : 0.66;
      s *= sup;
    } else if (r >= 14){
      s *= 0.85;    // 100倍前後の超大穴は質の裏付けが薄いので微減
    }
    var ev = clamp((ablOf(f) - f.colO) * 1.1, -0.3, 0.3);   // 妙味: 評価が人気より高い馬に加点
    s += rho * ev;
    var v2 = effProb(f, s);
    if (f.restMul && f.restMul !== 1) v2 *= f.restMul;      // 鉄砲・2走目・長期休養
    return v2;
  });
  if (mode === 'roi') return Ur;
  // hyb: hit と roi を λ で混合
  var lam = (S.hybLam == null) ? 0.45 : S.hybLam;
  lam = Math.max(0.1, Math.min(0.9, lam));
  return Uh.map(function(u, i){ return (1 - lam) * u + lam * Ur[i]; });
}
/* 順位付けして上位5頭に印を割当て。oddsRankMap/orderMap があれば併記 */
function apMarksByU(feats, U, orderMap, oddsRankMap){
  var idx = feats.map(function(_, i){ return i; });
  idx.sort(function(a, b){
    if (U[b] !== U[a]) return U[b] - U[a];
    return (feats[a].odds || 999) - (feats[b].odds || 999) || (String(feats[a].no) < String(feats[b].no) ? -1 : 1);
  });
  var k = Math.min(5, idx.length);
  // 印にした5頭の「モデル信頼度シェア」(ソフトマックス)。回収率シミュレーションで
  // 1万円を各馬の単勝へ AI判断で配分するときの割合に使う
  var mxU = -1e9, i2 = 0;
  for (i2 = 0; i2 < k; i2++){ if (U[idx[i2]] > mxU) mxU = U[idx[i2]]; }
  var exA = [], exSum = 0;
  for (i2 = 0; i2 < k; i2++){ var e = Math.exp((U[idx[i2]] - mxU) / 0.9); exA.push(e); exSum += e; }
  var share = {};
  for (i2 = 0; i2 < k; i2++){ share[idx[i2]] = exSum > 0 ? exA[i2] / exSum : 1 / k; }
  var out = [];
  for (var r = 0; r < k; r++){
    var i = idx[r];
    var f = feats[i];
    out.push({
      no: f.no, name: f.name, mark: AP_MARK_ORDER[r], style: f.styleTag,
      odds: f.odds, oddsRaw: f.oddsRaw, aiRank: r + 1, u: U[i], pu: share[i] || (1 / Math.max(1, k)),
      order: orderMap ? (orderMap[f.no] || 0) : 0,
      oddsRank: oddsRankMap ? (oddsRankMap[f.no] || 99) : 99
    });
  }
  return out;
}
function apBuildPred(p){
  /* 旧互換: 結果ページから「標準(的中重視=従来)」の印リストを返す */
  var rows = ((p && p.rows) || []).slice().filter(function(r){ return r && r.no; });
  if (rows.length < 3) return [];
  var feats = apFeats(rows);
  var orderMap = {}, oddsRankMap = {};
  rows.forEach(function(r){ if (r.no != null) orderMap[String(r.no)] = parseInt(r.order, 10) || 0; });
  var withOdds = rows.slice().filter(function(r){ return apNum(r.odds) > 1; })
    .sort(function(a, b){ return apNum(a.odds) - apNum(b.odds); });
  withOdds.forEach(function(r, i){ oddsRankMap[String(r.no)] = i + 1; });
  var U = apUScores(feats, { hitTm: 1 }, 'hit');
  return apMarksByU(feats, U, orderMap, oddsRankMap).map(function(m){
    var orig = rows.filter(function(r){ return String(r.no) === String(m.no); })[0] || {};
    return { no: m.no, name: m.name, mark: m.mark, style: m.style, odds: orig.odds != null ? String(orig.odds) : '',
      pop: orig.pop != null ? String(orig.pop) : '', oddsRank: m.oddsRank, aiRank: m.aiRank };
  });
}

/* 回収率のシミュレーション: 各レースで想定1万円を資金とし、
   そのモデルが印を打った馬(◎○▲☆△)の単勝へ「AIの信頼度(印シェア)」で配分購入する。
   ・オッズが分からない馬(過去データ欠落)には賭けない(その分は他へ配分し直し)
   ・1万円ちょうどになるよう100円単位に丸め、端数は◎へ
   返り値: stakeOf(no)=賭金 / 資金が無いとき(賭けられる印が無い)は null */
function apBetPlan(ms){
  var pool = (ms || []).filter(function(m){ return m && m.order >= 1 && m.odds > 1; });
  if (!pool.length) return null;
  var denom = 0;
  pool.forEach(function(m){ denom += (m.pu > 0) ? m.pu : (1 / Math.max(1, pool.length)); });
  var st = {}, tot = 0;
  pool.forEach(function(m){
    var frac = (m.pu > 0) ? m.pu : (1 / Math.max(1, pool.length));
    var raw = 10000 * (frac / denom);
    var amt = Math.floor(raw / 100) * 100;
    if (amt < 100) amt = 100;
    st[m.no] = amt; tot += amt;
  });
  if (tot !== 10000 && pool.length){
    var top = pool[0];
    st[top.no] = Math.max(0, (st[top.no] || 0) + (10000 - tot));
  }
  return {
    pool: pool,
    stakeOf: function(no){ return st[no] || 0; }
  };
}
/* ---------- 年月ごとの学習集計(バケット) ---------- */
/* ★2026-09-12 第17弾・提案1: リフト(実勝率 − 市場期待勝率)を集計する欄を追加した。
   従来の boostTop3 は「AIが人気より上げた馬の3着内率」を『印全体の3着内率』と比べていたが、
   上げた馬は定義上ほぼ人気薄なので3着内率が低くて当然 → 常に hitTm が下がる(=人気順に収束する)
   不公平な比較になっていた。正しくは「その馬たちへの市場の期待」と比べる必要がある。
     boostWin / boostExp … 上げた馬の 1着数 / 市場期待勝率(mi)の合計
     sameN  / sameWin / sameExp … 順位が変わらなかった馬
     dropWin / dropExp … 人気より下げた馬
   mi = (1÷オッズ) ÷ Σ(1÷オッズ) … 控除後オッズから逆算した市場の見立て */
function apCBInit(){ return { n: 0, horseN: 0, horseWin: 0, horseTop3: 0, winR: 0, top3R: 0,
  costU: 0, grossU: 0, boostN: 0, boostTop3: 0, dropN: 0, dropTop3: 0, byMark: {},
  boostWin: 0, boostExp: 0, sameN: 0, sameWin: 0, sameTop3: 0, sameExp: 0, dropWin: 0, dropExp: 0 }; }
function apBucket(ym){ return { ym: ym, c: { hit: apCBInit(), roi: apCBInit(), hyb: apCBInit() } }; }
function apMB(ym){
  if (!ym) return null;
  if (apMode === 'idb' && apLrnMem) return apLrnMem[ym] || null;
  return apMBLs(ym);
}
function apMBSave(b){
  if (!b || !b.ym) return;
  if (apMode === 'idb' && apLrnMem){
    apLrnMem[b.ym] = b;
    apIdbPutS(AP_LRN_STORE, b).catch(function(){ apMBSaveLs(b); });
    return;
  }
  apMBSaveLs(b);
}
function apYms(){
  if (apMode === 'idb' && apLrnMem) return Object.keys(apLrnMem).sort();
  return apYmsLs().sort();
}
function apConceptsAgg(b){
  /* 指定バケットの各概念の主要数値(表示用) */
  var o = {};
  AP_CONCEPTS.forEach(function(cn){
    var cb = (b && b.c && b.c[cn.id]) || apCBInit();
    o[cn.id] = {
      races: cb.n, horseN: cb.horseN, win: cb.horseWin, top3: cb.horseTop3,
      winR: cb.winR, top3R: cb.top3R,
      top3Pct: cb.horseN ? apPct1(cb.horseTop3 / cb.horseN * 100, 100) : '−',
      roiPct: cb.costU > 0 ? apPct1(cb.grossU / cb.costU * 100, 100) : '−',
      costU: cb.costU, grossU: cb.grossU,
      boostN: cb.boostN, boostTop3: cb.boostTop3
    };
  });
  return o;
}
/* 前の月までのバケットを合算した「参考」集計 */
function apPastAgg(ym){
  var sum = {};
  AP_CONCEPTS.forEach(function(cn){ sum[cn.id] = apCBInit(); });
  /* 第14弾: 障害と平地は別土俵なので、同じ区分のバケットだけを「その月より前」から集める */
  var yms = apYms().filter(function(y){ return apYmIsSho(y) === apYmIsSho(ym) && y < ym; });
  yms.forEach(function(y){
    var b = apMB(y); if (!b) return;
    AP_CONCEPTS.forEach(function(cn){
      var s = sum[cn.id], cb = b.c[cn.id];
      s.n += cb.n; s.horseN += cb.horseN; s.horseWin += cb.horseWin; s.horseTop3 += cb.horseTop3;
      s.winR += cb.winR; s.top3R += cb.top3R; s.costU += cb.costU; s.grossU += cb.grossU;
      s.boostN += cb.boostN; s.boostTop3 += cb.boostTop3; s.dropN += cb.dropN; s.dropTop3 += cb.dropTop3;
      s.boostWin += (cb.boostWin || 0); s.boostExp += (cb.boostExp || 0);
      s.sameN += (cb.sameN || 0); s.sameWin += (cb.sameWin || 0);
      s.sameTop3 += (cb.sameTop3 || 0); s.sameExp += (cb.sameExp || 0);
      s.dropWin += (cb.dropWin || 0); s.dropExp += (cb.dropExp || 0);
      Object.keys(cb.byMark || {}).forEach(function(m){ var g = s.byMark[m] = s.byMark[m] || { n:0, win:0, top3:0 };
        g.n += cb.byMark[m].n; g.win += cb.byMark[m].win; g.top3 += cb.byMark[m].top3; });
    });
  });
  return sum;
}
/* 学習パラメータのチェーン遷移: ある月の実績→翌月以降に使う値 */
function apTrans(b, S){
  S = S || {};
  var H = (b && b.c && b.c.hit) || null;
  if (H && (H.boostN || 0) >= 12 && (H.horseN || 0) > 0){
    /* ★第17弾・提案1: リフト用の材料を「前月以前の全期間」で累積する。
       hitTm 自体は apParamsFor() の最後で1回だけ決める（月ごとに上書きすると
       直近1ヶ月分のブレだけで値が飛ぶため）。 */
    S._bN = (S._bN || 0) + (H.boostN || 0);
    S._bWin = (S._bWin || 0) + (H.boostWin || 0);
    S._bExp = (S._bExp || 0) + (H.boostExp || 0);
    S._hN = (S._hN || 0) + (H.horseN || 0);
    S._hTop3 = (S._hTop3 || 0) + (H.horseTop3 || 0);
    S._bTop3 = (S._bTop3 || 0) + (H.boostTop3 || 0);
    /* 旧形式(リフト用の欄が無い=第17弾より前に集計したバケット)だけのときの保険。
       新形式のデータが1件でもあれば apParamsFor 側で上書きされる。 */
    if (!(S._bExp > 0)){
      var all = H.horseTop3 / H.horseN;
      var bt = H.boostTop3 / H.boostN;
      S.hitTm = clamp(1 - Math.max(0, all - bt) * 1.6, 0.4, 1.0);
      S.hitSrc = 'legacy';
    }
  }
  var R = (b && b.c && b.c.roi) || null;
  if (R && (R.n || 0) >= 10 && R.costU > 0){
    var pct = R.grossU / R.costU * 100;
    if (pct < 98) S.roiRho = Math.max(0.2, (S.roiRho == null ? 1 : S.roiRho) - 0.35);
    else if (pct >= 112) S.roiRho = Math.min(1.8, (S.roiRho == null ? 1 : S.roiRho) + 0.25);
  }
  var Y = (b && b.c && b.c.hyb) || null;
  if (Y && (Y.n || 0) >= 10 && Y.costU > 0){
    var ph = Y.grossU / Y.costU * 100;
    if (ph < 100){
      var pr = (R && R.costU) ? R.grossU / R.costU * 100 : -1;
      var phit = (H && H.costU) ? H.grossU / H.costU * 100 : -1;
      var lam = (S.hybLam == null) ? 0.55 : S.hybLam;
      if (pr >= 0 && phit >= 0 && pr <= phit) S.hybLam = Math.max(0.2, lam - 0.15);
      else S.hybLam = Math.min(0.9, lam + 0.12);
    }
  }
  return S;
}
/* 指定の開催年月より前の月のバケットだけを時系列に適用したパラメータ */
function apParamsFor(ym){
  var S = { hitTm: 1, roiRho: 1, hybLam: 0.55, totalR: 0, src: [], lastYm: '', hitSrc: '' };
  /* 第14弾: 障害の予想には障害の学習だけを、平地の予想には平地の学習だけを時系列で適用する */
  var yms = apYms().filter(function(y){
    return apYmIsSho(y) === apYmIsSho(ym) && y < ym && apYmState(y) !== 'future';   // 結果が確定していない未来月は学習に使わない
  }).sort();
  yms.forEach(function(y){
    var b = apMB(y); if (!b) return;
    apTrans(b, S);
    S.totalR += (b.c.hit.n || 0);
    S.lastYm = y;
  });
  if (S.totalR > 0 && yms.length) S.src = yms.slice(-3);
  /* ★第17弾・提案1: 「AIが人気より上げた馬」が市場の期待以上に勝ったか（＝リフト）で
     展開/脚質ファクターの重みを決める。
       ratio = 実勝率 ÷ 市場期待勝率   (1.0 = 市場どおり / 1.2 = 期待より2割多く勝つ)
       shr   = n ÷ (n + 40)            サンプルが少ないほど 1.0 へ縮小（過学習防止）
     従来のように 1.0 が上限ではないので、「効いている」と分かったときは重みを強められる。
     範囲は 0.4〜1.4（1.4 = 既定の重み7が 9.8 になる）。 */
  if ((S._bN || 0) >= 12 && (S._bExp || 0) > 0){
    var expW = S._bExp / S._bN, actW = S._bWin / S._bN;
    var ratio = expW > 0 ? actW / expW : 1;
    var shr = S._bN / (S._bN + 40);
    S.hitTm = clamp(1 + (ratio - 1) * shr, 0.4, 1.4);
    S.hitSrc = 'lift';
    S.lift = { n: S._bN, act: actW, exp: expW, ratio: ratio, shr: shr };
  }
  return S;
}
/* 概念別の「展開加点に対する信頼度」へ変換(エンジンへ渡す値) */
function apModelScale(S, model){
  S = S || { hitTm: 1, roiRho: 1, hybLam: 0.55 };
  if (model === 'hit') return clamp(S.hitTm == null ? 1 : S.hitTm, 0.4, 1.4);
  if (model === 'roi'){
    var rho = S.roiRho == null ? 1 : S.roiRho;
    return clamp(1 + (rho - 1) * 0.4, 0.8, 1.2);
  }
  var lam = S.hybLam == null ? 0.55 : clamp(S.hybLam, 0, 1);
  var hitS = clamp(S.hitTm == null ? 1 : S.hitTm, 0.4, 1.4);
  var roiS = clamp(1 + ((S.roiRho == null ? 1 : S.roiRho) - 1) * 0.4, 0.8, 1.2);
  return clamp((1 - lam) * hitS + lam * roiS, 0.4, 1.4);
}
function apCurModel(){ return (state && state.apModel) || 'hyb'; }

/* ---------- 1レースの自己検証と累積学習 ---------- */
function apEval(p, rid, nosess, force){
  if (!p || !rid) return null;
  // force=true(再学習)のときは既存の評価済み記録があっても現在のモデルで評価し直す
  if (!force && apGet(rid) && apGet(rid).result) return null;
  var rows = ((p && p.rows) || []).filter(function(r){ return r && r.order >= 1 && r.no; });
  if (rows.length < 3) return null;
  // slow(出遅れ率)は馬番→行で引き当てる(既存の race.marks 由来ではなく p 直下の rows を使う)
  var slowByNo = {};
  ((p && p.slowMap) || []).forEach(function(x){ if (x && x.no != null) slowByNo[String(x.no)] = x.slow; });
  function withSlow(r){
    var o = Object.assign({}, r);
    if (o.slow == null && slowByNo[String(o.no)] != null) o.slow = slowByNo[String(o.no)];
    return o;
  }
  rows = rows.map(withSlow);
  var meta = apRaceMeta(p, rid);
  var ym = apYmSurf(meta.date8, rid, meta.surface, meta.name);   /* 第14弾: 障害は障害の学習だけを使う */
  var S = ym ? apParamsFor(ym) : { hitTm: 1, roiRho: 1, hybLam: 0.55 };
  var rec = apGet(rid);
  var wasNew = !rec;
  if (!rec){
    rec = { rid: rid, created: apNow(), auto: false, meta: meta,
      predHorses: [], result: null, ym: ym || '' };
  }
  // モデル3種で印を合成
  /* ★第17弾・提案3: 学習DBの履歴を引くために「このレースの日付」と距離帯を渡す。
     日付より前の出走だけを使うので、結果を見てから予想するいかさまになりません。 */
  var apdBand = '';
  try {
    var apdM = parseInt(String(meta.dist || '').match(/(\d{3,4})/) ? String(meta.dist).match(/(\d{3,4})/)[1] : '', 10) || 0;
    if (apdM && typeof hfBand === 'function') apdBand = hfBand(apdM);
  } catch(e){}
  var feats = apFeats(rows, { d8: meta.date8 || '', band: apdBand });
  var orderMap = {}, oddsRankMap = {};
  rows.forEach(function(r){ if (r.no != null) orderMap[String(r.no)] = parseInt(r.order, 10) || 0; });
  var withOdds = rows.slice().filter(function(r){ return apNum(r.odds) > 1; })
    .sort(function(a, b){ return apNum(a.odds) - apNum(b.odds); });
  withOdds.forEach(function(r, i){ oddsRankMap[String(r.no)] = i + 1; });
  function mkSet(mode){ return apMarksByU(feats, apUScores(feats, S, mode), orderMap, oddsRankMap); }
  var cMarks = { hit: mkSet('hit'), roi: mkSet('roi'), hyb: mkSet('hyb') };
  /* ★第17弾・提案1: 市場期待勝率 mi = (1÷オッズ) ÷ Σ(1÷オッズ) を各印に付ける。
     学習を「生の3着内率」ではなく「リフト(実勝率 − 市場期待勝率)」で判定するために使う。 */
  var invSum = 0;
  rows.forEach(function(r){ var oo = apNum(r.odds); if (oo > 1) invSum += 1 / oo; });
  if (invSum > 0){
    AP_CONCEPTS.forEach(function(cn){
      (cMarks[cn.id] || []).forEach(function(m){
        var oo2 = apNum(m.odds);
        m.mi = (oo2 > 1) ? (1 / oo2) / invSum : 0;
      });
    });
  }
  if (wasNew){   // 血統関連(⑥)用に印の馬リストを記録しておく
    rec.predHorses = cMarks.hit.map(function(m){ return { no: m.no, name: m.name || '', odds: m.oddsRaw || '', style: m.style || '', mark: m.mark || '', nk: '', pedi: null }; });
  }
  rec.meta = meta;
  rec.auto = rec.auto !== undefined ? rec.auto : true;
  rec.ym = ym || '';
  rec.result = {
    settledAt: apNow(),
    rows: rows.map(function(r){ return { no: r.no, name: r.name || '', order: parseInt(r.order, 10) || 0, odds: r.odds || '', pop: r.pop || '', passing: r.passing || '' }; }),
    // 払戻(全券種): payout=券種別{nos,pays} / payouts=的中1件ごとの生リスト(無い取込元ではnull)
    payout: p.payout || null,
    payouts: (p && p.payouts) || null
  };
  rec.marks = cMarks.hit.slice();   // 旧互換: marks=中率重視(従来のAI印)
  rec.cMarks = cMarks;
  /* ★第17弾: 出走前に保存しておいた「本当の事前予想」(rec.pre) があれば、それとも突き合わせる。
     3モデル(hit/roi/hyb)は結果ページから作り直した再シミュレーションなので、
     ①のAI印の実力を見るにはこちら(pre)が本物。b.pre として別に集計する（学習パラメータは動かさない）。 */
  try {
    var miByNo = {};
    (cMarks.hit || []).forEach(function(m){ if (m && m.no != null) miByNo[String(m.no)] = m.mi || 0; });
    var invAll = 0;
    rows.forEach(function(r){ var oo = apNum(r.odds); if (oo > 1) invAll += 1 / oo; });
    if (invAll > 0){
      rows.forEach(function(r){
        var oo = apNum(r.odds);
        if (oo > 1 && miByNo[String(r.no)] == null) miByNo[String(r.no)] = (1 / oo) / invAll;
      });
    }
    var preMarks = apPreMarks(rec, orderMap, oddsRankMap, miByNo);
    if (preMarks && preMarks.length){
      rec.preMarks = preMarks;
      rec.preSettledAt = apNow();
      apAggAddPre(ym, preMarks);
    }
    /* ★2026-09-12 第18弾: バックテストの予想(rec.preBt)があればそれも照合して b.bt へ集計する */
    var btMarks = apPreMarks(rec, orderMap, oddsRankMap, miByNo, 'preBt');
    if (btMarks && btMarks.length){
      rec.preBtMarks = btMarks;
      rec.preBtSettledAt = apNow();
      apAggAddPre(ym, btMarks, 'preBt');
    }
  } catch(e){}
  rec.lastAt = apNow();
  apPut(rec);
  if (ym) apAggAdd(ym, cMarks, !!nosess);
  return rec;
}
/* バケットへ1レース分を追加 */
function apAggAdd(ym, cMarks, nosess){
  var b = apMB(ym);
  if (!b) b = apBucket(ym);
  AP_CONCEPTS.forEach(function(cn){
    var cb = b.c[cn.id];
    var ms = (cMarks[cn.id] || []).filter(function(m){ return m.order >= 1; });
    if (!ms.length) return;
    cb.n++;
    var winFlag = false, top3Flag = false;
    ms.forEach(function(m){
      cb.horseN++;
      var o = m.order;
      if (o === 1){ cb.horseWin++; winFlag = true; }
      if (o <= 3){ cb.horseTop3++; top3Flag = true; }
      var g = cb.byMark[m.mark] = cb.byMark[m.mark] || { n: 0, win: 0, top3: 0 };
      g.n++; if (o === 1) g.win++; if (o <= 3) g.top3++;
      var mi = (typeof m.mi === 'number' && isFinite(m.mi)) ? m.mi : 0;   // 市場期待勝率
      if (m.aiRank && m.oddsRank && m.aiRank < m.oddsRank){
        cb.boostN++; if (o <= 3) cb.boostTop3++;
        if (o === 1) cb.boostWin++; cb.boostExp += mi;
      } else if (m.aiRank && m.oddsRank && m.aiRank > m.oddsRank){
        cb.dropN++; if (o <= 3) cb.dropTop3++;
        if (o === 1) cb.dropWin++; cb.dropExp += mi;
      } else {
        cb.sameN++; if (o <= 3) cb.sameTop3++;
        if (o === 1) cb.sameWin++; cb.sameExp += mi;
      }
    });
    if (winFlag) cb.winR++;
    if (top3Flag) cb.top3R++;
    // 回収率: 1万円をAI信頼度で印の馬の単勝に配分して買った想定(総払戻 ÷ 1万円)
    var pl = apBetPlan(ms);
    if (pl){
      cb.costU += 10000;
      for (var wi = 0; wi < ms.length; wi++){
        if (ms[wi].order === 1) cb.grossU += pl.stakeOf(ms[wi].no) * ((ms[wi].odds > 1) ? ms[wi].odds : 0);
      }
    }
    if (cn.id === 'hit') apMirrorAdd(ms);
  });
  apMBSave(b);
  if (!nosess) apSessAdd(cMarks);   // 一括取込セッション(今回取得分)にも集計
}
/* 旧互換(全体累積・的中率重視)のミラー。localStorage列挙APIが無い環境でも動く */
function apMirrorRaw(){
  try { var o = JSON.parse(localStorage.getItem(AP_LEARN_LS) || 'null'); return (o && typeof o === 'object') ? o : null; } catch(e){ return null; }
}
function apMirrorAdd(ms){
  var L = apMirrorRaw();
  if (!L || !L.byMark) L = learnInit();
  L.races++;
  ms.forEach(function(m){
    if (!m || !m.order) return;
    var g = L.byMark[m.mark] = L.byMark[m.mark] || { n: 0, win: 0, top3: 0 };
    g.n++; L.marked.n++;
    if (m.order === 1){ g.win++; L.marked.win++; }
    if (m.order <= 3){ g.top3++; L.marked.top3++; }
    L.marked.sumOrd += m.order;
    if (m.aiRank && m.oddsRank && m.aiRank < m.oddsRank){
      L.boost.n++;
      if (m.order === 1) L.boost.win++;
      if (m.order <= 3) L.boost.top3++;
      L.boost.sumOrd += m.order;
    } else if (m.aiRank && m.oddsRank && m.aiRank > m.oddsRank){
      L.drop.n++;
      if (m.order <= 3) L.drop.top3++;
      L.drop.sumOrd += m.order;
    }
  });
  try { safeSetItem(AP_LEARN_LS, JSON.stringify(L))   /* 🥇AI印の学習＝第一優先 */; } catch(e){}
}

/* ================= 一括取込セッション（今回取得したデータの実測） =================
   日付指定・年指定の一括取込開始時に apSessReset() され、
   そのセッションで取込んだレースを3モデルで予想した結果(実際の着順)を集計し、
   的中率・回収率として「🔁 AI予想の自己学習」欄へ表示する。 */
var AP_SESS = null;
function apSessReset(){
  AP_SESS = { started: apNow(), nRaces: 0, c: { hit: apCBInit(), roi: apCBInit(), hyb: apCBInit() } };
}
function apSessAdd(cMarks){
  if (!AP_SESS) return;
  AP_SESS.nRaces++;
  AP_CONCEPTS.forEach(function(cn){
    var cb = AP_SESS.c[cn.id];
    var ms = (cMarks[cn.id] || []).filter(function(m){ return m.order >= 1; });
    if (!ms.length) return;
    cb.n++;
    var winFlag = false, top3Flag = false;
    ms.forEach(function(m){
      cb.horseN++;
      var o = m.order;
      if (o === 1){ cb.horseWin++; winFlag = true; }
      if (o <= 3){ cb.horseTop3++; top3Flag = true; }
    });
    if (winFlag) cb.winR++;
    if (top3Flag) cb.top3R++;
    var pl = apBetPlan(ms);
    if (pl){
      cb.costU += 10000;
      for (var wi = 0; wi < ms.length; wi++){
        if (ms[wi].order === 1) cb.grossU += pl.stakeOf(ms[wi].no) * ((ms[wi].odds > 1) ? ms[wi].odds : 0);
      }
    }
  });
}
function apSessText(){
  /* 取込完了メッセージ用の1行要約 */
  if (!AP_SESS || !AP_SESS.nRaces) return '';
  var short = { hit: '🎯的中', roi: '💰回収', hyb: '🔰HYB' };
  var parts = [];
  AP_CONCEPTS.forEach(function(cn){
    var cb = AP_SESS.c[cn.id] || apCBInit();
    var hit = cb.n ? apPct1(cb.winR / cb.n * 100, 100) : '−';
    var roi = cb.costU > 0 ? apPct1(cb.grossU / cb.costU * 100, 100) : '−';
    parts.push((short[cn.id] || cn.id) + '的中' + hit + '%・回収' + roi + '%');
  });
  return AP_SESS.nRaces + 'レース／' + parts.join('  ');
}
function apSessHTML(){
  if (!AP_SESS || !AP_SESS.nRaces) return '';
  var h = ['<div style="margin-top:6px;border:1px solid var(--line2);border-radius:8px;padding:5px 8px;background:var(--card2)">'];
  h.push('<div class="small" style="font-weight:bold;color:var(--info-ink)">📥 一括取込セッションの実測（今回取得したデータ ' + AP_SESS.nRaces + ' レース: 3モデルの予想 × 実際の結果）</div>');
  h.push('<table class="lr-tbl mmtbl"><thead><tr><th style="text-align:left">モデル</th><th>検証レース</th><th>印内1着</th><th>的中率(印内1着)</th><th>3着内率(印内)</th><th>回収率(1万円AI買い目)</th></tr></thead><tbody>');
  AP_CONCEPTS.forEach(function(cn){
    var cb = AP_SESS.c[cn.id] || apCBInit();
    var hitR = cb.n ? apPct1(cb.winR / cb.n * 100, 100) : '−';
    var top3R = cb.horseN ? apPct1(cb.horseTop3 / cb.horseN * 100, 100) : '−';
    var roi = cb.costU > 0 ? apPct1(cb.grossU / cb.costU * 100, 100) : '−';
    var roiCls = (roi !== '−' && parseFloat(roi) >= 100) ? ' style="color:var(--ok-ink);font-weight:800"' : '';
    h.push('<tr><td style="text-align:left;color:' + cn.color + '"><b>' + cn.emoji + esc(cn.name) + '</b></td><td>' + cb.n + '</td><td>' + cb.winR + '</td><td>' + hitR + '%</td><td>' + top3R + '%</td><td><b' + roiCls + '>' + roi + '%</b></td></tr>');
  });
  h.push('</tbody></table>');
  h.push('<div class="small muted">的中率＝印(◎〜△の5頭)内に<b>1着馬</b>が含まれたレースの割合 / 3着内率＝印内の馬が3着以内に入った割合 / 回収率＝各レース<b>1万円</b>を資金に、そのモデルの印5頭(◎○▲☆△)の単勝へ<b>AIの信頼度で配分購入</b>した想定の総払戻÷1万円です(印内に1着が居ない・オッズ不明の馬には賭けない)。取込時には単勝に加えて<b>複勝・枠連・ワイド・馬連・馬単・3連複・3連単の払戻金</b>も各レースの保存データへ保存します（検証スコア自体は印5頭の単勝への配分買い目で算出）。</div>');
  h.push('</div>');
  return h.join('');
}
/* ★2026-09-12 第18弾: 📌事前予想(b.pre) と 🕰バックテスト(b.bt) の通算成績を出す。
   どちらも「出走前と同じ条件で作った印 × 実際の結果」なので、3モデルの再シミュレーションより
   ①のAI印の実力に近い数字になります。集計は全月のバケットを単純に合算します。 */
function apPreBtSum(key){
  var t = { n: 0, winR: 0, top3R: 0, horseN: 0, horseWin: 0, horseTop3: 0, costU: 0, grossU: 0,
            boostN: 0, boostWin: 0, boostExp: 0, yms: 0 };
  try {
    apYms().forEach(function(ym){
      var b = apMB(ym);
      var cb = b && b[key];
      if (!cb || !cb.n) return;
      t.yms++;
      ['n','winR','top3R','horseN','horseWin','horseTop3','costU','grossU','boostN','boostWin','boostExp']
        .forEach(function(k){ t[k] += (cb[k] || 0); });
    });
  } catch(e){}
  return t;
}
function apPreBtHTML(){
  var defs = [
    { k: 'pre', emoji: '📌', name: '事前予想（レース前に実際に保存した印）', color: 'var(--ok-ink)' },
    { k: 'bt',  emoji: '🕰', name: 'バックテスト（過去を結果を見ずに予想し直し）', color: '#b39ddb' }
  ];
  var rows = [];
  defs.forEach(function(d){
    var t = apPreBtSum(d.k);
    if (!t.n) return;
    var hit = t.n ? (t.winR / t.n * 100) : 0;
    var t3 = t.horseN ? (t.horseTop3 / t.horseN * 100) : 0;
    var roi = t.costU > 0 ? (t.grossU / t.costU * 100) : null;
    var lift = (t.boostN && t.boostExp > 0)
      ? ((t.boostWin / t.boostN) / (t.boostExp / t.boostN)) : null;
    rows.push('<tr><td style="text-align:left;color:' + d.color + '"><b>' + d.emoji + ' ' + esc(d.name) + '</b></td>' +
      '<td>' + t.n + '</td><td>' + t.winR + '</td><td><b>' + hit.toFixed(1) + '%</b></td>' +
      '<td>' + t3.toFixed(1) + '%</td>' +
      '<td' + (roi != null && roi >= 100 ? ' style="color:var(--ok-ink);font-weight:800"' : '') + '>' +
        (roi == null ? '−' : roi.toFixed(1) + '%') + '</td>' +
      '<td>' + (lift == null ? '−' : lift.toFixed(2)) + '</td></tr>');
  });
  if (!rows.length) return '';
  return '<div style="margin-top:6px;border:1px solid var(--line2);border-radius:8px;padding:5px 8px;background:var(--card2)">' +
    '<div class="small" style="font-weight:bold;color:var(--info-ink)">📌🕰 出走前と同じ条件で作った印の実測（通算）</div>' +
    '<div style="overflow-x:auto"><table class="lr-tbl mmtbl"><thead><tr>' +
    '<th style="text-align:left">印の出どころ</th><th>検証レース</th><th>印内1着</th><th>的中率(印内1着)</th>' +
    '<th>3着内率(印内)</th><th>回収率(1万円AI買い目)</th><th>リフト(上げた馬)</th></tr></thead><tbody>' +
    rows.join('') + '</tbody></table></div>' +
    '<div class="small muted">📌＝①の「📥 その日の出馬表を一括取得」で<b>レース前に保存した予想</b>（本物）。' +
    '🕰＝①の「🕰 バックテスト」で<b>過去レースを結果を見ずに予想し直した</b>もの（学習DBのレース前情報だけを使用・' +
    '結果側の着順/タイム/上り/通過順/着差/払戻は不使用・過去実績もレース日より前の出走だけ）。' +
    '<b>リフト</b>＝AIが人気より上げた馬の実勝率÷市場期待勝率（1.00で市場並み・1.0超なら市場より上手）。' +
    '3モデル（🎯💰🔰）は結果ページから印を作り直した再シミュレーションなので、こちらの数字の方が①のAI印の実力に近いです。</div></div>';
}

/* ---------- エンジンへ渡す反映値(現在のレース開催月より前の学習) ---------- */
function apActive(){
  var use = !(state && state.apLearnUse === false);
  var model = apCurModel();
  var ym = '';
  try { ym = apCurYm(); } catch(e){ ym = ''; }
  var S = apParamsFor(ym || '999912');
  if (!use || !S.totalR || S.totalR < 20) return { apply: false, penalty: 0, scale: 1, note: '', model: model, totalR: S.totalR, lastYm: S.lastYm };
  var scale = apModelScale(S, model);
  var penalty = 1 - scale;
  if (Math.abs(penalty) < 0.02) return { apply: false, penalty: 0, scale: 1, note: '', model: model, totalR: S.totalR, lastYm: S.lastYm };
  return { apply: true, penalty: penalty, scale: scale, model: model,
    S: S, totalR: S.totalR, lastYm: S.lastYm,
    note: apActiveNote(S, model, ym) };
}
function apActiveNote(S, model, ym){
  var srcLabel = S.lastYm ? apYmTxt(S.lastYm) : '';
  var mn = apModelName(model);
  var hitS = clamp(S.hitTm == null ? 1 : S.hitTm, 0.4, 1.0);
  var lam = S.hybLam == null ? 0.55 : clamp(S.hybLam, 0, 1);
  var rho = S.roiRho == null ? 1 : S.roiRho;
  var hitTxt = '展開/脚質の重み ×' + hitS.toFixed(2) + (S.hitSrc === 'lift' && S.lift
      ? '（リフト判定: 上げた馬 ' + S.lift.n + ' 頭が実勝率 ' + (S.lift.act * 100).toFixed(1) +
        '% / 市場期待 ' + (S.lift.exp * 100).toFixed(1) + '% ＝ 期待比 ' + S.lift.ratio.toFixed(2) + ' 倍）'
      : (S.hitSrc === 'legacy' ? '（旧形式の集計から判定）' : ''));
  var extra = '（' + hitTxt + ' ・ 妙味係数 ' + rho.toFixed(2) + ' ・ 混合比λ ' + lam.toFixed(2) + '）';
  if (model === 'roi') extra = '（中穴〜大穴の妙味係数 ' + rho.toFixed(2) + '・本命は約5番人気以下から選定）';
  if (model === 'hit') extra = '（' + hitTxt + '）';
  return '🔁 自己学習(' + mn + 'モデル): 前月以前の自動検証 ' + S.totalR + ' レース' + (srcLabel ? '（直近は' + srcLabel + '）' : '') + 'から補正を学習' + extra + '。AI予想へ自動反映しています。';
}
function apModelName(id){ for (var i = 0; i < AP_CONCEPTS.length; i++){ if (AP_CONCEPTS[i].id === id) return AP_CONCEPTS[i].name; } return id; }

/* ---------- 旧互換: 全体サマリ ---------- */
function learnInit(){
  return { races: 0, marked: { n: 0, win: 0, top3: 0, sumOrd: 0 },
    boost: { n: 0, win: 0, top3: 0, sumOrd: 0 },
    drop: { n: 0, top3: 0, sumOrd: 0 },
    byMark: {}, bySurf: {} };
}
function apLs(){
  var L = apMirrorRaw();
  if (L && (L.byMark || L.races)){ if (!L.bySurf) L.bySurf = {}; return L; }
  /* フォールバック: レコードから再集計(列挙APIが使える環境) */
  L = learnInit();
  var comp = apCompleted();
  comp.forEach(function(rec){
    (rec.marks || []).forEach(function(m){
      if (!m || !m.order) return;
      var g = L.byMark[m.mark] = L.byMark[m.mark] || { n: 0, win: 0, top3: 0 };
      g.n++; L.marked.n++;
      if (m.order === 1){ g.win++; L.marked.win++; }
      if (m.order <= 3){ g.top3++; L.marked.top3++; }
      L.marked.sumOrd += m.order;
      if (m.aiRank && m.oddsRank && m.aiRank < m.oddsRank){
        L.boost.n++;
        if (m.order === 1) L.boost.win++;
        if (m.order <= 3) L.boost.top3++;
        L.boost.sumOrd += m.order;
      } else if (m.aiRank && m.oddsRank && m.aiRank > m.oddsRank){
        L.drop.n++;
        if (m.order <= 3) L.drop.top3++;
        L.drop.sumOrd += m.order;
      }
    });
  });
  L.races = comp.length;
  return L;
}

/* ---------- 表示 ---------- */
function apModelMarksHTML(){
  /* 「各予想モデルの印」カード: 現在の出馬表を自己学習3モデルで印評価して表にする */
  var hs = ((state && state.horses) || []).filter(function(h){ return h.no; });
  if (hs.length < 3){
    return '<div class="small muted">馬を3頭以上登録すると、3モデル（🎯的中率重視 / 💰回収率重視 / 🔰ハイブリッド）が「どの馬に印を打つか」の比較表を表示します。</div>';
  }
  try {
    var ym = apCurYm();
    var S = apParamsFor(ym || '999912');
    var feats = apFeats(hs);
    var orderMap = {}, oddsRankMap = {};
    var withOdds = hs.slice().filter(function(h){ return apNum(h.odds) > 1; })
      .sort(function(a, b){ return apNum(a.odds) - apNum(b.odds); });
    withOdds.forEach(function(h, i){ oddsRankMap[String(h.no)] = i + 1; });
    var cur = apCurModel();
    var rows = [];
    AP_CONCEPTS.forEach(function(cn){
      var mk = apMarksByU(feats, apUScores(feats, S, cn.id), orderMap, oddsRankMap);
      var on = (cn.id === cur);
      var cell = AP_MARK_ORDER.map(function(mm, ri){
        var m = mk[ri];
        if (!m) return '<td>−</td>';
        return '<td title="' + esc(m.name || '') + ' ' + esc(m.no) + '番"><span class="mm-no" style="color:' + cn.color + '"><b>' + esc(m.no) + '</b></span><span class="mm-name">' + esc(m.name || '') + '</span></td>';
      }).join('');
      var cnSub = (cn.id === 'roi') ? ' <span style="font-size:.68rem;opacity:.85">（5番人気以下・中穴〜大穴）</span>' : '';
      rows.push('<tr><td style="text-align:left;color:' + cn.color + ';white-space:normal"><b>' + cn.emoji + esc(cn.name) + '</b>' + cnSub +
        (on ? ' <span style="color:var(--ok-ink);font-size:.7rem">◀ AI印に反映中</span>' : '') + '</td>' + cell + '</tr>');
    });
    return '<div style="overflow-x:auto"><table class="lr-tbl mmtbl"><thead><tr><th style="text-align:left">モデル</th><th>◎</th><th>○</th><th>▲</th><th>☆</th><th>△</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' +
      '<div class="small muted" style="margin-top:2px">この表は「AI印と総合評価」表とは別系統の「3モデル」比較です。総合評価表はオッズ(人気)を軸に、調教・持ちタイム・展開適性・バ場・あなたの印・出遅れ率を加えて本命印を算出します（馬名は長いと省略表示・マウスで全名表示）。</div>';
  } catch(e){ return ''; }
}
function apConceptPreview(){
  /* 現在開いている馬(出馬表)を3モデルで印評価した文字列 */
  try {
    var hs = ((state && state.horses) || []).filter(function(h){ return h.no; });
    if (hs.length < 3) return '';
    var ym = apCurYm();
    var S = apParamsFor(ym);
    var feats = apFeats(hs);
    var orderMap = {}, oddsRankMap = {};
    var withOdds = hs.slice().filter(function(h){ return apNum(h.odds) > 1; })
      .sort(function(a, b){ return apNum(a.odds) - apNum(b.odds); });
    withOdds.forEach(function(h, i){ oddsRankMap[String(h.no)] = i + 1; });
    var parts = [];
    AP_CONCEPTS.forEach(function(cn){
      var mk = apMarksByU(feats, apUScores(feats, S, cn.id), orderMap, oddsRankMap);
      var psub = (cn.id === 'roi') ? '（中穴〜大穴）' : '';
      parts.push('<span style="color:' + cn.color + '"><b>' + cn.emoji + cn.name + psub + '</b> ' +
        (mk.length ? mk.map(function(m){ return m.mark + m.no + (m.name ? ' ' + m.name : ''); }).join(' / ') : '（印なし）') + '</span>');
    });
    return parts.join('<br>');
  } catch(e){ return ''; }
}
function apMonthTableHTML(ym, label){
  var agg;
  if (ym) agg = apConceptsAgg(apMB(ym));
  else agg = { hit: { races: 0 }, roi: { races: 0 }, hyb: { races: 0 } };
  var h = ['<div class="small" style="font-weight:bold;margin-top:8px">' + label + ' モデル別の成績（3モデルで同じレースを予想し直して照合）</div>'];
  h.push('<table class="lr-tbl"><thead><tr><th>モデル</th><th>レース</th><th>印内1着</th><th>3着内率</th><th>回収率(1万円AI買い目)</th><th>学習パラメータ</th></tr></thead><tbody>');
  var S = ym ? apParamsFor(ym) : { hitTm: 1, roiRho: 1, hybLam: 0.55 };
  AP_CONCEPTS.forEach(function(cn){
    var a = agg[cn.id] || {};
    var par;
    if (cn.id === 'hit') par = '展開/脚質の重み ×' + clamp(S.hitTm == null ? 1 : S.hitTm, 0.4, 1.4).toFixed(2);
    else if (cn.id === 'roi') par = '中穴〜大穴の妙味係数 ' + (S.roiRho == null ? 1 : S.roiRho).toFixed(2);
    else par = '混合λ ' + (S.hybLam == null ? 0.55 : S.hybLam).toFixed(2) + '（目標回収率100%以上）';
    var roiStr = a.roiPct === '−' ? '−' : '<b>' + a.roiPct + '%</b>' + (cn.id === 'hyb' ? (parseFloat(a.roiPct) >= 100 ? ' ✅' : '') : '');
    h.push('<tr><td style="color:' + cn.color + '"><b>' + cn.emoji + esc(cn.name) + '</b></td><td>' + (a.races || 0) + '</td><td>' + (a.win || 0) + '頭</td><td>' + (a.top3Pct === '−' ? '−' : a.top3Pct + '%') + '</td><td>' + roiStr + '</td><td class="muted">' + par + '</td></tr>');
  });
  h.push('</tbody></table>');
  return h.join('');
}
function apStatsHTML(){
  var ymsAll0 = apYms().sort();
  // 第15弾: 結果が確定していない「未来の月」は集計・表示・学習のどれも対象外にする
  var ymsFuture0 = ymsAll0.filter(function(y){ return apYmState(y) === 'future'; });
  var yms = ymsAll0.filter(function(y){ return apYmState(y) !== 'future'; });
  var totalR = 0;
  yms.forEach(function(y){ var b = apMB(y); if (b) totalR += (b.c.hit.n || 0); });
  var mir = apMirrorRaw();
  var n = (mir && mir.races) || totalR || 0;
  if (!n && !totalR && !ymsFuture0.length){
    return '<div class="small muted">まだ自己検証の記録がありません。過去データ（日付指定・「年指定の一括取得」で年月ごとに取込）でレースを取込むと、そのレースを<b>3つのモデル（🎯的中率重視 / 💰回収率重視 / 🔰ハイブリッド）</b>それぞれで予想し直し、実際の着順・払戻（単勝/複勝/枠連/ワイド/馬連/馬単/3連複/3連単を保存）と照合して<b>開催年月ごとに</b>学習します（結果メモの📥取込でも同様）。学習は保存領域（IndexedDB大容量モードではDB内）に蓄積され、翌月以降の予想へ自動反映されます。</div>';
  }
  var h = [];
  var curYm = '';
  try { curYm = apCurYm(); } catch(e){}
  var S = apParamsFor(curYm || '999912');
  h.push('<div class="small muted" style="margin-bottom:4px">過去のレースを「単勝オッズ・人気・脚質(4角通過)」から3モデルで予想し直し、実際の着順・払戻（単勝/複勝/枠連/ワイド/馬連/馬単/3連複/3連単）と照合した結果です。🎯的中率重視=人気軸 / 💰回収率重視=中穴〜大穴(約5番人気以下)から本命を選ぶ / 🔰ハイブリッド=両者を混合。開催年月ごとに集計し、「前の月まで」の実績から翌月以降へ使う補正を学習します。</div>');
  var sessHtml = apSessHTML();
  if (sessHtml) h.push(sessHtml);
  /* ★2026-09-12 第18弾: 📌事前予想 と 🕰バックテスト の通算成績（全月ぶんを合算） */
  try { var pb = apPreBtHTML(); if (pb) h.push(pb); } catch(e){}
  // 直近の学習状況
  if (S.totalR > 0){
    var srcLabel = S.lastYm ? apYmTxt(S.lastYm) : '';
    h.push('<div class="small" style="margin:4px 0;color:var(--ok-ink)">📚 今後の予想へ反映する学習: 前月以前の検証 <b>' + S.totalR + ' レース</b>' + (srcLabel ? '（直近の学習月: ' + srcLabel + '）' : '') + '<br>' +
      '　・🎯 的中率重視: 展開/脚質の重み <b>×' + clamp(S.hitTm == null ? 1 : S.hitTm, 0.4, 1.4).toFixed(2) + '</b>' +
      '　・💰 回収率重視: 妙味係数 <b>' + (S.roiRho == null ? 1 : S.roiRho).toFixed(2) + '</b>' +
      '　・🔰 ハイブリッド: 混合λ <b>' + (S.hybLam == null ? 0.55 : S.hybLam).toFixed(2) + '</b>（回収率100%以上を目指して自動調整）</div>');
  }
  // 現在レースの3モデル印は「各予想モデルの印」カード(modelBox)の表で表示
  // 月履歴テーブル
  // 2026-09-12 第15弾: 「結果が確定していない月」は回収率の表へ出さない。
  //   - 今日はまだ来ていない月（例: 9月なのに 202610 の集計がある）＝未来月 → 表示しない
  //   - 今月（開催中）＝結果が確定途中 → 表示するが「今月・結果は確定途中」の印を付ける
  var ymsAll = ymsAll0.slice().reverse();
  var ymsFuture = ymsAll.filter(function(y){ return apYmState(y) === 'future'; });
  var ymsR = ymsAll.filter(function(y){ return apYmState(y) !== 'future'; });
  if (ymsR.length){
    h.push('<table class="lr-tbl" style="margin-top:6px"><thead><tr><th>開催月</th>');
    AP_CONCEPTS.forEach(function(cn){ h.push('<th>' + cn.emoji + (cn.id === 'hyb' ? 'HYB' : cn.id === 'hit' ? '的中' : '回収') + ' 3着内率</th><th>回収率</th>'); });
    h.push('</tr></thead><tbody>');
    ymsR.slice(0, 24).forEach(function(y){
      var agg = apConceptsAgg(apMB(y));
      var cur = (apYmState(y) === 'cur');
      h.push('<tr' + (cur ? ' style="opacity:.82"' : '') + '><td style="white-space:nowrap">' + esc(apYmTxt(y)) +
        (cur ? '<br><span class="small" style="color:var(--warn-ink);font-weight:700">今月・結果は確定途中</span>' : '') + '</td>');
      AP_CONCEPTS.forEach(function(cn){
        var a = agg[cn.id] || {};
        h.push('<td>' + (a.top3Pct === '−' ? '−' : a.top3Pct + '%') + '</td><td>' + (a.roiPct === '−' ? '−' : a.roiPct + '%') + '</td>');
      });
      h.push('</tr>');
    });
    h.push('</tbody></table>');
    if (ymsR.length > 24) h.push('<div class="small muted">直近24か月を表示（結果が確定した ' + ymsR.length + ' か月分がDBに保存されています）</div>');
  }
  if (ymsFuture.length){
    var fN = 0;
    ymsFuture.forEach(function(y){ var b = apMB(y); if (b && b.c && b.c.hit) fN += (b.c.hit.n || 0); });
    h.push('<div class="small" style="margin-top:4px;color:var(--warn-ink)">🚫 <b>結果が確定していない月</b>（' +
      esc(ymsFuture.map(apYmTxt).join('・')) + '）の ' + fN + ' レースぶんは回収率の表へ表示していません' +
      '（今日は ' + esc(apYmTxt(apNowYm())) + ' のため、それより後の月はまだ結果が出ていません）。学習にも使いません。</div>');
  }
  // 直近の月の詳細(モデル別の印成績) — 未来月は対象にしない
  if (ymsR.length){
    h.push(apMonthTableHTML(ymsR[0], '📅 ' + apYmTxt(ymsR[0]) + (apYmState(ymsR[0]) === 'cur' ? '（今月・結果は確定途中）' : '')));
  }
  // 全体サマリ(旧互換: 印ごとの的中)
  var L = apLs();
  h.push('<div class="small" style="font-weight:bold;margin-top:8px">印ごとの的中（的中率重視モデル・全期間）</div>');
  h.push('<table class="lr-tbl"><thead><tr><th>印</th><th>頭数</th><th>1着</th><th>3着内</th><th>1着率</th><th>3着内率</th></tr></thead><tbody>');
  AP_MARK_ORDER.forEach(function(m){ var g = L.byMark && L.byMark[m]; if (g){ h.push('<tr><td><b>' + m + '</b></td><td>' + g.n + '</td><td>' + g.win + '</td><td>' + g.top3 + '</td><td>' + apPct(g.win, g.n) + '%</td><td>' + apPct(g.top3, g.n) + '%</td></tr>'); } });
  Object.keys(L.byMark || {}).forEach(function(m){ if (AP_MARK_ORDER.indexOf(m) < 0){ var g = L.byMark[m]; h.push('<tr><td><b>' + m + '</b></td><td>' + g.n + '</td><td>' + g.win + '</td><td>' + g.top3 + '</td><td>' + apPct(g.win, g.n) + '%</td><td>' + apPct(g.top3, g.n) + '%</td></tr>'); } });
  h.push('</tbody></table>');
  var act = apActive();
  if (act.apply && act.note) h.push('<div class="small" style="margin-top:6px;color:var(--ok-ink)">' + act.note + '</div>');
  else h.push('<div class="small muted" style="margin-top:6px">' + apLearnMsg(act) + '</div>');
  if (AP_RELEARN_LAST){
    var rr2 = AP_RELEARN_LAST;
    var rd = String(rr2.at || '').replace('T', ' ').slice(0, 16);
    h.push('<div class="small muted" style="margin-top:3px">🔄 直近の再学習: ' + esc(rd) + ' ／ ' + rr2.ok + ' レースを再評価' +
      (rr2.err ? '（失敗 ' + rr2.err + '）' : '') + '（現在のモデルで再構築済み）</div>');
  }
  h.push('<div class="small muted" style="margin-top:4px">保存先: ' + (apMode === 'idb' ? '📀 IndexedDB(大容量) ' + AP_DB : '🗂 従来の保存領域') + ' ／ 検証レース ' + n + ' 件・集計 ' + totalR + ' レース分' + (yms.length ? '・' + yms.length + 'か月分（結果確定）' : '') +
      (ymsFuture0.length ? '　※結果が確定していない ' + ymsFuture0.length + ' か月分（' + esc(ymsFuture0.map(apYmTxt).join('・')) + '）は表示・学習の対象外' : '') + '</div>');
  return h.join('');
}
function apLearnMsg(act){
  act = act || apActive();
  if (!act.totalR) return 'データが少ないため補正はまだ行っていません（自動検証の記録が0）。過去データを年指定で一括取込すると、年月ごとに学習が始まります。';
  if (act.totalR < 20) return '補正はまだ行っていません（自動検証 ' + act.totalR + ' レース / 補正開始は前月以前20レース以上から）。';
  return '現在は乖離が有意でない、または反映OFFのため未適用です（自動検証 ' + act.totalR + ' レース）。';
}
function apSyncUi(){
  try {
    var val = apCurModel();
    var set = $('apModelSet');
    if (set){
      var ins = set.querySelectorAll('input[name="apModel"]');
      for (var i = 0; i < ins.length; i++){ ins[i].checked = (ins[i].value === val); }
    }
    var uc = $('apUseChk');
    if (uc) uc.checked = !(state && state.apLearnUse === false);
  } catch(e){}
}
function apRender(){
  apSyncUi();
  var el = $('apOut'); if (!el) return;
  el.innerHTML = apStatsHTML();
  // 第15弾: 結果が確定していない「未来の月」は chip の集計にも入れない
  var totalR = 0, nYm = 0, nFut = 0;
  apYms().forEach(function(y){
    if (apYmState(y) === 'future'){ nFut++; return; }
    var b = apMB(y); if (b){ totalR += (b.c.hit.n || 0); nYm++; }
  });
  var cnt = $('apCount'); if (cnt) cnt.textContent = totalR ? ('学習 ' + totalR + ' レース') : '未学習';
  try { apPaintPick(totalR, nYm, nFut); } catch(e){}
}
/* 2026-09-12 第15弾: 🔁自己学習カードは折り込みになったので、
   折り込んだままでも「何をどれだけ学習して、いま何がAI印に効いているか」が
   1行で分かるように summary 内（#apPick）へ要点を書き出します。 */
function apPaintPick(totalR, nYm, nFut){
  var el = $('apPick'); if (!el) return;
  var curYm = '';
  try { curYm = apCurYm(); } catch(e){}
  var S = apParamsFor(curYm || '999912');
  var futTxt = nFut ? '<span class="pickwarn">　🚫 結果が確定していない ' + nFut + ' か月ぶんは表示・学習の対象外</span>' : '';
  if (!(totalR > 0) && !(S.totalR > 0)){
    el.innerHTML = '📚 まだ自己検証の記録がありません。過去データ（日付指定・年指定の一括取得・結果メモの📥取込）でレースを取り込むと、' +
      '3モデル（🎯的中率重視／💰回収率重視／🔰ハイブリッド）で予想し直し、<b>開催年月ごとに</b>学習します。' + futTxt;
    return;
  }
  var use = (typeof state !== 'undefined' && state && state.apLearnUse === false) ? '（いまはAI印へ<b>反映OFF</b>）' : '';
  el.innerHTML = '📚 <b>結果が確定した ' + (nYm || 0) + ' か月・' + (totalR || 0) + ' レース</b>を学習ずみ' +
    '　→ 今後の予想へ反映する補正: 🎯 展開/脚質の重み <b>×' + clamp(S.hitTm == null ? 1 : S.hitTm, 0.4, 1.4).toFixed(2) + '</b>' +
    '　・💰 妙味係数 <b>' + (S.roiRho == null ? 1 : S.roiRho).toFixed(2) + '</b>' +
    '　・🔰 混合λ <b>' + (S.hybLam == null ? 0.55 : S.hybLam).toFixed(2) + '</b>' +
    (S.lastYm ? '　（直近の学習月: <b>' + esc(apYmTxt(S.lastYm)) + '</b>）' : '') + use +
    (S.totalR > 0 ? '' : '　<span class="muted">※「前の月まで」の実績が20レース以上になると補正が始まります</span>') + futTxt;
}
/* ================= 再学習(保存済み過去レースを現在のモデルで再評価) =================
   使いどころ: ① 予想モデル(判定式・スコア)を変更した ② 年指定一括取込や結果メモ📥・
   サイド(横)取得などで過去レースを追加した ときに押すと、
   「学習DB(日別取込)に保存済みの全レース＋自己検証済みレコード」を
   いまの3モデルで評価し直して、年月別の集計・パラメータを再構築する。 */
var AP_RELEARN_LAST = null;   // { at, n, ok, err } 直近の再学習結果(セッション内表示)
var AP_RELEARN_BUSY = false;
/* 学習集計(年月バケット)と旧ミラーだけを消す(1レースごとの記録recは保持) */
function apClearLearnOnly(){
  try {
    var yms = apYms();
    if (apMode === 'idb' && apLrnMem){
      yms.forEach(function(y){
        delete apLrnMem[y];
        try { apIdbDelS(AP_LRN_STORE, y); } catch(e){}
      });
    } else {
      yms.forEach(function(y){ try { localStorage.removeItem(AP_YM_PREFIX + y); } catch(e){} });
    }
  } catch(e){}
  try { localStorage.removeItem(AP_LEARN_LS); } catch(e){}
}
/* 再評価の対象レース一覧: 学習DB(優先・通過順位などが豊富)＋自己検証済みレコード(サイド取得分)
   を rid で重複排除して日付順(rid昇順)に返す */
function apStoredRaceList(){
  var byRid = {}, out = [];
  function pushRid(rid, p){
    if (!rid || !p || byRid[rid]) return;
    byRid[rid] = 1;
    out.push({ rid: rid, p: p });
  }
  try {
    if (typeof diLs === 'function'){
      var db = diLs();
      var ks = Object.keys(db.races || {});
      for (var qi = 0; qi < ks.length; qi++){
        var r = db.races[ks[qi]];
        if (!r) continue;
        var rows = ((r && r.rows) || []).filter(function(x){ return x && x.order >= 1 && x.no; });
        if (rows.length >= 3) pushRid(ks[qi], { rows: rows, payout: (r && r.payout) || null, payouts: (r && r.payouts) || null,
          // ★第17弾: 学習DBに保存されている日付・メタを渡す（これが無いと race_id から日付を捏造していた）
          date8: (r && (r.date8 || (r.meta && r.meta.date8))) || '', meta: (r && r.meta) || null });
      }
    }
  } catch(e){}
  try {
    var done = apCompleted() || [];
    for (var di = 0; di < done.length; di++){
      var rec = done[di];
      if (!rec || byRid[rec.rid]) continue;
      var rows2 = (((rec.result && rec.result.rows) || [])).filter(function(x){ return x && x.order >= 1 && x.no; });
      if (rows2.length >= 3) pushRid(rec.rid, { rows: rows2, payout: rec.result ? rec.result.payout : null, payouts: rec.result ? rec.result.payouts : null,
        date8: (rec.meta && rec.meta.date8) || '', meta: rec.meta || null });   // ★第17弾: 日付・メタを引き継ぐ
    }
  } catch(e){}
  out.sort(function(a, b){ return (a.rid < b.rid ? -1 : a.rid > b.rid ? 1 : 0); });
  return out;
}
/* 再学習ボタンの処理(チャンク実行で画面を固めない) */
function apRelearnAll(){
  if (AP_RELEARN_BUSY) return;
  var btn = null, msgEl = null;
  try { btn = $('apRelearn'); msgEl = $('apRelearnMsg'); } catch(e){}
  function say(t, err){
    if (msgEl) msgEl.innerHTML = '<span style="color:' + (err ? 'var(--err-ink)' : 'var(--ok-ink)') + '">' + esc(t) + '</span>';
  }
  if (btn) btn.disabled = true;
  var list = apStoredRaceList();
  if (!list.length){
    say('保存済みの過去レースが見つかりません。先に「学習データ」タブの年指定・日付指定の取込か、結果メモ📥の取込で過去レースを保存してください。', true);
    if (btn) btn.disabled = false;
    return;
  }
  AP_RELEARN_BUSY = true;
  say('再学習を開始… 保存済み ' + list.length + ' レースを「今の3モデル(判定式・中穴〜大穴・1万円AI買い目)」で評価し直します（年月別集計を一旦クリアして再構築）');
  try { apClearLearnOnly(); } catch(e){}
  var i = 0, ok = 0, err = 0;
  function finish(){
    AP_RELEARN_BUSY = false;
    AP_RELEARN_LAST = { at: apNow(), n: list.length, ok: ok, err: err };
    try { if (typeof apRender === 'function') apRender(); } catch(e){}
    if (btn) btn.disabled = false;
    say('✅ 再学習が完了しました: ' + ok + ' レースを再評価' + (err ? '（失敗 ' + err + '）' : '') + '。年月別の成績・学習パラメータを現在のモデルで再構築しました（上記の直近実測欄に反映済み）。');
  }
  function runChunk(){
    var until = Math.min(list.length, i + 60);
    for (; i < until; i++){
      try {
        var it = list[i];
        var rec = apEval(it.p, it.rid, true, true);   // nosess=true(チャンク中はセッション集計しない)
        if (rec) ok++; else err++;
      } catch(e){ err++; }
    }
    if (i < list.length){
      say('再学習 ' + i + ' / ' + list.length + ' レース…');
      // 画面を固めないため setTimeout で継続(非ネイティブのテスト環境では同期フォールバック)
      try {
        if (typeof setTimeout === 'function' && /\[native code\]/.test(Function.prototype.toString.call(setTimeout))){ setTimeout(runChunk, 0); return; }
      } catch(e){}
      runChunk();
      return;
    }
    finish();
  }
  runChunk();
}
function apResetAll(){
  apClear();
  apRender();
  if (typeof diRenderStat === 'function'){ try { diRenderStat(); } catch(e){} }
}
function apSetModel(m){
  if (['hit','roi','hyb'].indexOf(m) < 0) m = 'hyb';
  try {
    state.apModel = m;
    if (typeof saveNow === 'function'){ try { saveNow(); } catch(e){} }
  } catch(e){}
  apRender();
  if (typeof renderTables === 'function' && typeof currentAnalysis === 'function'){ try { renderTables(currentAnalysis()); } catch(e){} }
}
function initAp(){
  var rs = $('apReset'); if (rs) rs.addEventListener('click', function(){
    if (!window.confirm || window.confirm('自己学習の記録と年月ごとの累積データをすべて消去しますか？')){
      apResetAll();
    }
  });
  var rl = $('apRelearn');
  if (rl) rl.addEventListener('click', function(){ apRelearnAll(); });
  var uc = $('apUseChk');
  if (uc) uc.addEventListener('change', function(){
    try { state.apLearnUse = !uc.checked; saveNow(); } catch(e){}
    apRender();
    if (typeof renderTables === 'function' && typeof currentAnalysis === 'function'){ try { renderTables(currentAnalysis()); } catch(e){} }
  });
  // 3モデルのセレクト(ラジオ)
  var mk = $('apModelSet');
  if (mk) mk.addEventListener('click', function(e){
    var el = e && e.target;
    if (!el || !el.value) return;
    apSetModel(el.value);
  });
  apBoot().then(function(){
    try { apRender(); } catch(e){}
  });
}
