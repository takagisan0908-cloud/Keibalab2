/* 「主な前走レース別成績」が1枚に統合され、同じレース名は年をまたいで合算されることのテスト
   ・年ごとの行は出ない（同じレース名が何行も出ない）
   ・年別の内訳は行内の「年別」ボタンで開く（表も列も増えない）
   実行: node tests/prevrace.test.js */
const fs = require('fs'), vm = require('vm');
let ok = 0, bad = 0;
function t(name, cond, extra){ if (cond){ ok++; } else { bad++; console.log('  FAIL', name, extra === undefined ? '' : extra); } }
function makeEl(id){
  const el = { id:id||'', value:'', _html:'', _text:'', style:{}, checked:false, open:false, disabled:false,
    classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, toggle(c,f){ if(f){this._s.add(c);} else {this._s.delete(c);} }, contains(c){ return this._s.has(c); } },
    setAttribute(){}, getAttribute(){ return null; }, addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; }, dataset:{}, closest(){ return null; }, scrollIntoView(){} };
  Object.defineProperty(el,'innerHTML',{get(){return el._html;},set(v){el._html=String(v);el._text=String(v).replace(/<[^>]*>/g,' ');}});
  Object.defineProperty(el,'textContent',{get(){return el._text;},set(v){el._text=String(v);el._html='';}});
  return el;
}
const els = {};
const docListeners = [];
const g = {
  console, Math, JSON, Date, String, Number, Array, Object, Error, Promise, Boolean, Set, Map,
  parseInt, parseFloat, isNaN, isFinite, RegExp, encodeURIComponent, decodeURIComponent,
  setTimeout, clearTimeout, setInterval(){ return 0; },
  localStorage:{ _d:{}, getItem(k){ return this._d[k]==null?null:this._d[k]; }, setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; } },
  document:{ getElementById(id){ if(!els[id]) els[id]=makeEl(id); return els[id]; },
    querySelector(){ return null; }, querySelectorAll(){ return []; }, createElement(){ return makeEl(); },
    addEventListener(ev, fn){ docListeners.push({ ev:ev, fn:fn }); }, body:makeEl('body') },
  addEventListener(){}, navigator:{ userAgent:'test' },
  fetch(){ return Promise.reject(new Error('no network in test')); }
};
g.window = g; g.globalThis = g; g.self = g;
vm.createContext(g);
vm.runInContext(['p3_core','p18_racesearch','p31_bloodfactor','p36_datarace','p39_gradecal']
  .map(f => fs.readFileSync('src/' + f + '.js','utf8')).join('\n'), g, { filename:'prev.js' });
const el = id => { if (!els[id]) els[id] = makeEl(id); return els[id]; };
const run = code => vm.runInContext(code, g);

/* 同じ前走レース名が「違う年」に何度も出るサンプル（有馬記念を前走に使った馬たち） */
function S(yr, rid, order, prevName, prevYear, venue, dist, odds){
  return { yr: yr, rid: rid, o: order, no: order, frame: String(Math.ceil(order/2)), name: '馬' + order, id: 'h' + rid + order,
    pop: order, odds: odds || 5.0, jockey: '騎手' + order, pass: '3-3-2-2', raceN: 16,
    dateStr: yr + '/12/28', train: '栗東', wchg: '0', dist: '芝2500', metaName: '有馬記念', metaPlace: '中山',
    prev: { d: prevYear + '/11/24', nm: prevName, vname: venue, r: 11, dist: dist, pop: 3, od: 2, pass: '4-4-3-3' } };
}
const samples = [
  // 前走「ジャパンカップ（東京 芝2400）」を2023年・2024年・2025年に使った馬（＝同じレース名が3年ぶん）
  S(2025, '202509090111', 1, 'ジャパンカップ', 2025, '東京', '芝2400', 3.2),
  S(2025, '202509090111', 4, 'ジャパンカップ', 2025, '東京', '芝2400', 8.0),
  S(2024, '202409090111', 2, 'ジャパンカップ', 2024, '東京', '芝2400', 6.5),
  S(2023, '202309090111', 1, 'ジャパンカップ', 2023, '東京', '芝2400', 4.1),
  // 前走「京都大賞典（京都 芝2400）」を2024年・2025年に
  S(2025, '202509090111', 3, '京都大賞典', 2025, '京都', '芝2400', 12.0),
  S(2024, '202409090111', 1, '京都大賞典', 2024, '京都', '芝2400', 9.9),
  // 1年しか出ていない前走（年別ボタンは付かないはず）
  S(2023, '202309090111', 5, '神戸新聞杯', 2023, '阪神', '芝2400', 20.0),
  S(2023, '202309090111', 6, '神戸新聞杯', 2023, '阪神', '芝2400', 30.0)
];

const tables = run('drComputeTables(' + JSON.stringify(samples) + ')');
const prevTables = tables.filter(x => /前走レース別/.test(x.title));

/* --- 1) 表は1枚だけ（年ごとの表は廃止） --- */
t('前走レース別の表は1枚だけ', prevTables.length === 1, prevTables.map(x => x.title).join(' / '));
t('タイトルが「年をまたいで合算」', prevTables.length === 1 && /年をまたいで合算/.test(prevTables[0].title), prevTables[0] && prevTables[0].title);
t('旧「年ごと」の表が無い', !tables.some(x => /年ごと/.test(x.title)), tables.filter(x => /年ごと/.test(x.title)).map(x => x.title).join('/'));
t('旧「年まとめ」の表が無い', !tables.some(x => /年まとめ/.test(x.title)));

/* --- 2) 同じレース名は1行に合算される --- */
const rows = prevTables[0].rows;
const jc = rows.filter(r => /ジャパンカップ/.test(r.label));
t('ジャパンカップは1行だけ', jc.length === 1, jc.length + '行: ' + jc.map(r => r.label).join(','));
t('ジャパンカップの出走数は年をまたいだ合計(4)', jc[0] && jc[0].g.n === 4, jc[0] && JSON.stringify(jc[0].g));
t('ジャパンカップの1着は合計(2)', jc[0] && jc[0].g.w === 2, jc[0] && jc[0].g.w);
const kt = rows.filter(r => /京都大賞典/.test(r.label));
t('京都大賞典も1行に合算(2走)', kt.length === 1 && kt[0].g.n === 2, JSON.stringify(kt.map(r => r.g)));

/* --- 3) 年別の内訳が行の中に入っている（新しい順） --- */
t('年別内訳がある', jc[0] && Array.isArray(jc[0].yearRows) && jc[0].yearRows.length === 3, JSON.stringify(jc[0] && jc[0].yearRows));
t('年別内訳は新しい順', jc[0] && jc[0].yearRows.map(y => y.y).join(',') === '2025,2024,2023', JSON.stringify(jc[0] && jc[0].yearRows.map(y => y.y)));
t('年別内訳の着順が集計されている', jc[0] && jc[0].yearRows[0].y === '2025' && jc[0].yearRows[0].n === 2 && jc[0].yearRows[0].w === 1,
  JSON.stringify(jc[0] && jc[0].yearRows[0]));
t('出現した年の一覧もある', jc[0] && jc[0].years && jc[0].years.join(',') === '2023,2024,2025', JSON.stringify(jc[0] && jc[0].years));

/* --- 4) 描画: 行内に「年別」ボタン＋隠し行（列は増えない） --- */
els['drOut'] = makeEl('drOut');
run('drRenderAll(' + JSON.stringify({ name:'有馬記念', rid:'202509090111', samples: samples, yearsUsed:3,
  racesUsed:[{year:2025},{year:2024},{year:2023}], excluded:[], errors:[], venueDiff:[], tables: tables }) + ')');
const html = String(els['drOut']._html || '');
t('描画に「年をまたいで合算」の表が出る', html.indexOf('年をまたいで合算') > 0);
t('描画に旧「年ごと」の表が出ない', html.indexOf('2頭以上・年ごと') < 0);
t('年別ボタンが出る（2年以上の行だけ）', (html.match(/data-drsub="drsub\d+"/g) || []).length === 2,
  JSON.stringify(html.match(/data-drsub="drsub\d+"/g)));
t('内訳は隠し行（display:none）', (html.match(/class="drsubrow" style="display:none"/g) || []).length === 2);
t('内訳行は colspan で列を増やさない', /colspan="9"/.test(html), (html.match(/colspan="\d+"/g) || []).slice(0,3).join(','));
t('内訳に年と着順が出る', /2025年<\/b> 2走/.test(html.replace(/<b>/g,'').replace(/<\/b>/g,'</b>')) || html.indexOf('2025年') > 0);
t('表のヘッダ列数は9のまま（区分〜単回収率）', (html.match(/<th/g) || []).length >= 9 && !/前走レース\(年まとめ\)/.test(html));

/* --- 5) 「年別」ボタンのクリックで開閉する --- */
run('initDr()');
const clickH = docListeners.filter(x => x.ev === 'click').map(x => x.fn);
t('document にクリック委任が配線されている', clickH.length > 0);
const sid = (html.match(/data-drsub="(drsub\d+)"/) || [])[1];
const rowEl = els[sid] || (els[sid] = makeEl(sid));
rowEl.style.display = 'none';
const ar = { textContent: '▸' };
const btnEl = { getAttribute: () => sid, querySelector: () => ar, classList: { add(){ this._open = true; }, remove(){ this._open = false; } } };
const ev = { preventDefault(){}, target: { closest: sel => (sel === '[data-drsub]' ? btnEl : null) } };
clickH.forEach(fn => fn(ev));
t('クリックで内訳行が開く', rowEl.style.display === '', rowEl.style.display);
t('クリックで矢印が▾になる', ar.textContent === '▾', ar.textContent);
clickH.forEach(fn => fn(ev));
t('もう一度クリックで閉じる', rowEl.style.display === 'none', rowEl.style.display);
t('閉じると矢印が▸に戻る', ar.textContent === '▸', ar.textContent);

console.log('prevrace : ' + (bad ? 'NG ' : 'OK ') + ok + ' PASS' + (bad ? ' / ' + bad + ' FAIL' : '') +
  '（前走レース別は年をまたいで1行に合算・年別内訳は行内で開閉）');
process.exit(bad ? 1 : 0);
