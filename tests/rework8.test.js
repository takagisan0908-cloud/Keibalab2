/* 2026-09-12 第15弾の回帰テスト
   実行: node tests/rework8.test.js
   検証内容:
     1) 出遅れ率を 0〜100% の範囲で扱う（入力欄・保存・AI予想のファクター）
     2) 自己学習の月別回収率: 結果が確定していない月（未来の月）は表示・学習しない
     3) 買い目提案: 10円単位を出さず、すべて100円単位（1点あたり100円の倍数）で配分
     4) 🏇馬柱AI評価の折り込み＋折り込んだまま読める「狙い目」の文章要約
     5) 🔁AI予想の自己学習カードの折り込み（長い説明は入れ子の折り込み）
     6) 🎓タイム換算の学習: 補正・上乗せの説明を折り込み
     7) ⏱前走タイムのレベル: 馬の一覧を折り込み
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

/* ======================================================================
   1) 出遅れ率は 0〜100%（旧「0〜999」を廃止）
   ====================================================================== */
(function(){
  t('slowPctOf / slowValTxt が定義されている', typeof s.slowPctOf === 'function' && typeof s.slowValTxt === 'function');
  t('slowPctOf: 999 → 100（0〜100%へ丸める）', s.slowPctOf('999') === 100, s.slowPctOf('999'));
  t('slowPctOf: 150 → 100', s.slowPctOf(150) === 100);
  t('slowPctOf: 12.5 → 12.5', s.slowPctOf('12.5') === 12.5);
  t('slowPctOf: 空・null・文字列 → 0', s.slowPctOf('') === 0 && s.slowPctOf(null) === 0 && s.slowPctOf('abc') === 0);
  t('slowPctOf: "30%" のような表記も 30', s.slowPctOf('30%') === 30);
  t('slowPctOf: 100 はそのまま', s.slowPctOf('100') === 100);
  t('slowValTxt: "999" → "100"', s.slowValTxt('999') === '100', s.slowValTxt('999'));
  t('slowValTxt: 入力途中の "12." は 12（ドットを消して125に化けさせない）', s.slowValTxt('12.') === '12', s.slowValTxt('12.'));
  t('slowValTxt: 空は空のまま（未入力）', s.slowValTxt('') === '' && s.slowValTxt(null) === '');
  t('slowValTxt: "abc" は空', s.slowValTxt('abc') === '');
  t('mkHorse: slow=999 は 100 に丸めて持つ', s.mkHorse({ slow: '999' }).slow === '100', s.mkHorse({ slow: '999' }).slow);
  t('mkHorse: slow=50 はそのまま', s.mkHorse({ slow: '50' }).slow === '50');
  t('mkHorse: slow 未指定は空', s.mkHorse({}).slow === '');
  t('出馬表のヘッダが「(0〜100)」になった', /出遅れ率%<br><span[^>]*>\(0〜100\)<\/span>/.test(HTML));
  t('旧「(0〜999)」は消えた', HTML.indexOf('(0〜999)') < 0);
  t('入力欄の title に「0〜100」と書いてある', /出遅れ率\(％・0〜100\)/.test(HTML));
  t('gridTip にも 0〜100% と書いてある', /<b>0〜100%<\/b>/.test(HTML));

  /* --- AI予想のファクター（勝率ペナルティ）も 0〜100% 前提 --- */
  t('apSlowWinMul: 未入力(0%)は 1.0（ペナルティなし）', s.apSlowWinMul('') === 1 && s.apSlowWinMul('0') === 1);
  t('apSlowWinMul: 2% は 1.0（3%未満は無視）', s.apSlowWinMul('2') === 1);
  t('apSlowWinMul: 10% で約0.87（0〜100%の率として正しく効く）', Math.abs(s.apSlowWinMul('10') - 0.868) < 0.01, s.apSlowWinMul('10'));
  t('apSlowWinMul: 25% で約0.71', Math.abs(s.apSlowWinMul('25') - 0.705) < 0.01, s.apSlowWinMul('25'));
  t('apSlowWinMul: 5% で約0.94（旧式のように3.6%以上が全部0.45に張り付かない）',
    s.apSlowWinMul('5') > 0.9 && s.apSlowWinMul('4') > 0.95, [s.apSlowWinMul('5'), s.apSlowWinMul('4')]);
  t('apSlowWinMul: 999% と 100% が同じ値（100超を丸めている）', s.apSlowWinMul('999') === s.apSlowWinMul('100'));
  t('apSlowWinMul: 100% は下限 0.45', s.apSlowWinMul('100') === 0.45, s.apSlowWinMul('100'));
  t('apSlowWinMul: 率が高いほど倍率は下がる', s.apSlowWinMul('5') > s.apSlowWinMul('30') && s.apSlowWinMul('30') > s.apSlowWinMul('80'));

  /* --- 展開エンジン（AI印）でも 999% と 100% が同じ評価になる --- */
  s.state.horses = s.demoHorses().slice(0, 6);
  Object.assign(s.state.race, { name:'サンプル', place:'中山11R', baba:'fast', dist:'2500', grade:'G1' });
  s.state.raceId = '202609040211'; s.state.learn = s.defaultLearn(); s.state.paceOverride = null;
  s.state.horses.forEach(function(h){ h.slow = ''; });
  function us(){
    const r = s.analyzeRace();
    return r.rows.map(function(x){ return x.h.no + ':' + x.U.toFixed(9); }).join(',');
  }
  s.state.horses[0].slow = '100'; const u100 = us();
  s.state.horses[0].slow = '999'; const u999 = us();
  s.state.horses[0].slow = '';    const u0 = us();
  t('エンジン: 出遅れ率999% は 100% とまったく同じ評価', u100 === u999, [u100, u999]);
  t('エンジン: 出遅れ率100% は 0% より評価が下がる', u100 !== u0);
  s.state.horses[0].slow = '999';
  const rr = s.analyzeRace();
  const row0 = rr.rows.filter(function(x){ return String(x.h.no) === String(s.state.horses[0].no); })[0] || {};
  t('コメントに出遅れ率100%と出る（999%とは出ない）',
    /出遅れ率100%/.test(row0.comment || '') && !/999/.test(row0.comment || ''), row0.comment);
  t('slowAppliedNote が出る（10%以上）', !!rr.slowAppliedNote && /出遅れ率10%以上/.test(rr.slowAppliedNote), rr.slowAppliedNote);
  s.state.horses.forEach(function(h){ h.slow = ''; });

  /* --- シミュレーター側も 0〜100% --- */
  t('simSlowRate: 999% でも 100% と同じ抽選確率（90%上限）',
    (function(){
      let a = 0, b = 0;
      const orig = Math.random;
      Math.random = function(){ return 0.5; };        // 0.5*100=50 < min(90, sl) なら不利になる
      try { a = s.simSlowRate({ slow: '999' }) < 1 ? 1 : 0; b = s.simSlowRate({ slow: '100' }) < 1 ? 1 : 0; }
      finally { Math.random = orig; }
      return a === 1 && b === 1;
    })());
  t('simSlowRate: 5% は不利なし', s.simSlowRate({ slow: '5' }) === 1);
})();

/* ======================================================================
   2) 自己学習の月別回収率: 結果が確定していない月（未来の月）は出さない
   ====================================================================== */
function shiftYm(ym, d){
  let y = parseInt(String(ym).slice(0, 4), 10), m = parseInt(String(ym).slice(4, 6), 10) + d;
  while (m < 1){ m += 12; y--; }
  while (m > 12){ m -= 12; y++; }
  return y + ('0' + m).slice(-2);
}
(function(){
  t('apNowYm / apYmState / apYmIsFinal が定義されている',
    typeof s.apNowYm === 'function' && typeof s.apYmState === 'function' && typeof s.apYmIsFinal === 'function');
  const nowYm = s.apNowYm();
  t('apNowYm は yyyymm 6桁', /^\d{6}$/.test(nowYm), nowYm);
  const prevYm = shiftYm(nowYm, -1), nextYm = shiftYm(nowYm, 1);
  t('先月は past', s.apYmState(prevYm) === 'past' && s.apYmIsFinal(prevYm) === true);
  t('今月は cur（結果が確定途中）', s.apYmState(nowYm) === 'cur' && s.apYmIsFinal(nowYm) === false);
  t('来月は future（今日はまだ来ていない）', s.apYmState(nextYm) === 'future');
  t('障害バケット(来月#障)も future', s.apYmState(nextYm + '#障') === 'future');

  function mkB(ym, n){
    const b = s.apBucket(ym);
    ['hit', 'roi', 'hyb'].forEach(function(cid){
      b.c[cid].n = n; b.c[cid].horseN = n * 5; b.c[cid].horseTop3 = n * 2;
      b.c[cid].boostN = 10; b.c[cid].boostTop3 = 4; b.c[cid].costU = n * 100; b.c[cid].grossU = n * 90;
    });
    return b;
  }
  const keepMode = s.apMode;
  s.apMode = 'ls';
  [prevYm, nowYm, nextYm].forEach(function(k){
    s.localStorage.removeItem('khl_apm_' + k);
    s.localStorage.removeItem('khl_apm_' + k + '#障');
  });
  s.apMBSaveLs(mkB(prevYm, 30));
  s.apMBSaveLs(mkB(nextYm, 12));     // ← 今日はまだ来ていない月の集計（＝結果が確定していない）
  const st = s.apStatsHTML();
  t('月別の表に先月（結果確定）が出る', st.indexOf(s.apYmTxt(prevYm)) >= 0, s.apYmTxt(prevYm));
  t('月別の表（行）に未来の月が出ない', st.indexOf('<td style="white-space:nowrap">' + s.apYmTxt(nextYm)) < 0 &&
    st.indexOf('📅 ' + s.apYmTxt(nextYm)) < 0, s.apYmTxt(nextYm));
  t('未来の月を除外した注記が出る', /結果が確定していない月/.test(st) && /🚫/.test(st));
  t('注記に今日の月が出る', st.indexOf(s.apYmTxt(nowYm)) >= 0);
  t('apParamsFor: 未来月のバケットは学習に使わない',
    s.apParamsFor('999912').totalR === 30, s.apParamsFor('999912').totalR);

  s.apMBSaveLs(mkB(nowYm, 8));
  const st2 = s.apStatsHTML();
  t('今月ぶんは「今月・結果は確定途中」の印を付けて出す', /今月・結果は確定途中/.test(st2), (st2.match(/今月[^<]*/g) || []).slice(0, 3));
  t('今月ぶんは表に残る（未来月だけ消す）', st2.indexOf(s.apYmTxt(nowYm)) >= 0);
  t('apParamsFor: 今月ぶんは学習に使える', s.apParamsFor('999912').totalR === 38, s.apParamsFor('999912').totalR);

  /* 折り込んだ🔁カードの summary にも要点が出る */
  s.apRender();
  const pk = find('apPick')._html || '';
  t('apRender で #apPick（折り込んだままの1行要約）が埋まる', /📚/.test(pk) && /結果が確定した/.test(pk), pk.slice(0, 200));
  t('#apPick に学習パラメータ（🎯/💰/🔰）が出る', /🎯/.test(pk) && /💰/.test(pk) && /🔰/.test(pk));
  t('#apPick に直近の学習月が出る', pk.indexOf(s.apYmTxt(prevYm)) >= 0, pk.slice(0, 260));
  const cnt = find('apCount')._text || '';
  t('apCount（chip）も未来月を含めない', /学習 38 レース/.test(cnt), cnt);
  s.apMode = keepMode;
  [prevYm, nowYm, nextYm].forEach(function(k){ s.localStorage.removeItem('khl_apm_' + k); });
})();

/* ======================================================================
   3) 買い目提案は 100円単位（10円単位の資金配分を出さない）
   ====================================================================== */
(function(){
  s.state.horses = s.demoHorses().slice(0, 6);
  Object.assign(s.state.race, { name:'サンプル', place:'中山11R', baba:'fast', dist:'2500', grade:'G1' });
  s.state.raceId = '202609040211'; s.state.learn = s.defaultLearn(); s.state.paceOverride = null;
  s.state.horses.forEach(function(h){ h.slow = ''; });
  const res = s.analyzeRace();
  [['2000', 'b'], ['2050', 'b'], ['1000', 'a'], ['5000', 'k'], ['100', 'b'], ['300', 'a'], ['10000', 'b'], ['777', 'k']].forEach(function(c){
    s.document.getElementById('buyMoney').value = c[0];
    s.document.getElementById('buyMode').value = c[1];
    const sheet = s.betSheetHTML(res);
    const amts = (sheet.match(/<span class="amt">(\d+)円<\/span>/g) || []).map(function(x){ return parseInt(x.replace(/[^0-9]/g, ''), 10); });
    const per = (sheet.match(/(\d+)点×(\d+)円/g) || []).map(function(x){ return parseInt(x.split('×')[1], 10); });
    const tot = (sheet.match(/合計 <b>(\d+)円<\/b>/) || [])[1];
    const budget = Math.floor(parseInt(c[0], 10) / 100) * 100;
    const tag = '買い目 予算' + c[0] + '(' + c[1] + ')';
    t(tag + ': 券種の金額が全部100円単位', amts.length >= 1 && amts.every(function(v){ return v % 100 === 0; }), amts.join(','));
    t(tag + ': 1点あたりの金額も100円単位（10円単位を出さない）', per.every(function(v){ return v % 100 === 0; }), per.join(','));
    t(tag + ': 合計が100円単位に切り下げた予算と一致',
      parseInt(tot, 10) === budget && amts.reduce(function(a, b){ return a + b; }, 0) === budget, [tot, budget, amts.join(',')]);
    const allYen = (sheet.match(/(\d+)円/g) || []).map(function(x){ return parseInt(x.replace(/[^0-9]/g, ''), 10); });
    t(tag + ': 表示される金額はすべて100円単位（入力した予算の表示だけ例外）',
      allYen.every(function(v){ return v % 100 === 0 || v === parseInt(c[0], 10); }), allYen.join(','));
  });
  /* 3頭未満では3連複を出さない（1点100円のまま買えない買い目を作らない） */
  s.document.getElementById('buyMoney').value = '2000';
  s.document.getElementById('buyMode').value = 'b';
  const res2 = s.analyzeRace();
  res2.rows = res2.rows.slice(0, 2);
  const sh2 = s.betSheetHTML(res2);
  t('2頭しか居ないときは3連複Boxを出さない', sh2.indexOf('3連複Box') < 0 && /3頭未満のため3連複は外しました/.test(sh2), sh2.slice(0, 200));
  t('2頭のときも金額は100円単位', (sh2.match(/<span class="amt">(\d+)円<\/span>/g) || []).every(function(x){ return parseInt(x.replace(/[^0-9]/g, ''), 10) % 100 === 0; }));
  /* 予算が100円未満（馬券は100円単位でしか買えない） */
  s.document.getElementById('buyMoney').value = '50';
  const sh3 = s.betSheetHTML(res);
  t('予算100円未満は注意文を返す（10円単位の配分を出さない）',
    /予算は100円以上（100円単位）で指定してください/.test(sh3) && sh3.indexOf('<span class="amt">') < 0, sh3.slice(0, 140));
  s.document.getElementById('buyMoney').value = '2000';
})();

/* ======================================================================
   4) 🏇 馬柱AI評価: 折り込み ＋ 折り込んだまま読める「狙い目」の文章要約
   ====================================================================== */
(function(){
  t('aihCard が details.card.fold（折り込み）', /<details class="card fold" id="aihCard"/.test(HTML));
  t('既定は閉じている（open が付いていない）', !/<details class="card fold" id="aihCard"[^>]*open/.test(HTML));
  t('#aihPick（狙い目の文章要約）が summary の中にある',
    /<summary class="foldhead">(?:(?!<\/summary>)[\s\S])*id="aihPick"(?:(?!<\/summary>)[\s\S])*<\/summary>/.test(HTML));
  t('.foldpick のCSSがある', /details\.card\.fold>summary\.foldhead \.foldpick\{/.test(HTML));
  t('再取得ボタン(aihBtn)と表(aihOut)は折り込みの中', HTML.indexOf('id="aihBtn"') > HTML.indexOf('id="aihPick"') &&
    HTML.indexOf('id="aihOut"') > HTML.indexOf('id="aihBtn"'));
  t('aihPickHTML / aihPaintPick / aihPickScore が定義されている',
    typeof s.aihPickHTML === 'function' && typeof s.aihPaintPick === 'function' && typeof s.aihPickScore === 'function');
  t('aihVenueOf: 「東京 芝 1600m」→東京', s.aihVenueOf('東京 芝 1600m') === '東京' && s.aihVenueOf('中山11R') === '中山');
  t('aihBabaOf: fast→良 / dirt_seal→重', s.aihBabaOf('fast') === '良' && s.aihBabaOf('dirt_seal') === '重');

  const store = {
    '900001': { p:{}, at: Date.now(), r: [
      { venueName:'東京', surface:'芝', m:1600, order:1, date:'2026/05/10', baba:'良', head:'18', passing:'3-3-3-2' },
      { venueName:'東京', surface:'芝', m:1800, order:2, date:'2026/03/08', baba:'良', head:'16', passing:'5-5-4-3' },
      { venueName:'中山', surface:'芝', m:1600, order:4, date:'2025/12/14', baba:'良', head:'16', passing:'8-8-7-6' },
      { venueName:'東京', surface:'芝', m:1600, order:3, date:'2025/10/05', baba:'稍重', head:'18', passing:'6-6-5-4' } ] },
    '900002': { p:{}, at: Date.now(), r: [
      { venueName:'中山', surface:'ダ', m:1200, order:1, date:'2026/04/11', baba:'良', head:'16', passing:'1-1-1-1' },
      { venueName:'中山', surface:'ダ', m:1200, order:2, date:'2026/02/15', baba:'良', head:'16', passing:'2-2-2-2' } ] }
  };
  const prevGet = s.localStorage.getItem;
  s.localStorage.getItem = function(k){ return k === 'khl_hd_v1' ? JSON.stringify(store) : prevGet.call(s.localStorage, k); };
  const keepH = s.state.horses;
  s.state.horses = [ s.mkHorse({ no:'1', name:'ア狙イ', nk:'900001' }), s.mkHorse({ no:'2', name:'イ割引', nk:'900002' }) ];
  Object.assign(s.state.race, { name:'東京11R サンプル', place:'東京 芝 1600m', baba:'fast', dist:'1600' });
  const pick = s.aihPickHTML();
  t('狙い目の文章に「🎯 狙い目」が出る', /🎯 <b>狙い目<\/b>/.test(pick), pick.slice(0, 120));
  t('今回の条件（芝・東京・1600m・良）が要約に出る', /今回芝/.test(pick) && /東京/.test(pick) && /1600m/.test(pick) && /良/.test(pick), pick.slice(0, 200));
  t('条件が合う馬が①付きで出る', /①<b>1番ア狙イ<\/b>/.test(pick), pick.slice(0, 240));
  t('芝実績の無い馬は「⚠ 割引」へ回る', /⚠ 割引/.test(pick) && /2番イ割引/.test(pick) && /芝実績なし/.test(pick), pick.slice(0, 300));
  t('要約に内訳（複勝圏%・同じ開催場・距離帯）が出る', /複勝圏/.test(pick) && /マイル/.test(pick), pick.slice(0, 300));
  s.aihRender();
  t('aihRender で #aihPick が書き換わる（折り込んだままでも読める）',
    (find('aihPick')._html || '').indexOf('ア狙イ') >= 0, (find('aihPick')._html || '').slice(0, 120));
  t('aihRender で表(#aihOut)も従来どおり出る', /芝の実績/.test(find('aihOut')._html || ''));
  /* 馬柱が無いときは案内文に戻る */
  s.localStorage.getItem = function(k){ return k === 'khl_hd_v1' ? JSON.stringify({}) : prevGet.call(s.localStorage, k); };
  s.aihRender();
  t('馬柱データが無いときは案内文（狙い目は空）', /まだ馬柱データがありません/.test(find('aihOut')._html || '') &&
    /出馬表を取り込むと/.test(find('aihPick')._html || ''));
  s.localStorage.getItem = prevGet;
  s.state.horses = keepH;
})();

/* ======================================================================
   5) 🔁 AI予想の自己学習カードの折り込み（長い説明は入れ子の折り込み）
   ====================================================================== */
(function(){
  t('apCard が details.card.fold（折り込み）', /<details class="card fold" id="apCard"/.test(HTML));
  t('apCard は既定で閉じている', !/<details class="card fold" id="apCard"[^>]*open/.test(HTML));
  t('長い説明は入れ子の <details>（📖 自己学習のしくみ・回収率の計算方法）',
    /📖 自己学習のしくみ・回収率の計算方法の説明を開く／閉じる/.test(HTML));
  t('入れ子の説明の中に「回収率の計算」が入っている', (function(){
    const i = HTML.indexOf('📖 自己学習のしくみ');
    const seg = HTML.slice(i, i + 4000);
    return /1万円/.test(seg) && /年指定の一括取得/.test(seg) && /再学習する/.test(seg);
  })());
  t('反映するチェック(apUseChk)・再学習(apRelearn)・リセット(apReset)は残っている',
    /id="apUseChk"/.test(HTML) && /id="apRelearn"/.test(HTML) && /id="apReset"/.test(HTML));
  t('カードの見出しに「結果が確定していない月は表示・学習の対象外」と書いてある',
    /結果が確定していない月（今日はまだ来ていない月）は表示・学習の対象外/.test(HTML));
  t('説明に「結果が確定していない月は表示しません」の項がある',
    /📅 <b>結果が確定していない月は表示しません<\/b>/.test(HTML));
})();

/* ======================================================================
   6) 🎓 タイム換算の学習: 補正・上乗せの説明を折り込む
   7) ⏱ 前走タイムのレベル: 馬の一覧を折り込む
   ====================================================================== */
(function(){
  t('🎓の説明が折り込み（📖 タイム換算の学習のしかた）', /📖 タイム換算の学習のしかた/.test(HTML));
  t('🎓の折り込み説明に「補正の内訳」と「距離帯ごとのクラス差の上乗せ」がある', (function(){
    const i = HTML.indexOf('📖 タイム換算の学習のしかた');
    if (i < 0) return false;
    const seg = HTML.slice(i, i + 3000);
    return /学習している補正の内訳/.test(seg) && /距離帯ごとのクラス差の上乗せ/.test(seg) &&
      /クラス補正/.test(seg) && /馬場補正/.test(seg) && /障害は平地（芝・ダート）とは別枠/.test(seg);
  })());
  t('🎓の折り込みは既定で閉じている', (function(){
    const i = HTML.indexOf('📖 タイム換算の学習のしかた');
    return HTML.lastIndexOf('<details', i).valueOf() > 0 && !/<details[^>]*open[^>]*>\s*$/.test(HTML.slice(HTML.lastIndexOf('<details', i), i));
  })());
  t('🎓学習結果の補正一覧も折り込み（tlLearnRender）', /🔧 学習した<b>補正<\/b>の内訳と距離帯の<b>上乗せ<\/b>を開く／閉じる/.test(HTML));
  t('⏱の馬の一覧が折り込み（tlRender）', /🐎 評価した馬の一覧を開く／閉じる/.test(HTML));
  t('⏱の折り込み summary に🎯/⚠️の馬名要約が出る', /🎯 時計が速い: <b>/.test(HTML) && /⚠️ 勝ち時計が遅い: <b>/.test(HTML));
  t('⏱の判定説明も折り込み（📖 判定のしかた）', /📖 判定のしかた（🎯\/⚠️の付け方・比較のしかた・馬場換算）の説明を開く／閉じる/.test(HTML));
})();

Promise.resolve().then(function(){
  console.log((bad ? 'FAIL' : 'PASS') + ' rework8(第15弾): ok=' + ok + ' bad=' + bad);
  process.exit(bad ? 1 : 0);
}, function(e){
  console.log('FAIL rework8 (unhandled): ' + (e && e.message || e));
  process.exit(1);
});
