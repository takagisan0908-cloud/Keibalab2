/* race_id がまだ無いレース（今年の後半など開催前・netkeiba未掲載）を
   「レース名」から過去10年集計できることのテスト
   実行: node tests/byname.test.js */
const fs = require('fs'), vm = require('vm');
let ok = 0, bad = 0;
function t(name, cond, extra){ if (cond){ ok++; } else { bad++; console.log('  FAIL', name, extra === undefined ? '' : extra); } }
function makeEl(id){
  const el = { id:id||'', value:'', _html:'', _text:'', style:{}, checked:false, open:false, disabled:false,
    classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, toggle(c,f){ if(f===undefined){this._s.has(c)?this._s.delete(c):this._s.add(c);} else if(f){this._s.add(c);} else {this._s.delete(c);} }, contains(c){ return this._s.has(c); } },
    setAttribute(){}, getAttribute(){ return null; }, addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; }, dataset:{}, closest(){ return null; }, scrollIntoView(){} };
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
vm.runInContext(['p3_core','p18_racesearch','p31_bloodfactor','p36_datarace','p39_gradecal']
  .map(f => fs.readFileSync('src/' + f + '.js','utf8')).join('\n'), g, { filename:'byname.js' });
const el = id => { if (!els[id]) els[id] = makeEl(id); return els[id]; };
const txt = e => String((e && (e.textContent || e.innerHTML)) || '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const run = code => vm.runInContext(code, g);

function FAKE(name){
  return { name: name || '有馬記念', rid:'', byName:true, samples:[{},{},{}], yearsUsed:10,
    racesUsed:[{year:2025,rid:'202509090111'},{year:2024,rid:'202409090111'}],
    excluded:[], errors:[], venueDiff:[], tables:{ all:{ n:160 }, base:19 } };
}

/* 通信を伴う関数を差し替える */
const calls = { fromInf: [], mirror: [], rendered: [] };
g.drAnalyzeFromInf = function(inf, opt, progress, out){
  calls.fromInf.push(inf);
  if (progress) progress('テスト中');
  out.name = inf.name; out.byName = true; out.racesUsed = FAKE(inf.name).racesUsed;
  out.yearsUsed = 10; out.samples = [1,2,3]; out.tables = { all: { n: 160 } }; out.excluded = []; out.errors = [];
  return Promise.resolve(out);
};
g.drRenderAll = function(res, box){ calls.rendered.push((box && box.id) || 'drOut'); return res; };
g.drMirror = function(res, via){ calls.mirror.push(via); return res; };
g.gcResolveRid = function(d8, name, prog, venue){ return Promise.resolve(''); };   // race_id が見つからない状況

(async function(){
  run(`var ls = gcLs(); ls.sched = { '2026': [
    { date:'20261227', name:'有馬記念', venue:'中山', grade:'G1', dist:'芝2500' },
    { date:'20261220', name:'朝日杯フューチュリティステークス', venue:'阪神', grade:'G1', dist:'芝1600' },
    { date:'20261122', name:'マイルチャンピオンシップ', venue:'京都', grade:'G1', dist:'芝1600' }
  ] }; gcSave(ls); gcUI.rows = ls.sched['2026'];`);

  /* --- 1) 日程から行を引ける（開催場・距離を inf に渡すため） --- */
  const row = run(`JSON.stringify(gcFindRow('20261227','有馬記念'))`);
  t('gcFindRow: 日程から行を引ける', row.indexOf('中山') > 0 && row.indexOf('芝2500') > 0, row);

  /* --- 2) drAnalyzeByName: inf の作り方（年・月・場・面・距離） --- */
  await run(`drAnalyzeByName('有馬記念','中山','20261227','芝2500',function(){})`);
  const inf = calls.fromInf[calls.fromInf.length - 1];
  t('inf.year が日程の年', inf && inf.year === 2026, JSON.stringify(inf));
  t('inf.month が日程の月', inf && inf.month === 12, JSON.stringify(inf));
  t('inf.venue が日程の開催場', inf && inf.venue === '中山', JSON.stringify(inf));
  t('inf.dist が距離（芝2500 → 2500）', inf && inf.dist === 2500, JSON.stringify(inf));
  t('inf.surf が面（芝2500 → 芝）', inf && inf.surf === '芝', JSON.stringify(inf));
  t('inf.rid は空（今年のレースIDは未確定）', inf && inf.rid === '', JSON.stringify(inf));

  /* --- 3) ⑥カレンダー: rid が無くても「レース名から集計」にフォールバックし、結果は📊カード(drOut)に出る --- */
  els['drMsg'] = makeEl('drMsg'); els['drOut'] = makeEl('drOut'); els['drStat'] = makeEl('drStat');
  await run(`gcAnalyzeByDate('20261227','有馬記念','中山')`);
  await new Promise(r => setTimeout(r, 80));
  const msg6 = txt(el('drMsg'));
  t('⑥: 完了メッセージが出る', /✅ 完了/.test(msg6), msg6);
  t('⑥: 「レース名から集計」したことを注記する', /race_id が無い|レース名から/.test(msg6), msg6);
  t('⑥: 「レースIDを特定できませんでした」にならない', !/特定できませんでした/.test(msg6), msg6);
  t('⑥: drAnalyzeFromInf に日程の開催場が渡った', calls.fromInf.some(x => x.venue === '中山' && x.name === '有馬記念'));
  t('⑥: 結果は drOut（統合先の1枚）に描画された', calls.rendered.indexOf('drOut') >= 0, JSON.stringify(calls.rendered));
  t('⑥: drStat に対象レース名', /有馬記念/.test(txt(el('drStat'))), txt(el('drStat')));

  /* --- 4) 📊プルダウン: rid が無ければ drRunForName（名前経路）に回る --- */
  const selEl = el('drSelRace'); selEl.value = '20261220|朝日杯フューチュリティステークス|阪神';
  run(`drRunPick()`);
  await new Promise(r => setTimeout(r, 50));
  t('📊: 名前経路で集計した（開催場・日付つき）', calls.fromInf.some(x => x.name === '朝日杯フューチュリティステークス' && x.venue === '阪神' && x.month === 12),
    JSON.stringify(calls.fromInf.map(x => x.name + '/' + x.venue)));
  t('📊: 「レースIDを特定できませんでした」を出さない', !/特定できませんでした/.test(txt(el('drMsg'))), txt(el('drMsg')));

  /* --- 5) 📊ボタン: 名前だけ（rid 無し）の状態でも動く --- */
  run(`state.raceId = ''; state.race = { name:'', id:'' }; DR_LAST = null;
       drSetTarget('', 'マイルチャンピオンシップ', { venue:'京都', date:'20261122' });`);
  run(`drRun(false)`);
  await new Promise(r => setTimeout(r, 30));
  t('📊ボタン: 名前だけで名前経路に回る', calls.fromInf.some(x => x.name === 'マイルチャンピオンシップ' && x.venue === '京都'),
    JSON.stringify(calls.fromInf.map(x => x.name + '/' + x.venue)));

  /* --- 6) 名前も何も無ければ従来どおり案内する --- */
  const nBefore = calls.fromInf.length;
  run(`state.raceId = ''; state.race = { name:'', id:'' }; state.gradeSel = null; DR_LAST = null;`);
  run(`drRun(false)`);
  await new Promise(r => setTimeout(r, 20));
  t('📊ボタン: 対象が無ければ案内メッセージ', /分析するレースがまだありません/.test(txt(el('drMsg'))), txt(el('drMsg')));
  t('📊ボタン: 対象が無ければ集計しない', nBefore === calls.fromInf.length, calls.fromInf.length + ' / ' + nBefore);

  console.log('byname   : ' + (bad ? 'NG ' : 'OK ') + ok + ' PASS' + (bad ? ' / ' + bad + ' FAIL' : '') +
    '（race_id が無い開催前の重賞もレース名から過去10年を集計）');
  process.exit(bad ? 1 : 0);
})();
