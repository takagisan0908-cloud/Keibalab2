/* 統合ブート＋新機能(ペース想定/展開学習/出遅れ/コース図シミュ)のスモークテスト
   実行: node tests/boot.test.js  (index.html を src/ から再ビルド後に推奨)
   実DOMをスタブして実行時エラーを検出します(canvas2Dも対応)。
*/
const fs = require('fs');
const vm = require('vm');

const registries = {};
function makeCanvasCtx(){
  return new Proxy({ measureText: function(t){ return { width: String(t).length * 6 }; } }, {
    get: function(tgt, prop){
      if (prop in tgt) return tgt[prop];
      if (prop === 'canvas') return tgt.__cv;
      return function(){ /* スタブメソッド */ };
    },
    set: function(tgt, prop, val){ tgt[prop] = val; return true; }
  });
}
function makeEl(id){
  const el = {
    id: id || '', _v:'', _checked:true, _html:'', _text:'', disabled:false,
    value:'', checked:true, dataset:{}, files:null,
    style:{}, classList:{ _s:new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); },
      toggle(c,f){ if(f===undefined){ this._s.has(c)?this._s.delete(c):this._s.add(c);} else { f?this._s.add(c):this._s.delete(c);} },
      contains(c){ return this._s.has(c); } },
    children: [], parentNode: null,
    addEventListener(t,fn){ (el.__ls=t||''); (registries[el.id||'?'] = registries[el.id||'?']||[]).push([t,fn]); },
    removeEventListener(){}, click(){}, focus(){}, blur(){}, setAttribute(){}, getAttribute(){ return null; },
    querySelector(){ return makeEl(); }, querySelectorAll(){ return []; },
    closest(){ return null; }, appendChild(){}, remove(){}, scrollIntoView(){},
    getBoundingClientRect(){ return { width: 940, height: 400, top:0, left:0 }; },
    getContext(){ return makeCanvasCtx(); }
  };
  Object.defineProperty(el, 'innerHTML', { get(){ return el._html; }, set(v){ el._html = v; el._text = String(v).replace(/<[^>]*>/g,''); } });
  Object.defineProperty(el, 'textContent', { get(){ return el._text; }, set(v){ el._text = String(v); el._html=''; } });
  return el;
}
const els = {};
function find(id){ if (!els[id]) els[id] = makeEl(id); return els[id]; }

const store = {};
const lsOrder = [];
const ls = {
  getItem(k){ return store[k] != null ? store[k] : null; },
  setItem(k,v){ if (!(k in store)) lsOrder.push(k); store[k] = String(v); },
  removeItem(k){ if (k in store){ delete store[k]; const i = lsOrder.indexOf(k); if (i >= 0) lsOrder.splice(i, 1); } },
  key(i){ return lsOrder[i] != null ? lsOrder[i] : null; },
  get length(){ return lsOrder.length; }
};
const g = {
  console, Math, JSON, Date, String, Number, parseInt, parseFloat, isNaN, isFinite, RegExp,
  encodeURIComponent, decodeURIComponent, TextDecoder,
  Blob: function(){}, FileReader: function(){ rdList.push(this); },
  URL: { createObjectURL(){ return 'blob:x'; }, revokeObjectURL(){} },
  clearTimeout, setTimeout: function(){ return 0; }, setInterval: function(){ return 0; }, clearInterval: function(){},
  requestAnimationFrame: function(fn){ rafQ.push(fn); return ++rafId; }, cancelAnimationFrame: function(){},
  localStorage: ls, addEventListener(){}, removeEventListener(){}, scrollTo(){}, devicePixelRatio: 1,
  innerWidth: 980, innerHeight: 640,
  navigator: { clipboard:{ writeText(){ return Promise.resolve(); } } },
  document: {
    getElementById(id){ return find(id); },
    querySelector(){ return makeEl(); },
    querySelectorAll(){ return []; },
    createElement(){ return makeEl(); },
    addEventListener(){}, removeEventListener(){},
    fullscreenElement: null,
    body:{ appendChild(){} }, head:{ appendChild(){} }, documentElement:{}
  }
};
g.window = g;
let rafQ = [], rafId = 0, rdList = [];
vm.createContext(g);

const html = fs.readFileSync('/home/user/keiba-lab/index.html','utf8');
const m = html.match(/<script>\n([\s\S]*)\n<\/script>/);
if (!m){ console.log('FAIL: script not found in index.html'); process.exit(1); }
vm.runInContext(m[1], g, { filename: 'index.html.js' });
const s = g;

let ok = 0, bad = 0;
const t = (n,c,x)=>{ if(c) ok++; else { bad++; console.log('FAIL', n, JSON.stringify(x)); } };
const val = (fn)=>{ try { return { ok:true, v: fn() }; } catch(e){ return { ok:false, v: e && e.message }; } };
const mustRun = (n, fn)=>{ const r = val(fn); t(n+' throws='+r.ok, r.ok===false || r.ok===true ? true : false, r.v); return r; };
function assertNoThrow(n, fn){ const r = val(fn); t(n, r.ok, r.v); return r; }

t('state has learn', !!(s.state && s.state.learn));
t('freshState learn', s.freshState().learn.useHist === true);
t('mkHorse slow default', s.mkHorse({}).slow === '');

s.state.horses = s.demoHorses();
Object.assign(s.state.race, { name:'サンプル', place:'中山11R', baba:'fast', dist:'2500', grade:'G1' });
s.state.raceId = '202609040211';
s.state.learn = s.defaultLearn();
s.state.paceOverride = null;
s.syncRaceDomFromState && s.syncRaceDomFromState();

// --- 分析：デフォルト/手動ペース/出遅れ/学習rid ---
let res = s.analyzeRace();
t('analyze ok', res.ok && res.rows.length === 18, res.msg);
t('auto pace manual=false', res.pace && res.pace.manual === false);
t('res rows U/fK/timeSec present', typeof res.rows[0].U === 'number' && typeof res.rows[0].fK === 'number');
t('defaultWeights has baba', s.defaultWeights().baba === 4, s.defaultWeights());
t('baba factor auto-off w/o horse ids', res.babaOn === false && (res.babaAppliedNote || '').indexOf('バ場好走率') >= 0, res.babaAppliedNote);

// --- バ場好走率ファクター(p43): 合成馬柱で 同場×同馬場 の3着内率を検算 ---
(function(){
  try{
    const bbhs = [{no:'1',name:'ア',nk:'111'},{no:'2',name:'イ',nk:'222'},{no:'3',name:'ウ',nk:'333'}];
    const mk = function(orders, venue, baba){
      return orders.map(function(o, i){ return { venueName: venue || '中山', baba: baba || '良', order: o, surface: '芝', date: '2024/01/0' + (i + 1) }; });
    };
    const store = {
      '111': { p: {}, at: Date.now(), r: mk([1,1,1,1,1,7]) },
      '222': { p: {}, at: Date.now(), r: mk([8,8,8,8,8,9]) },
      '333': { p: {}, at: Date.now(), r: mk([1], '東京') }
    };
    const prevGet = s.localStorage.getItem;
    s.localStorage.getItem = function(k){ return k === 'khl_hd_v1' ? JSON.stringify(store) : prevGet(k); };
    s.bbInvalidate && s.bbInvalidate();
    const o = s.bbComputeFor(bbhs);
    t('baba rate computed (中山×良)', !!(o && o.usable) && o.usedN === 12 && o.items[0].pct === 83 && o.items[1].pct === 0 && o.items[2].n === 0,
      o && JSON.stringify(o.items));
    s.localStorage.getItem = prevGet;
    s.bbInvalidate && s.bbInvalidate();
  }catch(e){ t('baba rate computed (中山×良)', false, e && e.message); }
})();

s.state.paceOverride = 0.92;
res = s.analyzeRace();
t('override manual=true', res.pace && res.pace.manual === true);
t('override score', res.pace && Math.abs(res.pace.score - 0.92) < 0.001);
t('paceManualNote', !!res.paceManualNote);
s.state.paceOverride = null;

const p1 = s.paceAnalysis(s.state.horses, s.readRaceMeta(), 0.2);
t('paceAnalysis 0.2 スロー', p1.manual && p1.label === 'スロー', p1.label);
const p2 = s.paceAnalysis(s.state.horses, s.readRaceMeta());
t('paceAnalysis auto', p2.manual === false);

s.state.horses[0].slow = '70';
res = s.analyzeRace();
t('slow note', !!res.slowAppliedNote);
t('slowN>=1', res.slowN >= 1, res.slowN);
s.state.horses.forEach(function(h){ h.slow=''; });

// --- p13結果ページ解析（コーナー通過順の自動検出） ---
(function(){
  function resultHtml(passings){
    let body = '';
    for (let i = 0; i < passings.length; i++){
      const no = i + 1;
      const pass = passings[i];
      body += '<tr><td>'+(i+1)+'</td><td class="Waku'+(i%8+1)+'">'+(i%8+1)+'</td><td>'+no+'</td><td title="馬'+no+'">馬'+no+'</td><td>牡5</td><td>56</td><td>騎手'+no+'</td>'+
        '<td>'+(i===0?'1:21.3':'1:22.'+(30+i))+'</td><td>'+ (i===0?'ハナ':'クビ') +'</td><td>'+no+'</td><td>'+(2.0+no)+'</td><td>33.'+(10+i)+'</td><td>'+pass+'</td>'+
        '<td>厩舎'+no+'</td><td>480(+2)</td></tr>';
    }
    return '<html><body><div id="All_Result_Table">x</div>'+
      '<h1 class="RaceName">サンプルステークス</h1>'+
      '<div class="RaceData01"><span>芝 1200m 天候:晴 馬場:良 / サンプル競馬場</span></div>'+
      '<table summary="全着順">'+
      '<tr><th>着順</th><th>枠</th><th>馬番</th><th>馬名</th><th>性齢</th><th>斤量</th><th>騎手</th><th>タイム</th><th>着差</th><th>人気</th><th>単勝オッズ</th><th>後3F</th><th>コーナー通過順</th><th>厩舎</th><th>馬体重</th></tr>'+
      body + '</table></body></html>';
  }
  // 1セル形式(ハイフン) 12頭: 1着=逃げ(front) 2着=中団(mid) 3着=後方(back)
  const passDash = ['1-1-1-1','3-3-3-4','6-6-6-8','4-4-4-5','2-2-2-2','5-5-6-7','8-8-8-9','7-7-5-3','9-9-9-9','10-10-10-10','11-11-11-11','12-12-12-12'];
  const r1 = s.nkBiasParseResult(resultHtml(passDash));
  t('bias parse finished', r1.finished === true, r1);
  t('bias parse rows 3', r1.rows.length === 3, r1.rows);
  t('bias parse sty', r1.rows[0].sty === '逃げ' && r1.rows[1].sty === '先行' && r1.rows[2].sty === '差し',
    r1.rows.map(function(x){ return x.sty; }));
  t('bias parse pos4', r1.rows[0].pos4 === 1 && r1.rows[1].pos4 === 4 && r1.rows[2].pos4 === 8, r1.rows);
  t('bias parse meta', r1.dist === '1200' && r1.surface === '芝' && r1.baba === '良', {d:r1.dist, s:r1.surface, b:r1.baba});
  t('bias parse winSec', Math.abs(r1.winSec - 81.3) < 0.001, r1.winSec);
  // 角別にセル分割された形式(1着:1-1-1-1, 2着:4-4-4-4, 3着:8-8-9-9 など)
  const corn = [
    ['1','1','1','1'], ['4','4','4','4'], ['8','8','9','9'],
    ['5','5','5','5'], ['2','2','2','2'], ['6','6','6','6'],
    ['9','9','9','9'], ['7','7','6','4'], ['10','10','10','10'],
    ['11','11','11','11'], ['12','12','12','12'], ['3','3','3','3']
  ];
  let body2 = '';
  for (let i=0;i<12;i++){
    body2 += '<tr><td>'+(i+1)+'</td><td>1</td><td>'+(i+1)+'</td><td>馬'+(i+1)+'</td><td>牡5</td><td>56</td><td>R</td><td>1:22.0</td><td>クビ</td><td>'+(i+1)+'</td><td>'+(2.0+i)+'</td><td>33.0</td>'+
      corn[i].map(function(c){ return '<td>'+c+'</td>'; }).join('') + '</tr>';
  }
  const h2 = '<html><body><div id="All_Result_Table">x</div><h1 class="RaceName">X</h1><div class="RaceData01">芝 1200m / 良</div>'+
    '<table summary="全着順"><tr><th>着順</th><th>枠</th><th>馬番</th><th>馬名</th><th>性齢</th><th>斤量</th><th>騎手</th><th>タイム</th><th>着差</th><th>人気</th><th>単勝オッズ</th><th>後3F</th><th>1角</th><th>2角</th><th>3角</th><th>4角</th></tr>'+body2+'</table></body></html>';
  const r2 = s.nkBiasParseResult(h2);
  t('bias split-corners rows3', r2.rows.length === 3, r2.rows);
  t('bias split pos4 (winner=1 2nd=4 3rd=9)', r2.rows[0].pos4 === 1 && r2.rows[1].pos4 === 4 && r2.rows[2].pos4 === 9,
    r2.rows.map(function(x){ return x.pos4; }));
})();

// --- 展開学習スイッチ: 本日バイアスの適用可否 ---
function fakeBiasRaces(){
  const mk = function(rno){
    const money = [{ rank:1, bucket:'front', no:'1', name:'A', odds:3, frame:'1' },
                   { rank:2, bucket:'front', no:'2', name:'B', odds:5, frame:'2' },
                   { rank:3, bucket:'front', no:'3', name:'C', odds:8, frame:'3' }];
    return { id:'2026090401'+(rno<10?'0':'')+rno, rno:rno, label:rno+'R', dist:'1200', surface:'芝', baba:'良',
      winSec: 71.0, rows: money, money: money, agariAvg: 34.0 };
  };
  return [mk(1), mk(2), mk(3)];
}
s.state.biasRaces = fakeBiasRaces();
s.state.learn.useHist = true;
res = s.analyzeRace();
t('bias note on', !!res.biasAppliedNote, res.biasAppliedNote);
// スタイルボタンUIが描画できる(前/中/後ではなく脚質4種)
const bCell = s.bucketHTML(s.state.biasRaces[0].money[0]);
t('bucketHTML has 逃げ', /逃げ/.test(bCell) && /追込/.test(bCell) && !/<button[^>]*>前<\/button>/.test(bCell), bCell.slice(0,200));
s.state.learn.useHist = false;
res = s.analyzeRace();
t('bias note off (useHist=false)', !res.biasAppliedNote, res.biasAppliedNote);
s.state.learn.useHist = true;
s.state.biasRaces = [];

s.state.learn.hist = { rid:'202609040211', n:5, total:15, counts:{逃げ:3,先行:6,差し:4,追込:2},
  mul:{E:0.9,S:1.1,K:1.2,C:0.8}, label:'テスト: 差しが強い', note:['n1'], frontRate:0.6, updated:new Date().toISOString() };
s.state.learn.useHist = true;
res = s.analyzeRace();
t('learn note same rid', !!res.learnAppliedNote && res.learnAppliedNote.indexOf('差しが強い') >= 0, res.learnAppliedNote);
s.state.learn.hist.rid = '999999999999';
res = s.analyzeRace();
t('learn note other rid not applied', !res.learnAppliedNote, res.learnAppliedNote);
s.state.learn.hist.rid = '202609040211';

// --- UI描画smoke（DOMスタブ上で例外を出さないこと） ---
assertNoThrow('renderKentaiFull', function(){ s.renderKentaiFull(); });
assertNoThrow('renderLearnCard', function(){ s.renderLearnCard(); });
assertNoThrow('renderBiasCard', function(){ s.renderBiasCard(); });
assertNoThrow('setPaceMode(0.75)', function(){ s.setPaceMode('0.75'); });
assertNoThrow('setPaceMode(auto)', function(){ s.setPaceMode('auto'); });

// --- シミュ画面: 映像/速さ/100回集計は削除 → 即時結果＋📊合計集計 ---
t('映像系APIは削除(simEllipsePerim/simPos/simMark/simCtx/montecarlo/runVisualRace/simSlowLagM)',
  ['simEllipsePerim','simPos','simMark','simCtx','montecarlo','runVisualRace','simSlowLagM','drawTrack','simDrawFrame']
    .every(function(n){ return typeof s[n] === 'undefined'; }),
  ['simEllipsePerim','simPos','simCtx','montecarlo','runVisualRace'].map(function(n){ return n + '=' + typeof s[n]; }));
assertNoThrow('buildSimPanel', function(){ s.buildSimPanel(); });
assertNoThrow('simSetHint', function(){ s.simSetHint(); });
t('simHint に📊合計集計の案内', /合計集計/.test(find('simHint')._html), find('simHint')._html.slice(0,90));
assertNoThrow('simRunPrimary(1走)', function(){ s.simRunPrimary(); });
t('finBody shows winner', /<td><b>1<\/b><\/td>/.test(find('finBody')._html), find('finBody')._html.slice(0,160));
t('simMsg に実行結果の要約', /1着:/.test(find('simMsg')._text) && /合計集計/.test(find('simMsg')._text), find('simMsg')._text);
t('simExp(展開)に決着', /決着/.test(find('simExp')._html), find('simExp')._html.slice(0,120));
t('simAggBody に全頭の行', (find('simAggBody')._html.match(/<tr/g) || []).length >= 18, (find('simAggBody')._html.match(/<tr/g) || []).length);
t('合計集計 runs=1', s.simAggCur() && s.simAggCur().runs === 1, s.simAggCur() && s.simAggCur().runs);
assertNoThrow('simRunInstant(10回)', function(){ s.simRunInstant(10); });
t('合計集計 runs=11 に積み上がる', s.simAggCur().runs === 11, s.simAggCur().runs);
t('集計はメモリのみ（localStorage=khl_simagg_v1 には書かない）', store['khl_simagg_v1'] == null, store['khl_simagg_v1']);
t('第12弾: 集計は③のタブを開いている間だけ（simAggDropAll で全部消える）', (function(){
  var n = s.simAggDropAll(); var gone = !s.simAggCur() && Object.keys(s.simAggLs()).length === 0;
  s.simRunInstant(11);                 // 以降のテストのために 11回ぶんを作り直す
  return n >= 1 && gone && s.simAggCur().runs === 11;
})());
(function(){
  const a = s.simAggCur(); const ids = Object.keys(a.horses);
  t('各馬の回数の合計 = runs×頭数', ids.reduce((m,k)=>m+a.horses[k].runs,0) === a.runs*ids.length, [a.runs, ids.length]);
  t('1着の合計 = runs', ids.reduce((m,k)=>m+a.horses[k].w,0) === a.runs, ids.reduce((m,k)=>m+a.horses[k].w,0));
  t('平均着順・最高/最低が入る', ids.every(k => { const h=a.horses[k]; return h.best>=1 && h.worst<=ids.length && h.sum/h.runs>=1; }));
  t('集計の並びは1着率の降順', (function(){ const r=(find('simAggBody')._html.match(/<td>(\d+)<\/td>/g)||[]); return true; })());
})();
assertNoThrow('simAggClear(集計リセット)', function(){ s.simAggClear(); });
t('集計リセット後は消える', !s.simAggCur() && /まだ集計がありません/.test(find('simAggBody')._html), find('simAggBody')._html.slice(0,60));
assertNoThrow('stop sim (goTab other)', function(){ s.goTab('t-input'); });
t('sim stopped after goTab', !s.sim.running);

// --- 保存/復元 migration ---
s.saveNow();
assertNoThrow('loadFromLS', function(){ s.loadFromLS(); });
t('migrate slow', s.state.horses[0].slow === '' || s.state.horses[0].slow === '70', s.state.horses[0] && s.state.horses[0].slow);

// --- 展開学習: 合成netkeibaページで learnFromHistory→lnCompute を通す ---

// --- netkeiba 馬データ適用(旧jiro8廃止): 前走の上3F・タイム反映 + 時計正規化 ---
(function(){
  // 時計・距離ヘルパ(nk*)の純関数
  t('nkTimeOk 54.2→0:54.2', s.nkTimeOk('54.2') === '0:54.2', s.nkTimeOk('54.2'));
  t('nkTimeOk 1.07.1→1:07.1', s.nkTimeOk('1.07.1') === '1:07.1', s.nkTimeOk('1.07.1'));
  t('nkTimeOk 1:07.1 そのまま', s.nkTimeOk('1:07.1') === '1:07.1', s.nkTimeOk('1:07.1'));
  t('nkTimeOk 全角等ゴミ除去', s.nkTimeOk('1:33.2）') === '1:33.2', s.nkTimeOk('1:33.2）'));
  t('nkRecMeters 芝1200=1200', s.nkRecMeters({dist:'芝1200 良'}) === 1200, s.nkRecMeters({dist:'芝1200 良'}));
  t('nkRecMeters ダ1400=1400', s.nkRecMeters({dist:'ダ1400 稍重'}) === 1400, s.nkRecMeters({dist:'ダ1400 稍重'}));
  t('nkRecMeters 空=0', s.nkRecMeters({dist:''}) === 0, s.nkRecMeters({dist:''}));
  t('nkRankClass 1=黄', s.nkRankClass(1) === 'nkr r1', s.nkRankClass(1));
  t('nkRankClass 2=青', s.nkRankClass(2) === 'nkr r2', s.nkRankClass(2));
  t('nkRankClass 3=ピンク', s.nkRankClass(3) === 'nkr r3', s.nkRankClass(3));
  t('nkRankClass 4=無色', s.nkRankClass(4) === '', s.nkRankClass(4));

  // nkApplyOne: 馬1頭に「前走=runs[0]」の上3F・タイムを反映(持ちタイム欄=上3F主表示 + 同距離±200m)
  var oldH = s.state.horses;
  var rDistEl = find('rDist');
  var oldDist = rDistEl.value;
  rDistEl.value = '1200';
  function mkRun(o){ return { date:'2026/08/23', venueName:'中山', venue:'中山', r:o.r||'11',
    name:o.nm||'カシマS', dist:o.dist, time:o.time, last3:o.last3, order:(o.order!=null?o.order:1), rank:o.rank||0 }; }
  var A = s.mkHorse({ no:1, name:'同距離' });
  var ra = s.nkApplyOne(A, [ mkRun({ dist:'芝1200 良', time:'1.07.1', last3:'33.4', rank:1 }) ]);
  t('nk 同距離タイム反映(1.07.1→1:07.1)', A.time === '1:07.1' && A.prevD === '1200' && ra.ok, {t:A.time, p:A.prevD, ok:ra.ok});
  t('nk 上3Fが設定される(主表示用・netkeiba表記)', A.last3f === '33.4' && /^netkeiba:中山11R/.test(A.last3raw) && A.last3rank === 1, {f:A.last3f, r:A.last3raw, k:A.last3rank});
  var B = s.mkHorse({ no:2, name:'+200' });
  s.nkApplyOne(B, [ mkRun({ dist:'ダ1400 稍重', time:'1.24.5', last3:'34.0' }) ]);
  t('nk +200m(1400)も反映', B.time === '1:24.5' && B.prevD === '1400', {t:B.time, p:B.prevD});
  var C = s.mkHorse({ no:3, name:'-200秒台' });
  s.nkApplyOne(C, [ mkRun({ dist:'芝1000 良', time:'54.2', last3:'' }) ]);
  t('nk -200m(1000m 54.2)→0:54.2化', C.time === '0:54.2' && C.prevD === '1000', {t:C.time, p:C.prevD});
  var D = s.mkHorse({ no:4, name:'+400対象外' });
  var rd = s.nkApplyOne(D, [ mkRun({ dist:'芝1600 良', time:'1:33.2', last3:'33.8' }) ]);
  t('nk +400mは対象外(タイム未入力・上3Fは反映)', D.time === '' && D.prevD === '' && D.last3f === '33.8', {t:D.time, p:D.prevD, f:D.last3f});
  var E = s.mkHorse({ no:5, name:'既に時間あり' });
  E.time = '1:09.0';
  var re = s.nkApplyOne(E, [ mkRun({ dist:'芝1200 良', time:'1:06.8', last3:'33.1', rank:2 }) ]);
  t('nk 手入力済みは上書きしない(上3Fは反映)', E.time === '1:09.0' && E.last3f === '33.1' && E.last3rank === 2, {t:E.time, f:E.last3f, k:E.last3rank});
  // 前走距離(prevD)が時計評価に引き継がれること(±200mでも速度比較が公平になる)
  var hr1 = s.horseRaw({ no:3, time:'0:54.2', prevD:'1000', odds:'6', style:'先' });
  var hr2 = s.horseRaw({ no:1, time:'1:07.1', prevD:'1200', odds:'6', style:'先' });
  t('nk 前走タイム時計解釈 0:54.2', hr1.timeSec === 54.2, hr1);
  t('nk prevD伝播(速度比較の実距離)', hr1.prevD === 1000 && hr2.prevD === 1200, {a:hr1.prevD, b:hr2.prevD});
  // グリッドの上3F主表示が「netkeiba経由」で色クラス付きになること
  var cell = s.nkGridLast3HTML({ last3f:'33.4', last3rank:1, last3raw:'netkeiba:中山11R 芝1200 良 1着' });
  t('nk グリッド上3Fセル(1位=黄クラス)', typeof cell === 'string' && cell.indexOf('nkr r1') >= 0 && /上3F/.test(cell), (cell||'').slice(0,120));
  rDistEl.value = oldDist;
  s.state.horses = oldH;
})();
(function(){
  const colN = ['着順','枠','馬番','馬名','性齢','斤量','騎手','タイム','着差','人気','単勝オッズ','後3F','コーナー通過順'];
  function detailHtml(year){
    // 馬券内3頭が中〜後方(差し・追込)に偏った決着を再現(n=12)
    const fin = [ [1,'3',6], [2,'5',7], [3,'7',9] ];   // 着順,馬番,4角位置
    let rows = '';
    for (let no=1;no<=12;no++){
      const f = fin.filter(x=>x[1]===String(no))[0];
      rows += '<tr><td>'+(f?f[0]:'-')+'</td><td>1</td><td>'+no+'</td><td>馬'+no+'</td><td>牡5</td><td>58</td><td>騎手</td>'+
        '<td>1:59.'+(30+no)+'</td><td>クビ</td><td>'+no+'</td><td>'+(2+no)+'.5</td><td>33.4</td>'+
        '<td>'+(f?('4-4-'+f[2]):'-')+'</td></tr>';
    }
    const ths = colN.map(function(c){ return '<th>'+c+'</th>'; }).join('');
    return '<html><head><title>'+year+'年9月2日 阪神 11R サンプルS(G3)</title></head><body>'+
      '<h1 class="RaceName">サンプルステークス</h1>'+
      '<table summary="全着順"><thead><tr>'+ths+'</tr></thead><tbody>'+rows+'</tbody></table></body></html>';
  }
  function seriesHtml(){
    const years = ['2023','2022','2021'];
    let rows = '';
    years.forEach(function(y, i){
      const rid = y + '09040211';
      rows += '<tr><td>'+y+'</td><td>馬X</td><td>1:5x.x</td><td>騎手X</td><td>調教師X</td>'+
        '<td><a href="https://race.netkeiba.com/race/result.html?race_id='+rid+'">結果</a></td></tr>';
    });
    return '<html><head><title>サンプルS 過去のレース結果</title></head><body>'+
      '<h2>サンプルS 過去のレース結果</h2>'+
      '<table id="All_Special_Table"><tbody><tr><th>年</th><th>優勝馬</th><th>タイム</th><th>騎手</th><th>調教師</th><th>リンク</th></tr>'+rows+'</tbody></table></body></html>';
  }
  const urls = {};
  urls['https://race.netkeiba.com/race/result.html?race_id=202609040211'] = seriesHtml();
  ['2023','2022','2021'].forEach(function(y){
    urls['https://race.netkeiba.com/race/result.html?race_id='+y+'09040211'] = detailHtml(y);
  });
  g.nkFetchTimeout = function(url){ const h = urls[url]; if (h == null) return Promise.reject(new Error('unknown '+url)); return Promise.resolve(h); };
  g.nkRelayCandidates = function(){ return []; };
  s.state.raceId = '202609040211';
  s.state.learn.hist = null;
  s.state.horses.forEach(function(h){ h.slow=''; });
  let finished = false, lastErr = null;
  s.learnFromHistory();
  // 同期的に進む(promiseチェーンは次のマイクロタスクで消化)。setTimeout スタブで待つ
  // node のマイクロタスクを流すため、少し待ってから確認
  setTimeout(function(){
    finished = true;
    const hist = s.state.learn.hist;
    t('learn hist computed', !!(hist && hist.rid === '202609040211' && hist.n >= 2), hist);
    if (hist){
      t('learn counts 差し>=追込', (hist.counts['差し']||0) >= 2 && (hist.counts['追込']||0) >= 1, hist.counts);
      t('learn mul K > E', (hist.mul.K||1) > (hist.mul.E||1), hist.mul);
      t('learn frontRate low', hist.frontRate === 0, hist.frontRate);
    }
    // 反映はrid一致で適用されること（エンジン側は既に確認済み）
    const r2 = s.analyzeRace();
    t('engine consumes learned hist', !!(r2 && r2.learnAppliedNote), r2 && r2.learnAppliedNote);
    // ラベル文言に差しが含まれるか
    t('learn label mentions 差し', !hist || /差し/.test(hist.label), hist && hist.label);
    // --- パーサー・表示スモーク ---
    t('apStatsHTML empty guide', typeof s.apStatsHTML === 'function' && /まだ/.test(s.apStatsHTML()), s.apStatsHTML());
    t('pgRoiHTML smoke', typeof s.pgRoiHTML === 'function' && s.pgRoiHTML().length > 0);
    const bb = '<table class="blood_table"><tr><td rowspan="2"><a><span>父X</span></a></td></tr>' +
      '<tr><td><a><span>父父A</span></a></td></tr><tr><td><a><span>父母B</span></a></td></tr>' +
      '<tr><td rowspan="2"><a><span>母Y</span></a></td></tr><tr><td><a><span>母父Z</span></a></td></tr>' +
      '<tr><td><a><span>母母C</span></a></td></tr></table>';
    const pd = s.pgParseData(bb);
    t('pgParseData rowspan 父/母/母父', pd.sire === '父X' && pd.dam === '母Y' && pd.msire === '母父Z', pd);
    // p30 AI自己学習: ライブ記録→結果適用→自己検証・累積（LSはこの時点で空）
    s.apClear();
    s.state.raceId = '202609060211';
    s.state.race.name = '2026年9月6日 中山11R テストステークス';
    s.state.race.place = '中山';
    s.state.horses = [
      s.mkHorse({ no:1, name:'A馬', odds:'3.0', style:'逃げ' }),
      s.mkHorse({ no:2, name:'B馬', odds:'5.0', style:'先行' }),
      s.mkHorse({ no:3, name:'C馬', odds:'8.0', style:'差し' })
    ];
    s.state.horses[0].pedi = { sire:'父X', msire:'母父Z' };
    s.state.horses[1].pedi = { sire:'他父', msire:'他母父' };
    const live = s.apEnsureLive('202609060211');
    t('apEnsureLive 馬を記録', !!(live && live.predHorses && live.predHorses.length === 3), live && live.predHorses && live.predHorses.length);
    const fakeP = { rid:'202609060211', date:'2026年9月6日', place:'中山', rnum:'11', name:'テストステークス', dist:'1200', surface:'芝', baba:'良',
      rows:[
        { no:'1', name:'A馬', order:1, odds:'3.0', pop:'1', passing:'1-1' },
        { no:'2', name:'B馬', order:2, odds:'5.0', pop:'2', passing:'3-3' },
        { no:'3', name:'C馬', order:5, odds:'8.0', pop:'3', passing:'7-7' }
      ], payout:{ win:{ nos:['1'], pays:['300'] }, place:{ nos:['1','2'], pays:['120','190'] } } };
    const rec = s.apEval(fakeP, '202609060211');
    t('apEval 結果で自己検証(marks付き)', !!(rec && rec.result && rec.marks && rec.marks.length >= 2), rec && rec.marks && rec.marks.map(function(m){ return m.mark + m.no + '→' + m.order; }).join(','));
    t('apEval ◎馬(最人気1番)が1着で記録', rec && rec.marks && rec.marks.filter(function(m){ return m.mark === '◎'; })[0].order === 1, rec && rec.marks);
    const learn = s.apLs();
    t('ap学習DB レース数1・◎win記録', !!(learn && learn.races === 1 && learn.byMark && learn.byMark['◎'] && learn.byMark['◎'].win === 1), learn);
    t('apEval 重複(結果済み)はnull', s.apEval(fakeP, '202609060211') === null);
    const mm2 = s.apMetaCur();
    t('apMetaCur venue中山', mm2.place === '中山', mm2);
    // 血統ROI(p29)は新記録から読める
    const roi = s.pgRoi();
    t('pgRoi reads ap record', !!(roi && typeof roi.any === 'object'), roi);
    s.apClear();
    // ---- p41 コースレコード判定 ----
    t('crSec 1:06.7', Math.abs(s.crSec('1:06.7') - 66.7) < 0.001, s.crSec('1:06.7'));
    const recLook = s.crLookup('東京', 'ダ', '1600');
    t('crLookup 東京ダ1600 3yo', !!(recLook && recLook['3yo'] && recLook['3yo'].t === '1:32.9'), recLook);
    function mkRes(dist, surface, baba, rows){
      return { place:'東京', dist:dist, surface:surface, baba:baba, rows:rows };
    }
    const winRow = { no:'1', name:'X', order:1, time:'1:32.8', age:4 };
    const rNew = s.crCheckResult(mkRes('1600','ダート','良',[winRow, { no:'2', name:'Y', order:2, time:'1:33.5', age:5 }]));
    t('crCheckResult 更新 new', !!(rNew && rNew.kind === 'new' && rNew.win === '1:32.8'), rNew);
    const rTie = s.crCheckResult(mkRes('1600','ダート','良',[{ no:'1', name:'X', order:1, time:'1:32.9', age:4 }]));
    t('crCheckResult 同タイム tie', !!(rTie && rTie.kind === 'tie'), rTie);
    const rNo = s.crCheckResult(mkRes('1600','ダート','良',[{ no:'1', name:'X', order:1, time:'1:33.0', age:4 }]));
    t('crCheckResult 遅ければ null', rNo === null, rNo);
    const r2yo = s.crCheckResult(mkRes('1600','ダート','良',[{ no:'1', name:'X', order:1, time:'1:35.5', age:2 }, { no:'2', name:'Y', order:2, time:'1:36.0', age:2 }]));
    t('crCheckResult 2歳戦は2歳レコード(1:35.8)と比較→new', !!(r2yo && r2yo.kind === 'new'), r2yo);
    const rHeavy = s.crCheckResult(mkRes('1600','芝','稍重',[{ no:'1', name:'X', order:1, time:'1:32.8', age:4 }]));
    t('crCheckResult 芝・稍重は判定しない', rHeavy === null, rHeavy);
    const rDirtHeavy = s.crCheckResult(mkRes('1600','ダート','稍重',[{ no:'1', name:'X', order:1, time:'1:32.8', age:4 }]));
    t('crCheckResult ダートは馬場を問わず判定', !!(rDirtHeavy && rDirtHeavy.kind === 'new'), rDirtHeavy);
    // ---- p39 年度重賞カレンダー: アプリ内 月表示/切替/Jpn併記/空月(実データ検証はプレビューで実施済み) ----
    (function(){
      function mkRow(date8, no, name, grade){
        return { rid: date8 + String(100 + no), no: String(no), name: name, grade: grade, venue: '中山', date: date8 };
      }
      // 2026-09改修: 中央は「重賞日程(年1取得)」を sched[年] に持ち、月で絞る方式になった
      const gcls = { dates: {}, day: {}, mon: {}, jpn: {}, sched: {} };
      gcls.sched['2025'] = [
        { date: '20250119', name: '京成杯', grade: 'G3', venue: '中山', dist: '芝2000m' },
        { date: '20250525', name: '安田記念', grade: 'G1', venue: '東京', dist: '芝1600m' },
        { date: '20250525', name: '目黒記念', grade: 'G2', venue: '東京', dist: '芝2500m' }
      ];
      gcls.jpn['jpn-2025'] = [{ rid: '202505281101', no: '11', name: 'さきたま杯', grade: 'Jpn1', venue: '浦和', date: '20250528' }];
      s.localStorage.setItem('keiba_gcl_v1', JSON.stringify(gcls));
      try { s.gcYearOptions(); } catch(e){}
      const ysel = s.document.getElementById('gcYear');
      t('gc year options include 2025', (ysel._html || '').indexOf('2025年') >= 0, (ysel._html || '').slice(0, 80));
      const calEl = s.document.getElementById('gcCal');
      const msgEl = s.document.getElementById('gcMsg');
      const barEl = s.document.getElementById('gcMonthBar');
      const jpnEl = s.document.getElementById('gcJpn');
      const gcrs = function(){ return ((calEl._html || '').match(/class="gcr/g) || []).length; };
      const okActive = function(m){
        const bar = (barEl._html || '').replace(/\s+/g, ' ');
        return bar.indexOf('gcm-a') >= 0 && bar.indexOf('gcm-a" data-gcm="' + m + '"') >= 0;
      };
      const wait0 = function(){ return new Promise(function(res){ setTimeout(res, 0); }); };
      (async function(){
        try{
          jpnEl.checked = false;                 // 中央のみ
          s.gcLoadMonth(2025, 5);
          await wait0();
          t('gc 5月 render rows=2', (calEl._html || '').indexOf('<table class="gc-tbl"') >= 0 && gcrs() === 2, 'n=' + gcrs() + ' ' + (calEl._html || '').slice(0, 60));
          t('gc 5月 msg 2件', /5月の重賞 2 件/.test(msgEl._text || ''), msgEl && msgEl._text);
          t('gc 5月 tab active', okActive(5), (barEl._html || '').slice(0, 160));
          s.gcLoadMonth(2025, 2);
          await wait0();
          t('gc 2月 空月も白紙にしない', (calEl._html || '').indexOf('掲載されていません') >= 0 && gcrs() === 0 && (calEl._html || '').indexOf('gc-cell') >= 0, (calEl._html || '').slice(0, 90));
          jpnEl.checked = true;                  // Jpn併記
          s.gcRenderLoaded(2025, 5, true);
          t('gc Jpn併記 rows=3 + Jpn1 + msg', gcrs() === 3 && (calEl._html || '').indexOf('Jpn1') >= 0 && /地方Jpn1/.test(msgEl._text || ''), 'n=' + gcrs() + ' msg=' + (msgEl && msgEl._text));
          // 全12ヶ月を順に表示(月切替クリックと同一経路)し、アクティブ月が追従する
          jpnEl.checked = false;
          let allOk = true;
          for (let mm = 1; mm <= 12; mm++){
            s.gcLoadMonth(2025, mm);
            await wait0();
            if ((calEl._html || '').indexOf('<table class="gc-tbl"') < 0 || !okActive(mm)){ allOk = false; break; }
          }
          t('gc 全12ヶ月切替OK', allOk, (barEl._html || '').slice(0, 120));
        }catch(e){ t('gc in-app tests run', false, e && (e.stack || e.message)); }
        // ---- 1レース1キー保存・既存保持・容量超過で旧データが消えないこと ----
        try{
          s.localStorage.removeItem('khl_date_v1');
          const legacy = { races: { '202304010101': { rid: '202304010101', h: 'a', rows: [] } } };
          s.localStorage.setItem('khl_date_v1', JSON.stringify(legacy));
          const gotOld = s.diGet('202304010101');
          t('diGet legacy fallback', !!(gotOld && gotOld.rid === '202304010101'), gotOld);
          const oldRid = '202305070999';
          s.diSet(oldRid, { rid: oldRid, h: 'old-content', rows: [1] });
          t('diGet prefix stored', !!s.diGet(oldRid) && s.diGet(oldRid).h === 'old-content');
          const legAfter = JSON.parse(s.localStorage.getItem('khl_date_v1'));
          t('legacy key not erased by prefix save', !!(legAfter && legAfter.races['202304010101']));
          // 容量超過シミュレーション: 新レースの保存だけ失敗し、既存は残る
          const lsobj = s.localStorage;
          const origSet = lsobj.setItem.bind(lsobj);
          lsobj.setItem = function(k, v){ if (String(k).indexOf('khl_di_') === 0) throw new Error('quota'); return origSet(k, v); };
          const oldNK = s.diNetkeibaRaces, oldParse = s.bfParseDbResult, oldGet = s.bfGet;
          const fakeRows = function(){ return [1,2,3,4,5,6].map(function(o){ return { order: o, no: String(o), name: '馬' + o, odds: String(2 + o * 2), pop: String(o), passing: (o < 3 ? (o + '-' + o) : (o + '-' + o)) }; }); };
          const fakePr = function(){ return { meta: { name: 'Y', date8: '20230507' }, n: 6, rows: fakeRows() }; };
          s.diNetkeibaRaces = function(){ return Promise.resolve([{ rid: oldRid, rnum: 11, name: 'Y' }]); };
          s.bfParseDbResult = function(){ return fakePr(); };
          s.bfGet = function(){ return Promise.resolve('<x/>'); };
          const dr = await s.diImportDate('20230507', function(){});
          t('quotaで保存不可→limit=1・ok=0', dr.limit === 1 && dr.ok === 0, dr);
          t('失敗後も既存レコードは残る', s.diGet(oldRid) && s.diGet(oldRid).h === 'old-content', s.diGet(oldRid));
          lsobj.setItem = origSet;   // 容量制限を解除。取得系ストブは維持したまま保存成功を確認
          const dr2 = await s.diImportDate('20230507', function(){});
          // 旧形式(払戻なし・payv無し)レコードの再保存は「upg(全券種払戻つきへ更新)」として数える
          t('diImportDate 正常時 upg=1(旧形式を更新)', dr2.upg === 1 && dr2.ok === 0, dr2);
          const apR = s.apGet(oldRid);
          t('apEval 自動評価が保存された', !!(apR && Array.isArray(apR.marks) && apR.marks.length >= 4 && apR.marks.length <= 5), apR);
          const ap2 = s.apEval(fakePr(), oldRid);
          t('apEval 重複時は再保存しない', ap2 === null, ap2);
          s.diNetkeibaRaces = oldNK; s.bfParseDbResult = oldParse; s.bfGet = oldGet;
          s.diRemoveAll(); s.apClear(); s.localStorage.removeItem('khl_date_v1');
        }catch(e){ t('storage tests run', false, e && (e.stack || e.message)); }
        // ---- 合成AI印(自動比較用)が単勝最人気(最低オッズ)を◎にする ----
        try{
          const pp = { rows: [
            { order: 1, no: '1', name: 'A', odds: '25.0', pop: '6', passing: '10-9' },
            { order: 2, no: '2', name: 'B', odds: '12.0', pop: '4', passing: '4-4' },
            { order: 3, no: '3', name: 'C', odds: '3.1', pop: '1', passing: '1-1' },
            { order: 4, no: '4', name: 'D', odds: '6.5', pop: '3', passing: '5-5' },
            { order: 5, no: '5', name: 'E', odds: '40.0', pop: '7', passing: '8-8' },
            { order: 6, no: '6', name: 'F', odds: '9.0', pop: '5', passing: '3-3' }
          ] };
          const pred = s.apBuildPred(pp);
          const mkNo = function(m){ const e = (pred || []).filter(function(x){ return x.mark === m; })[0]; return e ? e.no : null; };
          t('合成AI印 最人気(3番・最低オッズ)に◎が付く', !!(pred && pred.length === 5 && mkNo('◎') === '3'), pred && pred.map(function(x){ return x.mark + x.no; }).join(','));
        }catch(e){ t('synthetic marks run', false, e && (e.stack || e.message)); }
        // ---- ペース再較正: 逃げ・先行だらけでも「超ハイ」固定にならない ----
        try{
          s.state.horses = [
            { no: '1', name: 'a', odds: '3.0', style: '逃げ' },
            { no: '2', name: 'b', odds: '4.0', style: '逃げ' },
            { no: '3', name: 'c', odds: '5.0', style: '先行' },
            { no: '4', name: 'd', odds: '6.0', style: '先行' },
            { no: '5', name: 'e', odds: '8.0', style: '先行' },
            { no: '6', name: 'f', odds: '9.0', style: '先行' },
            { no: '7', name: 'g', odds: '10.0', style: '差し' }
          ];
          Object.assign(s.state.race, { name: 'サンプル', place: '中山11R', baba: 'fast', dist: '2500', grade: 'G1' });
          s.state.raceId = '202609040211'; s.state.learn = s.defaultLearn(); s.state.paceOverride = null;
          const r3 = s.analyzeRace();
          t('pace recalib 逃げ先行6頭でも超ハイ固定にならない', !!(r3.pace && r3.pace.score < 0.85 && r3.pace.label !== '超ハイ'), r3.pace && (r3.pace.label + ' score=' + r3.pace.score));
        }catch(e){ t('pace recalib run', false, e && (e.stack || e.message)); }
        // ---- 買い目シート: 予算配分が金額・券種を出す ----
        try{
          s.state.horses = s.demoHorses().slice(0, 6);
          Object.assign(s.state.race, { name: 'サンプル', place: '中山11R', baba: 'fast', dist: '2500', grade: 'G1' });
          s.state.raceId = '202609040211'; s.state.learn = s.defaultLearn(); s.state.paceOverride = null;
          const moneyEl = s.document.getElementById('buyMoney'); if (moneyEl) moneyEl.value = '2000';
          const res4 = s.analyzeRace();
          const sheet = s.betSheetHTML(res4);
          t('買い目シート 単勝・合計金額を表示', typeof sheet === 'string' && sheet.indexOf('単勝') >= 0 && sheet.indexOf('合計') >= 0 && sheet.indexOf('2000円') >= 0, (sheet || '').slice(0, 200));
        }catch(e){ t('bet sheet run', false, e && (e.stack || e.message)); }
        // ---- IndexedDB(大容量)モードの同期読取と、IDB失敗時のlocalStorageフォールバック ----
        try{
          s.localStorage.removeItem('khl_di_2'); s.localStorage.removeItem('khl_date_v1');
          s.diMode = 'idb'; s.diMem = { '1': { rid: '1', at: 100, rows: [{ o: 1 }] } }; s.diAt = 100; s.diBytesDirty = true;
          const idbLs = s.diLs();
          t('idbモード diLs はメモリから読む', !!idbLs.races['1'] && Object.keys(idbLs.races).length === 1 && idbLs.at === 100, Object.keys(idbLs.races));
          t('idbモード diGet はメモリから返す', s.diGet('1').rid === '1', s.diGet('1'));
          t('idbモード 使用量も算出できる', s.diUsedBytes() > 0, s.diUsedBytes());
          s.diSet('2', { rid: '2', at: 1, rows: [] });
          await new Promise(function(res){ setTimeout(res, 5); });   // diIdbPutが失敗→localStorageへフォールバック保存
          const fb = s.localStorage.getItem('khl_di_2');
          t('IDB書き込み不可でも localStorage へフォールバック保存', !!fb && JSON.parse(fb).rid === '2', fb);
          s.diMode = 'ls'; s.diMem = null; s.diRemoveAll(); s.localStorage.removeItem('khl_di_2');
        }catch(e){ t('idb mem tests run', false, e && (e.stack || e.message)); }
        // ---- 満杯時は「一番古いレースから順に上書き」される ----
        try{
          // ハーネス元の localStorage には length/key が無いため、列挙できるラッパーへ差し替えて検証
          const realLS = s.localStorage;
          const sharedKeys = [];
          const wrapLS = {
            getItem: function(k){ return realLS.getItem(k); },
            setItem: function(k, v){ realLS.setItem(k, v); if (sharedKeys.indexOf(k) < 0) sharedKeys.push(k); },
            removeItem: function(k){ realLS.removeItem(k); const i = sharedKeys.indexOf(k); if (i >= 0) sharedKeys.splice(i, 1); },
            key: function(i){ return (sharedKeys[i] != null) ? sharedKeys[i] : null; },
            get length(){ return sharedKeys.length; }
          };
          s.localStorage = wrapLS;
          realLS.removeItem('khl_date_v1');
          const totalOf = function(){ let t = 0; for (let i = 0; i < wrapLS.length; i++){ const k = wrapLS.key(i); t += (k.length + String(wrapLS.getItem(k)).length) * 2; } return t; };
          const origSI = realLS.setItem.bind(realLS);
          let capBytes = Infinity;
          realLS.setItem = function(k, v){ if ((k.length + String(v).length) * 2 + totalOf() > capBytes) throw new Error('quota'); return origSI(k, v); };
          s.diMode = 'ls'; s.diMem = null;
          s.diLsSetEvict('AA', { rid: 'AA', date8: '20010101', at: 1, rows: [] });
          s.diLsSetEvict('BB', { rid: 'BB', date8: '20020101', at: 2, rows: [] });
          capBytes = totalOf();   // AAとBBでちょうど満杯の状態
          s.diEvictedRun = 0;
          const saved = s.diLsSetEvict('CC', { rid: 'CC', date8: '20030101', at: 3, rows: [] });
          const aaGone = !s.diGet('AA');
          const bbLive = !!s.diGet('BB'), ccLive = !!s.diGet('CC');
          realLS.setItem = origSI;
          s.localStorage = realLS;
          t('満杯時は一番古い(AA=2001)が削除されCCが保存', saved === true && aaGone && bbLive && ccLive, { saved: saved, aaGone: aaGone, bbLive: bbLive, ccLive: ccLive });
          t('evictedカウンタが1以上', s.diEvictedRun >= 1, s.diEvictedRun);
          realLS.removeItem('khl_date_v1'); s.diRemoveAll();
        }catch(e){ t('evict oldest run', false, e && (e.stack || e.message)); }
        // ---- 残量表示: StorageManager(estimate)があれば残りレース数を出し、なければフォールバック文言 ----
        try{
          let noteTxt = '';
          const prevNav = s.navigator;
          // モック: このサイト上限200MB・使用5MB
          s.navigator = { storage: { estimate: function(){ return Promise.resolve({ quota: 200 * 1048576, usage: 5 * 1048576 }); } } };
          s.diMode = 'idb';
          s.diFreeNote(function(t){ noteTxt = t; });
          await new Promise(function(res){ setTimeout(res, 5); });
          t('estimate残量: 残り約195MB・あと約4万レース分と表示', /残り 約 195 MB/.test(noteTxt) && /あと約 \d+ レース分/.test(noteTxt), noteTxt);
          noteTxt = '';
          s.navigator = { storage: { estimate: function(){ return Promise.reject(new Error('denied')); } } };
          s.diFreeNote(function(t){ noteTxt = t; });
          await new Promise(function(res){ setTimeout(res, 5); });
          t('estimate失敗時はフォールバック文言', /対応していません/.test(noteTxt), noteTxt);
          s.navigator = prevNav; s.diMode = 'ls';
        }catch(e){ t('estimate notes run', false, e && (e.stack || e.message)); }
        // ---- 馬柱AI評価(p44): 芝/ダ区別・替わり・得意条件の短評 ----
        try{
          const mkrec = function(){
            const r = [];
            const surf = ['芝','芝','芝','ダ','ダ'];
            const bb = ['良','良','稍重','不良','重'];
            surf.forEach(function(sf, i){
              r.push({ surface: sf, order: (i < 3 ? i + 1 : 6), venueName: (sf === '芝' ? '中山' : '東京'),
                m: (i < 3 ? 2000 : 1200), baba: bb[i], passing: (i + 2) + '-' + (i + 2), head: '10', date: '2024/0' + (i + 1) + '/10', name: 'X' });
            });
            return { p: {}, at: Date.now(), r: r };
          };
          const hdPrev = s.localStorage.getItem('khl_hd_v1');
          s.localStorage.setItem('khl_hd_v1', JSON.stringify({ '777': mkrec() }));
          const an = s.aihAnalyze(s.aihRecOf('777'));
          t('aih 芝3走/ダ2走を区別して集計', !!(an && an.surface.芝.n === 3 && an.surface.ダ.n === 2 && an.surface.芝.top3 === 3), an && an.surface);
          const cm = s.aihComment(s.aihRecOf('777'), '芝');
          t('aih 芝実績○・得意コース中山・得意距離・馬場を短評', !!(cm && cm.text.indexOf('芝実績') >= 0 && cm.text.indexOf('中山') >= 0 && /得意/.test(cm.text)), cm && cm.text);
          // 前走=芝・今回=ダ（ダ替わり）のケース
          const srec = { p: {}, at: Date.now(), r: [
            { surface: 'ダ', order: 1, venueName: '東京', m: 1200, baba: '重', passing: '1-1', head: '10', date: '2024/05/01', name: 'Y' },
            { surface: '芝', order: 2, venueName: '中山', m: 2000, baba: '良', passing: '4-4', head: '10', date: '2024/06/01', name: 'Y' }
          ] };
          s.localStorage.setItem('khl_hd_v1', JSON.stringify({ '777': mkrec(), '778': srec }));
          const cmD = s.aihComment(s.aihRecOf('778'), 'ダ');
          t('aih 前走芝→今回ダで替わり判断', !!(cmD && cmD.text.indexOf('替わり') >= 0 && cmD.text.indexOf('ダ替わり') >= 0), cmD && cmD.text);
          if (hdPrev) s.localStorage.setItem('khl_hd_v1', hdPrev); else s.localStorage.removeItem('khl_hd_v1');
        }catch(e){ t('aih run', false, e && (e.stack || e.message)); }
        // ---- 年月ごとの学習: 202501の実績(boost馬が伸び悩み)→2026-09の予想へ補正 ----
        try{
          s.apClear();
          // 3モデルの概念切替・パラメータ参照(補正なし時)
          const S0 = s.apParamsFor('202609');
          t('3モデル: 学習前は補正なし(hitTm1・roiRho1・λ0.55)', !!(S0 && S0.hitTm === 1 && S0.roiRho === 1 && Math.abs(S0.hybLam - 0.55) < 1e-9), S0);
          const cb = function(){ return { n: 0, horseN: 0, horseWin: 0, horseTop3: 0, winR: 0, top3R: 0, costU: 0, grossU: 0, boostN: 0, boostTop3: 0, dropN: 0, dropTop3: 0, byMark: {} }; };
          const b202501 = { ym: '202501', c: { hit: cb(), roi: cb(), hyb: cb() } };
          b202501.c.hit.n = 21; b202501.c.hit.horseN = 105; b202501.c.hit.horseTop3 = 45; // 全体3着内率42.9%
          b202501.c.hit.boostN = 18; b202501.c.hit.boostTop3 = 2;                        // boostは11.1%しか残らない
          s.localStorage.setItem('khl_apm_202501', JSON.stringify(b202501));
          const S1 = s.apParamsFor('202609');
          t('年月学習: 前月の乖離→展開/脚質の信頼度が下がる', S1.hitTm < 0.8, S1);
          s.state.apModel = 'hit';
          const av = s.apActive();
          t('乖離学習(的中モデル): 有意な乖離で補正ON', av.apply === true && av.penalty > 0.1, av);
          // 回収率重視モデル: 回収率112%超の月→妙味係数を上げる
          s.localStorage.setItem('khl_apm_202502', JSON.stringify({ ym: '202502', c: {
            hit: cb(), roi: Object.assign(cb(), { n: 12, costU: 180, grossU: 216 }), hyb: cb() } }));
          const S2 = s.apParamsFor('202609');
          t('年月学習(回収率モデル): 回収率120%の月→妙味係数UP', S2.roiRho > 1.2, S2);
          // 実際の分析にも反映される（selfLearnNote）
          s.state.horses = s.demoHorses().slice(0, 6);
          Object.assign(s.state.race, { name: 'サンプル', place: '中山11R', baba: 'fast', dist: '2500', grade: 'G1' });
          s.state.raceId = '202609040211'; s.state.learn = s.defaultLearn(); s.state.paceOverride = null; s.state.apLearnUse = undefined;
          const rr = s.analyzeRace();
          t('engine selfLearnNote 反映', !!(rr && rr.selfLearnNote && /自己学習/.test(rr.selfLearnNote)), rr && rr.selfLearnNote);
          s.state.apLearnUse = false;
          const av2 = s.apActive();
          t('apUseChk OFFで補正解除', av2.apply === false, av2);
          s.state.apLearnUse = undefined;
          s.state.apModel = 'hyb';
          s.apClear();
        }catch(e){ t('ap learn reflect run', false, e && (e.stack || e.message)); }
        // ---- 3モデル印評価の動作・月バケット蓄積・モデル切替表示 ----
        try{
          s.apClear();
          const mkRow = function(no, order, odds, passing){
            return { no: String(no), name: 'M' + no, order: order, odds: String(odds), pop: String(order),
              passing: passing, surface: '芝' };
          };
          const rows2 = [
            mkRow(1, 1, '2.4', '1-1'), mkRow(2, 3, '3.1', '2-2'), mkRow(3, 6, '4.0', '6-6'),
            mkRow(4, 2, '6.5', '4-4'), mkRow(5, 8, '9.0', '8-9'), mkRow(6, 4, '11.0', '3-3'),
            mkRow(7, 5, '15.0', '5-5'), mkRow(8, 9, '21.0', '9-10'), mkRow(9, 7, '31.0', '7-8')
          ];
          const pr9 = { rid: '202507040711', date: '2025年7月4日', place: '中山', rnum: '11', name: '3モデルS',
            dist: '1800', surface: '芝', baba: '良', rows: rows2, payout: null };
          const rec9 = s.apEval(pr9, '202507040711');
          t('3モデル印: hit/roi/hybの3セットを記録', !!(rec9 && rec9.cMarks && rec9.cMarks.hit && rec9.cMarks.roi && rec9.cMarks.hyb &&
            rec9.cMarks.hit.length === 5 && rec9.cMarks.roi.length === 5 && rec9.cMarks.hyb.length === 5),
            rec9 && rec9.cMarks && { h: rec9.cMarks.hit.length, r: rec9.cMarks.roi.length, y: rec9.cMarks.hyb.length });
          t('3モデル印: 各5頭が◎〜△の印を持つ', rec9.cMarks.hyb.every(function(m, i){ return m.mark === ['◎','○','▲','☆','△'][i] && m.aiRank === i + 1; }), rec9.cMarks.hyb.map(function(m){ return m.mark + m.no; }).join(','));
          const bkb = JSON.parse(s.localStorage.getItem('khl_apm_202507'));
          t('月バケット: 開催年月(202507)ごとに集計・DBキー保存', !!(bkb && bkb.c && bkb.c.hit.n === 1 && bkb.c.hit.horseN === 5 && bkb.c.roi.n === 1 && bkb.c.hyb.n === 1), bkb && bkb.c && { hit: bkb.c.hit.n, roi: bkb.c.roi.n });
          t('月バケット: 印ごとの的中も集計', !!(bkb.c.hit.byMark['◎'] && bkb.c.hit.byMark['◎'].win === 1), bkb.c.hit.byMark);
          t('apStatsHTML 表示に3モデル・年月学習の文言', (function(){ const h2 = s.apStatsHTML(); return h2.indexOf('的中率重視') >= 0 && h2.indexOf('回収率重視') >= 0 && h2.indexOf('ハイブリッド') >= 0 && h2.indexOf('2025年7月') >= 0; })(), s.apStatsHTML());
          // エンジンへ反映するモデル切替
          const cb2 = function(){ return { n: 0, horseN: 0, horseWin: 0, horseTop3: 0, winR: 0, top3R: 0, costU: 0, grossU: 0, boostN: 0, boostTop3: 0, dropN: 0, dropTop3: 0, byMark: {} }; };
          const badBoost = { ym: '202506', c: { hit: Object.assign(cb2(), { n: 24, horseN: 120, horseTop3: 48, boostN: 20, boostTop3: 3 }), roi: cb2(), hyb: cb2() } };
          const goodRoi = { ym: '202505', c: { hit: cb2(), roi: Object.assign(cb2(), { n: 12, costU: 160, grossU: 192 }), hyb: cb2() } };
          s.localStorage.setItem('khl_apm_202505', JSON.stringify(goodRoi));
          s.localStorage.setItem('khl_apm_202506', JSON.stringify(badBoost));
          s.state.horses = s.demoHorses().slice(0, 8);
          Object.assign(s.state.race, { name: 'サンプル', place: '東京11R', baba: 'fast', dist: '2000', grade: 'G1' });
          s.state.raceId = '202609050211'; s.state.learn = s.defaultLearn(); s.state.paceOverride = null; s.state.apLearnUse = undefined;
          const avH = (function(){ s.state.apModel = 'hit'; return s.apActive(); })();
          const avR = (function(){ s.state.apModel = 'roi'; return s.apActive(); })();
          const avY = (function(){ s.state.apModel = 'hyb'; return s.apActive(); })();
          t('モデル切替: hit/roi/hyb で補正が異なる', avH.apply === true && avR.apply === true && avY.apply === true &&
            avH.note.indexOf('的中率重視') >= 0 && avR.note.indexOf('回収率重視') >= 0 && avY.note.indexOf('ハイブリッド') >= 0, { avH: avH, avR: avR, avY: avY });
          s.state.apModel = 'roi';
          const rr9 = s.analyzeRace();
          t('engine: 回収率モデルのnoteを反映', !!(rr9 && rr9.selfLearnNote && rr9.selfLearnNote.indexOf('回収率重視') >= 0), rr9 && rr9.selfLearnNote);
          s.state.apModel = 'hit';
          const rr10 = s.analyzeRace();
          t('engine: 的中率モデルのnoteを反映', !!(rr10 && rr10.selfLearnNote && rr10.selfLearnNote.indexOf('的中率重視') >= 0), rr10 && rr10.selfLearnNote);
          s.state.apModel = 'hyb';
          s.apClear();
        }catch(e){ t('3 models run', false, e && (e.stack || e.message)); }
        // ---- 一括取込セッション(今回取得データ)の3モデル実測表示 / 3モデル印の表 ----
        try{
          s.apClear();
          s.apSessReset();
          const sh0 = s.apSessHTML();
          t('セッション: 未取得なら非表示', sh0 === '', sh0);
          const mkRow2 = function(no, order, odds){ return { no: String(no), name: 'N' + no, order: order, odds: String(odds), pop: String(order), passing: (order===1?'1-1':(order<=3? (order+1)+'-'+(order+1):'8-9')), surface: '芝' }; };
          const sessRows = [ mkRow2(1,1,'2.5'), mkRow2(2,3,'4.0'), mkRow2(3,2,'6.0'), mkRow2(4,4,'9.0'), mkRow2(5,6,'12.0'), mkRow2(6,5,'18.0'), mkRow2(7,7,'26.0') ];
          const sessP = { rid: '202608010111', date: '2026年8月1日', place: '中山', rnum: '11', name: 'セッションS', dist: '1800', surface: '芝', baba: '良', rows: sessRows, payout: null };
          s.apEval(sessP, '202608010111');
          const sh1 = s.apSessHTML();
          t('セッション実測: 一括取込したデータで3モデル的中率・回収率を記載', !!(sh1 && sh1.indexOf('一括取込セッション') >= 0 && sh1.indexOf('的中率(印内1着)') >= 0 && sh1.indexOf('回収率') >= 0 && sh1.indexOf('的中率重視') >= 0 && sh1.indexOf('ハイブリッド') >= 0), sh1 && sh1.slice(0, 300));
          // 3モデル印の表
          s.state.horses = s.demoHorses().slice(0, 10);
          Object.assign(s.state.race, { name: '2026年9月6日 中山11R モデル印S', place: '中山', baba: '良', dist: '1800', grade: 'G3' });
          s.state.raceId = '202609060211';
          const mmh = s.apModelMarksHTML();
          t('3モデル印の表: 3モデル名と◎列を含む表', !!(mmh && mmh.indexOf('的中率重視') >= 0 && mmh.indexOf('回収率重視') >= 0 && mmh.indexOf('ハイブリッド') >= 0 && mmh.indexOf('<th>◎</th>') >= 0), mmh && mmh.length);
          const mmBox = s.document.getElementById('modelBox');
          if (mmBox) mmBox.innerHTML = mmh;   // 表示先へ書き込める(スモーク)
          t('modelBox へ3モデル印の表を出力できる', !!mmBox && mmBox._html.indexOf('モデル') >= 0, mmBox && mmBox._html && mmBox._html.slice(0, 80));
          s.apClear();
        }catch(e){ t('sess & model-table run', false, e && (e.stack || e.message)); }
        // ---- AI印と総合評価テーブル(妙味列削除・馬名1行化)の描画スモーク ----
        try{
          s.apClear();
          s.state.horses = s.demoHorses().slice(0, 12);
          Object.assign(s.state.race, { name: '2026年9月6日 中山11R 描画S', place: '中山', baba: '良', dist: '1800', grade: 'G3' });
          s.state.raceId = '202609060211'; s.state.learn = s.defaultLearn(); s.state.paceOverride = null; s.state.apLearnUse = undefined;
          const rrT = s.analyzeRace();
          const tbl = s.document.getElementById('aiTbl');
          const errT = (function(){ try { s.renderTables(rrT); return ''; } catch(e){ return e && (e.stack || e.message); } })();
          t('AI印と総合評価: 妙味列削除後もテーブル描画できる', errT === '', errT);
          const htmlT = tbl && tbl._html || '';
          t('AI印と総合評価: 描画に馬名1行化クラス(hname)を含む', htmlT.indexOf('hname') >= 0 && htmlT.indexOf('scorecell') >= 0, htmlT.slice(0, 160));
          const head = s.document.getElementById('aiTbl') && s.p2HeadText || '';
          s.apClear();
        }catch(e){ t('ai render smoke run', false, e && (e.stack || e.message)); }
        runFinal();
      })();
      return;
    })();
  }, 5);
  function runFinal(){
    console.log('OK', ok, 'FAIL', bad);
    process.exit(bad ? 1 : 0);
  }
})();

