/* レース一覧（PC版 / SP版フォールバック）のテスト
   実行: node tests/kailist.test.js
   ・PC版 race_list_sub.html が空/400を返す中継でも、SP版から当日の開催場・レースを取れる
   ・race_id（YYYY+場コード+回+日+R）から 場・回次・レース番号・発走時刻・距離・頭数 を復元
   ・PC版が取れればPC版を優先する
*/
const fs = require('fs'), vm = require('vm');
let ok = 0, bad = 0;
function t(name, cond, extra){ if (cond){ ok++; } else { bad++; console.log('  FAIL', name, extra === undefined ? '' : extra); } }

function makeEl(id){
  const el = { id:id||'', value:'', _html:'', _text:'', style:{}, checked:false, open:false, disabled:false,
    classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
      toggle(c,f){ if(f===undefined){this._s.has(c)?this._s.delete(c):this._s.add(c);} else if(f){this._s.add(c);} else {this._s.delete(c);} },
      contains(c){ return this._s.has(c); } },
    setAttribute(){}, getAttribute(){ return null; }, addEventListener(){}, removeEventListener(){},
    querySelector(){ return null; }, querySelectorAll(){ return []; }, dataset:{}, appendChild(){}, remove(){},
    closest(){ return null; } };
  Object.defineProperty(el,'innerHTML',{get(){return el._html;},set(v){el._html=String(v);el._text=String(v).replace(/<[^>]*>/g,' ');}});
  Object.defineProperty(el,'textContent',{get(){return el._text;},set(v){el._text=String(v);el._html='';}});
  return el;
}
const els = {};
const g = {
  console, Math, JSON, Date, String, Number, Array, Object, Error, Promise, Boolean,
  parseInt, parseFloat, isNaN, isFinite, RegExp, encodeURIComponent, decodeURIComponent,
  setTimeout(){ return 0; }, clearTimeout(){}, setInterval(){ return 0; }, clearInterval(){},
  localStorage:{ _d:{}, getItem(k){ return this._d[k]==null?null:this._d[k]; }, setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; } },
  document:{ getElementById(id){ if(!els[id]) els[id]=makeEl(id); return els[id]; },
    querySelector(){ return null; }, querySelectorAll(){ return []; }, createElement(){ return makeEl(); },
    addEventListener(){}, body:makeEl('body') },
  addEventListener(){}, navigator:{ userAgent:'test' }
};
g.window = g; g.globalThis = g; g.self = g;
vm.createContext(g);
const code = ['p3_core','p5_engine','p26_kaisai'].map(f => fs.readFileSync('src/' + f + '.js','utf8')).join('\n');
vm.runInContext(code, g, { filename:'kai.js' });

const SP = fs.readFileSync('tests/fixtures/nk_racelist_sp.html','utf8');

// ---- 1) SP版のパース ----
g.__sp = SP;
const v = vm.runInContext('kaiParseListSp(__sp, "20260912")', g);
t('SP版から2場', v.length === 2, v.length);
const nak = v.filter(x => x.venue === '中山')[0], han = v.filter(x => x.venue === '阪神')[0];
t('中山・阪神が取れる', !!nak && !!han, v.map(x => x.venue).join(','));
t('中山12レース', nak && nak.races.length === 12, nak && nak.races.length);
t('阪神12レース', han && han.races.length === 12, han && han.races.length);
t('回次を race_id から復元（4回3日目）', nak && nak.kaisai === '4回3日目', nak && nak.kaisai);
t('レース番号順に並ぶ', nak && nak.races.map(r => r.r).join(',') === '1,2,3,4,5,6,7,8,9,10,11,12', nak && nak.races.map(r => r.r).join(','));
const r12 = nak && nak.races.filter(r => r.r === 12)[0];
t('12Rのrace_id', r12 && r12.raceId === '202606040312', r12 && r12.raceId);
t('12Rの発走時刻', r12 && r12.time === '16:10', r12 && r12.time);
t('12Rの距離', r12 && /ダ1800/.test(r12.cond || ''), r12 && r12.cond);
t('12Rの頭数', r12 && /16/.test(r12.count || ''), r12 && r12.count);
t('12Rのレース名', r12 && /3歳以上1勝クラス/.test(r12.name || ''), r12 && r12.name);
t('阪神のrace_idは場コード09', han && han.races.every(r => r.raceId.slice(4, 6) === '09'), han && han.races[0].raceId);

// ---- 2) 日付が違う日はその日のブロックだけ ----
const v2 = vm.runInContext('kaiParseListSp(__sp, "20260913")', g);
t('fixtureに無い日は空（当日分だけ）', v2.length === 0 || v2.every(x => (x.races[0] || {}).raceId.slice(0, 8) !== '20260912'), v2.length);

// ---- 3) PC版があればPC版を優先 ----
const PC = '<dl class="RaceList_DataList"><div class="RaceList_DataTitle"><small>4回</small>中山<small>3日目</small></div>' +
  '<dd class="RaceList_Data">芝:良 ダ:良</dd>' +
  '<li class="RaceList_DataItem"><span class="Race_Num">11R</span><span class="ItemTitle">京成杯オータムH</span>' +
  '<span class="RaceList_Itemtime">15:45</span><span>芝1600m</span><span class="RaceList_Itemnumber">16頭</span>' +
  '<a href="?race_id=202606040311">x</a></li></dl>';
g.__pc = PC;
const vp = vm.runInContext('kaiParseList(__pc)', g);
t('PC版パース', vp.length === 1 && vp[0].venue === '中山' && vp[0].races.length === 1, JSON.stringify(vp).slice(0,120));
const va = vm.runInContext('kaiParseAny(__pc, "20260912")', g);
t('PC版があればPC版を使う', va.venues.length === 1 && va.venues[0].venue === '中山', va.venues.length);
const vb = vm.runInContext('kaiParseAny(__sp, "20260912")', g);
t('PC版が空ならSP版を使う', vb.venues.length === 2, vb.venues.length);
const ve = vm.runInContext('kaiParseAny("<html><body></body></html>", "20260912")', g);
t('空/エラーページは0件・指定日なし', ve.venues.length === 0 && ve.dateSeen === false, JSON.stringify(ve));
// SP版に指定日が載っていない（過去日など）→ dateSeen=false（開催なしと誤判定しない）
const vpast = vm.runInContext('kaiParseAny(__sp, "20260105")', g);
t('SPに指定日が無ければ dateSeen=false', vpast.venues.length === 0 && vpast.dateSeen === false, JSON.stringify(vpast).slice(0,80));

// ---- 4) URL候補を順に試して、解釈できたものを採用 ----
(async function(){
  const tried = [];
  g.kaiFetchAny = function(url){
    tried.push(url);
    if (/race_list_sub\.html/.test(url)) return Promise.resolve('<meta charset="UTF-8"><head></head><body></body></meta>');  // 中継が空を返す
    if (/race\.sp\.netkeiba\.com/.test(url)) return Promise.resolve(SP);
    return Promise.reject(new Error('unexpected ' + url));
  };
  const res = await vm.runInContext('kaiFetchListHtml("20260912")', g);
  t('PC版が空ならSP版に自動フォールバック', res.venues.length === 2, res.venues.length);
  t('SP版で中山・阪神', res.venues.map(x => x.venue).join(',') === '中山,阪神', res.venues.map(x => x.venue).join(','));
  t('試したURLは PC版→SP版 の順', tried.length === 2 && /race_list_sub/.test(tried[0]) && /race\.sp\./.test(tried[1]), tried.join(' | '));
  console.log(bad ? ('kailist: NG ' + bad + ' FAIL / ' + ok + ' PASS') : ('kailist : OK ' + ok + ' PASS（PC版レース一覧が空でもSP版から当日の開催場・レースを取得）'));
  process.exit(bad ? 1 : 0);
})();
