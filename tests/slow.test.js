/* 出遅れ検出・出遅れ率自動計算 の軽量テスト
   実行: node tests/slow.test.js
   p3_core / p6_inputui / p34_horsedetail / p40_netkeiba を読み込み検証する。 */
const fs = require('fs');
const vm = require('vm');
function makeEl(id){
  const el = { id: id || '', value:'', _html:'', textContent:'', style:{},
    classList:{ _s:new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); },
      toggle(c,f){ if(f===undefined){ this._s.has(c)?this._s.delete(c):this._s.add(c); } else if(f) this._s.add(c); else this._s.delete(c); },
      contains(c){ return this._s.has(c); } },
    setAttribute(){}, getAttribute(){ return null; }, addEventListener(){},
    querySelector(){ return makeEl(); }, querySelectorAll(){ return []; }, dataset:{} };
  Object.defineProperty(el, 'innerHTML', { get(){ return el._html; }, set(v){ el._html = v; } });
  return el;
}
const els = {};
const g = {
  console, Math, JSON, Date, String, Number, parseInt, parseFloat, isNaN, RegExp,
  encodeURIComponent, decodeURIComponent,
  setTimeout: function(){ return 0; }, clearTimeout(){}, setInterval(){ return 0; },
  requestAnimationFrame: function(){ return 0; }, cancelAnimationFrame(){},
  localStorage: { getItem(){ return null; }, setItem(){}, removeItem(){} },
  addEventListener(){}, devicePixelRatio: 1, innerWidth: 980, navigator: {},
  document: { getElementById(id){ if (!els[id]) els[id] = makeEl(id); return els[id]; }, createElement(){ return makeEl(); } }
};
g.window = g;
vm.createContext(g);
const files = ['src/p3_core.js','src/p6_inputui.js','src/p34_horsedetail.js','src/p40_netkeiba.js'];
let code = '';
for (const f of files) code += fs.readFileSync(f, 'utf8') + '\n';
vm.runInContext(code, g, { filename: 'keiba.js' });

const probe = `(function(){
  var out = { ok:true, msgs:[] };
  function chk(cond, msg){ if(!cond){ out.ok=false; out.msgs.push(msg); } }
  var recs=[
    {date:'2026/1/5', head:'16', order:'5',  pass:'3-3-3-3',      dist:'芝2000'},   // 普通(判定対象)
    {date:'2026/2/8', head:'16', order:'10', pass:'16-10-6-5',    dist:'芝2000'},   // 推定: ゲート遅れ→2角で挽回
    {date:'2026/3/1', head:'18', order:'7',  pass:'17-16-7-14(出遅れ)', dist:'芝2400'}, // 明示
    {date:'2026/4/1', head:'18', order:'12', pass:'16-16-15-10',  dist:'芝2000'},   // 後方のまま終盤だけ伸びた追込 → 数えない
    {date:'2026/5/1', head:'18', order:'12', pass:'15-14-14-14',  dist:'芝2000'}    // ずっと後方 → 数えない
  ];
  var st = hdSlowStat(recs);
  chk(st.total === 5, '分母(判定対象)は5走のはず: ' + st.total);
  chk(st.m === 1, '明示出遅れは1回のはず: ' + st.m);
  chk(st.i === 1, '推定は1回のはず: ' + st.i);
  chk(st.all === 40, '出遅れ率は40%のはず: ' + st.all);
  chk(hdRaceSlowKey({order:'7', head:'18', pass:'17-16-7-14(出遅れ)', dist:'芝2000'}) === 'm', '明示表記は m');
  chk(hdRaceSlowKey({order:'7', head:'16', pass:'16-10-6-5', dist:'芝2000'}) === 'i', 'ゲート遅れ→挽回は i');
  chk(hdRaceSlowKey({order:'7', head:'16', pass:'16-16-15-10', dist:'芝2000'}) === null, '終盤だけ伸びた後方は数えない');
  chk(hdRaceSlowKey({order:'7', head:'16', pass:'16-15-15-14', dist:'芝2000'}) === null, '後方のままは数えない');
  chk(hdRaceSlowKey({order:'0', head:'16', pass:'16-15-10-6', dist:'芝2000'}) === null, '中止は対象外');
  // 出遅れ率は手入力運用（#2026-09-10）: 取得はするが h.slow 等へ自動セットしない
  var h1 = { no:'1', name:'ウマ1', slow:'' };
  var st1 = nkSlowApply(h1, { slow: st });
  chk(st1 && st1.all === 40, '集計は返す(参考値): ' + (st1 && st1.all));
  chk(h1.slow === '' || h1.slow == null, 'h.slowへは自動セットしない: ' + h1.slow);
  chk(h1.slowAll == null && h1.slowSrc == null && h1.slowAuto == null, '集計フィールドも書かない');
  // 手入力値はそのまま
  var h2 = { no:'2', name:'ウマ2', slow:'33', slowTouched:true };
  nkSlowApply(h2, { slow: st });
  chk(h2.slow === '33', '手入力値はそのまま: ' + h2.slow);
  // グリッド行に「自動」バッジと値が出る
  var h3 = { no:'3', name:'ウマ3', slow:'40', slowSrc:'netkeiba', slowN:1, slowI:1, slowAll:5, slowPct:40, frame:'1' };
  var html = buildHorseRowHTML(h3, 0);
  chk(html.indexOf('自動') >= 0, 'slowセルに⚡自動バッジ');
  chk(html.indexOf('value="40"') >= 0, 'slowセルに自動値');
  return out;
})()`;
const r = vm.runInContext(probe, g);
if (!r.ok) { console.log('slow detect : FAIL'); r.msgs.forEach(function(m){ console.log('  - ' + m); }); process.exit(1); }
console.log('slow detect : OK  (明示/推定/分母・手入力優先・自動セットしない・UIバッジ)');
