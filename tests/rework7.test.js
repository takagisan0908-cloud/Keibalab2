/* 2026-09 改修(タブ統合・自動化・バイアス追加情報)の回帰テスト
   実行: node tests/rework7.test.js
   検証内容:
     1) 馬柱AI評価の出馬表出力時 自動入力
     2) 展開学習とトラックバイアス取得の同時実行
     3) シミュレーター映像は最終直線のみ
     4) ④過去データ → ⑨へ統合 / 5) ⑥レースを選ぶ 削除 / 6) ⑧血統 → オカルトを⑨で分析データから抽出
     7) トラックバイアス欄の「同じ時期の過去との時計比較」「同競馬場開催チェック」
*/
const fs = require('fs');
const vm = require('vm');

const registries = {};
function makeCanvasCtx(){
  return new Proxy({ measureText: function(t){ return { width: String(t).length * 6 }; } }, {
    get: function(tgt, prop){
      if (prop in tgt) return tgt[prop];
      if (prop === 'canvas') return tgt.__cv;
      return function(){ /* スタブメソッド */ };
    },
    set: function(tgt, prop, val){ tgt[prop] = val; return true; }
  });
}
function makeEl(id){
  const el = {
    id: id || '', _v:'', _checked:true, _html:'', _text:'', disabled:false,
    value:'', checked:true, dataset:{}, files:null,
    style:{}, classList:{ _s:new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); },
      toggle(c,f){ if(f===undefined){ this._s.has(c)?this._s.delete(c):this._s.add(c);} else { f?this._s.add(c):this._s.delete(c);} },
      contains(c){ return this._s.has(c); } },
    children: [], parentNode: null,
    addEventListener(t,fn){ (el.__ls=t||''); (registries[el.id||'?'] = registries[el.id||'?']||[]).push([t,fn]); },
    removeEventListener(){}, click(){}, focus(){}, blur(){}, setAttribute(){}, getAttribute(){ return null; },
    querySelector(){ return makeEl(); }, querySelectorAll(){ return []; },
    closest(){ return null; }, appendChild(){}, remove(){}, scrollIntoView(){},
    getBoundingClientRect(){ return { width: 940, height: 400, top:0, left:0 }; },
    getContext(){ return makeCanvasCtx(); }
  };
  Object.defineProperty(el, 'innerHTML', { get(){ return el._html; }, set(v){ el._html = v; el._text = String(v).replace(/<[^>]*>/g,''); } });
  Object.defineProperty(el, 'textContent', { get(){ return el._text; }, set(v){ el._text = String(v); el._html=''; } });
  return el;
}
const els = {};
function find(id){ if (!els[id]) els[id] = makeEl(id); return els[id]; }

const store = {};
const lsOrder = [];
const ls = {
  getItem(k){ return store[k] != null ? store[k] : null; },
  setItem(k,v){ if (!(k in store)) lsOrder.push(k); store[k] = String(v); },
  removeItem(k){ if (k in store){ delete store[k]; const i = lsOrder.indexOf(k); if (i >= 0) lsOrder.splice(i, 1); } },
  key(i){ return lsOrder[i] != null ? lsOrder[i] : null; },
  get length(){ return lsOrder.length; }
};
const g = {
  console, Math, JSON, Date, String, Number, parseInt, parseFloat, isNaN, isFinite, RegExp,
  encodeURIComponent, decodeURIComponent, TextDecoder,
  Blob: function(){}, FileReader: function(){ rdList.push(this); },
  URL: { createObjectURL(){ return 'blob:x'; }, revokeObjectURL(){} },
  clearTimeout, setTimeout: function(){ return 0; }, setInterval: function(){ return 0; }, clearInterval: function(){},
  requestAnimationFrame: function(fn){ rafQ.push(fn); return ++rafId; }, cancelAnimationFrame: function(){},
  localStorage: ls, addEventListener(){}, removeEventListener(){}, scrollTo(){}, devicePixelRatio: 1,
  innerWidth: 980, innerHeight: 640,
  navigator: { clipboard:{ writeText(){ return Promise.resolve(); } } },
  document: {
    getElementById(id){ return find(id); },
    querySelector(){ return makeEl(); },
    querySelectorAll(){ return []; },
    createElement(){ return makeEl(); },
    addEventListener(){}, removeEventListener(){},
    fullscreenElement: null,
    body:{ appendChild(){} }, head:{ appendChild(){} }, documentElement:{}
  }
};
g.window = g;
let rafQ = [], rafId = 0, rdList = [];
vm.createContext(g);

const html = fs.readFileSync('/home/user/keiba-lab/index.html','utf8');
const m = html.match(/<script>\n([\s\S]*)\n<\/script>/);
if (!m){ console.log('FAIL: script not found in index.html'); process.exit(1); }
vm.runInContext(m[1], g, { filename: 'index.html.js' });
const s = g;


let ok = 0, bad = 0;
const t = (n,c,x)=>{ if(c) ok++; else { bad++; console.log('FAIL', n, JSON.stringify(x)); } };
const val = (fn)=>{ try { return { ok:true, v: fn() }; } catch(e){ return { ok:false, v: e && e.message }; } };
function assertNoThrow(n, fn){ const r = val(fn); t(n, r.ok, r.v); return r; }

const HTML = fs.readFileSync('/home/user/keiba-lab/index.html','utf8');

/* ---- 4)5)6) タブ再編 ---- */
t('tab bar: 番号振り直し後の並び', /① データ入力[\s\S]*② 展開予想・AI印[\s\S]*③ レースシミュレーター[\s\S]*④ 馬ノート[\s\S]*⑤ JRA映像[\s\S]*⑥ 重賞データ分析/.test(HTML));
t('tab bar: ④⑥⑧ボタン無し', !/data-t="t-hist"/.test(HTML) && !/data-t="t-kaisai"/.test(HTML) && !/data-t="t-blood"/.test(HTML));
t('section: ④⑥⑧セクション無し', !/id="t-hist"/.test(HTML) && !/id="t-kaisai"/.test(HTML) && !/id="t-blood"/.test(HTML));
(function(){
  const g0 = HTML.indexOf('id="t-grade"');
  const seg = HTML.slice(g0);
  t('⑥に過去データ(histOut)を統合', seg.indexOf('id="histOut"') > 0 && seg.indexOf('旧④タブ → ⑥に統合') > 0);
  t('⑥にオカルト血統(bfList/bfDeepOut)を移設', seg.indexOf('id="bfList"') > 0 && seg.indexOf('id="bfDeepOut"') > 0);
  t('旧 血統ファクター上位5件カードは廃止', seg.indexOf('id="bfTopOut"') < 0 && seg.indexOf('id="bfTopBtn"') < 0);
  t('⑨に「分析データから抽出」ボタン', seg.indexOf('id="bfDrBtn"') > 0);
  t('旧⑧の父・母父一覧カード(pgTab)は削除', seg.indexOf('id="pgTab"') < 0 && HTML.indexOf('id="pgTab"') < 0);
  t('①に読み込み履歴(kaiHist)を移設', HTML.slice(HTML.indexOf('id="t-input"'), g0).indexOf('id="kaiHist"') > 0);
})();
(function(){
  const nav = val(function(){ return s.NAV_ITEMS.map(function(x){ return x.t; }); }).v;
  t('NAV_ITEMS: 削除タブが無い', Array.isArray(nav) && nav.indexOf('t-hist') < 0 && nav.indexOf('t-kaisai') < 0 && nav.indexOf('t-blood') < 0, nav);
  t('NAV_ITEMS: 7件(9−3＋天気予報)', Array.isArray(nav) && nav.length === 7, nav);
  t('馬ノート: カード折り込み(<details class="card fold">)', (HTML.match(/class="card fold"/g) || []).length >= 3);
  t('馬ノート: 一覧が枠内スクロール', HTML.indexOf('class="hbsbox"') > 0 && HTML.indexOf('btnHbMore') > 0);
})();

/* ---- 3) シミュレーター: 「速さ」「映像」「100回集計」は削除・「📊 合計集計」を追加 ---- */
(function(){
  const gone = function(name){ return val(function(){ return typeof s[name] === 'function'; }).v === false; };
  t('simViewMode() は削除', gone('simViewMode'));
  t('montecarlo() は削除', gone('montecarlo'));
  t('runVisualRace() は削除', gone('runVisualRace'));
  t('simCtx()/simDrawFrame() は削除', gone('simCtx') && gone('simDrawFrame'));
  t('simSlowLagM() は削除', gone('simSlowLagM'));
  t('simSlowRate()/simSampleFinish() は残っている', gone('simSlowRate') === false && gone('simSampleFinish') === false);
  t('映像セレクト(simView)は削除', !/id="simView"/.test(HTML));
  t('速さセレクト(simSpeed)は削除', !/id="simSpeed"/.test(HTML));
  t('映像なしチェック(simNoVideo)は削除', !/id="simNoVideo"/.test(HTML));
  t('レース映像カード(simVideoCard/simCanvas)は削除', !/id="simVideoCard"/.test(HTML) && !/id="simCanvas"/.test(HTML));
  t('100回集計(btnBatch/statsBody)は削除', !/id="btnBatch"/.test(HTML) && !/id="statsBody"/.test(HTML));
  t('画面文言から「モンテカルロ」が消えた', !/モンテカルロ/.test(HTML));
  t('📊 合計集計カード(simAggCard/simAggBody)を設置', /id="simAggCard"/.test(HTML) && /id="simAggBody"/.test(HTML));
  t('🗑 集計リセットボタン(btnAggReset)を設置', /id="btnAggReset"/.test(HTML));
  t('集計に出遅れ率・脚質のブレ列がある', /脚質のブレ/.test(HTML) && /出遅れ率/.test(HTML));
  t('TV中継風の実写馬スプライト(p24)を削除', !/SIM_HORSE_PNG/.test(HTML));
  t('カメラ選択(simCam)は削除', !/id="simCam"/.test(HTML));
})();

/* ---- 1) 馬柱AI評価の自動入力 ---- */
(function(){
  t('aihAutoRun 定義', typeof s.aihAutoRun === 'function');
  t('aihPaintRows 定義', typeof s.aihPaintRows === 'function');
  t('出馬表の馬名セルにAI評価欄(data-aih)', /data-aih=/.test(HTML));
  const store = {
    '900001': { p:{}, at:Date.now(), r:[
      { venueName:'札幌', surface:'芝', m:1200, order:1, date:'2025/08/10', baba:'良', head:'16' },
      { venueName:'東京', surface:'芝', m:1600, order:3, date:'2025/05/10', baba:'良', head:'18' },
      { venueName:'札幌', surface:'ダ', m:1000, order:5, date:'2024/08/20', baba:'良', head:'12' }] }
  };
  const prev = s.localStorage.getItem;
  s.localStorage.getItem = function(k){ return k === 'khl_hd_v1' ? JSON.stringify(store) : prev.call(s.localStorage, k); };
  s.state.horses = [ s.mkHorse({ no:'1', name:'ア自動', nk:'900001' }) ];
  Object.assign(s.state.race, { name:'自動テスト', place:'札幌芝1200', baba:'fast', dist:'1200', grade:'G3' });
  const note = val(function(){ return s.aihRowNote(s.state.horses[0]); });
  t('aihRowNote が馬柱から短評を返す', note.ok && typeof note.v === 'string' && note.v.length > 0, note.v);
  assertNoThrow('aihPaintRows', function(){ s.aihPaintRows(); });
  assertNoThrow('aihAutoRun', function(){ s.aihAutoRun(true); });
  assertNoThrow('aihRender', function(){ s.aihRender(); });
  s.localStorage.getItem = prev;
})();

/* ---- 7) トラックバイアス欄の追加情報 ---- */
(function(){
  t('biasTimeCheckHTML 定義', typeof s.biasTimeCheckHTML === 'function');
  t('biasVenueCheckHTML 定義', typeof s.biasVenueCheckHTML === 'function');
  // 記録なしでも案内HTMLを出す
  s.state.biasRaces = [];
  const h0 = val(function(){ return s.biasTimeCheckHTML(); });
  t('記録なし: 時計チェックの案内', h0.ok && h0.v.indexOf('同じ時期') >= 0, h0 && h0.v && h0.v.slice(0,80));
  // 当日記録あり: 同競馬場チェックは「同競馬場」「別競馬場」を判定
  const mk = function(rno, code){
    const money = [{ rank:1, bucket:'front', no:'1', name:'A', odds:3, frame:'1' },
                   { rank:2, bucket:'front', no:'2', name:'B', odds:5, frame:'2' },
                   { rank:3, bucket:'back', no:'3', name:'C', odds:8, frame:'8' }];
    return { id:'2026'+code+'0402'+(rno<10?'0':'')+rno, rno:rno, date:'2026/08/30', label:rno+'R テスト',
      dist:'1200', surface:'芝', baba:'良', winStr:'1:09.5', winSec:69.5, rows:money, money:money, agariAvg:34.0 };
  };
  s.state.raceId = '202609040211';
  s.state.biasRaces = [mk(1,'09'), mk(2,'09')];
  const h1 = val(function(){ return s.biasVenueCheckHTML(); });
  t('同競馬場: 一致表示', h1.ok && h1.v.indexOf('同競馬場 2件') >= 0, h1 && h1.v && h1.v.slice(0,120));
  s.state.biasRaces = [mk(1,'09'), mk(2,'06')];
  const h2 = val(function(){ return s.biasVenueCheckHTML(); });
  t('別競馬場: 警告表示', h2.ok && h2.v.indexOf('別競馬場 1件') >= 0, h2 && h2.v && h2.v.slice(0,120));
  // 対象レース(札幌=01)と記録(阪神=09/中山=06)は不一致 → 警告
  s.state.biasRaces = [mk(1,'05'), mk(2,'05')];
  const h3 = val(function(){ return s.biasTimeCheckHTML(); });
  t('時計チェック: 当日と基準時計の差を表示', h3.ok && h3.v.indexOf('対 基準時計') >= 0 && h3.v.indexOf('同じ時期の過去') >= 0, h3 && h3.v && h3.v.slice(0,120));
  assertNoThrow('renderBiasCard(記録あり)', function(){ s.renderBiasCard(); });
  s.state.biasRaces = [];
})();

/* ---- 2) 展開学習とトラックバイアス取得の同時実行(取込HTMLの学習DB反映) ---- */
(function(){
  // 結果ページHTML(全着順)を作る
  function resultHtml(){
    let body = '';
    const pass = ['1-1-1-1','3-3-3-4','6-6-6-8','4-4-4-5','2-2-2-2','5-5-6-7','8-8-8-9','7-7-5-3'];
    for (let i=0;i<8;i++){
      body += '<tr><td>'+(i+1)+'</td><td>1</td><td>'+(i+1)+'</td><td>馬'+(i+1)+'</td><td>牡5</td><td>56</td><td>R</td><td>1:21.3</td><td>クビ</td><td>'+(i+1)+'</td><td>'+(2.0+i)+'</td><td>33.0</td><td>'+pass[i]+'</td></tr>';
    }
    return '<html><body><div id="All_Result_Table">x</div><h1 class="RaceName">テスト記念</h1>'+
      '<div class="RaceData01"><span>芝 1200m 天候:晴 馬場:良 / 2回阪神2日目</span></div>'+
      '<table summary="全着順"><tr><th>着順</th><th>枠</th><th>馬番</th><th>馬名</th><th>性齢</th><th>斤量</th><th>競走馬</th><th>タイム</th><th>着差</th><th>人気</th><th>単勝オッズ</th><th>後3F</th><th>コーナー通過順</th></tr>'+body+'</table></body></html>';
  }
  const html = resultHtml();
  const d = s.histParseDetail(html);
  t('histParseDetail: 行が取れる', d && d.rows && d.rows.length >= 3, d && d.rows && d.rows.length);
  // 取込の実体は nkBiasFetchOne（全場取込の共通処理）に移した。そこから学習へ同時登録している
  t('取込時に学習(lnIngest)も同時に行う実装', /lnIngest\(d, x\.rid\)/.test(HTML));
  t('nkBiasFetchAll 後に lnCompute を呼ぶ実装', /lnCompute\(\)/.test(HTML.slice(HTML.indexOf('function nkBiasFetchAll'), HTML.indexOf('function nkBiasFetchAll') + 4000)));
  const before = s.state.learn && s.state.learn.hist;
  s.lnIngest(d, '202605050211');
  s.state.raceId = '202605050211';
  Object.assign(s.state.race, { place:'阪神', dist:'1200', baba:'fast' });
  const lr = val(function(){ return s.lnCompute(); });
  t('lnIngest→lnCompute で学習が成立', lr.ok && lr.v && lr.v.total >= 3, lr.v && lr.v.total);
  assertNoThrow('renderLearnCard', function(){ s.renderLearnCard(); });
  if (!before) s.state.learn.hist = null;
})();

/* ---- 6) ⑨の分析データから血統オカルトを抽出 ---- */
function testBloodFromAnalysis(){
  t('bfAnalyzeFromDr 定義', typeof s.bfAnalyzeFromDr === 'function');
  /* 第11弾(2026-09-11): ⑥の分析データ(DR_LAST.samples)が無いときは、
     「⑥を実行してください」で止めるのではなく【自動で⑥の分析を実行】してから抽出する。
     テスト環境では通信できないので、⑥側の実行時エラーがそのまま返ってくる。 */
  const keepDr = { a: s.drRunAll, b: s.drAnalyzeRid, c: s.drAnalyzeByName };
  let autoRuns = 0;
  const stub = function(){ autoRuns++; return Promise.reject(new Error('テスト: 通信できないので分析できません')); };
  s.drRunAll = stub; s.drAnalyzeRid = stub; s.drAnalyzeByName = stub;
  return s.bfAnalyzeFromDr().then(function(){
    t('分析前はエラーで案内', false, 'resolve してしまった');
  }, function(e){
    t('⑥の分析データが無いときは自動で⑥の分析を実行しにいく（第11弾）', autoRuns >= 1, autoRuns);
    t('自動分析が失敗したら理由がそのまま出る', /テスト: 通信できない/.test(String((e && e.message) || e)), e && e.message);
  }).then(function(){
    s.drRunAll = keepDr.a; s.drAnalyzeRid = keepDr.b; s.drAnalyzeByName = keepDr.c;
    // ⑨の分析結果(サンプル)を疑似作成: 3年分の1〜3着馬 + 血統キャッシュ(5代)
    const peds = {}, samples = [];
    for (let y = 2023; y <= 2025; y++){
      for (let o = 1; o <= 3; o++){
        const id = String(y * 100 + o);
        samples.push({ yr:y, rid:String(y)+'05050211', o:o, no:String(o), name:'馬'+id, id:id });
        const nm = {}; nm['ディープインパクト'] = 1; nm['祖先' + o] = 1;
        peds[id] = { names: nm, disp:{}, count:2, at:new Date().toISOString() };
      }
    }
    s.DR_LAST = { rid:'202605050211', name:'テスト重賞', yearsUsed:3, samples:samples,
                  racesUsed:[{ year:2023 }, { year:2024 }, { year:2025 }] };
    const bfStore = { ped: peds, race:{}, set:{ on:{}, apply:false }, last:{} };
    const prev2 = s.localStorage.getItem;
    const prevSet = s.localStorage.setItem;
    let saved = null;
    let written = null;   // 実ブラウザと同じく「書いた値が次に読める」ようにする
    s.localStorage.getItem = function(k){
      if (k === 'khl_bf_v1') return written != null ? written : JSON.stringify(bfStore);
      return prev2.call(s.localStorage, k);
    };
    s.localStorage.setItem = function(k, v){ if (k === 'khl_bf_v1'){ written = String(v); saved = JSON.parse(s.cmpUnpack(String(v))); }   /* 第13弾: 圧縮保存なので cmpUnpack してから読む */ return prevSet.call(s.localStorage, k, v); };
    return s.bfAnalyzeFromDr(function(){}).then(function(factors){
      const last = (saved && saved.last) || {};
      t('分析データからファクターを抽出(祖先ディープインパクト)', Array.isArray(factors) && factors.some(function(f){ return f.names.indexOf('ディープインパクト') >= 0; }),
        factors && factors.map(function(f){ return f.names; }));
      t('抽出は分析の過去レース(3年分)と一致', (last.years || []).length === 3, last.years);
      t('ファクター保存(src=dr)', last.src === 'dr' && last.name === 'テスト重賞');
    }, function(e){
      t('分析データ抽出: 例外なし', false, e && e.message);
    }).then(function(){
      s.localStorage.getItem = prev2; s.localStorage.setItem = prevSet;
      s.DR_LAST = null;
    });
  });
}

/* ---- 第11弾(2026-09-11): 🧬血統ファクターの検出結果がボタン直下に出る／🔎検索がメイン／💾保存領域 ---- */
function testRework11(){
  const idx = fs.readFileSync('index.html', 'utf8');

  /* (1) drFinishRun が DR_LAST の samples を消さない（＝血統抽出が⑥と同じ母集団を使える） */
  const res = { rid: '202605050211', name: 'テスト重賞', yearsUsed: 3,
                samples: [{ yr: 2025, rid: '202505050211', o: 1, no: '1', name: '馬A', id: '900' }],
                tables: { all: { n: 30, w: 10, t2: 10, t3: 10, oth: 0, roiW: 0 }, base: 0 },
                racesUsed: [{ year: 2025 }] };
  s.DR_LAST = null;
  const keepRenderAll = s.drRenderAll;
  s.drRenderAll = function(r){ s.DR_LAST = r; };   // 本物と同じ「DR_LAST = res」だけを行う（描画は重いので省略）
  assertNoThrow('drFinishRun', function(){ s.drFinishRun(res, 'テスト重賞', '202605050211', false); });
  s.drRenderAll = keepRenderAll;
  t('drFinishRun 後も DR_LAST に samples が残る（第11弾の修正）',
    !!(s.DR_LAST && s.DR_LAST.samples && s.DR_LAST.samples.length === 1), s.DR_LAST && Object.keys(s.DR_LAST));
  t('DR_LAST に rid も入る', s.DR_LAST && s.DR_LAST.rid === '202605050211', s.DR_LAST && s.DR_LAST.rid);
  t('bfDrSamples() がその samples を返す', !!(s.bfDrSamples() && s.bfDrSamples().samples));
  s.DR_LAST = null;

  /* (2) 🔎検出結果(#bfSummary) に「文＋表」が出る */
  const names = ['アアア', 'イイイ', 'ウウウ', 'エエエ'];
  s.state.horses = names.map(function(n, i){ return s.mkHorse({ name: n, no: String(i + 1), frame: '1', nk: '9000' + (100 + i), odds: String(3 + i) }); });
  const ped = {};
  names.forEach(function(n, i){
    const nm = { 'ディープインパクト': 1 };
    if (i % 2 === 0) nm['GreySovereign'] = 1;
    ped['9000' + (100 + i)] = { names: nm, disp: {}, count: 2, deep: 7, at: new Date().toISOString() };
  });
  s.BF_LS_MEM = { ped: ped, race: {}, set: { on: { k1: { names: ['ディープインパクト'], type: 'S' } }, apply: true, deep: true },
    last: { rid: '202605050211', name: 'テスト重賞', grade: 'G1', at: new Date().toISOString(), src: 'dr',
      years: [{ year: 2023 }, { year: 2024 }, { year: 2025 }],
      factors: [
        { key: 'k1', names: ['ディープインパクト'], type: 'S', gen: 3, wYears: [2023, 2025], bYears: [2023, 2024, 2025], streak: '2023〜2025年', bStreak: '3年' },
        { key: 'k2', names: ['StormBird'], type: 'S', gen: 4, wYears: [2024], bYears: [2024, 2025], streak: '−', bStreak: '2年' }],
      deepCommon: { deep: true,
        win:   { items: [{ name: 'GreySovereign', line: '母系', n: 7, total: 10, gen: 7 }] },
        board: { items: [{ name: 'Nijinsky', line: '母系', n: 5, total: 10, gen: 8 }] } } } };
  assertNoThrow('bfRenderSummary', function(){ s.bfRenderSummary(); });
  const H = els['bfSummary'] ? els['bfSummary']._html : (s.document.getElementById('bfSummary')._html || '');
  t('検出結果の「文」に出た内容（年数・件数・点数・出走馬）',
    /過去 <b>3年分<\/b>/.test(H) && /5代ファクター <b>2件<\/b>/.test(H) && /共通点 <b>2点<\/b>/.test(H) && /出走馬 <b>4頭<\/b>/.test(H),
    (H.match(/過去 <b>[^<]*<|5代ファクター <b>[^<]*<|共通点 <b>[^<]*<|出走馬 <b>[^<]*</g) || []).join(' / '));
  t('表1(6〜10代の共通点)・表2(出走馬の該当)・表3(5代ファクター)が全部出る',
    /表1:/.test(H) && /表2:/.test(H) && /表3:/.test(H), [ /表1:/.test(H), /表2:/.test(H), /表3:/.test(H) ]);
  t('表が3枚・☑（②への反映）が2件', (H.match(/<table/g) || []).length === 3 && (H.match(/data-bfkey/g) || []).length === 2,
    [(H.match(/<table/g) || []).length, (H.match(/data-bfkey/g) || []).length]);
  t('共通点の祖先名と該当頭数が出る', /Grey Sovereign|GreySovereign/.test(H) && /7<\/b>\/10頭/.test(H));
  t('出走馬が全員出る', names.every(function(n){ return H.indexOf(n) >= 0; }));
  t('判定チップが出る', /bfhg/.test(H));
  /* ☑を操作すると検出結果も描き直される */
  s.bfKeyToggle('k2', true);
  const H2 = s.document.getElementById('bfSummary')._html || '';
  t('☑をONにすると検出結果も描き直される', /data-bfkey="k2" checked/.test(H2));
  t('反映ONの件数が文に反映される', /反映ON 2件/.test(H2), (H2.match(/反映ON \d+件/) || [])[0]);
  /* データが無いときの案内 */
  s.BF_LS_MEM = { ped: {}, race: {}, set: { on: {}, apply: false }, last: {} };
  s.bfRenderSummary();
  const H3 = s.document.getElementById('bfSummary')._html || '';
  t('未取得のときは「自動で⑥の分析を実行してから抽出」と案内する', /まだありません/.test(H3) && /自動で⑥の分析/.test(H3), H3.slice(0, 100));
  s.BF_LS_MEM = null;

  /* (3) 画面の並び：検出結果はボタン直下・内訳は折りたたみ・🔎検索がメイン・URL直貼り付けは閉じる */
  t('#bfSummary は抽出ボタンの直下（内訳より前）',
    idx.indexOf('id="bfDrBtn"') < idx.indexOf('id="bfSummary"') && idx.indexOf('id="bfSummary"') < idx.indexOf('id="bfDeepOut"'));
  t('血統の内訳は details（既定 closed）',
    /<details class="card fold" id="bfDetailFold"/.test(idx) && !/<details class="card fold" id="bfDetailFold"[^>]*\bopen\b/.test(idx),
    (idx.match(/<details class="card fold" id="bfDetailFold"[^>]*/) || [])[0]);
  t('🔎レース名検索が URL直貼り付けより前（＝メイン）', idx.indexOf('id="rsName"') < idx.indexOf('id="urlImport"'));
  t('URL直貼り付けは details#urlManualFold（既定 closed）',
    /<details id="urlManualFold"/.test(idx) && !/<details id="urlManualFold"[^>]*\bopen\b/.test(idx));
  t('カード見出しが「🔎 レース名で探して出馬表を取込」', /🔎 レース名で探して出馬表を取込（JRA重賞 2002年〜）/.test(idx));
  t('検索の候補ボタン＝出馬表＋オッズの自動取込（nkImportBoth）',
    /このレースを出馬表＋オッズまで自動取込/.test(idx) && /nkImportBoth === 'function'\) nkImportBoth\(\)/.test(idx));
  t('取込に失敗したら URL の枠が自動で開く（nkOpenManual）', /function nkOpenManual\(/.test(idx) && (idx.match(/nkOpenManual\(/g) || []).length >= 3);
  t('💾保存領域のUIがある', /id="btnStoreUse"/.test(idx) && /id="storeUse"/.test(idx) && /id="storeTbl"/.test(idx) && /id="btnStoreTrim"/.test(idx));
  return Promise.resolve();
}

/* ---- 第14弾(2026-09-11): 🚧障害は別土俵（AI予想の学習バケットを分ける）／うましる折り込み／バックアップ復元 ---- */
function testRework14(){
  const idx = fs.readFileSync('index.html', 'utf8');

  /* 面とバケットの判定 */
  t('apSurfOf: レース名に「障害」があれば surface が芝でも 障', s.apSurfOf('芝', '障害4歳以上オープン') === '障');
  t('apSurfOf: surface=障害 / 障 → 障', s.apSurfOf('障害', '') === '障' && s.apSurfOf('障', '') === '障');
  t('apSurfOf: 芝・ダート → 平地', s.apSurfOf('芝', '東京優駿') === '平地' && s.apSurfOf('ダート', '') === '平地');
  t('apYmSurf: 障害は ym に #障 が付く', s.apYmSurf('20250105', '202501050101', '障害', '障害4歳以上オープン') === '202501#障',
    s.apYmSurf('20250105', '202501050101', '障害', '障害4歳以上オープン'));
  t('apYmSurf: 平地は従来の ym のまま（既存の学習データと互換）', s.apYmSurf('20250105', '202501050101', '芝', '3歳1勝クラス') === '202501');
  t('apYmIsSho: #障 の有無で判定', s.apYmIsSho('202501#障') === true && s.apYmIsSho('202501') === false);
  t('apYmTxt: 202501#障 → 2025年1月（🚧障害）', s.apYmTxt('202501#障') === '2025年1月（🚧障害）', s.apYmTxt('202501#障'));
  t('apYmTxt: 202501 → 2025年1月', s.apYmTxt('202501') === '2025年1月', s.apYmTxt('202501'));

  /* 障害と平地のバケットを混ぜない（時系列の学習） */
  function mkB(ym, n){
    const b = s.apBucket(ym);
    ['hit', 'roi', 'hyb'].forEach(function(cid){
      b.c[cid].n = n; b.c[cid].horseN = n * 10; b.c[cid].horseTop3 = n * 3;
      b.c[cid].boostN = 20; b.c[cid].boostTop3 = 8; b.c[cid].costU = n * 100; b.c[cid].grossU = n * 90;
    });
    return b;
  }
  const keepMode = s.apMode;
  s.apMode = 'ls';
  ['202501', '202501#障', '202502', '202502#障'].forEach(function(k){ s.localStorage.removeItem('khl_apm_' + k); });
  s.apMBSaveLs(mkB('202501', 50));
  s.apMBSaveLs(mkB('202501#障', 20));
  s.apMBSaveLs(mkB('202502', 40));
  s.apMBSaveLs(mkB('202502#障', 10));
  const P1 = s.apParamsFor('202502');
  t('apParamsFor(平地2月): 障害のバケットを使わない', P1.lastYm === '202501' && P1.totalR === 50, [P1.lastYm, P1.totalR]);
  const P2 = s.apParamsFor('202502#障');
  t('apParamsFor(障害2月): 平地のバケットを使わない', P2.lastYm === '202501#障' && P2.totalR === 20, [P2.lastYm, P2.totalR]);
  const A1 = s.apPastAgg('202502');
  const A2 = s.apPastAgg('202502#障');
  t('apPastAgg も区分を混ぜない（平地50 / 障害20）', A1.hit.n === 50 && A2.hit.n === 20, [A1.hit.n, A2.hit.n]);
  t('apYmsLs が #障 のキーも列挙する', s.apYmsLs().indexOf('202501#障') >= 0, s.apYmsLs());
  ['202501', '202501#障', '202502', '202502#障'].forEach(function(k){ s.localStorage.removeItem('khl_apm_' + k); });
  s.apMode = keepMode;

  /* ④うましるのカードは折り込み（既定 closed） */
  t('うましるのカードは details#umaFold（既定 closed）',
    /<details class="card fold" id="umaFold"/.test(idx) && !/<details class="card fold" id="umaFold"[^>]*\bopen\b/.test(idx));
  t('うましるの見出しが summary の中にある', /<summary class="foldhead">[\s\S]{0,260}うましるの調教評価から調教タイムを取込（重賞のみ）/.test(idx));
  t('うましるの本体（自動検索ボタン・URL指定・ログ）は foldbody の中',
    idx.indexOf('id="btnUmaAuto"') > idx.indexOf('id="umaFold"') && idx.indexOf('id="umaLog"') > idx.indexOf('id="umaFold"') &&
    idx.indexOf('id="umaUrlInp"') > idx.indexOf('id="umaFold"'));

  /* ①バックアップJSONの復元（手順を画面に明記） */
  t('バックアップ復元ボタンに手順の title がある（ファイル名まで書いてある）',
    /id="diImp"[^>]*title="[^"]*keiba_date_backup_YYYYMMDD\.json/.test(idx));
  t('復元後に🎓タイム換算の学習を自動でやり直す（追加があったときだけ）',
    /if \(typeof tlLearnSchedule === 'function' && add\)/.test(idx));
  t('復元メッセージに「学習DBは合計 N レースになりました」が出る',
    /バックアップから復元しました[\s\S]{0,200}学習DBは合計/.test(idx));
  return Promise.resolve();
}

Promise.resolve()
  .then(testBloodFromAnalysis)
  .then(testRework11)
  .then(testRework14)
  .then(function(){
    console.log((bad ? 'FAIL' : 'PASS') + ' rework7: ok=' + ok + ' bad=' + bad);
    process.exit(bad ? 1 : 0);
  }, function(e){
    console.log('FAIL rework7 (unhandled): ' + (e && e.message || e));
    process.exit(1);
  });
