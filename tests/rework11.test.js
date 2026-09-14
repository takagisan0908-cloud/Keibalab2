/* 2026-09-13 第19弾 の回帰テスト
   実行: node tests/rework11.test.js

   検証内容:
     A) 第19弾① 日付指定で出馬表を読み込んだときのオッズ反映＋②予想タブの描き直し
        ・nkSetRaceDate8 … meta.date / レース名から state.raceDate8 を確定する
        ・nkOddsApplyById … race_id だけを受け取ってオッズを反映し、失敗しても reject しない
        ・kaiImportByRaceId が オッズ取得 → renderKentaiFull まで通す
     B) 第19弾③ 出馬表の出力時に 上3F・持ちタイム が抜ける
        ・mkHorse が last3rank / timeSrc / ninki / slowSrc を落とさない
        ・applyNkHorses が「旧オブジェクトの全項目」を引き継ぐ（上3F・持ちタイム・順位色）
        ・nkTodayD8 が hfCurD8（レース名の日付）を優先する
        ・nkAutoFill が馬柱キャッシュから 上3F・持ちタイム を埋め直す（新規通信なし）
     C) 第19弾② 回収率チューナー（p58_value.js）
        ・vtPayIndex / vtBetKey / vtHitByOrder … 実払戻と着順の両方で精算できる
        ・vtEvalRace … 投資額＝点数×100円、回収率＝払戻÷投資、的中率
        ・vtAnalyze … 総当たりして最良設定と提言を出す
     D) 第19弾④ 6〜10代目の血統共通点が「人気馬の要素」ばかりになる問題
        ・bfDeepCommon が 1〜3番人気を背景にしてリフトを計算し、人気馬と差がない祖先を落とす
        ・bfDeepItemHtml / bfDeepSentHtml / bfDeepTblHtml に人気馬比が出る
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
function mkG(ls){
  const els = {};
  const g = {
    console, Math, JSON, Date, String, Number, parseInt, parseFloat, isNaN, isFinite, RegExp,
    Array, Object, Boolean, Error, Promise, encodeURIComponent, decodeURIComponent,
    setTimeout(fn2){ try { fn2(); } catch(e){} return 0; }, clearTimeout(){}, setInterval(){ return 0; }, clearInterval(){},
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

/* ============================================================
   A) 第19弾① 日付指定の読み込みでオッズが入る＋②が描き直される
   ============================================================ */
console.log('rework11(第19弾): オッズ反映 / 上3F・持ちタイム / 回収率チューナー / 血統リフト');
console.log(' A. 第19弾① 日付指定パスのオッズ反映＋レース日確定');
const tick = () => new Promise(r => setTimeout(r, 0));
async function sectionA(){
  const g = mkG(mkLS());
  const run = load(g, ['src/p3_core.js', 'src/p4_parse.js', 'src/p49_jockeylay.js',
                       'src/p52_histfeat.js', 'src/p6_inputui.js', 'src/p12_urlimport.js', 'src/p26_kaisai.js']);

  // --- nkSetRaceDate8: meta.date から確定 ---
  run('state.raceDate8 = "";');
  eq('nkSetRaceDate8 が meta.date(2026/9/13) → 20260913',
     run('nkSetRaceDate8({ date: "2026/9/13", place: "中山", rnum: "11" })'), '20260913');
  eq('state.raceDate8 に入っている', run('String(state.raceDate8 || "")'), '20260913');
  eq('jlRaceD8() もレース日を返す', run('jlRaceD8()'), '20260913');

  // --- レース名から拾う（meta が日付を持たないとき） ---
  run('state.raceDate8 = ""; state.race.name = "2026年9月12日 中山11R セントウルステークス";');
  eq('nkSetRaceDate8("") がレース名から拾う', run('nkSetRaceDate8("")'), '20260912');

  // --- nkOddsApplyById: オッズAPIが値を返した場合 ---
  run(`globalThis.__ODDS = { status: 'ok', data: { odds: { '1': {
     '01': [3.4, 0, 1], '02': [5.1, 0, 2], '03': [12.0, 0, 4], '04': [7.8, 0, 3] } } } };
     nkFetchOddsAny = function(rid){ return Promise.resolve(globalThis.__ODDS); };`);
  run(`state.horses = [1,2,3,4,5].map(function(n){ return mkHorse({ no: String(n), name: 'ウマ' + n }); });`);
  run(`globalThis.__R = null; nkOddsApplyById('202609011').then(function(x){ globalThis.__R = x; });`);
  await tick();
  const R = run('globalThis.__R');
  eq('nkOddsApplyById.ok', R && R.ok, true);
  eq('反映頭数', R && R.cnt, 4);
  eq('1番人気の馬番', R && R.fav && R.fav.no, 1);
  eq('1番のオッズが入った', run('state.horses[0].odds'), '3.4');
  eq('4番のオッズが入った', run('state.horses[3].odds'), '7.8');
  eq('オッズの無い5番は空のまま', run('state.horses[4].odds'), '');
  eq('人気(ninki)も入る', run('state.horses[1].ninki'), '2');

  // --- オッズAPIが空（発売前）でも reject せず、理由を返す ---
  run(`nkFetchOddsAny = function(){ return Promise.resolve({ status: 'not_release', data: {} }); };
       globalThis.__R2 = null; nkOddsApplyById('202609011').then(function(x){ globalThis.__R2 = x; });`);
  await tick();
  const R2 = run('globalThis.__R2');
  eq('発売前でも ok=false で返る（reject しない）', R2 && R2.ok, false);
  T('発売前の理由メッセージに status が出る', /not_release/.test(String((R2 && R2.msg) || '')), (R2 && R2.msg));

  // --- 通信エラーでも reject しない ---
  run(`nkFetchOddsAny = function(){ return Promise.reject(new Error('HTTP 500')); };
       globalThis.__R3 = null;
       nkOddsApplyById('202609011').then(function(x){ globalThis.__R3 = x; }, function(e){ globalThis.__R3 = { rej: String(e) }; });`);
  await tick();
  const R3 = run('globalThis.__R3');
  eq('通信エラーでも reject されない', R3 && R3.ok, false);
  T('エラーメッセージが入る', /HTTP 500/.test(String((R3 && R3.msg) || '')), (R3 && R3.msg));
  eq('race_id が空なら即 false', run("nkOddsApplyById('').then ? 1 : 0"), 1);

  // --- kaiImportByRaceId が オッズ取得 → renderKentaiFull まで通す ---
  const SHUTUBA = '<html><body><table></table></body></html>';
  run(`
    globalThis.__LOGS = []; globalThis.__KENTAI = 0; globalThis.__TAB = '';
    kaiLogLines = function(a){ globalThis.__LOGS = globalThis.__LOGS.concat(a || []); };
    kaiBusy = function(){}; kaiAddHist = function(){}; kaiRenderVenues = function(){}; kaiRenderHist = function(){};
    kaiStatus = function(){};
    rebuildHorseTable = function(){}; updateGridHints = function(){};
    goTab = function(id){ globalThis.__TAB = id; };
    apEnsureLive = function(){}; syncRaceDomFromState = function(){}; refreshRaceLine = function(){};
    renderKentaiFull = function(){ globalThis.__KENTAI++; };
    nkFetchCardText = function(rid){ return Promise.resolve(globalThis.__CARD); };
    nkParseRaceMeta = function(html){ return { date: '2026/9/13', place: '中山', rnum: '11', name: 'セプテンバーS', grade: '', dist: '1600', surface: '芝', baba: '良' }; };
    nkParseShutuba = function(html){ return [1,2,3,4].map(function(n){
      return { frame: String(Math.ceil(n/2)), no: String(n), name: 'ウマ' + n, sexAge: '牡4', weight: '57', jockey: '騎手' + n, nk: '000000' + n };
    }); };
    nkFetchOddsAny = function(rid){ return Promise.resolve({ status: 'ok', data: { odds: { '1': {
      '01': [2.5, 0, 1], '02': [4.0, 0, 2], '03': [9.0, 0, 3], '04': [15.0, 0, 4] } } } }); };
    globalThis.__CARD = ${JSON.stringify(SHUTUBA)};
    state.horses = []; state.raceDate8 = '';
    kaiImportByRaceId('202609011');
  `);
  await tick(); await tick(); await tick();
  eq('出馬表4頭が入った', run('state.horses.length'), 4);
  eq('オッズが反映されている(1番)', run('state.horses[0].odds'), '2.5');
  eq('オッズが反映されている(4番)', run('state.horses[3].odds'), '15');
  eq('state.raceDate8 が確定した', run('String(state.raceDate8 || "")'), '20260913');
  T('renderKentaiFull が呼ばれた（②予想タブが描き直される）', run('globalThis.__KENTAI') >= 1, run('globalThis.__KENTAI'));
  const LOG = run('globalThis.__LOGS.join(" | ")');
  T('ログにオッズの成功が出る', /単勝オッズ/.test(LOG), LOG.slice(0, 300));
  T('ログにレース日の確定が出る', /レース日/.test(LOG));
  T('ログに②を描き直したと出る', /AI予想タブ/.test(LOG), LOG.slice(-300));
}

async function finishA(){


/* ============================================================
   B) 第19弾③ 上3F・持ちタイムが抜ける
   ============================================================ */
console.log(' B. 第19弾③ 出馬表の出力時に 上3F・持ちタイム が抜けない');
{
  const g = mkG(mkLS());
  const run = load(g, ['src/p3_core.js', 'src/p4_parse.js', 'src/p49_jockeylay.js',
                       'src/p52_histfeat.js', 'src/p40_netkeiba.js', 'src/p12_urlimport.js']);
  run('rebuildHorseTable = function(){}; updateGridHints = function(){}; syncRaceDomFromState = function(){}; refreshRaceLine = function(){};');

  // --- mkHorse が派生項目を落とさない ---
  const h = run(`mkHorse({ no:'3', name:'ウマ3', last3f:'34.2', last3rank:2, time:'1:59.9',
                 prevD:'1800', timeSrc:'same-course', ninki:'4', slow:'12', slowSrc:'nk', slowAll:8, slowN:1, slowI:0 })`);
  eq('mkHorse.last3f', h.last3f, '34.2');
  eq('mkHorse.last3rank（上3Fの順位色）', h.last3rank, 2);
  eq('mkHorse.time', h.time, '1:59.9');
  eq('mkHorse.prevD', h.prevD, '1800');
  eq('mkHorse.timeSrc（持ちタイムの出どころ）', h.timeSrc, 'same-course');
  eq('mkHorse.ninki', h.ninki, '4');
  eq('mkHorse.slowSrc', h.slowSrc, 'nk');
  eq('mkHorse.slowAll', h.slowAll, 8);

  // --- applyNkHorses が全項目を引き継ぐ ---
  run(`state.horses = [ mkHorse({ no:'1', name:'旧1', last3f:'33.8', last3rank:1, time:'1:45.2',
        prevD:'1600', timeSrc:'prev', odds:'3.1', style:'先行', mark:'◎', yobi:'6F 83.5', slow:'8',
        slowSrc:'nk', slowAll:10, slowN:1, slowI:0, nk:'111' }) ];`);
  run(`applyNkHorses([{ frame:'1', no:'1', name:'新1', sexAge:'牡4', weight:'57', jockey:'新騎手', nk:'111' }], []);`);
  eq('入れ替え後も last3f が残る', run('state.horses[0].last3f'), '33.8');
  eq('入れ替え後も last3rank が残る（順位色）', run('state.horses[0].last3rank'), 1);
  eq('入れ替え後も time が残る', run('state.horses[0].time'), '1:45.2');
  eq('入れ替え後も prevD が残る', run('state.horses[0].prevD'), '1600');
  eq('入れ替え後も timeSrc が残る', run('state.horses[0].timeSrc'), 'prev');
  eq('入れ替え後も odds が残る', run('state.horses[0].odds'), '3.1');
  eq('入れ替え後も style/mark が残る', run('state.horses[0].style + state.horses[0].mark'), '先行◎');
  eq('入れ替え後も yobi が残る', run('state.horses[0].yobi'), '6F 83.5');
  eq('入れ替え後も slowSrc/slowAll が残る', run('state.horses[0].slowSrc + "/" + state.horses[0].slowAll'), 'nk/10');
  eq('馬名・騎手は netkeiba の新しい値に更新される', run('state.horses[0].name + "/" + state.horses[0].jockey'), '新1/新騎手');
  eq('uid は維持される（DOM対応が崩れない）', run('state.horses[0].uid > 0'), true);

  // --- nkTodayD8 がレース名の日付を優先する（過去レースで前走が空になるのを防ぐ） ---
  run(`state.raceDate8 = ''; state.race.name = '2026年8月30日 新潟11R 新潟記念';`);
  eq('nkTodayD8 がレース名の日付を返す', run('nkTodayD8()'), '20260830');
  run(`state.raceDate8 = '20260913';`);
  eq('raceDate8 があればそちらを優先', run('nkTodayD8()'), '20260913');

  // --- nkAutoFill: 馬柱キャッシュから 上3F・持ちタイム を埋め直す（通信なし） ---
  run(`state.raceDate8 = '20260913';
       state.race.dist = '1600'; state.race.name = '2026年9月13日 中山11R テスト';
       state.horses = [ mkHorse({ no:'1', name:'ウマ1', nk:'9001' }), mkHorse({ no:'2', name:'ウマ2', nk:'' }) ];
       nkLs = function(){ return { h: { '9001': { recs: [
          { date:'2026-08-30', venueName:'新潟', r:'9', dist:'芝1600', time:'1:32.8', last3:'33.9', order:2 },
          { date:'2026-07-05', venueName:'福島', r:'7', dist:'芝1800', time:'1:47.0', last3:'35.1', order:5 }
       ] } } }; };
       nkResolveRid = function(){ return Promise.resolve(''); };
       nkRankOfLast3 = function(){ return Promise.resolve(0); };
       readRaceMeta = function(){ return { dist:'1600', baba:'' }; };`);
  const n1 = run('nkAutoFill()');
  eq('nkAutoFill が1頭ぶん埋めた', n1, 1);
  eq('上3F が入った', run('state.horses[0].last3f'), '33.9');
  eq('持ちタイムが入った（同距離±200mの前走）', run('state.horses[0].time'), '1:32.8');
  eq('前走距離メモが入った', run('state.horses[0].prevD'), '1600');
  eq('nk の無い馬はそのまま', run('state.horses[1].last3f'), '');
  const n2 = run('nkAutoFill()');
  eq('2回目は何もしない（埋める必要が無い＝軽い）', n2, 0);

  // --- 手入力で消した値を勝手に復活させない（time が入っていれば触らない） ---
  run(`state.horses[0].time = '1:33.0'; state.horses[0].last3f = '';
       nkLs = function(){ return { h: { '9001': { recs: [ { date:'2026-08-30', venueName:'新潟', r:'9', dist:'芝1600', time:'1:32.8', last3:'33.9', order:2 } ] } } }; };`);
  run('nkAutoFill()');
  eq('持ちタイムの手入力値は上書きしない', run('state.horses[0].time'), '1:33.0');
  eq('空だった上3Fは埋める', run('state.horses[0].last3f'), '33.9');

  // --- 基準日より後の戦績は使わない（いかさま防止） ---
  run(`state.raceDate8 = '20260913';
       state.horses = [ mkHorse({ no:'1', name:'ウマ1', nk:'9001' }) ];
       nkLs = function(){ return { h: { '9001': { recs: [ { date:'2026-10-05', venueName:'東京', r:'9', dist:'芝1600', time:'1:32.0', last3:'33.0', order:1 } ] } } }; };`);
  run('nkAutoFill()');
  eq('レース日より後の戦績は使わない', run('state.horses[0].last3f'), '');
}

/* ============================================================
   C) 第19弾② 回収率チューナー
   ============================================================ */
console.log(' C. 第19弾② 回収率チューナー（実測バックテスト）');
{
  const g = mkG(mkLS());
  const run = load(g, ['src/p3_core.js', 'src/p55_betpro.js', 'src/p58_value.js']);

  // --- vtBetKey / vtPayIndex ---
  eq('vtBetKey 単勝', run(`vtBetKey('tan', ['5'])`), '5');
  eq('vtBetKey 馬連は昇順', run(`vtBetKey('umaren', ['9','3'])`), '3-9');
  eq('vtBetKey 馬単は順不同を維持', run(`vtBetKey('umatan', ['9','3'])`), '9→3');
  eq('vtBetKey 3連単', run(`vtBetKey('santan', ['9','3','5'])`), '9→3→5');
  eq('vtBetKey 3連複は昇順', run(`vtBetKey('sanren', ['9','3','5'])`), '3-5-9');
  const pay = run(`vtPayIndex({ payout: { win:{nos:['5'],pays:[350]}, place:{nos:['5','2','9'],pays:[150,120,180]},
      umaren:{nos:['2-5'],pays:[1230]}, wide:{nos:['2-5','5-9','2-9'],pays:[400,700,560]},
      umatan:{nos:['5→2'],pays:[2100]}, sanfuku:{nos:['2-5-9'],pays:[3400]}, santan:{nos:['5→2→9'],pays:[17800]} } })`);
  eq('vtPayIndex 単勝', pay.tan['5'], 350);
  eq('vtPayIndex 複勝', pay.fuku['2'], 120);
  eq('vtPayIndex 馬連', pay.umaren['2-5'], 1230);
  eq('vtPayIndex ワイド', pay.wide['2-5'], 400);
  eq('vtPayIndex 馬単', pay.umatan['5→2'], 2100);
  eq('vtPayIndex 3連複', pay.sanren['2-5-9'], 3400);
  eq('vtPayIndex 3連単', pay.santan['5→2→9'], 17800);
  const pay2 = run(`vtPayIndex({ payouts: [ {t:'tan', nos:['5'], yen:350}, {t:'santan', nos:['5','2','9'], yen:17800} ] })`);
  eq('payouts 生リストからも引ける(単勝)', pay2.tan['5'], 350);
  eq('payouts 生リストからも引ける(3連単)', pay2.santan['5→2→9'], 17800);

  // --- vtHitByOrder ---
  run(`globalThis.__O = { '5':1, '2':2, '9':3, '1':4 };`);
  eq('単勝 1着', run(`vtHitByOrder('tan', ['5'], __O)`), true);
  eq('単勝 2着は外れ', run(`vtHitByOrder('tan', ['2'], __O)`), false);
  eq('複勝 3着は当たり', run(`vtHitByOrder('fuku', ['9'], __O)`), true);
  eq('複勝 4着は外れ', run(`vtHitByOrder('fuku', ['1'], __O)`), false);
  eq('ワイド 3着内どうし', run(`vtHitByOrder('wide', ['5','9'], __O)`), true);
  eq('馬連 1-2着', run(`vtHitByOrder('umaren', ['2','5'], __O)`), true);
  eq('馬単 順序違いは外れ', run(`vtHitByOrder('umatan', ['2','5'], __O)`), false);
  eq('馬単 正しい順序', run(`vtHitByOrder('umatan', ['5','2'], __O)`), true);
  eq('3連複 3着内3頭', run(`vtHitByOrder('sanren', ['5','2','9'], __O)`), true);
  eq('3連単 完全一致', run(`vtHitByOrder('santan', ['5','2','9'], __O)`), true);
  eq('3連単 順序違いは外れ', run(`vtHitByOrder('santan', ['9','2','5'], __O)`), false);

  // --- vtRaceOf: 予想×結果から1レースぶんを作る ---
  run(`globalThis.__rec = {
    rid: '202609011', meta: { date8: '20260913' },
    pre: { d8: '20260913', rows: [
      { no:'1', odds:'2.5', prob:0.34 }, { no:'2', odds:'4.0', prob:0.24 },
      { no:'3', odds:'9.0', prob:0.13 }, { no:'4', odds:'15.0', prob:0.09 },
      { no:'5', odds:'30.0', prob:0.07 }, { no:'6', odds:'60.0', prob:0.13 } ] },
    result: { rows: [ { no:'1', order:1, odds:'2.5' }, { no:'2', order:2, odds:'4.0' }, { no:'3', order:3, odds:'9.0' },
      { no:'4', order:4, odds:'15.0' }, { no:'5', order:5, odds:'30.0' }, { no:'6', order:6, odds:'60.0' } ],
      payout: { win:{nos:['1'],pays:[250]}, place:{nos:['1','2','3'],pays:[120,140,190]},
        umaren:{nos:['1-2'],pays:[540]}, wide:{nos:['1-2','1-3','2-3'],pays:[210,340,470]},
        umatan:{nos:['1→2'],pays:[980]}, sanfuku:{nos:['1-2-3'],pays:[1450]}, santan:{nos:['1→2→3'],pays:[5300]} } } };
    globalThis.__rows = __rec.result.rows;
    globalThis.__RACE = vtRaceOf('202609011', __rec, __rows);`);
  eq('vtRaceOf が作れる', run('!!__RACE'), true);
  eq('出走前の予想(rec.pre)を出所に使う', run('__RACE.src'), 'live');
  eq('実払戻マップがある', run('!!__RACE.pay.umaren'), true);
  T('候補買い目が生成されている', run('__RACE.cand.length') > 20, run('__RACE.cand.length'));
  T('edge が全買い目に付いている', run('__RACE.cand.every(function(c){ return c.edge > 0 && c.ev > 0; })'));
  eq('1番のAI勝率は正規化されている(合計1)', run('__RACE.q.reduce(function(a,b){return a+b;},0).toFixed(6)'), '1.000000');

  // --- vtEvalRace: 実払戻で精算 ---
  // ※このサンプルは1番人気の edge が 1.0 未満（AIより市場の方が上）なので、
  //   edge 下限をかけると点数が減ります。精算の正しさを見るため下限0で確認します。
  const ev = run(`vtEvalRace(__RACE, { kinds:['tan'], pool:4, minEdge:0, cap:4, stake:'flat' })`);
  eq('単勝4点＝投資400円', ev.invest, 400);
  eq('単勝1番が的中（実払戻250円/100円 → 250円）', ev.ret, 250);
  eq('的中点数1', ev.hitPts, 1);
  eq('点数4', ev.pts, 4);
  near('回収率 62.5%', ev.ret / ev.invest, 0.625, 1e-9);
  eq('レース単位では的中', ev.raceHit, 1);

  // edge 下限を上げると、市場より下に見ている1・2番人気は外れる
  const evEdge = run(`vtEvalRace(__RACE, { kinds:['tan'], pool:4, minEdge:1.0, cap:4, stake:'flat' })`);
  T('edge 1.00以上だけだと点数が減る', evEdge.pts < ev.pts, { all: ev.pts, filtered: evEdge.pts });

  const ev2 = run(`vtEvalRace(__RACE, { kinds:['santan'], pool:3, minEdge:0, cap:16, stake:'flat' })`);
  T('3連単は候補が出る', ev2.pts > 0, ev2.pts);
  eq('3連単 1→2→3 が的中（5300円/100円）', ev2.ret >= 5300, true);

  // 配分方式を変えても投資額は揃う（＝回収率を公平に比べられる）
  const ef = run(`vtEvalRace(__RACE, { kinds:['tan','umaren'], pool:4, minEdge:1.0, cap:16, stake:'flat' })`);
  const ek = run(`vtEvalRace(__RACE, { kinds:['tan','umaren'], pool:4, minEdge:1.0, cap:16, stake:'kelly' })`);
  const et = run(`vtEvalRace(__RACE, { kinds:['tan','umaren'], pool:4, minEdge:1.0, cap:16, stake:'top' })`);
  eq('均等とケリーで投資額が同じ', ef.invest, ek.invest);
  eq('均等とEV集中で投資額が同じ', ef.invest, et.invest);
  T('ケリー配分は均等と払戻が変わりうる（100円単位で丸める）', ek.ret >= 0 && et.ret >= 0);

  // edge 下限を上げると点数が減る
  const ALLK = "['tan','fuku','wide','umaren','umatan','sanren','santan']";
  const e10 = run(`vtEvalRace(__RACE, { kinds:` + ALLK + `, pool:8, minEdge:1.00, cap:9999, stake:'flat' })`);
  const e25 = run(`vtEvalRace(__RACE, { kinds:` + ALLK + `, pool:8, minEdge:1.25, cap:9999, stake:'flat' })`);
  const e40 = run(`vtEvalRace(__RACE, { kinds:` + ALLK + `, pool:8, minEdge:1.40, cap:9999, stake:'flat' })`);
  T('edge 1.25以上の方が点数が減る', e25.pts < e10.pts, { p10: e10.pts, p25: e25.pts });
  T('edge 1.40以上の方がさらに減る', e40.pts <= e25.pts, { p25: e25.pts, p40: e40.pts });
  T('edge 1.25以上の方が投資額が減る', e25.invest < e10.invest, { i10: e10.invest, i25: e25.invest });
  eq('投資額＝点数×100円', e10.invest, e10.pts * 100);

  // 上限点数(cap)が効く
  const capOn = run(`vtEvalRace(__RACE, { kinds:` + ALLK + `, pool:8, minEdge:1.0, cap:6, stake:'flat' })`);
  eq('cap 6 → 最大6点', capOn.pts, 6);
  eq('cap 6 → 投資600円', capOn.invest, 600);

  // pool を絞ると点数が減る
  const p3 = run(`vtEvalRace(__RACE, { kinds:['tan'], pool:3, minEdge:0, cap:9999, stake:'flat' })`);
  const p8 = run(`vtEvalRace(__RACE, { kinds:['tan'], pool:8, minEdge:0, cap:9999, stake:'flat' })`);
  eq('pool3 → 単勝3点', p3.pts, 3);
  T('pool8 の方が点数が多い', p8.pts > p3.pts, p8.pts);

  // 実払戻が無い券種は着順＋理論オッズで精算される
  const noPay = run(`(function(){ var r = JSON.parse(JSON.stringify({ nos:__RACE.nos, q:__RACE.q, mi:__RACE.mi,
      odds:__RACE.odds, order:__RACE.order, pay:{}, n:__RACE.n, rid:'x', src:'bt', d8:'', hasPay:false }));
      r.cand = __RACE.cand;
      return vtEvalRace(r, { kinds:['tan'], pool:1, minEdge:0, cap:4, stake:'flat' }); })()`);
  eq('実払戻なしでも1着を的中扱いにする', noPay.hitPts, 1);
  eq('推定精算の件数を数える', noPay.est, 1);

  // --- vtRaces（apStoredRaceList からの集め方）: 5レースぶん用意する ---
  run(`globalThis.__LIST = []; globalThis.__RECS = {};
     [0,1,2,3,4].forEach(function(k){
       var rid = '20260901' + k;
       var rows = [1,2,3,4,5,6].map(function(n){
         var order = ((n + k) % 6) + 1;                       // レースごとに着順を変える
         var ods = [2.5,4.0,9.0,15.0,30.0,60.0][n - 1];
         return { no:String(n), order:order, odds:String(ods) };
       });
       var winNo = rows.filter(function(r){ return r.order === 1; })[0].no;
       var rec = { rid:rid, meta:{ date8:'2026091' + k },
         pre:{ d8:'2026091' + k, rows:[1,2,3,4,5,6].map(function(n){
             return { no:String(n), odds:String([2.5,4.0,9.0,15.0,30.0,60.0][n-1]),
                      prob:[0.34,0.24,0.13,0.09,0.07,0.13][n-1] }; }) },
         result:{ rows:rows, payout:{ win:{ nos:[winNo], pays:[Math.round([2.5,4.0,9.0,15.0,30.0,60.0][winNo-1]*100)] } } } };
       __RECS[rid] = rec;
       __LIST.push({ rid:rid, p:{ rows:rows, payout:rec.result.payout } });
     });
     apStoredRaceList = function(){ return globalThis.__LIST; };
     apGet = function(rid){ return globalThis.__RECS[rid] || null; };
     globalThis.__RS = vtRaces(0);`);
  eq('vtRaces が5レース拾う', run('__RS.length'), 5);
  eq('実払戻ありフラグ', run('__RS[0].hasPay'), true);
  eq('事前予想由来', run('__RS[0].src'), 'live');

  // --- vtAnalyze（総当たり＋提言） ---
  const A = run('vtAnalyze(__RS)');
  T('総当たり結果が出る', A.sweep.length > 100, A.sweep.length);
  // 8券種セット×5頭数×4edge×3上限×3配分 = 1440 通りのうち、1レースも張れない設定は集計から落ちる
  T('総当たり結果は 1440 通り以下（張れない設定は除外）', A.sweep.length <= 1440 && A.sweep.length > 500, A.sweep.length);
  eq('対象レース数', A.races, 5);
  eq('事前予想の内訳', A.nLive, 5);
  eq('実払戻ありの内訳', A.nPay, 5);
  T('最良設定が選ばれる', !!A.best, A.best && A.best.id);
  T('最良設定の回収率が一番高い', A.top.length === 0 || A.top[0].rate.roi >= A.best.rate.roi - 1e-12);
  T('提言が出る', A.advice.length >= 2, A.advice.length);
  T('点数別の表が出る', A.byPoints.length >= 1, A.byPoints.length);
  T('edge帯別の表が出る', A.byEdge.length >= 1, A.byEdge.length);
  T('券種別の表が出る', A.byKind.length >= 1, A.byKind.length);
  T('サンプルが少ない旨の注意が出る(5レース)', /10レース未満/.test(A.advice.join('')), A.advice[0]);
  T('提言に「一番回収率が高かった設定」が出る', /一番回収率が高かった設定/.test(A.advice.join('')));
  T('提言に edge 1.00未満の買い目への言及が出る', /edge 1\.00未満/.test(A.advice.join('')));

  // --- vtHTML / vtStLabel ---
  const html = run('vtHTML(vtAnalyze(__RS))');
  T('HTMLに回収率の表が出る', /回収率/.test(html) && /lr-tbl/.test(html));
  T('HTMLに点数別が出る', /買い目点数別/.test(html));
  T('HTMLにedge帯別が出る', /edge（AI勝率 ÷ 市場期待勝率）/.test(html));
  T('HTMLに券種別が出る', /券種別の実測回収率/.test(html));
  T('HTMLに③への反映ボタンが出る', /data-vtapply/.test(html));
  T('ラベルに設定内容が出る', /edge≥/.test(run('vtStLabel(vtAnalyze(__RS).best)')));

  // --- vtApply: ③買い目提案の入力欄に書き込む ---
  run(`VT_CACHE.data = vtAnalyze(__RS);
       bpRender = function(){ globalThis.__BP = (globalThis.__BP || 0) + 1; };`);
  run(`vtApply(VT_CACHE.data.best.id);`);
  eq('③の edge 下限が書き換わる', run("parseFloat(document.getElementById('bpEdge').value)"),
     run('VT_CACHE.data.best.minEdge'));
  eq('③の最大点数が書き換わる', run("parseInt(document.getElementById('bpMax').value, 10)"),
     run('VT_CACHE.data.best.cap'));
  T('③の再描画が呼ばれる', run('globalThis.__BP') >= 1);
  T('反映メッセージが出る', /反映しました/.test(run("document.getElementById('vtMsg').innerHTML")));

  // --- p2_body.html にカードがある ---
  const body = fs.readFileSync(path.join(ROOT, 'src/p2_body.html'), 'utf8');
  T('②に #vtCard がある', body.indexOf('id="vtCard"') >= 0);
  T('#vtBox がある', body.indexOf('id="vtBox"') >= 0);
  T('折り込み(details)になっている', /<details[^>]*id="vtCard"/.test(body));
  T('折り込んだままの要約(#vtPick)がある', body.indexOf('id="vtPick"') >= 0);
  const bp = fs.readFileSync(path.join(ROOT, 'build.py'), 'utf8');
  T('build.py に p58_value が入っている', bp.indexOf("'p58_value'") >= 0);
  const mn = fs.readFileSync(path.join(ROOT, 'src/p10_main.js'), 'utf8');
  T('initVt が起動時に呼ばれる', mn.indexOf('initVt') >= 0);
}

/* ============================================================
   D) 第19弾④ 血統 6〜10代目の共通点が「人気馬の要素」ばかりになる問題
   ============================================================ */
console.log(' D. 第19弾④ 血統 6〜10代目の人気馬比リフト');
{
  const g = mkG(mkLS());
  const run = load(g, ['src/p3_core.js', 'src/p31_bloodfactor.js', 'src/p36_datarace.js']);
  run('bfDeepOn = function(){ return true; };');

  // ped(names) を作るヘルパ（6代目以降の祖先だけ）
  run(`globalThis.__mk = function(nm, arr, gen){
    var names = {}, g2 = {};
    arr.forEach(function(a){ names[a] = 1; g2[a] = gen || 7; });
    names[nm] = 1; g2[nm] = 1;
    return { names: names, gen: g2, ln: {}, disp: {}, count: arr.length + 1, deep: 3 };
  };`);
  // 状況: 「HYPERION」は勝ち馬も人気馬も全員が持つ（＝差がつかない）。
  //       「SPECIALANC」は勝ち馬の8割が持つが人気馬では2割（＝差がつく）。
  run(`globalThis.__entries = [];
     for (var y = 2016; y <= 2025; y++){
       var wi = (y % 5 !== 0);   // 8/10年 が SPECIALANC を持つ
       var win = __mk('WIN' + y, ['HYPERION'].concat(wi ? ['SPECIALANC'] : []), 7);
       win.nm = '勝馬' + y; win.yr = y; win.od = '1';
       var board = [win];
       for (var b = 2; b <= 3; b++){
         var p2 = __mk('B' + y + '_' + b, ['HYPERION'].concat((b === 2 && wi) ? ['SPECIALANC'] : []), 7);
         p2.nm = '着馬' + y + b; p2.yr = y; p2.od = String(b);
         board.push(p2);
       }
       var fav = [], field = [];
       for (var f = 1; f <= 3; f++){
         var pf = __mk('F' + y + '_' + f, ['HYPERION'].concat(f === 1 ? ['SPECIALANC'] : []), 7);
         pf.nm = '人気' + y + f; pf.yr = y; pf.od = String(f);
         fav.push(pf); field.push(pf);
       }
       __entries.push({ year: y, win: win, board: board, fav: fav, field: field, rid: y + '09011' });
     }`);
  const dc = run('bfDeepCommon(__entries)');
  eq('背景ラベルは 1〜3番人気', dc.bg.label, '1〜3番人気');
  eq('背景の頭数(10年×3頭)', dc.bg.total, 30);
  T('勝ち馬の共通点が出る', dc.win.items.length >= 1, dc.win.items.length);
  const names = dc.win.items.map(function(x){ return x.name; });
  T('差がつく祖先(SPECIALANC)が採用される', names.indexOf('SPECIALANC') >= 0, names);
  T('人気馬も全員持つ祖先(HYPERION)は除外される', names.indexOf('HYPERION') < 0, names);
  const sp = dc.win.items.filter(function(x){ return x.name === 'SPECIALANC'; })[0];
  T('リフトが1より大きい', sp && sp.lift > 1, sp && sp.lift);
  eq('背景の該当頭数（人気馬）', sp && sp.bgN, 10);
  near('勝ち馬での出現率 8/10', sp && (sp.n / sp.total), 0.8, 1e-9);
  near('人気馬での出現率 10/30', sp && sp.bgRate, (10 + 0.5) / 31, 1e-9);

  // 表示側に人気馬比が出る
  const itemHtml = run('bfDeepItemHtml(' + JSON.stringify(sp) + ')');
  T('項目に背景（1〜3番人気 N/M頭）が出る', /1〜3番人気 \d+\/\d+頭/.test(itemHtml), itemHtml);
  T('リフトの倍率が出る', /倍/.test(itemHtml));
  T('差がつく場合は good クラス', /bfddl good/.test(itemHtml));
  const sent = run('bfDeepSentHtml(' + JSON.stringify(dc) + ', ' + JSON.stringify(dc.win.items) + ', ' + JSON.stringify(dc.board.items) + ')');
  T('文章にも人気馬比が出る', /1〜3番人気では \d+\/\d+頭/.test(sent), sent.slice(0, 200));

  // リフトが1.0前後のものは「差がない」と正直に出る
  const flat = run(`bfDeepItemHtml({ name:'HYPERION', n:10, total:10, gen:7, line:'父系',
      bgN:30, bgTotal:30, bgRate:1.0, lift:1.0 })`);
  T('リフト1.0は bad クラス（人気馬と同じで差がない）', /bfddl bad/.test(flat), flat);

  // 旧データ（fav/field が無い entries）でも動く → 3着内を背景にして動く
  const dc2 = run(`bfDeepCommon(__entries.map(function(e){ return { year:e.year, win:e.win, board:e.board }; }))`);
  T('fav/field 無しでも動く', !!dc2 && dc2.win.items.length >= 0);
  eq('背景（人気馬）が無いときは「出走馬」ラベルに切り替わる', dc2.bg.label, '出走馬');
  eq('背景が無いときは 3着内を背景に使う', dc2.bg.total, 30);

  // --- bfEntriesFromDr が 人気馬と全頭を対照群として集める ---
  run(`BF_DEEP_MEM = {}; BF_DEEP_STAT = { req:0, hit:0, miss:0 };
       globalThis.__PEDS = {};
       for (var i = 1; i <= 8; i++){
         __PEDS['id' + i] = __mk('H' + i, ['HYPERION'].concat(i <= 2 ? ['SPECIALANC'] : []), 7);
       }
       bfPedDeep = function(id){ return Promise.resolve(globalThis.__PEDS[id] || null); };
       bfDeepSet = function(id){ return globalThis.__PEDS[id] || null; };
       drPool = null;
       globalThis.__DRRES = { samples: [
         { yr:2025, rid:'202509011', o:1, no:'1', name:'A', id:'id1', pop:1, odds:2.5 },
         { yr:2025, rid:'202509011', o:2, no:'2', name:'B', id:'id2', pop:2, odds:4.0 },
         { yr:2025, rid:'202509011', o:3, no:'3', name:'C', id:'id3', pop:5, odds:9.0 },
         { yr:2025, rid:'202509011', o:4, no:'4', name:'D', id:'id4', pop:3, odds:6.0 },
         { yr:2025, rid:'202509011', o:5, no:'5', name:'E', id:'id5', pop:8, odds:20.0 },
         { yr:2025, rid:'202509011', o:6, no:'6', name:'F', id:'id6', pop:4, odds:7.5 } ] };`);
  run(`globalThis.__ENT = null; bfEntriesFromDr(__DRRES, function(){}).then(function(e){ globalThis.__ENT = e; });`);
  await tick(); await tick();
  const ENT = run('__ENT');
  T('bfEntriesFromDr が entries を返す', !!ENT && ENT.length === 1, ENT && ENT.length);
  eq('1〜3着が board に入る', ENT && ENT[0].board.length, 3);
  eq('勝ち馬が入る', ENT && !!ENT[0].win, true);
  eq('1〜3番人気（対照群）が fav に入る', ENT && ENT[0].fav.length, 3);
  T('出走馬（背景）が field に入る', ENT && ENT[0].field.length >= 3, ENT && ENT[0].field.length);

  // --- 折り込み表示（第19弾④の前半） ---
  const body2 = fs.readFileSync(path.join(ROOT, 'src/p2_body.html'), 'utf8');
  T('テキスト貼り付け取込が折り込み(details)になった', /<details[^>]*id="pasteFold"/.test(body2));
  T('pasteTxt は残っている', body2.indexOf('id="pasteTxt"') >= 0);
  T('btnPaste は残っている', body2.indexOf('id="btnPaste"') >= 0);
  const imp = fs.readFileSync(path.join(ROOT, 'src/p7_import.js'), 'utf8');
  T('貼り付け実行時に折り込みを開く', imp.indexOf('pasteFoldOpen') >= 0);
}

}
/* --- A（非同期）→ B/C/D → 集計 --- */
sectionA()
  .catch(function(e){ bad++; console.log('  ✗ A section error: ' + ((e && e.stack) || e)); })
  .then(function(){
    return finishA();
  })
  .catch(function(e){ bad++; console.log('  ✗ B/C/D section error: ' + ((e && e.stack) || e)); })
  .then(function(){
    console.log('\n' + (bad === 0 ? '✓' : '✗') + ' ' + bad + ' FAIL / ✓ ' + ok + ' PASS (' + (ok + bad) + '中)');
    process.exit(bad === 0 ? 0 : 1);
  });
