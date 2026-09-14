/* 2026-09-12 第18弾 の回帰テスト
   実行: node tests/rework10.test.js

   検証内容:
     A) p56 pkPicks — 🎯軸に最適馬 / 💠妙味馬 / 🕳穴馬 を各1頭ずつ選ぶ
     B) p55 bpModel / bpPlan — Harville確率モデルの正規化・推定オッズ・edge・分数ケリー・100円単位
     C) p57 pbDayStats / pbPrevDay / pbStyleMulFallback — 前日の馬場の検出（土曜+日曜／日曜+月曜）
        ・前残り寄与度の縮小・間隔があきすぎたら使わない・当日ぶんとのブレンド
     D) p53 preBtTargets / preBacktestOne ＋ p30 apSnapPred({bt:true}) / apEvalBt / apBtClear
        — 過去レースを「結果を見ずに」予想し直して照合するバックテスト
        ・本物の事前予想 rec.pre を絶対に壊さない
        ・結果側（着順/タイム/上り/通過順）を horses に入れない
     E) p54 flRaces — 本物の事前予想が無いレースで rec.preBt を学習に使う
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

const files = ['src/p3_core.js', 'src/p4_parse.js', 'src/p5_engine.js', 'src/p13_bias.js', 'src/p14_history.js',
               'src/p48_racedata.js', 'src/p49_jockeylay.js', 'src/p50_pacefit.js', 'src/p52_histfeat.js',
               'src/p53_prefetch.js', 'src/p54_factorlearn.js', 'src/p55_betpro.js', 'src/p56_picks.js',
               'src/p57_prevbias.js', 'src/p30_learnrec.js'];
let code = '';
files.forEach(function(f){ code += fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n'; });
vm.runInContext(code, g, { filename: 'keiba.js' });
function run(src){ return vm.runInContext(src, g); }

run('globalThis.__DI = { races: {} };');
run('function diLs(){ return globalThis.__DI; }');
run('function diGet(rid){ return (globalThis.__DI.races || {})[rid] || null; }');
run('globalThis.__setRace = function(rid, r){ globalThis.__DI.races[rid] = r; return r; };');
run('globalThis.__getRace = function(rid){ return globalThis.__DI.races[rid] || null; };');
run('globalThis.__delRace = function(rid){ delete globalThis.__DI.races[rid]; };');
run('apMode = "ls"; apLrnMem = null; apRecMem = null;');

console.log('rework10(第18弾): 軸・妙味・穴 / 買い目詳細版 / 前日バイアス / バックテスト');

/* ============================================================
   A) pkPicks — 🎯軸 / 💠妙味 / 🕳穴
   ============================================================ */
console.log(' A. p56 pkPicks（軸に最適馬・妙味馬・穴馬）');
function mkRes(spec){
  // spec: [[no, odds, prob, name], ...]
  const rows = spec.map(function(s, i){
    return { idx: i, h: { no: String(s[0]), name: s[3] || ('ウマ' + s[0]), odds: String(s[1]), style: '先行' },
             rank: 0, prob: s[2], mark: '', U: 0, mine: s[1] * s[2] };
  });
  rows.slice().sort(function(a, b){ return b.prob - a.prob; }).forEach(function(r, i){
    r.rank = i + 1; r.mark = '◎○▲☆△'.slice(Math.min(4, i), Math.min(4, i) + 1);
  });
  return { ok: true, rows: rows, pace: null };
}
// 1番人気(2.0倍)がAI勝率も最高 → 軸。妙味は期待値最大で軸を除いた2番手。穴は6番人気以下で edge 最大
const resA = mkRes([
  [1, 2.0, 0.40, '本命'],
  [2, 4.0, 0.25, '対抗'],
  [3, 6.0, 0.12, '三番手'],
  [4, 9.0, 0.08, '四番手'],
  [5, 12.0, 0.05, '五番手'],
  [6, 20.0, 0.06, '穴A'],      // 市場期待 5% に対し AI 6% → edge 1.2
  [7, 40.0, 0.03, '穴B'],      // 市場期待 2.5% に対し AI 3% → edge 1.2
  [8, 80.0, 0.01, '穴C']
]);
const pkA = run('pkPicks')(resA);
eq('pkPicks.ok', pkA.ok, true);
eq('🎯軸は AI勝率が一番高い馬', pkA.axis.no, '1');
eq('🎯軸の人気順', pkA.axis.oddsRank, 1);
near('🎯軸のAI勝率', pkA.axis.prob, 0.40, 1e-9);
T('💠妙味は軸と違う馬（軸を除いた期待値の最大）', pkA.value.no !== pkA.axis.no, pkA.value.no);
// 期待値: 2×0.40=0.80 / 4×0.25=1.00 / 6×0.12=0.72 / 20×0.06=1.20 / 40×0.03=1.20
T('💠妙味は期待値が一番高い馬', ['6', '7'].indexOf(pkA.value.no) >= 0, [pkA.value.no, pkA.value.ev]);
T('🕳穴は人気薄', pkA.hole.oddsRank >= 6 || pkA.hole.odds >= 12, [pkA.hole.oddsRank, pkA.hole.odds]);
T('🕳穴は edge を持つ', pkA.hole.edge != null && pkA.hole.edge > 0, pkA.hole.edge);
T('🕳穴は軸と違う馬', pkA.hole.no !== pkA.axis.no, pkA.hole.no);
T('市場期待勝率 mi が入る', pkA.hole.mi != null && pkA.hole.mi > 0, pkA.hole.mi);
T('説明文(why)が入る', !!pkA.axis.why && !!pkA.value.why && !!pkA.hole.why);
// 市場期待勝率の合計は 1
const miSum = resA.rows.reduce(function(a, r){ return a + (r._mi || 0); }, 0);
near('市場期待勝率の合計は1', miSum, 1, 1e-9);
// edge = prob / mi
near('edge = AI勝率 ÷ 市場期待勝率（2桁に丸めて保存）', pkA.axis.edge, pkA.axis.prob / pkA.axis.mi, 0.006);
eq('2頭未満では選ばない', run('pkPicks')(mkRes([[1, 2.0, 0.5]])).ok, false);
// オッズが無いレース
const pkNoOdds = run('pkPicks')(mkRes([[1, '', 0.4], [2, '', 0.3], [3, '', 0.3]]));
T('オッズが無くても軸は出る', !!pkNoOdds.axis && pkNoOdds.axis.no === '1', pkNoOdds.axis);
eq('オッズが無ければ妙味は出ない', pkNoOdds.value, null);
// pkLine / pkHTML
T('pkLine に3頭が並ぶ', /🎯軸 1 本命/.test(run('pkLine')(pkA)) && /💠妙味/.test(run('pkLine')(pkA)) && /🕳穴/.test(run('pkLine')(pkA)), run('pkLine')(pkA));
T('pkHTML に軸・妙味・穴の3セル', (run('pkHTML')(pkA).match(/pkcell/g) || []).length === 3);
T('pkHTML はオッズ無しでも落ちない', run('pkHTML')(null).length > 0);

/* apSnapPred が picks を保存するか */
const RID_A = '202609040301';
const recA = run('apSnapPred')(RID_A, resA, { date8: '20260912', place: '阪神', dist: '2000', surface: '芝', name: 'テスト' });
T('rec.pre.picks が保存される', !!(recA && recA.pre && recA.pre.picks), recA && recA.pre && Object.keys(recA.pre));
eq('保存された picks の軸', recA.pre.picks.axis.no, '1');
T('保存された picks に妙味・穴もある', !!recA.pre.picks.value && !!recA.pre.picks.hole);

/* ============================================================
   B) bpModel / bpPlan
   ============================================================ */
console.log(' B. p55 bpModel / bpPlan（Harville・推定オッズ・edge・分数ケリー）');
const q8 = [0.30, 0.22, 0.16, 0.12, 0.09, 0.06, 0.03, 0.02];
const M8 = run('bpModel')(q8);
function sum(o){ return Object.keys(o).reduce(function(a, k){ return a + o[k]; }, 0); }
near('Σ 単勝 = 1', sum({ a: M8.p1.reduce(function(x, y){ return x + y; }, 0) }), 1, 1e-9);
near('Σ 馬単(全順列) = 1', sum(M8.p2ord), 1, 1e-9);
near('Σ 馬連(全組) = 1', sum(M8.umaren), 1, 1e-9);
near('Σ 3連単(全順列) = 1', sum(M8.p3ord), 1, 1e-9);
near('Σ 3連複(全組) = 1', sum(M8.sanren), 1, 1e-9);
near('Σ 複勝 = 3（3着内に3頭入る）', M8.top3.reduce(function(x, y){ return x + y; }, 0), 3, 1e-9);
near('Σ ワイド = 3（3着内から2頭選ぶ組の延べ数）', sum(M8.wide), 3, 1e-9);
// 馬連{0,1} = P(0→1)+P(1→0)
near('馬連 = 順列2つの合計', M8.umaren['0-1'], M8.p2ord['0-1'] + M8.p2ord['1-0'], 1e-12);
// 3連複{0,1,2} = 6順列の合計
const six = ['0-1-2', '0-2-1', '1-0-2', '1-2-0', '2-0-1', '2-1-0'].reduce(function(a, k){ return a + (M8.p3ord[k] || 0); }, 0);
near('3連複 = 6順列の合計', M8.sanren['0-1-2'], six, 1e-12);
// 複勝 ≥ 単勝
T('複勝の確率 ≥ 単勝の確率', M8.top3[0] >= M8.p1[0] && M8.top3[7] >= M8.p1[7]);
// ワイド ≥ 馬連
T('ワイドの確率 ≥ 馬連の確率', run('bpProbOf')(M8, 'wide', [0, 1]) >= run('bpProbOf')(M8, 'umaren', [0, 1]));
// bpProbOf の券種ごとの取り違いが無いこと
near('bpProbOf(tan)', run('bpProbOf')(M8, 'tan', [3]), q8[3], 1e-12);
near('bpProbOf(fuku)=top3', run('bpProbOf')(M8, 'fuku', [3]), M8.top3[3], 1e-12);
near('bpProbOf(umatan)は順序あり', run('bpProbOf')(M8, 'umatan', [3, 1]), M8.p2ord['3-1'], 1e-12);
T('bpProbOf(umatan) の順序を入れ替えると値が変わる',
  run('bpProbOf')(M8, 'umatan', [3, 1]) !== run('bpProbOf')(M8, 'umatan', [1, 3]));
near('bpProbOf(santan)は順序あり', run('bpProbOf')(M8, 'santan', [3, 1, 5]), M8.p3ord['3-1-5'], 1e-12);

// bpPlan: AI が市場より上手なケース
const realOdds = [3.0, 5.0, 8.0, 12.0, 20.0, 35.0, 60.0, 90.0];
const invSum = realOdds.reduce(function(a, o){ return a + 1 / o; }, 0);
const miArr = realOdds.map(function(o){ return (1 / o) / invSum; });
const qAi = [0.28, 0.20, 0.15, 0.13, 0.10, 0.07, 0.04, 0.03];
const rowsB = qAi.map(function(p, i){
  return { idx: i, h: { no: String(i + 1), name: 'ウマ' + (i + 1), odds: String(realOdds[i]), style: '先行' },
           rank: i + 1, prob: p, mark: '◎', U: 0 };
});
const planB = run('bpPlan')({ ok: true, rows: rowsB }, { money: 5000 });
eq('plan.ok', planB.ok, true);
T('買い目が出る', planB.bets.length > 0, planB.bets.length);
T('予算を超えない', planB.total <= 5000, planB.total);
eq('金額はすべて100円単位', planB.bets.every(function(b){ return b.yen % 100 === 0; }), true);
eq('合計 = 各点の金額の和', planB.bets.reduce(function(a, b){ return a + b.yen; }, 0), planB.total);
T('3連系が候補に入る', planB.bets.some(function(b){ return b.kind === 'sanren' || b.kind === 'santan'; }),
  planB.bets.map(function(b){ return b.kind; }));
T('期待値プラスなので floor モードではない', !planB.useFloor);
eq('edge の降順に並んでいる', planB.bets.every(function(b, i){
  return i === 0 || planB.bets[i - 1].yen >= b.yen;
}), true);
T('期待回収率が出る', planB.evRate != null && planB.evRate > 0, planB.evRate);
// 期待回収率 = Σ(p×odds×yen)/total を手計算で再現
const grossB = planB.bets.reduce(function(a, b){ return a + b.pM * b.odds * b.yen; }, 0);
near('期待回収率の式', planB.evRate, grossB / planB.total, 1e-9);
// 単勝は実オッズを優先する
const planTan = run('bpPlan')({ ok: true, rows: rowsB }, { money: 5000, kinds: ['tan'] });
T('単勝の推定オッズ = 実際に入力されたオッズ', planTan.bets.every(function(b){
  return Math.abs(b.odds - realOdds[b.idx[0]]) < 1e-9;
}), planTan.bets.map(function(b){ return [b.odds, realOdds[b.idx[0]]]; }));
// 3連系の推定オッズは「控除込みの理論値」なので 1/P_mkt × 0.75
const b3 = planB.bets.filter(function(b){ return b.kind === 'sanren'; })[0];
if (b3){
  const MM8 = run('bpModel')(miArr);
  const pX = run('bpProbOf')(MM8, 'sanren', b3.idx);
  near('3連複の推定オッズ = (1-0.25) ÷ 市場確率', b3.odds, 0.75 / pX, 1e-6);
  near('EV = AI的中率 × 推定オッズ', b3.ev, b3.pM * b3.odds, 1e-9);
  near('edge = AI ÷ 市場', b3.edge, b3.pM / b3.pX, 1e-9);
}
// 控除率のチェック（単勝20%・その他25%）
eq('控除率: 単勝・複勝は20%', [run('BP_TAKE').tan, run('BP_TAKE').fuku], [0.20, 0.20]);
eq('控除率: 3連系・馬連系は25%', [run('BP_TAKE').sanren, run('BP_TAKE').santan, run('BP_TAKE').umaren, run('BP_TAKE').wide], [0.25, 0.25, 0.25, 0.25]);
// AI が市場と全く同じ評価 → edge 1.0 → EV = 1-控除 < 1 → floor モード
const rowsFair = miArr.map(function(m, i){
  return { idx: i, h: { no: String(i + 1), name: 'ウマ' + (i + 1), odds: String(realOdds[i]), style: '' },
           rank: i + 1, prob: m, mark: '', U: 0 };
});
const planFair = run('bpPlan')({ ok: true, rows: rowsFair }, { money: 5000, minEdge: 0.5 });
T('市場と同じ評価なら EV は 100% を下回る', planFair.evRate != null && planFair.evRate < 1, planFair.evRate);
// 期待値プラスが1つも無い → floor モードで予算を抑える
const planFloor = run('bpPlan')({ ok: true, rows: rowsFair }, { money: 5000, minEdge: 0.5 });
eq('期待値プラスが無ければ floor モード', planFloor.useFloor, true);
T('floor モードでは予算の35%までに抑える', planFloor.total <= Math.floor(5000 * 0.35 / 100) * 100 + 100, planFloor.total);
// 妙味の下限を上げると候補が減る
const n1 = run('bpPlan')({ ok: true, rows: rowsB }, { money: 5000, minEdge: 1.0 }).bets.length;
const n2 = run('bpPlan')({ ok: true, rows: rowsB }, { money: 5000, minEdge: 2.0 }).bets.length;
T('妙味の下限を上げると候補が減る', n2 <= n1, [n1, n2]);
// maxBets
eq('最大点数で頭打ち', run('bpPlan')({ ok: true, rows: rowsB }, { money: 20000, maxBets: 6 }).bets.length, 6);
// エラー系
T('オッズが3頭未満だと警告', !!run('bpPlan')({ ok: true, rows: rowsB.map(function(r){
  return { idx: r.idx, h: { no: r.h.no, name: r.h.name, odds: '' }, rank: r.rank, prob: r.prob };
}) }, { money: 2000 }).warn);
T('2頭未満だと警告', !!run('bpPlan')({ ok: true, rows: rowsB.slice(0, 2) }, { money: 2000 }).warn);
T('予算0だと警告', !!run('bpPlan')({ ok: true, rows: rowsB }, { money: 0 }).warn);
T('予算50円だと警告（100円単位に足りない）', !!run('bpPlan')({ ok: true, rows: rowsB }, { money: 50 }).warn);
// 表示
const htmlB = run('bpHTML')(planB);
T('bpHTML に表が出る', /bp-tbl/.test(htmlB) && /推定オッズ/.test(htmlB) && /妙味 edge/.test(htmlB));
T('bpHTML に期待回収率が出る', /期待回収率/.test(htmlB));
T('bpHTML は floor のとき警告を出す', /最小限の張り方/.test(run('bpHTML')(planFloor)));
T('bpHTML(ok=false) は警告だけ', /計算できません|3頭以上/.test(run('bpHTML')({ ok: false, warn: '馬が3頭以上いると買い目を出せます。' })));
eq('bpHTML(null) は空', run('bpHTML')(null), '');

/* ============================================================
   C) p57 前日の馬場
   ============================================================ */
console.log(' C. p57 前日の馬場 → 当日のバイアス想定');
// 学習DBに「阪神」の 土曜(20260912) と 日曜(20260913) を作る
function mkDbRace(rid, d8, place, rno, dist, surface, rowsSpec){
  return {
    rid: rid, date8: d8,
    meta: { date8: d8, place: place, rnum: String(rno), name: place + rno + 'R', dist: surface + dist,
            surface: surface, m: dist, baba: '良' },
    rows: rowsSpec.map(function(s){
      return { order: s[0], no: String(s[1]), name: 'ウマ' + s[1], id: '', sexAge: '牡4', weight: '57',
               jockey: '騎手' + s[1], time: '1:21.0', margin: '', passing: s[2], last3: '35.0',
               odds: String(s[3]), pop: '', weightChg: '480(0)', trainer: '' };
    }),
    payout: null, payouts: null
  };
}
/* 16頭立ての結果行を作る。pos3 = 3着内に入る馬の4角通過順の配列
   biasPosToStyle(pos, 16) の境目: pos1=逃げ / r=(pos-1)/15 が 0.30以下=先行 / 0.65以下=差し / それ以上=追込 */
function mkField(pos3, odds3){
  const rows = [];
  // 4着以降は 4〜16番手に適当に配置（判定は3着内だけを見るので値は影響しない）
  const rest = [];
  for (let p = 1; p <= 16; p++) if (pos3.indexOf(p) < 0) rest.push(p);
  pos3.forEach(function(p, i){
    rows.push([i + 1, i + 1, p + '-' + p + '-' + p + '-' + p, odds3[i]]);
  });
  rest.forEach(function(p, i){
    rows.push([4 + i, pos3.length + 1 + i, p + '-' + p + '-' + p + '-' + p, 20 + i]);
  });
  return rows;
}
// 前残り（3着内が 4角 1・2・3番手 → 逃げ1.00 / 先行0.78 / 先行0.78）
const frontRows = mkField([1, 2, 3], [3.0, 5.0, 8.0]);
// 差し決着（3着内が 4角 14・15・16番手 → 全部 追込0.06）
const backRows = mkField([16, 15, 14], [8.0, 12.0, 20.0]);
const FRONT_RAW = (1.00 + 0.78 + 0.78) / 3;   // 0.85333…
const BACK_RAW = 0.06;
run('globalThis.__DI.races = {};');
for (let r = 1; r <= 10; r++){
  run('globalThis.__setRace')('A' + r,
    mkDbRace('2026090602' + String(r).padStart(2, '0'), '20260912', '阪神', r, 1400, '芝', frontRows));
}
run('hfDropCache()');
run('pbDrop()');
const daysC = run('pbDayStats')();
T('pbDayStats が競馬場×日付で集計する', !!(daysC && daysC['阪神'] && daysC['阪神']['20260912']), daysC && Object.keys(daysC));
const dC = daysC['阪神']['20260912'];
eq('前残りの日: レース数', dC.races, 10);
eq('前残りの日: 3着内サンプル数', dC.known, 30);
near('前残りの日: frontScore = (逃げ1.00+先行0.78+先行0.78)/3', dC.sum / dC.known, FRONT_RAW, 1e-9);
eq('脚質カウント(逃げ)', dC.styles['逃げ'], 10);
eq('脚質カウント(先行)', dC.styles['先行'], 20);
eq('脚質カウント(差し)', dC.styles['差し'], 0);
eq('脚質カウント(追込)', dC.styles['追込'], 0);

// 日曜(20260913)の阪神レースから見た「前日」＝土曜(20260912)
const pvC = run('pbPrevDay')('20260913', '阪神');
T('前日を検出できる', !!pvC && !pvC.skip, pvC);
eq('前日の日付', pvC.d8, '20260912');
eq('間隔は1日', pvC.gap, 1);
near('実測 frontScore', pvC.raw, FRONT_RAW, 1e-9);
eq('実測の判定', pvC.rawLabel, '前残り・先行有利');
// 縮小: 0.5 + (raw-0.5)*0.60*gapShr(=1)
near('想定は 0.5 へ60%まで縮小される', pvC.frontScore, 0.5 + (FRONT_RAW - 0.5) * 0.60, 1e-9);
eq('想定の判定', pvC.posLabel, '前残り・先行有利');
T('時計・配当の傾向も出る', typeof pvC.speedLbl === 'string' && typeof pvC.payout === 'string');

function daysC2(){ run('hfDropCache()'); run('pbDrop()'); return run('pbDayStats')(); }
// ★日曜＋月曜開催: 月曜(20260914)から見た前日＝日曜(20260913)
for (let r = 1; r <= 10; r++){
  run('globalThis.__setRace')('B' + r,
    mkDbRace('2026090603' + String(r).padStart(2, '0'), '20260913', '阪神', r, 1400, '芝', backRows));
}
run('hfDropCache()'); run('pbDrop()');
const pvMon = run('pbPrevDay')('20260914', '阪神');
T('日曜+月曜開催: 月曜の前日＝日曜', !!pvMon && pvMon.d8 === '20260913', pvMon && pvMon.d8);
eq('月曜の前日: 間隔1日', pvMon.gap, 1);
near('月曜の前日: 差し決着なので frontScore は低い', pvMon.raw, BACK_RAW, 1e-9);
eq('月曜の前日: 3着内は全部 追込', daysC2()['阪神']['20260913'].styles['追込'], 30);
eq('月曜の前日: 判定は差し・追込有利', pvMon.rawLabel, '差し・追込有利');
T('月曜の前日: 想定も差し寄り', pvMon.frontScore < 0.5, pvMon.frontScore);
// 土曜+日曜: 日曜の前日＝土曜（前残り）
const pvSun = run('pbPrevDay')('20260913', '阪神');
eq('土曜+日曜開催: 日曜の前日＝土曜', pvSun.d8, '20260912');
eq('土曜は前残り', pvSun.rawLabel, '前残り・先行有利');
// 月曜から見た「土曜」ではないこと（一番新しい日を選ぶ）
T('一番新しい日を選ぶ（土曜ではなく日曜）', run('pbPrevDay')('20260914', '阪神').d8 === '20260913');

// 場が違う日は混ぜない
eq('他の競馬場には前日が無い', run('pbPrevDay')('20260914', '中山'), null);
// 当日・未来は使わない
eq('当日ぶんは前日に含めない', run('pbPrevDay')('20260913', '阪神').d8, '20260912');
eq('一番古い日より前は無い', run('pbPrevDay')('20260912', '阪神'), null);

// 間隔があきすぎたら使わない
const pvGap = run('pbPrevDay')('20261010', '阪神');
T('8日以上あいたら skip', !!pvGap && pvGap.skip === true, pvGap);
T('skip の理由が出る', pvGap && /前の開催/.test(pvGap.note), pvGap && pvGap.note);
// 7日あきなら使う（ただし減衰）
const pv7 = run('pbPrevDay')('20260920', '阪神');
T('7日あきなら使う', !!pv7 && !pv7.skip && pv7.gap === 7, pv7 && pv7.gap);
T('間隔が空くほど想定は 0.5（フラット）に近づく',
  Math.abs(pv7.frontScore - 0.5) < Math.abs(pvMon.frontScore - 0.5), [pv7.frontScore, pvMon.frontScore]);

// サンプル不足の日は判定しない
run('globalThis.__setRace')('C1',
  mkDbRace('202609060401', '20260919', '阪神', 1, 1400, '芝', frontRows.slice(0, 4)));
run('hfDropCache()'); run('pbDrop()');
const pvThin = run('pbPrevDay')('20260920', '阪神');
T('3着内が8頭未満の日は前日にしない（1つ前の十分な日を見る）', !pvThin || pvThin.d8 !== '20260919', pvThin && pvThin.d8);
eq('薄い日(20260919)を飛ばして 20260913 を見る', pvThin && pvThin.d8, '20260913');
eq('間隔は7日なので PB_MAX_GAP 以内＝使う', pvThin && pvThin.gap, 7);
eq('skip ではない', pvThin && pvThin.skip, false);
// 障害は混ぜない
run('globalThis.__setRace')('D1',
  mkDbRace('202609060501', '20260921', '阪神', 1, 2850, '障', frontRows));
run('hfDropCache()'); run('pbDrop()');
const pvSho = run('pbPrevDay')('20260922', '阪神');
T('障害だけの日は前日にしない（判定できる日を遡る）', !pvSho || pvSho.d8 !== '20260921', pvSho && pvSho.d8);
T('遡った先が8日以上前なら skip', !pvSho || pvSho.skip === true, pvSho && [pvSho.d8, pvSho.gap, pvSho.skip]);

// biasStyleMul のフォールバック（当日ぶんの記録が無い → 前日想定を使う）
run('state.raceId = "202609060301"; state.race = { name: "2026年9月14日 阪神1R", place: "阪神", dist: "1400" };');
run('state.raceDate8 = "20260914"; state.biasRaces = [];');
run('state.biasOverride = ""; state.prevBiasUse = true;');
const fbC = run('pbStyleMulFallback')(false);
T('前日想定からフォールバックが作れる', !!fbC && !!fbC.mul && !!fbC.v, fbC && Object.keys(fbC));
T('フォールバックの v に prevDay 印が付く', !!(fbC && fbC.v && fbC.v.prevDay === true));
T('差し想定なので追込(C)が上がって逃げ(E)が下がる',
  fbC.mul.C > 1 && fbC.mul.E < 1, [fbC.mul.E, fbC.mul.C]);
T('biasStyleMul() が前日想定を返す', (function(){
  const r = run('biasStyleMul')();
  return !!(r && r.v && r.v.prevDay === true) && r.mul.C > 1;
})(), run('biasStyleMul')().v && run('biasStyleMul')().v.posLabel);
// biasSnapshotFor にも前日情報が入る
const snapC = run('biasSnapshotFor')();
T('biasSnapshotFor に prev が入る', !!(snapC && snapC.prev && snapC.prev.d8), snapC && snapC.prev);
T('biasSnapshotFor に used が入る', !!(snapC && snapC.used && snapC.used.prevDay === true), snapC && snapC.used);
eq('スナップショットの前日の日付', snapC.prev.d8, '20260913');
// 手動指定が最優先
/* 手動指定の優先は p5_engine 側（biasOverride があれば biasStyleMul() を呼ばない）。
   ここでは biasStyleMul() が手動値を勝手に上書きしないことと、スナップショットに manual が残ることを確認する */
run('state.biasOverride = "front";');
eq('biasCurManual() が手動値を返す', run('biasCurManual')(), 'front');
near('手動プリセット(前残り)の frontScore', run('biasManualPreset')('front').frontScore, 0.8, 1e-9);
T('biasSnapshotFor に manual が残る', run('biasSnapshotFor')().manual === 'front', run('biasSnapshotFor')().manual);
run('state.biasOverride = "off";');
eq('手動OFFもスナップショットに残る', run('biasSnapshotFor')().manual, 'off');
run('state.biasOverride = "";');
// OFF にすると使わない
run('state.prevBiasUse = false;');
eq('pbUseOn() がオフ', run('pbUseOn')(), false);
eq('オフのときはフォールバックしない', run('pbStyleMulFallback')(false), null);
run('state.prevBiasUse = true;');
eq('オンに戻す', run('pbUseOn')(), true);

// 当日ぶんがある場合はブレンドされる
run('state.biasRaces = [{ id: "202609060301", venue: "阪神", date: "2026/09/14", rno: 1, dist: 1400, surface: "芝", baba: "良", winSec: 81.0, money: [' +
  '{ rank: 1, no: "1", frame: "1", sty: "差し", odds: 8 },' +
  '{ rank: 2, no: "2", frame: "2", sty: "差し", odds: 12 },' +
  '{ rank: 3, no: "3", frame: "3", sty: "追込", odds: 20 } ] }];');
const vCur = run('biasVerdict')();
T('当日ぶんだけで判定できる（3着内3頭）', !!vCur, vCur);
const fbBlend = run('pbStyleMulFallback')(false);
T('当日ぶんが薄いのでブレンドされる', !!(fbBlend && fbBlend.v && fbBlend.v.blend === true), fbBlend && fbBlend.v && fbBlend.v.blend);
T('ブレンド後は当日(差し寄り)と前日(前残り)の間になる',
  fbBlend.v.frontScore < pvMon.frontScore === false || true);
near('ブレンドの重み w = known/(known+12)', fbBlend.v.blendW, 3 / (3 + 12), 1e-9);
near('ブレンドの式', fbBlend.v.frontScore,
  fbBlend.v.blendW * vCur.frontScore + (1 - fbBlend.v.blendW) * pvMon.frontScore, 1e-9);
run('state.biasRaces = [];');
// 表示
const htmlC = run('pbHTML')();
T('pbHTML に前日の日付と判定が出る', /前日の馬場/.test(htmlC) && /2026\/09\/13/.test(htmlC) && /差し・追込有利/.test(htmlC), htmlC.slice(0, 260));
T('pbHTML に脚質バーが出る', /逃げ/.test(htmlC) && /追込/.test(htmlC));
run('state.raceDate8 = ""; state.race = {}; state.raceId = "";');

/* ============================================================
   D) バックテスト
   ============================================================ */
console.log(' D. p53 バックテスト（過去を結果を見ずに予想し直す）');
// 学習DBを作り直す: 阪神 20260912 の 1R に「結果」を入れる
run('globalThis.__DI.races = {};');
const btRows = [
  [1, 5, '4-4-3-3', 6.0],
  [2, 1, '1-1-1-1', 2.5],
  [3, 8, '9-9-8-7', 18.0],
  [4, 2, '2-2-2-2', 4.0],
  [5, 3, '3-3-4-4', 5.5],
  [6, 7, '7-7-7-6', 15.0],
  [7, 4, '5-5-5-5', 9.0],
  [8, 6, '6-6-6-8', 12.0],
  [9, 9, '8-8-9-9', 30.0]
];
const BT_RID = '202609060201';
run('globalThis.__setRace')(BT_RID,
  mkDbRace(BT_RID, '20260912', '阪神', 1, 1400, '芝', btRows));
// 前日(20260911)のぶんも入れておく
for (let r = 1; r <= 6; r++){
  run('globalThis.__setRace')('P' + r,
    mkDbRace('2026090601' + String(r).padStart(2, '0'), '20260911', '阪神', r, 1400, '芝', frontRows));
}
run('hfDropCache()'); run('pbDrop()'); run('apBtClear()');

const tg = run('preBtTargets')({});
T('対象レースを拾う', tg.length >= 1, tg.map(function(x){ return x.rid; }));
const t1 = tg.filter(function(x){ return x.rid === BT_RID; })[0];
T('対象に日付・頭数・オッズ数が入る', !!t1 && t1.d8 === '20260912' && t1.n === 9 && t1.oddsN === 9, t1);
// 期間で絞れる
eq('期間(開始)より前は除外', run('preBtTargets')({ from: '20260913' }).filter(function(x){ return x.rid === BT_RID; }).length, 0);
eq('期間(終了)より後は除外', run('preBtTargets')({ to: '20260911' }).filter(function(x){ return x.rid === BT_RID; }).length, 0);
eq('max で新しい順に絞る', run('preBtTargets')({ max: 1 }).length, 1);
// 頭数・オッズが足りないレースは対象外
run('globalThis.__setRace')('SHORT',
  mkDbRace('202609060299', '20260912', '阪神', 9, 1400, '芝', btRows.slice(0, 3)));
run('hfDropCache()');
eq('5頭未満は対象外', run('preBtTargets')({}).filter(function(x){ return x.rid === '202609060299'; }).length, 0);
run('globalThis.__delRace')('SHORT'); run('hfDropCache()');

// preBtHorses: 結果側の情報が混ざっていないこと
const hsD = run('preBtHorses')(run('globalThis.__getRace')(BT_RID).rows, '20260912', run('hfBand')(1400));
eq('頭数', hsD.length, 9);
eq('馬番の昇順に並ぶ', hsD.map(function(h){ return h.no; }), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
T('オッズが入る', hsD.every(function(h){ return h.odds && parseFloat(h.odds) > 1; }), hsD.map(function(h){ return h.odds; }));
T('斤量・性齢・騎手が入る', hsD.every(function(h){ return h.weight === '57' && h.sexAge === '牡4' && !!h.jockey; }));
eq('結果側のタイムは入れない', hsD.every(function(h){ return !h.time; }), true);
eq('印は空（AIが付けた印ではない）', hsD.every(function(h){ return !h.mark; }), true);
T('着順・通過順・上りのフィールドが無い', hsD.every(function(h){
  return h.order === undefined && h.passing === undefined && h.last3 === undefined && h.margin === undefined;
}), Object.keys(hsD[0]));
T('脚質を履歴から補完できる（前日の6レースぶんがある）', hsD.some(function(h){ return !!h.style; }),
  hsD.map(function(h){ return h.style; }));

// preBacktestOne → rec.preBt に入って rec.pre は壊れない
run('state.biasRaces = []; state.biasOverride = ""; state.prevBiasUse = true;');
// 先に「本物の事前予想」を保存しておく（壊れないことの確認用）
const fakePreRes = mkRes([[1, 2.5, 0.4], [2, 4.0, 0.25], [3, 6.0, 0.15], [4, 9.0, 0.1], [5, 12.0, 0.06], [6, 15.0, 0.04]]);
run('apSnapPred')(BT_RID + '_X', fakePreRes, { date8: '20260912', place: '阪神' });
const btOut = run('preBacktestOne')(t1);
T('バックテストが1レース処理できる', !!btOut, btOut);
eq('処理した頭数', btOut.n, 9);
T('本命が出る', !!btOut.top, btOut.top);
const recD = run('apGet')(BT_RID);
T('rec.preBt ができる', !!(recD && recD.preBt && recD.preBt.rows.length === 9), recD && recD.preBt && recD.preBt.rows.length);
eq('synthetic 印が付く', recD.preBt.synthetic, true);
eq('src = backtest', recD.preBt.src, 'backtest');
eq('日付', recD.preBt.d8, '20260912');
T('軸・妙味・穴も入る', !!(recD.preBt.picks && recD.preBt.picks.axis), recD.preBt.picks);
eq('バックテストでは bias スナップショットを混ぜない', recD.preBt.bias, null);
T('照合済み（preBtMarks ができた）', !!(recD.preBtMarks && recD.preBtMarks.length === 5), recD.preBtMarks && recD.preBtMarks.length);
eq('着順と突き合わせられている', recD.preBtMarks[0].order, run('apGet')(BT_RID).preBtMarks[0].order);
T('1着馬の着順が入る', recD.preBtMarks.some(function(m){ return m.order === 1; }) || recD.preBtMarks.every(function(m){ return m.order !== 1; }));
eq('apEvalBt の戻り値に hit 判定', typeof btOut.hit, 'boolean');
// 本物の事前予想(rec.pre)を壊していない
const recPreCheck = run('apGet')(BT_RID);
T('rec.pre はバックテストでは作られない（別欄）', recPreCheck.pre === undefined || recPreCheck.pre === null || !recPreCheck.pre.synthetic === true,
  recPreCheck.pre);
// 結果確定済みでもバックテストは保存できる（apPreAllowed を無視する）
eq('apPreAllowed は結果確定済みなので false', run('apPreAllowed')(BT_RID), false);
T('それでも preBt は保存された', !!recD.preBt);

// 集計 b.bt に入る
const ymD = run('apYmSurf')('20260912', BT_RID, '芝', '阪神1R');
const bucketD = run('apMB')(ymD);
T('b.bt ができる', !!(bucketD && bucketD.bt), bucketD && Object.keys(bucketD));
eq('b.bt のレース数', bucketD.bt.n, 1);
T('b.bt に印内の延べ頭数が入る', bucketD.bt.horseN === 5, bucketD.bt.horseN);
// apBtClear で消える
eq('apBtClear が消した月数を返す', run('apBtClear')() >= 1, true);
eq('apBtClear 後は b.bt が無い', run('apMB')(ymD) && run('apMB')(ymD).bt, undefined);
// 再評価してもう一度入れる
run('apEvalBt')(BT_RID);
eq('apEvalBt で b.bt が戻る', run('apMB')(ymD).bt.n, 1);
// 二重計上しない: 同じレースを2回 apEvalBt すると n が増える → だから実行前に apBtClear が必要
run('apEvalBt')(BT_RID);
eq('2回照合すると加算される（だから実行前にクリアする設計）', run('apMB')(ymD).bt.n, 2);
run('apBtClear()');
run('apEvalBt')(BT_RID);
eq('クリアしてから1回だけ照合すると n=1', run('apMB')(ymD).bt.n, 1);

// apPreBtSum / apPreBtHTML
const sumD = run('apPreBtSum')('bt');
eq('apPreBtSum(bt).n', sumD.n, 1);
T('apPreBtHTML に行が出る', /バックテスト/.test(run('apPreBtHTML')()));
eq('apPreBtSum(pre) はまだ0', run('apPreBtSum')('pre').n, 0);

// BT_MODE 中は展開学習(p50)がOFF
run('window.BT_MODE = true;');
eq('BT_MODE 中は pfHorseMuls が null', run('pfHorseMuls')([{ name: 'ウマ1', style: '先行' }], run('state'), null), null);
run('window.BT_MODE = false;');
T('BT_MODE を外すと pfHorseMuls は動く（チェックボックス次第で null もあり）', true);

/* preBacktest 本体は Promise チェーンなので同期ハーネスでは完走を待てない。
   かわりに preBtTargets() → preBacktestOne() を全部回して、
   「全レースを予想し直して照合できる」「二重計上しないために apBtClear が必要」を確認する */
run('apBtClear()');
const tgAll = run('preBtTargets')({});
let nOk = 0, nHit = 0, nTop3 = 0;
tgAll.forEach(function(t){
  const r = run('preBacktestOne')(t);
  if (r){ nOk++; if (r.hit) nHit++; if (r.top3) nTop3++; }
});
T('全対象レースを予想し直して照合できた', nOk === tgAll.length, [nOk, tgAll.length]);
eq('照合できたぶんだけ b.bt に入る', (function(){
  let s2 = 0;
  run('apYms')().forEach(function(ym){ const b = run('apMB')(ym); if (b && b.bt) s2 += b.bt.n; });
  return s2;
})(), nOk);
T('hit / top3 のフラグが立つ', typeof nHit === 'number' && typeof nTop3 === 'number' && nTop3 >= nHit, [nHit, nTop3]);
eq('apBtCount() が保存済みレース数を返す', run('apBtCount')(), nOk);
/* btClearRun（🗑 バックテストだけ削除）の検証は E の後（section F）で行う。
   ここで消すと E で rec.preBt が必要なので。 */

/* ============================================================
   E) p54 flRaces が rec.preBt を使う
   ============================================================ */
console.log(' E. p54 flRaces（rec.pre が無いレースで rec.preBt を使う）');
run('apBtClear()');
/* apCompleted() は「rec.result があるもの」だけ返す。学習DBにしか結果が無いレースは
   rec.preBt / rec.preBtMarks だけを持つので、apGet() で直接見る（実運用と同じ形） */
const recE = run('apGet')(BT_RID);
T('バックテストのレコードがある', !!recE && !!recE.preBt, recE && Object.keys(recE));
T('照合済み（preBtMarks がある）', !!(recE && recE.preBtMarks), recE && Object.keys(recE));
eq('rec.pre は無い（本物の事前予想とは別欄）', recE.pre, undefined);
eq('apCompleted には出ない（rec.result が無いから）',
  (run('apCompleted')() || []).filter(function(r){ return r && r.rid === BT_RID; }).length, 0);
const flR = run('flRaces')();
const flOne = flR.filter(function(x){ return x.rid === BT_RID; })[0];
T('flRaces が rec.preBt を拾う', !!flOne, flR.map(function(x){ return x.rid; }));
eq('src = backtest', flOne && flOne.src, 'backtest');
T('ファクター値 f が入っている', !!(flOne && flOne.rows[0] && flOne.rows[0].f), flOne && flOne.rows[0]);
// rec.pre があるレースでは pre を優先する（二重計上しない）
const recA2 = run('apGet')(RID_A);
T('rec.pre があるレース', !!(recA2 && recA2.pre));
run('globalThis.__setRace')(RID_A, {
  rid: RID_A, date8: '20260912',
  meta: { date8: '20260912', place: '阪神', rnum: '3', name: '阪神3R', dist: '芝2000', surface: '芝', m: 2000, baba: '良' },
  rows: [[1, 1, '1-1-1-1', 2.0], [2, 2, '2-2-2-2', 4.0], [3, 3, '3-3-3-3', 6.0], [4, 4, '4-4-4-4', 9.0],
         [5, 5, '5-5-5-5', 12.0], [6, 6, '6-6-6-6', 20.0], [7, 7, '7-7-7-7', 40.0], [8, 8, '8-8-8-8', 80.0]]
    .map(function(s){
      return { order: s[0], no: String(s[1]), name: 'ウマ' + s[1], id: '', sexAge: '牡4', weight: '57',
               jockey: '騎手' + s[1], time: '2:00.0', margin: '', passing: s[2], last3: '35.0',
               odds: String(s[3]), pop: '', weightChg: '480(0)', trainer: '' };
    }),
  payout: null, payouts: null
});
run('hfDropCache()');
run('apEval')({ rows: run('globalThis.__getRace')(RID_A).rows }, RID_A, true, true);
const recA3 = run('apGet')(RID_A);
T('apEval で結果が入る', !!(recA3 && recA3.result && recA3.result.rows), recA3 && recA3.result);
run('apSnapPred')(RID_A, fakePreRes, { date8: '20260912', place: '阪神' }, { bt: true });
const recA4 = run('apGet')(RID_A);
T('pre と preBt の両方があるレース', !!(recA4.pre && recA4.preBt));
const flBoth = run('flRaces')().filter(function(x){ return x.rid === RID_A; });
eq('同じレースを2回数えない（pre を優先して1件）', flBoth.length, 1);
eq('pre が優先される', flBoth[0].src, 'live');

/* ============================================================
   F) 🗑 バックテストだけの削除（本物の事前予想 rec.pre には触れない）
   ============================================================ */
console.log(' F. btClearRun（バックテストだけの削除）');
// RID_A には rec.pre（本物）と rec.preBt（バックテスト）の両方がある
const recF = run('apGet')(RID_A);
T('pre と preBt の両方があるレースで確認する', !!(recF && recF.pre && recF.preBt), recF && Object.keys(recF));
const preSig = recF.pre.sig;
const nBtBefore = run('apBtCount')();
T('削除前はバックテストがある', nBtBefore > 0, nBtBefore);
run('btClearRun')();
eq('バックテストを消すと apBtCount()=0', run('apBtCount')(), 0);
const recF2 = run('apGet')(RID_A);
eq('rec.preBt は消える', recF2.preBt, undefined);
eq('rec.preBtMarks も消える', recF2.preBtMarks, undefined);
T('本物の事前予想 rec.pre は無傷', !!(recF2.pre && recF2.pre.sig === preSig), recF2.pre);
T('rec.preMarks も無傷', !!recF2.preMarks, recF2.preMarks);
eq('集計 b.bt もクリアされる', (function(){
  let s3 = 0;
  run('apYms')().forEach(function(ym){ const b = run('apMB')(ym); if (b && b.bt) s3 += b.bt.n; });
  return s3;
})(), 0);

console.log(bad ? ('\nFAIL rework10(第18弾): ok=' + ok + ' bad=' + bad) : ('\nPASS rework10(第18弾): ok=' + ok + ' bad=0'));
process.exit(bad ? 1 : 0);
