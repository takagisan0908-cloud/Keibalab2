/* 血統ファクター「10代まで深掘り(always_deep)」のテスト
   ・5代血統表の rowspan(完全2分木)から世代(1〜5代目)を復元できる
   ・5代目の祖先をたどって 6〜10代目まで名前が集まる（bfPedDeep）
   ・2回目以降はキャッシュだけから復元（追加通信ゼロ = bfDeepSet）
   ・マイニングは「単一=10代／2祖先の組=5代まで」
   ・表示は列を増やさず、6代目以降に .bfg.d バッジを付ける
   実行: node tests/peddeep.test.js */
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
const g = {
  console, Math, JSON, Date, String, Number, Array, Object, Error, Promise, Boolean, Set, Map,
  parseInt, parseFloat, isNaN, isFinite, RegExp, encodeURIComponent, decodeURIComponent,
  setTimeout, clearTimeout, setInterval(){ return 0; },
  localStorage:{ _d:{}, getItem(k){ return this._d[k]==null?null:this._d[k]; }, setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; } },
  document:{ getElementById(id){ if(!els[id]) els[id]=makeEl(id); return els[id]; },
    querySelector(){ return null; }, querySelectorAll(){ return []; }, createElement(){ return makeEl(); },
    addEventListener(){}, body:makeEl('body') },
  addEventListener(){}, navigator:{ userAgent:'test' },
  fetch(){ return Promise.reject(new Error('no network in test')); }
};
g.window = g; g.globalThis = g; g.self = g;
vm.createContext(g);
vm.runInContext(['p3_core','p31_bloodfactor','p36_datarace'].map(f => fs.readFileSync('src/' + f + '.js','utf8')).join('\n'), g, { filename:'deep.js' });
const el = id => { if (!els[id]) els[id] = makeEl(id); return els[id]; };
const run = code => vm.runInContext(code, g);
el('bfDeepCb').checked = true;   // HTMLの既定はON（10代まで掘る）

/* ===== 合成の5代血統表HTML（netkeibaと同じ rowspan 完全2分木・深さ優先順） ===== */
function treeCells(level, maxLevel, path, block){
  const rs = 16 / Math.pow(2, level);
  const out = [{ rs: rs, path: path, block: block, level: level }];
  if (level < maxLevel){
    return out.concat(treeCells(level + 1, maxLevel, path.concat([0]), block),
                      treeCells(level + 1, maxLevel, path.concat([1]), block));
  }
  return out;
}
let SEQ = 0;
const IDS = {};   // 名前 → id（同じ名前なら同じID＝血統の共有を表現）
function idFor(nm){ if (!IDS[nm]) IDS[nm] = '20' + String(100000 + (++SEQ)).slice(-8); return IDS[nm]; }
/* nameFn(block, path) → 名前。path=[0,1,0,…] で父父母…のように辿る */
function mkPedHtml(nameFn){
  const cells = treeCells(0, 4, [0], 0).concat(treeCells(0, 4, [1], 1));
  let h = '<table cellpadding="0" cellspacing="1" summary="5代血統表" class="blood_table detail"><tr>';
  cells.forEach(function(c, i){
    const nm = nameFn(c.block, c.path, c.level);
    const id = idFor(nm);
    h += '<td width="20%" rowspan="' + c.rs + '" class="' + (i % 2 ? 'b_fml' : 'b_ml') + '">' +
      '<div class="parent"><div><a href="https://db.netkeiba.com/horse/' + id + '/">' + nm + ' </a>' +
      '<br />2000 鹿毛 <br />[<a href="https://db.netkeiba.com/horse/ped/' + id + '/">血統</a>]</div></div></td>';
  });
  return h + '</tr></table>';
}
const PAGES = {};   // id → html
g.PAGES = PAGES;
run('var GETS = 0, GETLOG = [];' +
    'bfGet = function(url){ GETS++; GETLOG.push(url);' +
    '  var id = (url.match(/horse\\/ped\\/([0-9a-z]+)\\//) || [])[1] || "";' +
    '  if (!PAGES[id]) return Promise.reject(new Error("no page " + id));' +
    '  return Promise.resolve(PAGES[id]); };');
const gets = () => run('GETS');
const resetGets = () => run('GETS = 0; GETLOG = [];');

/* ---------- 1. 実物の5代血統表フィクスチャで世代復元 ---------- */
const real = fs.readFileSync('tests/fixtures/ped5.utf8.html', 'utf8');
g.__real = real;
const p = run('bfParsePed(__real)');
g.__p = p;
t('実フィクスチャ: 62セル', p.count === 62, p.count);
t('実フィクスチャ: 5代目の祖先ID(重複除く)が入る', p.g5.length >= 30 && p.g5.length <= 32, p.g5.length);
const dist = {};
Object.keys(p.gen).forEach(k => { dist[p.gen[k]] = (dist[p.gen[k]] || 0) + 1; });
t('世代分布 1代=2(父/母)', dist[1] === 2, JSON.stringify(dist));
t('世代分布 2代=4', dist[2] === 4, JSON.stringify(dist));
t('世代分布 3代=8', dist[3] === 8, JSON.stringify(dist));
t('世代分布 4代=16(重複込みで15名)', dist[4] === 15 || dist[4] === 16, JSON.stringify(dist));
t('世代分布 5代=32(重複込みで30名)', dist[5] === 30 || dist[5] === 32, JSON.stringify(dist));
t('6代目以降は混ざらない', !Object.keys(p.gen).some(k => p.gen[k] > 5));
t('父=1代目(リアルスティール)', p.gen[run('bfNormName("リアルスティール")')] === 1, p.gen['リアルスティール']);
t('母=1代目(テイコフトウショウ)', p.gen['テイコフトウショウ'] === 1, p.gen['テイコフトウショウ']);
t('ディープインパクト=2代目', p.gen['ディープインパクト'] === 2, p.gen['ディープインパクト']);
t('サンデーサイレンス=3代目', p.gen['サンデーサイレンス'] === 3, p.gen['サンデーサイレンス']);
t('halo=4代目', p.gen['halo'] === 4, p.gen['halo']);
t('hail to reason=5代目', p.gen['hail to reason'] === 5, p.gen['hail to reason']);
t('パース結果にv=3(世代+系統つき)', p.v === run('BF_PED_V') && p.v === 3, p.v);
/* 系統（父系/母系/母父系/母母系）の実データ検証:
   このフィクスチャは 父=リアルスティール / 母=テイコフトウショウ、
   父父=ディープインパクト / 父母=ラヴズオンリーミー、母父=タイキシャトル / 母母=マロトウショウ */
t('父=「父」', run('bfLineLabel(__p.ln["リアルスティール"])') === '父', p.ln['リアルスティール']);
t('母=「母」', run('bfLineLabel(__p.ln["テイコフトウショウ"])') === '母', p.ln['テイコフトウショウ']);
t('父父=ディープインパクト→父父系', run('bfLineLabel(__p.ln["ディープインパクト"])') === '父父系', p.ln['ディープインパクト']);
t('父母=ラヴズオンリーミー→父母系', run('bfLineLabel(__p.ln["ラヴズオンリーミー"])') === '父母系', p.ln['ラヴズオンリーミー']);
t('母父=タイキシャトル→母父系', run('bfLineLabel(__p.ln["タイキシャトル"])') === '母父系', p.ln['タイキシャトル']);
t('母母=マロトウショウ→母母系', run('bfLineLabel(__p.ln["マロトウショウ"])') === '母母系', p.ln['マロトウショウ']);
t('父系のみの5代目(understanding)→父父系', run('bfLineLabel(__p.ln["understanding"])') === '父父系', p.ln['understanding']);
t('父母両方に出る5代目(hail to reason)→父母両系', run('bfLineLabel(__p.ln["hail to reason"])') === '父母両系', p.ln['hail to reason']);
t('母系の5代目(ダンディルート)→母母系', run('bfLineLabel(__p.ln["ダンディルート"])') === '母母系', p.ln['ダンディルート']);
t('5代目の祖先に系統コード(g5l)が付く', p.g5.length > 0 && p.g5.every(id => !!p.g5l[id]), JSON.stringify(p.g5l).slice(0, 60));
t('系統コードは ss/sd/ds/dd のどれか', Object.keys(p.ln).every(k => String(p.ln[k]).split('|').every(c => ['s','d','ss','sd','ds','dd'].indexOf(c) >= 0)));

/* ---------- 2. 合成血統で 10代まで掘る ---------- */
/* 3頭の対象馬。それぞれ 父系/母系 の名前を変えるが、
   「5代目の祖先 DEEP5_x」だけは3頭で共有 → その先の DEEP_SHARED(=8代目) が
   3年ぶん溜まってファクターになる、というシナリオ。 */
function buildHorse(tag, year){
  // 対象馬の5代血統表: level0=父/母, level4=5代目
  const html = mkPedHtml(function(block, path, level){
    if (level === 4) return 'DEEP5_' + tag + '_' + block + '_' + path.join('');  // 5代目(共有祖先の入口)
    // 父系の1〜3代目は3頭で共有 → 5代以内の「組」ファクターも出るようにする
    if (block === 0 && path.length <= 3) return 'SHALLOW_' + path.join('');
    return 'ANC_' + tag + '_' + block + '_' + path.join('');
  });
  const id = idFor('HORSE_' + tag);
  PAGES[id] = html;
  return { tag: tag, year: year, id: id };
}
/* 5代目祖先のページ: その馬の5代血統表 = 対象馬から見て 6〜10代目 */
function buildAncestorPages(sharedName){
  Object.keys(IDS).filter(k => k.indexOf('DEEP5_') === 0).forEach(function(nm){
    if (PAGES[IDS[nm]]) return;
    const html = mkPedHtml(function(block, path, level){
      // 6代目(level1) の1頭に「共有の深い祖先」を置く → 対象馬からは 5+3 = 8代目
      if (level === 2 && block === 0 && path.join('') === '000') return sharedName;
      return 'X_' + nm + '_' + block + '_' + path.join('');
    });
    PAGES[IDS[nm]] = html;
  });
}
const horses = [buildHorse('A', 2021), buildHorse('B', 2022), buildHorse('C', 2023)];
buildAncestorPages('DEEP_SHARED');
g.SHARED = run('bfNormName("DEEP_SHARED")');
const SHARED = g.SHARED;

/* 対象馬Aの5代目祖先IDを控えて、祖先ページが全部そろうことを確認 */
const baseA = run('bfParsePed(PAGES["' + horses[0].id + '"])');
t('合成: 5代目の祖先ID=32', baseA.g5.length === 32, baseA.g5.length);
t('合成: 祖先ページが用意できた', baseA.g5.every(id => !!PAGES[id]));

resetGets();
run('BF_DEEP_MEM = {}; BF_DEEP_STAT = { req:0, hit:0, miss:0 }; localStorage._d = {};');
let deepA = null;
run('bfPedDeep("' + horses[0].id + '", { deep: true }).then(function(r){ __R = r; })');
setTimeout(function(){
  deepA = run('__R');
  t('bfPedDeep: 結果が返る', !!deepA && !!deepA.names);
  const gens = deepA.gen || {};
  const d = {};
  Object.keys(gens).forEach(k => { d[gens[k]] = (d[gens[k]] || 0) + 1; });
  t('10代目までの世代が入る', Object.keys(d).some(k => +k >= 10), JSON.stringify(d));
  t('6代目以降の名前が増えている', Object.keys(deepA.names).length > Object.keys(baseA.names).length,
    Object.keys(deepA.names).length + ' vs ' + Object.keys(baseA.names).length);
  t('n5(5代まで)は元の5代と一致', Object.keys(deepA.n5).length === Object.keys(baseA.names).length);
  t('共有の深い祖先が入る(8代目)', gens[SHARED] === 8, gens[SHARED]);
  t('5代目までの名前は n5 にもある', deepA.n5[Object.keys(baseA.names)[0]] != null);
  t('祖先ページを取得した(32件前後)', gets() >= 30 && gets() <= 34, gets());

  /* --- 3. 2回目はキャッシュのみ（通信ゼロ） --- */
  resetGets();
  run('BF_DEEP_MEM = {};');
  run('bfDeepSet("' + horses[0].id + '")');
  const sync = run('bfDeepSet("' + horses[0].id + '")');
  t('bfDeepSet: 同期で10代セットを復元', !!sync && sync.gen && sync.gen[SHARED] === 8, sync && sync.gen && sync.gen[SHARED]);
  t('bfDeepSet: 追加通信ゼロ', gets() === 0, gets());

  /* --- 4. deep OFF なら5代まで・祖先を取りに行かない --- */
  resetGets();
  run('BF_DEEP_MEM = {};');
  el('bfDeepCb').checked = false;
  run('bfPedDeep("' + horses[1].id + '", {}).then(function(r){ __R2 = r; })');
  setTimeout(function(){
    const shallow = run('__R2');
    t('deep OFF: 5代まで', shallow && !shallow.gen[SHARED], shallow && shallow.gen && shallow.gen[SHARED]);
    t('deep OFF: 祖先ページを取りに行かない(1件=本体のみ)', gets() === 1, gets());
    t('deep OFF: n5=names', shallow && Object.keys(shallow.n5).length === Object.keys(shallow.names).length);
    el('bfDeepCb').checked = true;

    /* --- 5. bfMine: 表は5代まで（6代目以降は出さない） --- */
    run('BF_DEEP_MEM = {}; localStorage._d = {};');
    const jobs = horses.map(h => 'bfPedDeep("' + h.id + '", { deep: true })');
    run('var __RS=null; Promise.all([' + jobs.join(',') + ']).then(function(rs){ __RS = rs; })');
    setTimeout(function(){
      const peds = run('__RS');
      t('3頭ぶん取得できた', Array.isArray(peds) && peds.length === 3 && peds.every(x => x && x.names));
      t('10代まで名前が入っている', peds.every(p => Object.keys(p.names).length > 500), peds.map(p => Object.keys(p.names).length).join(','));
      t('系統コード(ln)が入っている', peds.every(p => p.ln && Object.keys(p.ln).length > 500));
      const entries = peds.map((ped, i) => ({ year: horses[i].year, win: ped, board: [ped] }));
      g.__E = entries;
      const factors = run('bfMine(__E)');
      const S = factors.filter(f => f.type === 'S');
      const P = factors.filter(f => f.type === 'P');
      t('表に6代目以降は出ない(全てgen<=5)', factors.every(f => !f.gen || f.gen <= 5), JSON.stringify(factors.slice(0, 3).map(f => [f.names[0], f.gen])));
      t('深い共有祖先(8代目)は表に出ない', !S.some(f => f.names[0] === SHARED));
      t('5代以内の単一ファクターは出る', S.length > 0, S.length);
      t('組ファクターも5代まで', P.length > 0 && P.every(f => f.names.every(n => n !== SHARED)), P.length);

      /* --- 5b. bfDeepCommon: 6代目以降の共通点だけ（系統つき） --- */
      const fake = [
        // 4年ぶんの「勝ち馬」。universal は全頭が持つ基礎血統 → 他に候補があれば除外される
        { names:{universal:1,greysovereign:1,boldruler:1,stormbird:1,rare:1,sunday:1},
          gen:{universal:9,greysovereign:8,boldruler:7,stormbird:6,rare:10,sunday:3},
          ln:{universal:'ss',greysovereign:'ds|dd',boldruler:'dd',stormbird:'ds',rare:'sd',sunday:'ss'}, n5:{sunday:1} },
        { names:{universal:1,greysovereign:1,boldruler:1,stormbird:1,sunday:1},
          gen:{universal:9,greysovereign:8,boldruler:7,stormbird:6,sunday:3},
          ln:{universal:'ss',greysovereign:'ds|dd',boldruler:'dd',stormbird:'ds',sunday:'ss'}, n5:{sunday:1} },
        { names:{universal:1,greysovereign:1,boldruler:1,sunday:1},
          gen:{universal:9,greysovereign:8,boldruler:7,sunday:3},
          ln:{universal:'ss',greysovereign:'dd',boldruler:'dd',sunday:'ss'}, n5:{sunday:1} },
        { names:{universal:1,sunday:1}, gen:{universal:9,sunday:3}, ln:{universal:'ss',sunday:'ss'}, n5:{sunday:1} }
      ];
      g.__E2 = fake.map((p, i) => ({ year: 2020 + i, win: p, board: [p] }));
      const dc = run('bfDeepCommon(__E2)');
      const names = dc.win.items.map(x => x.name);
      t('勝ち馬の共通点が出る', dc.win.items.length >= 3, JSON.stringify(names));
      t('4点までに絞られる', dc.win.items.length <= 4, dc.win.items.length);
      t('該当頭数の多い順', names[0] === 'greysovereign' || names[0] === 'boldruler', JSON.stringify(names));
      t('100%の基礎血統は除外される', names.indexOf('universal') < 0, JSON.stringify(names));
      t('5代以内(sunday)は共通点に入らない', names.indexOf('sunday') < 0);
      t('1頭だけの希少な血統は入らない', names.indexOf('rare') < 0);
      const gs = dc.win.items.filter(x => x.name === 'greysovereign')[0];
      t('母系ラベル(ds|dd → 母系)', gs && gs.line === '母系', gs && gs.line);
      t('該当数/母数/世代が入る', gs && gs.n === 3 && gs.total === 4 && gs.gen === 8, gs && JSON.stringify(gs));
      const sb = dc.win.items.filter(x => x.name === 'stormbird')[0];
      t('母父系ラベル(ds → 母父系)', sb && sb.line === '母父系', sb && sb.line);
      t('3着内も同じ形', dc.board && Array.isArray(dc.board.items) && dc.board.total === 4, dc.board && dc.board.total);
      t('deep フラグ', dc.deep === true);

      /* 9割以上が持つ基礎血統は、他に候補があれば除外される */
      const many = [];
      for (let i = 0; i < 10; i++){
        const nm = { a1:1, a2:1, a3:1, a4:1, near:1, s5:1 };
        const gn = { a1:8, a2:8, a3:9, a4:7, near:7, s5:4 };
        const ln = { a1:'ds', a2:'dd', a3:'ss', a4:'ds|dd', near:'ss', s5:'ss' };
        if (i >= 7) delete nm.a1;
        if (i >= 6) delete nm.a2;
        if (i >= 5) delete nm.a3;
        if (i >= 4) delete nm.a4;
        if (i === 9) delete nm.near;             // near = 9/10頭(90%)
        many.push({ year: 2010 + i, win: { names: nm, gen: gn, ln: ln, n5: { s5: 1 } },
                    board: [{ names: nm, gen: gn, ln: ln, n5: { s5: 1 } }] });
      }
      g.__E3 = many;
      const dc3 = run('bfDeepCommon(__E3)');
      const n3 = dc3.win.items.map(x => x.name);
      t('9割以上の基礎血統(near 9/10)は除外', n3.indexOf('near') < 0, JSON.stringify(n3));
      t('該当の多い順に4点まで', JSON.stringify(n3) === JSON.stringify(['a1','a2','a3','a4']), JSON.stringify(n3));
      t('5代以内(s5)は出ない', n3.indexOf('s5') < 0);

      /* 実データの3頭でも共通点が出る（8代目の共有祖先） */
      const dc2 = run('bfDeepCommon(__E)');
      const shared2 = dc2.win.items.filter(x => x.name === SHARED)[0];
      t('実データ: 8代目の共有祖先が共通点に出る', !!shared2, JSON.stringify(dc2.win.items.map(x => x.name)).slice(0, 90));
      t('実データ: 3/3頭・8代目', shared2 && shared2.n === 3 && shared2.total === 3 && shared2.gen === 8, shared2 && JSON.stringify(shared2));
      t('実データ: 系統ラベルが付く', shared2 && ['母系','母父系','母母系','父系','父父系','父母系','父母両系','父','母'].indexOf(shared2.line) >= 0, shared2 && shared2.line);
      t('実データ: 5代以内の名前は出ない', dc2.win.items.every(x => x.gen >= 6));

      /* --- 6. 表示: 5代の表は従来通り／深い共通点は別ブロック --- */
      g.__F = factors;
      run('var ls = bfLs(); ls.last = { rid:"202601010111", name:"テスト重賞", years:[{year:2021}], factors: __F, deepCommon: bfDeepCommon(__E) }; ls.set = { on:{}, apply:false, deep:true }; bfSave(ls); bfRender(); bfRenderDeep();');
      const html = el('bfList')._html;
      t('表の見出しは5代', html.indexOf('血統表5代に内包する祖先') >= 0);
      t('表に6代以上のバッジは出ない', !/class="bfg d"/.test(html), (html.match(/bfg[^>]*>\d+代/g) || []).slice(0, 3).join('|'));
      t('列数は5のまま(th)', (html.match(/<th[ >]/g) || []).length === 5, (html.match(/<th[ >]/g) || []).length);
      const dh = el('bfDeepOut')._html;
      t('共通点ブロックが出る', dh.indexOf('bfdeep') >= 0 && dh.indexOf('10代血統の共通点') >= 0, dh.slice(0, 60));
      t('勝ち馬の共通点(見出し)', dh.indexOf('勝ち馬の共通点') >= 0);
      t('3着内の共通点(見出し)', dh.indexOf('3着内の共通点') >= 0);
      t('「◯◯系に … を内包」の表記', /(母系|母父系|母母系|父系|父父系|父母系|父母両系|父|母)に <b>/.test(dh), dh.replace(/<[^>]+>/g, ' ').slice(0, 120));
      t('「N/M頭に該当・X代目」の表記', /\d+\/\d+頭に該当・\d+代目/.test(dh));
      t('文章の共通点(・◯◯系に 〜 を内包)は従来通り残る', dh.indexOf('を内包') >= 0);
      t('内訳表が出る(📋 共通点の内訳)', dh.indexOf('共通点の内訳') >= 0, dh.replace(/<[^>]+>/g,' ').slice(0, 120));
      /* ★2026-09-13 第19弾④: 「1〜3番人気」と「人気馬比リフト」の2列を追加したため 7 → 9 列 */
      t('内訳表の列は9', (dh.match(/<th[ >]/g) || []).length === 9, (dh.match(/<th[ >]/g) || []).length);
      t('内訳表に人気馬比リフト列がある', dh.indexOf('人気馬比') >= 0);
      t('未取得の馬名は案内になる', dh.indexOf('もう一度押すと馬名まで出ます') >= 0);
      t('旧 上位5件カードの関数は廃止', run('typeof bfTopTable') === 'undefined' && run('typeof bfTopRun') === 'undefined');
      /* --- 6b. 今回の出走馬 × 10代共通点 の該当検出 --- */
      g.__HS = [
        { no:'3', name:'テスト三', nk:'h3', odds:'1.2' },
        { no:'1', name:'テスト一', nk:'h1', odds:'8.4' },
        { no:'2', name:'テスト二', nk:'h2', odds:'4.5' },
        { no:'4', name:'テスト四(未取得)', nk:'h4', odds:'20.0' }
      ];
      run([
        'state.horses = __HS;',
        'var ls = bfLs();',
        'ls.ped["h1"] = { names:{deep_a:1,deep_b:1,deep_c:1,s5:1}, gen:{deep_a:7,deep_b:9,deep_c:6,s5:3},',
        '  ln:{deep_a:"ds",deep_b:"ss",deep_c:"ds|dd"}, g5:["anc1"], count:4, v:BF_PED_V,',
        '  disp:{deep_a:"Deep A",deep_b:"Deep B",deep_c:"Deep C"} };',
        'ls.ped["h2"] = { names:{deep_b:1,deep_c:1,s5:1}, gen:{deep_b:9,deep_c:6,s5:3}, ln:{deep_b:"ss",deep_c:"ds|dd"}, g5:[], count:3, v:BF_PED_V, disp:{deep_b:"Deep B",deep_c:"Deep C"} };',
        'ls.ped["h3"] = { names:{deep_c:1,s5:1}, gen:{deep_c:6,s5:3}, ln:{deep_c:"ds|dd"}, g5:[], count:2, v:BF_PED_V, disp:{deep_c:"Deep C"} };',
        'ls.ped["anc1"] = { g:{deep_a:2}, disp:{}, count:1, v:BF_PED_V, lite:1 };',
        'ls.last.deepCommon = { deep:true, at:"", win:{ total:5, items:[',
        '   {name:"deep_a",n:4,total:5,gen:7,line:"母父系"},{name:"deep_b",n:3,total:5,gen:9,line:"父父系"} ] },',
        '  board:{ total:9, items:[ {name:"deep_c",n:8,total:9,gen:6,line:"母系"} ] } };',
        'bfSave(ls); BF_DEEP_MEM = {};'
      ].join('\n'));
      resetGets();
      const sc = run('bfDeepHitScan()');
      t('該当検出: 3頭ぶん照合(未取得は除く)', sc && sc.have === 3 && sc.total === 4, sc && (sc.have + '/' + sc.total));
      t('該当検出: 3頭とも何かしら該当', sc && sc.hitN === 3, sc && sc.hitN);
      t('該当検出: 勝ち馬2点・3着内1点', sc && sc.wN === 2 && sc.bN === 1, sc && (sc.wN + '/' + sc.bN));
      t('該当検出: 該当が多い順(テスト一→二→三)', sc && sc.rows.map(r => r.h.name).join(',') === 'テスト一,テスト二,テスト三', sc && sc.rows.map(r => r.h.name).join(','));
      t('該当検出: テスト一は勝ち馬2/2・3着内1/1', sc && sc.rows[0].w.length === 2 && sc.rows[0].b.length === 1);
      t('該当検出: テスト二は deep_b + deep_c', sc && sc.rows[1].w.length === 1 && sc.rows[1].b.length === 1, sc && JSON.stringify([sc.rows[1].w.length, sc.rows[1].b.length]));
      run('var __SC0 = bfDeepHitScan().rows[0], __SC1 = bfDeepHitScan().rows[1], __SC2 = bfDeepHitScan().rows[2];');
      t('判定: 差がつく項目に全部該当=強', run('bfHitRank(__SC0, 2).txt') === '強', run('bfHitRank(__SC0, 2).txt'));
      t('判定: 差がつく項目の半分(0.5)=弱', run('bfHitRank(__SC1, 2).txt') === '弱', run('bfHitRank(__SC1, 2).txt'));
      t('判定しきい値: 0.9=強 / 0.6=中 / 0.5=弱 / 0=−', run('bfHitRank({rate:0.9},2).txt') === '強' && run('bfHitRank({rate:0.6},2).txt') === '中' && run('bfHitRank({rate:0.5},2).txt') === '弱' && run('bfHitRank({rate:0},2).txt') === '−');
      t('判定: 該当なし=−', run('bfHitRank(__SC2, 2).txt') === '−', run('bfHitRank(__SC2, 2).txt'));
      t('該当検出: 通信ゼロ(キャッシュだけ)', gets() === 0, gets());
      /* deep_a は テスト一 しか持たない=差がつく／deep_c は3頭全員=差がつかない(9割以上) */
      t('差がつく項目: 勝ち馬2点(deep_a/deep_b)', sc.wU.length === 2 && sc.wU.map(x => x.name).join(',') === 'deep_a,deep_b', JSON.stringify(sc.wU.map(x => x.name)));
      t('差がつく項目: 3着内0点(deep_cは全員が持つ)', sc.bU.length === 0, JSON.stringify(sc.bU.map(x => x.name)));
      t('全員が持つ項目は univ に入る(deep_c)', sc.univ.length === 1 && sc.univ[0].name === 'deep_c', JSON.stringify(sc.univ.map(x => x.name)));
      t('項目ごとの出走馬該当数(fieldCnt)', sc.fieldCnt.deep_a === 1 && sc.fieldCnt.deep_b === 2 && sc.fieldCnt.deep_c === 3, JSON.stringify(sc.fieldCnt));
      t('差がつく項目の点数(den=2)', sc.den === 2, sc.den);
      t('該当率: 強1.0 / 中0.5 / −0', sc.rows.map(r => r.rate).join(',') === '1,0.5,0', sc.rows.map(r => r.rate).join(','));
      t('該当率順に並ぶ(テスト一が先頭)', sc.rows[0].h.name === 'テスト一', sc.rows.map(r => r.h.name).join(','));
      run('bfRenderDeepHit();');
      const hh = el('bfDeepHit')._html;
      t('該当表が出る', hh.indexOf('bfhit') >= 0 && hh.indexOf('今回の出走馬の該当検出') >= 0, hh.slice(0, 60));
      t('表に馬名が該当順で並ぶ', hh.indexOf('テスト一') >= 0 && hh.indexOf('テスト一') < hh.indexOf('テスト二'), '');
      t('「母父系に Deep A」の表記', /母父系に <b>Deep A<\/b>/.test(hh), hh.replace(/<[^>]+>/g,' ').slice(0, 200));
      t('世代と勝ち馬/3着内の区別', hh.indexOf('7代目・勝ち馬') >= 0 && hh.indexOf('6代目・3着内') >= 0);
      t('判定バッジ(強)', /class="bfhg bfh3">強</.test(hh));
      t('未取得の頭数を案内', hh.indexOf('未取得 1頭') >= 0, hh.replace(/<[^>]+>/g,' ').slice(-160));
      t('該当表の列は8(差がつく項目の列を追加)', (hh.match(/<th[ >]/g) || []).length === 8, (hh.match(/<th[ >]/g) || []).length);
      t('全員が持つ項目は薄いチップ(全員)', /bfhitnm all/.test(hh) && hh.indexOf('6代目・3着内・全員') >= 0, hh.replace(/<[^>]+>/g,' ').slice(0, 220));
      t('差がつく項目チップに頭数(1/3頭)', hh.indexOf('7代目・勝ち馬・1/3頭') >= 0, hh.replace(/<[^>]+>/g,' ').slice(0, 200));
      t('各馬のチップは3頭とも deep_c を持つので計4回(3行+注記)', (hh.match(/Deep C/g) || []).length === 4, (hh.match(/Deep C/g) || []).length);
      /* 同じ名前が勝ち馬/3着内の両方に出たときは1チップにまとまる */
      run('var __SCM = { wU:[], bU:[{name:"deep_a",line:"母父系",gen:7,n:4,total:5,txt:""}], univ:[], fieldCnt:{deep_a:1}, have:3 };');
      run('var __HIM = bfHitItemsHtml({ w:[{name:"deep_a",line:"母父系",gen:7,n:4,total:5}], b:[{name:"deep_a",line:"母父系",gen:7,n:4,total:5}] }, __SCM);');
      t('同名の勝ち馬/3着内は1チップにまとまる(Deep A が1回)', (run('__HIM').match(/Deep A/g) || []).length === 1, run('__HIM').replace(/<[^>]+>/g,' '));
      t('まとめたチップは「勝ち馬・3着内・1/3頭」', run('__HIM').indexOf('7代目・勝ち馬・3着内・1/3頭') >= 0, run('__HIM').replace(/<[^>]+>/g,' '));
      t('見出しに「差がつく項目 2点」', hh.indexOf('差がつく項目 2点') >= 0);
      t('注記に除外した項目名', hh.indexOf('Deep C') >= 0 && hh.indexOf('9割以上が持つ項目') >= 0);
      /* --- 6c. 勝ち馬/3着内に同名の項目があるときの数え方 --- */
      run([
        'ls.ped["h1"].names.deep_b = 1; ls.ped["h1"].gen.deep_b = 9;',
        'ls.last.deepCommon = { deep:true, at:"", win:{ total:5, items:[',
        '   {name:"deep_a",n:4,total:5,gen:7,line:"母父系"} ] },',
        '  board:{ total:9, items:[ {name:"deep_a",n:6,total:9,gen:6,line:"母系"}, {name:"deep_c",n:8,total:9,gen:6,line:"母系"} ] } };',
        'bfSave(ls); BF_DEEP_MEM = {};'
      ].join('\n'));
      const sc2 = run('bfDeepHitScan()');
      t('同名が勝ち馬/3着内の両方にあっても fieldCnt は頭数(1頭なら1)', sc2.fieldCnt.deep_a === 1, JSON.stringify(sc2.fieldCnt));
      t('全員持ち(deep_c)は univ・deep_a は差がつく', sc2.univ.map(x => x.name).join(',') === 'deep_a,deep_c' ? false : (sc2.univ.map(x => x.name).join(',') === 'deep_c' && sc2.wU.length === 1 && sc2.bU.length === 1), JSON.stringify([sc2.univ.map(x => x.name), sc2.wU.map(x => x.name), sc2.bU.map(x => x.name)]));
      run('bfRenderDeepHit();');
      const hh2 = el('bfDeepHit')._html;
      t('同名は勝ち馬・3着内の1チップにまとまる', hh2.indexOf('・勝ち馬・3着内・1/3頭') >= 0, hh2.replace(/<[^>]+>/g,' ').slice(0, 240));
      /* --- 6d. 全項目が全員持ち（差がつく項目0点）のとき --- */
      run([
        'ls.last.deepCommon = { deep:true, at:"", win:{ total:5, items:[',
        '   {name:"deep_c",n:5,total:5,gen:6,line:"母系"} ] }, board:{ total:9, items:[] } };',
        'bfSave(ls); BF_DEEP_MEM = {};'
      ].join('\n'));
      const sc3 = run('bfDeepHitScan()');
      t('全員持ちだけなら den=0・univ=1', sc3.den === 0 && sc3.univ.length === 1, JSON.stringify([sc3.den, sc3.univ.length]));
      t('den=0 でも該当率(フォールバック)は付く', sc3.rows[0].rate > 0, sc3.rows.map(r => r.rate).join(','));
      run('bfRenderDeepHit();');
      const hh3 = el('bfDeepHit')._html;
      t('見出しに「差がつきません」の警告', hh3.indexOf('全頭が持つ項目だけ＝差がつきません') >= 0);
      t('差がつく項目の列は 0/0 ではなく −', hh3.indexOf('/0<') < 0 && hh3.indexOf('muted">−</span></td>') >= 0, hh3.replace(/<[^>]+>/g,' ').slice(0, 200));
      /* --- 6e. 10代共通点の内訳（系統・代・勝ち馬/3着内・今日の出走馬・該当した馬名） --- */
      const meta = [];
      for (let i = 0; i < 5; i++){
        const nm = { shared:1, other:1, s5:1 }, gn = { shared:8, other:7, s5:4 }, ln = { shared:'ds', other:'dd', s5:'ss' };
        if (i === 4) delete nm.other;
        const w = { names:nm, gen:gn, ln:ln, n5:{s5:1}, nm:'勝馬' + (2021 + i), yr:2021 + i, od:'1' };
        const b3 = { names:nm, gen:gn, ln:ln, n5:{s5:1}, nm:'三着馬' + (2021 + i), yr:2021 + i, od:'3' };
        meta.push({ year:2021 + i, win:w, board:[w, b3] });
      }
      g.__E4 = meta;
      const dc4 = run('bfDeepCommon(__E4)');
      const sh = dc4.win.items.filter(x => x.name === 'shared')[0];
      t('共通点に該当馬の内訳(hits)が入る', !!sh && Array.isArray(sh.hits) && sh.hits.length === 5, sh && JSON.stringify(sh.hits));
      t('hits は年の新しい順・着順つき', sh && sh.hits[0].yr === 2025 && sh.hits[0].nm === '勝馬2025' && sh.hits[0].o === '1',
        sh && JSON.stringify(sh.hits[0]));
      const shb = dc4.board.items.filter(x => x.name === 'shared')[0];
      t('3着内の hits は1〜3着あわせて10件', shb && shb.hits.length === 10, shb && shb.hits.length);
      t('3着内 hits の先頭は1着(同じ年なら着順が先)', shb && shb.hits[0].o === '1' && shb.hits[0].nm === '勝馬2025',
        shb && JSON.stringify(shb.hits[0]));
      run(['var ls = bfLs();',
        'ls.last = { rid:"202601010111", name:"テスト重賞", years:[], factors:[], deepCommon: bfDeepCommon(__E4) };',
        'ls.set = { on:{}, apply:false, deep:true }; state.horses = []; bfSave(ls); BF_DEEP_MEM = {};',
        'bfRenderDeep();'].join('\n'));
      const dh4 = el('bfDeepOut')._html;
      const tx4 = dh4.replace(/<[^>]+>/g, ' ');
      t('文章の要約(📝)が出る', dh4.indexOf('bfsent') >= 0 && tx4.indexOf('勝ち馬') >= 0 && tx4.indexOf('頭のうち') >= 0, tx4.slice(0, 160));
      t('内訳表に系統と代', tx4.indexOf('母父系') >= 0 && tx4.indexOf('8代目') >= 0, tx4.slice(0, 200));
      t('内訳表に該当した馬(年・着順・馬名)', tx4.indexOf('2025年1着 勝馬2025') >= 0, tx4.slice(0, 260));
      t('4頭以上は details で折りたたむ', dh4.indexOf('bfmore') >= 0 && /ほか\d+頭/.test(tx4), tx4.slice(0, 260));
      t('勝ち馬/3着内の該当頭数が両方出る', tx4.indexOf('5/5頭') >= 0 && tx4.indexOf('10/10頭') >= 0, tx4.slice(0, 260));
      t('出走馬未取得のときは「未取得」', tx4.indexOf('未取得') >= 0);
      /* 今日の出走馬ぶんを照合した状態 */
      run(['ls.ped["t1"] = { names:{shared:1}, gen:{shared:8}, ln:{shared:"ds"}, g5:[], count:1, v:BF_PED_V, disp:{shared:"Shared"} };',
        'ls.ped["t2"] = { names:{}, gen:{}, ln:{}, g5:[], count:0, v:BF_PED_V, disp:{} };',
        'state.horses = [{ no:"1", name:"今走一", nk:"t1" }, { no:"2", name:"今走二", nk:"t2" }];',
        'bfSave(ls); BF_DEEP_MEM = {}; bfRenderDeep(); bfRenderDeepHit();'].join('\n'));
      const tx5 = el('bfDeepOut')._html.replace(/<[^>]+>/g, ' ');
      t('内訳表に今日の出走馬の該当頭数(1/2頭)', tx5.indexOf('1 /2頭') >= 0 || tx5.indexOf('1/2頭') >= 0, tx5.slice(0, 300));
      t('差がつく/全員の区別が出る', tx5.indexOf('差がつく') >= 0, tx5.slice(0, 300));
      t('文章に今日の出走馬の照合結果', tx5.indexOf('今日の出走馬') >= 0 && tx5.indexOf('差がつく項目は') >= 0, tx5.slice(0, 240));
      /* --- ボタンは1本に統合（📥 今日の出走馬の血統を取得 / 🔍 予備 は廃止） --- */
      const body = require('fs').readFileSync('src/p2_body.html', 'utf8');
      t('HTMLに bfTodayBtn が無い', body.indexOf('bfTodayBtn') < 0);
      t('HTMLに bfBtn(予備) が無い', body.indexOf('id="bfBtn"') < 0);
      t('抽出ボタンは1本だけ', (body.match(/id="bfDrBtn"/g) || []).length === 1);
      t('ボタン名に「これ1本で全部」', body.indexOf('血統を抽出して今回の出走馬を検出（これ1本で全部）') >= 0);
      t('予備経路 bfAnalyze は廃止', run('typeof bfAnalyze') === 'undefined', run('typeof bfAnalyze'));
      t('bfAnalyzeFromDr は残る', run('typeof bfAnalyzeFromDr') === 'function');

      /* 10代まで揃っている出走馬は取り直さない */
      run('state.horses = [{ no:"1", name:"テスト一", nk:"h1" }]; BF_DEEP_MEM = {};');
      resetGets();
      run('var __ET = -1; bfEnsureToday(function(){}).then(function(n){ __ET = n; });');
      setTimeout(function(){
        t('10代が揃っていれば取得しない(通信0)', gets() === 0, gets());

      const liteInfo = run('(function(){ var ls = bfLs(); var k = Object.keys(ls.ped).filter(function(x){ return ls.ped[x] && ls.ped[x].lite; }); return { n: k.length, keys: k.length ? Object.keys(ls.ped[k[0]]) : [] }; })()');
      t('祖先キャッシュは lite(世代gのみ・males等を落とす)', liteInfo.n >= 30 && liteInfo.keys.indexOf('g') >= 0 && liteInfo.keys.indexOf('males') < 0, JSON.stringify(liteInfo));

      /* --- 7. 深掘り予算 --- */
      resetGets();
      run('BF_DEEP_MEM = {}; localStorage._d = {}; BF_DEEP_BUDGET = 5; BF_DEEP_STAT = { req:0, hit:0, miss:0 };');
      run('bfPedDeep("' + horses[2].id + '", { deep: true }).then(function(r){ __R3 = r; })');
      setTimeout(function(){
        const part = run('__R3');
        t('予算5件で止まる(本体1+祖先5=6)', gets() <= 6, gets());
        t('予算内でも部分は10代化される', !!part && !!part.names);
        t('予算到達フラグ(req=5)', run('BF_DEEP_STAT.req') === 5, run('BF_DEEP_STAT.req'));
        run('BF_DEEP_BUDGET = 1200;');

        /* --- 8. 古い(v1)キャッシュは世代を取り直す --- */
        run('localStorage._d = {}; BF_DEEP_MEM = {};');
        run('var ls = bfLs(); ls.ped["' + horses[0].id + '"] = { names: { "dummy": 1 }, count: 1, at: "2020-01-01" }; bfSave(ls);');
        resetGets();
        run('bfPed("' + horses[0].id + '", { needGen: true }).then(function(r){ __R4 = r; })');
        setTimeout(function(){
          const rec = run('__R4');
          t('v1キャッシュは再取得して g5 が入る', gets() === 1 && rec && rec.g5 && rec.g5.length === 32, gets() + '/' + (rec && rec.g5 && rec.g5.length));
          t('再取得後は v=3', rec && rec.v === 3);
          resetGets();
          run('bfPed("' + horses[0].id + '", { needGen: true }).then(function(r){ __R5 = r; })');
          setTimeout(function(){
            t('v2は再取得しない', gets() === 0, gets());
            console.log('\n' + (bad ? '✗ ' + bad + ' FAIL / ' : '') + '✓ ' + ok + ' PASS' + (bad ? ' (' + (ok + bad) + '中)' : ' (' + (ok + bad) + '件)'));
            process.exit(bad ? 1 : 0);
          }, 30);
        }, 40);
        }, 60);
      }, 400);
    }, 900);
  }, 200);
}, 900);
