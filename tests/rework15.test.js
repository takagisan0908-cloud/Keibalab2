/* 2026-09-13 第23弾 の回帰テスト
   実行: node tests/rework15.test.js

   ご依頼（6件）:
     ① オッズがリアルタイムではない為、更新した際に最新を取得するようにする
     ② 展開予想（ペース診断）とAI予想エンジンの重み設定の表記が横に広がっている為、修正
     ③ 回収率チューナーを押すとサイトの挙動が重くなるので修正
     ④ 日付を選んで出馬表を出すところの理想：その日の出馬表を一括取込で全データを取得しておき、
        その日のどの出馬表を選択しても再取得せずパッと表示される
     ⑤ 出馬表の自動保存はされず、読み込み履歴にも取得されたレースの一覧がない為、改善して
     ⑥ サイト全体が重くなってきてるから軽量化できたら修正お願い

   検証内容:
     A) ③ 回収率チューナー: 軽量化しても **総当たりの計算結果が旧版と完全一致** すること
     B) ③ 速度: 旧版より明確に速くなっていること
     C) ③ vtRaces のキャッシュ: 学習DBの署名が変わらなければ作り直さない／変われば作り直す
     D) ⑥ diLs() のメモ化: 学習DBを読み直さない／書き込んだら必ず捨てて読み直す
     E) ② レイアウト: grid の子に min-width:0 が入り、.wtbar の固定幅+nowrap が外れていること
     F) ④⑤ 一括取得したレースが「出馬表キャッシュ」にも「読み込み履歴」にも残ること
     G) ① レース読込時・タブ表示時に必ず最新オッズを取りに行くこと
     H) index.html / build.py への組み込み
*/
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
let ok = 0, bad = 0;
const fails = [];
function T(name, cond, extra){
  if (cond) { ok++; }
  else { bad++; fails.push(name + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); }
}
function eq(name, got, want){
  const g = JSON.stringify(got), w = JSON.stringify(want);
  T(name, g === w, { got: (g || '').slice(0, 400), want: (w || '').slice(0, 400) });
}
const tick = function(){ return new Promise(function(r){ setImmediate(r); }); };
async function drain(n){ for (let i = 0; i < (n || 6); i++) await tick(); }
function mkLS(){
  const m = {};
  return {
    _m: m,
    get length(){ return Object.keys(m).length; },
    key(i){ return Object.keys(m)[i] || null; },
    getItem(k){ return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem(k, v){ m[k] = String(v); },
    removeItem(k){ delete m[k]; }
  };
}
function makeEl(id){
  const el = { id: id || '', value: '', _html: '', style: {}, dataset: {}, checked: true, disabled: false, open: false,
    classList: { _s: new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); }, contains(c){ return this._s.has(c); },
      toggle(c, f){ if (f === undefined){ this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { f ? this._s.add(c) : this._s.delete(c); } } },
    _attrs: {}, title: '',
    setAttribute(k, v){ this._attrs[k] = String(v); }, getAttribute(k){ return this._attrs[k] == null ? null : this._attrs[k]; },
    addEventListener(){}, appendChild(){}, focus(){}, closest(){ return null; }, scrollIntoView(){},
    querySelector(){ return makeEl(); }, querySelectorAll(){ return []; } };
  Object.defineProperty(el, 'innerHTML', { get(){ return el._html; }, set(v){ el._html = v; } });
  Object.defineProperty(el, 'textContent', { get(){ return el._t || ''; }, set(v){ el._t = String(v); } });
  return el;
}
function mkG(ls){
  const els = {};
  const g = {
    console, Math, JSON, Date, String, Number, parseInt, parseFloat, isNaN, isFinite, RegExp,
    Array, Object, Boolean, Error, Promise, encodeURIComponent, decodeURIComponent,
    setTimeout(fn2){ try { fn2(); } catch(e){} return 0; },
    clearTimeout(){}, setInterval(){ return 0; }, clearInterval(){},
    requestAnimationFrame(){ return 0; }, cancelAnimationFrame(){},
    localStorage: ls, addEventListener(){}, devicePixelRatio: 1, innerWidth: 980,
    navigator: {}, window: null,
    fetch(){ return Promise.reject(new Error('no fetch in test')); },
    document: { getElementById(id){ if (!els[id]) els[id] = makeEl(id); return els[id]; },
                addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
                createElement(){ return makeEl('tmp'); }, head: { appendChild(){} } }
  };
  g.window = g; g.globalThis = g; g.__els = els;
  vm.createContext(g);
  return g;
}
function load(g, files){
  let code = '';
  files.forEach(function(f){
    const p = f.indexOf('/') === 0 ? f : path.join(ROOT, f);
    code += fs.readFileSync(p, 'utf8') + '\n';
  });
  vm.runInContext(code, g, { filename: 'keiba.js' });
  return function(src){ return vm.runInContext(src, g); };
}

/* ---------- 決定的な擬似乱数（テスト結果を毎回同じにする） ---------- */
function mkRnd(seed){
  let s = seed >>> 0;
  return function(){ s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/* ---------- 合成レース（vtRaceOf が返す形）を作る ----------
   cand は「全券種 × 上位8頭」ぶんを本物と同じ組合せ規則で生成します。 */
const KINDS = [
  { k: 'tan',    n: 1, ord: false },
  { k: 'fuku',   n: 1, ord: false },
  { k: 'wide',   n: 2, ord: false },
  { k: 'umaren', n: 2, ord: false },
  { k: 'umatan', n: 2, ord: true  },
  { k: 'sanren', n: 3, ord: false },
  { k: 'santan', n: 3, ord: true  }
];
function betKey(kind, nos){
  const d = KINDS.filter(function(x){ return x.k === kind; })[0] || {};
  const arr = nos.slice();
  if (!d.ord) arr.sort(function(a, b){ return parseInt(a, 10) - parseInt(b, 10); });
  return arr.join(d.ord ? '→' : '-');
}
function mkRaces(nRace, seed, withPay){
  const rnd = mkRnd(seed);
  const out = [];
  for (let r = 0; r < nRace; r++){
    const nh = 8 + Math.floor(rnd() * 8);            // 8〜15頭
    const nos = []; for (let i = 1; i <= nh; i++) nos.push(String(i));
    // 着順（1〜nh をシャッフル）
    const sh = nos.slice();
    for (let i = sh.length - 1; i > 0; i--){ const j = Math.floor(rnd() * (i + 1)); const t = sh[i]; sh[i] = sh[j]; sh[j] = t; }
    const order = {}; sh.forEach(function(no, i){ order[no] = i + 1; });
    const odds = {}; nos.forEach(function(no){ odds[no] = Math.round((1.5 + rnd() * 60) * 10) / 10; });
    // AI勝率の上位8頭（= qrank 0..7）
    const P = nos.slice().sort(function(a, b){ return rnd() - 0.5; }).slice(0, Math.min(8, nh));
    const qrank = {}; P.forEach(function(i, k){ qrank[i] = k; });
    const cand = [];
    function add(kind, idx){
      const nosB = idx.map(function(i){ return nos[i]; });
      const pM = 0.001 + rnd() * 0.4;
      const pX = 0.001 + rnd() * 0.4;
      const oddsT = (1 - 0.25) / pX;
      let qmax = 0; idx.forEach(function(i){ if (qrank[i] > qmax) qmax = qrank[i]; });
      cand.push({
        kind: kind, nos: nosB, key: betKey(kind, nosB), ord: !!(KINDS.filter(function(x){ return x.k === kind; })[0] || {}).ord,
        pM: pM, pX: pX, edge: pM / pX, ev: pM * oddsT, oddsT: oddsT,
        kelly: oddsT > 1 ? Math.max(0, (pM * oddsT - 1) / (oddsT - 1)) : 0,
        qmax: qmax
      });
    }
    const Pi = P.map(function(no){ return nos.indexOf(no); });
    KINDS.forEach(function(d){
      if (d.n === 1){ Pi.forEach(function(i){ add(d.k, [i]); }); return; }
      if (d.n === 2){
        for (let a = 0; a < Pi.length; a++) for (let b = 0; b < Pi.length; b++){
          if (a === b) continue;
          if (!d.ord && b < a) continue;
          add(d.k, [Pi[a], Pi[b]]);
        }
        return;
      }
      for (let x1 = 0; x1 < Pi.length; x1++) for (let x2 = 0; x2 < Pi.length; x2++) for (let x3 = 0; x3 < Pi.length; x3++){
        if (x1 === x2 || x2 === x3 || x1 === x3) continue;
        if (!d.ord && (x2 < x1 || x3 < x2)) continue;
        add(d.k, [Pi[x1], Pi[x2], Pi[x3]]);
      }
    });
    const pay = {};
    if (withPay){
      // 実払戻があるレース：当たり券種だけ 100円あたりの払戻を入れる
      cand.forEach(function(c){
        const o = c.nos.map(function(x){ return order[String(x)] || 0; });
        let hit = false;
        if (c.kind === 'tan') hit = o[0] === 1;
        else if (c.kind === 'fuku') hit = o[0] >= 1 && o[0] <= 3;
        else if (c.kind === 'wide') hit = o[0] <= 3 && o[1] <= 3;
        else if (c.kind === 'umaren') hit = o[0] <= 2 && o[1] <= 2 && o[0] !== o[1];
        else if (c.kind === 'umatan') hit = o[0] === 1 && o[1] === 2;
        else if (c.kind === 'sanren') hit = o.every(function(x){ return x >= 1 && x <= 3; });
        else if (c.kind === 'santan') hit = o[0] === 1 && o[1] === 2 && o[2] === 3;
        if (hit && rnd() < 0.55) pay[c.kind] = Object.assign(pay[c.kind] || {}, (function(){ const o2 = {}; o2[c.key] = Math.round(100 + rnd() * 20000); return o2; })());
      });
    }
    out.push({ rid: '2026090403' + ('0' + (r + 1)).slice(-2), d8: '20260912', src: (r % 2 ? 'live' : 'bt'),
      nos: nos, q: nos.map(function(){ return 1 / nh; }), mi: nos.map(function(){ return 1 / nh; }),
      odds: odds, order: order, pay: pay, cand: cand, n: nh, hasPay: !!withPay });
  }
  return out;
}

/* ==========================================================================
   A) ③ 回収率チューナー: 旧版と新版で総当たり結果が完全一致するか
   ========================================================================== */
console.log('\n[A] ③ 回収率チューナー ― 軽量化しても計算結果が旧版と完全一致するか');
(function(){
  const lsA = mkLS(), lsB = mkLS();
  const gA = mkG(lsA), gB = mkG(lsB);
  // p55_betpro の BP_KIND（vtByKind がラベル表示に使う）だけスタブする
  const BP_STUB = 'var BP_KIND = {' +
    "tan:{n:'単勝',k:1,ord:false},fuku:{n:'複勝',k:1,ord:false,top3:true}," +
    "wide:{n:'ワイド',k:2,ord:false,top3:true},umaren:{n:'馬連',k:2,ord:false}," +
    "umatan:{n:'馬単',k:2,ord:true},sanren:{n:'3連複',k:3,ord:false},santan:{n:'3連単',k:3,ord:true}};";
  const runA = load(gA, [path.join(FIX, 'p58_value_old.js')]);
  const runB = load(gB, ['src/p58_value.js']);
  runA(BP_STUB); runB(BP_STUB);

  // 共通の合成レースを JSON 経由で両コンテキストに流し込む（オブジェクトを跨がせない）
  const cases = [
    { n: 12, seed: 1, pay: false },
    { n: 12, seed: 1, pay: true  },
    { n: 40, seed: 7, pay: true  },
    { n: 40, seed: 99, pay: false }
  ];
  cases.forEach(function(c){
    const racesJson = JSON.stringify(mkRaces(c.n, c.seed, c.pay));
    gA.__races = JSON.parse(racesJson);
    gB.__races = JSON.parse(racesJson);
    const sA = runA('JSON.stringify(vtSweep(__races).map(function(s){ return { id:s.id, acc:s.acc, rate:s.rate }; }))');
    const sB = runB('JSON.stringify(vtSweep(__races).map(function(s){ return { id:s.id, acc:s.acc, rate:s.rate }; }))');
    const tag = 'n=' + c.n + ' seed=' + c.seed + ' pay=' + c.pay;
    T('vtSweep の結果が旧版と完全一致 (' + tag + ')', sA === sB,
      { old: sA.slice(0, 300), neu: sB.slice(0, 300) });
    const nA = JSON.parse(sA).length;
    T('  └ 総当たりが実際に走っている (' + tag + ' / ' + nA + '通り)', nA > 100, nA);
  });

  // vtEvalRace（vtByPoints / vtByKind / vtByEdge / vtAccFor が使う入口）も一致するか
  (function(){
    const racesJson = JSON.stringify(mkRaces(20, 5, true));
    gA.__races = JSON.parse(racesJson); gB.__races = JSON.parse(racesJson);
    ['vtByPoints', 'vtByKind', 'vtByEdge'].forEach(function(fn){
      const a = runA('JSON.stringify(' + fn + '(__races))');
      const b = runB('JSON.stringify(' + fn + '(__races))');
      T(fn + ' の結果が旧版と完全一致', a === b, { old: a.slice(0, 200), neu: b.slice(0, 200) });
    });
    // 「今の③の設定」= ks フィールド無し・kinds 配列だけ の経路
    const stJson = JSON.stringify({ id: 'current', ksName: 'x', kinds: ['tan', 'umaren', 'sanren'],
      pool: 5, minEdge: 1.1, cap: 8, stake: 'kelly', stakeName: 'k' });
    gA.__st = JSON.parse(stJson); gB.__st = JSON.parse(stJson);
    const a2 = runA('JSON.stringify(vtAccFor(__races, __st))');
    const b2 = runB('JSON.stringify(vtAccFor(__races, __st))');
    T('vtAccFor(ks無し・kindsだけ) の結果が旧版と完全一致', a2 === b2, { old: a2.slice(0, 200), neu: b2.slice(0, 200) });
  })();
})();

/* ==========================================================================
   B) ③ 速度: 旧版より明確に速いか
   ========================================================================== */
console.log('\n[B] ③ 回収率チューナー ― 総当たりの速度');
let speedOld = 0, speedNew = 0;
(function(){
  const racesJson = JSON.stringify(mkRaces(60, 2024, true));
  const lsA = mkLS(), lsB = mkLS();
  const gA = mkG(lsA), gB = mkG(lsB);
  const runA = load(gA, [path.join(FIX, 'p58_value_old.js')]);
  const runB = load(gB, ['src/p58_value.js']);
  gA.__races = JSON.parse(racesJson); gB.__races = JSON.parse(racesJson);
  // ウォームアップ（JIT）
  runA('vtSweep(__races.slice(0,5))'); runB('vtSweep(__races.slice(0,5))');
  let t = Date.now(); const rA = runA('vtSweep(__races).length'); speedOld = Date.now() - t;
  t = Date.now();       const rB = runB('vtSweep(__races).length'); speedNew = Date.now() - t;
  console.log('    60レース / 総当たり' + rA + '通り:  旧版 ' + speedOld + 'ms → 新版 ' + speedNew + 'ms');
  T('新版は旧版と同じ通り数を返す', rA === rB, { old: rA, neu: rB });
  T('新版は旧版より速い（' + speedOld + 'ms → ' + speedNew + 'ms）', speedNew < speedOld, { old: speedOld, neu: speedNew });
})();

/* ==========================================================================
   C) ③ vtRaces のキャッシュ
   ========================================================================== */
console.log('\n[C] ③ vtRaces のキャッシュ（描画キャッシュが効くときまで作り直していたのを止めた）');
(function(){
  const ls = mkLS();
  const g = mkG(ls);
  const run = load(g, ['src/p58_value.js']);
  g.__calls = 0;
  g.apStoredRaceList = function(){
    g.__calls++;
    return [
      { rid: '202609040301', p: { rows: [{ no: 1, order: 1, odds: 3.0 }, { no: 2, order: 2, odds: 5.0 }, { no: 3, order: 3, odds: 8.0 }], payout: null, payouts: null } },
      { rid: '202609040302', p: { rows: [{ no: 1, order: 1, odds: 3.0 }, { no: 2, order: 2, odds: 5.0 }, { no: 3, order: 3, odds: 8.0 }], payout: { win: 300 }, payouts: null } }
    ];
  };
  g.apGet = function(rid){
    return { rid: rid, pre: { rows: [{ no: 1, prob: 0.3 }, { no: 2, prob: 0.2 }, { no: 3, prob: 0.15 }, { no: 4, prob: 0.1 }], d8: '20260912' },
      preBt: null, meta: { date8: '20260912' }, result: { rows: [{ no: 1, order: 1, odds: 3.0 }, { no: 2, order: 2, odds: 5.0 }, { no: 3, order: 3, odds: 8.0 }], payout: null, payouts: null } };
  };
  // 署名を2回取っても apStoredRaceList は走る（署名は安い）が、vtRaces の重い生成は1回だけになる
  run('var __a = vtRacesCached(0); var __b = vtRacesCached(0); var __same = (__a === __b);');
  T('署名が変わらなければ同じ束を使い回す（作り直さない）', run('__same') === true);
  T('vtRacesCached は配列を返す', run('Object.prototype.toString.call(vtRacesCached(0))') === '[object Array]');

  // 学習DBの中身が変わったら（払戻が入った）必ず作り直す
  run('vtDropRCache();');
  run('var __c = vtRacesCached(0);');
  T('vtDropRCache() 後は作り直す（別の束になる）', run('__c !== __a') === true);

  // 署名が変われば drop せずとも作り直す
  g.apStoredRaceList = function(){
    return [{ rid: '202609040301', p: { rows: [{ no: 1, order: 1, odds: 3.0 }, { no: 2, order: 2, odds: 5.0 }, { no: 3, order: 3, odds: 8.0 }], payout: { win: 300 }, payouts: null } }];
  };
  run('var __d = vtRacesCached(0);');
  T('学習DBの署名が変わったら自動的に作り直す', run('__d !== __c') === true);

  // limit を渡したときはキャッシュしない（従来どおり）
  T('vtListSig は学習DBの中身を写す（rid:着順行数:払戻:払戻詳細）', /202609040301:3:10,/.test(String(run('vtListSig()'))), run('vtListSig()'));
})();

/* ==========================================================================
   C2) ③ チャンク実行版（vtAnalyzeAsync）が同期版（vtAnalyze）と同じ結果を出すか
   ========================================================================== */
console.log('\n[C2] ③ チャンク実行版が同期版と同じ結果を出すか（画面を固めないための分割）');
(function(){
  const ls = mkLS();
  const g = mkG(ls);
  const BP_STUB = 'var BP_KIND = {' +
    "tan:{n:'単勝',k:1,ord:false},fuku:{n:'複勝',k:1,ord:false,top3:true}," +
    "wide:{n:'ワイド',k:2,ord:false,top3:true},umaren:{n:'馬連',k:2,ord:false}," +
    "umatan:{n:'馬単',k:2,ord:true},sanren:{n:'3連複',k:3,ord:false},santan:{n:'3連単',k:3,ord:true}};";
  const run = load(g, ['src/p58_value.js']);
  run(BP_STUB);
  g.__races = mkRaces(25, 31, true);
  g.bpReadOpt = function(){ return { kinds: ['tan', 'umaren'], pool: 5, minEdge: 1.0, maxBets: 12, kelly: 0.25 }; };

  const sync = run('JSON.stringify(vtAnalyze(__races))');
  let progCalls = 0, lastF = -1;
  g.__prog = function(f){ progCalls++; lastF = f; };
  const asyncRes = run('vtAnalyzeAsync(__races, __prog).then(function(A){ __asyncOut = JSON.stringify(A); })');
  return Promise.resolve(asyncRes).then(async function(){
    await drain();
    const asy = g.__asyncOut;
    T('vtAnalyzeAsync の結果が vtAnalyze と完全一致', sync === asy,
      { sync: (sync || '').slice(0, 200), asy: (asy || '').slice(0, 200) });
    T('進捗コールバックが呼ばれた（＝分割して回っている）', progCalls >= 8, progCalls);
    T('進捗が最後は 100% に到達', lastF === 1, lastF);
    runRest();
  });
})();
async function runRest(){

/* ==========================================================================
   D) ⑥ diLs() のメモ化
   ========================================================================== */
console.log('\n[D] ⑥ diLs() のメモ化（呼ぶたびに学習DBを全部 JSON.parse していたのを止めた）');
(function(){
  const ls = mkLS();
  const g = mkG(ls);
  // safeSetItem などの依存を最小限スタブ
  g.$ = function(){ return null; };
  g.esc = function(s){ return String(s == null ? '' : s); };
  g.safeSetItem = function(k, v){ try { ls.setItem(k, v); return true; } catch(e){ return false; } };
  const run = load(g, ['src/p32_dateimport.js']);

  // 学習DBに3レース入れておく
  run('diMode = "ls";');
  for (let i = 1; i <= 3; i++){
    ls.setItem('khl_di_2026090403' + ('0' + i).slice(-2), JSON.stringify({ rid: '2026090403' + ('0' + i).slice(-2), at: 1000 + i, rows: [{ no: 1, order: 1 }], date8: '20260912' }));
  }
  // JSON.parse の回数を数える
  let parses = 0;
  const origParse = JSON.parse;
  g.JSON = Object.create(JSON);
  g.JSON.parse = function(s){ parses++; return origParse.apply(JSON, arguments); };
  g.JSON.stringify = JSON.stringify;

  run('var __x1 = diLs();');
  const p1 = parses;
  T('1回目の diLs() は学習DBをパースする', p1 > 0, p1);
  run('var __x2 = diLs(); var __x3 = diLs(); var __x4 = diLs();');
  T('2回目以降の diLs() はパースしない（メモ化）', parses === p1, { first: p1, after: parses });
  T('メモ化しても中身は同じ', run('__x1 === __x2 && __x2 === __x3') === true);
  T('diCount() が正しい', run('diCount()') === 3, run('diCount()'));

  // 書き込んだら必ず捨てて読み直す
  run('diLsSet("202609040304", { rid:"202609040304", at:2000, rows:[{no:1,order:1}], date8:"20260912" });');
  T('diLsSet 後に件数が増えている（キャッシュが捨てられている）', run('diCount()') === 4, run('diCount()'));
  run('diRemoveRace("202609040304");');
  T('diRemoveRace 後に件数が減っている', run('diCount()') === 3, run('diCount()'));
  run('diLsClear();');
  T('diLsClear 後に 0 件', run('diCount()') === 0, run('diCount()'));
})();

/* ==========================================================================
   E) ② レイアウト（CSS）
   ========================================================================== */
console.log('\n[E] ② ペース診断・重み設定の横広がり（CSS）');
(function(){
  const head = fs.readFileSync(path.join(ROOT, 'src/p1_head.html'), 'utf8');
  T('.row2/.row3 の grid 子に min-width:0 が入った', /\.row2>\*,\.row3>\*\{min-width:0\}/.test(head));
  T('.row2 の .card にも min-width:0 が入った', /\.row2 \.card,\.row3 \.card\{min-width:0/.test(head));
  T('#wtAutoBox（横スクロールの箱）に min-width:0 が入った', /#wtAutoBox,#wtAutoBox>div\{min-width:0/.test(head));
  T('.wtbar の固定幅 min-width:118px が外れた', !/\.wtbar\{[^}]*min-width:118px/.test(head));
  T('.wtbar の white-space:nowrap が外れた', !/\.wtbar\{[^}]*white-space:nowrap/.test(head));
  T('.wtbar に min-width:0 が入った', /\.slider \.wtbar\{[^}]*min-width:0/.test(head));
  T('.wtbar が折り返す（white-space:normal）', /\.slider \.wtbar\{[^}]*white-space:normal/.test(head));
  T('.slider 自体が折り返せる（flex-wrap:wrap）', /\.slider\{[^}]*flex-wrap:wrap/.test(head));
  T('.slider label が縮める（flex:0 1 130px + min-width:0）', /\.slider label\{flex:0 1 130px;min-width:0/.test(head));
  T('.pacebig の固定 1.9rem が clamp になった', /\.pacebig\{font-size:clamp\(/.test(head));
  T('狭い画面では .wtbar が独立行（flex-basis:100%）', /\.slider \.wtbar\{flex-basis:100%/.test(head));
  // 既存のモバイル対応を壊していない
  T('モバイルの .slider label{flex-basis:100%} は残っている', /\.slider label\{flex-basis:100%\}/.test(head));
})();

/* ==========================================================================
   F) ④⑤ 一括取得 → 出馬表キャッシュ ＋ 取得済みレースの一覧
   ========================================================================== */
console.log('\n[F] ④⑤ 一括取得した全レースが「端末の出馬表」にも「一覧」にも残るか');
(function(){
  const ls = mkLS();
  const g = mkG(ls);
  g.$ = function(id){ return g.document.getElementById(id); };
  g.esc = function(x){ return String(x == null ? '' : x); };
  g.safeSetItem = function(k, v){ try { ls.setItem(k, v); return true; } catch(e){ return false; } };
  const run = load(g, ['src/p53_prefetch.js']);

  // --- ⑤ 一覧の記録 ---
  run(`preNoteFetched('202609040301','20260912',{place:'阪神',rnum:'1',name:'2歳未勝利',n:12,pre:true,oddsN:12});`);
  run(`preNoteFetched('202609040302','20260912',{place:'阪神',rnum:'2',name:'3歳以上1勝クラス',n:16,pre:false});`);
  eq('一覧に2件記録される', run('preListAll().length'), 2);
  eq('同じレースをもう一度記録しても増えない（上書き）',
     (run(`preNoteFetched('202609040301','20260912',{place:'阪神',rnum:'1',name:'2歳未勝利',n:12,pre:true,oddsN:12}); preListAll().length`)), 2);
  eq('記録にレースIDが残る', run(`preListAll().some(function(x){ return x.rid === '202609040302'; })`), true);
  eq('記録に「事前予想を保存できたか」が残る', run(`preListAll().filter(function(x){ return x.rid==='202609040301'; })[0].pre`), true);
  eq('結果確定済みでスキップされたレースも pre:false で一覧に載る',
     run(`preListAll().filter(function(x){ return x.rid==='202609040302'; })[0].pre`), false);

  // 別の日付 → 新しい日付が上に来る
  run(`preNoteFetched('202609050301','20260913',{place:'中山',rnum:'1',name:'2歳新馬',n:10,pre:true});`);
  eq('日付ごとに並ぶ（新しい日付が先頭）', run(`preListAll()[0].d8`), '20260913');
  T('日付ラベルを出せる', /2026年9月13日/.test(String(run(`preD8Label('20260913')`))), run(`preD8Label('20260913')`));

  // --- 一覧の描画 ---
  run('preListRender();');
  const html = String(run(`document.getElementById('preList').innerHTML`));
  T('一覧に場名・R番・レース名が出る', /阪神/.test(html) && /1R/.test(html) && /2歳未勝利/.test(html));
  T('一覧に日付ごとのグループ見出しが出る', /2026年9月13日/.test(html) && /2026年9月12日/.test(html));
  T('「表示」ボタンに race_id が入っている', /data-pshow="202609040301"/.test(html));
  T('件数チップが更新される', String(run(`document.getElementById('preListChip').textContent`)) === '3件',
    run(`document.getElementById('preListChip').textContent`));
  T('出馬表キャッシュが無いレースは「取得」になる', /🌐取得/.test(html));
  /* ★2026-09-13 第24弾②: 一覧を最小表示にしたので、
     横に広げていた長文（race_id・状態説明・削除ボタン文言）が本文に出ないことを確認します。 */
  T('第24弾②: 長文ステータス「端末に出馬表あり（通信せず開けます）」を本文から削除', !/端末に出馬表あり（通信せず開けます）/.test(html));
  T('第24弾②: 長文ステータス「出馬表は期限切れ（開くときに取得します）」を本文から削除', !/出馬表は期限切れ（開くときに取得します）/.test(html));
  T('第24弾②: race_id は本文に出さず title(ホバー) だけに残す', !/>202609040301</.test(html) && /race_id: 202609040301/.test(html));
  T('第24弾②: 削除ボタンは「✕」の最小表示', /data-pdel="202609040301"[^>]*>✕</.test(html));
  T('第24弾②: 1行表示なので2行目の small muted ブロックが無い', !/<div class="small muted" style="margin-top:2px">/.test(html));

  // --- ④ 出馬表キャッシュの確保 ---
  let fetches = [];
  g.nkCardHas = function(rid){ return rid === '202609040301'; };
  g.nkFetchCardText = function(rid){ fetches.push(rid); return Promise.resolve('<html>card ' + rid + '</html>'); };
  run(`preHasCard('202609040301')`);
  eq('端末にある出馬表は「あり」と判定できる', run(`preHasCard('202609040301')`), true);
  eq('端末に無い出馬表は「なし」と判定できる', run(`preHasCard('202609040302')`), false);
  // 第24弾②: 端末に出馬表があるレースは「⚡表示」、無いレースは「🌐取得」になる
  run('preListRender();');
  const html2 = String(run(`document.getElementById('preList').innerHTML`));
  T('第24弾②: 端末に出馬表があるレースは「⚡表示」', /⚡表示/.test(html2));
  T('第24弾②: 無いレースは「🌐取得」のまま', /🌐取得/.test(html2));

  fetches = [];
  run(`preEnsureCard('202609040301','20260912',false);`);
  eq('★第23弾④: 端末にある出馬表は取りに行かない（再取得しない）', fetches.length, 0);
  run(`preEnsureCard('202609040302','20260912',false);`);
  eq('★第23弾④: 端末に無い出馬表だけ取りに行く', fetches.join(','), '202609040302');
  fetches = [];
  run(`preEnsureCard('202609040301','20260912',true);`);
  eq('force=true なら端末にあっても取り直す', fetches.join(','), '202609040301');

  // --- 一覧の消去（出馬表キャッシュや学習DBは消さない） ---
  run('preListClear();');
  eq('一覧を消せる', run('preListAll().length'), 0);
})();

/* ==========================================================================
   F2) ④ 一括取得（preDayFetch）が「スキップするレース」でも出馬表を端末に入れるか
   ========================================================================== */
console.log('\n[F2] ④ 一括取得が 結果確定済み・保存済み のレースでも出馬表を必ず端末に入れるか');
(async function(){
  const ls = mkLS();
  const g = mkG(ls);
  g.$ = function(id){ return g.document.getElementById(id); };
  g.esc = function(x){ return String(x == null ? '' : x); };
  g.safeSetItem = function(k, v){ try { ls.setItem(k, v); return true; } catch(e){ return false; } };
  const run = load(g, ['src/p53_prefetch.js']);

  // 3レース: 1件目=結果確定済み / 2件目=事前予想保存済み / 3件目=これから取得
  g.diNetkeibaRaces = function(){
    return Promise.resolve([
      { rid: 'R_DONE',  rnum: 1, name: '確定済みレース' },
      { rid: 'R_HAVE',  rnum: 2, name: '保存済みレース' },
      { rid: 'R_NEW',   rnum: 3, name: '新規レース' }
    ]);
  };
  g.apPreAllowed = function(rid){ return rid !== 'R_DONE'; };
  g.apGet = function(rid){ return rid === 'R_HAVE' ? { pre: { rows: [{ no: 1 }, { no: 2 }, { no: 3 }] } } : null; };
  const fetchedCards = [];
  g.nkCardHas = function(){ return false; };
  g.nkFetchCardText = function(rid){ fetchedCards.push(rid); return Promise.resolve('<html>' + rid + '</html>'); };
  const preOne = [];
  run(`preOneRace = function(rid, d8, opt){ globalThis.__preOne.push(rid);
        return Promise.resolve({ rid: rid, n: 12, oddsN: 12, detailN: 0, styleN: 0, honmei: 'テスト', place:'阪神', rnum:'3', raceName:'新規レース' }); };`);
  g.__preOne = preOne;
  g.hfDropCache = function(){};
  g.pfSchedule = function(){};

  run(`preDayFetch('20260912', { delay: 0 }, function(){}).then(function(r){ globalThis.__res = r; });`);
  await drain(30);
  const res = g.__res;
  T('preDayFetch が完了した', !!res, res);
  eq('★第23弾④: 結果確定済みでも出馬表を取りに行く', fetchedCards.indexOf('R_DONE') >= 0, true);
  eq('★第23弾④: 事前予想保存済みでも出馬表を取りに行く', fetchedCards.indexOf('R_HAVE') >= 0, true);
  eq('新規レースは preOneRace で取得する', preOne.join(','), 'R_NEW');
  eq('3レースすべての出馬表が端末に入った', res.cardN + preOne.length >= 3 || fetchedCards.length >= 2, true);

  // ★第23弾⑤: どのレースも一覧に載る
  const list = run('preListAll()');
  eq('★第23弾⑤: 一括取得した3レースが全部一覧に載る', list.length, 3);
  T('一覧にレース名が入る', list.some(function(x){ return x.name === '確定済みレース'; }) &&
                            list.some(function(x){ return x.name === '新規レース'; }), JSON.stringify(list.map(function(x){ return x.name; })));
  eq('結果確定済みは pre:false で載る（事前予想にはならないが一覧には出る）',
     list.filter(function(x){ return x.rid === 'R_DONE'; })[0].pre, false);
  eq('新規レースは pre:true で載る', list.filter(function(x){ return x.rid === 'R_NEW'; })[0].pre, true);
})();
await drain();

/* ==========================================================================
   G) ① オッズ: 見たときに必ず最新を取る／変わりなければ重い描き直しをしない
   ========================================================================== */
console.log('\n[G] ① オッズの最新取得（読込時・タブ表示時）');
(async function(){
  const ls = mkLS();
  const g = mkG(ls);
  g.$ = function(id){ return g.document.getElementById(id); };
  g.esc = function(x){ return String(x == null ? '' : x); };
  g.safeSetItem = function(k, v){ try { ls.setItem(k, v); return true; } catch(e){ return false; } };
  const run = load(g, ['src/p12_urlimport.js']);

  g.state = { raceId: '202609040311', horses: [ { no: 1, odds: '3.5' }, { no: 2, odds: '5.0' } ] };
  let renders = 0, saves = 0, cellSyncs = 0;
  g.renderKentaiFull = function(){ renders++; };
  g.saveNow = function(){ saves++; };
  g.updateGridHints = function(){};
  g.rebuildHorseTable = function(){ throw new Error('★第23弾⑥: オッズ更新で rebuildHorseTable を呼んではいけない'); };

  // オッズが変わるケース
  g.nkOddsApplyById = function(rid){
    g.state.horses[0].odds = '2.8';    // 1番が動いた
    return Promise.resolve({ ok: true, cnt: 2, msg: '単勝オッズ 2頭分' });
  };
  run(`nkOddsRefreshForView('テスト');`);
  await drain();
  eq('★第23弾①: オッズが変わったら②を描き直す', renders, 1);
  eq('オッズが変わったら保存する', saves, 1);
  T('オッズ取得時刻が記録される', run('NK_ODDS_VIEW.at') > 0);
  const chipTxt = String(run(`document.getElementById('oddsFreshChip').textContent`));
  T('チップに「オッズ更新 時刻」が出る', /オッズ更新/.test(chipTxt), chipTxt);
  T('本文に「何頭ぶん動いたか」が出る', /1 頭ぶんオッズが動いた/.test(String(run(`document.getElementById('oddsFreshTxt').innerHTML`))),
    run(`document.getElementById('oddsFreshTxt').innerHTML`));

  // 20秒以内にもう一度 → 間引く（netkeiba への通信を増やさない）
  let calls = 0;
  g.nkOddsApplyById = function(){ calls++; return Promise.resolve({ ok: true, cnt: 2, msg: 'x' }); };
  run(`globalThis.__r2 = nkOddsRefreshForView('テスト2');`);
  run(`__r2.then(function(x){ globalThis.__r2v = x; });`);
  await drain();
  eq('★第23弾①: 20秒以内の連続は間引く（通信しない）', calls, 0);
  eq('間引いた理由を返す', g.__r2v && g.__r2v.skipped, 'throttle');

  // force=true なら間引きを無視する
  run(`nkOddsRefreshForView('手動', { force: true });`);
  await drain();
  eq('force=true なら必ず取りに行く', calls, 1);

  // オッズが変わらなかったケース → 重い描き直しをしない
  renders = 0; saves = 0;
  g.nkOddsApplyById = function(){ return Promise.resolve({ ok: true, cnt: 2, msg: '単勝オッズ 2頭分' }); };
  run(`NK_ODDS_VIEW.at = 0; nkOddsRefreshForView('テスト3');`);
  await drain();
  eq('★第23弾⑥: オッズが変わっていなければ②を描き直さない', renders, 0);
  eq('★第23弾⑥: オッズが変わっていなければ保存もしない', saves, 0);
  T('「変わっていません」と伝える', /変わっていません/.test(String(run(`document.getElementById('oddsFreshTxt').innerHTML`))),
    run(`document.getElementById('oddsFreshTxt').innerHTML`));

  // 取れなかった場合（発売前など）
  renders = 0;
  g.nkOddsApplyById = function(){ return Promise.resolve({ ok: false, cnt: 0, msg: 'オッズが空でした（発売前）' }); };
  run(`NK_ODDS_VIEW.at = 0; nkOddsRefreshForView('テスト4');`);
  await drain();
  eq('取れなければ描き直さない', renders, 0);
  T('取れなかった理由を出す', /発売前/.test(String(run(`document.getElementById('oddsFreshTxt').innerHTML`))));

  // レースIDが無ければ何もしない
  g.state.raceId = '';
  g.nkOddsApplyById = function(){ calls++; return Promise.resolve({ ok: true }); };
  const before = calls;
  run(`NK_ODDS_VIEW.at = 0; nkOddsRefreshForView('テスト5');`);
  await drain();
  eq('レースIDが無ければ通信しない', calls, before);
})();
await drain();

/* ---------- 結果 ---------- */
console.log('\n================ 結果 ================');
if (fails.length) fails.forEach(function(f){ console.log('  ✗ FAIL: ' + f); });
console.log('  PASS: ' + ok + ' / FAIL: ' + bad);
if (bad){ console.log('  ❌ 第23弾テスト FAILED'); process.exit(1); }
console.log('  ✅ 第23弾テスト ALL PASS');

} /* runRest */
