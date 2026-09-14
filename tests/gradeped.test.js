/* ⑨重賞データ分析(p36)の「対象レース検証」と「血統まとめ」のスモークテスト
   実行: node tests/gradeped.test.js
   ・同名判定が厳格になっていること（別レースを混ぜない）
     例: ジャパンカップ ⇄ ジャパンカップダート は別物
         報知杯弥生賞 ⇄ 弥生賞 / 産経大阪杯 ⇄ 大阪杯 は同一
   ・血統(父・母父・系統)が1枚の「血統まとめ」に集約され、
     個別の父/母父表は画面に出ない(hidden)こと
   ・参照した過去レース一覧(検証表示)が出ること
*/
const fs = require('fs'), vm = require('vm');
function makeEl(id){
  const el = { id: id || '', value: '', _html: '', _text: '', style: {}, dataset: {},
    classList: { add(){}, remove(){}, contains(){ return false; }, toggle(){} },
    setAttribute(){}, getAttribute(){ return null; }, addEventListener(){},
    querySelector(){ return makeEl(); }, querySelectorAll(){ return []; } };
  Object.defineProperty(el, 'innerHTML', { get(){ return el._html; }, set(v){ el._html = v; el._text = String(v).replace(/<[^>]*>/g, ' '); } });
  return el;
}
const els = {};
const g = {
  console, Math, JSON, Date, String, Number, parseInt, parseFloat, isNaN, RegExp,
  encodeURIComponent, decodeURIComponent, setTimeout(){ return 0; }, clearTimeout(){}, setInterval(){ return 0; },
  localStorage: { getItem(){ return null; }, setItem(){}, removeItem(){}, key(){ return null; }, get length(){ return 0; } },
  addEventListener(){}, navigator: {}, window: null, state: { race: {}, raceId: '' },
  document: { getElementById(id){ if (!els[id]) els[id] = makeEl(id); return els[id]; } }
};
g.window = g;
g.bfGet = function(){ return Promise.resolve(''); };
g.histFetchHtml = function(){ return Promise.resolve(''); };
vm.createContext(g);
let code = '';
for (const f of ['src/p3_core.js', 'src/p31_bloodfactor.js', 'src/p36_datarace.js']) code += fs.readFileSync(f, 'utf8') + '\n';
vm.runInContext(code, g, { filename: 'keiba.js' });

const errs = [];
function t(name, cond, detail){ if (!cond) errs.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : '')); }

// --- 1) 同名判定(厳格化) ---
const eq = g.drRaceEq;
t('同一名は真', eq('ジャパンカップ', 'ジャパンカップ') === true);
t('冠名違い(報知杯弥生賞/弥生賞)は同一', eq('報知杯弥生賞', '弥生賞') === true, [g.drRaceCore('報知杯弥生賞'), g.drRaceCore('弥生賞')]);
t('スポンサー違い(産経大阪杯/大阪杯)は同一', eq('産経大阪杯', '大阪杯') === true);
t('ジャパンカップ ≠ ジャパンカップダート(別レース)', eq('ジャパンカップ', 'ジャパンカップダート') === false);
t('ダービー系も別物(日本ダービー/東京ダービー)', eq('日本ダービー', '東京ダービー') === false);
t('毎日王冠 ≠ 毎日杯', eq('毎日王冠', '毎日杯') === false);
t('全く違う名前は偽', eq('皐月賞', '東京優駿') === false);
t('括弧・回次・G表記は除去して比較', eq('第90回 東京優駿（G1）', '東京優駿 (G1)') === true);
t('阪神牝馬S⇄阪神牝馬特別(改称)は同一', eq('阪神牝馬ステークス', '阪神牝馬特別') === true);

// --- 2) 血統まとめ(1枚に集約) ---
const samples = [];
(function(){
  const sires = ['ディープインパクト', 'キングカメハメハ', 'ロードカナロア', 'モーリス'];
  const msires = ['サンデーサイレンス', 'キングマンボ', 'クロフネ', 'ノーザンダンサー'];
  let seed = 99;
  function rnd(){ seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  for (let i = 0; i < 60; i++){
    const o = 1 + Math.floor(rnd() * 12);
    samples.push({ yr: 2018 + (i % 8), rid: 'r' + (i % 8), o: o > 3 ? o : o, no: String(1 + (i % 18)), name: 'ウマ' + i,
      id: 'h' + i, pop: 1 + (i % 12), odds: 2 + (i % 20), jockey: '騎手' + (i % 5), raceN: 18, dateStr: '2020/01/01',
      sire: sires[i % sires.length], msire: msires[i % msires.length], prev: null, horse: null,
      career: 5, profM: 3, prod: '生産者' + (i % 4), region: '関西馬(栗東)', aff: '栗東', w: 460, wd: 2, pDelta: 2, pRank: 0 });
  }
})();
const tables = vm.runInContext('drComputeTables(' + JSON.stringify(samples) + ')', g);
const base = tables.base;
const ped = g.drPedBlock(samples, base);
t('血統まとめが出る', typeof ped === 'string' && ped.indexOf('血統まとめ') >= 0);
t('父の系統別/父/母父の3セクション', ped.indexOf('父の系統別') >= 0 && ped.indexOf('父（種牡馬）別') >= 0 && ped.indexOf('母父（BMS）別') >= 0);
t('母父名が出る(サンデーサイレンス等)', ped.indexOf('サンデーサイレンス') >= 0);
const sireTbl = tables.filter(function(x){ return x.title.indexOf('父（種牡馬）別') >= 0; })[0];
const msireTbl = tables.filter(function(x){ return x.title.indexOf('母父（BMS）別') >= 0; })[0];
t('個別の父/母父表は hidden(画面に出さない)', !!(sireTbl && sireTbl.opts && sireTbl.opts.hidden) && !!(msireTbl && msireTbl.opts && msireTbl.opts.hidden));
t('hidden 表は描画されない', g.drRenderTableOne({ kind: sireTbl.kind, title: sireTbl.title, rows: sireTbl.rows, opts: sireTbl.opts }, base) === '');
t('血統まとめは従来の2表より短い(上位のみ)', (ped.match(/<tr/g) || []).length < 40, (ped.match(/<tr/g) || []).length);

// --- 3) 対象レース一覧(検証表示) ---
const res = { samples: samples, racesUsed: [
  { year: 2024, rid: 'r0', date: '2024/10/27', name: 'ジャパンカップ', place: '東京', rnum: '11', dist: '芝2400' },
  { year: 2023, rid: 'r1', date: '2023/11/26', name: 'ジャパンカップ', place: '東京', rnum: '11', dist: '芝2400' }
], excluded: [ { year: 2019, rid: 'rX', name: 'ジャパンカップダート', reason: 'レース名が不一致' } ] };
const blk = g.drRacesUsedBlock(res);
t('参照レース一覧が出る', blk.indexOf('この分析が参照した過去レース') >= 0 && blk.indexOf('2024/10/27') >= 0);
t('除外理由が表示される', blk.indexOf('ジャパンカップダート') >= 0 && blk.indexOf('レース名が不一致') >= 0);
t('集計頭数が出る', blk.indexOf('集計頭数') >= 0);
t('参照0件なら何も出さない', g.drRacesUsedBlock({ samples: [] }) === '');

if (errs.length){
  console.log('gradeped.test FAIL (' + errs.length + ')');
  errs.forEach(function(e){ console.log('  - ' + e); });
  process.exit(1);
}
console.log('grade-analysis : OK (名称照合の厳格化・参照レース検証表示・血統まとめの集約)');
