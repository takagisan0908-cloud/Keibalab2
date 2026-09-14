/* 住所（郵便番号）コピー＋ボタンUIのテスト
   実行: node tests/tenkiaddr.test.js
   ・ホームメイト「全国の競馬場一覧」のfixtureから 場名→〒・住所 を取り出せる
   ・コピーは初回の1回だけ（2回目・再起動後は保存済みを使い取得しない）
   ・コピーした〒を優先し、tenki.jp に地点が無ければ同梱の〒で再検索（函館 042-8585→042-0935）
   ・当日開催の競馬場名ボタンが出る／ボタンを押すと天気予報のカードが出る
*/
const fs = require('fs'), vm = require('vm');
let ok = 0, bad = 0;
function t(name, cond, extra){ if (cond){ ok++; } else { bad++; console.log('  FAIL', name, extra === undefined ? '' : extra); } }

function makeEl(id){
  const el = { id:id||'', value:'', _html:'', _text:'', style:{}, checked:false, open:false, disabled:false,
    classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
      toggle(c,f){ if(f===undefined){this._s.has(c)?this._s.delete(c):this._s.add(c);} else if(f){this._s.add(c);} else {this._s.delete(c);} },
      contains(c){ return this._s.has(c); } },
    setAttribute(){}, getAttribute(){ return null; }, addEventListener(){}, removeEventListener(){},
    querySelector(){ return null; }, querySelectorAll(){ return []; }, dataset:{}, appendChild(){}, remove(){},
    closest(){ return null; } };
  Object.defineProperty(el,'innerHTML',{get(){return el._html;},set(v){el._html=String(v);el._text=String(v).replace(/<[^>]*>/g,' ');}});
  Object.defineProperty(el,'textContent',{get(){return el._text;},set(v){el._text=String(v);el._html='';}});
  return el;
}
const store = { _d:{} };
store.getItem = function(k){ return this._d[k]==null?null:this._d[k]; };
store.setItem = function(k,v){ this._d[k]=String(v); };
store.removeItem = function(k){ delete this._d[k]; };

function boot(){
  const els = {};
  const g = {
    console, Math, JSON, Date, String, Number, Array, Object, Error, Promise, Boolean,
    parseInt, parseFloat, isNaN, isFinite, RegExp, encodeURIComponent, decodeURIComponent,
    setTimeout(){ return 0; }, clearTimeout(){}, setInterval(){ return 0; }, clearInterval(){},
    localStorage: store,
    document:{ getElementById(id){ if(!els[id]) els[id]=makeEl(id); return els[id]; },
      querySelector(){ return null; }, querySelectorAll(){ return []; }, createElement(){ return makeEl(); },
      addEventListener(){}, body:makeEl('body') },
    addEventListener(){}, navigator:{ userAgent:'test' }
  };
  g.window = g; g.globalThis = g; g.self = g;
  vm.createContext(g);
  const code = ['p3_core','p5_engine','p46_tenki'].map(f => fs.readFileSync('src/' + f + '.js','utf8')).join('\n');
  vm.runInContext(code, g, { filename:'tenki.js' });
  return { g, els };
}

const FIX = fs.readFileSync('tests/fixtures/homemate_list.html','utf8');
const HOUR1H = fs.readFileSync('tests/fixtures/tenki_1h.html','utf8');

/* ---- 1) 一覧ページから住所（〒）を取り出す ---- */
{
  const { g } = boot();
  const list = vm.runInContext('tkParseAddrList(__fix)', Object.assign(g, { __fix: FIX }));
  t('25場を解析できる', list.length === 25, list.length);
  const by = {}; list.forEach(x => by[x.key] = x);
  t('中山の〒', by['中山'] && by['中山'].pc === '273-0037', by['中山'] && by['中山'].pc);
  t('中山の住所', by['中山'] && /千葉県船橋市古作/.test(by['中山'].addr), by['中山'] && by['中山'].addr);
  t('帯広（ばんえい十勝）をキー化', by['帯広'] && by['帯広'].pc === '080-0023', by['帯広'] && by['帯広'].pc);
  t('荒尾（Ｊ－ＰＬＡＣＥ荒尾）をキー化', by['荒尾'] && by['荒尾'].pc === '864-0003', by['荒尾'] && by['荒尾'].pc);
  t('函館は施設番号 042-8585', by['函館'] && by['函館'].pc === '042-8585', by['函館'] && by['函館'].pc);
  t('名古屋・水沢・門別もある', !!by['名古屋'] && !!by['水沢'] && !!by['門別']);
  t('全件に〒がある', list.every(x => /^\d{3}-\d{4}$/.test(x.pc)));
}

/* ---- 2) コピーは初回の1回だけ（2回目・再起動後も保存済み） ---- */
(async function(){
  let fetches = [];
  const { g, els } = boot();
  g.kaiFetchAny = function(url){
    fetches.push(url);
    if (/homemate-research-keiba/.test(url)) return Promise.resolve(FIX);
    if (/tenki\.jp\/lite\/search/.test(url)) return Promise.resolve('<a href="/lite/forecast/3/15/4510/12204/">273-0037 千葉県船橋市古作</a>');
    if (/1hour\.html/.test(url)) return Promise.resolve(HOUR1H);
    return Promise.reject(new Error('unknown url ' + url));
  };
  g.tkDateInput8 = function(){ return '20260910'; };   // fixture の1時間ごと予報（today=2026-09-10 13〜15時）

  const r1 = await vm.runInContext('tkImportAddr(false)', g);
  t('初回コピーで25場を保存', r1.n === 25 && r1.cached === false, JSON.stringify(r1).slice(0,80));
  const nAddr = fetches.filter(u => /homemate/.test(u)).length;
  t('初回は一覧を1回だけ取得', nAddr === 1, nAddr);

  const r2 = await vm.runInContext('tkImportAddr(false)', g);
  t('2回目はキャッシュ（取得しない）', r2.cached === true && r2.n === 25, JSON.stringify(r2).slice(0,80));
  t('2回目で一覧を取得していない', fetches.filter(u => /homemate/.test(u)).length === 1);

  // 再起動（新しいコンテキスト・localStorage は同じ）
  const b2 = boot(); b2.g.kaiFetchAny = g.kaiFetchAny; b2.g.tkDateInput8 = g.tkDateInput8;
  const r3 = await vm.runInContext('tkImportAddr(false)', b2.g);
  t('再起動後も保存済み（取得しない）', r3.cached === true && r3.n === 25, JSON.stringify(r3).slice(0,80));
  const trNak = vm.runInContext('tkTrackOf("中山")', b2.g);
  t('再起動後もコピーした〒を使う', trNak && trNak.pc === '273-0037' && trNak.copied === true, JSON.stringify(trNak));
  t('コピーした住所も保持', trNak && /千葉県船橋市古作/.test(trNak.addr || ''), trNak && trNak.addr);

  // 函館: コピーした施設番号には地点が無い → 同梱の 042-0935 で再検索
  const trHak = vm.runInContext('tkTrackOf("函館")', b2.g);
  t('函館はコピー〒＋予備〒', trHak && trHak.pc === '042-8585' && trHak.pcAlt === '042-0935', JSON.stringify(trHak));
  let searched = [];
  const origSearch = b2.g.tkSearchPoint;
  b2.g.tkSearchPoint = function(pc){ searched.push(pc); return Promise.resolve(pc === '042-0935' ? { pc:pc, path:'/lite/forecast/1/4/2300/1202/', title:'042-0935 北海道函館市駒場町' } : null); };
  const pt = await vm.runInContext('tkPointForTrack(tkTrackOf("函館"))', b2.g);
  t('地点が無ければ予備〒で再検索', searched.join(',') === '042-8585,042-0935', searched.join(','));
  t('予備〒の地点が返る', pt && pt.pc === '042-0935', JSON.stringify(pt));
  b2.g.tkSearchPoint = origSearch;   // 以降は本物の tkSearchPoint（kaiFetchAny のスタブで応答）

  /* ---- 3) 当日開催の競馬場名ボタン → 押すと天気予報 ---- */
  b2.g.tkKaisai = function(){ return Promise.resolve([
    { venue:'中山', kaisai:'4回2日目', baba:'芝:良 / ダ:良', pc:'273-0037', label:'中山競馬場', kind:'中央',
      races:[{ r:1, time:'13:05', name:'3歳未勝利', raceId:'202606020101' },{ r:11, time:'15:45', name:'京成杯オータムH', raceId:'202606020111' }] },
    { venue:'中京', kaisai:'3回2日目', baba:'芝:良', pc:'470-1132', label:'中京競馬場', kind:'中央',
      races:[{ r:11, time:'15:35', name:'セントウルS', raceId:'202607020111' }] }
  ]); };
  await vm.runInContext('tkFetchKaisai()', b2.g);
  const bar = b2.els['tkVenueBar']._html;
  t('当日開催のボタンが2つ出る', (bar.match(/data-tkv="/g) || []).length >= 2, bar.slice(0,120));
  t('中山ボタン（開催回・R数つき）', /data-tkv="中山"[^>]*>[\s\S]*?中山/.test(bar) && /4回2日目/.test(bar), bar.slice(0,200));
  t('中京ボタン', /data-tkv="中京"/.test(bar));
  t('その他場のボタンもある', /data-tkv="札幌"/.test(bar) && /data-tkv="帯広"/.test(bar));
  t('ボタンはチェックボックスではない', !/type="checkbox"/.test(bar));

  await vm.runInContext('tkShowVenue("中山", false)', b2.g);
  const out = b2.els['tkOut']._html;
  t('押すと天気カードが出る', /当日の天気/.test(out) && /中山/.test(out), out.slice(0,120));
  t('1時間ごとの表（気温・湿度・降水量・降水確率・風向・風速）',
    /気温\(℃\)/.test(out) && /湿度\(%\)/.test(out) && /降水量\(mm\/h\)/.test(out) && /降水確率\(%\)/.test(out) && /風向/.test(out) && /風速\(m\/s\)/.test(out));
  t('発走Rの印が付く', /11R/.test(out));
  t('地点・住所の表示', /273-0037/.test(out) || /船橋市古作/.test(out), out.slice(-300));
  t('tenki.jp を1回だけ取得（2回目はキャッシュ）', fetches.filter(u => /1hour\.html/.test(u)).length === 1, fetches.filter(u => /1hour/.test(u)).length);
  await vm.runInContext('tkShowVenue("中山", false)', b2.g);
  t('同じ場を再度押しても再取得しない', fetches.filter(u => /1hour\.html/.test(u)).length === 1);

  // 当日開催を全部表示
  await vm.runInContext('tkShowToday(false)', b2.g);
  const out2 = b2.els['tkOut']._html;
  t('全部表示で2場のカード', (out2.match(/当日の天気/g) || []).length === 2, (out2.match(/当日の天気/g) || []).length);

  /* ---- 4) ボタンを押した経路（#tkVenueBar の委譲クリック） ---- */
  function tgWith(attr, val){ return { getAttribute:function(a){ return a === attr ? val : null; } }; }
  b2.g.__tg1 = tgWith('data-tkv', '中京');
  vm.runInContext('tkBarClick(__tg1)', b2.g);
  await new Promise(r => setTimeout(r, 0));
  t('場名ボタンクリックで天気カードが増える', /中京/.test(b2.els['tkOut']._html), b2.els['tkOut']._html.slice(0,80));
  b2.g.__tg2 = tgWith('data-tkclose', '中京');
  vm.runInContext('tkBarClick(__tg2)', b2.g);
  t('閉じるボタンでカードが消える', !/data-tkclose="中京"/.test(b2.els['tkOut']._html));
  b2.g.__tg3 = tgWith('data-tkact', 'clear');
  vm.runInContext('tkBarClick(__tg3)', b2.g);
  t('表示をクリアで全部消える', !/当日の天気/.test(b2.els['tkOut']._html));

  console.log(bad ? ('tenkiaddr: NG ' + bad + ' FAIL / ' + ok + ' PASS') : ('tenkiaddr : OK ' + ok + ' PASS（住所の初回コピー・保存・場名ボタンで天気表示）'));
  process.exit(bad ? 1 : 0);
})();
