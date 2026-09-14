/* 2026-09-12 第17弾（事前予想のスナップショット＋一括取得＋ファクター別学習）の回帰テスト
   実行: node tests/prefetch.test.js

   検証内容:
     A) apPreAllowed / apSnapPred — 出走前のAI予想を rec.pre に保存する
        ・結果が確定しているレースは絶対に保存しない（いかさま防止）
        ・同じ内容なら書き直さない
        ・各ファクターの値(f.O/f.Y/f.T/f.K/f.B/f.Y2/f.A)と展開予想(pace)を残す
     B) apPreMarks / apAggAddPre / apEval — 結果と突き合わせて b.pre に集計する
     C) preBuildHorses — 脚質を学習DBの履歴（レース前情報）から補完する
     D) preWithState — state と DOM を必ず元へ戻す
     E) p54 flLearn / apFactorScale — ファクターごとの「見分け力(spread)」を測って重み倍率にする
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
  const el = { id: id || '', value: '', _html: '', style: {}, dataset: {}, checked: false, disabled: false,
    classList: { _s: new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); }, contains(c){ return this._s.has(c); },
      toggle(c, f){ if (f === undefined){ this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { f ? this._s.add(c) : this._s.delete(c); } } },
    setAttribute(){}, getAttribute(){ return null; }, addEventListener(){}, appendChild(){},
    querySelector(){ return makeEl(); }, querySelectorAll(){ return []; } };
  Object.defineProperty(el, 'innerHTML', { get(){ return el._html; }, set(v){ el._html = v; } });
  Object.defineProperty(el, 'textContent', { get(){ return el._t || ''; }, set(v){ el._t = String(v); } });
  return el;
}
const els = {};
const ls = mkLS();
const g = {
  console, Math, JSON, Date, String, Number, parseInt, parseFloat, isNaN, isFinite, RegExp,
  Array, Object, Boolean, Error, Promise, encodeURIComponent, decodeURIComponent,
  setTimeout(fn2){ try { fn2(); } catch(e){} return 0; }, clearTimeout(){}, setInterval(){ return 0; }, clearInterval(){},
  requestAnimationFrame(){ return 0; }, cancelAnimationFrame(){},
  localStorage: ls, addEventListener(){}, devicePixelRatio: 1, innerWidth: 980,
  navigator: {}, window: null,
  document: { getElementById(id){ if (!els[id]) els[id] = makeEl(id); return els[id]; },
              addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
              createElement(){ return makeEl('tmp'); }, head: { appendChild(){} } }
};
g.window = g;
g.globalThis = g;
vm.createContext(g);

const files = ['src/p3_core.js', 'src/p5_engine.js', 'src/p14_history.js', 'src/p48_racedata.js',
               'src/p49_jockeylay.js', 'src/p50_pacefit.js', 'src/p52_histfeat.js',
               'src/p53_prefetch.js', 'src/p54_factorlearn.js', 'src/p30_learnrec.js'];
let code = '';
files.forEach(function(f){ code += fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n'; });
vm.runInContext(code, g, { filename: 'keiba.js' });
function run(src){ return vm.runInContext(src, g); }

console.log('prefetch(第17弾): 事前予想のスナップショット・一括取得・ファクター別学習');

/* ============================================================
   A) 事前予想の保存
   ============================================================ */
console.log(' A. apPreAllowed / apSnapPred');
// 学習DB（結果）のスタブ。rid 'DONE1' には結果が入っている
run('globalThis.__DI = { races: {} };');
run('function diLs(){ return globalThis.__DI; }');
run('function diGet(rid){ return (globalThis.__DI.races || {})[rid] || null; }');
run('apMode = "ls"; apLrnMem = null; apRecMem = null;');

function fakeRes(n, honmeiNo){
  const rows = [];
  for (let i = 1; i <= n; i++){
    const rank = (i === honmeiNo) ? 1 : (i < honmeiNo ? i + 1 : i);
    rows.push({
      idx: i - 1, h: { no: String(i), name: 'ウマ' + i, odds: String(2 + i), style: '先行', slow: '' },
      rank: rank, prob: 1 / n, mark: '◎○▲☆△'.slice(Math.min(4, rank - 1), Math.min(4, rank - 1) + 1), markCls: '',
      fO: 1 - (i - 1) / (n - 1), fY: (i % 3) / 2, fT: 0.5, fK: 0.4, fB: null, fY2: null,
      fA: (i - 1) / (n - 1), U: 1 - i * 0.01, mine: 1.0,
      ablHit: { has: true, prevN: 5, top3Rate: 0.4, l3RankAvg: 0.3, sameDistN: 3, sameDistTop3Rate: 0.33,
                jockeyN: 40, jockeyWinRate: 0.1, restDays: 21, isTeppo: false, is2nd: false, style: '先行' }
    });
  }
  rows.sort(function(a, b){ return a.rank - b.rank; });
  return { ok: true, rows: rows, pace: { score: 0.62, label: 'ややハイ', manual: false } };
}
const RID = '202609040311';
eq('結果を知らないレースは保存できる', run('apPreAllowed')('202609040311'), true);
run('globalThis.__DI.races["DONE1"] = { rid: "DONE1", rows: [{no:"1",order:1}] };');
eq('学習DBに結果があるレースは保存できない', run('apPreAllowed')('DONE1'), false);

const rec1 = run('apSnapPred')(RID, fakeRes(10, 3), { date8: '20260912', place: '阪神', dist: '2000', surface: '芝', name: 'テスト' });
T('レコードができた', !!rec1);
T('rec.pre が入った', !!(rec1 && rec1.pre));
eq('保存された頭数', rec1.pre.rows.length, 10);
eq('日付', rec1.pre.d8, '20260912');
eq('エンジンの版', rec1.pre.engine, 'v18');
eq('本物の事前予想は src=live / synthetic=false', [rec1.pre.src, !!rec1.pre.synthetic], ['live', false]);
T('展開予想が残る', rec1.pre.pace && rec1.pre.pace.label === 'ややハイ', rec1.pre.pace);
near('展開予想のスコア', rec1.pre.pace.score, 0.62, 1e-9);
T('初回時刻が記録される', !!rec1.pre.firstAt);
const r0 = rec1.pre.rows.filter(function(x){ return x.no === '3'; })[0];
T('本命の印が残る', r0 && r0.mark === '◎', r0);
eq('本命の順位', r0.rank, 1);
T('各ファクターの値が残る', r0.f && r0.f.O != null && r0.f.A != null && r0.f.Y != null, r0.f);
near('fA が丸められて保存される', r0.f.A, 2 / 9, 1e-4);
eq('値の無いファクターは null', r0.f.B, null);
T('学習DB実績の説明文が残る', r0.ablTxt.indexOf('学習DB内 5戦') >= 0, r0.ablTxt);
// 結果が確定しているレースは断る
eq('結果確定済みは null を返す', run('apSnapPred')('DONE1', fakeRes(10, 3), null), null);
// 同じ内容なら書き直さない（sig が同じ）
const sig1 = rec1.pre.sig;
const at1 = rec1.pre.at;
const rec1b = run('apSnapPred')(RID, fakeRes(10, 3), { date8: '20260912', place: '阪神', dist: '2000', surface: '芝', name: 'テスト' });
eq('同じ内容なら sig は変わらない', rec1b.pre.sig, sig1);
// 印が変われば sig も変わる
const rec1c = run('apSnapPred')(RID, fakeRes(10, 7), { date8: '20260912', place: '阪神', dist: '2000', surface: '芝', name: 'テスト' });
T('印が変われば sig も変わる', rec1c.pre.sig !== sig1, [rec1c.pre.sig, sig1]);
T('firstAt は引き継がれる', !!rec1c.pre.firstAt);
eq('res.ok=false は保存しない', run('apSnapPred')('X9', { ok: false, rows: [] }, null), null);

/* ============================================================
   B) 結果との照合
   ============================================================ */
console.log(' B. apPreMarks / apAggAddPre / apEval との突き合わせ');
// 事前予想を「3番が本命」で保存し直す
Object.keys(ls._m).forEach(function(k){ delete ls._m[k]; });
run('apMode = "ls"; apLrnMem = null; apRecMem = null;');
run('apSnapPred')('RID2', fakeRes(10, 3), { date8: '20250720', place: '東京', dist: '2000', surface: '芝', name: 'テスト' });
// 結果: 3番が1着（事前予想の本命が的中）
const resRows = [];
for (let i = 1; i <= 10; i++){
  resRows.push({ no: String(i), name: 'ウマ' + i, order: (i === 3) ? 1 : (i < 3 ? i + 1 : i),
                 odds: String(2 + i), pop: String(i), passing: i + '-' + i + '-' + i + '-' + i, last3: '35.0', jockey: '騎手' + i });
}
const rec2 = run('apEval')({ name: 'テスト', place: '東京', dist: '2000', surface: '芝', date8: '20250720', rows: resRows }, 'RID2', true);
T('照合された', !!rec2 && !!rec2.result);
T('preMarks が入った', !!(rec2 && rec2.preMarks && rec2.preMarks.length === 5), rec2 && rec2.preMarks);
const pm = rec2.preMarks;
eq('◎は事前予想の本命(3番)', pm[0].no, '3');
eq('◎の着順', pm[0].order, 1);
T('◎の市場期待勝率が付いている', pm[0].mi > 0 && pm[0].mi < 1, pm[0].mi);
eq('aiRank は1〜5', pm.map(function(x){ return x.aiRank; }), [1, 2, 3, 4, 5]);
T('oddsRank が入っている', pm.every(function(x){ return x.oddsRank >= 1 && x.oddsRank <= 10; }), pm.map(function(x){ return x.oddsRank; }));
T('ファクターの値も引き継がれる', pm[0].f && pm[0].f.A != null, pm[0].f);
const bp = run('apMB("202507")');
T('年月バケットに b.pre がある', !!(bp && bp.pre), bp && Object.keys(bp));
eq('b.pre のレース数', bp.pre.n, 1);
eq('b.pre の延べ頭数', bp.pre.horseN, 5);
eq('b.pre の1着頭数', bp.pre.horseWin, 1);
T('b.pre にもリフト集計欄がある', bp.pre.boostExp != null && bp.pre.sameExp != null);
eq('b.pre の回収率ぶん（1万円）', bp.pre.costU, 10000);
T('b.pre の払戻が入っている（3番が1着）', bp.pre.grossU > 0, bp.pre.grossU);
eq('3モデルのバケットは別（c.hit）', bp.c.hit.n, 1);

/* ============================================================
   C) 脚質の自動補完（学習DBの履歴から＝レース前情報）
   ============================================================ */
console.log(' C. preBuildHorses の脚質補完');
// 学習DBに「ゼンソウオー(id=Z1)の過去3戦」を入れる。4角はいつも1番手＝逃げ
run('globalThis.__DI.races = {};');
['20250105', '20250202', '20250301'].forEach(function(d8, k){
  const rows = [];
  rows.push({ no: '7', name: 'ゼンソウオー', id: 'Z1', order: k + 1, odds: '4.0', pop: '2',
              passing: '1-1-1-1', last3: '35.0', jockey: '川田将雅', time: '', weightChg: '' });
  for (let i = 1; i <= 9; i++){
    rows.push({ no: String(i === 7 ? 8 : i), name: 'アイウ' + i, id: 'Q' + i, order: ((i + k) % 9) + 2,
                odds: (3 + i).toFixed(1), pop: String(i), passing: i + '-' + i + '-' + i + '-' + i,
                last3: (35 + i * 0.2).toFixed(1), jockey: '騎手' + i, time: '', weightChg: '' });
  }
  run('globalThis.__DI.races["' + d8 + '0101"] = ' + JSON.stringify({
    rid: d8 + '0101', date8: d8, n: 10,
    meta: { date8: d8, place: '東京', m: 2000, dist: '芝2000m', surface: '芝', baba: '良' },
    rows: rows
  }) + ';');
});
run('hfDropCache();');
run('state.race = { name: "", place: "", baba: "", dist: "2000", grade: "", time: "" };');
const parsed = [
  { frame: '1', no: '7', name: 'ゼンソウオー', sexAge: '牡4', weight: '57', jockey: '川田将雅', nk: 'Z1' },
  { frame: '2', no: '8', name: 'シンバ', sexAge: '牡3', weight: '55', jockey: '武豊', nk: '' }
];
const built = run('preBuildHorses')(parsed, { '7': { odds: 4.5 }, '8': { odds: 12 } }, '20250615');
eq('2頭ぶん作られた', built.length, 2);
eq('オッズが入る', built[0].odds, '4.5');
eq('馬IDが入る', built[0].nk, 'Z1');
eq('★脚質を学習DBの過去戦(いつも1番手)から補完', built[0].style, '逃げ');
eq('履歴の無い馬は脚質を補完しない', built[1].style, '');
eq('補完した頭数を返す', built._styleFilled, 1);
eq('日付が無ければ補完しない', run('preBuildHorses')(parsed, {}, '')._styleFilled, undefined);

/* ============================================================
   D) state / DOM の復元
   ============================================================ */
console.log(' D. preWithState は必ず元へ戻す');
// コールバックは VM の外で定義すると state を参照できないので、VM 内でまとめて実行する
const dres = run(`(function(){
  state.horses = [{ no: '99', name: 'モトノママ' }];
  state.race = { name: 'もとのレース' };
  state.raceId = 'MOTOID';
  state.raceDate8 = '20200101';
  var el = document.getElementById('rName'); el.value = 'もとの値';
  var inner = preWithState({ name: 'テストR', place: '東京', dist: '2000' },
    [{ no: '1', name: 'A' }], '20250615', 'TMPID',
    function(){ return { hs: state.horses.length, rid: state.raceId, dom: document.getElementById('rName').value,
                         d8: state.raceDate8 }; });
  var after = { hs: state.horses[0].name, rid: state.raceId, d8: state.raceDate8,
                dom: document.getElementById('rName').value, race: state.race.name };
  // 例外を投げても戻すか
  var threw = false;
  try { preWithState({ name: 'X' }, [], '20250615', 'TMP2', function(){ throw new Error('わざと'); }); }
  catch(e){ threw = true; }
  var after2 = { hs: state.horses[0].name, rid: state.raceId };
  return { inner: inner, after: after, threw: threw, after2: after2 };
})()`);
eq('実行中は差し替わっている（頭数）', dres.inner.hs, 1);
eq('実行中は差し替わっている（raceId）', dres.inner.rid, 'TMPID');
eq('実行中は差し替わっている（raceDate8）', dres.inner.d8, '20250615');
T('実行中はDOMも差し替わっている（レース名が入る）', String(dres.inner.dom).indexOf('テストR') >= 0, dres.inner.dom);
eq('state.horses が戻った', dres.after.hs, 'モトノママ');
eq('state.raceId が戻った', dres.after.rid, 'MOTOID');
eq('state.raceDate8 が戻った', dres.after.d8, '20200101');
eq('state.race が戻った', dres.after.race, 'もとのレース');
eq('DOMが戻った', dres.after.dom, 'もとの値');
T('例外が伝わる', dres.threw === true);
eq('例外の後でも state.horses が戻った', dres.after2.hs, 'モトノママ');
eq('例外の後でも raceId が戻った', dres.after2.rid, 'MOTOID');

/* ============================================================
   E) ファクター別学習（提案4）
   ============================================================ */
console.log(' E. p54 flLearn / apFactorScale（ファクター別の見分け力）');
// 40レース × 10頭。f.A が大きい馬が必ず勝つ／f.Y は f.A の逆（負ける側）／f.T は全馬同じ
const N_RACE = 40, N_HEAD = 10;
const fRecs = [];
for (let r = 0; r < N_RACE; r++){
  const preRows = [], resRows2 = [];
  for (let i = 0; i < N_HEAD; i++){
    const a = i / (N_HEAD - 1);                 // 0..1（大きいほど強い）
    preRows.push({ no: String(i + 1), name: 'ウマ' + (i + 1), odds: '10.0', rank: N_HEAD - i,
      mark: '', prob: 0.1, U: a, f: { O: 0.5, Y: 1 - a, T: 0.5, K: 0.5, B: null, Y2: null, A: a } });
    resRows2.push({ no: String(i + 1), name: 'ウマ' + (i + 1), order: (i === N_HEAD - 1) ? 1 : (i + 2 > N_HEAD ? N_HEAD : i + 2),
                    odds: '10.0', pop: '', passing: '' });
  }
  // 着順を 1..10 に直す（i=9 が1着、他は 2..10）
  const ord = {};
  ord[N_HEAD - 1] = 1;
  let c = 2;
  for (let i = 0; i < N_HEAD - 1; i++){ ord[i] = c++; }
  resRows2.forEach(function(x, i){ x.order = ord[i]; });
  fRecs.push({ rid: 'F' + r, pre: { rows: preRows }, result: { rows: resRows2 } });
}
run('globalThis.__FL = [];');
g.__FL = fRecs;
run('function apCompleted(){ return globalThis.__FL || []; }');
/* ★2026-09-12 第18弾: flRaces() は「apCompleted()」ではなく「apStoredRaceList()（学習DBの全レース）＋ apGet()」
   から作るように変わった（バックテスト rec.preBt だけのレースは rec.result を持たないので拾えないため）。
   テストも同じ形にスタブする。 */
run('function apStoredRaceList(){ return (globalThis.__FL || []).map(function(r){ return { rid: r.rid, p: { rows: (r.result && r.result.rows) || [], payout: null, payouts: null, date8: "", meta: null } }; }); }');
run('function apGet(rid){ var l = globalThis.__FL || []; for (var i = 0; i < l.length; i++) if (l[i].rid === rid) return l[i]; return null; }');
run('flDrop();');
const flR = run('flRaces')();
eq('対象レース数', flR.length, N_RACE);
eq('1レースの頭数', flR[0].rows.length, N_HEAD);
near('市場期待勝率は均等(1/10)', flR[0].rows[0].mi, 0.1, 1e-9);
const L = run('flLearn')(flR);
eq('集計したレース数', L.races, N_RACE);
T('f.A は高低で差がある（よく見分けている）', L.f.A.spread > 0.2, L.f.A.spread);
near('f.A 上位1/3の実勝率', L.f.A.hiF.win, 1 / 3, 1e-9);
near('f.A 下位1/3の実勝率', L.f.A.loF.win, 0, 1e-9);
T('f.Y は逆効果（spread < 0）', L.f.Y.spread < -0.2, L.f.Y.spread);
eq('f.T は全馬同じなので判定しない', L.f.T.races, 0);
eq('f.T の倍率は1.00', L.f.T.mul, 1);
T('f.A の倍率が1.0を超える（重みを強める）', L.f.A.mul > 1.0, L.f.A.mul);
T('f.Y の倍率が1.0を下回る（重みを弱める）', L.f.Y.mul < 1.0, L.f.Y.mul);
T('倍率は 0.4〜1.6 の範囲', L.f.A.mul >= 0.4 && L.f.A.mul <= 1.6 && L.f.Y.mul >= 0.4, [L.f.A.mul, L.f.Y.mul]);
const sc = run('apFactorScale')(true);
T('スケールが返る', !!sc);
T('abl(学習DB実績) の重みを強める', sc.abl > 1.0, sc);
T('yobi(調教) の重みを弱める', sc.yobi < 1.0, sc);
T('odds は返さない（市場とのブレンド率に使うので計測のみ）', sc.odds === undefined, sc);
T('tenkai はサンプル不足なので返さない', sc.tenkai === undefined, sc);
// サンプルが少ないときは重みを動かさない
run('globalThis.__FL = globalThis.__FL.slice(0, 5);');
run('flDrop();');
const sc2 = run('apFactorScale')(true);
eq('5レースでは重みを動かさない', Object.keys(sc2).length, 0);
// 事前予想が無い（再シミュレーションだけの）レースは学習に使わない
run('globalThis.__FL = [{ rid: "X", result: { rows: [{ no: "1", order: 1, odds: "3.0" }] } }];');
run('flDrop();');
eq('pre が無いレースは対象外', run('flRaces')().length, 0);
// 表示HTML（40レースぶんに戻して確認）
g.__FL = fRecs;
run('flDrop();');
const flHtml = run('flHTML')();
T('表示HTMLが出る', flHtml.length > 0, flHtml.length);
T('表の題が出る', flHtml.indexOf('ファクター別の学習（提案4）') >= 0);
T('学習DB実績の行が出る', flHtml.indexOf('📚 学習DBの過去実績') >= 0);
T('重みへの反映が出る', flHtml.indexOf('×1.') >= 0 || flHtml.indexOf('×0.') >= 0, flHtml.slice(0, 200));
T('サンプル数の案内が出る', flHtml.indexOf('✅ 重みの自動調整が有効') >= 0);
T('事前予想が無いときの案内', (function(){
  g.__FL = [];
  run('flDrop();');
  return run('flHTML')() === '';
})());

console.log('');
console.log((bad ? 'FAIL' : 'PASS') + ' prefetch(第17弾): ok=' + ok + ' bad=' + bad);
process.exit(bad ? 1 : 0);
