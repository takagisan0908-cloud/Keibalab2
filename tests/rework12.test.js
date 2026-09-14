/* 2026-09-13 第20弾 の回帰テスト
   実行: node tests/rework12.test.js

   検証内容:
     A) 開催週の「土曜」→「水曜」の日付計算（amWeekSat / amCleanD8）
        … 結果確定前の開催週データは「その週の水曜日」に自動削除する、が正しく動くか
     B) amWeekClean の削除ルール
        ・結果が確定している(rec.result あり)レコードは絶対に消さない
        ・まだ今週ぶん（水曜が来ていない）は消さない
        ・事前予想(rec.pre)が無いものは消さない
        ・レース日が分からないものは消さない（安全側）
        ・1日1回だけ走る（lastClean）／force=true なら何度でも
        ・消したら apDelRec が呼ばれてレコードが本当に消える
     C) 🤖自動マクロ (B)→(A) の直列実行
        ・amAfterImport が「全馬データ(hdLoadAll)」→「上3F・前走タイム(nkFetchAll)」→
          「その日の他レース自動検出(preDayFetch)」の順に、必ず順番に走る
          （preDayFetch は state.horses を一時差し替えするので並行してはいけない）
        ・☑がOFFのときは何も走らない
        ・出馬表が無い／netkeiba馬IDが無いときはスキップ
     D) 🤖自動マクロ (D) ⑥の過去10年分析 → 🧬血統ファクター抽出 の自動連鎖
        ・drFinishRun の完了点から amDrChain が呼ばれ、bfRunExtract(true) が走る
        ・samples が無いときは走らない／二重に走らない(busy ガード)
     E) 関数化の確認
        ・p31 の bfDrBtn ハンドラが bfRunExtract 1本になり、旧ハンドラの孤児コードが消えた
        ・hdLoadAll / nkFetchAll が Promise を返す（マクロ連鎖の前提）
        ・p40 が p34 のキャッシュ(khl_hd_v1)を写して使う（同じ馬を2回取りに行かない）
     F) 組み込み確認（index.html / build.py / p10_main.js）
*/
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let ok = 0, bad = 0;
function T(name, cond, extra){
  if (cond) { ok++; }
  else { bad++; console.log('  ✗ FAIL: ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function eq(name, got, want){
  const g = JSON.stringify(got), w = JSON.stringify(want);
  T(name + ' (' + g + ' == ' + w + ')', g === w, { got: got, want: want });
}
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
  const el = { id: id || '', value: '', _html: '', style: {}, dataset: {}, checked: false, disabled: false, open: false,
    classList: { _s: new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); }, contains(c){ return this._s.has(c); },
      toggle(c, f){ if (f === undefined){ this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { f ? this._s.add(c) : this._s.delete(c); } } },
    _attrs: {},
    setAttribute(k, v){ this._attrs[k] = String(v); }, getAttribute(k){ return this._attrs[k] == null ? null : this._attrs[k]; },
    addEventListener(){}, appendChild(){}, focus(){}, closest(){ return null; },
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
    setTimeout(fn2){ try { fn2(); } catch(e){ console.log('  setTimeout err', e && e.message); } return 0; },
    clearTimeout(){}, setInterval(){ return 0; }, clearInterval(){},
    requestAnimationFrame(){ return 0; }, cancelAnimationFrame(){},
    localStorage: ls, addEventListener(){}, devicePixelRatio: 1, innerWidth: 980,
    navigator: {}, window: null, fetch(){ return Promise.reject(new Error('no fetch in test')); },
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
  files.forEach(function(f){ code += fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n'; });
  vm.runInContext(code, g, { filename: 'keiba.js' });
  return function(src){ return vm.runInContext(src, g); };
}
const tick = () => new Promise(r => setTimeout(r, 0));

console.log('rework12(第20弾): 🤖自動マクロ（他レース自動検出 / 全馬データ→上3F連鎖 / 未確定週の水曜自動削除 / ⑥→🧬血統連鎖）');

/* ============================================================
   A) 開催週の日付計算
   ============================================================ */
async function sectionA(){
  console.log(' A. 開催週の土曜→水曜（自動削除日）の日付計算');
  const g = mkG(mkLS());
  const run = load(g, ['src/p3_core.js', 'src/p59_automacro.js']);

  // 2026-09-12 は土曜。2026-09-13 は日曜。
  eq('amWeekSat(土曜) はそのまま', run('amWeekSat("20260912")'), '20260912');
  eq('amWeekSat(日曜) は前の土曜', run('amWeekSat("20260913")'), '20260912');
  eq('amWeekSat(月曜・祝日開催) は前の土曜', run('amWeekSat("20260914")'), '20260912');
  eq('amWeekSat(火曜) は前の土曜', run('amWeekSat("20260915")'), '20260912');
  eq('amWeekSat(水曜) は前の土曜', run('amWeekSat("20260916")'), '20260912');
  eq('amWeekSat(金曜) は前の土曜', run('amWeekSat("20260918")'), '20260912');
  eq('amWeekSat(翌土曜) は翌週の土曜', run('amWeekSat("20260919")'), '20260919');

  // 削除してよい日＝土曜+4日＝水曜
  eq('amCleanD8(2026/9/12 土) → 2026/9/16(水)', run('amCleanD8("20260912")'), '20260916');
  eq('amCleanD8(2026/9/13 日) → 2026/9/16(水)', run('amCleanD8("20260913")'), '20260916');
  eq('amCleanD8(2026/9/14 月・振替開催) → 2026/9/16(水)', run('amCleanD8("20260914")'), '20260916');

  // 月をまたぐ／年をまたぐ
  eq('月末をまたぐ: 2026/9/26(土) → 2026/9/30(水)', run('amWeekSat("20260926")'), '20260926');
  eq('月末をまたぐ削除日', run('amCleanD8("20260926")'), '20260930');
  eq('月をまたぐ: 2026/10/3(土) の週の日曜(10/4) → 10/3', run('amWeekSat("20261004")'), '20261003');
  eq('月をまたぐ削除日: 2026/9/29(火) → 9/26(土)+4=9/30(水)', run('amCleanD8("20260929")'), '20260930');
  // ★平日（水〜金）の単独開催は「削除日＝開催当日」にならないこと（レース前に消さない）
  eq('水曜開催 2026/9/16 → 翌週の水曜 2026/9/23（当日には消さない）', run('amCleanD8("20260916")'), '20260923');
  eq('木曜開催 2026/9/17 → 2026/9/23(水)', run('amCleanD8("20260917")'), '20260923');
  eq('金曜開催 2026/9/18 → 2026/9/23(水)', run('amCleanD8("20260918")'), '20260923');
  eq('amNormDate: 2026/9/12 → 20260912', run('amNormDate("2026/9/12")'), '20260912');
  eq('amNormDate: 2026-09-12 → 20260912', run('amNormDate("2026-09-12")'), '20260912');
  eq('amNormDate: 2026年9月12日 → 20260912', run('amNormDate("2026年9月12日")'), '20260912');
  eq('amNormDate: ゴミ → 空', run('amNormDate("中山11R")'), '');
  eq('年をまたぐ: 2026/12/31(木) の週の土曜', run('amWeekSat("20261231")'), '20261226');
  eq('年をまたぐ削除日: 2027/1/2(土) → 2027/1/6(水)', run('amCleanD8("20270102")'), '20270106');

  // 不正入力
  eq('amWeekSat(不正) は空', run('amWeekSat("abc")'), '');
  eq('amCleanD8(空) は空', run('amCleanD8("")'), '');
  eq('amWeekSat(race_id を渡しても日付ではないので無視できる形式)', run('amWeekSat("202609060411")'), '');
  eq('amLabel(20260916) → 2026/09/16', run('amLabel("20260916")'), '2026/09/16');

  // amRecD8: race_id の先頭8桁は日付ではないので絶対に使わない
  run(`globalThis.__REC = { meta: { date8: '20260912' }, pre: { d8: '20260912', rows: [1] } };`);
  eq('amRecD8 は meta.date8 を使う', run('amRecD8(globalThis.__REC, "202609060411")'), '20260912');
  run(`globalThis.__REC2 = { pre: { d8: '20260913', rows: [1] } };`);
  eq('meta が無ければ pre.d8 にフォールバック', run('amRecD8(globalThis.__REC2, "202609060411")'), '20260913');
  run(`globalThis.__REC3 = { meta: { date: '2026/9/12' }, pre: { rows: [1] } };`);
  eq('meta.date が 2026/9/12 形式でも拾える', run('amRecD8(globalThis.__REC3, "202609060411")'), '20260912');
  eq('日付がどこにも無ければ空（＝消さない）', run('amRecD8({ pre: { rows: [1] } }, "202609060411")'), '');
}

/* ============================================================
   B) amWeekClean の削除ルール
   ============================================================ */
async function sectionB(){
  console.log(' B. 未確定の開催週データを水曜日に自動削除する');
  const ls = mkLS();
  const g = mkG(ls);
  const run = load(g, ['src/p3_core.js', 'src/p59_automacro.js']);

  // apScan / apDelRec をスタブで用意（p59 のロジックだけを直接検証する）
  run(`
    globalThis.__DB = {};
    globalThis.__DELETED = [];
    apScan = function(){ return globalThis.__DB; };
    apDelRec = function(rid){ globalThis.__DELETED.push(String(rid)); delete globalThis.__DB[rid]; return true; };
    preRenderCount = function(){}; vtRender = function(){};
  `);

  // 2026/9/16(水) を「今日」として、
  //   ・9/12(土) の週 = 削除日 9/16(水) → 今日なので【消える】
  //   ・9/19(土) の週 = 削除日 9/23(水) → まだ来ていないので【残る】
  run(`
    globalThis.__DB = {
      // 未確定＋事前予想あり＋先週の開催 → 消える
      'A_OLD_UNSETTLED': { rid:'A_OLD_UNSETTLED', meta:{ date8:'20260912' }, pre:{ d8:'20260912', rows:[{no:1}] }, result: null },
      // 結果と照合済み → 絶対に消さない
      'B_SETTLED':       { rid:'B_SETTLED',       meta:{ date8:'20260912' }, pre:{ d8:'20260912', rows:[{no:1}] }, result:{ order:[1,2,3] } },
      // まだ今週ぶん（水曜が来ていない） → 消さない
      'C_THISWEEK':      { rid:'C_THISWEEK',      meta:{ date8:'20260920' }, pre:{ d8:'20260920', rows:[{no:1}] }, result: null },
      // 未来のレース → 消さない
      'D_FUTURE':        { rid:'D_FUTURE',        meta:{ date8:'20261010' }, pre:{ d8:'20261010', rows:[{no:1}] }, result: null },
      // 事前予想が無い（学習DBから取り込んだだけ） → 対象外
      'E_NOPRE':         { rid:'E_NOPRE',         meta:{ date8:'20260905' }, pre:{ rows:[] }, result: null },
      // レース日がどこにも無い → 安全側で消さない
      'F_NODATE':        { rid:'F_NODATE',        pre:{ rows:[{no:1}] }, result: null },
      // 水曜の単独開催 → 削除日は翌週の水曜(9/23)なので消さない
      'G_WEDRACE':       { rid:'G_WEDRACE',       meta:{ date8:'20260916' }, pre:{ d8:'20260916', rows:[{no:1}] }, result: null },
      // 月曜の振替開催(9/14) → 9/12(土)の週なので削除日 9/16(水)＝今日 → 消える
      'K_MONRACE':       { rid:'K_MONRACE',       meta:{ date8:'20260914' }, pre:{ d8:'20260914', rows:[{no:1}] }, result: null }
    };
  `);
  let r = run('amWeekClean(true, "20260916")');
  eq('スキャン件数', r.scan, 8);
  eq('削除件数（9/12土〜9/14月の未確定 2件のみ）', r.del, 2);
  eq('消えたのは 土曜開催＋月曜振替 の2件だけ', run('globalThis.__DELETED').sort(), ['A_OLD_UNSETTLED','K_MONRACE']);
  eq('結果照合済みは保持', r.keepSettled, 1);
  eq('今週ぶん・未来・水曜単独開催は保持', r.keepWeek, 3);
  eq('事前予想なしは対象外', r.keepNoPre, 1);
  eq('日付不明は消さない', r.noDate, 1);
  eq('DB に結果照合済みレコードが残っている', run('!!globalThis.__DB["B_SETTLED"]'), true);
  eq('DB に今週ぶんが残っている', run('!!globalThis.__DB["C_THISWEEK"]'), true);
  eq('DB に水曜単独開催が残っている（レース前に消さない）', run('!!globalThis.__DB["G_WEDRACE"]'), true);
  eq('DB に月曜振替開催は消えている', run('!!globalThis.__DB["K_MONRACE"]'), false);
  eq('DB に日付不明が残っている', run('!!globalThis.__DB["F_NODATE"]'), true);

  // 水曜より前（9/15 火）なら、まだ消さない
  run(`globalThis.__DELETED = [];
       globalThis.__DB['H_OLD2'] = { rid:'H_OLD2', meta:{ date8:'20260913' }, pre:{ d8:'20260913', rows:[{no:1}] }, result: null };`);
  r = run('amWeekClean(true, "20260915")');
  eq('9/15(火) の時点では 9/13(日) の週ぶんを消さない（削除日は 9/16 水）', run('globalThis.__DELETED'), []);
  r = run('amWeekClean(true, "20260916")');
  eq('9/16(水) になったら消す', run('globalThis.__DELETED'), ['H_OLD2']);

  // 1日1回だけ（lastClean）
  run(`globalThis.__DELETED = [];
       globalThis.__DB['I_OLD3'] = { rid:'I_OLD3', meta:{ date8:'20260905' }, pre:{ d8:'20260905', rows:[{no:1}] }, result: null };`);
  r = run('amWeekClean(false, "20260916")');
  eq('同じ日の2回目（非force）は何もしない', r.ran, false);
  eq('消していない', run('globalThis.__DELETED'), []);
  r = run('amWeekClean(true, "20260916")');
  eq('force=true なら同じ日でも実行する', r.ran, true);
  eq('force=true で消えた', run('globalThis.__DELETED'), ['I_OLD3']);

  // ☑OFF のときは非forceでは動かない
  run(`amSet('weekClean', false); globalThis.__DELETED = [];
       globalThis.__DB['J_OLD4'] = { rid:'J_OLD4', meta:{ date8:'20260905' }, pre:{ d8:'20260905', rows:[{no:1}] }, result: null };`);
  r = run('amWeekClean(false, "20260917")');
  eq('(C)がOFFなら自動では消さない', run('globalThis.__DELETED'), []);
  r = run('amWeekClean(true, "20260917")');
  eq('「🧹 今すぐ掃除する」(force) は☑に関係なく動く', run('globalThis.__DELETED'), ['J_OLD4']);

  // 実物の apDelRec（p30）が localStorage から本当に消すか
  const g2 = mkG(mkLS());
  const run2 = load(g2, ['src/p3_core.js', 'src/p5_engine.js', 'src/p14_history.js', 'src/p30_learnrec.js']);
  run2(`
    apMode = 'ls'; apRecMem = null;
    apLsSetRec('202609060411', { rid:'202609060411', meta:{ date8:'20260912' }, pre:{ rows:[{no:1}] }, result:null });
    apLsSetRec('202609060412', { rid:'202609060412', meta:{ date8:'20260912' }, pre:{ rows:[{no:1}] }, result:{ order:[1] } });
  `);
  eq('apScan で2件見える', run2('Object.keys(apScan()).length'), 2);
  eq('apDelRec が true を返す', run2('apDelRec("202609060411")'), true);
  eq('消した1件だけ残る', run2('Object.keys(apScan())'), ['202609060412']);
  eq('結果ありのレコードは残っている', run2('!!apScan()["202609060412"].result'), true);

  // amPending（貯まり具合）
  run(`amSet('weekClean', true);
       globalThis.__DB = {
         'P1': { meta:{ date8:'20260905' }, pre:{ rows:[{no:1}] }, result:null },
         'P2': { meta:{ date8:'20260906' }, pre:{ rows:[{no:1}] }, result:null },
         'P3': { meta:{ date8:'20260912' }, pre:{ rows:[{no:1}] }, result:{ order:[1] } }
       };`);
  const pd = run('amPending()');
  eq('未確定の事前予想は2件（結果照合済みは数えない）', pd.n, 2);
  eq('開催週は1週ぶん', pd.weeks, 1);
  eq('最も古い日', pd.oldest, '20260905');
}

/* ============================================================
   C) (B)→(A) の直列実行
   ============================================================ */
async function sectionC(){
  console.log(' C. 出馬表＋オッズ取得 → 全馬データ → 上3F → 他レース自動検出（直列）');
  const g = mkG(mkLS());
  const run = load(g, ['src/p3_core.js', 'src/p59_automacro.js']);

  run(`
    globalThis.__LOG = [];
    globalThis.__BUSY = { now: '', overlap: 0 };
    function __enter(name){
      if (globalThis.__BUSY.now){ globalThis.__BUSY.overlap++; }
      globalThis.__BUSY.now = name;
    }
    function __leave(){ globalThis.__BUSY.now = ''; }
    state = { horses: [], meta: {}, race: {} };
    hdLoadAll = function(force){
      __enter('hd'); globalThis.__LOG.push('hdLoadAll:' + (force === false ? 'cached' : 'force'));
      return new Promise(function(res){ setTimeout(function(){ __leave(); res({ ok: 8, total: 10 }); }, 0); });
    };
    nkFetchAll = function(){
      __enter('nk'); globalThis.__LOG.push('nkFetchAll');
      return new Promise(function(res){ setTimeout(function(){ __leave(); res({ ok: 7 }); }, 0); });
    };
    preDayFetch = function(d8, opt, progress){
      __enter('day'); globalThis.__LOG.push('preDayFetch:' + d8 + ':odds=' + !!opt.odds + ':detail=' + !!opt.detail);
      if (progress) progress('1/3 レース');
      return new Promise(function(res){ setTimeout(function(){ __leave(); res({ ok: 11, skipHave: 1, skipDone: 0, fail: 0 }); }, 0); });
    };
    nkAutoFill = function(){}; rebuildHorseTable = function(){}; renderKentaiFull = function(){};
    aihRender = function(){}; preRenderCount = function(){}; apRender = function(){};
  `);

  // 出馬表が無い → スキップ
  let r = run('amHorseMacro("202609060411")');
  r = await r;
  eq('出馬表が無ければ何もしない', r.skip, true);

  // nk（netkeiba競走馬ID）が無い → スキップ
  run(`state.horses = [{ no:'1', name:'ウマA' }, { no:'2', name:'ウマB' }]; globalThis.__LOG = [];`);
  r = await run('amHorseMacro("202609060411")');
  eq('netkeiba馬IDが無ければ何もしない', r.skip, true);
  eq('ログは空', run('globalThis.__LOG'), []);

  // 正常系: hdLoadAll(false) → nkFetchAll → preDayFetch の順
  run(`state.horses = [{ no:'1', name:'ウマA', nk:'0000012345' }, { no:'2', name:'ウマB', nk:'0000067890' }];
       globalThis.__LOG = []; globalThis.__BUSY.overlap = 0;
       amSet('horse', true); amSet('dayAll', true); amSet('detail', false);`);
  run(`globalThis.__R = null; amAfterImport('202609060411', '20260912').then(function(x){ globalThis.__R = x; });`);
  await tick(); await tick(); await tick(); await tick(); await tick(); await tick();
  eq('hdLoadAll → nkFetchAll → preDayFetch の順に走った',
     run('globalThis.__LOG'),
     ['hdLoadAll:cached', 'nkFetchAll', 'preDayFetch:20260912:odds=true:detail=false']);
  eq('並行実行していない（state.horses の差し替えが衝突しない）', run('globalThis.__BUSY.overlap'), 0);
  eq('キャッシュ優先（hdLoadAll(false)）で呼んでいる', run('globalThis.__LOG[0]'), 'hdLoadAll:cached');
  eq('馬柱取得は既定OFF（時間がかかるため）', /detail=false/.test(run('globalThis.__LOG[2]')), true);
  const R = run('globalThis.__R');
  eq('preDayFetch の結果が返る', R && R.ok, 11);

  // 状態表示が出ている
  const st = run('$("amStat").innerHTML');
  T('完了メッセージに保存レース数が出る', /事前予想を保存/.test(st) && /11/.test(st), st.slice(0, 120));

  // ☑OFF のとき
  run(`amSet('horse', false); amSet('dayAll', false); globalThis.__LOG = []; globalThis.__R = null;
       amAfterImport('202609060411', '20260912').then(function(x){ globalThis.__R = x; });`);
  await tick(); await tick(); await tick();
  eq('両方OFFなら何も走らない', run('globalThis.__LOG'), []);

  // (B)だけON
  run(`amSet('horse', true); amSet('dayAll', false); globalThis.__LOG = []; globalThis.__R = null;
       amAfterImport('202609060411', '20260912').then(function(x){ globalThis.__R = x; });`);
  await tick(); await tick(); await tick(); await tick();
  eq('(B)だけONなら 全馬データ→上3F のみ', run('globalThis.__LOG'), ['hdLoadAll:cached', 'nkFetchAll']);

  // 日付が分からないとき (A) はスキップ（誤った日のレースを取りに行かない）
  run(`amSet('dayAll', true); amSet('horse', false); globalThis.__LOG = []; globalThis.__R = null;
       amAfterImport('202609060411', '').then(function(x){ globalThis.__R = x; });`);
  await tick(); await tick();
  eq('日付が無ければ preDayFetch を呼ばない', run('globalThis.__LOG'), []);

  // busy ガード（二重実行しない）
  run(`amSet('horse', true); globalThis.__LOG = [];
       globalThis.__P1 = amHorseMacro('202609060411');
       globalThis.__P2 = amHorseMacro('202609060411');`);
  const r2 = await run('globalThis.__P2');
  eq('実行中の2回目はスキップ', r2.skip, true);
  await run('globalThis.__P1');

  // エラーが来ても busy が解除され、次が動く
  run(`hdLoadAll = function(){ return Promise.reject(new Error('netkeiba に繋がらない')); };
       globalThis.__E = null; amHorseMacro('202609060411').then(function(x){ globalThis.__E = x; });`);
  await tick(); await tick();
  const E = run('globalThis.__E');
  T('エラーを投げずに理由を返す（タブが固まらない）', !!(E && E.err), E);
  eq('エラー後も busy が解除されている', run('AM_BUSY.horse'), false);
  const est = run('$("amStat").innerHTML');
  T('エラー内容が画面に出る', /netkeiba に繋がらない/.test(est), est.slice(0, 120));

  // kaiImportByRaceId（①日付からレース選択）に自動マクロが組み込まれている
  const kai = fs.readFileSync(path.join(ROOT, 'src/p26_kaisai.js'), 'utf8');
  T('kaiImportByRaceId が amAfterImport を呼ぶ（オッズ取得成功時）', /amAfterImport\(rid, amD8\)/.test(kai));
  T('kaiImportByRaceId が amAfterImport を呼ぶ（オッズ取得失敗時も出馬表は入っているので動かす）',
    /amAfterImport\(rid, amD8b\)/.test(kai));
}

/* ============================================================
   D) ⑥の過去10年分析 → 🧬血統抽出 の自動連鎖
   ============================================================ */
async function sectionD(){
  console.log(' D. 重賞カレンダー→過去10年分析→🧬血統ファクター抽出 の自動連鎖');
  const g = mkG(mkLS());
  const run = load(g, ['src/p3_core.js', 'src/p59_automacro.js']);

  run(`
    globalThis.__BF = [];
    bfRunExtract = function(quiet){ globalThis.__BF.push(quiet); return Promise.resolve({ ok: 1, factors: 3 }); };
    amSet('drChain', true);
  `);

  // samples が無い（分析できていない）→ 走らせない
  run('globalThis.__BF = []; amDrChain(null);');
  eq('res が null なら血統抽出しない', run('globalThis.__BF'), []);
  run('globalThis.__BF = []; amDrChain({ samples: [] });');
  eq('samples が空なら血統抽出しない', run('globalThis.__BF'), []);

  // 正常系
  run('globalThis.__BF = []; amDrChain({ rid: "202609060411", samples: [{ year: 2025 }] });');
  await tick(); await tick();
  eq('分析が終わったら bfRunExtract(true)（自動モード）を呼ぶ', run('globalThis.__BF'), [true]);
  const st = run('$("amStat").innerHTML');
  T('完了メッセージが出る', /血統ファクター抽出/.test(st), st.slice(0, 120));

  // busy ガード
  run(`bfRunExtract = function(){ return new Promise(function(res){ setTimeout(function(){ res({ ok:1 }); }, 0); }); };
       globalThis.__N = 0;
       amDrChain({ samples: [1] }); amDrChain({ samples: [1] }); amDrChain({ samples: [1] });`);
  eq('実行中に3回来ても1回だけ（busy ガード）', run('AM_BUSY.bf'), true);
  await tick(); await tick(); await tick();
  eq('終わったら busy が解除される', run('AM_BUSY.bf'), false);

  // ☑OFF
  run(`amSet('drChain', false); globalThis.__BF = [];
       bfRunExtract = function(quiet){ globalThis.__BF.push(quiet); return Promise.resolve({ ok: 1 }); };
       amDrChain({ samples: [1] });`);
  await tick();
  eq('(D)がOFFなら血統抽出しない', run('globalThis.__BF'), []);

  // drFinishRun（全分析経路の共通完了点）に組み込まれている
  const dr = fs.readFileSync(path.join(ROOT, 'src/p36_datarace.js'), 'utf8');
  T('drFinishRun が amDrChain(res) を呼ぶ', /amDrChain\(res\)/.test(dr));
  const fnBody = dr.slice(dr.indexOf('function drFinishRun'));
  T('drFinishRun の中に amDrChain がある', fnBody.indexOf('amDrChain') >= 0 && fnBody.indexOf('amDrChain') < fnBody.indexOf('\nfunction '),
    fnBody.indexOf('amDrChain'));
}

/* ============================================================
   E) 関数化の確認（孤児コード除去 / Promise化 / キャッシュ再利用）
   ============================================================ */
async function sectionE(){
  console.log(' E. bfRunExtract の関数化・hdLoadAll/nkFetchAll の Promise化・キャッシュ再利用');
  const bf = fs.readFileSync(path.join(ROOT, 'src/p31_bloodfactor.js'), 'utf8');
  T('bfRunExtract が定義されている', /function bfRunExtract\(quiet\)/.test(bf));
  eq('bfRunExtract の定義は1つだけ', (bf.match(/function bfRunExtract/g) || []).length, 1);
  T('bfDrBtn のハンドラは bfRunExtract(false) 1行', /bfDrBtn[\s\S]{0,200}?bfRunExtract\(false\)/.test(bf));
  T('busy ガード(BF_EXTRACT_BUSY) がある', /BF_EXTRACT_BUSY/.test(bf));
  // 旧ハンドラの孤児コードが残っていないこと
  T('孤児コード（bfStatus(why, true) が関数の外にある）が消えた',
    (bf.match(/bfStatus\(why, true\)/g) || []).length === 1 && bf.indexOf('bfStatus(why, true)') > bf.indexOf('function bfRunExtract'));
  T('bfRunExtract の中で quiet 分岐がある', /if \(quiet\)\{ bfStatus/.test(bf));

  const g = mkG(mkLS());
  const run = load(g, ['src/p3_core.js', 'src/p31_bloodfactor.js']);
  T('p31 が構文エラーなく読み込める（孤児コードが無い）', typeof run('bfRunExtract') === 'function');

  // hdLoadAll / nkFetchAll が Promise を返す（ソース確認＋実呼び出し）
  const hd = fs.readFileSync(path.join(ROOT, 'src/p34_horsedetail.js'), 'utf8');
  T('hdLoadAll が Promise を返す（return ... がある）', /function hdLoadAll\(force\)[\s\S]{0,400}?return /.test(hd));
  const nk = fs.readFileSync(path.join(ROOT, 'src/p40_netkeiba.js'), 'utf8');
  T('nkFetchAll が Promise を返す', /function nkFetchAll\([\s\S]{0,400}?return /.test(nk));
  // p40 が p34 のキャッシュを写して使う（同じ馬を2回取りに行かない）
  T('nkFetchHorsePages が p34 のキャッシュ(khl_hd_v1)を再利用する', /khl_hd_v1/.test(nk));

  const g3 = mkG(mkLS());
  const run3 = load(g3, ['src/p3_core.js', 'src/p5_engine.js', 'src/p6_inputui.js', 'src/p34_horsedetail.js']);
  run3(`state = { horses: [], meta: {}, race: {} };`);
  let p = run3('hdLoadAll(false)');
  T('hdLoadAll(false) が then を持つ（Promise）', !!(p && typeof p.then === 'function'));
  p = await p;
  T('出馬表が無っても reject しない', p != null, p);

  const g4 = mkG(mkLS());
  const run4 = load(g4, ['src/p3_core.js', 'src/p5_engine.js', 'src/p6_inputui.js', 'src/p40_netkeiba.js']);
  run4(`state = { horses: [], meta: {}, race: {} };`);
  let q = run4('nkFetchAll()');
  T('nkFetchAll() が then を持つ（Promise）', !!(q && typeof q.then === 'function'));
  q = await q;
  T('出馬表が無っても reject しない', q != null, q);

  // apDelRec が追加されている
  const lr = fs.readFileSync(path.join(ROOT, 'src/p30_learnrec.js'), 'utf8');
  T('apDelRec が定義されている（IndexedDB / localStorage 両対応）',
    /function apDelRec\(rid\)/.test(lr) && /apIdbDelS\(AP_REC_STORE, rid\)/.test(lr) && /apLsDelRec\(rid\)/.test(lr));
}

/* ============================================================
   F) 組み込み確認
   ============================================================ */
function sectionF(){
  console.log(' F. index.html / build.py / p10_main.js への組み込み');
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  T('ビルド成果物に p59_automacro が入っている', /khl_am_v1/.test(idx) && /function amWeekClean/.test(idx));
  T('🤖自動マクロのカードがある', /id="amCard"/.test(idx));
  ['amChkDay','amChkHorse','amChkDetail','amChkClean','amChkDr','amCleanBtn','amPendingBtn','amPending','amMsg','amStat']
    .forEach(function(id){ T('☑/部品 #' + id + ' がある', idx.indexOf('id="' + id + '"') >= 0); });
  T('amInit が起動時に呼ばれる', /safeInit\('amInit', amInit\)/.test(idx));
  T('build.py の ORDER に p59_automacro がある',
    /'p59_automacro'/.test(fs.readFileSync(path.join(ROOT, 'build.py'), 'utf8')));
  // 連結順: p59 は p30/p34/p40/p53 より後（それらの関数を呼ぶため）
  const order = fs.readFileSync(path.join(ROOT, 'build.py'), 'utf8');
  const pos = function(n){ return order.indexOf("'" + n + "'"); };
  T('p59 は p30_learnrec より後', pos('p59_automacro') > pos('p30_learnrec'));
  T('p59 は p34_horsedetail より後', pos('p59_automacro') > pos('p34_horsedetail'));
  T('p59 は p40_netkeiba より後', pos('p59_automacro') > pos('p40_netkeiba'));
  T('p59 は p53_prefetch より後', pos('p59_automacro') > pos('p53_prefetch'));
  T('p59 は p31_bloodfactor より後', pos('p59_automacro') > pos('p31_bloodfactor'));
  T('p59 は p36_datarace より後', pos('p59_automacro') > pos('p36_datarace'));
}

(async function main(){
  try {
    await sectionA();
    await sectionB();
    await sectionC();
    await sectionD();
    await sectionE();
    sectionF();
  } catch(e){
    bad++;
    console.log('  ✗ ERROR: ' + ((e && e.stack) || e));
  }
  console.log('rework12: OK', ok, 'FAIL', bad);
  process.exit(bad ? 1 : 0);
})();
