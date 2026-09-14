/* トラックバイアス: 「1日のレース数(最大12)を超える表示」が出ないことのテスト
   ・別日の記録が残っていても、集計・表示は当日ぶんだけ
   ・別日の記録は「判定に不使用」と明記され、ワンクリックで消せる
   実行: node tests/biasday.test.js */
const fs = require('fs'), vm = require('vm');
let ok = 0, bad = 0;
function t(name, cond, extra){ if (cond){ ok++; } else { bad++; console.log('  FAIL', name, extra === undefined ? '' : extra); } }
function makeEl(id){
  const el = { id:id||'', value:'', _html:'', _text:'', style:{}, checked:false, open:false,
    classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, toggle(c,f){ if(f===undefined){this._s.has(c)?this._s.delete(c):this._s.add(c);} else if(f){this._s.add(c);} else {this._s.delete(c);} }, contains(c){ return this._s.has(c); } },
    setAttribute(){}, getAttribute(){ return null; }, addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; }, dataset:{}, closest(){ return null; } };
  Object.defineProperty(el,'innerHTML',{get(){return el._html;},set(v){el._html=String(v);el._text=String(v).replace(/<[^>]*>/g,' ');}});
  Object.defineProperty(el,'textContent',{get(){return el._text;},set(v){el._text=String(v);el._html='';}});
  return el;
}
const els = {};
const g = {
  console, Math, JSON, Date, String, Number, Array, Object, Error, Promise, Boolean, Set, Map,
  parseInt, parseFloat, isNaN, isFinite, RegExp, encodeURIComponent, decodeURIComponent,
  setTimeout, clearTimeout, setInterval(){ return 0; },
  localStorage:{ _d:{}, getItem(k){ return this._d[k]==null?null:this._d[k]; }, setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; } },
  document:{ getElementById(id){ if(!els[id]) els[id]=makeEl(id); return els[id]; }, querySelector(){ return null; }, querySelectorAll(){ return []; }, createElement(){ return makeEl(); }, addEventListener(){}, body:makeEl('body') },
  addEventListener(){}, navigator:{ userAgent:'test' },
  fetch(){ return Promise.reject(new Error('no network in test')); }
};
g.window = g; g.globalThis = g; g.self = g;
vm.createContext(g);
vm.runInContext(['p3_core','p13_bias'].map(f => fs.readFileSync('src/' + f + '.js','utf8')).join('\n'), g, { filename:'bias.js' });

/* 中山(code=06)で 9/5 と 9/6 の2日ぶん＝各12レースが溜まっている状態を作る */
vm.runInContext(`
  state.raceId = '202606050211';
  state.race = { name:'セントライト記念', date:'2026/09/06', place:'中山' };
  state.biasRaces = [];
  function mk(pre, rno, date){
    return { id: pre + ('0' + rno).slice(-2), rno: rno, venue:'中山', date: date, label: rno + 'R',
      dist: 1600, surface:'芝', baba:'良', winSec: 95.0, winStr:'',
      money:[{rank:1,no:'1',name:'A',sty:'逃げ',odds:2.1,frame:'2'},{rank:2,no:'2',name:'B',sty:'先行',odds:4.0,frame:'5'},{rank:3,no:'3',name:'C',sty:'差し',odds:9.0,frame:'7'}] };
  }
  for (var r = 1; r <= 12; r++) state.biasRaces.push(mk('2026060401', r, '2026/09/05'));   // 前日
  for (var r2 = 1; r2 <= 12; r2++) state.biasRaces.push(mk('2026060501', r2, '2026/09/06'));  // 当日
`, g);

const split = vm.runInContext('biasRowsOfDay()', g);
t('当日12 / 別日12 に振り分けられる', split.day.length === 12 && split.other.length === 12,
  'day=' + split.day.length + ' other=' + split.other.length);
t('対象日は 2026/09/06', split.d8 === '20260906', split.d8);

const groups = vm.runInContext('biasRacesByVenue()', g);
t('中山グループは1つ', groups.length === 1, groups.map(x => x.venue).join(','));
t('中山の表示レース数は12（24にならない）', groups[0].races.length === 12, groups[0].races.length);

const ours = vm.runInContext('biasRacesOurs()', g);
t('判定に使うのは当日の12レースだけ', ours.length === 12 && ours.every(r => r.date === '2026/09/06'), ours.length);

vm.runInContext('renderBiasCard()', g);
const html = els['biasBox'] ? String(els['biasBox']._html || '') : '';
t('カードに「24レース」が出ない', html.indexOf('24レース') < 0);
t('カードに当日の件数が出る', /当日（2026\/09\/06） 1場 \/ 12レース記録済み/.test(html.replace(/\s+/g, ' ')) || html.indexOf('12レース記録済み') > 0,
  html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 200));
t('別日の記録があることを明記', html.indexOf('別日の記録 12 件') > 0);
t('別日の記録を消すボタンが出る', html.indexOf('data-biasact="clearother"') > 0);

const tc = vm.runInContext('biasTimeCheckHTML()', g);
t('時計チェックも当日ぶんだけ（12 レース）', tc.indexOf('本日の記録: <b>12 レース</b>') > 0,
  (tc.match(/本日の記録: <b>\d+ レース<\/b>/) || [''])[0]);
t('時計チェックに別日ぶんを除外と出る', tc.indexOf('別日の記録 12 件は集計から除外') > 0);

/* 日付の無い記録（手入力など）は当日扱い＝無駄にしない */
vm.runInContext(`state.biasRaces.push({ id:'manual-1', rno:13, venue:'中山', date:'', label:'手入力', dist:1600, surface:'芝', baba:'良', winSec:95.0, winStr:'', money:[] });`, g);
t('日付不明の記録は当日側に含む', vm.runInContext('biasRowsOfDay().day.length', g) === 13, vm.runInContext('biasRowsOfDay().day.length', g));
t('日付不明でも race_id の先頭10桁から日を推定できる',
  vm.runInContext("biasRecDay8({ id:'2026060501' + '05', date:'' })", g) === '20260906',
  vm.runInContext("biasRecDay8({ id:'202606050105', date:'' })", g));

/* 1日に12を超えた場合は「別日が混ざっているサイン」として警告する */
vm.runInContext('renderBiasCard()', g);
const html2 = els['biasBox'] ? String(els['biasBox']._html || '') : '';
t('12R超は警告表示になる', html2.indexOf('⚠12R超') > 0);

/* 別日を消すと当日ぶんだけ残る */
vm.runInContext(`
  state.biasRaces = biasRowsOfDay().day.slice();
`, g);
t('別日を消すと当日ぶんだけ残る', vm.runInContext('state.biasRaces.length', g) === 13, vm.runInContext('state.biasRaces.length', g));
t('別日が無くなったら「別日の記録」表示も消える',
  (function(){ vm.runInContext('renderBiasCard()', g); return String(els['biasBox']._html).indexOf('別日の記録') < 0; })());

console.log(bad ? ('biasday: NG ' + bad + ' FAIL / ' + ok + ' PASS') : ('biasday  : OK ' + ok + ' PASS（当日ぶんだけ集計・別日は不使用と明記・12R超の警告）'));
process.exit(bad ? 1 : 0);
