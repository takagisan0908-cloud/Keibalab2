/* 2026-09-12 第17弾・提案1＋提案3 の回帰テスト
   実行: node tests/histfeat.test.js

   検証内容:
     A) p52_histfeat.js — 学習DBから「レース前の情報だけ」で特徴を作れること
        ・いかさま(look-ahead)防止: そのレース自身・それ以降の日付の出走を絶対に使わない
        ・脚質は過去戦の通過順から（結果の passing は使わない）
        ・鉄砲(90日以上)・2走目・中N週（p49 と同じ定義）
        ・上り3Fの相対順位（過去戦のみ）
     B) p30 の修正 — 学習を「リフト(実勝率 − 市場期待勝率)」で判定する
        ・従来の「生の3着内率」比較は、上げた馬＝人気薄なので常に不利になる不公平な比較だった
        ・hitTm が 1.0 を超えられる（効いていると分かったら重みを強められる）
     C) race_id から日付を捏造していたバグの修正
        ・apYmOf: race_id の5〜6桁目は「月」ではなく場コード → 月不明なら空を返す
        ・apRaceMeta: 学習DBの date8/meta を受け取る（再学習で日付が失われなくなった）
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
  const el = { id: id || '', value: '', _html: '', style: {}, dataset: {},
    classList: { _s: new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); }, contains(c){ return this._s.has(c); } },
    setAttribute(){}, getAttribute(){ return null; }, addEventListener(){},
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
  setTimeout(){ return 0; }, clearTimeout(){}, setInterval(){ return 0; }, clearInterval(){},
  requestAnimationFrame(){ return 0; }, cancelAnimationFrame(){},
  localStorage: ls, addEventListener(){}, devicePixelRatio: 1, innerWidth: 980,
  navigator: {}, window: null,
  document: { getElementById(id){ if (!els[id]) els[id] = makeEl(id); return els[id]; },
              addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; } }
};
g.window = g;
g.globalThis = g;
vm.createContext(g);

const files = ['src/p3_core.js', 'src/p5_engine.js', 'src/p14_history.js', 'src/p48_racedata.js',
               'src/p49_jockeylay.js', 'src/p50_pacefit.js', 'src/p52_histfeat.js', 'src/p30_learnrec.js'];
let code = '';
files.forEach(function(f){ code += fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n'; });
vm.runInContext(code, g, { filename: 'keiba.js' });
function run(src){ return vm.runInContext(src, g); }

console.log('histfeat(第17弾・提案1+3): いかさま防止・リフト学習・日付バグ修正');

/* ============================================================
   合成の学習DB
   テストオー(id=H1) の出走: 2025-01-05 / 2025-03-02 / 2025-06-01(鉄砲) / 2025-06-15(2走目)
   ============================================================ */
function mkRow(no, name, id, order, odds, passing, last3, jockey, weightChg){
  return { no: String(no), name: name, id: id, order: order, odds: String(odds), pop: '',
           passing: passing, last3: last3, jockey: jockey, time: '', weightChg: weightChg || '' };
}
function mkRace(rid, d8, place, m, surface, rows){
  return { rid: rid, date8: d8, meta: { date8: d8, place: place, rnum: '1', name: 'テスト', m: m,
           dist: surface + m + 'm', surface: surface, baba: '良' }, n: rows.length, rows: rows };
}
// 10頭立て。last3 が速い順に l3rank が付く
function fieldH1(d8, rid, h1){
  const rows = [];
  rows.push(mkRow(1, 'テストオー', 'H1', h1.order, h1.odds, h1.passing, h1.last3, h1.jockey || '川田将雅', h1.wchg));
  for (let i = 2; i <= 10; i++){
    rows.push(mkRow(i, 'ウマ' + i, 'X' + i, ((i + h1.order) % 10) + 1, (2 + i).toFixed(1),
      i + '-' + i + '-' + i + '-' + i, (34.0 + i * 0.4).toFixed(1), '騎手' + i, ''));
  }
  return mkRace(rid, d8, '東京', 2000, '芝', rows);
}
const DB = { races: {} };
function put(r){ DB.races[r.rid] = r; }
put(fieldH1('20250105', '202501050501', { order: 1, odds: '5.0', passing: '1-1-1-1', last3: '34.5' }));   // 逃げ・1着
put(fieldH1('20250302', '202503020501', { order: 3, odds: '4.0', passing: '4-4-4-4', last3: '35.0' }));   // 先行・3着
put(fieldH1('20250601', '202506010501', { order: 5, odds: '8.0', passing: '9-9-9-9', last3: '36.0' }));   // 91日ぶり＝鉄砲・5着
put(fieldH1('20250615', '202506150501', { order: 9, odds: '6.0', passing: '10-10-10-10', last3: '37.0' })); // 2走目・9着
run('function diLs(){ return globalThis.__DB; }');
g.__DB = DB;
run('hfDropCache();');

/* ---------- A-1. 部品 ---------- */
console.log(' A-1. 部品（日数・タイム・馬体重・通過順・脚質・距離帯）');
eq('日数 2025-03-02 → 2025-06-01 は91日', run('hfDays("20250302","20250601")'), 91);
eq('日数 2025-06-01 → 2025-06-15 は14日', run('hfDays("20250601","20250615")'), 14);
eq('不正な日付は null', run('hfDays("abc","20250615")'), null);
near('タイム 1:58.4 → 118.4秒', run('hfTimeSec("1:58.4")'), 118.4, 1e-9);
eq('馬体重 480(+12) → +12', run('hfWeightChg("480(+12)")'), 12);
eq('馬体重 480(-4) → -4', run('hfWeightChg("480(-4)")'), -4);
eq('馬体重なし → null', run('hfWeightChg("480")'), null);
eq('通過順 6-6-5-4 → 4', run('hfLastPos("6-6-5-4")'), 4);
eq('4角1番手(10頭) → 逃げ', run('hfStyleOf(1,10)'), '逃げ');
eq('4角3番手(10頭) → 先行', run('hfStyleOf(3,10)'), '先行');
eq('4角5番手(10頭) → 差し', run('hfStyleOf(5,10)'), '差し');
eq('4角9番手(10頭) → 追込', run('hfStyleOf(9,10)'), '追込');
eq('距離帯 2000m → m2', run('hfBand(2000)'), 'm2');

/* ---------- A-2. いかさま防止（最重要） ---------- */
console.log(' A-2. いかさま防止: そのレース自身・以降の日付を使わない');
const idx = run('hfIndex(true)');
T('インデックスができた', !!idx);
eq('インデックスのレース数', idx.races, 4);
eq('H1 の履歴は4件', idx.byHorse['H1'].length, 4);
// 2025-06-15 のレースを予想するとき → 前の3戦だけ見える
const f615 = run('hfHorseFeat')(idx, 'H1', run('hfNameKey')('川田将雅'), '20250615', 'm2', null);
eq('2025-06-15 時点の過去戦数', f615.prevN, 3);
near('過去戦の3着内率(1,3,5着)', f615.top3Rate, 2 / 3, 1e-9);
near('過去戦の勝率', f615.winRate, 1 / 3, 1e-9);
eq('休養日数は14日', f615.restDays, 14);
eq('鉄砲ではない', f615.isTeppo, false);
eq('前走が鉄砲なので2走目', f615.is2nd, true);
T('脚質は過去戦の通過順から（結果の10-10-10-10＝追込 にはならない）', f615.style !== '追込', f615.style);
eq('脚質の判定に使った戦数', f615.styleN, 3);
// 2025-06-01（鉄砲のレース）を予想するとき → 前の2戦だけ
const f601 = run('hfHorseFeat')(idx, 'H1', run('hfNameKey')('川田将雅'), '20250601', 'm2', null);
eq('2025-06-01 時点の過去戦数', f601.prevN, 2);
eq('91日ぶりなので鉄砲', f601.isTeppo, true);
eq('鉄砲なので2走目ではない', f601.is2nd, false);
// 初戦（2025-01-05）→ 過去戦ゼロ
const f105 = run('hfHorseFeat')(idx, 'H1', run('hfNameKey')('川田将雅'), '20250105', 'm2', null);
eq('初戦は過去戦なし', f105.prevN, 0);
eq('初戦は has=false', f105.has, false);
eq('初戦の総合能力は null（判定しない）', f105.abl, null);
// 未来の日付 → 全部見える
const fFut = run('hfHorseFeat')(idx, 'H1', run('hfNameKey')('川田将雅'), '20260101', 'm2', null);
eq('未来日付なら4戦ぶん', fFut.prevN, 4);
// 存在しない馬
eq('学習DBに無い馬は has=false', run('hfHorseFeat')(idx, 'SONZAI', '', '20250615', 'm2', null).has, false);

/* ---------- A-3. 上り3Fの相対順位（過去戦のみ） ---------- */
console.log(' A-3. 上り3Fの相対順位');
// テストオーの last3: 34.5 / 35.0 / 36.0。他馬は 34.8,35.2,...,38.0
// → 1戦目 34.5 は最速(rank1/10=0.1)、2戦目 35.0 は rank1、3戦目 36.0 は rank1
T('上り順位の平均が出ている', f615.l3RankAvg != null && f615.l3RankAvg > 0 && f615.l3RankAvg <= 1, f615.l3RankAvg);
T('最速級なので小さい値(0.5=平均より速い)', f615.l3RankAvg < 0.3, f615.l3RankAvg);
// abl は hfFeatures 側で付く（hfHorseFeat 単体では計算しない）ので hfAbility で直接見る
const abl615 = run('hfAbility')(f615);
T('総合能力が出る', abl615 != null, abl615);
T('総合能力は 0〜1', abl615 >= 0 && abl615 <= 1, abl615);
T('実績が良い(3着内率67%・上り最速級)ので 0.5 より上', abl615 > 0.5, abl615);

/* ---------- A-4. 騎手の成績（この日付より前） ---------- */
console.log(' A-4. 騎手の成績');
eq('川田将雅の出走数(2025-06-15より前)', f615.jockeyN, 3);
near('川田将雅の勝率', f615.jockeyWinRate, 1 / 3, 1e-9);
near('川田将雅の3着内率', f615.jockeyTop3Rate, 2 / 3, 1e-9);
eq('不明な騎手は null', run('hfHorseFeat')(idx, 'H1', 'ソンザイシナイキシュ', '20250615', 'm2', null).jockeyN, 0);

/* ---------- A-5. 同距離帯の実績・鉄砲統計 ---------- */
console.log(' A-5. 同距離帯の実績と鉄砲統計');
eq('同距離(2000m=m2)の出走数', f615.sameDistN, 3);
near('同距離の3着内率', f615.sameDistTop3Rate, 2 / 3, 1e-9);
eq('距離帯違い(d1)だと0件', run('hfHorseFeat')(idx, 'H1', '', '20250615', 'd1', null).sameDistN, 0);
T('鉄砲統計がある', !!idx.teppo);
eq('鉄砲の回数(10頭×1回)', idx.teppo.n, 10);
eq('2走目の回数(10頭×1回)', idx.teppo.n2, 10);
// 2025-06-01(鉄砲)の着順は H1=5着, ウマ5=1着, ウマ6=2着, ウマ7=3着, 他 → 3着内は3頭
eq('鉄砲だった回の3着内は3頭', idx.teppo.top3, 3);
eq('全出走数', idx.teppo.all, 40);
T('全体の3着内率が出ている', idx.teppo.allTop3 > 0 && idx.teppo.allTop3 < 1, idx.teppo.allTop3);
// 鉄砲の実績が悪い(5着)ので割引になる
T('鉄砲は割引（1.0以下）', run('hfRestMul')({ isTeppo: true }, idx.teppo) <= 1.0, run('hfRestMul')({ isTeppo: true }, idx.teppo));
eq('サンプル10件未満なので鉄砲倍率は中立', run('hfRestMul')({ isTeppo: true }, { n: 3, top3: 0, allTop3: 0.3 }), 1);
eq('通常時は中立', run('hfRestMul')({ isTeppo: false, is2nd: false, restDays: 14 }, idx.teppo), 1);
eq('半年以上の休養明けは軽く割引', run('hfRestMul')({ isTeppo: false, is2nd: false, restDays: 200 }, idx.teppo), 0.94);

/* ---------- A-6. hfFeatures（1レースぶん） ---------- */
console.log(' A-6. hfFeatures（apFeats から呼ばれる入口）');
const targetRows = DB.races['202506150501'].rows;
const featsMap = run('hfFeatures')(targetRows, '20250615', 'm2');
T('マップが返る', !!featsMap);
eq('全10頭ぶん', Object.keys(featsMap).length, 10);
T('1番(テストオー)に履歴あり', featsMap['1'].has === true);
eq('1番の過去戦数', featsMap['1'].prevN, 3);
T('他馬も同じ4レースに出ているので履歴あり', featsMap['2'].has === true, featsMap['2']);
eq('2番も過去戦3', featsMap['2'].prevN, 3);
// 学習DBに全く無い馬（新規参戦）
const newRow = mkRow(11, 'シンザン', 'NEW11', 0, '9.0', '', '', '新人騎手', '');
const featsNew = run('hfFeatures')([newRow], '20250615', 'm2');
eq('学習DBに無い馬は has=false', featsNew['11'].has, false);
eq('学習DBに無い馬の過去戦数は0', featsNew['11'].prevN, 0);
eq('学習DBに無い馬の総合能力は null', run('hfAbility')(featsNew['11']), null);
T('説明テキストが出る', run('hfTxt')(featsMap['1']).indexOf('学習DB内 3戦') >= 0, run('hfTxt')(featsMap['1']));

/* ============================================================
   B) apFeats — 脚質が「過去戦」から来るようになったか（いかさま修正）
   ============================================================ */
console.log(' B. apFeats の脚質ソース（いかさま修正）');
// このレースで テストオー は 10-10-10-10（追込）を走ったが、それは「結果」。
// ctx.d8 を渡すと過去戦（逃げ・先行・差し）から脚質を決めるので '追込' にはならない。
const rowsForFeats = targetRows.map(function(r){ return Object.assign({}, r); });
const withCtx = run('apFeats')(rowsForFeats, { d8: '20250615', band: 'm2' });
const h1feat = withCtx.filter(function(x){ return x.no === '1'; })[0];
T('脚質が入っている', !!h1feat.styleTag, h1feat.styleTag);
T('★結果の通過順(10-10-10-10=追込)を使っていない', h1feat.styleTag !== '追込', h1feat.styleTag);
T('総合能力列がある', h1feat.colAbl != null, h1feat.colAbl);
T('hf が付いている', !!h1feat.hf && h1feat.hf.prevN === 3, h1feat.hf && h1feat.hf.prevN);
eq('restMul がある', typeof h1feat.restMul, 'number');
// 従来動作（ctx なし）でも落ちないこと
const noCtx = run('apFeats')(rowsForFeats);
eq('ctx なしでも頭数は同じ', noCtx.length, withCtx.length);
T('ctx なしでは colAbl が中立(0.5)', noCtx.every(function(x){ return Math.abs(x.colAbl - 0.5) < 1e-9; }), noCtx[0].colAbl);
T('ctx なしでは restMul=1', noCtx.every(function(x){ return x.restMul === 1; }));
// style 入力（出馬表の手入力＝レース前情報）は使ってよい
const withStyle = run('apFeats')([{ no: '1', name: 'A', odds: '3.0', style: '逃げ', passing: '' }]);
eq('出馬表の脚質入力は使う', withStyle[0].styleTag, '逃げ');

/* ============================================================
   C) リフト学習（apTrans / apParamsFor）
   ============================================================ */
console.log(' C. リフト学習（従来の「生3着内率」比較をやめた）');
/* 学習バケットを完全に空にする（プレフィックスは p30 の AP_YM_PREFIX = 'khl_apm_'） */
function clearAll(){
  Object.keys(ls._m).forEach(function(k){ delete ls._m[k]; });
  run('apMode = "ls"; apLrnMem = null; apRecMem = null;');
}
function saveBucket(ym, over){
  run('var b = apBucket(' + JSON.stringify(ym) + ');');
  run('b.c.hit.n = ' + (over.n || 20) + '; b.c.hit.horseN = ' + (over.horseN || 100) +
      '; b.c.hit.horseTop3 = ' + (over.horseTop3 || 30) + ';');
  run('b.c.hit.boostN = ' + (over.boostN || 0) + '; b.c.hit.boostWin = ' + (over.boostWin || 0) +
      '; b.c.hit.boostExp = ' + (over.boostExp || 0) + '; b.c.hit.boostTop3 = ' + (over.boostTop3 || 0) + ';');
  run('apMBSave(b);');
}
// (a) 上げた馬が市場の期待の2倍勝つ → 重みを強める（1.0を超える）
clearAll();
saveBucket('202501', { boostN: 100, boostWin: 20, boostExp: 10, boostTop3: 20, horseN: 500, horseTop3: 150 });
let S = run('apParamsFor("202502")');
eq('リフト判定を使った', S.hitSrc, 'lift');
T('期待以上に勝ったので重みを強める（>1.0）', S.hitTm > 1.0, S.hitTm);
eq('上限は1.4', S.hitTm, 1.4);
T('リフトの内訳を持っている', !!S.lift && S.lift.n === 100, S.lift);
near('実勝率', S.lift.act, 0.20, 1e-9);
near('市場期待勝率', S.lift.exp, 0.10, 1e-9);
near('期待比', S.lift.ratio, 2.0, 1e-9);
eq('apModelScale も1.4まで許す', run('apModelScale')({ hitTm: 1.4, roiRho: 1, hybLam: 0.55 }, 'hit'), 1.4);

// (b) 上げた馬が期待以下 → 弱める（従来と同じ方向）
clearAll();
saveBucket('202501', { boostN: 100, boostWin: 5, boostExp: 10, boostTop3: 20, horseN: 500, horseTop3: 150 });
S = run('apParamsFor("202502")');
eq('リフト判定', S.hitSrc, 'lift');
T('期待以下なので弱める（<1.0）', S.hitTm < 1.0, S.hitTm);
near('ratio 0.5 → hitTm 0.643', S.hitTm, 1 + (0.5 - 1) * (100 / 140), 1e-6);

// (c) 市場どおり → 1.0 のまま
clearAll();
saveBucket('202501', { boostN: 100, boostWin: 10, boostExp: 10, boostTop3: 30, horseN: 500, horseTop3: 150 });
S = run('apParamsFor("202502")');
near('市場どおりなら1.0', S.hitTm, 1.0, 1e-9);

// (d) サンプルが少ない（12頭未満）→ 判定しない
clearAll();
saveBucket('202501', { boostN: 5, boostWin: 5, boostExp: 0.5, horseN: 25, horseTop3: 8 });
S = run('apParamsFor("202502")');
near('サンプル不足なら1.0のまま', S.hitTm, 1.0, 1e-9);

// (e) 旧形式（boostExp が無い＝第17弾より前に集計したバケット）→ 従来の式で保険
clearAll();
saveBucket('202501', { boostN: 20, boostWin: 0, boostExp: 0, boostTop3: 2, horseN: 100, horseTop3: 30 });
S = run('apParamsFor("202502")');
eq('旧形式の保険を使った', S.hitSrc, 'legacy');
near('従来の式 1 - (0.30-0.10)*1.6 = 0.68', S.hitTm, 0.68, 1e-9);

// (f) 未来の月は学習に使わない
clearAll();
saveBucket('209912', { boostN: 100, boostWin: 100, boostExp: 1, horseN: 500, horseTop3: 500 });
S = run('apParamsFor("202502")');
near('未来月(209912)は無視', S.hitTm, 1.0, 1e-9);

/* ============================================================
   D) 市場期待勝率 mi が印に付く（apEval）
   ============================================================ */
console.log(' D. apEval が市場期待勝率 mi を印に付ける');
clearAll();
run('hfDropCache();');
const evRows = [];
for (let i = 1; i <= 10; i++){
  evRows.push({ no: String(i), name: 'ウマ' + i, id: 'E' + i, order: i, odds: (1.5 + i).toFixed(1),
                pop: String(i), passing: i + '-' + i + '-' + i + '-' + i, last3: '35.0',
                jockey: '騎手' + i, style: '', weightChg: '' });
}
const rec = run('apEval')({ name: 'テスト', place: '東京', dist: '2000', surface: '芝',
  date8: '20250720', rows: evRows }, '202507200501', true);
T('自己検証レコードができた', !!rec);
T('ym が正しく 202507', rec && rec.ym === '202507', rec && rec.ym);
const invSum = evRows.reduce(function(a, r){ return a + 1 / parseFloat(r.odds); }, 0);
const mk0 = rec.cMarks.hit[0];
T('印に mi が付いている', typeof mk0.mi === 'number' && mk0.mi > 0, mk0.mi);
near('mi = (1/odds)/Σ(1/odds)', mk0.mi, (1 / parseFloat(mk0.odds)) / invSum, 1e-9);
T('年月バケットにリフト集計欄がある', (function(){
  const b = run('apMB("202507")');
  return !!b && b.c.hit.boostExp != null && b.c.hit.sameExp != null;
})());

/* ============================================================
   E) race_id から日付を捏造しない
   ============================================================ */
console.log(' E. race_id → 日付の捏造をやめた');
// race_id = 2026 09 04 03 11 → 2026年・阪神(09)・4回・3日・11R＝実際の開催日は 2026-09-12
eq('apYmOf: date8 があればそれを使う', run('apYmOf')('20260912', ''), '202609');
eq('apYmOf: race_id の5〜6桁目は場コードなので月として使わない', run('apYmOf')('', '202609040311'), '');
eq('apYmOf: 東京(場コード05)を5月と誤認しない', run('apYmOf')('', '202605040311'), '');
eq('apYmSurf: 月不明なら空', run('apYmSurf')('', '202605040311', '芝', 'テスト'), '');
const meta1 = run('apRaceMeta')({ rows: [], date8: '20260912', meta: { place: '阪神', m: 2000, surface: '芝' } }, '202609040311');
eq('apRaceMeta: p.date8 を最優先で使う', meta1.date8, '20260912');
eq('apRaceMeta: meta.place を拾う', meta1.place, '阪神');
eq('apRaceMeta: meta.m から dist を作る', meta1.dist, '2000');
const meta2 = run('apRaceMeta')({ rows: [], meta: { date8: '20260912', surface: '芝', dist: '芝2000m' } }, '202609040311');
eq('apRaceMeta: p.meta.date8 も使える', meta2.date8, '20260912');
eq('apRaceMeta: dist を拾う', meta2.dist, '芝2000m');
const meta3 = run('apRaceMeta')({ rows: [] }, '202605040311');
eq('apRaceMeta: 日付不明なら捏造しない', meta3.date8, '');

console.log('');
console.log((bad ? 'FAIL' : 'PASS') + ' histfeat(第17弾・提案1+3): ok=' + ok + ' bad=' + bad);
process.exit(bad ? 1 : 0);
