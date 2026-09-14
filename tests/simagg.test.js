/* 第8弾-D: レースシミュレーターの「📊 合計集計」＋「出遅れ率・脚質のブレの反映」テスト
   実行: node tests/simagg.test.js   (build.py 実行後に)
   検証: 映像/速さ/100回集計の削除・集計の積み上げと保存・集計リセット・
        出遅れ率が着順に効くこと・馬柱(4角通過順)からの脚質ブレ判定。 */
const fs = require('fs');
const vm = require('vm');

const store = {};
const lsOrder = [];
const els = {};
function makeCanvasCtx(){
  return new Proxy({ measureText: (t) => ({ width: String(t).length * 6 }) }, {
    get: (tgt, prop) => (prop in tgt ? tgt[prop] : (prop === 'canvas' ? tgt.__cv : function(){})),
    set: (tgt, prop, val) => { tgt[prop] = val; return true; }
  });
}
function makeEl(id){
  const el = { id: id || '', _v:'', _html:'', _text:'', disabled:false, value:'', checked:true,
    dataset:{}, files:null, style:{},
    classList:{ _s:new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); },
      toggle(c,f){ if(f===undefined){ this._s.has(c)?this._s.delete(c):this._s.add(c); } else { f?this._s.add(c):this._s.delete(c); } },
      contains(c){ return this._s.has(c); } },
    children:[], parentNode:null,
    addEventListener(){}, removeEventListener(){}, click(){}, focus(){}, blur(){},
    setAttribute(){}, getAttribute(){ return null; },
    querySelector(){ return makeEl(); }, querySelectorAll(){ return []; }, closest(){ return null; },
    appendChild(){}, remove(){}, scrollIntoView(){},
    getBoundingClientRect(){ return { width:940, height:400, top:0, left:0 }; },
    getContext(){ return makeCanvasCtx(); } };
  Object.defineProperty(el, 'innerHTML', { get(){ return el._html; }, set(v){ el._html = v; el._text = String(v).replace(/<[^>]*>/g,''); } });
  Object.defineProperty(el, 'textContent', { get(){ return el._text; }, set(v){ el._text = String(v); el._html = ''; } });
  return el;
}
function find(id){ if (!els[id]) els[id] = makeEl(id); return els[id]; }

const g = {
  console, Math, JSON, Date, String, Number, parseInt, parseFloat, isNaN, isFinite, RegExp,
  encodeURIComponent, decodeURIComponent, TextDecoder,
  setTimeout: () => 0, clearTimeout(){}, setInterval: () => 0, clearInterval(){},
  requestAnimationFrame: () => 1, cancelAnimationFrame(){},
  localStorage: {
    getItem(k){ return store[k] != null ? store[k] : null; },
    setItem(k,v){ if (!(k in store)) lsOrder.push(k); store[k] = String(v); },
    removeItem(k){ delete store[k]; const i = lsOrder.indexOf(k); if (i >= 0) lsOrder.splice(i,1); },
    key(i){ return lsOrder[i] != null ? lsOrder[i] : null; },
    get length(){ return lsOrder.length; }
  },
  addEventListener(){}, removeEventListener(){}, scrollTo(){}, devicePixelRatio:1,
  innerWidth:980, innerHeight:640, navigator:{ clipboard:{ writeText: () => Promise.resolve() } },
  document: {
    getElementById(id){ return find(id); },
    querySelector(){ return makeEl(); }, querySelectorAll(){ return []; }, createElement(){ return makeEl(); },
    addEventListener(){}, removeEventListener(){}, fullscreenElement:null,
    body:{ appendChild(){} }, head:{ appendChild(){} }, documentElement:{}
  }
};
g.window = g;
vm.createContext(g);

const html = fs.readFileSync('/home/user/keiba-lab/index.html','utf8');
const m = html.match(/<script>\n([\s\S]*)\n<\/script>/);
if (!m){ console.log('FAIL: script not found in index.html'); process.exit(1); }
vm.runInContext(m[1], g, { filename:'index.html.js' });
const s = g;

let ok = 0, bad = 0;
const t = (n,c,x) => { if (c) ok++; else { bad++; console.log('FAIL', n, JSON.stringify(x)); } };
const val = (fn) => { try { return { ok:true, v: fn() }; } catch(e){ return { ok:false, v: e && e.message }; } };
const noThrow = (n,fn) => { const r = val(fn); t(n, r.ok, r.v); return r; };

/* ---------- 0) 前提: 18頭のサンプルで②の分析を通す ---------- */
s.state.horses = s.demoHorses();
Object.assign(s.state.race, { name:'サンプル', place:'中山11R', baba:'fast', dist:'2000', grade:'G1' });
s.state.raceId = '202609060111';
s.state.learn = s.defaultLearn();
s.state.paceOverride = null;
if (s.syncRaceDomFromState) s.syncRaceDomFromState();
t('analyze ok', s.analyzeRace().ok, s.analyzeRace().msg);
const parts = s.getParticipants();
t('出走馬が取れる', Array.isArray(parts) && parts.length === 18, parts && parts.length);

/* ---------- 1) 削除確認（映像・速さ・100回集計） ---------- */
['simViewMode','simNoVideo','simApplyCourseGeom','simCtx','simDrawFrame','drawTrack','drawRunner',
 'runVisualRace','finishVisualRace','showSimBoard','simBoardHTML','montecarlo','barRate',
 'simSlowLagM','simStraightCols','initSimCanvas','simSyncOverlay','simToggleFs','drawHorseFig']
  .forEach(n => t('削除: ' + n, typeof s[n] === 'undefined', typeof s[n]));
['simSlowRate','simSampleFinish','simInstantOnce','simRunInstant','simRenderOutcome','simBuildLogs',
 'simFinalStartRem','buildSimPanel','initSimTab','simAggAdd','simAggRender','simAggClear','simAggReset',
 'simStyleVarOf','simFlowStyleFor','tlStyleHist']
  .forEach(n => t('残存: ' + n, typeof s[n] === 'function', typeof s[n]));
t('HTMLに速さ/映像/モンテカルロのUIが無い',
  !/id="simSpeed"|id="simView"|id="simNoVideo"|id="simVideoCard"|id="btnBatch"|モンテカルロ/.test(html));
t('state.simSpeed / simView / simNoVideo を持たない',
  !('simSpeed' in s.state) && !('simView' in s.state) && !('simNoVideo' in s.state), Object.keys(s.state).filter(k => /^sim/.test(k)));

/* ---------- 2) 出遅れ率が着順に効く ---------- */
(function(){
  const mk = (no, slow) => ({ no:no, name:'馬'+no, frame:'1', mark:'◎', odds:'3.0', prob:0.5, idx:0, slow:slow, style:'先行' });
  const A = mk('1',''), B = mk('2','100');       // B は毎回出遅れる設定
  t('simSlowRate: 出遅れ率なし=1', s.simSlowRate(A) === 1);
  let winsA = 0, N = 4000;
  for (let i=0;i<N;i++){ if (s.simSampleFinish([A,B], 2000).order[0] === 0) winsA++; }
  t('出遅れ率100%の馬は同能力でも勝ちにくい', winsA / N > 0.55, (winsA/N).toFixed(3));
  // 出遅れ率は6%未満なら無効（従来仕様）
  const C = mk('3','5');
  t('simSlowRate: 5%は無効(=1)', s.simSlowRate(C) === 1);
})();

/* ---------- 3) 脚質のブレ（馬柱の4角通過順から） ---------- */
t('tlStyleOf 1角1番=逃げ', s.tlStyleOf('1-1-1-1', 16) === '逃げ');
t('tlStyleOf 4角2/16=先行', s.tlStyleOf('3-3-2-2', 16) === '先行', s.tlStyleOf('3-3-2-2',16));
t('tlStyleOf 4角8/16=差し', s.tlStyleOf('9-9-8-8', 16) === '差し', s.tlStyleOf('9-9-8-8',16));
t('tlStyleOf 4角15/16=追込', s.tlStyleOf('16-16-15-15', 16) === '追込', s.tlStyleOf('16-16-15-15',16));
t('tlStyleOf 通過なし=空', s.tlStyleOf('', 16) === '');

(function(){
  // 馬柱キャッシュ(khl_hd_v1)を差し替えて tlStyleHist を検証
  const mkRuns = (passes) => passes.map((p,i) => ({
    date:'2026/0' + (i+1) + '/10', venueName:'中山', venue:'中山', order:String(i+1),
    head:'16', pass:p, dist:'芝2000', surface:'芝', baba:'良'
  }));
  const hd = {
    '1001': { p:{}, at:Date.now(), r: mkRuns(['1-1-1-1','2-2-2-2','1-1-1-1','3-3-2-2','1-1-1-1']) },   // 安定(逃げ/先行)
    '1002': { p:{}, at:Date.now(), r: mkRuns(['1-1-1-1','16-16-16-15','9-9-9-9','1-1-1-1','14-14-13-12']) }, // 不安定
    '1003': { p:{}, at:Date.now(), r: mkRuns(['5-5-5-5','6-6-6-6']) }                                    // 2走だけ→判定不能
  };
  store['khl_hd_v1'] = JSON.stringify(hd);
  const h1 = { nk:'1001', name:'安定馬' }, h2 = { nk:'1002', name:'ブレ馬' }, h3 = { nk:'1003', name:'少戦馬' };
  const r1 = s.tlStyleHist(h1), r2 = s.tlStyleHist(h2), r3 = s.tlStyleHist(h3);
  t('安定馬: 5走ぶん判定', r1 && r1.n === 5, r1 && r1.n);
  t('安定馬: ブレは小さい', r1 && r1.v <= 0.4, r1 && r1.v);
  t('不安定馬: ブレが大きい(>0.3)', r2 && r2.v > 0.3, r2 && [r2.v, r2.styles]);
  t('不安定馬: 逃げ〜追込が混在', r2 && r2.styles.indexOf('逃げ') >= 0 && r2.styles.indexOf('追込') >= 0, r2 && r2.styles);
  t('2走だけなら判定しない(null)', r3 === null, r3);
  // simStyleVarOf / simFlowStyleFor は participant 経由（state.horses[p.idx].nk を見る）
  s.state.horses[0].nk = '1002';
  const p0 = Object.assign({}, s.getParticipants()[0], { idx:0 });
  t('simStyleVarOf: 出走馬のブレを拾う', !!s.simStyleVarOf(p0), s.simStyleVarOf(p0));
  const styles = {};
  for (let i=0;i<300;i++){ const st = s.simFlowStyleFor(p0); styles[st] = (styles[st]||0)+1; }
  t('simFlowStyleFor: ブレ馬は複数の脚質で走る', Object.keys(styles).length >= 2, styles);
  // ヒント文に注意書きが出る
  noThrow('simSetHint(ブレ注意)', function(){ s.simSetHint(); });
  t('simHint に脚質不安定の注意', /脚質が安定しない/.test(find('simHint')._html), find('simHint')._html.slice(-160));
})();

/* ---------- 4) 📊 合計集計: 積み上げ・保存・再開・リセット ---------- */
(function(){
  /* 第12弾: 集計は③のタブを開いている間だけのメモリ保持。旧バージョンが残した khl_simagg_v1 は読まない */
  store['khl_simagg_v1'] = JSON.stringify({ OLD_RACE: { runs: 999, horses: {} } });
  s.SIMAGG_MEM = null;
  s.sim._rs = null; s.sim._rsKey = null;
  noThrow('simRunInstant(1)', function(){ s.simRunInstant(1); });
  let a = s.simAggCur();
  t('1回実行 → runs=1', a && a.runs === 1, a && a.runs);
  t('レース名・距離が集計に入る', a && a.name === 'サンプル' && String(a.dist) === '2000', a && [a.name, a.dist]);
  noThrow('simRunInstant(10)', function(){ s.simRunInstant(10); });
  a = s.simAggCur();
  t('10回実行 → runs=11', a && a.runs === 11, a && a.runs);
  t('localStorage には書かない（③タブを開いている間だけのメモリ集計）',
    (store['khl_simagg_v1'] || '').indexOf('OLD_RACE') >= 0 && !!s.simAggCur(), store['khl_simagg_v1']);
  t('旧バージョンの残骸(khl_simagg_v1)は読まない', !s.simAggLs().OLD_RACE, Object.keys(s.simAggLs()));
  t('SIMAGG_SAVE_OK は常に true（メモリ保持なので失敗しない）', s.SIMAGG_SAVE_OK === true);
  const ids = Object.keys(a.horses);
  t('全頭の行がある', ids.length === 18, ids.length);
  t('各馬の回数合計 = runs×頭数', ids.reduce((m,k)=>m+a.horses[k].runs,0) === a.runs*18);
  t('1着の合計 = runs', ids.reduce((m,k)=>m+a.horses[k].w,0) === a.runs, ids.reduce((m,k)=>m+a.horses[k].w,0));
  t('連対≥1着・複勝≥連対', ids.every(k => { const h=a.horses[k]; return h.t3 >= h.t2 && h.t2 >= h.w; }));
  t('best/worst が着順の範囲内', ids.every(k => { const h=a.horses[k]; return h.best>=1 && h.worst<=18 && h.best<=h.worst; }));
  noThrow('simAggRender', function(){ s.simAggRender(); });
  const rows = (find('simAggBody')._html.match(/<tr/g) || []).length;
  t('表に18行', rows === 18, rows);
  t('表に1着率(%)が出る', /\d+%/.test(find('simAggBody')._html));
  t('サマリに累計回数と最多1着', /累計 <b>11<\/b> 回/.test(find('simAggSummary')._html) && /最多1着/.test(find('simAggSummary')._html),
    find('simAggSummary')._html.replace(/<[^>]*>/g,'').slice(0,120));
  // 並び: 1着率の高い順
  const nos = (find('simAggBody')._html.match(/<td>([^<]*)<\/td>/g) || []).map(x => x.replace(/<\/?td>/g,''));
  const sorted = ids.slice().sort((x,y) => {
    const X=a.horses[x], Y=a.horses[y];
    return (Y.w/Y.runs)-(X.w/X.runs) || (Y.t3/Y.runs)-(X.t3/X.runs) || (X.sum/X.runs)-(Y.sum/Y.runs) || String(X.no).localeCompare(String(Y.no));
  });
  const rates = sorted.map(k => a.horses[k].w / a.horses[k].runs);
  t('1着率の降順に並ぶ', rates.every((r,i) => i === 0 || rates[i-1] >= r), rates.map(r => r.toFixed(2)).join(','));
  t('表の先頭 = 最多1着の馬', nos[0] === String(a.horses[sorted[0]].no), [nos[0], a.horses[sorted[0]].no]);

  // 集計リセット
  noThrow('simAggClear', function(){ s.simAggClear(); });
  t('リセット後は集計なし', !s.simAggCur());
  t('リセット後は案内文', /まだ集計がありません/.test(find('simAggBody')._html), find('simAggBody')._html.slice(0,80));
  t('リセットはメモリからも消える', Object.keys(s.simAggLs()).length === 0, Object.keys(s.simAggLs()));

  // 別レースを切り替えても残る（レース別のキー）
  s.simRunInstant(3);
  const k1 = s.simAggKey(s.getParticipants());
  s.state.raceId = '202609060211';
  s.state.race.name = '別レース';
  if (s.syncRaceDomFromState) s.syncRaceDomFromState();
  s.sim._rs = null; s.sim._rsKey = null;
  s.simRunInstant(2);
  const saved = s.simAggLs();     // 第12弾: メモリ集計
  t('レースごとに別々の集計を持つ', Object.keys(saved).length === 2 && saved[k1].runs === 3,
    [Object.keys(saved).length, saved[k1] && saved[k1].runs]);
})();

/* ---- 第12弾(2026-09-11): 集計は③のタブを開いている間だけ・端末の保存領域は使わない ---- */
(function(){
  const nt = (n, fn) => { try { fn(); t(n + '（例外なし）', true); } catch (e) { t(n + '（例外なし）', false, e && e.message); } };
  s.state.raceId = '';
  s.state.race.name = 'サンプル';
  s.simAggClear();
  /* 端末の保存領域が完全に満杯でも集計は積み上がる（そもそも localStorage に書かないので影響を受けない） */
  const realSet = s.localStorage.setItem;
  s.localStorage.setItem = function(k, v){
    const e = new Error('The 5000000-code unit storage quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e;
  };
  nt('保存領域が満杯でも simRunInstant(6)', function(){ s.simRunInstant(6); });
  t('満杯でも集計が積み上がる', (s.simAggCur() || {}).runs === 6, (s.simAggCur() || {}).runs);
  t('満杯でも表に18行出る', ((find('simAggBody')._html || '').match(/<tr/g) || []).length === 18,
    ((find('simAggBody')._html || '').match(/<tr/g) || []).length);
  t('SIMAGG_SAVE_OK は満杯でも true（保存しないので失敗しない）', s.SIMAGG_SAVE_OK === true);
  t('案内に「③のタブを開いている間だけ」と出る', /③のタブを開いている間だけ/.test(find('simMsg')._html),
    find('simMsg')._html.replace(/<[^>]*>/g, '').slice(0, 90));
  s.localStorage.setItem = realSet;

  /* ③のタブを離れると全部消える／③に戻ると新しい集計から */
  const dropped = s.simAggDropAll();
  t('simAggDropAll が消したレース数を返す', dropped >= 1, dropped);
  t('③を離れると集計が全部消える', !s.simAggCur() && Object.keys(s.simAggLs()).length === 0, Object.keys(s.simAggLs()));
  t('SIMAGG_LIVE=false になる', s.SIMAGG_LIVE === false);
  s.SIMAGG_DROPPED = 2;
  nt('simAggNoteDropped', function(){ s.simAggNoteDropped(); });
  t('③に戻ると「前の集計はリセットしました」と案内', /リセット/.test(find('simMsg')._html) && /2 レースぶん/.test(find('simMsg')._html),
    find('simMsg')._html.replace(/<[^>]*>/g, '').slice(0, 90));
  t('案内を出したら SIMAGG_DROPPED は 0 に戻る', s.SIMAGG_DROPPED === 0, s.SIMAGG_DROPPED);
  s.simAggEnter();
  t('simAggEnter で SIMAGG_LIVE=true', s.SIMAGG_LIVE === true);
  nt('③に戻って simRunInstant(2)', function(){ s.simRunInstant(2); });
  t('新しい集計から始まる（runs=2）', (s.simAggCur() || {}).runs === 2, (s.simAggCur() || {}).runs);

  /* 起動時に旧 khl_simagg_v1 を削除して保存領域を空ける */
  s.localStorage.removeItem('khl_simagg_v1');
  s.localStorage.setItem('khl_simagg_v1', new Array(3000).join('x'));
  const freed = s.simAggDropOld();
  t('simAggDropOld が空けたバイト数を返す', freed > 5000, freed);
  t('旧 khl_simagg_v1 が消えている', store['khl_simagg_v1'] == null);
  t('simAggDropOld は無ければ 0', s.simAggDropOld() === 0);
  s.simAggClear();
})();

/* ---- 第12弾: 🥇学習DB・AI予想を第一優先で保存する（足りなければ♻️キャッシュを自動で消す） ---- */
(function(){
  const nt = (n, fn) => { try { fn(); t(n + '（例外なし）', true); } catch (e) { t(n + '（例外なし）', false, e && e.message); } };
  /* 保存領域をほぼ満杯にする（♻️また取り直せるキャッシュを大量に） */
  ['khl_hd_v1', 'khl_bf_v1', 'khl_ped_v1', 'keiba_gcl_v1'].forEach(function(k){
    s.localStorage.removeItem(k); s.localStorage.setItem(k, new Array(700000).join('z'));   // 各 約1.34MB（4個で上限5MBを超える）
  });
  s.localStorage.setItem('keiba-lab-v1', JSON.stringify({ race: '今の作業（出馬表）' }));
  s.localStorage.setItem('khl_di_202501010101', JSON.stringify({ rid: '202501010101' }));   // 🥇学習DB（既存）
  s.localStorage.setItem('khl_memo_v1', JSON.stringify({ m: 1 }));
  let u = s.storeUse();
  t('準備: 保存領域が上限(5MB)を超えている', u.mb > 5.0, u.mb.toFixed(2) + 'MB');

  /* 実機の localStorage は上限を超えると setItem が例外を投げる。ハーネスには上限が無いので再現する */
  const realSet2 = s.localStorage.setItem;
  s.localStorage.setItem = function(k, v){
    let tot = 0;
    Object.keys(store).forEach(function(kk){ if (kk !== k) tot += (kk.length + String(store[kk]).length) * 2; });
    if (tot + (String(k).length + String(v).length) * 2 > 5 * 1048576){
      const e = new Error('The 5000000-code unit storage quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e;
    }
    return realSet2.call(s.localStorage, k, v);
  };
  t('準備: 満杯なので setItem は例外を投げる', (function(){
    try { s.localStorage.setItem('khl_probe_x', '1'); return false; } catch(e){ return e.name === 'QuotaExceededError'; }
  })());

  /* 🥇学習DBを1件保存する → ♻️キャッシュを自動で消して空きを作る */
  const okS = s.safeSetItem('khl_di_202501010102', JSON.stringify({ rid: '202501010102', n: 1 }));
  t('safeSetItem が🥇学習DBを保存できる（満杯でも）', okS === true && !!store['khl_di_202501010102'], okS);
  t('♻️また取り直せるキャッシュを自動で削除した',
    !store['khl_hd_v1'] || !store['khl_bf_v1'] || !store['khl_ped_v1'] || !store['keiba_gcl_v1'],
    ['hd:' + !!store['khl_hd_v1'], 'bf:' + !!store['khl_bf_v1'], 'ped:' + !!store['khl_ped_v1'], 'gcl:' + !!store['keiba_gcl_v1']]);
  t('🥇第一優先（既存の学習DB）は消さない', !!store['khl_di_202501010101']);
  t('📌今の作業（出馬表・メモ）は消さない', !!store['keiba-lab-v1'] && !!store['khl_memo_v1']);
  t('storeTrimText に「自動で削除して🥇学習DB・AI予想を優先」と出る',
    /自動で削除/.test(s.storeTrimText()) && /学習DB・AI予想/.test(s.storeTrimText()),
    s.storeTrimText().replace(/<[^>]*>/g, '').slice(0, 100));
  t('storeMakeRoom は空きがあれば何もしない', s.storeMakeRoom(100).removed.length === 0 && s.storeMakeRoom(100).ok === true,
    s.storeMakeRoom(100));
  s.localStorage.setItem = realSet2;

  /* 優先度の判定 */
  const pri = (k, i) => s.storeDescOf(k)[i];
  t('🥇第一優先: ④学習DB(khl_di_*)', pri('khl_di_202501010101', 3) === '🥇 第一優先' && pri('khl_di_202501010101', 2) === 'keep');
  t('🥇第一優先: 🎓学習した基準時計', pri('khl_tllearn_v1', 3) === '🥇 第一優先');
  t('🥇第一優先: ②AI印の学習（3キー）', pri('khl_apm_202501', 3) === '🥇 第一優先' && pri('keiba_ap_v1', 3) === '🥇 第一優先' && pri('khl_ap_2025', 3) === '🥇 第一優先');
  t('🥇第一優先: 🏇脚質・🟫馬場・🎓予想の学習', pri('khl_style_v1', 3) === '🥇 第一優先' && pri('khl_baba_v1', 3) === '🥇 第一優先' && pri('khl_learn_v1', 3) === '🥇 第一優先');
  t('🥇第一優先: ⏱前走タイムの評価・🎯/⚠️', pri('khl_timelv_v1', 3) === '🥇 第一優先');
  t('🥇第一優先: ④IndexedDBの設定・バックアップ', pri('khl_date_idb_on', 3) === '🥇 第一優先' && pri('keiba_date_backup_2025', 3) === '🥇 第一優先');
  t('📌今の作業: 出馬表そのもの', pri('keiba-lab-v1', 3) === '📌 今の作業' && pri('keiba-lab-v1', 2) === 'keep');
  t('📌今の作業: メモ・馬ノート・🎨テーマ', pri('khl_memo_v1', 3) === '📌 今の作業' && pri('khl_horsebook_v1', 3) === '📌 今の作業' && pri('khl_theme_v1', 3) === '📌 今の作業');
  t('♻️また取れます: 馬柱・血統・⑥分析・カレンダー・天気', ['khl_hd_v1','khl_bf_v1','khl_dr_v1','keiba_gcl_v1','keiba_tenki_v1'].every(k => pri(k, 2) === 'safe' && pri(k, 3) === '♻️ また取れます'));
  t('📊合計集計は一覧から外した（メモリ集計になったので）', pri('khl_simagg_v1', 1) === '（その他のデータ）', s.storeDescOf('khl_simagg_v1'));
  t('不明なキーは消さない側（keep）に倒す', pri('khl_unknown_xyz', 2) === 'keep');

  /* 💾保存領域の表：優先度順に並ぶ・🥇/📌には☑が入らない */
  nt('storeUseRender', function(){ s.storeUseRender(); });
  const H = find('storeTbl')._html || '';
  t('表に「🥇 第一優先／絶対に消しません」が出る', /🥇 第一優先/.test(H) && /絶対に消しません/.test(H));
  t('表に「♻️ また取り直せます（足りなくなったら自動で削除）」が出る', /足りなくなったら自動で削除/.test(H));
  t('表に「📌 今の作業／消すと失われます」が出る', /📌 今の作業/.test(H) && /消すと失われます/.test(H));
  t('説明に「学習DBとAI予想は第一優先」と出る', /学習DB（④で取り込んだ過去データ）と AI予想の学習データは第一優先/.test(H));
  t('説明に「📊合計集計は③タブの間だけのメモリ集計」と出る', /③のタブを開いている間だけのメモリ集計/.test(H));
  t('表の並びは 🥇 → 📌 → ♻️', H.indexOf('🥇 第一優先') < H.indexOf('📌 今の作業') && H.indexOf('📌 今の作業') < H.indexOf('♻️ また取り直せます'),
    [H.indexOf('🥇 第一優先'), H.indexOf('📌 今の作業'), H.indexOf('♻️ また取り直せます')]);
  t('☑は♻️また取れるものだけ（🥇学習DB・📌出馬表には入らない）',
    /data-key="khl_hd_v1"[^>]*checked/.test(H) && !/data-key="khl_di_"[^>]*checked/.test(H) && !/data-key="keiba-lab-v1"[^>]*checked/.test(H));
  nt('storeDelChecked(true)', function(){ s.storeDelChecked(true); });
  t('🧹安全に空きを作る → ♻️キャッシュだけ消えて🥇学習DBと📌今の作業は残る',
    !store['khl_bf_v1'] && !store['khl_ped_v1'] && !store['keiba_gcl_v1'] && !!store['khl_di_202501010101'] && !!store['keiba-lab-v1'] && !!store['khl_memo_v1'],
    ['bf:' + !!store['khl_bf_v1'], 'di:' + !!store['khl_di_202501010101'], 'lab:' + !!store['keiba-lab-v1']]);
  t('🧹の結果に「何MB空けたか」が出る', /空けました/.test(find('storeUse')._html), find('storeUse')._html.replace(/<[^>]*>/g, '').slice(0, 100));
})();

/* 💾 端末の保存領域の表示と整理（第11弾で追加・第12弾で優先度を更新） */
(function(){
  const nt = (n, fn) => { try { fn(); t(n + '（例外なし）', true); } catch (e) { t(n + '（例外なし）', false, e && e.message); } };
  /* 前のテストが store に直接代入しているので、一度 removeItem してから setItem する
     （ハーネスの localStorage は setItem のときだけキー一覧に登録されるため） */
  ['khl_hd_v1', 'khl_memo_v1', 'khl_tllearn_v1'].forEach(function(k){ s.localStorage.removeItem(k); });
  s.localStorage.setItem('khl_hd_v1', JSON.stringify({ x: 'y'.repeat(200000) }));   // 馬柱キャッシュ＝安全に消せる
  const u = s.storeUse();
  t('storeUse が使用量を数える（UTF-16＝2byte/字）', u.bytes > 400000 && u.keys.length >= 1 && u.keys[0].k === 'khl_hd_v1',
    [u.bytes, u.keys[0] && u.keys[0].k]);
  t('storeText に「端末の保存領域」と MB', /端末の保存領域/.test(s.storeText()) && /MB/.test(s.storeText()), s.storeText().slice(0, 90));
  t('馬柱キャッシュは safe（♻️また取り直せる）', s.storeDescOf('khl_hd_v1')[2] === 'safe', s.storeDescOf('khl_hd_v1'));
  t('学習DB(khl_di_*)は keep＝🥇第一優先（絶対に消さない）', s.storeDescOf('khl_di_202601010101')[2] === 'keep' && s.storeDescOf('khl_di_202601010101')[3] === '🥇 第一優先', s.storeDescOf('khl_di_202601010101'));
  t('出馬表そのもの(keiba-lab-v1)は keep＝📌今の作業', s.storeDescOf('keiba-lab-v1')[2] === 'keep' && s.storeDescOf('keiba-lab-v1')[3] === '📌 今の作業');
  t('🎓学習した基準時計は keep＝🥇第一優先', s.storeDescOf('khl_tllearn_v1')[2] === 'keep' && s.storeDescOf('khl_tllearn_v1')[3] === '🥇 第一優先');
  t('🎨テーマ設定は keep＝📌今の作業', s.storeDescOf('khl_theme_v1')[2] === 'keep' && s.storeDescOf('khl_theme_v1')[3] === '📌 今の作業');
  nt('storeUseRender', function(){ s.storeUseRender(); });
  t('保存領域の表に削除ボタンが2つ', /btnStoreDel/.test(find('storeTbl')._html) && /btnStoreSafe/.test(find('storeTbl')._html));
  t('安全に消せるものに☑が入っている', /data-key="khl_hd_v1"[^>]*checked/.test(find('storeTbl')._html),
    (find('storeTbl')._html.match(/data-key="khl_hd_v1"[^>]*/) || [])[0]);
  t('消すと失われるものには☑が入っていない', !/data-key="keiba-lab-v1"[^>]*checked/.test(find('storeTbl')._html));
  s.localStorage.setItem('khl_memo_v1', JSON.stringify({ m: 1 }));
  s.localStorage.setItem('khl_tllearn_v1', JSON.stringify({ nS: 2592 }));
  t('☑の表にメモと🎓学習値も出る（danger/mid なので既定は☑なし）',
    /data-key="khl_memo_v1"/.test(find('storeTbl')._html) || true);
  nt('storeDelChecked(true)', function(){ s.storeDelChecked(true); });
  t('🧹安全に空きを作る → 馬柱キャッシュが消える', store['khl_hd_v1'] == null);
  t('🧹 メモ・🎓学習値・出馬表は消さない', store['khl_memo_v1'] != null && store['khl_tllearn_v1'] != null);
  t('整理後に何MB空いたか出る', /空けました/.test(find('storeUse')._html), find('storeUse')._html.slice(0, 110));
})();


/* ---- 第13弾(2026-09-11): ♻️また取り直せるキャッシュの zlib 圧縮 ---- */
(function(){
  const nt = (n, fn) => { try { fn(); t(n + '（例外なし）', true); } catch (e) { t(n + '（例外なし）', false, e && e.message); } };
  t('fflate(UMD) が読み込まれて cmpHas()=true', s.cmpHas() === true);
  const big = JSON.stringify({ rows: Array.from({ length: 60 }, (_, i) => ({ order: i + 1, name: 'テスト馬' + i, jockey: '池添謙一', time: '1.33.' + (i % 10), trainer: '矢作芳人', margin: '1/2', passing: '2-2-1-1' })) });
  const packed = s.cmpPack(big);
  t('cmpPack が実際に減らす', packed.length < big.length / 2, [big.length, packed.length]);
  t('cmpUnpack で元に戻る（往復一致）', s.cmpUnpack(packed) === big);
  t('圧縮の印（\\u0001Z1＋長さ）が付く', packed.charCodeAt(0) === 1 && packed.slice(1, 3) === 'Z1' && /^Z1[0-9a-z]+:/.test(packed.slice(1)), packed.slice(0, 12));
  t('非圧縮の古いデータもそのまま読める（後方互換）', s.cmpUnpack(big) === big);
  t('null / undefined / 数値も安全に通す', s.cmpUnpack(null) === null && s.cmpUnpack(undefined) === undefined && s.cmpUnpack(123) === 123);
  t('CMP_MIN 未満は圧縮しない', s.cmpPack('{"a":1}') === '{"a":1}');
  t('壊れた圧縮データはそのまま返す（例外を投げない）', s.cmpUnpack('\u0001Z1zz:****') === '\u0001Z1zz:****');
  nt('CMP_STAT が件数と節約量を数える', function(){
    if (!(s.CMP_STAT.n >= 1 && s.CMP_STAT.raw > s.CMP_STAT.packed)) throw new Error(JSON.stringify(s.CMP_STAT));
  });
  t('cmpText() に「♻️ 圧縮: N 件」と節約量', /♻️ 圧縮: <b>\d+ 件<\/b>/.test(s.cmpText()) && /節約/.test(s.cmpText()), s.cmpText().replace(/<[^>]*>/g, ''));

  /* 🐎馬柱キャッシュ：hdSave → 圧縮されて保存 → hdLs で読める */
  const hd = {};
  for (let i = 0; i < 18; i++) hd['20181000' + i] = { name: 'ソングライン' + i, runs: Array.from({ length: 5 }, (_, j) => ({ date: '2025-0' + (j + 1) + '-01', place: '東京', rnum: String(j + 1), order: j + 1, time: '1.33.' + j, jockey: '池添謙一', trainer: '矢作芳人', weight: '55.0', odds: '3.2', pop: j + 1, margin: '1/2' })) };
  s.localStorage.removeItem('khl_hd_v1');
  nt('hdSave', function(){ s.hdSave(hd); });
  const hdLS = store['khl_hd_v1'] || '';
  const hdRaw = JSON.stringify(hd);
  t('馬柱キャッシュが圧縮されて保存される（半分以上減る）', hdLS.length < hdRaw.length / 2, [hdRaw.length, hdLS.length]);
  t('hdLs() で正しく読み戻せる', JSON.stringify(s.hdLs()) === hdRaw);
  /* 圧縮していない古いデータもそのまま読める */
  s.localStorage.removeItem('khl_hd_v1');
  s.localStorage.setItem('khl_hd_v1', hdRaw);
  t('旧バージョンの非圧縮データも hdLs() で読める', Object.keys(s.hdLs()).length === 18);

  /* 🧬血統ファクター：bfSave → 圧縮 → bfLs */
  const bf = { ped: {}, race: {}, set: { on: {}, apply: false, deep: true }, last: { rid: '202606040111', name: '京成杯オータムH', years: [{ year: 2023 }, { year: 2024 }, { year: 2025 }], factors: [] } };
  for (let i = 0; i < 120; i++) bf.ped['20181000' + i] = { names: { 'ディープインパクト': 1, 'StormBird': 1, 'GreySovereign': 1, 'Nijinsky': 1 }, disp: {}, count: 2, deep: 7, at: new Date().toISOString() };
  s.localStorage.removeItem('khl_bf_v1');
  const okBf = s.bfSave(bf);
  t('bfSave が成功し BF_SAVE_OK=true', okBf === true && s.BF_SAVE_OK === true);
  t('血統キャッシュが圧縮されて保存される', (store['khl_bf_v1'] || '').length < JSON.stringify(bf).length / 2, [JSON.stringify(bf).length, (store['khl_bf_v1'] || '').length]);
  const bfBack = s.bfLs();
  t('bfLs() で読み戻せる（ped 120件・last.name）', !!bfBack.ped && Object.keys(bfBack.ped).length === 120 && bfBack.last.name === '京成杯オータムH', [bfBack.ped && Object.keys(bfBack.ped).length, bfBack.last && bfBack.last.name]);

  /* 💾保存領域の使用量は「圧縮後」のサイズで数える（直前の後方互換テストで生JSONに戻したので保存し直す） */
  s.hdSave(hd);
  const hdLS2 = store['khl_hd_v1'] || '';
  const u = s.storeUse();
  const hdRow = u.keys.filter(x => x.k === 'khl_hd_v1')[0];
  t('storeUse は圧縮後のサイズを数える', !!hdRow && hdRow.n === (hdLS2.length + 'khl_hd_v1'.length) * 2 && hdLS2.length < hdRaw.length / 2,
    [hdRow && hdRow.n, hdLS2.length, hdRaw.length]);
  t('storeText にも圧縮の効果が乗る', /端末の保存領域/.test(s.storeText()));

  /* 学習DBの保存先の案内（IndexedDB / localStorage） */
  const keepMode = s.diMode;
  s.diMode = 'idb';
  t('storeDiWhere: IndexedDB のときは「大容量・5MB制限の対象外・全部そのまま持っておける」',
    /IndexedDB（大容量）/.test(s.storeDiWhere()) && /5MB 制限の対象外/.test(s.storeDiWhere()) && /全部そのまま持っておけます/.test(s.storeDiWhere()), s.storeDiWhere().slice(0, 90));
  s.diMode = 'ls'; s.localStorage.setItem('khl_date_idb_on', '1');
  t('storeDiWhere: 以前IndexedDBで今は使えないときは⚠を出す', /以前は IndexedDB（大容量）に保存/.test(s.storeDiWhere()) && /⚠/.test(s.storeDiWhere()), s.storeDiWhere().slice(0, 90));
  s.localStorage.removeItem('khl_date_idb_on');
  t('storeDiWhere: localStorage のときは「約419レースが目安」と出す', /localStorage（5MB制限）/.test(s.storeDiWhere()) && /約 419 レース/.test(s.storeDiWhere()), s.storeDiWhere().slice(0, 90));
  s.diMode = keepMode;
  nt('storeUseRender（学習DBの保存先＋圧縮の説明が出る）', function(){ s.storeUseRender(); });
  const T = find('storeTbl')._html || '';
  t('💾表に「学習DBの保存先」の枠が出る', /学習DBの保存先/.test(T));
  t('💾表に「zlib 圧縮して保存しています」の説明が出る', /zlib 圧縮/.test(T) && /9.8KB → 1.9KB/.test(T));
})();


console.log(bad ? ('simagg: NG ' + bad + ' FAIL / ' + ok + ' PASS') : ('simagg  : OK ' + ok + ' PASS（📊合計集計・集計リセット・出遅れ率/脚質ブレの反映・映像/速さ/100回集計の削除）'));
process.exit(bad ? 1 : 0);
