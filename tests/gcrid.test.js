/* ⑥カレンダー → レースID解決（gcResolveRid）のテスト
   ・レース一覧が略称（京成杯AH）でもカレンダー名（京成杯オータムハンデ）から解決できる
   ・一覧に無い／一覧取得に失敗したときは netkeiba DB のレース名検索にフォールバックする
   ・開催場が分かれば場違いの同名レースを拾わない
   実行: node tests/gcrid.test.js */
const fs = require('fs'), vm = require('vm');
let ok = 0, bad = 0;
function t(name, cond, extra){ if (cond){ ok++; } else { bad++; console.log('  FAIL', name, extra === undefined ? '' : extra); } }
const g = {
  console, Math, JSON, Date, String, Number, Array, Object, Error, Promise, Boolean, Set, Map,
  parseInt, parseFloat, isNaN, isFinite, RegExp, encodeURIComponent, decodeURIComponent,
  setTimeout, clearTimeout, setInterval(){ return 0; },
  localStorage:{ _d:{}, getItem(k){ return this._d[k]==null?null:this._d[k]; }, setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; } },
  document:{ getElementById(){ return null; }, querySelector(){ return null; }, querySelectorAll(){ return []; }, addEventListener(){} },
  addEventListener(){}, navigator:{ userAgent:'test' },
  fetch(){ return Promise.reject(new Error('no network in test')); }
};
g.window = g; g.globalThis = g; g.self = g;
vm.createContext(g);
vm.runInContext(['p3_core','p18_racesearch','p31_bloodfactor','p36_datarace','p39_gradecal']
  .map(f => fs.readFileSync('src/' + f + '.js','utf8')).join('\n'), g, { filename:'gcrid.js' });

/* 通信する関数を差し替える（呼び出し方と解決結果だけを検証する） */
const log = { day: [], db: [] };
let DAY_ROWS = [], DAY_FAIL = false, DB_ROWS = [];
g.gcDay = function(d8){ log.day.push(String(d8)); return DAY_FAIL ? Promise.reject(new Error('中継が空応答')) : Promise.resolve(DAY_ROWS); };
g.gcDbSearch = function(w){ log.db.push(String(w)); return Promise.resolve(DB_ROWS); };

const resolve = (d8, name, venue) => vm.runInContext('gcResolveRid(' + JSON.stringify(d8) + ',' + JSON.stringify(name) +
  ',function(){},' + JSON.stringify(venue || '') + ')', g);
const reset = () => { log.day = []; log.db = []; DAY_ROWS = []; DAY_FAIL = false; DB_ROWS = [];
  vm.runInContext('var l = gcLs(); l.ridmap = {}; l.day = {}; l.q = {}; gcSave(l);', g); };

(async function(){
  /* --- 1) レース一覧が略称表記でも解決できる（京成杯AH ⇄ 京成杯オータムハンデ） --- */
  reset();
  DAY_ROWS = [
    { rid:'202606040109', name:'3歳以上1勝クラス', venue:'中山', grade:'' },
    { rid:'202606040111', name:'京成杯AH', venue:'中山', grade:'G3' },
    { rid:'202606040112', name:'白井特別', venue:'中山', grade:'' }
  ];
  let rid = await resolve('20260905', '京成杯オータムハンデ', '中山');
  t('一覧の略称(京成杯AH)からカレンダー名で解決', rid === '202606040111', rid);
  t('DB検索にはフォールバックしていない', log.db.length === 0, JSON.stringify(log.db));

  /* --- 2) 略称の reverse（一覧=正式名 / 問い合わせ=略称）でも解決できる --- */
  reset();
  DAY_ROWS = [{ rid:'202606040111', name:'京成杯オータムハンデ', venue:'中山', grade:'G3' }];
  rid = await resolve('20260905', '京成杯AH', '中山');
  t('略称で問い合わせ→正式名の一覧から解決', rid === '202606040111', rid);

  /* --- 3) 一覧に同名が無い → netkeiba DB のレース名検索にフォールバック --- */
  reset();
  DAY_ROWS = [{ rid:'202606040101', name:'3歳未勝利', venue:'中山', grade:'' }];
  DB_ROWS = [
    { rid:'202606040111', date8:'20260905', txt:'2026-09-05 4中山1 晴 11 京成杯オータムH(GIII) 芝1600 16' },
    { rid:'202506040111', date8:'20250906', txt:'2025-09-06 4中山1 晴 11 京成杯オータムH(GIII) 芝1600 16' }
  ];
  rid = await resolve('20260905', '京成杯オータムハンデ', '中山');
  t('DB検索にフォールバックした', log.db.length > 0, JSON.stringify(log.db));
  t('DB検索: 同じ日付の rid を採用', rid === '202606040111', rid);
  t('DB検索のキーワードはレース名（展開した正式名を含む）',
    log.db.indexOf('京成杯オータムハンデ') >= 0, JSON.stringify(log.db));

  /* --- 4) 日別一覧の取得が失敗しても DB検索で解決できる --- */
  reset();
  DAY_FAIL = true;
  DB_ROWS = [{ rid:'201404030211', date8:'20140914', txt:'2014-09-14 3新潟2 晴 11 京成杯オータムH(GIII) 芝1600 15' }];
  rid = await resolve('20140914', '京成杯オータムハンデ', '新潟');
  t('一覧取得が失敗してもDB検索で解決（古い日付）', rid === '201404030211', rid);

  /* --- 5) 場が指定されていれば、同日の別場の同名レースを拾わない --- */
  reset();
  DAY_ROWS = [];
  DB_ROWS = [
    { rid:'202609990111', date8:'20260905', txt:'2026-09-05 2阪神5 晴 11 京成杯オータムH(GIII) 芝1600 16' },
    { rid:'202606040111', date8:'20260905', txt:'2026-09-05 4中山1 晴 11 京成杯オータムH(GIII) 芝1600 16' }
  ];
  rid = await resolve('20260905', '京成杯オータムハンデ', '中山');
  t('DB検索: 開催場が一致する行を優先', rid === '202606040111', rid);

  /* --- 6) 一覧側の同名・別場も拾わない --- */
  reset();
  DAY_ROWS = [
    { rid:'202609990111', name:'京成杯AH', venue:'阪神', grade:'G3' },
    { rid:'202606040111', name:'京成杯AH', venue:'中山', grade:'G3' }
  ];
  rid = await resolve('20260905', '京成杯オータムハンデ', '中山');
  t('一覧: 場が一致する行を採用', rid === '202606040111', rid);

  /* --- 7) どちらも見つからなければ ''（例外にしない） --- */
  reset();
  DAY_ROWS = [{ rid:'202606040101', name:'3歳未勝利', venue:'中山', grade:'' }];
  DB_ROWS = [{ rid:'202506040111', date8:'20250906', txt:'2025-09-06 4中山1 京成杯オータムH(GIII)' }];
  rid = await resolve('20260905', '京成杯オータムハンデ', '中山');
  t('見つからなければ空文字', rid === '', JSON.stringify(rid));

  /* --- 8) 解決結果はキャッシュされ、2回目は通信しない --- */
  reset();
  DAY_ROWS = [{ rid:'202606040111', name:'京成杯AH', venue:'中山', grade:'G3' }];
  await resolve('20260905', '京成杯オータムハンデ', '中山');
  const n1 = log.day.length;
  rid = await resolve('20260905', '京成杯オータムハンデ', '中山');
  t('2回目はキャッシュから即解決', rid === '202606040111' && log.day.length === n1, 'day calls=' + log.day.length);

  /* --- 9) 略称のまま問い合わせたときもDB検索語に展開形が入る --- */
  reset();
  DAY_ROWS = [];
  DB_ROWS = [{ rid:'202606040111', date8:'20260905', txt:'2026-09-05 4中山1 京成杯オータムH(GIII)' }];
  rid = await resolve('20260905', '京成杯AH', '中山');
  t('略称のままでもDB検索で解決', rid === '202606040111', rid);
  t('DB検索語に展開形(京成杯オータムハンデ)が含まれる', log.db.indexOf('京成杯オータムハンデ') >= 0, JSON.stringify(log.db));

  console.log('gcrid    : ' + (bad ? 'NG ' : 'OK ') + ok + ' PASS' + (bad ? ' / ' + bad + ' FAIL' : '') +
    '（一覧の略称照合・netkeiba DB レース名検索へのフォールバック・開催場の一致）');
  process.exit(bad ? 1 : 0);
})();
