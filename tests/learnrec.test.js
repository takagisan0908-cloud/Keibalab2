/* 自己学習(3モデル × 年月ごと学習 → 保存)の機能スモークテスト
   実行: node tests/learnrec.test.js
   p3_core / p5_engine / p30_learnrec を読み込み、過去レースを年月ごとに取込んで
   - 開催年月バケットへの集計
   - 「その月より前の月」だけから学習パラメータを導出(未来データ不使用)
   - 同一レース再取込で二重計上しない
   を検証する。 */
const fs = require('fs');
const vm = require('vm');

/* localStorage を map ベースで用意(列挙可能・容量制限なし) */
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
  const el = { id: id || '', value: '', _html: '', style: {}, classList: { _s: new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); }, contains(c){ return this._s.has(c); } },
    setAttribute(){}, getAttribute(){ return null; }, addEventListener(){}, querySelector(){ return makeEl(); }, querySelectorAll(){ return []; } };
  Object.defineProperty(el, 'innerHTML', { get(){ return el._html; }, set(v){ el._html = v; } });
  return el;
}
const els = {};
const ls = mkLS();
const g = {
  console, Math, JSON, Date, String, Number, parseInt, parseFloat, isNaN, RegExp,
  encodeURIComponent, decodeURIComponent,
  setTimeout(){ return 0; }, clearTimeout(){}, setInterval(){ return 0; },
  requestAnimationFrame(){ return 0; }, cancelAnimationFrame(){},
  localStorage: ls, addEventListener(){}, devicePixelRatio: 1, innerWidth: 980,
  navigator: {}, window: null,
  document: { getElementById(id){ if (!els[id]) els[id] = makeEl(id); return els[id]; } }
};
g.window = g;
vm.createContext(g);

const files = ['src/p3_core.js', 'src/p5_engine.js', 'src/p14_history.js', 'src/p30_learnrec.js'];
let code = '';
for (const f of files) code += fs.readFileSync(f, 'utf8') + '\n';
vm.runInContext(code, g, { filename: 'keiba.js' });

/* 決定的な擬似乱数で「レース結果ページ」を多数生成 */
const prog = `
(function(){
  var R = [];
  var seed = 12345;
  function rnd(){ seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function mkRace(ym, k){
    var N = 12;
    var rows = [];
    // オッズ(安い順に no を並べ、ときどき人気薄が来る想定)
    var perm = [];
    for (var i = 0; i < N; i++) perm.push(i);
    for (var i = N - 1; i > 0; i--){ var j = Math.floor(rnd() * (i + 1)); var t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    var order = [];
    for (var i = 0; i < N; i++) order.push(i + 1);
    for (var i = N - 1; i > 0; i--){ var j = Math.floor(rnd() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; }
    var styles = ['逃げ','先行','差し','追込','先行','差し','追込','逃げ','差し','先行','差し','追込'];
    for (var i = 0; i < N; i++){
      var no = perm[i] + 1;
      var odds = 1.8 + (perm[i] * perm[i]) * 0.55 + rnd() * 3;
      rows.push({ no: no, name: 'ウマ' + no, order: order[i], odds: odds.toFixed(1), style: styles[i], passing: '' });
    }
    var rid = ym + '04' + ('000' + k).slice(-4);
    /* ★2026-09-12 第17弾: race_id の先頭8桁は日付ではない（YYYY+場コード+回+日+R）ので、
       日付は必ず p.date8 / p.meta.date8 で渡す。従来このテストは rid からの日付捏造に依存していた。 */
    return { p: { name: ym + 'テストレース' + k, place: '東京', dist: '2000', surface: '芝', rows: rows,
                  date8: ym + '15', meta: { date8: ym + '15', m: 2000, surface: '芝', place: '東京' } }, rid: rid, ym: ym };
  }
  var months = ['202501', '202502', '202503'];
  var races = [];
  months.forEach(function(ym, mi){
    for (var k = 1; k <= 16; k++) races.push(mkRace(ym, mi * 16 + k));
  });
  // --- 取込(1レースごとに apEval) ---
  races.forEach(function(r){
    var rec = apEval(r.p, r.rid, true);
    if (!rec) throw new Error('apEval null at ' + r.rid);
  });
  var errs = [];
  function t(name, cond, detail){
    if (!cond) errs.push(name + (detail ? (' :: ' + detail) : ''));
  }
  // 1) 年月バケットが3つできている
  var yms = apYms();
  t('ym list', yms.join() === '202501,202502,202503', yms.join());
  // 2) 各月のレース数(印内に1着がいた月=有効)が16
  months.forEach(function(ym){
    var b = apMB(ym);
    t('bucket ' + ym, !!(b && b.c.hit.n === 16), b ? ('n=' + b.c.hit.n) : 'no bucket');
  });
  // 3) 未来データ不使用: 202502 のレース用パラメータは「202501 より前」だけから
  var S2 = apParamsFor('202502');
  t('paramsFor 202502 totalR = 16', S2.totalR === 16, 'totalR=' + S2.totalR);
  // 4) 全月の後では全レース分
  var SA = apParamsFor('202599');
  t('paramsFor 202599 totalR = 48', SA.totalR === 48, 'totalR=' + SA.totalR);
  t('lastYm = 202503', SA.lastYm === '202503', SA.lastYm);
  // 5) 3コンセプトすべて集計される
  var agg = apConceptsAgg(apMB('202503'));
  ['hit', 'roi', 'hyb'].forEach(function(c){
    t('concept ' + c + ' races', (agg[c].races || 0) === 16 && agg[c].horseN > 0, JSON.stringify(agg[c]));
  });
  // 6) 同一レース再取込は二重計上しない(2回目は null を返す)
  var r0 = races[0];
  var again = apEval(r0.p, r0.rid, true);
  t('re-import returns null', again === null, String(again));
  var b0 = apMB(r0.ym);
  t('no double count', b0.c.hit.n === 16, 'n=' + b0.c.hit.n);
  // 7) 完了記録(結果付き)が48件
  t('completed 48', apCompleted().length === 48, 'n=' + apCompleted().length);
  // 8) 学習後に apActive が有効化されうる(48>=20 & totalR前月分あり)
  var act = apActive();
  t('apActive object', !!act && typeof act.apply === 'boolean', JSON.stringify(act).slice(0, 120));
  return errs;
})()`;

let errs = [];
try { errs = vm.runInContext(prog, g); }
catch (e) { console.log('learnrec pipeline : FAIL ' + e.message); process.exit(1); }
if (errs.length){
  console.log('learnrec pipeline : FAIL');
  errs.forEach(function(e){ console.log('  - ' + e); });
  process.exit(1);
}
console.log('learnrec pipeline : OK  (202501/02/03 を16レースずつ取込 → 年月別集計・学習導出・再取込抑止を確認)');
