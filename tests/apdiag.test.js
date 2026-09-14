/* 2026-09-12 第17弾・提案1 の回帰テスト（🔬 AI予想の診断）
   実行: node tests/apdiag.test.js

   検証内容:
     ・保存済みの自己検証レコードから「基準線（1番人気買い／全頭均等買い）」を正しく出す
     ・人気別の実績（実勝率 vs 市場期待勝率）を正しく出す
     ・モデルごとの「◎が1番人気だった率」「◎の人気別分布」「リフト」を正しく出す
     ・印5頭の回収率（1点100円均等）が 延べ頭数 で割られている（レース数×5 で割らない）
     ・計測専用なので印の付け方には一切触れない（apUScores / apMarksByU を呼ばない）
   合成データは「全馬のオッズが 2,4,6,...,20 の10頭立て」2レースで、
   R1=1番人気勝ち／R2=5番人気勝ち。手計算した値と一致することを見る。
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

const store = {};
const ctx = {
  console: console, JSON: JSON, Math: Math, Date: Date, parseInt: parseInt, parseFloat: parseFloat,
  String: String, Number: Number, Boolean: Boolean, isFinite: isFinite, isNaN: isNaN,
  Array: Array, Object: Object, RegExp: RegExp, Error: Error, Promise: Promise,
  localStorage: {
    getItem: function(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function(k, v){ store[k] = String(v); },
    removeItem: function(k){ delete store[k]; },
    key: function(i){ return Object.keys(store)[i] || null; },
    get length(){ return Object.keys(store).length; }
  },
  document: { addEventListener: function(){}, getElementById: function(){ return null; },
              querySelector: function(){ return null; }, querySelectorAll: function(){ return []; },
              createElement: function(){ return { style: {}, classList: { add: function(){}, remove: function(){} },
                                                  addEventListener: function(){} }; } },
  window: {}, navigator: { userAgent: 'node' }
};
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);

function load(file){
  const p = path.join(ROOT, 'src', file);
  try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: file }); }
  catch(e){ console.log('  ! load skip ' + file + ': ' + e.message.slice(0, 100)); }
}
['p3_core.js', 'p51_apdiag.js'].forEach(load);
function fn(name){ return vm.runInContext(name, ctx); }

/* ---------- 合成の自己検証レコード ---------- */
const ODDS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
const INV = ODDS.reduce(function(a, o){ return a + 1 / o; }, 0);       // 1.4644841…
const MI1 = (1 / 2) / INV;                                              // 1番人気の市場期待勝率
const MI5 = (1 / 10) / INV;                                             // 5番人気の市場期待勝率

// R1: 馬番iがi着（1番人気勝ち） / R2: 5番人気勝ち
const ORD1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const ORD2 = [2, 3, 4, 5, 1, 6, 7, 8, 9, 10];   // 馬番1→2着, 2→3着, 3→4着, 4→5着, 5→1着
function mkRec(rid, orders, hitOrder, roiNos){
  return {
    rid: rid, ym: '202609', auto: true,
    result: { rows: orders.map(function(o, i){
      return { no: String(i + 1), name: 'ウマ' + (i + 1), order: o, odds: String(ODDS[i]), pop: String(i + 1), passing: '' };
    }) },
    cMarks: {
      hit: hitOrder.map(function(no, r){
        return { no: String(no), name: 'ウマ' + no, mark: '◎○▲☆△'.slice(r, r + 1) || '△', style: '',
                 aiRank: r + 1, oddsRank: no, odds: ODDS[no - 1], pu: 0.2, u: 1 - r * 0.1, order: orders[no - 1] };
      }),
      roi: roiNos.map(function(no, r){
        return { no: String(no), name: 'ウマ' + no, mark: '◎○▲☆△'.slice(r, r + 1) || '△', style: '',
                 aiRank: r + 1, oddsRank: no, odds: ODDS[no - 1], pu: 0.2, u: 1 - r * 0.1, order: orders[no - 1] };
      }),
      hyb: [1, 2, 3, 4, 5].map(function(no, r){
        return { no: String(no), name: 'ウマ' + no, mark: '◎○▲☆△'.slice(r, r + 1) || '△', style: '',
                 aiRank: r + 1, oddsRank: no, odds: ODDS[no - 1], pu: 0.2, u: 1 - r * 0.1, order: orders[no - 1] };
      })
    }
  };
}
const RECS = [
  mkRec('R1', ORD1, [1, 2, 3, 4, 5], [5, 6, 7, 8, 9]),   // hit=人気順のまま
  mkRec('R2', ORD2, [5, 1, 2, 3, 4], [5, 6, 7, 8, 9])    // hit=5番人気を◎に上げ、1〜4番を下げた
];
/* 📌 事前予想（出走前に実際に保存しておいた印）。R1 だけに付ける → 📌モデルは1レースぶんだけ集計される */
RECS[0].preMarks = [1, 2, 3, 4, 5].map(function(no, r){
  return { no: String(no), name: 'ウマ' + no, mark: '◎○▲☆△'.slice(r, r + 1), style: '',
           aiRank: r + 1, oddsRank: no, odds: ODDS[no - 1], pu: 0.2, prob: 0.2,
           order: ORD1[no - 1], mi: 0, f: { O: 0.5, A: 0.5 } };
});
RECS[0].pre = { at: '2025-01-05T00:00:00.000Z', d8: '20250105', engine: 'v17', n: 10,
  pace: { score: 0.5, label: '平均' }, rows: RECS[0].preMarks };
vm.runInContext('globalThis.__recs = [];', ctx);
ctx.__recs = RECS;
vm.runInContext('function apCompleted(){ return globalThis.__recs || []; }', ctx);
// apBetPlan は p30 にあるので、ここでは同じ形の簡易スタブ（信頼度均等＝1万円を5頭へ2000円ずつ）
vm.runInContext([
  'function apBetPlan(ms){',
  '  var pool = (ms || []).filter(function(m){ return m && m.order >= 1 && m.odds > 1; });',
  '  if (!pool.length) return null;',
  '  var st = {}; pool.forEach(function(m){ st[m.no] = 2000; });',
  '  return { pool: pool, stakeOf: function(no){ return st[no] || 0; } };',
  '}'
].join('\n'), ctx);

console.log('apdiag(第17弾・提案1): AI予想の診断');

/* ============================================================
   1) 1レコードの正規化
   ============================================================ */
console.log(' 1. 正規化（市場期待勝率・人気順）');
const nz = fn('apdNormalize')(RECS[0]);
T('整えられた', !!nz);
eq('頭数', nz.n, 10);
near('1番人気の市場期待勝率', nz.runners[0].mi, MI1, 1e-9);
near('5番人気の市場期待勝率', nz.runners[4].mi, MI5, 1e-9);
near('市場期待勝率の合計は1', nz.runners.reduce(function(a, x){ return a + x.mi; }, 0), 1, 1e-9);
eq('人気順はオッズ昇順', nz.runners.map(function(x){ return x.rank; }), [1,2,3,4,5,6,7,8,9,10]);
eq('5モデルぶん揃う（3モデル＋📌事前予想＋🕰バックテスト）', Object.keys(nz.models).sort(), ['bt','hit','hyb','pre','roi']);
eq('preMarks があるレコードの📌は5頭', nz.models.pre.length, 5);
eq('preMarks が無いレコードの📌は空', fn('apdNormalize')(RECS[1]).models.pre.length, 0);
eq('印は5頭', nz.models.hit.length, 5);
eq('着順は結果側から引く', nz.models.hit[0].order, 1);
eq('結果なしレコードは null', fn('apdNormalize')({ rid: 'x' }), null);
eq('3頭未満は null', fn('apdNormalize')({ rid: 'x', result: { rows: [{no:'1',order:1,odds:'2'},{no:'2',order:2,odds:'4'}] } }), null);
eq('オッズが全部無ければ null', fn('apdNormalize')({ rid: 'x', result: { rows: [
  {no:'1',order:1},{no:'2',order:2},{no:'3',order:3}] } }), null);

/* ============================================================
   2) 基準線
   ============================================================ */
console.log(' 2. 基準線（1番人気買い／全頭均等買い）');
const rep = fn('apdReport')({});
eq('対象レース数', rep.races, 2);
eq('延べ出走頭数', rep.market.runners, 20);
// R1: 1番人気(2倍)勝ち → 2.0 / R2: 1番人気は2着 → 0  ⇒ (2+0)/2 = 100%
near('基準線A 1番人気買いの回収率', rep.market.favBuy.roi, 1.0, 1e-9);
eq('基準線A のレース数', rep.market.favBuy.n, 2);
// R1: 2/10 = 0.2 / R2: 10/10 = 1.0  ⇒ 平均 0.6
near('基準線B 全頭均等買いの回収率', rep.market.randBuy.roi, 0.6, 1e-9);

/* ============================================================
   3) 人気別の実績
   ============================================================ */
console.log(' 3. 人気別の実績（市場の校准）');
const r1 = rep.market.byRank[0], r5 = rep.market.byRank[4];
eq('人気別の行数(10)', rep.market.byRank.length, 10);
eq('1番人気の出走数', r1.n, 2);
near('1番人気の実勝率', r1.winRate, 0.5, 1e-9);
near('1番人気の市場期待勝率', r1.expRate, MI1, 1e-9);
near('1番人気の単勝回収率', r1.roi, 1.0, 1e-9);
near('5番人気の実勝率', r5.winRate, 0.5, 1e-9);
near('5番人気の市場期待勝率', r5.expRate, MI5, 1e-9);
near('5番人気の単勝回収率', r5.roi, 5.0, 1e-9);
T('5番人気は期待より走っている(リフト+)', r5.lift > 0, r5.lift);
T('1番人気も期待より走っている(リフト+)', r1.lift > 0, r1.lift);

console.log(' 3b. 市場期待勝率の帯別');
T('帯別の行が出ている', rep.market.calRows.length >= 3, rep.market.calRows.map(function(x){ return x.band; }));
const b4 = rep.market.calRows.filter(function(x){ return x.k === 'b4'; })[0];
T('20〜35%の帯に1番人気(期待34.1%)が入る', !!b4 && b4.n === 2, b4);

/* ============================================================
   4) モデル別（🎯 hit）
   ============================================================ */
console.log(' 4. 🎯 的中率重視モデル');
const hit = rep.models.filter(function(m){ return m.id === 'hit'; })[0];
eq('レース数', hit.races, 2);
near('◎が1番人気だった率', hit.favRate, 0.5, 1e-9);   // R1=1番人気 / R2=5番人気
eq('◎の人気分布 1番', hit.popHist[0], 1);
eq('◎の人気分布 5番', hit.popHist[4], 1);
eq('◎の人気分布 2番は0', hit.popHist[1], 0);
near('◎の勝率', hit.honmei.all.f.winRate, 1.0, 1e-9);            // R1もR2も◎が勝った
near('◎の市場期待勝率', hit.honmei.all.f.expRate, (MI1 + MI5) / 2, 1e-9);
T('◎のリフトがプラス', hit.honmei.all.f.lift > 0.7, hit.honmei.all.f.lift);
near('◎=1番人気のときの回収率', hit.honmei.fav.f.roi, 2.0, 1e-9);
near('◎を打ち替えたときの回収率', hit.honmei.nonfav.f.roi, 10.0, 1e-9);
// 印5頭（1点100円均等）: R1=1番人気(2倍) R2=5番人気(10倍) が的中 → (2+10)/10頭 = 120%
eq('印5頭の延べ頭数', hit.marks5.eq.n, 10);
near('印5頭の回収率', hit.marks5.roi5, 1.2, 1e-9);
near('印5頭の回収率(apdFin側も同じ)', hit.marks5.f.roi, 1.2, 1e-9);
near('印5頭の3着内率', hit.marks5.f.top3Rate, 0.6, 1e-9);         // R1: 1,2,3着 / R2: 1,2,3着
near('1万円を信頼度配分したときの回収率', hit.marks5.planRoi, 1.2, 1e-9);
// リフト: R2で5番人気を◎に上げた(up) / 1〜4番を下げた(down) / R1の5頭は同じ(same)
near('上げた馬の頭数', hit.lift.up.f.n, 1, 1e-9);
near('上げた馬の実勝率', hit.lift.up.f.winRate, 1.0, 1e-9);
near('上げた馬の市場期待勝率', hit.lift.up.f.expRate, MI5, 1e-9);
near('上げた馬の単勝回収率', hit.lift.up.f.roi, 10.0, 1e-9);
eq('同じ順位の頭数', hit.lift.same.f.n, 5);
near('同じ順位の単勝回収率', hit.lift.same.f.roi, 0.4, 1e-9);      // 2倍÷5頭
eq('下げた馬の頭数', hit.lift.down.f.n, 4);
near('下げた馬は1頭も勝っていない', hit.lift.down.f.winRate, 0, 1e-9);
eq('レース単位の的中(印5頭に1着がいた)', hit.raceWin, 2);
eq('レース単位の3着内', hit.raceTop3, 2);

/* ============================================================
   5) モデル別（💰 roi）
   ============================================================ */
console.log(' 5. 💰 回収率重視モデル');
const roi = rep.models.filter(function(m){ return m.id === 'roi'; })[0];
near('◎が1番人気だった率は0（1〜4番を本命から外す式）', roi.favRate, 0, 1e-9);
eq('◎の人気分布 5番に2回', roi.popHist[4], 2);
eq('◎の人気分布 1番は0', roi.popHist[0], 0);
near('◎の勝率', roi.honmei.all.f.winRate, 0.5, 1e-9);
near('◎の市場期待勝率', roi.honmei.all.f.expRate, MI5, 1e-9);
T('◎の市場期待勝率はhitより低い（＝穴を狙っている）',
  roi.honmei.all.f.expRate < hit.honmei.all.f.expRate, [roi.honmei.all.f.expRate, hit.honmei.all.f.expRate]);
T('それでもリフトはプラス（期待以上に走らせた）', roi.honmei.all.f.lift > 0, roi.honmei.all.f.lift);
near('◎の単勝回収率', roi.honmei.all.f.roi, 5.0, 1e-9);           // (0 + 10)/2
// この合成データではhitの◎が2レースとも勝った(2倍と10倍)ので hit=600% / roi=500% になる。
// 「穴を狙うほど回収率が上がるとは限らない」ことの確認として両方の値を固定する。
near('hitの◎の単勝回収率', hit.honmei.all.f.roi, 6.0, 1e-9);       // (2 + 10)/2
near('印5頭の回収率', roi.marks5.roi5, 1.0, 1e-9);                 // 10倍÷10頭
near('印5頭の3着内率', roi.marks5.f.top3Rate, 0.1, 1e-9);          // R2の5番人気だけ
// 人気5〜9番に印を打って aiRank は1〜5 → 全部「人気より上げた」扱いになる
eq('上げた馬は10頭', roi.lift.up.f.n, 10);
near('上げた馬の実勝率', roi.lift.up.f.winRate, 0.1, 1e-9);
near('上げた馬の市場期待勝率', roi.lift.up.f.expRate, (MI5 + (1/12 + 1/14 + 1/16 + 1/18)/INV) / 5, 1e-6);
T('上げた馬のリフトがプラス', roi.lift.up.f.lift > 0, roi.lift.up.f.lift);
near('上げた馬の単勝回収率', roi.lift.up.f.roi, 1.0, 1e-9);
eq('同じ・下げたは無し', [roi.lift.same.f, roi.lift.down.f], [null, null]);

/* ============================================================
   5b) 📌 事前予想（実際の印）
   ============================================================ */
console.log(' 5b. 📌 事前予想（出走前に保存した実際の印）');
const pre = rep.models.filter(function(m){ return m.id === 'pre'; })[0];
T('📌モデルが集計されている', !!pre);
eq('事前予想があるレースだけ（1レース）', pre.races, 1);
eq('無いレースはスキップ扱い', pre.skipped, 1);
near('◎が1番人気だった率', pre.favRate, 1.0, 1e-9);
near('◎の勝率', pre.honmei.all.f.winRate, 1.0, 1e-9);
near('印5頭の回収率', pre.marks5.roi5, 0.4, 1e-9);          // 2倍÷5頭
near('印5頭の3着内率', pre.marks5.f.top3Rate, 0.6, 1e-9);   // 1,2,3着
T('📌は表①に出る（races>0 なので）', fn('apdHTML')(rep).indexOf('📌 事前予想（実際の印）') >= 0);

/* ============================================================
   6) 自動診断コメント
   ============================================================ */
console.log(' 6. 自動診断コメント（要点）');
T('サンプル不足の警告が出る', rep.verdicts.join('').indexOf('サンプルが 2 レース') >= 0, rep.verdicts[0]);
T('基準線A/Bを文章に出す', rep.verdicts.join('').indexOf('基準線') >= 0 &&
  rep.verdicts.join('').indexOf('100.0%') >= 0 && rep.verdicts.join('').indexOf('60.0%') >= 0, rep.verdicts.join(''));
T('4モデルぶんの行が出る（📌事前予想を含む）', rep.verdicts.filter(function(v){ return v.indexOf('レース）:') >= 0; }).length === 4, rep.verdicts.length);
T('頭数が少ない間はリフトの結論を出さない', rep.verdicts.join('').indexOf('リフトの判定は 10 頭以上') >= 0, rep.verdicts.join(''));
// 判定に必要な頭数を1に下げて、リフト判定の文章が出ることを確認する
vm.runInContext('APD_LIFT_MIN = 1;', ctx);
const rep2 = fn('apdReport')({});
T('hitは「上げた馬が期待以上に走った」＝✅独自情報が効いている', rep2.verdicts.join('').indexOf('独自情報が効いている') >= 0, rep2.verdicts.join(''));
const roiV = rep2.verdicts.filter(function(v){ return v.indexOf('💰') === 0; })[0] || '';
T('💰は上げ下げが無いのでリフト判定の文章が出ない', roiV.indexOf('独自情報') < 0, roiV);
vm.runInContext('APD_LIFT_MIN = 10;', ctx);
eq('空のときの案内', fn('apdVerdicts')({ races: 0 })[0].indexOf('まだ結果が確定したレースがありません') >= 0, true);

/* ============================================================
   7) 表示HTML
   ============================================================ */
console.log(' 7. 表示HTML');
const html = fn('apdHTML')(rep);
T('表が6つ出る', (html.match(/overflow:auto/g) || []).length === 6, (html.match(/overflow:auto/g) || []).length);
T('基準線の表がある', html.indexOf('1番人気買い（基準線A）') >= 0);
T('リフトの表がある', html.indexOf('リフト ＝ 実勝率 − 市場期待勝率') >= 0);
T('人気別分布の表がある', html.indexOf('本命(◎)は何番人気に打たれているか') >= 0);
T('打ち替えの表がある', html.indexOf('打ち替えた') >= 0);
T('帯別の表がある', html.indexOf('市場期待勝率の帯別') >= 0);
T('サンプル数の注意がある', html.indexOf('あと 98 レース') >= 0, html.slice(-400));
T('空のときの案内HTML', fn('apdHTML')({ races: 0 }).indexOf('まだ結果が確定したレースがありません') >= 0);

/* ============================================================
   8) 年月で絞り込める／計測専用であること
   ============================================================ */
console.log(' 8. 絞り込みと「計測専用」の確認');
eq('存在しない年月なら0レース', fn('apdReport')({ ym: '202501' }).races, 0);
eq('一致する年月なら2レース', fn('apdReport')({ ym: '202609' }).races, 2);
const srcDiag = fs.readFileSync(path.join(ROOT, 'src', 'p51_apdiag.js'), 'utf8');
T('印を作り直す関数を呼んでいない（計測だけ）',
  srcDiag.indexOf('apUScores(') < 0 && srcDiag.indexOf('apMarksByU(') < 0 && srcDiag.indexOf('apEval(') < 0);
T('保存レコードを書き換えない（apPut/apPatchExtraを呼ばない）',
  srcDiag.indexOf('apPut(') < 0 && srcDiag.indexOf('apPatchExtra(') < 0);
const srcB = fs.readFileSync(path.join(ROOT, 'build.py'), 'utf8');
T('build.py に入っている', srcB.indexOf("'p51_apdiag'") >= 0);
const srcBody = fs.readFileSync(path.join(ROOT, 'src', 'p2_body.html'), 'utf8');
T('🔁自己学習カードの中に入れ子の折り込みで入っている',
  srcBody.indexOf('id="apdCard"') >= 0 && srcBody.indexOf('id="apdBox"') >= 0 &&
  srcBody.indexOf('id="apdRun"') >= 0);
T('apdCard は apOut より後ろ（自己学習カードの内側）', (function(){
  const i1 = srcBody.indexOf('id="apOut"'), i2 = srcBody.indexOf('id="apdCard"'), i3 = srcBody.indexOf('id="rnCard"');
  return i1 > 0 && i2 > i1 && i3 > i2;
})());
const srcMain = fs.readFileSync(path.join(ROOT, 'src', 'p10_main.js'), 'utf8');
T('起動時に apdInit を呼ぶ', srcMain.indexOf("safeInit('apdInit', apdInit)") >= 0);

console.log('');
console.log((bad ? 'FAIL' : 'PASS') + ' apdiag(第17弾・提案1): ok=' + ok + ' bad=' + bad);
process.exit(bad ? 1 : 0);
