/* 2026-09-10追加: 「実HTMLのidだけでboot()が完走するか」を検証する回帰テスト
   実行: node tests/bootdom.test.js

   背景: アプリは起動時に initXxx() を順に呼ぶ。既存テストは getElementById が
   どんなidでも要素を返すスタブだったため、HTMLに存在しないid（例 kaiFetch）を
   on() で参照していても例外に気づけず、実際のブラウザでは boot() が途中で止まり
   「重賞カレンダーの年度が選べない」「⑥のボタンが無反応」「日付→出馬表のピッカーが
   動かない」といった症状になっていた（初期化の後半が全部スキップされる）。
   ここでは index.html に実在するidだけを要素として返し、boot() が完走し、
   ⑥・①の主要UIが配線されることまで確認する。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let ok = 0, bad = 0;
const t = (n, c, x) => { if (c){ ok++; } else { bad++; console.log('FAIL', n, x === undefined ? '' : JSON.stringify(String(x).slice(0,200))); } };

/* --- index.html に存在するid --- */
const realIds = new Set();
{
  const re = /\sid="([A-Za-z0-9_\-]+)"/g;
  let m;
  while ((m = re.exec(html))) realIds.add(m[1]);
}
t('index.html からidを抽出できた', realIds.size > 100, realIds.size);

function makeCanvasCtx(){
  return new Proxy({ measureText: () => ({ width: 0 }) }, {
    get(tgt, prop){ if (prop in tgt) return tgt[prop]; if (prop === 'canvas') return tgt.__cv; return function(){}; },
    set(tgt, prop, val){ tgt[prop] = val; return true; }
  });
}
function makeEl(id){
  const el = { id: id || '', _v:'', _html:'', _text:'', style:{}, dataset:{}, disabled:false, checked:false,
    value:'', files:null, children:[], parentNode:null,
    classList:{ _s:new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); },
      toggle(c,f){ if (f === undefined){ this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { f ? this._s.add(c) : this._s.delete(c); } },
      contains(c){ return this._s.has(c); } },
    __ls:{},
    addEventListener(ev, fn){ (el.__ls[ev] = el.__ls[ev] || []).push(fn); },
    removeEventListener(){}, setAttribute(){}, getAttribute(){ return null; },
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    closest(){ return null; }, appendChild(){}, remove(){}, focus(){}, blur(){}, click(){}, scrollIntoView(){},
    getBoundingClientRect(){ return { width:940, height:400, top:0, left:0 }; },
    getContext(){ return makeCanvasCtx(); }, insertBefore(){}, contains(){ return false; }
  };
  Object.defineProperty(el, 'innerHTML', { get(){ return el._html; }, set(v){ el._html = String(v); el._text = String(v).replace(/<[^>]*>/g,' '); } });
  Object.defineProperty(el, 'textContent', { get(){ return el._text; }, set(v){ el._text = String(v); el._html = ''; } });
  return el;
}
const store = {};
const els = {};
const g = {
  console, Math, JSON, Date, String, Number, Array, Object, Error, Promise, Symbol, Map, Set,
  parseInt, parseFloat, isNaN, isFinite, RegExp, Boolean, Function, isArray: Array.isArray,
  encodeURIComponent, decodeURIComponent, escape, unescape, TextDecoder, TextEncoder,
  setTimeout(){ return 0; }, clearTimeout(){}, setInterval(){ return 0; }, clearInterval(){},
  requestAnimationFrame(){ return 0; }, cancelAnimationFrame(){}, requestIdleCallback(){ return 0; },
  localStorage:{ getItem(k){ return store[k] == null ? null : store[k]; }, setItem(k,v){ store[k] = String(v); },
    removeItem(k){ delete store[k]; }, get length(){ return Object.keys(store).length; },
    key(i){ return Object.keys(store)[i] || null; } },
  addEventListener(){}, removeEventListener(){}, scrollTo(){}, devicePixelRatio:1,
  innerWidth:1100, innerHeight:700, getComputedStyle(){ return { getPropertyValue(){ return ''; } }; },
  matchMedia(){ return { matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} }; },
  navigator:{ userAgent:'node', clipboard:{ writeText(){ return Promise.resolve(); } } },
  alert(){}, confirm(){ return true; }, prompt(){ return ''; },
  document:{
    // ★重要: index.html に無いidは null を返す（ブラウザと同じ挙動）
    getElementById(id){ if (!realIds.has(id)) return null; if (!els[id]) els[id] = makeEl(id); return els[id]; },
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    createElement(){ return makeEl(); }, createTextNode(){ return {}; },
    addEventListener(){}, removeEventListener(){},
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
    fullscreenElement: null, execCommand(){ return true; }
  },
  CSS:{ supports(){ return false; } },
  URL:{ createObjectURL(){ return 'blob:x'; }, revokeObjectURL(){} },
  Blob: class {}, FileReader: class {}, FormData: class {},
  Image: class { constructor(){ this.style = {}; } },
  IntersectionObserver: class { observe(){} unobserve(){} disconnect(){} },
  ResizeObserver: class { observe(){} unobserve(){} disconnect(){} },
  MutationObserver: class { observe(){} disconnect(){} },
  Event: class { constructor(t){ this.type = t; } },
  performance:{ now(){ return Date.now(); } }
};
g.window = g; g.globalThis = g; g.self = g;
g.CustomEvent = g.Event;

const mScript = html.match(/<script>\n([\s\S]*)\n<\/script>/);
t('index.html のscriptを抽出できた', !!mScript);
if (!mScript){ console.log('OK ' + ok + ' FAIL ' + bad); process.exit(1); }

let bootErr = null;
try { vm.createContext(g); vm.runInContext(mScript[1], g, { filename:'index.html.js' }); }
catch(e){ bootErr = e; }
t('boot() が例外なく完走する（実HTMLのidのみ）', !bootErr, bootErr && (bootErr.message + ' @ ' + String(bootErr.stack||'').split('\n')[1]));
t('初期化の失敗が記録されていない（INIT_ERRORS が空）',
  !(g.INIT_ERRORS && g.INIT_ERRORS.length), g.INIT_ERRORS && g.INIT_ERRORS.join(' / '));

const el = id => g.document.getElementById(id);
const hasOn = (id, ev) => { const e = els[id]; return !!(e && e.__ls && e.__ls[ev] && e.__ls[ev].length); };

/* ---- ⑥ 重賞データ分析（カレンダー・分析ボタン）---- */
t('gcYear: 年度の選択肢が入っている', (String((el('gcYear')||{}).innerHTML || '').split('<option').length - 1) >= 15);
t('gcYear: change が配線されている', hasOn('gcYear','change'));
t('gcMonthBar: 月ボタンが描画されている', String((el('gcMonthBar')||{}).innerHTML || '').length > 200);
t('gcMonthBar: クリックが配線されている', hasOn('gcMonthBar','click'));
t('gcCal: クリックが配線されている', hasOn('gcCal','click'));
t('gcReload: クリックが配線されている', hasOn('gcReload','click'));
t('drBtn（過去10年を分析）: クリックが配線されている', hasOn('drBtn','click'));
t('drClear（キャッシュ消去）: クリックが配線されている', hasOn('drClear','click'));
{
  const body = fs.readFileSync(path.join(ROOT, 'src/p2_body.html'), 'utf8');
  t('drCard: 分析結果の表示先が1枚に統合されている', /id="drCard"/.test(body));
  t('旧⑥分析結果カード（gcAnaCard/gcOut/gcAnaClose）は廃止',
    !/id="gcAnaCard"|id="gcOut"|id="gcAnaClose"|id="gcAnaMsg"/.test(body));
}

/* ---- ① 日付→出馬表のピッカー / 全馬プロフィール ---- */
t('rkFetch（この日のレース一覧）: クリックが配線されている', hasOn('rkFetch','click'));
t('rkToday: クリックが配線されている', hasOn('rkToday','click'));

/* ---- 静的検査: on('id', ...) の id は HTML に存在すること ---- */
{
  const srcDir = path.join(ROOT, 'src');
  const miss = [];
  // p00_fflate.js は同梱の第三者ライブラリ（minify済みUMD）なので静的検査の対象外
  fs.readdirSync(srcDir).filter(f => f.endsWith('.js') && f !== 'p00_fflate.js').forEach(f => {
    const s = fs.readFileSync(path.join(srcDir, f), 'utf8');
    const re = /\bon\(\s*'([A-Za-z0-9_\-]+)'/g;
    let mm;
    while ((mm = re.exec(s))) if (!realIds.has(mm[1])) miss.push(f + " → on('" + mm[1] + "')");
  });
  t("on('id') の参照先idがすべてHTMLに存在する", miss.length === 0, miss.join(' / '));
}

console.log((bad ? 'NG' : 'OK') + ' ' + ok + ' PASS / ' + bad + ' FAIL');
process.exit(bad ? 1 : 0);
