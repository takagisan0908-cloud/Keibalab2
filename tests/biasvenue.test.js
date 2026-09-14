/* トラックバイアス: 当日の全場取込と「開催場ごとの表」の軽量テスト
   実行: node tests/biasvenue.test.js */
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
  setTimeout(){ return 0; }, clearTimeout(){}, setInterval(){ return 0; },
  localStorage:{ _d:{}, getItem(k){ return this._d[k]==null?null:this._d[k]; }, setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; } },
  document:{ getElementById(id){ if(!els[id]) els[id]=makeEl(id); return els[id]; }, querySelector(){ return null; }, querySelectorAll(){ return []; }, createElement(){ return makeEl(); }, addEventListener(){}, body:makeEl('body') },
  addEventListener(){}, navigator:{ userAgent:'test' },
  fetch(){ return Promise.reject(new Error('no network in test')); }
};
g.window = g; g.globalThis = g; g.self = g;
vm.createContext(g);
const code = ['p3_core','p13_bias'].map(f => fs.readFileSync('src/' + f + '.js','utf8')).join('\n');
vm.runInContext(code, g, { filename:'bias.js' });

// ---- 競馬場の判定 ----
t('race_id から競馬場(阪神=09)', vm.runInContext('biasRaceVenue({id:"202609040211"})', g) === '阪神');
t('race_id から競馬場(中山=06)', vm.runInContext('biasRaceVenue({id:"202606040211"})', g) === '中山');
t('保存済み venue を優先', vm.runInContext('biasRaceVenue({id:"202609040211", venue:"札幌"})', g) === '札幌');

// ---- その日の3場を取り込んだ状態を作る ----
vm.runInContext(`
  state.biasRaces = [];
  state.raceId = '202609040211';
  function mk(rid, rno, venue, sec, dist, surf, rname){
    return { id:rid, rno:rno, venue:venue, date:'2026/09/06', label: rno + 'R ' + rname,
      dist:dist, surface:surf, baba:'良', winSec:sec, winStr:'',
      money:[{rank:1,no:'1',name:'A',sty:'逃げ',odds:2.1,frame:'2'},{rank:2,no:'2',name:'B',sty:'先行',odds:4.0,frame:'5'},{rank:3,no:'3',name:'C',sty:'差し',odds:9.0,frame:'7'}] };
  }
  state.biasRaces.push(mk('202609040201', 1, '阪神', 81.3, 1400, '芝', '2歳未勝利'));
  state.biasRaces.push(mk('202609040202', 2, '阪神', 72.6, 1200, 'ダ', '3歳未勝利'));
  state.biasRaces.push(mk('202609040211',11, '阪神', 68.9, 1200, '芝', 'セントウルS'));
  state.biasRaces.push(mk('202606040201', 1, '中山', 95.2, 1600, '芝', '2歳未勝利'));
  state.biasRaces.push(mk('202606040202', 2, '中山', 88.1, 1500, '芝', '3歳未勝利'));
  state.biasRaces.push(mk('202601020601', 1, '札幌', 70.1, 1000, 'ダ', '3歳未勝利'));
`, g);

const groups = vm.runInContext('biasRacesByVenue()', g);
t('開催場ごとに3グループ', groups.length === 3, groups.map(x => x.venue).join(','));
t('対象レースと同じ場が先頭', groups[0].venue === '阪神', groups[0].venue);
t('グループ内はレース番号順', groups[0].races.map(r => r.rno).join(',') === '1,2,11', groups[0].races.map(r => r.rno).join(','));
const ours = vm.runInContext('biasRacesOurs()', g);
t('バイアス判定は対象場(阪神)の3レースだけ', ours.length === 3 && ours.every(r => r.venue === '阪神'), ours.length);
const v = vm.runInContext('biasVerdict()', g);
t('判定が出る（対象場の記録で計算）', !!v && v.races === 3, v && v.races);

const html = vm.runInContext('biasTimeCheckHTML()', g);
t('時計チェックが開催場ごとの表になっている', html.indexOf('🏇 阪神開催') > 0 && html.indexOf('🏇 中山開催') > 0 && html.indexOf('🏇 札幌開催') > 0);
t('表が3つ（thead の数）', (html.match(/対 基準時計/g) || []).length === 3, (html.match(/対 基準時計/g) || []).length);
t('開催場数のまとめが出る', html.indexOf('本日 3場のまとめ') > 0);
t('対象場には印が付く', html.indexOf('対象レースと同じ場') > 0);
t('12レースすべて表に載る', (html.match(/<tr><td style="text-align:left">/g) || []).length === 6, (html.match(/<tr><td style="text-align:left">/g) || []).length);

console.log(bad ? ('biasvenue: NG ' + bad + ' FAIL / ' + ok + ' PASS') : ('biasvenue : OK ' + ok + ' PASS（当日の全場取込→開催ごとの表・判定は同場のみ）'));
process.exit(bad ? 1 : 0);
