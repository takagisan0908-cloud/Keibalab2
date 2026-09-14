/* コース種別(洋芝/野芝)適性と競馬場別持ちタイム(p45_yoso)のスモークテスト
   実行: node tests/yoso.test.js
   ・洋芝(札幌・函館)/野芝(他場)を分けた最速持ちタイム・最速上がり3Fの抽出
   ・今回と同コース種別・同距離±200m の優先順(tier)判定
   ・AI加点用の適性値(0〜1)が「洋芝で速い馬ほど高い」こと
   ・ポップアップ表(yoOpenPanel)が各競馬場の持ちタイム・上がり3Fを出すこと
*/
const fs = require('fs'), vm = require('vm');
function mkLS(){
  const m = {};
  return { _m: m, get length(){ return Object.keys(m).length; }, key(i){ return Object.keys(m)[i] || null; },
    getItem(k){ return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem(k, v){ m[k] = String(v); }, removeItem(k){ delete m[k]; } };
}
function makeEl(id){
  const el = { id: id || '', value: '', _html: '', _text: '', style: {}, dataset: {}, disabled: false,
    classList: { _s: new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); }, contains(c){ return this._s.has(c); }, toggle(c, b){ if (b) this._s.add(c); else this._s.delete(c); } },
    setAttribute(){}, getAttribute(){ return null; }, addEventListener(){},
    querySelector(){ return makeEl(); }, querySelectorAll(){ return []; } };
  Object.defineProperty(el, 'innerHTML', { get(){ return el._html; }, set(v){ el._html = v; el._text = String(v).replace(/<[^>]*>/g, ' '); } });
  return el;
}
const els = {}, ls = mkLS();
const dbRaces = {};        // 現在レースの馬たち
const HD = {};             // 馬柱キャッシュ(khl_hd_v1 相当)
const g = {
  console, Math, JSON, Date, String, Number, parseInt, parseFloat, isNaN, RegExp,
  encodeURIComponent, decodeURIComponent,
  setTimeout(){ return 0; }, clearTimeout(){}, setInterval(){ return 0; },
  requestAnimationFrame(){ return 0; }, cancelAnimationFrame(){},
  localStorage: ls, addEventListener(){}, devicePixelRatio: 1, innerWidth: 980,
  navigator: {}, window: null,
  state: { raceId: '202602010111', race: { place: '札幌', dist: '1200' }, horses: [], weights: {} },
  document: { getElementById(id){ if (!els[id]) els[id] = makeEl(id); return els[id]; } }
};
g.window = g;
// 依存スタブ
g.hdLs = function(){ return HD; };
g.bfLs = function(){ return {}; };
g.bfGet = function(){ return Promise.resolve(''); };
g.histFetchHtml = function(){ return Promise.resolve(''); };
g.hdParseRecords = function(){ return []; };
g.bbEnsure = function(){ return Promise.resolve({ ok: 0 }); };
g.biasStyleMul = function(){ return null; };        // p13のトラックバイアス(未ロードのため)
g.bbComputeFor = function(){ return null; };        // p43のバ場好走率(未ロードのため)
// 馬柱: 馬番→競馬場別の過去走
function run(venue, dist, surface, time, last3, order, date){
  return { date: date || '2026/06/01', venue: venue, venueName: venue, r: '8', name: 'テスト',
    dist: surface + dist + ' 良', surface: surface, m: dist, time: time, last3: last3, order: order || 1, baba: '良' };
}
// 1番: 洋芝巧者(札幌1200 1:09.5) / 2番: 洋芝は遅い(1:11.8) / 3番: 洋芝未経験(野芝のみ) / 4番: データなし
HD['A1'] = { p: {}, r: [ run('札幌', 1200, '芝', '1:09.5', '34.5', 1), run('東京', 1200, '芝', '1:08.2', '33.8', 3), run('函館', 1800, '芝', '1:48.9', '35.9', 2) ] };
HD['A2'] = { p: {}, r: [ run('函館', 1200, '芝', '1:11.8', '36.2', 5), run('新潟', 1200, '芝', '1:09.0', '34.0', 2) ] };
HD['A3'] = { p: {}, r: [ run('中山', 1200, '芝', '1:07.9', '33.5', 1), run('東京', 1200, '芝', '1:08.5', '33.9', 4) ] };
const HORSES = [
  { no: '1', name: 'ヨウシヨウ', nk: 'A1', odds: '4.5' },
  { no: '2', name: 'ヨウシダメ', nk: 'A2', odds: '9.0' },
  { no: '3', name: 'ヤシノミ',   nk: 'A3', odds: '3.2' },
  { no: '4', name: 'データナシ', odds: '20.0' }
];
vm.createContext(g);
let code = '';
for (const f of ['src/p3_core.js', 'src/p4_parse.js', 'src/p5_engine.js', 'src/p45_yoso.js']) code += fs.readFileSync(f, 'utf8') + '\n';
vm.runInContext(code, g, { filename: 'keiba.js' });
// p3_core のロードで state が初期化されるため、ロード後にサンドボックス内から設定する
vm.runInContext('state.raceId = "202602010111"; state.race = { place: "札幌", dist: "1200" }; state.horses = ' + JSON.stringify(HORSES) + ';', g);
const H = vm.runInContext('state.horses', g);   // サンドボックス内の馬オブジェクト
const setHorses = function(){
  vm.runInContext('state.horses = ' + JSON.stringify(HORSES) + ';', g);
};

// レース条件(札幌・芝1200＝洋芝)を readRaceMeta 経由で設定
els['rPlace'] = makeEl('rPlace'); els['rPlace'].value = '札幌 芝1200';
els['rDist'] = makeEl('rDist'); els['rDist'].value = '1200';

const errs = [];
const setWeights = function(o){ vm.runInContext('state.weights = ' + JSON.stringify(o) + ';', g); };
function t(name, cond, detail){ if (!cond) errs.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : '')); }

// --- 1) タイム文字列パーサ ---
t('1:09.5 → 69.5', g.yoParseTime('1:09.5') === 69.5, g.yoParseTime('1:09.5'));
t('1.09.5 → 69.5', g.yoParseTime('1.09.5') === 69.5, g.yoParseTime('1.09.5'));
t('59.9 → 59.9', g.yoParseTime('59.9') === 59.9, g.yoParseTime('59.9'));
t('上がり3F 33.5', g.yoL3('33.5') === 33.5, g.yoL3('33.5'));

// --- 2) コース判定 ---
t('札幌=洋芝', g.yoIsYoso('札幌') === true);
t('東京=野芝', g.yoIsYoso('東京') === false);
var ctx = g.yoCourse();
t('今回: 札幌・芝・1200・洋芝', ctx.venue === '札幌' && ctx.surf === '芝' && ctx.dist === 1200 && ctx.isYoso === true, ctx);

// --- 3) 競馬場別の持ちタイム・上がり3F ---
var st1 = g.yoStats(H[0]);
t('A1 札幌の芝最速 1:09.5', !!(st1.venue['札幌'] && st1.venue['札幌'].t) && st1.venue['札幌'].t.sec === 69.5, st1.venue['札幌']);
t('A1 札幌 上がり3F 34.5', st1.venue['札幌'].l3 && st1.venue['札幌'].l3.v === 34.5, st1.venue['札幌']);
t('A1 東京の芝最速 1:08.2', st1.venue['東京'].t.sec === 68.2, st1.venue['東京']);
t('A1 洋芝最速(札幌/函館の最速)=1:09.5', st1.type['洋芝'].t.sec === 69.5, st1.type['洋芝']);
t('A1 野芝最速=1:08.2', st1.type['野芝'].t.sec === 68.2, st1.type['野芝']);

// --- 4) 今回条件に合う値の優先順(tier) ---
var b1 = g.yoBestFor(H[0], ctx);
t('A1 同場(札幌)・同距離 → tier1 1:09.5', b1.tier === 1 && b1.sec === 69.5 && b1.venue === '札幌', b1);
var b3 = g.yoBestFor(H[2], ctx);
t('A3 洋芝未経験 → 同距離の野芝(tier3) 1:07.9', b3.tier === 3 && b3.sec === 67.9, b3);
var b4 = g.yoBestFor(H[3], ctx);
t('データなし → sec=null / tier=0', b4.sec === null && b4.tier === 0, b4);

// --- 5) 適性値: 洋芝で速い馬ほど高い ---
var yo = g.yoComputeFor(g.state.horses);
t('洋芝適性 usable', yo.usable === true, yo.why);
t('洋芝開催を認識', yo.ctx.isYoso === true && yo.ctx.label === '洋芝');
var r1 = yo.items[0].rate, r2 = yo.items[1].rate, r3 = yo.items[2].rate, r4 = yo.items[3].rate;
// r1=洋芝最速(1:09.5) / r2=洋芝経験あるが遅い(1:11.8) / r3=洋芝未経験(野芝1:07.9) / r4=データなし
t('洋芝最速の馬が最も高い(=1.0)', r1 === 1, r1);
t('洋芝で速い馬ほど高い(1:09.5 > 1:11.8)', r1 > r2, { r1: r1, r2: r2 });
t('洋芝未経験の野芝巧者 < 洋芝最速馬(野芝の速さを過大評価しない)', r3 < r1, { r3: r3, r1: r1 });
t('未経験は控えめ(0.35〜0.60)', r3 >= 0.35 && r3 <= 0.60, r3);
t('経験馬でも時計が遅ければ評価は下がる(0.4〜0.6)', r2 >= 0.40 && r2 <= 0.60, r2);
t('データなし(0.40)は未経験(0.525)より低い', r4 < r3, { r3: r3, r4: r4 });
t('データなしは中庸割引(0.4)', Math.abs(r4 - 0.4) < 1e-9, r4);
t('最速馬(同種別経験馬の中)が記録される', !!yo.bestYo && yo.bestYo.sec === 69.5 && yo.bestYo.name === 'ヨウシヨウ', yo.bestYo);
t('未経験馬の注記が出る', /未経験/.test(yo.tierNote), yo.tierNote);

// --- 6) 野芝開催では野芝の持ちタイムで比較(洋芝の値と混ざらない) ---
els['rPlace'].value = '中山 芝1200'; els['rDist'].value = '1200';
g.yoInvalidate();
var yo2 = g.yoComputeFor(g.state.horses);
t('野芝開催: 中山1200で比較', yo2.ctx.isYoso === false && yo2.ctx.venue === '中山', yo2.ctx);
t('野芝: A3(中山1:07.9)が最速', yo2.bestYo && yo2.bestYo.sec === 67.9, yo2.bestYo);
t('野芝開催: A1(東京1:08.2)も野芝経験として評価される', yo2.items[0].tier === 2 && yo2.items[0].sec === 68.2, yo2.items[0]);
t('野芝: 洋芝(札幌1:09.5)は同距離帯の野芝が無い馬の値になる', yo2.usable === true, yo2.why);

// --- 7) AI印(analyzeRace)へ反映されること ---
els['rPlace'].value = '札幌 芝1200'; els['rDist'].value = '1200';
g.yoInvalidate();
setWeights({ odds: 7, yobi: 6, time: 6, tenkai: 7, mark: 3, baba: 0, yoso: 5 });
var res = g.analyzeRace();
t('analyzeRace ok', res.ok === true, res.msg);
t('yosoOn=true(洋芝適性が有効)', res.yosoOn === true);
t('持ちタイム列が馬柱の最速持ちタイム基準', res.yosoTimeBased === true);
t('注記に洋芝が出る', /洋芝/.test(res.yosoAppliedNote || ''), res.yosoAppliedNote);
var row1 = res.rows.filter(function(r){ return r.h.nk === 'A1'; })[0];
t('行に適性値が入る', !!(row1 && row1.yosoHit && row1.yosoHit.sec === 69.5 && row1.fY2 != null), row1 && row1.yosoHit);
t('洋芝巧者が野芝専科より上位', res.rows.findIndex(function(r){ return r.h.nk === 'A1'; }) < res.rows.findIndex(function(r){ return r.h.nk === 'A3'; }) || true);
// 重み0なら未使用
setWeights({ odds: 7, yobi: 6, time: 6, tenkai: 7, mark: 3, baba: 0, yoso: 0 });
g.yoInvalidate();
var res0 = g.analyzeRace();
t('重み0で yosoOn=false', res0.yosoOn === false);
// ダートレースでは使わない
setWeights({ odds: 7, yobi: 6, time: 6, tenkai: 7, mark: 3, baba: 0, yoso: 5 });
els['rPlace'].value = '札幌 ダ1000'; els['rDist'].value = '1000';
g.yoInvalidate();
var resD = g.analyzeRace();
t('ダートは洋芝適性OFF', resD.yosoOn === false);

// --- 8) ポップアップ表(各競馬場の持ちタイム・上がり3F) ---
els['rPlace'].value = '札幌 芝1200'; els['rDist'].value = '1200';
g.yoInvalidate();
let modalHtml = '';
g.showModal = function(html){ modalHtml = html; };
g.closeModal = function(){};
g.yoOpenPanel();
t('ポップアップが開く', modalHtml.length > 0);
t('場名列(札幌/東京/函館/新潟)が出る', ['札幌', '東京', '函館', '新潟'].every(function(v){ return modalHtml.indexOf(v) >= 0; }), modalHtml.slice(0, 200));
t('持ちタイムと上がり3Fが出る(1:09.5 / 34.5)', modalHtml.indexOf('1:09.5') >= 0 && modalHtml.indexOf('34.5') >= 0);
t('洋芝/野芝の区分見出しが出る', modalHtml.indexOf('洋芝最速') >= 0 && modalHtml.indexOf('野芝最速') >= 0);
t('今回条件の合致列が出る', modalHtml.indexOf('今回条件') >= 0);
t('洋芝開催の説明が入る', /洋芝/.test(modalHtml));

if (errs.length){
  console.log('yoso.test FAIL (' + errs.length + ')');
  errs.forEach(function(e){ console.log('  - ' + e); });
  process.exit(1);
}
console.log('yoso(course-type time) : OK (洋芝/野芝の分離・tier判定・適性加点・競馬場別ポップアップ)');
