/* 2026-09-13 第21弾 の回帰テスト
   実行: node tests/rework13.test.js

   検証内容:
     A) ①「📥 その日の出馬表を一括取得」で取った出馬表を、
        「📅 日付を選んで出馬表を取込」でレース選択したときに取り直さない（キャッシュから復元）
     B) ②🧠脚質のAI推定を自動マクロに紐づけ（取得済みデータだけを使う＝追加通信ゼロ）
     C) ③前走距離がおかしかった件（「前走の距離」と「持ちタイムの距離」を分離）
     D) ④🌊トラックバイアスを開催日に自動取得（発走+12分で確定見込み）＋開催週の水曜に自動削除
     E) ⑤🎛重み設定から「あなたの印」を削除＋レースごとの自動補正（オーバーレイ方式）
     F) ⑥🎯軸・💠妙味・🕳穴の「狙い目の理由」をオッズ妙味以外の実データからも出す
     G) 組み込み確認（index.html / build.py / p10_main.js）
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
function near(name, got, want, tol){
  const t = (tol == null) ? 1e-6 : tol;
  T(name + ' (' + got + ' ≈ ' + want + ')', got != null && Math.abs(got - want) <= t, { got: got, want: want });
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
function mkG(ls, fetchSpy){
  const els = {};
  const g = {
    console, Math, JSON, Date, String, Number, parseInt, parseFloat, isNaN, isFinite, RegExp,
    Array, Object, Boolean, Error, Promise, encodeURIComponent, decodeURIComponent,
    setTimeout(fn2){ try { fn2(); } catch(e){ console.log('  setTimeout err', e && e.message); } return 0; },
    clearTimeout(){}, setInterval(){ return 0; }, clearInterval(){},
    requestAnimationFrame(){ return 0; }, cancelAnimationFrame(){},
    localStorage: ls, addEventListener(){}, devicePixelRatio: 1, innerWidth: 980,
    navigator: {}, window: null,
    fetch(u, o){ if (fetchSpy) fetchSpy.push(String(u)); return Promise.reject(new Error('no fetch in test')); },
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
const HTML = '<html><body>' + ('x'.repeat(600)) + '</body></html>';   // 300字以上のダミー出馬表

console.log('rework13(第21弾): 出馬表キャッシュ / 脚質AI自動 / 前走距離 / バイアス自動取得 / 重み自動補正 / 狙い目の理由');

/* ============================================================
   A) 出馬表のキャッシュ（再取得しない）
   ============================================================ */
async function sectionA(){
  console.log(' A. ①一括取得で取った出馬表を、レース選択時に取り直さない');
  const spy = [];
  const g = mkG(mkLS(), spy);
  const run = load(g, ['src/p3_core.js', 'src/p12_urlimport.js']);

  // --- 保存 → 復元 ---
  eq('最初はキャッシュ無し', run('nkCardHas("202609060411")'), false);
  run('globalThis.__H = ' + JSON.stringify(HTML) + ';');
  eq('nkCardSet が true を返す', run('nkCardSet("202609060411", globalThis.__H, "20260912")'), true);
  eq('保存した件数', run('nkCardCount()'), 1);
  eq('nkCardHas が true になる', run('nkCardHas("202609060411")'), true);
  eq('復元したHTMLが一致する', run('nkCardGet("202609060411") === globalThis.__H'), true);

  // --- 通信せずに返る ---
  spy.length = 0;
  const r = await run(`globalThis.__R = null; nkFetchCardText("202609060411").then(function(t){ globalThis.__R = t; }); globalThis.__R`);
  await tick();
  const got = run('globalThis.__R');
  eq('nkFetchCardText がキャッシュから返す', got === run('globalThis.__H'), true);
  eq('fetch を1回も呼んでいない（＝再取得しない）', spy.length, 0);
  eq('キャッシュヒットがカウントされている', run('NK_CARD_STAT.hit > 0'), true);

  // --- force=true なら取り直す ---
  spy.length = 0;
  run(`nkRelayCandidates = function(){ return []; }; globalThis.__E = null;
       nkFetchCardText("202609060411", { force: true }).catch(function(e){ globalThis.__E = String(e.message || e); });`);
  await tick(); await tick();
  eq('force=true だとキャッシュを使わず通信しに行く', run('globalThis.__E != null'), true);

  /* --- 期限: 当日・未来＝その日の終わりまで / 過去＝7日 ---
     ★2026-09-13 第23弾④ で仕様を変更しました。
     旧: 当日ぶんは30分で期限切れ → 朝に一括取得しても午後には全レース取り直しになっていた
     新: 当日ぶんは「その日の終わり(23:59:59)」まで有効（最低30分は保証）
         出走取消・馬場変更を追いたいときは「🔄 取り直す（再取得）」でいつでも強制取得できます */
  run(`nkCardSet("R_TODAY", globalThis.__H, nkCardToday8());
       nkCardSet("R_PAST",  globalThis.__H, "20200104");`);
  eq('当日ぶんは有効', run('nkCardHas("R_TODAY")'), true);
  eq('過去ぶんも有効（7日）', run('nkCardHas("R_PAST")'), true);
  // 31分前に保存した当日ぶん → ★第23弾④: その日の終わりまでは有効（取り直さない）
  run(`(function(){ var o = nkCardLs(); o.h["R_TODAY"].t = Date.now() - 31*60*1000; nkCardSave(o); })();`);
  eq('当日ぶんは31分たっても有効（その日の終わりまで＝再取得せずパッと表示）', run('nkCardHas("R_TODAY")'), true);
  // 有効期間そのものの確認
  eq('当日ぶんのTTLは「その日の終わり」まで',
     run(`(function(){ var t = Date.now(); var ttl = nkCardTtlMs({ t: t, d8: nkCardToday8() });
            return (ttl > 0 && nkCardEndOfDay() - t === ttl) || ttl === NK_CARD_TTL_MIN; })()`), true);
  eq('当日ぶんのTTLは最低30分を保証する（深夜0時直前でも消えない）',
     run(`nkCardTtlMs({ t: nkCardEndOfDay() + 1000, d8: nkCardToday8() }) >= NK_CARD_TTL_MIN`), true);
  eq('過去ぶんのTTLは7日のまま', run(`nkCardTtlMs({ t: Date.now(), d8: "20200104" }) === NK_CARD_TTL_PAST`), true);
  eq('上限が2日ぶん（80件）に増えた', run('NK_CARD_MAX >= 80'), true);
  // 2日前に保存した過去ぶん → まだ有効
  run(`(function(){ var o = nkCardLs(); o.h["R_PAST"].t = Date.now() - 2*24*3600*1000; nkCardSave(o); })();`);
  eq('過去ぶんは2日たっても有効', run('nkCardHas("R_PAST")'), true);
  // 8日前 → 期限切れ
  run(`(function(){ var o = nkCardLs(); o.h["R_PAST"].t = Date.now() - 8*24*3600*1000; nkCardSave(o); })();`);
  eq('過去ぶんは7日で期限切れ', run('nkCardHas("R_PAST")'), false);

  // --- 件数の上限（古いものから追い出す） ---
  const BULK_N = run('NK_CARD_MAX') + 15;   // ★第23弾④: 上限が80件になったので、それを超えて入れる
  run(`nkCardClear();
       globalThis.__O = nkCardLs();
       globalThis.__BN = ${BULK_N};
       for (var i = 0; i < globalThis.__BN; i++){
         // i が大きいほど「新しく保存した」ことになるように、時刻を1分刻みでずらしてから入れる
         globalThis.__O.h['BULK_' + i] = { t: Date.now() - (globalThis.__BN + 60 - i) * 60000, s: globalThis.__H,
                                           d8: '202001' + ('0' + ((i % 28) + 1)).slice(-2), n: globalThis.__H.length };
       }
       nkCardPrune(globalThis.__O);
       nkCardSave(globalThis.__O);`);
  const cnt = run('nkCardCount()');
  T('件数が上限(' + run('NK_CARD_MAX') + ')以下に抑えられる（ got ' + cnt + ' ）', cnt <= run('NK_CARD_MAX'), cnt);
  eq('新しいぶんは残っている', run(`nkCardHas("BULK_" + (globalThis.__BN - 1))`), true);
  eq('一番古いぶんは追い出された', run('nkCardHas("BULK_0")'), false);
  // ★第23弾④: 合計バイトの上限も効く（学習DB・AI予想の保存を邪魔しないための安全弁）
  eq('byte上限の定数がある', run('NK_CARD_BYTES_MAX > 0'), true);
  T('実際の保存量がbyte上限を超えていない', run('nkCardBytes(nkCardLs())') <= run('NK_CARD_BYTES_MAX'),
    { got: run('nkCardBytes(nkCardLs())'), max: run('NK_CARD_BYTES_MAX') });

  // --- 300字未満のゴミは保存しない ---
  eq('短いHTMLは保存しない', run('nkCardSet("R_SHORT", "abc", "20200104")'), false);

  // --- 呼び出し側が force / d8 を渡しているか ---
  const kai = fs.readFileSync(path.join(ROOT, 'src/p26_kaisai.js'), 'utf8');
  T('kaiImportByRaceId が opt を受け取る', /function kaiImportByRaceId\(rid, opt\)/.test(kai));
  T('kaiImportByRaceId が nkFetchCardText に force/d8 を渡す',
    /nkFetchCardText\(rid, \{ force: !!opt\.force, d8: opt\.d8 \|\| '' \}\)/.test(kai));
  T('履歴の「再取得」ボタンは force:true（名前どおり必ず取り直す）',
    /data-refetch[\s\S]{0,200}?kaiImportByRaceId\(b\.getAttribute\('data-refetch'\), \{ force: true \}\)/.test(kai));
  T('キャッシュから復元したことをログに残す', /取得済みキャッシュから復元/.test(kai));
  const pre = fs.readFileSync(path.join(ROOT, 'src/p53_prefetch.js'), 'utf8');
  T('一括取得(preOneRace)も d8 を渡してキャッシュを温める', /nkFetchCardText\(rid, \{ d8: d8 \|\| ''/.test(pre));
  const rk = fs.readFileSync(path.join(ROOT, 'src/p33_racepicker.js'), 'utf8');
  T('レースピッカーが force 付きで呼べる', /kaiImportByRaceId\(s\.raceId, \{ force: !!force, d8: /.test(rk));
  T('レースピッカーに「🔄 取り直す（再取得）」ボタンがある', /id="rkLoadForce"/.test(rk));
  T('レースピッカーが取得済みかどうかを出す', /nkCardHas\(s\.raceId\)/.test(rk));
}

/* ============================================================
   B) 脚質AI推定を自動マクロに紐づけ（通信ゼロ）
   ============================================================ */
async function sectionB(){
  console.log(' B. 🧠脚質のAI推定がマクロに紐づき、取得済みデータだけで動く');
  const spy = [];
  const g = mkG(mkLS(), spy);
  const run = load(g, ['src/p3_core.js', 'src/p4_parse.js', 'src/p14_history.js', 'src/p52_histfeat.js', 'src/p15_styleai.js']);

  // p34/p40 の戦績行 → stPredict が使う形への写し
  run(`globalThis.__RECS = [
    { date:'2026/08/30', name:'3歳上1勝クラス', head:'16', no:'3', dist:'芝1600', baba:'良',
      order:2, pass:'4-4-3-3', last3:'34.1' },
    { date:'2026/07/19', name:'3歳上1勝クラス', head:'15', no:'7', dist:'芝1600', baba:'良',
      order:5, pass:'5-5-5-4', last3:'34.6' },
    { date:'2026/06/07', name:'3歳1勝クラス', head:'18', no:'2', dist:'芝1400', baba:'稍重',
      order:1, pass:'2-2-2-2', last3:'35.0' }
  ];`);
  const runs = run('stRecsToRuns(globalThis.__RECS)');
  eq('写した件数', runs.length, 3);
  eq('raceName に入る', runs[0].raceName, '3歳上1勝クラス');
  eq('heads に入る', runs[0].heads, '16');
  eq('passing に入る', runs[0].passing, '4-4-3-3');
  eq('order は数値', runs[0].order, 2);

  // --- ① p34(khl_hd_v1) のキャッシュを読む ---
  run(`hdLs = function(){ var o = {}; o[hdCacheKey ? hdCacheKey('0000012345') : 'x'] = { r: globalThis.__RECS, p: {} }; return o; };
       hdCacheKey = function(id){ return 'h:' + id; };
       hdLs = function(){ var o = {}; o['h:0000012345'] = { r: globalThis.__RECS, p: {} }; return o; };
       state = { horses: [ mkHorse({ no:'1', name:'ウマA', nk:'0000012345', style:'' }) ], meta:{}, race:{} };`);
  let c = run('stRunsForHorse(state.horses[0])');
  eq('🧾全馬データのキャッシュから取れる', c && c.src, '🧾全馬データ');
  eq('戦績の件数', c && c.runs.length, 3);

  // --- ② p40(keiba_nk_v1) のキャッシュにフォールバック ---
  run(`hdLs = function(){ return {}; };
       nkLs = function(){ return { h: { '0000012345': { recs: globalThis.__RECS } } }; };`);
  c = run('stRunsForHorse(state.horses[0])');
  eq('🐎馬データのキャッシュにフォールバック', c && c.src, '🐎馬データ');

  // --- ③ どれも無ければ null（＝勝手に通信しない） ---
  run(`nkLs = function(){ return { h: {} }; };`);
  eq('キャッシュが無ければ null（自動では通信しない）', run('stRunsForHorse(state.horses[0])'), null);

  // --- stRunFromCache: 空欄は埋める ---
  run(`hdLs = function(){ var o = {}; o['h:0000012345'] = { r: globalThis.__RECS }; return o; };
       rebuildHorseTable = function(){}; saveNow = function(){};
       globalThis.__S = null; stRunFromCache({}).then(function(x){ globalThis.__S = x; });`);
  spy.length = 0;
  await tick(); await tick();
  let S = run('globalThis.__S');
  eq('通信ゼロ（fetch を1回も呼んでいない）', spy.length, 0);
  eq('1頭に反映された', S && S.ok, 1);
  eq('空欄だった脚質が埋まった', S && S.filled, 1);
  eq('脚質が入った', run('state.horses[0].style'), run('stPredict(stRecsToRuns(globalThis.__RECS)).tag'));
  eq('出どころが ai', run('state.horses[0].styleSrc'), 'ai');
  eq('確信度も入る', run('state.horses[0].styleConf > 0'), true);

  // --- 手動入力は絶対に上書きしない ---
  run(`state.horses[0].style = '追込'; state.horses[0].styleSrc = 'manual';
       globalThis.__S2 = null; stRunFromCache({}).then(function(x){ globalThis.__S2 = x; });`);
  await tick(); await tick();
  eq('手動入力は上書きしない', run('state.horses[0].style'), '追込');
  eq('手動スキップがカウントされる', run('globalThis.__S2.skipManual'), 1);

  // --- 自動値は確信度しきい値未満なら上書きしない ---
  run(`state.horses[0].style = '逃げ'; state.horses[0].styleSrc = 'ai'; state.horses[0].styleConf = 0;
       globalThis.__S3 = null; stRunFromCache({ minConf: 101 }).then(function(x){ globalThis.__S3 = x; });`);
  await tick(); await tick();
  eq('確信度がしきい値未満なら上書きしない', run('state.horses[0].style'), '逃げ');
  eq('上書き0件', run('globalThis.__S3.over'), 0);

  run(`globalThis.__S4 = null; stRunFromCache({ minConf: 0 }).then(function(x){ globalThis.__S4 = x; });`);
  await tick(); await tick();
  eq('しきい値0なら上書きする', run('globalThis.__S4.over'), 1);

  // --- nk ID が無い馬は対象外 ---
  run(`state.horses = [ mkHorse({ no:'2', name:'ウマB', nk:'', style:'' }) ];
       globalThis.__S5 = null; stRunFromCache({}).then(function(x){ globalThis.__S5 = x; });`);
  await tick();
  eq('netkeiba馬IDが無ければ対象外', run('globalThis.__S5.noId'), 1);

  // --- 自動マクロ (B) が3段で走る ---
  const g2 = mkG(mkLS(), spy);
  const run2 = load(g2, ['src/p3_core.js', 'src/p59_automacro.js']);
  run2(`
    globalThis.__LOG = [];
    state = { horses: [ mkHorse({ no:'1', name:'ウマA', nk:'0000012345' }) ], meta:{}, race:{} };
    hdLoadAll = function(){ globalThis.__LOG.push('hdLoadAll'); return Promise.resolve({ ok:1, total:1 }); };
    nkFetchAll = function(){ globalThis.__LOG.push('nkFetchAll'); return Promise.resolve({ ok:1 }); };
    stRunFromCache = function(o){ globalThis.__LOG.push('stRunFromCache:' + o.minConf); return Promise.resolve({ ok:1, filled:1, over:0, noData:0 }); };
    nkAutoFill = function(){}; rebuildHorseTable = function(){}; renderKentaiFull = function(){}; aihRender = function(){};
    preDayFetch = function(){ globalThis.__LOG.push('preDayFetch'); return Promise.resolve({ ok:0, skipHave:0, skipDone:0, fail:0 }); };
    amSet('horse', true); amSet('style', true); amSet('dayAll', false);
    globalThis.__R = null; amHorseMacro('202609060411').then(function(x){ globalThis.__R = x; });
  `);
  await tick(); await tick(); await tick(); await tick();
  eq('全馬データ → 上3F → 脚質AI の順に走る', run2('globalThis.__LOG'),
     ['hdLoadAll', 'nkFetchAll', 'stRunFromCache:70']);
  const st = run2('$("amStat").innerHTML');
  T('完了メッセージに脚質AIの頭数が出る', /脚質AI/.test(st), st.slice(0, 140));

  // ☑OFF なら脚質は走らない
  run2(`amSet('style', false); globalThis.__LOG = []; globalThis.__R = null;
        amHorseMacro('202609060411').then(function(x){ globalThis.__R = x; });`);
  await tick(); await tick(); await tick();
  eq('(B)の脚質☑がOFFなら2段だけ', run2('globalThis.__LOG'), ['hdLoadAll', 'nkFetchAll']);

  // p6 の入力欄で手で脚質を変えたら manual になる
  const p6 = fs.readFileSync(path.join(ROOT, 'src/p6_inputui.js'), 'utf8');
  T('脚質を手入力したら styleSrc=manual になる', /f === 'style'\)\{ h\.styleSrc = el\.value\.trim\(\) \? 'manual' : ''/.test(p6));
}

/* ============================================================
   C) 前走距離（前走の実データと持ちタイムの距離を分離）
   ============================================================ */
async function sectionC(){
  console.log(' C. ③前走距離がおかしかった件（前走と持ちタイムを分離）');
  const g = mkG(mkLS());
  const run = load(g, ['src/p3_core.js', 'src/p4_parse.js', 'src/p45_yoso.js', 'src/p40_netkeiba.js']);

  // mkHorse に新しい項目がある
  const h0 = run('mkHorse({ no:"1", name:"ウマA" })');
  ['prevM','prevDate8','prevVenue','prevR','prevOrder','prevSurf','prevBaba','styleSrc','styleConf'].forEach(function(k){
    T('mkHorse に ' + k + ' がある', Object.prototype.hasOwnProperty.call(h0, k));
  });

  // --- 前走が今回と距離違い → 持ちタイムは「同コース種別の最速」から採用される ---
  run(`state = { horses: [], meta:{}, race:{ dist:'1600', place:'中山', baba:'良' } };
       readRaceMeta = function(){ return { dist:'1600', place:'中山', baba:'良', name:'', grade:'', time:'' }; };
       yoCourse = function(){ return { venue:'中山', surf:'芝', dist:1600, isYoso:false }; };
       /* 前走は今回(中山 芝1600)と【±200mを超える距離違い】＝ダ1200。
          このとき持ちタイムは「同じコース種別(野芝)・同距離の最速」から採用されるので、
          prevD(=持ちタイムの距離) と prevM(=前走の距離) が必ず食い違います。 */
       globalThis.__RUNS = [
         { date:'2026/08/30', venue:'2新潟', venueName:'新潟', r:'11', name:'長岡S', head:'15',
           dist:'ダ1200', surface:'ダ', baba:'良', order:4, pass:'8-8-7-6', last3:'37.9', time:'1:12.5', m:1200 },
         { date:'2026/06/07', venue:'3東京', venueName:'東京', r:'9', name:'由比浜S', head:'12',
           dist:'芝1600', surface:'芝', baba:'良', order:1, pass:'3-3-3-2', last3:'33.4', time:'1:32.1', m:1600 },
         { date:'2026/04/12', venue:'4阪神', venueName:'阪神', r:'10', name:'春風S', head:'16',
           dist:'芝1600', surface:'芝', baba:'良', order:2, pass:'5-5-4-4', last3:'34.0', time:'1:32.8', m:1600 }
       ];
       globalThis.__H = mkHorse({ no:'1', name:'ウマA', nk:'0000012345' });
       nkApplyOne(globalThis.__H, globalThis.__RUNS);`);
  eq('前走距離(prevM)は前走の実距離 1200', run('globalThis.__H.prevM'), 1200);
  eq('前走の日付', run('globalThis.__H.prevDate8'), '20260830');
  eq('前走の場', run('globalThis.__H.prevVenue'), '新潟');
  eq('前走のR', run('globalThis.__H.prevR'), '11');
  eq('前走の着順', run('globalThis.__H.prevOrder'), 4);
  eq('前走のコース', run('globalThis.__H.prevSurf'), 'ダ');
  eq('前走の馬場', run('globalThis.__H.prevBaba'), '良');
  eq('上3Fは前走ぶん', run('globalThis.__H.last3f'), '37.9');
  // 持ちタイムは前走(ダ1800)ではなく「同コース種別・同距離の最速」= 東京 芝1600 1:32.1
  eq('持ちタイムは同コース種別の最速', run('globalThis.__H.time'), '1:32.1');
  eq('prevD(=持ちタイムの距離)は 1600 で前走距離と違う', run('globalThis.__H.prevD'), '1600');
  eq('prevM(=前走距離)は 1200 のまま', run('globalThis.__H.prevM'), 1200);
  T('prevD と prevM がちゃんと別物（取り違えない）',
    run('String(globalThis.__H.prevD) !== String(globalThis.__H.prevM)'));
  eq('持ちタイムの出どころ', run('globalThis.__H.timeSrc'), 'same-course');

  // --- 前走が今回と同距離なら prevD === prevM ---
  run(`state.race.dist = '1600';
       globalThis.__H2 = mkHorse({ no:'2', name:'ウマB' });
       nkApplyOne(globalThis.__H2, globalThis.__RUNS.slice(1));`);
  eq('前走が同距離なら prevM=1600', run('globalThis.__H2.prevM'), 1600);
  eq('prevD も 1600', run('globalThis.__H2.prevD'), '1600');
  eq('出どころは prev', run('globalThis.__H2.timeSrc'), 'prev');

  // --- 持ちタイムが既に入っている馬でも前走情報は必ず埋まる（従来は空のままだった） ---
  run(`globalThis.__H3 = mkHorse({ no:'3', name:'ウマC', time:'1:33.0', prevD:'' });
       nkApplyOne(globalThis.__H3, globalThis.__RUNS);`);
  eq('持ちタイムが既にあれば前走距離が空だった → 必ず埋まる', run('globalThis.__H3.prevM'), 1200);
  eq('前走着順も埋まる', run('globalThis.__H3.prevOrder'), 4);
  eq('既存の持ちタイムは上書きしない', run('globalThis.__H3.time'), '1:33.0');

  // --- 持ちタイムが前走と一致するなら prevD を復元する ---
  run(`globalThis.__H4 = mkHorse({ no:'4', name:'ウマD', time:'1:12.5', prevD:'' });
       nkApplyOne(globalThis.__H4, globalThis.__RUNS);`);
  eq('持ちタイム＝前走タイムなら prevD に前走距離を復元', run('globalThis.__H4.prevD'), '1200');

  // --- 距離が読めない戦績でも prevD に 0 や NaN を入れない ---
  run(`globalThis.__H5 = mkHorse({ no:'5', name:'ウマE' });
       nkApplyOne(globalThis.__H5, [{ date:'2026/08/30', dist:'', order:1, last3:'34.0', time:'' }]);`);
  eq('距離が読めなければ prevM=0', run('globalThis.__H5.prevM'), 0);
  T('prevD に "0" や "NaN" を入れない', !/^(0|NaN)$/.test(String(run('globalThis.__H5.prevD'))), run('globalThis.__H5.prevD'));

  // --- 表示: 前走と持ちタイムが別の列 ---
  run(`globalThis.__ROW = nkSumRow(globalThis.__H, true, 'テスト');`);
  const row = run('globalThis.__ROW');
  eq('表の行に prevM が入る', row.prevM, 1200);
  eq('表の行に dist(=持ちタイムの距離) が別に入る', row.dist, '1600');
  eq('timeSrc が入る', row.timeSrc, 'same-course');
  const prevTxt = run('nkPrevText(globalThis.__ROW)');
  T('前走列に 08/30・新潟・ダ1200m・4着 が出る', /08\/30/.test(prevTxt) && /新潟/.test(prevTxt) && /ダ1200m/.test(prevTxt) && /4着/.test(prevTxt), prevTxt);
  const timeTxt = run('nkTimeText(globalThis.__ROW)');
  T('持ちタイム列に 1600m と出どころが出る', /1:32\.1/.test(timeTxt) && /1600m/.test(timeTxt) && /同コース種別/.test(timeTxt), timeTxt);
  T('前走列に持ちタイムの距離が混ざらない', !/1600m/.test(prevTxt), prevTxt);

  // 表の見出しが分かれている
  const src40 = fs.readFileSync(path.join(ROOT, 'src/p40_netkeiba.js'), 'utf8');
  T('表の見出しが「前走（日付・場・距離・着順）」と「持ちタイム（距離・出どころ）」に分かれた',
    /前走（日付・場・距離・着順）/.test(src40) && /持ちタイム（距離・出どころ）/.test(src40));
  T('古い「前走タイム/前走距離」の見出しが残っていない', !/<th>前走タイム<\/th><th>前走距離<\/th>/.test(src40));
}

/* ============================================================
   D) トラックバイアスの自動取得＋水曜削除
   ============================================================ */
async function sectionD(){
  console.log(' D. ④🌊トラックバイアスの自動取得（発走+12分）＋水曜削除');
  const spy = [];
  const g = mkG(mkLS(), spy);
  const run = load(g, ['src/p3_core.js', 'src/p59_automacro.js', 'src/p60_biasauto.js']);

  // 時刻の計算
  eq('baMinOf("10:30")', run('baMinOf("10:30")'), 630);
  eq('baMinOf("9:50")', run('baMinOf("9:50")'), 590);
  eq('baMinOf(ゴミ)', run('baMinOf("未定")'), null);
  eq('baHM(630)', run('baHM(630)'), '10:30');
  eq('baHM(59)', run('baHM(59)'), '00:59');

  // 発走+12分で「確定見込み」
  eq('BA_AFTER_MIN = 12', run('BA_AFTER_MIN'), 12);
  eq('BA_FINAL_MIN = 30', run('BA_FINAL_MIN'), 30);

  // --- レース一覧のスタブ ---
  run(`
    state = { horses: [], meta:{}, race:{}, biasRaces: [] };
    /* kaiParseList() が返す実際の形: venues[].races[] = { r, raceId, name, time, cond, count } */
    globalThis.__RACES = [
      { r:1,  raceId:'202609060401', name:'2歳未勝利',        time:'09:50', cond:'良', count:'16頭' },
      { r:2,  raceId:'202609060402', name:'3歳未勝利',        time:'10:25', cond:'良', count:'16頭' },
      { r:11, raceId:'202609060411', name:'セントライト記念', time:'15:45', cond:'良', count:'18頭' },
      { r:12, raceId:'202609060412', name:'3歳上1勝クラス',   time:'16:30', cond:'良', count:'16頭' }
    ];
    kaiFetchListHtml = function(d8){
      globalThis.__LISTN = (globalThis.__LISTN || 0) + 1;
      return Promise.resolve({ html:'', venues:[{ venue:'中山', kaisai:'4回中山', baba:'良', races: globalThis.__RACES }] });
    };
    globalThis.__QUEUE = [];
    nkBiasRunQueue = function(todo, isToday, onDone){
      globalThis.__QUEUE.push(todo.map(function(x){ return x.rno + 'R'; }));
      state.biasRaces = state.biasRaces.concat(todo.map(function(x){
        return { id: x.rid, rno: x.rno, venue: x.venue, date:'2026/09/12', money:[] };
      }));
      return Promise.resolve(todo.length);
    };
    renderBiasCard = function(){}; showAnalysis = function(){}; saveNow = function(){}; renderKentaiFull = function(){};
    amSet('biasAuto', true);
  `);
  // 現在時刻を 11:00 に固定（1R/2R は発走+12分を過ぎている、11R/12R はまだ）
  const nowMin = 11 * 60;
  run(`baMinNow = function(){ return ${nowMin}; }; baToday8 = function(){ return '20260912'; };`);
  run(`globalThis.__T = null; baTick('20260912', { force:true }).then(function(x){ globalThis.__T = x; });`);
  await tick(); await tick(); await tick();
  let t = run('globalThis.__T');
  eq('11:00 の時点で取りに行くのは 1R・2R だけ', run('globalThis.__QUEUE[0]'), ['1R','2R']);
  eq('取得件数', t && t.got, 2);
  eq('未発走は2レース', t && t.future, 2);

  // 取得済みは二度叩かない
  run(`globalThis.__QUEUE = []; globalThis.__T = null; baTick('20260912', { force:true }).then(function(x){ globalThis.__T = x; });`);
  await tick(); await tick(); await tick();
  eq('2回目は未取得ぶんが無いので何もしない', run('globalThis.__QUEUE'), []);
  eq('取得済み2・未発走2', run('globalThis.__T.have'), 2);

  // 16:00 になったら 11R も（12R は 16:30+12=16:42 なのでまだ）
  run(`baMinNow = function(){ return 16*60; }; globalThis.__QUEUE = []; globalThis.__T = null;
       baTick('20260912', { force:true }).then(function(x){ globalThis.__T = x; });`);
  await tick(); await tick(); await tick();
  eq('16:00 になったら 11R だけ取りに行く', run('globalThis.__QUEUE[0]'), ['11R']);

  // 17:05（最終 16:30 + 12 = 16:42 を過ぎた）→ 12R
  run(`baMinNow = function(){ return 17*60+5; }; globalThis.__QUEUE = []; globalThis.__T = null;
       baTick('20260912', { force:true }).then(function(x){ globalThis.__T = x; });`);
  await tick(); await tick(); await tick();
  eq('最終レースも確定見込み時刻になったら取りに行く', run('globalThis.__QUEUE[0]'), ['12R']);
  eq('全4レース揃った', run('globalThis.__T.have + globalThis.__T.got'), 4);

  // 当日以外は自動では動かない
  run(`globalThis.__T2 = null; baTick('20260905').then(function(x){ globalThis.__T2 = x; });`);
  await tick();
  eq('当日以外は自動取得しない（過去ぶんは学習DB側で確定データとして取る）', run('globalThis.__T2.skip'), true);

  // ☑OFF
  run(`amSet('biasAuto', false); globalThis.__T3 = null; baTick('20260912').then(function(x){ globalThis.__T3 = x; });`);
  await tick();
  eq('(E)がOFFなら動かない', run('globalThis.__T3.skip'), true);

  // レース一覧が取れない日（開催なし）
  run(`amSet('biasAuto', true); BA_STATE.list = null; BA_STATE.day8 = '';
       kaiFetchListHtml = function(){ return Promise.resolve({ html:'', venues:[] }); };
       globalThis.__T4 = null; baTick('20260912', { force:true, forceList:true }).then(function(x){ globalThis.__T4 = x; });`);
  await tick(); await tick();
  eq('開催が無い日はスキップ', run('globalThis.__T4.skip'), true);

  // --- 水曜削除 ---
  run(`
    kaiFetchListHtml = function(){ return Promise.resolve({ html:'', venues:[] }); };
    state.biasRaces = [
      { id:'OLD1', rno:1, venue:'中山', date:'2026/09/05', money:[] },   // 前の週の土曜 → 削除日 9/9(水) 過ぎ → 消す
      { id:'OLD2', rno:2, venue:'中山', date:'2026/09/06', money:[] },   // 前の週の日曜 → 削除日 9/9(水) 過ぎ → 消す
      { id:'THISW', rno:3, venue:'中山', date:'2026/09/19', money:[] },  // 次の開催週 → 削除日 9/23(水) はまだ → 残す
      { id:'TODAY', rno:4, venue:'中山', date:'2026/09/16', money:[] },  // 当日 → 残す
      { id:'NODATE', rno:5, venue:'中山', date:'', money:[] }            // 日付不明 → 残す
    ];
    state.biasTrash = [ { id:'T1' } ];
    biasRecDay8 = function(rc){ return String(rc.date || '').replace(/[^0-9]/g,'').slice(0,8); };
    saveNow = function(){ globalThis.__SAVED = (globalThis.__SAVED||0)+1; };
    renderBiasCard = function(){};
    amSet('biasClean', true);
    globalThis.__W = baWeekClean(true, '20260916');
  `);
  const W = run('globalThis.__W');
  eq('スキャン5件', W.scan, 5);
  eq('先週ぶん2件を削除', W.del, 2);
  eq('次の開催週・当日は残す', W.keepWeek, 2);
  eq('日付不明は残す（安全側）', W.keepNoDate, 1);
  eq('残っているID', run('state.biasRaces.map(function(x){ return x.id; })'), ['THISW','TODAY','NODATE']);
  eq('ゴミ箱も空にする（残すと結局ふくらむ）', run('state.biasTrash.length'), 0);
  eq('saveNow が呼ばれた', run('globalThis.__SAVED > 0'), true);

  // ☑OFF
  run(`state.biasRaces = [ { id:'OLD3', rno:1, venue:'中山', date:'2026/09/05', money:[] } ];
       amSet('biasClean', false);
       globalThis.__W2 = baWeekClean(false, '20260916');`);
  eq('(C2)がOFFなら自動では消さない', run('state.biasRaces.length'), 1);
  run(`globalThis.__W3 = baWeekClean(true, '20260916');`);
  eq('「🧹 古い記録を掃除する」は☑に関係なく動く', run('state.biasRaces.length'), 0);

  // amInit の「🧹 今すぐ掃除する」がバイアスも一緒に掃除する
  const src59 = fs.readFileSync(path.join(ROOT, 'src/p59_automacro.js'), 'utf8');
  T('amInit の掃除ボタンが baWeekClean も呼ぶ', /amCleanBtn[\s\S]{0,600}?baWeekClean\(true\)/.test(src59));
}

/* ============================================================
   E) 重み: あなたの印を削除＋レースごとの自動補正
   ============================================================ */
async function sectionE(){
  console.log(' E. ⑤🎛重み設定から「あなたの印」を削除＋レースごとの自動補正');
  const g = mkG(mkLS());
  const run = load(g, ['src/p3_core.js', 'src/p4_parse.js', 'src/p5_engine.js', 'src/p45_yoso.js', 'src/p61_wtauto.js']);

  // --- スライダーから削除 ---
  const src8 = fs.readFileSync(path.join(ROOT, 'src/p8_analysisui.js'), 'utf8');
  T('WEIGHT_DEFS に mark が無い', !/\{\s*k:'mark'/.test(src8));
  T('WEIGHT_DEFS に 他の6ファクターは残っている',
    ['odds','yobi','time','tenkai','baba','yoso','abl'].every(function(k){ return new RegExp("k:'" + k + "'").test(src8); }));
  T('「あなたの印はAI計算に使わない」説明が残っている', /あなたの印[\s\S]{0,200}?AI印の計算には使いません/.test(src8));
  eq('defaultWeights().mark は 0', run('defaultWeights().mark'), 0);

  // --- 補正倍率の計算 ---
  function mul(cov, biasN){
    run(`baToday8 = function(){ return '20260912'; };
         baDayRaces = function(){ var a = []; for (var i=0;i<${biasN||0};i++) a.push({ money: [{ sty:'先行' }] }); return a; };`);
    return run(`wtCompute(wtCovBuild({ n:10,
      yobi:[${Array(10).fill(cov).join(',')}], time:[${Array(10).fill(cov).join(',')}],
      tenkai:[${Array(10).fill(cov).join(',')}], baba:[${Array(10).fill(cov).join(',')}],
      yoso:[${Array(10).fill(cov).join(',')}], abl:[${Array(10).fill(cov).join(',')}] })).muls`);
  }
  let m = mul(0, 0);
  near('材料0% → ×0.30（yobi）', m.yobi, 0.30, 0.002);
  m = mul(0.5, 0);
  near('材料50% → ×1.00（ちょうど中立）', m.yobi, 1.00, 0.002);
  m = mul(1, 0);
  near('材料100% → ×1.60（上限）', m.yobi, 1.60, 0.002);
  m = mul(0.25, 0);
  near('材料25% → ×0.65', m.yobi, 0.65, 0.002);
  m = mul(0.75, 0);
  near('材料75% → ×1.30', m.yobi, 1.30, 0.002);
  // 上限・下限を超えない
  const keys = ['yobi','time','tenkai','baba','yoso','abl'];
  [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1].forEach(function(cv){
    [0, 4, 12].forEach(function(bn){
      const mm = mul(cv, bn);
      keys.forEach(function(k){
        T('倍率が範囲内 cov=' + cv + ' bias=' + bn + ' ' + k + '=' + mm[k], mm[k] >= 0.30 - 1e-9 && mm[k] <= 1.60 + 1e-9, mm[k]);
      });
    });
  });
  // トラックバイアスが充実すると tenkai だけ上がる
  const b0 = mul(0.5, 0).tenkai, b8 = mul(0.5, 8).tenkai;
  T('当日バイアス0レース → 展開の倍率が下がる（' + b0 + ' < ' + b8 + '）', b0 < b8);
  near('バイアス8レースで ×1.25', run(`baDayRaces = function(){ var a=[]; for(var i=0;i<8;i++) a.push({money:[{sty:'先行'}]}); return a; }; wtBiasConf().mul`), 1.25, 0.001);
  near('バイアス0レースで ×0.85', run(`baDayRaces = function(){ return []; }; wtBiasConf().mul`), 0.85, 0.001);

  // --- state.weights を書き換えない（オーバーレイ方式） ---
  run(`baDayRaces = function(){ return []; };
       state.weights = defaultWeights();
       globalThis.__W0 = JSON.stringify(state.weights);
       globalThis.__E = wtEffective(state.weights, wtCovBuild({ n:4,
         yobi:[1,1,0,0], time:[1,1,1,0], tenkai:[1,1,1,1], baba:[0,0,0,0], yoso:[0,0,0,0], abl:[1,0,0,0] }));`);
  eq('state.weights は無傷（スライダーの位置は変わらない）', run('JSON.stringify(state.weights)'), run('globalThis.__W0'));
  const E = run('globalThis.__E');
  T('実効重みが返る', !!(E && E.w));
  eq('あなたの印の実効重みは常に0', E.w.mark, 0);
  T('材料0%のバ場好走率は下がる（' + E.w.baba.toFixed(2) + ' < ' + run('state.weights.baba') + '）',
    E.w.baba < run('state.weights.baba'));
  T('材料100%の展開は上がる（' + E.w.tenkai.toFixed(2) + '）', E.w.tenkai > 0);
  eq('odds は補正しない（市場ブレンド率にも使うため）', E.w.odds, run('state.weights.odds'));

  // ☑OFF なら素のスライダー値
  run(`amSet = function(){}; amOn = function(k){ return k === 'wtAuto' ? false : true; };
       globalThis.__E2 = wtEffective(state.weights, wtCovBuild({ n:4, yobi:[1,1,0,0], time:[1,1,1,0], tenkai:[1,1,1,1], baba:[0,0,0,0], yoso:[0,0,0,0], abl:[1,0,0,0] }));`);
  const E2 = run('globalThis.__E2');
  eq('OFFなら補正なし（wt=null）', E2.wt, null);
  eq('OFFでも mark は 0（あなたの印は削除済み）', E2.w.mark, 0);
  eq('OFFならスライダーの値そのまま', E2.w.baba, run('state.weights.baba'));

  // --- analyzeRace 統合: 印を付けてもAI印が変わらない ---
  run(`amOn = function(){ return true; };
       biasStyleMul = function(){ return null; };      // p13(トラックバイアス)は読まないためスタブ
       biasManualPreset = function(){ return null; };
       state.race = { name:'テスト', place:'中山', baba:'良', dist:'1600', grade:'', time:'' };
       state.raceId = ''; state.biasRaces = [];
       globalThis.__MK = function(markA){
         state.horses = [1,2,3,4,5,6].map(function(n){
           return mkHorse({ no:String(n), name:'ウマ'+n, odds:String(2 + n * 1.5),
             style:'先行', yobi:'6F 82.0-5F 68.0-4F 53.0-3F 37.0', time:'1:33.0', prevD:'1600',
             mark: (n === 1 ? markA : '') });
         });
         return analyzeRace();
       };`);
  const rA = run('globalThis.__MK("◎")');
  const rB = run('globalThis.__MK("")');
  const rC = run('globalThis.__MK("△")');
  const sig = function(r){ return r.rows.map(function(x){ return x.h.no + ':' + x.mark + ':' + (x.prob * 1000).toFixed(2); }).join('|'); };
  run(`globalThis.__SIG = ${JSON.stringify(sig(rA))};`);
  eq('1番に◎を付けてもAI印・勝率が一切変わらない（あなたの印を計算から削除した）', sig(rB), sig(rA));
  eq('1番に△を付けても変わらない', sig(rC), sig(rA));
  T('analyzeRace が補正内容(res.wtAuto)を返す', !!(rA.wtAuto && rA.wtAuto.muls), rA.wtAuto && Object.keys(rA.wtAuto.muls));

  // 材料を減らすと重みの実効値が下がる（＝レースごとに変わる）
  run(`state.horses = [1,2,3,4,5,6].map(function(n){
         return mkHorse({ no:String(n), name:'ウマ'+n, odds:String(2 + n * 1.5), style:'', yobi:'', time:'', prevD:'' });
       });
       globalThis.__R2 = analyzeRace();`);
  const R2 = run('globalThis.__R2');
  T('材料が全部空のレースでは各倍率が下限寄り（yobi=' + R2.wtAuto.muls.yobi + '）',
    R2.wtAuto.muls.yobi <= 0.31 && R2.wtAuto.muls.time <= 0.31, R2.wtAuto.muls);

  // --- 表示 ---
  run(`globalThis.__BOX = null; wtRender(globalThis.__R2); globalThis.__BOX = $("wtAutoBox").innerHTML;`);
  const box = run('globalThis.__BOX');
  T('補正の内訳表が出る', /実効重み/.test(box) && /スライダー/.test(box), box.slice(0, 100));
  T('あなたの印が「削除」として表に出る', /あなたの印[\s\S]{0,200}?削除/.test(box));
  T('②の根拠（材料○%）が出る', /材料 \d+%/.test(box));
}

/* ============================================================
   F) 軸・妙味・穴の「狙い目の理由」
   ============================================================ */
async function sectionF(){
  console.log(' F. ⑥🎯軸・💠妙味・🕳穴の狙い目の理由がオッズ以外からも出る');
  const g = mkG(mkLS());
  const run = load(g, ['src/p3_core.js', 'src/p4_parse.js', 'src/p5_engine.js', 'src/p45_yoso.js', 'src/p56_picks.js']);

  run(`
    biasStyleMul = function(){ return null; };
    biasManualPreset = function(){ return null; };
    state.race = { name:'テスト', place:'中山', baba:'良', dist:'1600', grade:'', time:'' };
    state.raceId = ''; state.biasRaces = []; state.weights = defaultWeights();
    state.horses = [1,2,3,4,5,6,7,8].map(function(n){
      var h = mkHorse({ no:String(n), name:'ウマ'+n, odds:String(1.8 + n * 2.2), style:'先行',
        yobi:'6F 82.0-5F 68.0-4F 53.0-3F 37.0', time:'1:3' + (2 + (n % 3)) + '.0', prevD:'1600',
        last3f:'33.' + (2 + n), last3rank:(n % 4) + 1, timeSrc:'prev',
        jockey:'騎手' + n, weight:'55' });
      h.prevM = 1600; h.prevDate8 = '20260830'; h.prevVenue = '新潟'; h.prevOrder = (n % 5) + 1;
      h.prevSurf = '芝'; h.prevR = '11';
      return h;
    });
    // 学習DBの過去実績・バ場好走率・コース適性をスタブで入れる
    hfCurFeatures = function(hs){
      var map = {};
      hs.forEach(function(h, i){
        map[String(h.no)] = { has:true, prevN: 6 + i, top3Rate: 0.5 - i * 0.03, winRate: 0.2,
          l3RankAvg: 0.2 + i * 0.05, sameDistN: 3 + i, sameDistTop3Rate: 0.6 - i * 0.04,
          restDays: 21, isTeppo:false, is2nd:false, style:'先行', styleN:5,
          jockeyN: 100 + i * 10, jockeyWinRate: 0.12, jockeyTop3Rate: 0.3, abl: 0.6 };
      });
      return { any:true, map: map };
    };
    bbComputeFor = function(hs){
      return { usable:true, items: hs.map(function(h, i){ return { n: 5 + i, top3: 2, pct: 40, rate: 0.4 + (8 - i) * 0.03, no:h.no, name:h.name }; }) };
    };
    biasVerdict = function(){ return { posLabel:'前残り・先行有利', frontScore:0.66, known:20, races:5 }; };
    globalThis.__RES = analyzeRace();
    globalThis.__PK = pkPicks(globalThis.__RES);
  `);
  const PK = run('globalThis.__PK');
  T('軸・妙味・穴が出た', !!(PK && PK.axis && PK.value && PK.hole));
  ['axis','value','hole'].forEach(function(kind){
    const p = PK[kind];
    if (!p) return;
    T(kind + ': whyList がある', Array.isArray(p.whyList) && p.whyList.length > 0, p.whyList);
    T(kind + ': 理由が複数（' + p.whyList.length + '件）', p.whyList.length >= 2, p.whyList.length);
    T(kind + ': 最大' + run('PK_WHY_MAX') + '件まで', p.whyList.length <= run('PK_WHY_MAX'));
    // オッズ以外の材料が必ず入っている
    const joined = p.whyList.join(' ');
    T(kind + ': オッズ妙味以外の理由が入っている',
      /📚|⏱|🌊|🏁|🏟|🏔|🧭|🏇/.test(joined), joined.slice(0, 160));
    T(kind + ': 理由に実データの数字がある', /\d/.test(joined));
  });

  // 学習DBの理由に数字が出る
  const axWhy = run('globalThis.__PK.axis.whyAll.join(" ")');
  T('学習DBの過去実績（戦数・3着内率）が出る', /学習DB/.test(axWhy) && /3着内/.test(axWhy), axWhy.slice(0, 200));
  T('持ちタイムが出る', /持ちタイム/.test(axWhy));
  T('前走の上り3Fが出る', /前走の上り3F/.test(axWhy));
  T('前走の実績（日付・場・距離・着順）が出る', /前走: /.test(axWhy) && /08\/30/.test(axWhy));
  T('バ場好走率が出る', /同じ開催場×同じ馬場/.test(axWhy));
  T('展開適性（脚質×ペース×当日バイアス）が出る', /展開適性/.test(axWhy) && /前残り・先行有利/.test(axWhy));
  T('オッズ妙味も1項目として出る', /期待値/.test(axWhy));

  // 妙味馬はオッズの理由が先頭に来る
  const vWhy = run('globalThis.__PK.value.whyList[0]');
  T('💠妙味馬の決め手は期待値が先頭（ got ' + String(vWhy).slice(0, 24) + ' ）', /^💰/.test(String(vWhy)), vWhy);

  // 材料が全く無い馬でも理由が「無い」と分かる（黙って空にしない）
  run(`state.horses = [1,2,3].map(function(n){ return mkHorse({ no:String(n), name:'ウマ'+n, odds:String(2+n) }); });
       hfCurFeatures = function(){ return { any:false, map:{} }; };
       bbComputeFor = function(){ return { usable:false, items:[] }; };
       globalThis.__RES2 = analyzeRace(); globalThis.__PK2 = pkPicks(globalThis.__RES2);`);
  const PK2 = run('globalThis.__PK2');
  T('材料が少なくても期待値の理由は出る', !!(PK2 && PK2.value && PK2.value.whyList.length >= 1));

  // 表示HTML
  run(`globalThis.__HTML = pkHTML(globalThis.__PK);`);
  const H = run('globalThis.__HTML');
  T('HTMLに「🔎 狙い目の理由」の見出しが出る', /🔎 狙い目の理由/.test(H));
  T('材料の追加表示（ほかN件）がある', /ほか \d+ 件の材料/.test(H) || run('globalThis.__PK.axis.whyAll.length <= globalThis.__PK.axis.whyList.length'));
  T('3頭ぶん並ぶ', (H.match(/pkcell/g) || []).length === 3);
}

/* ============================================================
   G) 組み込み確認
   ============================================================ */
function sectionG(){
  console.log(' G. index.html / build.py / p10_main.js への組み込み');
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  T('p60_biasauto が入っている', /function baTick/.test(idx) && /BA_AFTER_MIN/.test(idx));
  T('p61_wtauto が入っている', /function wtEffective/.test(idx) && /function wtCovBuild/.test(idx));
  T('出馬表キャッシュが入っている', /khl_card_v1/.test(idx) && /function nkCardGet/.test(idx));
  T('脚質AIのキャッシュ実行が入っている', /function stRunFromCache/.test(idx));
  T('前走の実データ項目が入っている', /prevM: \(parseInt\(p\.prevM/.test(idx));
  ['wtAutoCard','wtAutoChk','wtAutoBtn','wtAutoBox','baCard','baNowBtn','baCleanBtn','baInfoBtn','baInfo','baStat',
   'amChkStyle','amChkBiasClean','amChkBias','amChkWt','rkLoadForce'].forEach(function(id){
    T('#' + id + ' がある', idx.indexOf('id="' + id + '"') >= 0);
  });
  T('wtInit が起動時に呼ばれる', /safeInit\('wtInit', wtInit\)/.test(idx));
  T('baInit が起動時に呼ばれる', /safeInit\('baInit', baInit\)/.test(idx));
  T('あなたの印スライダーが index.html から消えた', !/data-wk="mark"/.test(idx));
  T('.wtbar のCSSがある', /\.slider \.wtbar\{/.test(idx));

  const order = fs.readFileSync(path.join(ROOT, 'build.py'), 'utf8');
  const pos = function(n){ return order.indexOf("'" + n + "'"); };
  T('build.py に p60_biasauto', pos('p60_biasauto') > 0);
  T('build.py に p61_wtauto', pos('p61_wtauto') > 0);
  T('p60 は p13_bias より後', pos('p60_biasauto') > pos('p13_bias'));
  T('p60 は p26_kaisai より後（kaiFetchListHtml を使う）', pos('p60_biasauto') > pos('p26_kaisai'));
  T('p60 は p59_automacro より後（amOn/amCleanD8 を使う）', pos('p60_biasauto') > pos('p59_automacro'));
  T('p61 は p59_automacro より後（amOn を使う）', pos('p61_wtauto') > pos('p59_automacro'));
  T('p61 は p54_factorlearn より後（apFactorScale を表示に使う）', pos('p61_wtauto') > pos('p54_factorlearn'));
}

/* ============================================================
   H) 実物 index.html での起動スモーク（新しい自動処理が起動時に落ちないか）
   ============================================================ */
function sectionH(){
  console.log(' H. 実物 index.html での起動スモーク（④⑤の自動処理）');
  const els = {};
  function makeEl(id){
    const el = {
      id: id || '', value:'', checked:true, dataset:{}, files:null, disabled:false,
      style:{}, children:[], parentNode:null,
      classList:{ _s:new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); },
        toggle(c,f){ if(f===undefined){ this._s.has(c)?this._s.delete(c):this._s.add(c);} else { f?this._s.add(c):this._s.delete(c);} },
        contains(c){ return this._s.has(c); } },
      addEventListener(){}, removeEventListener(){}, click(){}, focus(){}, blur(){},
      setAttribute(){}, getAttribute(){ return null; },
      querySelector(){ return makeEl(); }, querySelectorAll(){ return []; },
      closest(){ return null; }, appendChild(){}, remove(){}, scrollIntoView(){},
      getBoundingClientRect(){ return { width: 940, height: 400, top:0, left:0 }; },
      getContext(){ return new Proxy({ measureText: function(t){ return { width: String(t).length * 6 }; } }, {
        get: function(t,k){ if (k in t) return t[k]; if (k==='canvas') return el; return function(){}; },
        set: function(t,k,v){ t[k]=v; return true; } }) }
    };
    Object.defineProperty(el, 'innerHTML', { get(){ return el._html||''; }, set(v){ el._html=v; } });
    Object.defineProperty(el, 'textContent', { get(){ return el._text||''; }, set(v){ el._text=String(v); } });
    return el;
  }
  function find(id){ if (!els[id]) els[id] = makeEl(id); return els[id]; }
  const store = {}; const lsOrder = [];
  const ls = {
    getItem(k){ return store[k] != null ? store[k] : null; },
    setItem(k,v){ if (!(k in store)) lsOrder.push(k); store[k] = String(v); },
    removeItem(k){ if (k in store){ delete store[k]; const i = lsOrder.indexOf(k); if (i>=0) lsOrder.splice(i,1); } },
    key(i){ return lsOrder[i] != null ? lsOrder[i] : null; },
    get length(){ return lsOrder.length; }
  };
  const g = {
    console, Math, JSON, Date, String, Number, Boolean, Array, Object, Error, Promise, Map, Set, isNaN, isFinite,
    parseInt, parseFloat, encodeURIComponent, decodeURIComponent, TextDecoder,
    Blob: function(){}, URL:{ createObjectURL(){ return 'blob:x'; }, revokeObjectURL(){} },
    clearTimeout,
    setTimeout: function(fn, ms){ g.__to.push({ fn: fn, ms: ms||0 }); return g.__to.length; },
    setInterval: function(fn, ms){ g.__iv.push({ fn: fn, ms: ms||0 }); return g.__iv.length; },
    clearInterval: function(){}, requestAnimationFrame: function(){ return 1; }, cancelAnimationFrame: function(){},
    localStorage: ls, addEventListener(){}, removeEventListener(){}, scrollTo(){},
    devicePixelRatio:1, innerWidth:980, innerHeight:640,
    navigator:{ clipboard:{ writeText(){ return Promise.resolve(); } } },
    document:{ getElementById(id){ return find(id); }, querySelector(){ return makeEl(); }, querySelectorAll(){ return []; },
      createElement(){ return makeEl(); }, addEventListener(){}, removeEventListener(){},
      fullscreenElement:null, body:{ appendChild(){} }, head:{ appendChild(){} }, documentElement:{} }
  };
  g.window = g;
  g.__to = []; g.__iv = [];
  vm.createContext(g);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/<script>\n([\s\S]*)\n<\/script>/);
  T('index.html に本体スクリプトがある', !!m);
  if (!m) return;
  let bootErr = null;
  try { vm.runInContext(m[1], g, { filename: 'index.html.js' }); } catch(e){ bootErr = e; }
  T('起動時に例外が出ない', !bootErr, bootErr && (bootErr.stack||String(bootErr)).split('\n').slice(0,3).join(' / '));
  if (bootErr) return;
  const run2 = function(code){ return vm.runInContext(code, g); };

  // ④ バイアス自動取得: ON にして 1 周期ぶん回す
  run2('state.baAuto = true; state.baAutoOn = true;');
  run2(`globalThis.__BA_N = 0;
        globalThis.__BA_Q = [];
        nkBiasRunQueue = function(todo, isToday, onDone){
          globalThis.__BA_N++;
          globalThis.__BA_Q = globalThis.__BA_Q.concat(todo.map(function(x){ return x.rno; }));
          return Promise.resolve(todo.length);
        };
        kaiFetchListHtml = function(d8){
          return Promise.resolve({ html:'', venues:[{ venue:'中山', kaisai:'4回中山', baba:'良', races:[
            { r:1, raceId:'202609130401', name:'2歳未勝利', time:'09:50', cond:'良', count:'16頭' }
          ] }] });
        };`);
  let baErr = null;
  try { run2('baTick();'); } catch(e){ baErr = e; }
  T('baTick() が例外を出さない', !baErr, baErr && (baErr.stack||String(baErr)).split('\n').slice(0,3).join(' / '));
  let baInitErr = null;
  try { run2('baInit();'); } catch(e){ baInitErr = e; }
  T('baInit() が例外を出さない', !baInitErr, baInitErr && (baInitErr.stack||String(baInitErr)).split('\n').slice(0,3).join(' / '));
  T('起動時の追い取得が 6 秒後に予約されている', g.__to.some(function(t){ return t.ms === 6000; }));
  // 予約されたぶんを実際に回す（＝起動直後の「取りこぼし追い取得」）
  let baBootErr = null;
  try { g.__to.forEach(function(t){ t.fn(); }); } catch(e){ baBootErr = e; }
  T('起動時の追い取得が例外を出さない', !baBootErr, baBootErr && (baBootErr.stack||String(baBootErr)).split('\n').slice(0,3).join(' / '));
  T('1分周期のタイマーが張られている', g.__iv.some(function(t){ return t.ms === 60000; }));
  // 張られたタイマーを1回ぶん回す
  let tickErr = null;
  try { g.__iv.forEach(function(t){ t.fn(); }); } catch(e){ tickErr = e; }
  T('定期チェック(baTick)が例外を出さない', !tickErr, tickErr && (tickErr.stack||String(tickErr)).split('\n').slice(0,3).join(' / '));
  T('baRenderInfo の案内文が出ている', /今日の取得/.test(els['baInfo'] ? els['baInfo'].innerHTML : ''));
  run2('baStop(); state.baAutoOn = false;');

  // ⑤ 重み自動補正: ON にして実際の analyzeRace → 描画まで
  let wtErr = null;
  try { run2('wtInit();'); } catch(e){ wtErr = e; }
  T('wtInit() が例外を出さない', !wtErr, wtErr && (wtErr.stack||String(wtErr)).split('\n').slice(0,3).join(' / '));
  run2('state.wtAuto = true; state.wtAutoOn = true;');
  run2(`biasStyleMul = function(){ return null; };
        biasManualPreset = function(){ return null; };
        bbComputeFor = function(){ return { usable:false, items:[] }; };
        state.race = { name:'テスト', place:'中山', baba:'良', dist:'1600', grade:'', time:'' };
        state.raceId=''; state.biasRaces=[]; state.weights=defaultWeights();
        state.horses = [];
        for (var n = 1; n <= 12; n++){
          state.horses.push(mkHorse({ no:String(n), name:'ウマ'+n, style: n%2 ? '逃げ' : '差し',
            speed: 60 + n, stamina: 55 + n, baba: 50 + (n%5)*5, dist: 1600,
            last3: 33.0 + (n%6)*0.4, last3rank: (n%4)+1, odds: 2 + n*2.1, time:'1:32.'+(10+n%50) }));
        }`);
  let anErr = null, res = null;
  try { res = run2('analyzeRace()'); } catch(e){ anErr = e; }
  T('重み自動補正ONで analyzeRace() が通る', !anErr, anErr && (anErr.stack||String(anErr)).split('\n').slice(0,3).join(' / '));
  T('このレースの補正内容が入っている', !!(res && res.wtAuto && res.wtAuto.on === true && res.wtAuto.muls && res.wtAuto.n === 12));
  T('補正倍率が全ファクターぶん出ている ×0.30〜1.60', !!res && res.wtAuto && Object.keys(res.wtAuto.muls).length >= 6 &&
    Object.keys(res.wtAuto.muls).every(function(k){ var v = res.wtAuto.muls[k]; return v >= 0.29 && v <= 1.61; }));
  T('倍率の理由（材料○%）が付いている', !!res && res.wtAuto && /材料 \d+%/.test(res.wtAuto.why.time || ''));
  // 「🧠 あなたの印」の重みが本当に効かないか（スライダーを盛大に上げても印の順番が変わらない）
  const SNAPS = "analyzeRace().rows.map(function(r){ return r.h.no + ':' + r.prob.toFixed(8) + ':' + r.mark; }).join('|')";
  const base = run2(SNAPS);
  run2("state.weights.mark = 50; state.horses.forEach(function(h,i){ h.mark = (i===3 ? '◎' : (i===7 ? '○' : '')); });");
  const withMark = run2(SNAPS);
  T('そもそもAI印の点数と印（◎○▲…）が出ている', /:\d/.test(base) && /[◎○▲△]/.test(base), base);
  eq('あなたの印を盛大に入れてもAI印は1ミリも動かない（重み0固定）', withMark, base);
  run2("state.weights.mark = 0; state.horses.forEach(function(h){ h.mark = ''; });");
  let rdErr = null;
  try { run2('wtRender();'); } catch(e){ rdErr = e; }
  T('wtRender() が例外を出さない', !rdErr, rdErr && (rdErr.stack||String(rdErr)).split('\n').slice(0,3).join(' / '));
  run2('state.wtAutoOn = false;');

  // ⑥ 軸・妙味・穴の理由が実物バンドルでも出る
  let pkErr = null, pk = null;
  try { pk = run2('pkPicks(analyzeRace())'); } catch(e){ pkErr = e; }
  T('pkPicks() が例外を出ない', !pkErr, pkErr && (pkErr.stack||String(pkErr)).split('\n').slice(0,3).join(' / '));
  T('軸・妙味・穴が揃う', !!(pk && pk.axis && pk.value && pk.hole));
  T('3頭とも理由が2件以上', !!(pk && pk.axis.whyList.length >= 2 && pk.value.whyList.length >= 2 && pk.hole.whyList.length >= 2));
  let htmlErr = null, pkHtml = '';
  try { pkHtml = run2('pkHTML(pkPicks(analyzeRace()))'); } catch(e){ htmlErr = e; }
  T('pkHTML() が例外を出さない', !htmlErr, htmlErr && (htmlErr.stack||String(htmlErr)).split('\n').slice(0,3).join(' / '));
  T('実物HTMLに「🔎 狙い目の理由」が出る', /🔎 狙い目の理由/.test(pkHtml));

  // ①② マクロ（脚質AI・出馬表キャッシュ）が実物バンドルに居る
  T('実物に nkCardHas / stRunFromCache / amHorseMacro がある',
    run2("typeof nkCardHas === 'function' && typeof stRunFromCache === 'function' && typeof amHorseMacro === 'function'"));
}

(async function main(){
  try {
    await sectionA();
    await sectionB();
    await sectionC();
    await sectionD();
    await sectionE();
    await sectionF();
    sectionG();
    sectionH();
  } catch(e){
    bad++;
    console.log('  ✗ ERROR: ' + ((e && e.stack) || e));
  }
  console.log('rework13: OK', ok, 'FAIL', bad);
  process.exit(bad ? 1 : 0);
})();
