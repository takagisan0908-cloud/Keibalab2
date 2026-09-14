/* 2026-09-12 第16弾の回帰テスト
   実行: node tests/rework9.test.js

   検証内容:
     A) p48_racedata.js — netkeiba SP結果ページから
        「コーナー通過順位(4角ぶん＋馬番ごとの位置)・ペース(S/M/H)・200mごとのラップタイム・払戻8券種・全着順」
        を取り出せること（実物のページを tests/fixtures に保存したものに対して検証）
     B) p49_jockeylay.js — 馬柱の戦績から
        「中N週・○ヶ月休養・鉄砲・2走目・騎手×当該馬の成績・乗り替わり・初騎乗」を計算できること
        （2026-09-12 阪神11R チャレンジC(G3) の netkeiba 競馬新聞の表示と一致することを検証）
     C) nkTodayD8() の修正 — race_id は日付ではない（年+場コード+回+日+R）ので、
        先頭8桁を日付として使わないこと
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

/* --- 最小のサンドボックス（純関数だけなので DOM はほとんど不要） --- */
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
              createElement: function(){ return { style: {}, classList: { add: function(){}, remove: function(){} } }; } },
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
['p3_core.js', 'p31_bloodfactor.js', 'p34_horsedetail.js', 'p48_racedata.js', 'p49_jockeylay.js'].forEach(load);

function fn(name){ return vm.runInContext(name, ctx); }
function fix(name){ return fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', name), 'utf8'); }

console.log('rework9(第16弾): コーナー通過順・ペース・ラップ・騎手成績・鉄砲');

/* ============================================================
   A) 結果ページの追加情報
   ============================================================ */
const SP = fix('nk_sp_result_202609040311.html');   // 2026-09-12 阪神11R チャレンジC(G3) 芝2000m 16頭
const ex = fn('rdParseExtra')(SP, { dist: 2000 });

console.log(' A-1. コーナー通過順位');
T('ok フラグ', ex.ok === true);
eq('コーナーは4つ', ex.corners.n, 4);
eq('コーナーの見出し', ex.corners.labels, ['1コーナー', '2コーナー', '3コーナー', '4コーナー']);
eq('1角の生テキスト', ex.corners.c[0], '2,9,12,5(7,15)(8,16)13(4,11,14)-3,10-1-6');
eq('4角の生テキスト', ex.corners.c[3], '(2,*9,12)(5,7,15)8(4,14)(3,16)11(6,10)(13,1)');

console.log(' A-2. 馬番ごとのコーナー位置');
eq('15番(1着ジョバンニ)の通過', ex.cornerPos['15'], [6, 6, 6, 6]);
eq('8番(2着)の通過', ex.cornerPos['8'], [7, 7, 7, 7]);
eq('2番(逃げたジーティーダーリン)の通過', ex.cornerPos['2'], [1, 1, 1, 1]);   // DB戦績の「通過」列 1-1-1-1 と一致
eq('6番(しんがりカネフラ)の通過', ex.cornerPos['6'], [16, 16, 15, 13]);
eq('位置が出ている頭数', Object.keys(ex.cornerPos).length, 16);
eq('4角1番手 → 逃げ', fn('rdPosStyle')(ex.cornerPos['2'][3], 16), '逃げ');
eq('4角6番手/16頭 → 差し', fn('rdPosStyle')(6, 16), '差し');
eq('4角13番手/16頭 → 追込', fn('rdPosStyle')(13, 16), '追込');
/* 記号（, - = ( ) *）を落としても順番が変わらないこと */
eq('rdCornerPos: * と () を無視して順番どおり', fn('rdCornerPos')('(*2,9,12)(5,7,15)8'), { '2':1, '9':2, '12':3, '5':4, '7':5, '15':6, '8':7 });
eq('rdCornerPos: = は5馬身以上', fn('rdCornerPos')('1=2=3'), { '1':1, '2':2, '3':3 });
eq('rdCornerPos: 空', fn('rdCornerPos')(''), {});

console.log(' A-3. ペース');
eq('netkeiba の表示からペース', ex.pace, 'M');
eq('取得元は netkeiba', ex.paceSrc, 'nk');
eq('rdParsePace: Pace_S', fn('rdParsePace')('<dl class="RacePace"><dt>ペース</dt><dd class="Pace_S">S</dd></dl>'), 'S');
eq('rdParsePace: Pace_H', fn('rdParsePace')('<dl class="RacePace"><dt>ペース</dt><dd class="Pace_H">H</dd></dl>'), 'H');
eq('rdParsePace: 無し', fn('rdParsePace')('<div>no pace</div>'), '');
eq('ペースの日本語', fn('rdPaceJa')('S') + '/' + fn('rdPaceJa')('M') + '/' + fn('rdPaceJa')('H'), 'スロー/ミドル/ハイ');

console.log(' A-4. 200mごとのラップタイム');
eq('ラップの区間数(芝2000m)', ex.laps.length, 10);
eq('200mの通過/ラップ', [ex.laps[0].m, ex.laps[0].pass, ex.laps[0].lap], [200, 12.5, 12.5]);
eq('400mの通過/ラップ', [ex.laps[1].m, ex.laps[1].pass, ex.laps[1].lap], [400, 23.2, 10.7]);
eq('1200mは 1:11.2 → 71.2秒', [ex.laps[5].m, ex.laps[5].pass, ex.laps[5].lap], [1200, 71.2, 11.8]);
eq('2000m(ゴール)の通過/ラップ', [ex.laps[9].m, ex.laps[9].pass, ex.laps[9].lap], [2000, 117.6, 11.7]);
eq('距離の昇順', ex.laps.map(function(x){ return x.m; }), [200,400,600,800,1000,1200,1400,1600,1800,2000]);
eq('rdSec: 1:11.2', fn('rdSec')('1:11.2'), 71.2);
eq('rdSec: 2:00.7', fn('rdSec')('2:00.7'), 120.7);
eq('rdSec: 12.5', fn('rdSec')('12.5'), 12.5);
eq('rdSec: 全角１２.５', fn('rdSec')('１２.５'), 12.5);
eq('rdSec: 空', fn('rdSec')(''), null);
eq('上がり3F', fn('rdAgari')(ex.laps, 2000, 3), 34.9);
eq('上がり4F', fn('rdAgari')(ex.laps, 2000, 4), 46.4);
eq('前半3F', ex.shape.first3, 35.2);
eq('前半-後半の差', ex.shape.diff, 0.3);
/* netkeiba のペースが取れないページでも、ラップから推定できること */
eq('ラップからのペース推定(このレースはM)', fn('rdPaceFromLaps')(ex.laps, 2000), 'M');
eq('ラップからのペース推定(前3Fが遅い→S)', fn('rdPaceFromLaps')(
  [{m:200,lap:13.0},{m:400,lap:12.0},{m:600,lap:12.0},{m:800,lap:11.5},{m:1000,lap:11.0},{m:1200,lap:11.0}], 1200), 'S');
eq('ラップからのペース推定(前3Fが速い→H)', fn('rdPaceFromLaps')(
  [{m:200,lap:11.5},{m:400,lap:10.5},{m:600,lap:11.0},{m:800,lap:12.5},{m:1000,lap:13.0},{m:1200,lap:13.5}], 1200), 'H');
eq('ラップが足りないときは空', fn('rdPaceFromLaps')([{m:200,lap:12},{m:400,lap:11}], 400), '');

console.log(' A-5. 全着順');
eq('16頭ぶん', ex.rows.length, 16);
const w = ex.rows[0];
eq('1着の馬名', w.name, 'ジョバンニ');
eq('1着の馬番/枠', [w.no, w.frame], ['15', '8']);
eq('1着のnetkeiba馬ID', w.nk, '2022103995');
eq('1着の性齢/馬体重/増減', [w.sexAge, w.weightKg, w.wchg], ['牡4', 478, '+4']);
eq('1着の騎手/斤量/厩舎', [w.jockey, w.kg, w.trainer], ['松山', '58.0', '栗東・杉山晴']);
eq('1着のタイム/上り', [w.time, w.last3, w.timeSec, w.agariSec], ['1:57.6', '34.6', 117.6, 34.6]);
eq('1着のオッズ/人気', [w.odds, w.pop], [7.1, 3]);
eq('2着の着差', ex.rows[1].margin, 'クビ');
const last = ex.rows[ex.rows.length - 1];
eq('中止の馬は rank=0 + status', [last.rank, last.status, last.name], [0, '中止', 'グランヴィノス']);

console.log(' A-6. 払戻金（全8券種）');
['win','place','wakuren','umaren','wide','umatan','sanfuku','santan'].forEach(function(k){
  T('払戻 ' + k + ' が入っている', !!(ex.payout && ex.payout[k]), k);
});
eq('単勝', ex.payout.win, { nos: ['15'], pays: [710] });
eq('複勝(3件)', ex.payout.place.pays, [220, 510, 380]);
eq('枠連', ex.payout.wakuren, { nos: ['4-8'], pays: [1950] });
eq('馬連', ex.payout.umaren, { nos: ['8-15'], pays: [4460] });
eq('ワイド(3件)', ex.payout.wide.pays, [1400, 1240, 2760]);
eq('馬単は → 区切り', ex.payout.umatan, { nos: ['15→8'], pays: [8370] });
eq('3連複', ex.payout.sanfuku, { nos: ['7-8-15'], pays: [16840] });
eq('3連単', ex.payout.santan, { nos: ['15→8→7'], pays: [85250] });

console.log(' A-6b. PC結果ページ(race.netkeiba.com/race/result.html)の形式にも対応');
const PC = fix('nk_pc_result_202609040311.utf8.html');
const exP = fn('rdParseExtra')(PC, { dist: 2000 });
eq('PC: コーナー4本', exP.corners.n, 4);
eq('PC: 1角の生テキストはSPと同じ', exP.corners.c[0], ex.corners.c[0]);
eq('PC: 15番の通過', exP.cornerPos['15'], [6, 6, 6, 6]);
eq('PC: ペース（RapPace_Title から）', exP.pace, 'M');
eq('PC: 取得元は netkeiba', exP.paceSrc, 'nk');
eq('PC: ラップ10区間（2行=通過/ラップ）', exP.laps.length, 10);
eq('PC: 200m', [exP.laps[0].m, exP.laps[0].pass, exP.laps[0].lap], [200, 12.5, 12.5]);
eq('PC: 1200m', [exP.laps[5].m, exP.laps[5].pass, exP.laps[5].lap], [1200, 71.2, 11.8]);
eq('PC: ゴール', [exP.laps[9].m, exP.laps[9].pass, exP.laps[9].lap], [2000, 117.6, 11.7]);
eq('PC: 前半3F/差', [exP.shape.first3, exP.shape.diff], [35.2, 0.3]);
eq('PC: SPと同じラップになる', exP.laps.map(function(x){ return [x.m, x.pass, x.lap]; }),
                              ex.laps.map(function(x){ return [x.m, x.pass, x.lap]; }));
eq('PC: 払戻8券種', Object.keys(exP.payout || {}).filter(function(k){ return exP.payout[k]; }).length, 8);
eq('PC: 3連単', exP.payout.santan, { nos: ['15→8→7'], pays: [85250] });

console.log(' A-7. 保存用コンパクト形式');
const cp = fn('rdCompact')(ex, 16);
eq('pace', cp.pace, 'M');
eq('コーナー4本', cp.corners.length, 4);
eq('15番の位置', cp.pos['15'], [6, 6, 6, 6]);
eq('15番の4角位置と脚質', cp.sty['15'], { p4: 6, tag: '差し' });
eq('2番の4角位置と脚質', cp.sty['2'], { p4: 1, tag: '逃げ' });
eq('ラップは [距離, ラップ, 通過]', cp.laps[0], [200, 12.5, 12.5]);
eq('shape', cp.shape, { f3: 35.2, l3: 34.9, d: 0.3 });
eq('払戻も一緒に入る', cp.payout.santan.pays[0], 85250);
T('空HTMLでも落ちない', fn('rdParseExtra')('').ok === false);
T('別ページ(新聞)を渡しても落ちない', typeof fn('rdParseExtra')(fix('nk_sp_newspaper_202609040311.html')).ok === 'boolean');

/* ============================================================
   B) 騎手成績・乗り替わり・休養・鉄砲・2走目
   （netkeiba 競馬新聞 2026-09-12 阪神11R チャレンジC の表示と突き合わせ）
   ============================================================ */
const hdParse = fn('hdParseRecords');
const analyze = fn('jlAnalyze');
const RACE = '20260912';

function recsOf(file){
  return hdParse(fs.readFileSync(file, 'utf8'));
}
const FX_H = ['horse_res_2022105175.utf8.html', 'horse_res_2022105710.utf8.html', 'horse_res_2021105808.utf8.html'];
const HAS_FIX = FX_H.every(function(f){ return fs.existsSync(path.join(ROOT, 'tests', 'fixtures', f)); });
function fxp(f){ return path.join(ROOT, 'tests', 'fixtures', f); }

console.log(' B-0. 間隔・休養の計算（合成データ）');
eq('jlD8: 2026/06/28', fn('jlD8')('2026/06/28'), '20260628');
eq('jlD8: 2026-06-28', fn('jlD8')('2026-06-28'), '20260628');
eq('jlD8: 20260628', fn('jlD8')('20260628'), '20260628');
eq('jlD8: 2026年6月28日', fn('jlD8')('2026年6月28日'), '20260628');
eq('jlD8: 不正', fn('jlD8')('abc'), '');
eq('jlDays: 06/28→09/12', fn('jlDays')('20260628', '20260912'), 76);
eq('中N週: 76日 → 中10週', fn('jlWeeks')(76), 10);
eq('中N週: 98日 → 中13週（丁度14週でも13）', fn('jlWeeks')(98), 13);
eq('中N週: 62日 → 中8週', fn('jlWeeks')(62), 8);
eq('中N週: 55日 → 中7週', fn('jlWeeks')(55), 7);
eq('○ヶ月: 98日 → 3ヶ月', fn('jlMonths')(98), 3);
eq('鉄砲: 90日以上', [fn('jlIsLayoff')(89), fn('jlIsLayoff')(90), fn('jlIsLayoff')(98)], [false, true, true]);
eq('鉄砲: null/0 は false', [fn('jlIsLayoff')(null), fn('jlIsLayoff')(0)], [false, false]);

console.log(' B-1. 騎手名の照合（新聞は略称を使う）');
eq('松本 == 松本大輝', fn('jlSameJ')('松本', '松本大輝'), true);
eq('Ｍデム == M.デムーロ（全角Ｍ）', fn('jlSameJ')('Ｍデム', 'M.デムーロ'), true);
eq('ルメー == ルメール', fn('jlSameJ')('ルメー', 'ルメール'), true);
eq('横山和 != 横山典', fn('jlSameJ')('横山和', '横山典'), false);
eq('横山和生 == 横山和生', fn('jlSameJ')('横山和生', '横山和生'), true);
eq('川田 == 川田将雅', fn('jlSameJ')('川田', '川田将雅'), true);
eq('空同士は false', fn('jlSameJ')('', ''), false);
eq('1文字は照合しない', fn('jlSameJ')('武', '武豊'), false);

console.log(' B-2. 成績の数えかた');
eq('jlRec4', fn('jlRec4')([1, 2, 3, 4, 16, 1]), [2, 1, 1, 2]);
eq('jlRec4: 中止(0)は数えない', fn('jlRec4')([1, 0, '', 5]), [1, 0, 0, 1]);
eq('jlRecTxt', fn('jlRecTxt')([2, 0, 0, 1]), '2.0.0.1');
eq('jlRecDash', fn('jlRecDash')([1, 0, 0, 1]), '1-0-0-1');

console.log(' B-3. 合成戦績での鉄砲・2走目');
const synth = [
  { date: '2025/01/05', order: 1, jockey: '武豊' },    // デビュー（鉄砲に数えない）
  { date: '2025/02/01', order: 5, jockey: '武豊' },    // 27日 → 通常
  { date: '2025/06/01', order: 2, jockey: '川田' },    // 120日 → 鉄砲①（2着）
  { date: '2025/07/01', order: 1, jockey: '川田' },    // 30日 → 2走目①（1着）
  { date: '2025/12/01', order: 8, jockey: '川田' },    // 153日 → 鉄砲②（8着）
  { date: '2026/01/01', order: 3, jockey: '武豊' }     // 31日 → 2走目②（3着）
];
const s1 = analyze(synth, '20260912', '武豊');
eq('鉄砲 [0.1.0.1]', s1.tettepo, [0, 1, 0, 1]);
eq('鉄砲の戦数', s1.tettepoN, 2);
eq('2走目 [1.0.1.0]', s1.secondRec, [1, 0, 1, 0]);
eq('2走目の戦数', s1.secondRecN, 2);
eq('武豊の成績 [1.0.1.1]', s1.jFit, [1, 0, 1, 1]);
eq('前走の騎手', s1.prevJockey, '武豊');
eq('乗り替わりではない', s1.changed, false);
eq('前走(2026/01/01)から254日 → 休み明け', [s1.gapDays, s1.layoff, s1.months], [254, true, 8]);
eq('表示する', s1.show, true);
const s2 = analyze(synth, '20260201', 'ルメール');
eq('前走から31日 → 休み明けではない', [s2.gapDays, s2.layoff, s2.second], [31, false, false]);
eq('表示しない', s2.show, false);
eq('初騎乗', s2.firstRide, true);
eq('乗り替わり', s2.changed, true);
eq('戦績なし', analyze([], '20260912', '武豊').has, false);
eq('今回より後の戦績は数えない', analyze(
  [{ date: '2026/01/01', order: 1, jockey: 'A' }, { date: '2027/01/01', order: 1, jockey: 'A' }], '20260912', 'A').races, 1);

console.log(' B-4. 実データ（netkeiba 競馬新聞の表示と一致）');
if (!HAS_FIX){
  console.log('  (skip) tests/fixtures の実データ戦績ファイルがありません。');
} else {
  /* フィーリウス: 中10週 / 前走が鉄砲(98日) / 鉄砲[0.0.0.1] / 2走目[0.0.0.0] / 替Ｍデム・初騎乗 */
  const f = analyze(recsOf(fxp('horse_res_2022105175.utf8.html')), RACE, 'Ｍデム');
  eq('フィーリウス 中10週', f.weeks, 10);
  eq('フィーリウス 76日 → 今回が鉄砲ではない', f.layoff, false);
  eq('フィーリウス 前走が鉄砲 → 今回が2走目', f.second, true);
  eq('フィーリウス 鉄砲[0.0.0.1]', f.tettepo, [0, 0, 0, 1]);
  eq('フィーリウス 2走目[0.0.0.0]', f.secondRec, [0, 0, 0, 0]);
  eq('フィーリウス 初騎乗', f.firstRide, true);
  eq('フィーリウス 乗り替わり', f.changed, true);
  eq('フィーリウス 表示する', f.show, true);

  /* ジーティーダーリン: 中13週 / 3ヵ月休養 / 鉄砲[2.0.0.1] / 2走目[1.0.0.1] / 松本 1-0-0-0（替なし） */
  const g = analyze(recsOf(fxp('horse_res_2022105710.utf8.html')), RACE, '松本');
  eq('ジーティーダーリン 中13週', g.weeks, 13);
  eq('ジーティーダーリン 98日 → 今回が鉄砲', g.layoff, true);
  eq('ジーティーダーリン 3ヵ月休養', g.months, 3);
  eq('ジーティーダーリン 鉄砲[2.0.0.1]', g.tettepo, [2, 0, 0, 1]);
  eq('ジーティーダーリン 2走目[1.0.0.1]', g.secondRec, [1, 0, 0, 1]);
  eq('ジーティーダーリン 松本 1-0-0-0', g.jFit, [1, 0, 0, 0]);
  eq('ジーティーダーリン 乗り替わりではない', g.changed, false);

  /* ガイアメンテ: 中7週（休養なし）/ 武豊 1-0-0-1 / 替 */
  const m = analyze(recsOf(fxp('horse_res_2021105808.utf8.html')), RACE, '武豊');
  eq('ガイアメンテ 中7週', m.weeks, 7);
  eq('ガイアメンテ 休養ではない', m.layoff, false);
  eq('ガイアメンテ 表示しない（新聞にも鉄砲の行が無い）', m.show, false);
  eq('ガイアメンテ 武豊 1-0-0-1', m.jFit, [1, 0, 0, 1]);
  eq('ガイアメンテ 乗り替わり', m.changed, true);
}

console.log(' B-5. 表示HTML');
const hLay = fn('jlHTML')({ has: true, show: true, layoff: true, gapDays: 98, weeks: 13, months: 3,
  tettepo: [2,0,0,1], tettepoN: 3, secondRec: [1,0,0,1], secondRecN: 2 });
T('○ヶ月休養が出る', hLay.indexOf('3ヵ月休養') >= 0, hLay);
T('鉄砲の成績が出る', hLay.indexOf('2.0.0.1') >= 0, hLay);
T('2走目の成績が出る', hLay.indexOf('1.0.0.1') >= 0, hLay);
const h2nd = fn('jlHTML')({ has: true, show: true, layoff: false, second: true, weeks: 10,
  tettepo: [0,0,0,1], tettepoN: 1, secondRec: [0,0,0,0], secondRecN: 0 });
T('2走目の表示', h2nd.indexOf('2走目') >= 0, h2nd);
T('休養明けでないなら○ヶ月休養は出ない', h2nd.indexOf('ヵ月休養') < 0, h2nd);
eq('間隔が空いていない馬は何も出さない', fn('jlHTML')({ has: true, show: false }), '');
eq('戦績なしは何も出さない', fn('jlHTML')({ has: false }), '');
const hJ = fn('jlJockeyHTML')({ has: true, changed: true, firstRide: false, jFit: [1,0,0,1], jFitN: 2 }, true);
T('乗り替わり「替」', hJ.indexOf('替') >= 0, hJ);
T('騎手成績 1-0-0-1', hJ.indexOf('1-0-0-1') >= 0, hJ);
T('初騎乗', fn('jlJockeyHTML')({ has: true, changed: true, firstRide: true, jFit: [0,0,0,0], jFitN: 0 }, true).indexOf('初騎乗') >= 0);
T('未取得の案内', fn('jlJockeyHTML')({ has: false }, false).indexOf('未取得') >= 0);

/* ============================================================
   C) race_id は日付ではない
   ============================================================ */
console.log(' C. nkTodayD8() の修正');
const srcP40 = fs.readFileSync(path.join(ROOT, 'src', 'p40_netkeiba.js'), 'utf8');
T('race_id の先頭8桁を日付として使っていない',
  !/function nkTodayD8\(\)\{[\s\S]{0,200}r\.slice\(0, 8\)/.test(srcP40));
T('jlRaceD8() を使う', /function nkTodayD8\(\)\{[\s\S]{0,200}jlRaceD8/.test(srcP40));
T('p48/p49 がビルド順に入っている',
  (function(){
    const b = fs.readFileSync(path.join(ROOT, 'build.py'), 'utf8');
    return b.indexOf("'p48_racedata'") >= 0 && b.indexOf("'p49_jockeylay'") >= 0;
  })());
T('出馬表に「休養・鉄砲」列がある',
  fs.readFileSync(path.join(ROOT, 'src', 'p2_body.html'), 'utf8').indexOf('休養・鉄砲') >= 0);
T('出馬表の行が jlcell を出す',
  fs.readFileSync(path.join(ROOT, 'src', 'p6_inputui.js'), 'utf8').indexOf('class="jlcell"') >= 0);

/* ============================================================
   D) p50_pacefit.js — 展開（ペース）適性 × コーナー通過順バイアスの学習
   ============================================================ */
console.log(' D-1. 部品（距離帯・位置帯・ペース判定・通過順）');
load('p50_pacefit.js');
T('p50 が読み込めた', typeof fn('pfLearn') === 'function');
eq('距離帯 1200m', fn('pfBandOf')(1200).k, 'd1');
eq('距離帯 1800m', fn('pfBandOf')(1800).k, 'm1');
eq('距離帯 2000m', fn('pfBandOf')(2000).k, 'm2');
eq('距離帯 2860m(障害)', fn('pfBandOf')(2860).k, 'l1');
eq('4角1番手', fn('pfPosBandOf')(1).k, '1');
eq('4角3番手', fn('pfPosBandOf')(3).k, '2-3');
eq('4角6番手', fn('pfPosBandOf')(6).k, '4-6');
eq('4角10番手', fn('pfPosBandOf')(10).k, '7-10');
eq('4角13番手', fn('pfPosBandOf')(13).k, '11-');
eq('位置0は帯なし', fn('pfPosBandOf')(0), null);
eq('通過順 6-7-6-8 → 4角8', fn('pfLastPos')('6-7-6-8'), 8);
eq('通過順 1-1-1-1 → 1', fn('pfLastPos')('1-1-1-1'), 1);
eq('通過順なし → 0', fn('pfLastPos')(''), 0);
eq('ラベル「ハイ」→H', fn('pfPaceOfLabel')('ハイ'), 'H');
eq('ラベル「ややスロー」→S', fn('pfPaceOfLabel')('ややスロー'), 'S');
eq('ラベル「平均」→M', fn('pfPaceOfLabel')('平均'), 'M');
eq('スコア0.30→S', fn('pfPaceOfScore')(0.30), 'S');
eq('スコア0.55→M', fn('pfPaceOfScore')(0.55), 'M');
eq('スコア0.80→H', fn('pfPaceOfScore')(0.80), 'H');
eq('馬名キーは括弧・中黒を落とす', fn('pfNameKey')('ジョバンニ（外）'), 'ジョバンニ');

console.log(' D-2. 実データ（阪神11R チャレンジC）を学習用の形に整える');
const xdC = fn('rdCompact')(ex, 16);
T('rdCompact が pos を持つ', !!(xdC && xdC.pos && xdC.pos['15']));
const recSP = {
  rid: '202609040311', date8: '20260912', n: 16,
  meta: { place: '阪神', surface: '芝', m: 2000, dist: '芝2000m', baba: '良' },
  rows: [
    { order: 1, no: '15', name: 'ジョバンニ',   passing: '6-6-6-6' },
    { order: 2, no: '8',  name: 'ソールオリエンス', passing: '7-7-7-7' },
    { order: 3, no: '2',  name: 'ジーティーダーリン', passing: '1-1-1-1' }
  ],
  xd: xdC
};
const nrSP = fn('pfNormalizeRace')(recSP);
T('整えられた', !!nrSP);
eq('場', nrSP.place, '阪神');
eq('距離帯', nrSP.band, 'm2');
eq('ペースはページ表示から', nrSP.pace, String(ex.pace).toUpperCase().charAt(0));
eq('1着ジョバンニの4角位置はxd優先', nrSP.horses[0].pos4, 6);
eq('4角6番手の帯', nrSP.horses[0].posBand, '4-6');
eq('4角6番手の脚質', nrSP.horses[0].style, fn('pfStyleAt')(6, 16));
eq('逃げた2番の4角位置', nrSP.horses[2].pos4, 1);
eq('馬名キー', nrSP.horses[0].key, 'ジョバンニ');
// xd が無いレコードは rows の通過順から4角位置を出す
const nrNoXD = fn('pfNormalizeRace')({
  rid: 'X1', n: 16, meta: { place: '東京', surface: 'ダ', m: 1600 },
  rows: [{ order: 1, no: '3', name: 'テスト', passing: '12-11-9-4' }]
});
eq('xdなしは通過順から4角位置', nrNoXD.horses[0].pos4, 4);
eq('xdなしはペース不明のまま', nrNoXD.pace, '');
// ラップの前3F-後3Fからペースを推定できる
const nrLap = fn('pfNormalizeRace')({
  rid: 'X2', n: 10, meta: { place: '中山', surface: '芝', m: 1600 },
  rows: [{ order: 1, no: '1', name: 'A', passing: '1-1-1-1' }],
  xd: { pace: '', shape: { f3: 34.0, l3: 36.5, d: -2.5 } }
});
eq('ラップ差-2.5秒はハイ推定', nrLap.pace, 'H');
eq('推定元を記録', nrLap.paceSrc, 'lap');

console.log(' D-3. 集計（学習）— ハイは前残り・スローは差し込み の合成データ');
function mkRace(rid, place, surface, m, pace, rev){
  const n = 10, band = fn('pfBandOf')(m);
  const horses = [];
  for (let p4 = 1; p4 <= n; p4++){
    const order = rev ? (n + 1 - p4) : p4;          // rev=true は「後ろから行った馬が勝つ」
    const no = String(p4);
    const name = (p4 === 1) ? 'ハイオトコ' : ('ウマ' + p4);
    const pb = fn('pfPosBandOf')(p4);
    horses.push({
      no: no, name: name, key: fn('pfNameKey')(name),
      order: order, pos4: p4,
      style: fn('pfStyleAt')(p4, n),
      posBand: pb ? pb.k : '', posBandLabel: pb ? pb.label : ''
    });
  }
  return {
    rid: rid, date8: '20260901', place: place, surface: surface, m: m,
    band: band ? band.k : '', bandLabel: band ? band.label : '', baba: '良',
    pace: pace, paceSrc: 'page', n: n, horses: horses, laps: 0, hasXD: true
  };
}
const races = [];
for (let i = 1; i <= 6; i++) races.push(mkRace('H' + i, '東京', '芝', 2000, 'H', false));  // ハイは前残り
for (let i = 1; i <= 5; i++) races.push(mkRace('S' + i, '東京', '芝', 2000, 'S', true));   // スローは差し込み
const L = fn('pfLearn')(races);
eq('レース数', L.races, 11);
eq('ペースあり', L.withPace, 11);
eq('コーナーあり', L.withCorner, 11);
eq('馬の数', Object.keys(L.horse).length, 10);
eq('場のレース数', L.venue['東京'].races, 11);
eq('距離帯のレース数', L.dist['m2'], 11);
eq('ハイ×逃げは全勝', L.pace.H['逃げ'].win, 6);
eq('ハイ×逃げの3着内', L.pace.H['逃げ'].top3, 6);
eq('スロー×逃げは圏外', L.pace.S['逃げ'].top3, 0);
eq('スロー×逃げの出走数', L.pace.S['逃げ'].n, 5);
T('位置帯キーがある', !!L.pos['東京|芝|m2'], Object.keys(L.pos));
eq('4角1番手の出走数(全11レース)', L.pos['東京|芝|m2']['1'].n, 11);
eq('4角1番手の3着内(ハイ6のみ)', L.pos['東京|芝|m2']['1'].top3, 6);
eq('全場まとめもある', L.posAll['m2']['1'].n, 11);

console.log(' D-4. 馬ごとの展開適性（ハイで走る／スローで届かない）');
const fitH = fn('pfHorseFit')(L, 'ハイオトコ', 'H');
T('判定できた', !!fitH);
eq('ハイの成績 6/6', [fitH.H.top3, fitH.H.n], [6, 6]);
eq('スローの成績 0/5', [fitH.S.top3, fitH.S.n], [0, 5]);
eq('全成績', [fitH.all.top3, fitH.all.n], [6, 11]);
T('ハイは向く（倍率>1）', fitH.mul > 1, fitH.mul);
eq('ハイの倍率', fitH.mul, 1.333);
T('説明文に「向く」', fitH.txt.indexOf('向く') >= 0, fitH.txt);
const fitS = fn('pfHorseFit')(L, 'ハイオトコ', 'S');
T('スローは割引（倍率<1）', fitS.mul < 1, fitS.mul);
eq('スローの倍率は下限0.70', fitS.mul, 0.7);
T('説明文に「割引」', fitS.txt.indexOf('割引') >= 0, fitS.txt);
eq('学習DBに無い馬は null', fn('pfHorseFit')(L, 'ソンザイシナイ', 'H'), null);
T('サンプル5戦未満は倍率を掛けない', (function(){
  const L2 = fn('pfLearn')([mkRace('Z1', '中山', '芝', 1800, 'H', false), mkRace('Z2', '中山', '芝', 1800, 'H', false)]);
  const f = fn('pfHorseFit')(L2, 'ハイオトコ', 'H');
  return f && f.mul === 1 && f.txt.indexOf('判定できません') >= 0;
})());

console.log(' D-5. ペース×脚質・コーナー位置バイアスの倍率');
T('ハイ×逃げは有利', fn('pfPaceStyleMul')(L, 'H', '逃げ').mul > 1, fn('pfPaceStyleMul')(L, 'H', '逃げ'));
T('スロー×逃げは不利', fn('pfPaceStyleMul')(L, 'S', '逃げ').mul < 1, fn('pfPaceStyleMul')(L, 'S', '逃げ'));
T('スロー×追込は有利', fn('pfPaceStyleMul')(L, 'S', '追込').mul > 1, fn('pfPaceStyleMul')(L, 'S', '追込'));
eq('データのないペース×脚質は1.0', fn('pfPaceStyleMul')(L, 'M', '逃げ').mul, 1);
const pm1 = fn('pfPosMul')(L, '東京', '芝', 'm2', '1');
const pm11 = fn('pfPosMul')(L, '東京', '芝', 'm2', '4-6');   // 10頭立てなので4角11番手以降は無い → 中団で検証
T('4角1番手は有利', pm1.mul > 1, pm1);
T('4角4〜6番手は不利', pm11.mul < 1, pm11);
T('倍率は 0.70〜1.40 の範囲', pm1.mul <= 1.40 && pm11.mul >= 0.70, [pm1.mul, pm11.mul]);
T('根拠のテキストがある', pm1.txt.length > 0, pm1.txt);
T('条件違いでも全場の同じ距離帯で代用', fn('pfPosMul')(L, '阪神', '芝', 'm2', '1').mul > 1);

console.log(' D-6. 1頭ぶんの総合倍率（0.6〜1.6 に収まる）');
const ctxH = { place: '東京', surface: '芝', m: 2000, band: 'm2', pace: 'H' };
const scH = fn('pfScoreFor')(L, { name: 'ハイオトコ', style: '逃げ' }, ctxH);
T('ハイの逃げ馬は上振れ', scH.mul > 1, scH);
T('倍率が範囲内', scH.mul >= 0.6 && scH.mul <= 1.6, scH.mul);
T('根拠が3種そろわないまでも1つ以上', scH.notes.length >= 1, scH.notes);
const ctxS = { place: '東京', surface: '芝', m: 2000, band: 'm2', pace: 'S' };
const scS = fn('pfScoreFor')(L, { name: 'ハイオトコ', style: '逃げ' }, ctxS);
T('同じ馬でもスロー予想なら下振れ', scS.mul < 1 && scS.mul < scH.mul, [scS.mul, scH.mul]);
const scU = fn('pfScoreFor')(L, { name: 'ソンザイシナイ', style: '逃げ' }, ctxH);
T('学習DBに無い馬は脚質・位置ぶんだけ', scU.mul >= 0.6 && scU.mul <= 1.6 && !scU.fit, scU.mul);
eq('学習データが空なら倍率1.0', fn('pfScoreFor')(fn('pfLearn')([]), { name: 'ハイオトコ', style: '逃げ' }, ctxH).mul, 1);

console.log(' D-7. AI予想への入口と保存・読込（圧縮して localStorage へ）');
T('AI予想への入口がある', typeof fn('pfHorseMuls') === 'function');
eq('学習データが無ければ null（AI印を一切変えない）',
  fn('pfHorseMuls')([{ name: 'ハイオトコ', style: '逃げ' }], {}, { score: 0.9 }), null);
fn('pfSave')(L);
const L2 = fn('pfLoad')();
T('読み戻せた', !!L2);
eq('読み戻したレース数', L2 && L2.races, 11);
eq('読み戻した馬の成績', L2 && L2.horse['ハイオトコ'].H.top3, 6);
T('保存キー', Object.prototype.hasOwnProperty.call(store, 'keiba_pf_v1'));
T('集計し直し関数がある', typeof fn('pfRebuild') === 'function');
const muls = fn('pfHorseMuls')([{ name: 'ハイオトコ', style: '逃げ' }, { name: 'ソンザイシナイ', style: '追込' }], {}, { score: 0.9 });
T('学習後は1頭ずつ倍率を返す', Array.isArray(muls) && muls.length === 2, muls);
T('倍率は 0.6〜1.6', muls.every(function(x){ return x >= 0.6 && x <= 1.6; }), muls);
T('ハイペース予想なので逃げ馬は上振れ', muls[0] > 1, muls);

console.log(' D-8. 配線（保存・AI予想・表示への接続）');
const srcB = fs.readFileSync(path.join(ROOT, 'build.py'), 'utf8');
T('build.py に p50_pacefit が入っている', srcB.indexOf("'p50_pacefit'") >= 0);
const srcBody = fs.readFileSync(path.join(ROOT, 'src', 'p2_body.html'), 'utf8');
T('②に展開学習カード(#pfCard)がある', srcBody.indexOf('id="pfCard"') >= 0 && srcBody.indexOf('id="pfBox"') >= 0);
T('折り込んだまま要点が出る(#pfPick)', srcBody.indexOf('id="pfPick"') >= 0);
T('反映ON/OFFのチェックボックスがある', srcBody.indexOf('id="pfUseChk"') >= 0);
const idxHTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
T('index.html に展開学習が入っている', idxHTML.indexOf('pfHorseMuls') >= 0 && idxHTML.indexOf('id="pfCard"') >= 0);
const srcEng = fs.readFileSync(path.join(ROOT, 'src', 'p5_engine.js'), 'utf8');
T('AI予想の展開適性が学習倍率を掛ける', srcEng.indexOf('pfHorseMuls(hs, state, pace)') >= 0 &&
  srcEng.indexOf('pfMuls[i]') >= 0);
const srcMain = fs.readFileSync(path.join(ROOT, 'src', 'p10_main.js'), 'utf8');
T('起動時に initPf を呼ぶ', srcMain.indexOf("safeInit('initPf', initPf)") >= 0);
T('②を開いたときに描き直す', srcMain.indexOf("id === 't-kentai'") >= 0 && srcMain.indexOf('pfPaint') >= 0);
const srcDi = fs.readFileSync(path.join(ROOT, 'src', 'p32_dateimport.js'), 'utf8');
T('学習DB取込後に再集計する', srcDi.indexOf('pfSchedule()') >= 0);
T('学習DBに xd(コーナー/ペース/ラップ) を保存する', srcDi.indexOf('xd: xd || null') >= 0 && srcDi.indexOf('xdv:') >= 0);
T('ラップが無かったレースだけPC版を1回取りに行く', srcDi.indexOf('DI_XD_EXTRA') >= 0 &&
  srcDi.indexOf('race.netkeiba.com/race/result.html?race_id=') >= 0);
const srcBias = fs.readFileSync(path.join(ROOT, 'src', 'p13_bias.js'), 'utf8');
T('トラックバイアス取込でも xd を保存する', srcBias.indexOf('rdParseExtra') >= 0 && srcBias.indexOf('xd:') >= 0);
const srcAp = fs.readFileSync(path.join(ROOT, 'src', 'p30_learnrec.js'), 'utf8');
T('自己検証レコードへ後から反映できる(apPatchExtra)', srcAp.indexOf('function apPatchExtra') >= 0);
T('自己検証レコードに入っても再集計する', srcAp.indexOf('pfSchedule') >= 0);

console.log('');
console.log((bad ? 'FAIL' : 'PASS') + ' rework9(第16弾): ok=' + ok + ' bad=' + bad);
process.exit(bad ? 1 : 0);
