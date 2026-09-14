/* ⑥重賞データ分析: レース名検出(drSeekDb)の「通信失敗」と「0件」の区別＋リトライのテスト
   ・中継が 429/502/空 を返したときに「見つかりませんでした」と誤表示させない
   ・一時的な失敗はリトライで回復する
   実行: node tests/drseek.test.js */
const fs = require('fs'), vm = require('vm');
let ok = 0, bad = 0;
function t(name, cond, extra){ if (cond){ ok++; } else { bad++; console.log('  FAIL', name, extra === undefined ? '' : extra); } }

const g = {
  console, Math, JSON, Date, String, Number, Array, Object, Error, Promise, Boolean,
  parseInt, parseFloat, isNaN, isFinite, RegExp, encodeURIComponent, decodeURIComponent,
  setTimeout, clearTimeout, setInterval(){ return 0; }, clearInterval(){},
  localStorage:{ _d:{}, getItem(k){ return this._d[k]==null?null:this._d[k]; }, setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; } },
  document:{ getElementById(){ return null; }, querySelector(){ return null; }, querySelectorAll(){ return []; }, addEventListener(){} },
  addEventListener(){}, navigator:{ userAgent:'test' }
};
g.window = g; g.globalThis = g; g.self = g;
vm.createContext(g);
vm.runInContext(['p3_core','p31_bloodfactor','p36_datarace'].map(f => fs.readFileSync('src/' + f + '.js','utf8')).join('\n'), g, { filename:'dr.js' });
vm.runInContext('DR_RETRY_MS = 5;', g);              // テストではリトライ待ちを短縮
g.bfVenueByCode = function(){ return ''; };          // drSeekSeries がカレンダー走査へ落ちない形にする
g.bfCal = undefined; g.bfDateRaces = undefined;

/* DB検索結果ページのひな型 */
function listPage(rows){
  const pad = 'x'.repeat(600);
  const tr = rows.map(function(r){
    const d = r.date8.replace(/(\d{4})(\d{2})(\d{2})/, '$1/$2/$3');
    return '<tr><td>' + d + '</td><td>' + r.kai + r.venue + r.nichi + '日</td>' +
      '<td><a href="https://db.netkeiba.com/race/' + r.rid + '/">' + r.name + '</a></td>' +
      '<td>芝' + r.dist + 'm</td></tr>';
  }).join('');
  return '<html><head><title>レース検索結果</title></head><body>' + pad + '<table>' + tr + '</table></body></html>';
}
const ARI = [
  { date8:'20241222', kai:'5', venue:'中山', nichi:'8', rid:'202406050811', name:'有馬記念', dist:2500 },
  { date8:'20231224', kai:'5', venue:'中山', nichi:'8', rid:'202306050811', name:'有馬記念', dist:2500 }
];
const INF = { name:'有馬記念(GI)', venue:'中山', year:2026, month:12, surf:'芝', dist:2500 };

let calls = 0, lastErr = '';
function stub(responder){ calls = 0; g.bfGet = function(url){ calls++; return Promise.resolve().then(function(){ return responder(url, calls); }); }; }

(async function(){
  /* --- 1) エラーページ判定 --- */
  const badPage = (h) => vm.runInContext('drBadPage(' + JSON.stringify(h) + ')', g);
  t('drBadPage: 空応答はエラー', !!badPage(''));
  t('drBadPage: 200Bの断片はエラー', !!badPage('x'.repeat(200)));
  t('drBadPage: upstream HTTP 429 はエラー', !!badPage('relay 502 upstream HTTP 429 ' + 'y'.repeat(500)));
  t('drBadPage: 403 Forbidden はエラー', !!badPage('403 Forbidden ' + 'y'.repeat(500)));
  t('drBadPage: 正常な一覧ページはエラーでない', badPage(listPage(ARI)) === '', badPage(listPage(ARI)));

  /* --- 2) 一時的な失敗 → リトライで回復 --- */
  stub(function(url, n){ return n === 1 ? '' : listPage(ARI); });
  const logs = [];
  const r2 = await g.drSeekDb(INF, function(m){ logs.push(m); });
  t('リトライ: 初回が空でも2回目で取得できる', r2.length === 2, JSON.stringify(r2));
  t('リトライ: 進捗に「再試行」と出る', logs.some(function(m){ return /再試行/.test(m); }), logs.join(' | '));
  t('リトライ: 2024年と2023年が取れる', r2.map(function(r){ return r.year; }).join(',') === '2024,2023', r2.map(function(r){ return r.year; }).join(','));

  /* --- 3) 本当に0件（ページは正常） → 「見つからない」で正しい --- */
  stub(function(){ return listPage([{ date8:'20241124', kai:'5', venue:'東京', nichi:'8', rid:'202409051111', name:'ジャパンカップ', dist:2400 }]); });
  const r3 = await g.drSeekDb(INF, function(){});
  t('0件: 正常ページで該当なしなら空配列（エラーにしない）', Array.isArray(r3) && r3.length === 0, JSON.stringify(r3));

  /* --- 4) 全滅（中継がずっとエラー） → 「通信エラー」として投げる --- */
  stub(function(){ return 'relay 502 upstream HTTP 429 ' + 'y'.repeat(500); });
  let e4 = null;
  try { await g.drSeekDb(INF, function(){}); } catch(e){ e4 = e; }
  t('全滅: drSeekDb は reject する（0件に化けない）', !!e4, e4 ? '' : 'resolved');
  t('全滅: メッセージに「通信エラー」と明記', !!e4 && /通信エラー/.test(e4.message), e4 && e4.message);
  t('全滅: もう一度押すよう促す文言がある', !!e4 && /もう一度/.test(e4.message), e4 && e4.message);
  t('全滅: 中継の診断へ誘導する', !!e4 && /中継を診断/.test(e4.message), e4 && e4.message);
  t('全滅: 3回リトライした（語ごとに）', calls >= 3, 'calls=' + calls);

  /* drSeekSeries も同じエラーを上位へ投げる（50秒のカレンダー走査に逃げない） */
  let e5 = null;
  try { await g.drSeekSeries(INF, function(){}); } catch(e){ e5 = e; }
  t('全滅: drSeekSeries も通信エラーを伝播させる', !!e5 && /通信エラー/.test(e5.message), e5 ? e5.message : 'resolved');

  /* --- 6) 過去レースページの取得(drFetchRace)もリトライする --- */
  const raceHtml = fs.readFileSync('tests/fixtures/dbrace.utf8.html', 'utf8');
  stub(function(url, n){ return n === 1 ? '' : raceHtml; });
  const r6 = await g.drFetchRace('202505040511', function(){});
  t('drFetchRace: 初回失敗でもリトライで取得できる', !!(r6 && r6.rows && r6.rows.length), r6 ? 'rows=' + (r6.rows || []).length : 'null');

  /* --- 7) drFetchRace も全滅時はエラー（キャッシュに残さない） --- */
  stub(function(){ return 'relay 502 upstream HTTP 503 ' + 'y'.repeat(500); });
  let e7 = null;
  try { await g.drFetchRace('2099010101', function(){}); } catch(e){ e7 = e; }
  t('drFetchRace: 全滅時は reject する', !!e7, e7 ? '' : 'resolved');

  console.log(bad ? ('drseek: NG ' + bad + ' FAIL / ' + ok + ' PASS') : ('drseek : OK ' + ok + ' PASS（通信エラーと0件の区別／リトライ）'));
  process.exit(bad ? 1 : 0);
})().catch(function(e){ console.log('drseek: ERR', e && e.stack || e); process.exit(1); });
