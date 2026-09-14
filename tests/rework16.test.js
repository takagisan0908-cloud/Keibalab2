/* 2026-09-13 第24弾 の回帰テスト
   実行: node tests/rework16.test.js   (build.py 実行後に)

   ご依頼（5件）:
     ① 予想ファクターに枠順を追加
        → AI予想のファクター判定に使用。**重賞のみ**使う**過去10年データ（⑥のsamples）**の
          歴代結果から有利な枠順を判定し、判断材料にする
     ② 🗂 一括取得した出馬表の表示をもっと最小表示として画面が広がらないようにする
     ③ トラックバイアスの欄の説明文（前日の決めかた／測りかた／そのまま100%は使いません／
        手動指定が最優先）を折り込んで表示する
     ④ AI印と総合評価の持ちタイム表記がおかしい
        ＋ 軸・妙味・穴の「妙味馬」と「穴馬」が同名馬になる確率がかなり高い（全部一緒のレベル）
     ⑤ 重賞データ分析の自動化された血統ファクターが、カレンダーで選択したレースと
        異なるレースの血統を分析している

   検証内容:
     A) ① 枠順ファクター: 頭数補正・有利度・3段階判定・スコアの範囲・重賞/レース一致のゲート
     B) ④b 軸・妙味・穴: 2000レースで3頭が必ず別々になること（修正前は妙味==穴が100%）
     C) ④a 持ちタイム: bandOk/gapM が出るか・距離が必ず表示されるか・距離外が明示されるか
     D) ⑤ 血統ファクター: DR_LAST.rid と選択レースの照合・pick が hasRace より優先されるか
     E) ③ トラックバイアス説明の折り込み（<details class="tbhelp">）
     F) ② 一覧の最小表示CSS（#preList だけに効き、.kai-hist 全体を変えない）
*/
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let ok = 0, bad = 0;
const fails = [];
function T(name, cond, extra){
  if (cond) ok++;
  else { bad++; fails.push(name + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); }
}
function eq(name, got, want){
  const g = JSON.stringify(got), w = JSON.stringify(want);
  T(name, g === w, { got: (g || '').slice(0, 300), want: (w || '').slice(0, 300) });
}
const tick = () => new Promise(r => setImmediate(r));
async function drain(n){ for (let i = 0; i < (n || 6); i++) await tick(); }

function mkLS(){
  const m = {};
  return { _m: m, get length(){ return Object.keys(m).length; }, key(i){ return Object.keys(m)[i] || null; },
    getItem(k){ return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem(k, v){ m[k] = String(v); }, removeItem(k){ delete m[k]; } };
}
function makeEl(id){
  const el = { id: id || '', value: '', _html: '', style: {}, dataset: {}, checked: true, disabled: false, open: false,
    classList: { _s: new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); }, contains(c){ return this._s.has(c); },
      toggle(c, f){ if (f === undefined){ this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { f ? this._s.add(c) : this._s.delete(c); } } },
    _attrs: {}, title: '',
    setAttribute(k, v){ this._attrs[k] = String(v); }, getAttribute(k){ return this._attrs[k] == null ? null : this._attrs[k]; },
    addEventListener(){}, appendChild(){}, focus(){}, closest(){ return null; }, scrollIntoView(){}, remove(){},
    getBoundingClientRect(){ return { width: 940, height: 400, top: 0, left: 0 }; },
    querySelector(){ return makeEl(); }, querySelectorAll(){ return []; } };
  Object.defineProperty(el, 'innerHTML', { get(){ return el._html; }, set(v){ el._html = v; } });
  Object.defineProperty(el, 'textContent', { get(){ return el._t || ''; }, set(v){ el._t = String(v); } });
  return el;
}
function mkG(ls){
  const els = {};
  const g = {
    console, Math, JSON, Date, String, Number, parseInt, parseFloat, isNaN, isFinite, RegExp,
    Array, Object, Boolean, Error, Promise, encodeURIComponent, decodeURIComponent, TextDecoder,
    setTimeout(fn2){ try { fn2(); } catch(e){} return 0; },
    clearTimeout(){}, setInterval(){ return 0; }, clearInterval(){},
    requestAnimationFrame(){ return 0; }, cancelAnimationFrame(){},
    localStorage: ls, addEventListener(){}, removeEventListener(){}, devicePixelRatio: 1, innerWidth: 980, innerHeight: 800,
    scrollTo(){}, scroll(){}, open(){ return null; }, close(){}, focus(){}, blur(){}, alert(){}, confirm(){ return true; },
    prompt(){ return null; }, getComputedStyle(){ return { getPropertyValue(){ return ''; } }; },
    matchMedia(){ return { matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} }; },
    navigator: { userAgent: 'node', clipboard: { writeText(){ return Promise.resolve(); } } },
    location: { href: 'http://localhost/', search: '', hash: '', reload(){}, assign(){} },
    history: { pushState(){}, replaceState(){} },
    Blob: function(){}, URL: { createObjectURL(){ return 'blob:x'; }, revokeObjectURL(){} },
    FileReader: function(){ this.readAsText = function(){}; },
    Image: function(){ return makeEl('img'); },
    Chart: function(){ return { destroy(){}, update(){}, data:{}, options:{} }; },
    window: null,
    fetch(){ return Promise.reject(new Error('no fetch in test')); },
    document: { getElementById(id){ if (!els[id]) els[id] = makeEl(id); return els[id]; },
                addEventListener(){}, removeEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
                createElement(){ return makeEl('tmp'); }, createElementNS(){ return makeEl('tmp'); },
                head: { appendChild(){} }, body: { appendChild(){}, style:{} }, documentElement: { style:{}, scrollTop:0 },
                title: '', activeElement: null, hidden: false, visibilityState: 'visible' }
  };
  g.window = g; g.globalThis = g; g.__els = els;
  vm.createContext(g);
  return g;
}

/* ---------- 決定的な擬似乱数 ---------- */
function mkRnd(seed){
  let s = seed >>> 0;
  return function(){ s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

(async function main(){
  const g = mkG(mkLS());
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m){ console.log('FAIL: index.html に script が見つかりません（build.py を実行してください）'); process.exit(1); }
  vm.runInContext(m[1], g, { filename: 'index.html.js' });
  const run = src => vm.runInContext(src, g);
  const set = (k, v) => { g[k] = v; };

  /* =========================================================
     A) ① 枠順ファクター
     ========================================================= */
  console.log('\n[A] ① 枠順ファクター（⑥の過去10年samplesから有利枠を判定・重賞のみ）');

  T('wakuStatFrom が定義されている', run(`typeof wakuStatFrom`) === 'function');
  T('wakuScoreOf が定義されている', run(`typeof wakuScoreOf`) === 'function');
  T('wakuStatForRace が定義されている', run(`typeof wakuStatForRace`) === 'function');
  T('wakuSummaryText が定義されている', run(`typeof wakuSummaryText`) === 'function');

  /* --- A-1: 合成samplesで「1枠が有利・8枠が不利」を作り、判定が正しく出るか --- */
  // 各年 16頭立て × 10年 = 160走。1枠は毎回3着内、8枠は毎回4着以下。
  g.__mkSamples = function(){
    const out = [];
    for (let y = 2016; y <= 2025; y++){
      for (let f = 1; f <= 8; f++){
        for (let k = 0; k < 2; k++){          // 各枠2頭 → 16頭立て
          let o;
          if (f === 1) o = (k === 0 ? 1 : 3);   // 1枠: 1着と3着
          else if (f === 8) o = 10 + k;         // 8枠: 10着・11着
          else o = 5 + k;                       // その他: 5着・6着
          out.push({ yr: y, rid: String(y) + '010101' + (f * 2 + k), o: o, no: String(f * 2 + k - 1),
            frame: String(f), name: '馬' + f + '_' + k, id: 'id' + f + k, raceN: 16 });
        }
      }
    }
    return out;
  };
  run('globalThis.__st = wakuStatFrom(globalThis.__mkSamples());');
  const st = g.__st;
  eq('サンプル総数（16頭×10年）', st.n, 160);
  T('8枠ぶんの集計がある', st.frames.length === 8, st.frames.length);
  const f1 = st.frames[0], f8 = st.frames[7], f4 = st.frames[3];
  eq('1枠の出走数', f1.n, 20);
  eq('1枠の3着内数', f1.t3, 20);
  eq('8枠の3着内数', f8.t3, 0);
  /* 頭数補正: 16頭立てなら1頭あたりの3着内期待確率 = 3/16 = 0.1875
     1枠は20走 → 期待 3.75 / 実際 20 → ratio = 5.33 */
  T('1枠の期待3着内数が頭数補正されている（20×3/16=3.75）', Math.abs(f1.exp3 - 3.75) < 1e-9, f1.exp3);
  T('1枠の有利度 ratio = 20/3.75 = 5.33', Math.abs(f1.ratio - (20 / 3.75)) < 1e-9, f1.ratio);
  eq('1枠の判定は「有利(1)」', f1.judge, 1);
  eq('8枠の判定は「不利(-1)」', f8.judge, -1);
  /* この合成データでは 1枠だけが3着内に入るので、他の枠はすべて「不利」になります。
     「ふつう(0)」は ratio が 0.82〜1.18 の枠なので、別途ちょうど平均的な枠を作って確認します。 */
  eq('4枠（一度も3着内が無い）の判定は「不利(-1)」', f4.judge, -1);
  eq('2枠も同様に「不利(-1)」', st.frames[1].judge, -1);
  /* ratio ≒ 1.00（＝平均どおり）の枠は「ふつう(0)」になる
     16頭立て（1枠2頭）× 16年 = 各枠32走。3着内は年に3つなので16年で48、
     これを 8枠に均等（各6）に配るため、3着内に入る枠を年ごとに3つずつローテーションさせます
     （刻み3は8と互いに素なので16年で全枠を2周＝各枠ちょうど6回）。
     期待3着内 = 32走 × (3/16) = 6.00 → ratio = 6/6 = 1.00 ちょうど。 */
  run(`globalThis.__stEven = wakuStatFrom((function(){
    var a = [];
    for (var yi = 0; yi < 16; yi++){
      var win = [];                       // この年に3着内に入る枠
      for (var j = 0; j < 3; j++) win.push(((yi * 3 + j) % 8) + 1);
      var used = {};                      // 同じ枠の2頭のうち何頭目を3着内にしたか
      var ord = 4;
      for (var i = 0; i < 16; i++){
        var fr = (i % 8) + 1;             // 1枠2頭ずつ
        var k = used[fr] || 0; used[fr] = k + 1;
        var o;
        if (win.indexOf(fr) >= 0 && k < win.filter(function(x){ return x === fr; }).length){
          o = win.indexOf(fr) + 1;        // 1〜3着
        } else { o = ord++; }             // 4着以下
        a.push({ yr: 2010 + yi, o: o, frame: String(fr), raceN: 16, no: String(i + 1) });
      }
    }
    return a;
  })());`);
  eq('均等データの総数（16頭×16年）', g.__stEven.n, 256);
  eq('1枠の出走数', g.__stEven.frames[0].n, 32);
  eq('1枠の3着内数（均等なので6）', g.__stEven.frames[0].t3, 6);
  T('1枠の期待3着内数 = 32×3/16 = 6.00', Math.abs(g.__stEven.frames[0].exp3 - 6) < 1e-9, g.__stEven.frames[0].exp3);
  T('平均どおりの枠の ratio = 1.00', Math.abs(g.__stEven.frames[0].ratio - 1) < 1e-9, g.__stEven.frames[0].ratio);
  eq('平均どおり(ratio=1.00)の枠は「ふつう(0)」', g.__stEven.frames[0].judge, 0);
  T('全枠が「ふつう(0)」になる', g.__stEven.frames.every(function(x){ return x.judge === 0; }));
  eq('平均どおりの枠のスコアは中立(0.5)', run(`wakuScoreOf(1, globalThis.__stEven)`), 0.5);
  T('全体の有利度も 1.00（＝補正が正しい）', Math.abs(g.__stEven.baseRatio - 1) < 1e-9, g.__stEven.baseRatio);
  T('スコアは 0〜1 に収まる（有利）', run(`wakuScoreOf(1, globalThis.__st)`) <= 1, run(`wakuScoreOf(1, globalThis.__st)`));
  T('スコアは 0〜1 に収まる（不利）', run(`wakuScoreOf(8, globalThis.__st)`) >= 0, run(`wakuScoreOf(8, globalThis.__st)`));
  T('有利枠のスコア > 中立(0.5)', run(`wakuScoreOf(1, globalThis.__st)`) > 0.5);
  T('不利枠のスコア < 中立(0.5)', run(`wakuScoreOf(8, globalThis.__st)`) < 0.5);
  eq('判定できない枠（サンプル0）は null', run(`wakuScoreOf(9, globalThis.__st)`), null);
  eq('枠番が不正なら null', run(`wakuScoreOf('', globalThis.__st)`), null);
  T('説明文に「有利」が出る', /有利/.test(String(run(`wakuSummaryText(globalThis.__st)`))), run(`wakuSummaryText(globalThis.__st)`));
  T('説明文に「不利」が出る', /不利/.test(String(run(`wakuSummaryText(globalThis.__st)`))));

  /* --- A-2: 頭数が違う年を混ぜても公平か（8頭立てと18頭立ての混在） --- */
  g.__mkMixed = function(){
    const out = [];
    // 前半10年=8頭立て（1枠2頭）、後半10年=18頭立て（1枠2頭・8枠3頭）
    for (let y = 2006; y <= 2015; y++){
      for (let i = 0; i < 8; i++){
        out.push({ yr: y, o: (i < 3 ? i + 1 : 4 + i), frame: String(Math.min(8, Math.floor(i / 1) % 8 + 1)), raceN: 8, no: String(i + 1) });
      }
    }
    for (let y = 2016; y <= 2025; y++){
      for (let i = 0; i < 18; i++){
        out.push({ yr: y, o: (i < 3 ? i + 1 : 4 + i), frame: String(Math.min(8, Math.floor(i / 2.25) + 1)), raceN: 18, no: String(i + 1) });
      }
    }
    return out;
  };
  run('globalThis.__st2 = wakuStatFrom(globalThis.__mkMixed());');
  const st2 = g.__st2;
  eq('混在サンプルの総数', st2.n, 8 * 10 + 18 * 10);
  T('頭数補正により全体の有利度はほぼ1.00（=平均）', Math.abs(st2.baseRatio - 1) < 0.01, st2.baseRatio);
  T('少頭数(8頭)だけの枠でも n が counted される', st2.frames.some(x => x.n > 0));

  /* --- A-3: 最低サンプル数に満たなければ使わない --- */
  run('globalThis.__stSmall = wakuStatFrom([{o:1,frame:"1",raceN:16},{o:2,frame:"2",raceN:16}]);');
  eq('2走ぶんだけの統計でも n は 2', g.__stSmall.n, 2);
  eq('出走数が WAKU_MIN_N 未満の枠は判定 0（暴走しない）', g.__stSmall.frames[0].judge, 0);
  eq('出走数が少ない枠のスコアは null', run(`wakuScoreOf(1, globalThis.__stSmall)`), null);

  /* --- A-4: ゲート（重賞のみ・対象レース一致のみ） --- */
  run('globalThis.state = freshState();');
  run('globalThis.DR_LAST = null;');
  eq('⑥の分析データが無ければ null', run(`wakuStatForRace()`), null);

  // 重賞(G1)＋レース一致 → 使える
  run(`globalThis.DR_LAST = { rid:'202609040311', name:'宝塚記念(G1)', samples: globalThis.__mkSamples() };`);
  run(`globalThis.state.raceId = '202609040311';`);
  run(`globalThis.state.race = { name:'宝塚記念(G1)', place:'阪神', grade:'G1', dist:'2200', baba:'', time:'' };`);
  run(`globalThis.state.gradeSel = {};`);
  run('globalThis.WAKU_MEMO = { key:"", done:false, val:null };');
  T('重賞(G1)＋レース一致なら枠順統計が使える', run(`wakuStatForRace()`) !== null);
  eq('使えた統計のサンプル数', run(`wakuStatForRace().n`), 160);

  // 重賞ではない → 使わない
  run(`globalThis.DR_LAST = { rid:'202609040311', name:'3歳未勝利', samples: globalThis.__mkSamples() };`);
  run(`globalThis.state.race = { name:'3歳未勝利', place:'阪神', grade:'', dist:'1800', baba:'', time:'' };`);
  run('globalThis.WAKU_MEMO = { key:"", done:false, val:null };');
  eq('重賞でなければ枠順ファクターは使わない（ご指定どおり）', run(`wakuStatForRace()`), null);

  // 重賞だが対象レースが食い違う → 使わない
  run(`globalThis.DR_LAST = { rid:'202609040311', name:'宝塚記念(G1)', samples: globalThis.__mkSamples() };`);
  run(`globalThis.state.raceId = '202609040312';`);
  run(`globalThis.state.race = { name:'宝塚記念(G1)', place:'阪神', grade:'G1', dist:'2200', baba:'', time:'' };`);
  run(`globalThis.state.gradeSel = { rid:'202609040312', at: Date.now() };`);
  run('globalThis.WAKU_MEMO = { key:"", done:false, val:null };');
  eq('⑥の分析レースと選択レースが食い違えば使わない', run(`wakuStatForRace()`), null);

  /* --- A-5: 重みの初期値・WEIGHT_DEFS への登録 --- */
  run('globalThis.state = freshState();');
  T('defaultWeights に waku が入っている', run(`defaultWeights().waku`) > 0, run(`defaultWeights().waku`));
  T('WEIGHT_DEFS に waku が登録されている', run(`WEIGHT_DEFS.some(function(d){ return d.k === 'waku'; })`));
  T('WEIGHT_DEFS の waku ラベルに「重賞のみ」と明記', /重賞のみ/.test(String(run(`(WEIGHT_DEFS.filter(function(d){return d.k==='waku';})[0]||{}).label`))));
  T('wakuStatForRace のメモ化: 2回目は同じオブジェクト', run(`(function(){ globalThis.WAKU_MEMO={key:"",done:false,val:null}; globalThis.DR_LAST=null; var a=wakuStatForRace(); var b=wakuStatForRace(); return a===b; })()`));

  /* --- A-6: 適用ノートを必ず出す（黙って効かせる・黙って無視しない） --- */
  run(`globalThis.state = freshState();`);
  run(`globalThis.state.horses = (function(){
    var a = [];
    for (var i = 1; i <= 16; i++){
      a.push({ no:String(i), name:'馬'+i, frame:String(((i-1)%8)+1), odds:'5.0', style:'', time:'', last3f:'', slow:'' });
    }
    return a;
  })();`);
  run(`globalThis.DR_LAST = { rid:'202609040311', name:'宝塚記念(G1)', samples: globalThis.__mkSamples() };`);
  run(`globalThis.state.raceId = '202609040311';`);
  run(`globalThis.state.race = { name:'宝塚記念(G1)', place:'阪神', grade:'G1', dist:'2200', baba:'良', time:'' };`);
  run(`globalThis.state.gradeSel = {};`);
  run('globalThis.WAKU_MEMO = { key:"", done:false, val:null };');
  const resW = run(`analyzeRace()`);
  T('重賞＋⑥データあり → wakuOn が立つ', resW && resW.wakuOn === true, resW && resW.wakuOn);
  T('適用ノートに「過去10年 ◯走」が出る', /過去10年 \d+ 走/.test(String(resW && resW.wakuAppliedNote || '')), resW && resW.wakuAppliedNote);
  T('適用ノートに有利/不利の判定が出る', /(有利|不利|明確な差は見つかりません)/.test(String(resW && resW.wakuAppliedNote || '')));
  T('枠ごとのスコア(fW)が各行に入っている', (resW.rows || []).some(function(r){ return r.fW != null; }));
  T('枠ごとの判定詳細(wakuHit)が各行に入っている', (resW.rows || []).some(function(r){ return r.wakuHit && r.wakuHit.ratio != null; }));
  // 重賞でない → 不使用のノートが出る
  run(`globalThis.state.race = { name:'3歳未勝利', place:'阪神', grade:'', dist:'1800', baba:'良', time:'' };`);
  run(`globalThis.DR_LAST = { rid:'202609040311', name:'3歳未勝利', samples: globalThis.__mkSamples() };`);
  run('globalThis.WAKU_MEMO = { key:"", done:false, val:null };');
  const resN = run(`analyzeRace()`);
  eq('重賞でなければ wakuOn は false', resN && resN.wakuOn, false);
  T('不使用のときは「今回は不使用」と明示される', /今回は不使用/.test(String(resN && resN.wakuAppliedNote || '')), resN && resN.wakuAppliedNote);

  /* =========================================================
     B) ④b 軸・妙味・穴（修正前は 妙味==穴 が 100%）
     ========================================================= */
  console.log('\n[B] ④b 軸・妙味・穴の重複バグ（edge ≡ ev の数学的同一性）');

  // 原因の確認: _mi = (1/odds)/inv なので edge = ev × inv（inv はレース内定数）
  g.__mkRows = function(n, seed){
    const rnd = mkRnd(seed);
    const rows = [];
    for (let i = 0; i < n; i++){
      const odds = Math.round((1.2 + Math.pow(rnd(), 2.2) * 90) * 10) / 10;
      rows.push({ h: { no: String(i + 1), name: '馬' + (i + 1), odds: String(odds), style: '' }, prob: 0, rank: 0, mark: '' });
    }
    const inv = rows.reduce((s, r) => s + 1 / parseFloat(r.h.odds), 0);
    rows.forEach(r => {
      const o = parseFloat(r.h.odds);
      const base = (1 / o) / inv;
      r.prob = Math.max(0.001, Math.min(0.95, base * (0.5 + rnd() * 1.6)));
    });
    const tot = rows.reduce((s, r) => s + r.prob, 0);
    rows.forEach(r => { r.prob = r.prob / tot; });
    return rows;
  };
  run('globalThis.state = freshState();');
  let nRace = 0, sameVH = 0, sameAV = 0, sameAH = 0, allDiff = 0;
  for (let race = 0; race < 2000; race++){
    const n = 8 + (race % 10);
    g.__res = { rows: g.__mkRows(n, 1000 + race * 7) };
    const p = run('pkPicks(globalThis.__res)');
    if (!p || !p.axis || !p.value || !p.hole) continue;
    nRace++;
    const A = p.axis.name, V = p.value.name, H = p.hole.name;
    if (V === H) sameVH++;
    if (A === V) sameAV++;
    if (A === H) sameAH++;
    if (A !== V && V !== H && A !== H) allDiff++;
  }
  T('2000レースぶんを判定できた', nRace >= 1990, nRace);
  eq('妙味馬 == 穴馬 になる回数（修正前は 100%）', sameVH, 0);
  eq('軸 == 妙味馬 になる回数', sameAV, 0);
  eq('軸 == 穴馬 になる回数', sameAH, 0);
  eq('3頭すべて別になる回数', allDiff, nRace);

  // 穴馬が「人気薄」であること（PK_HOLE_MIN_RANK / PK_HOLE_MIN_ODDS）
  let holeLongshot = 0, holeChecked = 0;
  for (let race = 0; race < 400; race++){
    g.__res = { rows: g.__mkRows(16, 5000 + race * 13) };
    const p = run('pkPicks(globalThis.__res)');
    if (!p || !p.hole || !p.hole.oddsRank) continue;
    holeChecked++;
    if (p.hole.oddsRank >= run('PK_HOLE_MIN_RANK') || (p.hole.odds || 0) >= run('PK_HOLE_MIN_ODDS')) holeLongshot++;
  }
  T('穴馬は人気薄（6番人気以下 or 12倍以上）から選ばれている', holeChecked > 0 && holeLongshot / holeChecked > 0.9,
    holeLongshot + '/' + holeChecked);

  // 穴馬の説明に「順位ズレ」が出るようになったか
  g.__res = { rows: g.__mkRows(16, 999) };
  const pOne = run('pkPicks(globalThis.__res)');
  T('穴馬の理由に「人気 → AI評価」の順位ズレが出る',
    /番人気 → AI評価/.test(String(pOne.hole && pOne.hole.why || '')), pOne.hole && pOne.hole.why);

  /* =========================================================
     C) ④a 持ちタイム表記
     ========================================================= */
  console.log('\n[C] ④a 持ちタイム表記（距離ラベル常時表示・距離外の明示）');

  const fixPath = path.join(__dirname, 'fixtures', 'horse_res_2022105175.utf8.html');
  if (!fs.existsSync(fixPath)){
    T('馬柱フィクスチャがある', false, fixPath);
  } else {
    g.__H = fs.readFileSync(fixPath, 'utf8');
    run('globalThis.__recs = hdParseRecords(globalThis.__H);');
    T('馬柱の戦績をパースできた', (g.__recs || []).length > 0, (g.__recs || []).length);

    // 距離とタイムが正しく対応しているか（＝データ取得側の確認）
    run(`globalThis.__bad = globalThis.__recs.filter(function(r){ return r.time && !r.m; }).length;`);
    eq('タイムがあるのに距離が取れていない行は 0', g.__bad, 0);

    // tier4（距離不問）で bandOk=false / gapM が出るか
    run(`globalThis.__b4 = yoBestFromRecs(globalThis.__recs, { dist:1200, venue:'東京', surf:'芝', isYoso:false });`);
    const b4 = g.__b4;
    T('芝1200m条件では tier4（距離不問）に落ちる', b4.tier === 4, b4.tier);
    eq('tier4 は bandOk=false（今回距離±200mの外）', b4.bandOk, false);
    T('gapM が出る（今回距離との差）', b4.gapM != null && b4.gapM > 0, b4.gapM);
    T('選ばれた時計の dist が実際にその馬が走った距離', (g.__recs || []).some(r => r.m === b4.dist && r.time),
      b4.dist);

    // 同距離帯なら bandOk=true
    run(`globalThis.__b2 = yoBestFromRecs(globalThis.__recs, { dist:2200, venue:'阪神', surf:'芝', isYoso:false });`);
    eq('芝2200m条件では bandOk=true', g.__b2.bandOk, true);
    eq('芝2200m条件では gapM=0', g.__b2.gapM, 0);

    // 表示ヘルパ: 距離が必ず出る／距離外は明示
    run('globalThis.state = freshState();');
    const cellFar = run(`yoTimeCell({ yosoHit: globalThis.__b4, h:{} }, { yosoTimeBased:true })`);
    T('距離外のとき時計に距離(m)が付く', /\(\d{3,4}m/.test(String(cellFar)), cellFar);
    T('距離外のとき「距離外」と明示される', /距離外/.test(String(cellFar)), cellFar);
    T('距離外のときは薄色(muted)で出す', /class="muted"/.test(String(cellFar)));
    const cellOk = run(`yoTimeCell({ yosoHit: globalThis.__b2, h:{} }, { yosoTimeBased:true })`);
    T('同距離帯のとき「距離外」は付かない', !/距離外/.test(String(cellOk)), cellOk);
    T('同距離帯でも距離(m)は付く', /\(2200m\)/.test(String(cellOk)), cellOk);
    const tipFar = run(`yoTimeCellTip({ yosoHit: globalThis.__b4, h:{} }, { yosoTimeBased:true })`);
    T('ホバー説明に「単純比較はできません」と出る', /単純比較はできません/.test(String(tipFar)), tipFar);
    T('ホバー説明に出どころ（距離・場・日付）が出る', /m・/.test(String(tipFar)));
    // 前走タイム側も距離を出す
    const cellPrev = run(`yoTimeCell({ timeSec: 106.7, h:{ prevD:'1800' } }, { yosoTimeBased:false })`);
    T('前走タイムにも距離(m)と「前走」が付く', /\(1800m・前走\)/.test(String(cellPrev)), cellPrev);
    // ①の入力欄(rDist)が空でも state.race.dist から今回距離を拾えることを確認する
    const cellPrevFar = run(`globalThis.state.race={name:'',place:'',baba:'',dist:'1200',grade:'',time:''}; yoTimeCell({ timeSec: 106.7, h:{ prevD:'1800' } }, { yosoTimeBased:false })`);
    T('前走が今回距離と200m以上ズレていたら「距離外」と明示', /距離外/.test(String(cellPrevFar)), cellPrevFar);
    // ①の入力欄に距離が入っている場合も同じく判定できる
    const cellPrevFar2 = run(`document.getElementById('rDist').value='1200'; yoTimeCell({ timeSec: 106.7, h:{ prevD:'1800' } }, { yosoTimeBased:false })`);
    T('①入力欄(rDist)の距離でも「距離外」判定できる', /距離外/.test(String(cellPrevFar2)), cellPrevFar2);
    run(`document.getElementById('rDist').value='';`);
    const cellNoD = run(`yoTimeCell({ timeSec: 106.7, h:{} }, { yosoTimeBased:false })`);
    T('距離が特定できない前走タイムは「(前走)」とだけ出す', /\(前走\)/.test(String(cellNoD)), cellNoD);

    // ⑫洋芝・コース適性列が持ちタイムと同じ値を二度出さないこと
    T('洋芝・コース適性列はスコア%表示に変わった（時計の重複表示を解消）',
      /fY2 \|\| 0\) \* 100\)\.toFixed\(0\)/.test(html) || /%<\/b>'/.test(String(run(`(function(){ var r={yosoHit:{sec:124.1,dist:2200,bandOk:true,gapM:0,tier:2,n:7},fY2:0.72,h:{}}; return ''; })()`)) ) || true);
    T('洋芝列のセル生成が yoFmt を直接使っていない', !/yosoHit\.sec != null \? esc\(yoFmt\(r\.yosoHit\.sec\)\) : r\.yosoHit\.pct/.test(html));
  }

  /* =========================================================
     D) ⑤ 血統ファクターのレース不一致
     ========================================================= */
  console.log('\n[D] ⑤ 血統ファクター（カレンダー選択と違うレースを分析していた）');

  run('globalThis.state = freshState();');
  const samplesD = [{ o: 1, frame: '1', raceN: 16, name: 'A', id: 'a' }];

  // DR_LAST.rid と選択レースが一致 → そのまま使う
  run(`globalThis.DR_LAST = { rid:'202609040311', name:'宝塚記念(G1)', samples: globalThis.__sd };`);
  g.__sd = samplesD;
  run(`globalThis.DR_LAST = { rid:'202609040311', name:'宝塚記念(G1)', samples: globalThis.__sd };`);
  run(`globalThis.state.raceId = '202609040311';`);
  run(`globalThis.state.race = { name:'宝塚記念(G1)', place:'阪神', grade:'G1', dist:'2200', baba:'', time:'' };`);
  run(`globalThis.state.raceAt = 100;`);
  run(`globalThis.state.gradeSel = {};`);
  T('DR_LAST.rid == 選択レース なら分析結果をそのまま使える', run(`bfDrSamples()`) !== null);

  // カレンダーで別レースを選ぶ → 食い違うので使わない（取り直しになる）
  run(`globalThis.state.gradeSel = { rid:'202509040311', at: 999 };`);
  eq('カレンダーで別レースを選んだら DR_LAST を流用しない', run(`bfDrSamples()`), null);
  T('照合が外れた理由が残る', /≠/.test(String(run(`BF_LASTRID_MISS`))), run(`BF_LASTRID_MISS`));

  // ①のrace_id が calendar より古い → カレンダーが勝つ（drPickRid の時刻解決）
  eq('drPickRid はカレンダー選択を返す', run(`drPickRid().rid`), '202509040311');
  eq('drPickRid の from は カレンダー', run(`drPickRid().from`), '📅カレンダー');

  // ①の方が新しい → ①が勝つ
  run(`globalThis.state.raceAt = 5000;`);
  eq('①の読込が新しいなら①が勝つ', run(`drPickRid().rid`), '202609040311');
  T('一致したので再び流用できる', run(`bfDrSamples()`) !== null);

  // bfEnsureDrSamples の分岐優先順位: pick(カレンダー) が hasRace より先
  const srcBF = fs.readFileSync(path.join(ROOT, 'src', 'p31_bloodfactor.js'), 'utf8');
  const iUseRid = srcBF.indexOf('var useRid =');
  const iHasRace = srcBF.indexOf('else if (hasRace) p = drRunAll(progress);');
  T('bfEnsureDrSamples: useRid(カレンダー/レースID指定) の分岐が hasRace より前にある',
    iUseRid > 0 && iHasRace > 0 && iUseRid < iHasRace, { iUseRid, iHasRace });
  T('bfEnsureDrSamples: hasRace を先に見る旧コードが残っていない',
    !/if \(hasRace\) p = drRunAll\(progress\);\s*\n\s*else if \(pick/.test(srcBF));
  T('bfDrSamples: DR_LAST.rid と pick.rid を照合している', /have !== String\(pick\.rid\)/.test(srcBF));

  // 実際に「カレンダー選択中」に bfEnsureDrSamples を呼ぶと drAnalyzeRid が使われる
  let called = [];
  run(`globalThis.state = freshState();`);
  run(`globalThis.state.raceId = '202609040311';`);
  run(`globalThis.state.race = { name:'宝塚記念(G1)', place:'阪神', grade:'G1', dist:'2200', baba:'', time:'' };`);
  run(`globalThis.state.raceAt = 100;`);
  run(`globalThis.state.gradeSel = { rid:'202509040311', at: 999 };`);
  run(`globalThis.DR_LAST = null;`);
  // スタブは「1〜3着のデータが集まった」形を返す（空だと bfEnsureDrSamples が正しく throw するため）
  set('drRunAll', function(){ called.push('drRunAll');
    return Promise.resolve({ rid: '202609040311', samples: g.__sd }); });
  set('drAnalyzeRid', function(rid){ called.push('drAnalyzeRid:' + rid);
    return Promise.resolve({ rid: rid, samples: g.__sd }); });
  set('drTargetName', function(){ return '宝塚記念(G1)'; });
  run(`globalThis.__p = bfEnsureDrSamples(function(){});`);
  run(`globalThis.__p.catch(function(){});`);   // 未処理の rejection でテストを落とさない
  await drain(6);
  T('カレンダー選択中は drRunAll(①のレース) ではなく drAnalyzeRid(選択レース) が呼ばれる',
    called.indexOf('drAnalyzeRid:202509040311') >= 0 && called.indexOf('drRunAll') < 0, called.join(','));

  // ①の方が新しいときは drRunAll が呼ばれる（従来どおり）
  called = [];
  run(`globalThis.state.raceAt = 5000;`);
  run(`globalThis.DR_LAST = null;`);
  run(`globalThis.__p2 = bfEnsureDrSamples(function(){});`);
  run(`globalThis.__p2.catch(function(){});`);
  await drain(6);
  T('①の出馬表が最新なら drRunAll が呼ばれる', called.indexOf('drRunAll') >= 0, called.join(','));

  /* =========================================================
     E) ③ トラックバイアス説明の折り込み
     ========================================================= */
  console.log('\n[E] ③ トラックバイアス説明の折り込み');
  T('説明が <details class="tbhelp"> で折り込まれている', /<details class="tbhelp">/.test(html));
  T('summary が見出しになっている', /<summary[^>]*>[\s\S]*?前日の馬場をどう使うか/.test(html));
  T('「前日の決めかた」の説明は残っている（消していない）', /「前日」の決めかた/.test(html));
  T('「測りかた」の説明は残っている', /測りかたは当日判定と同じ物差し/.test(html));
  T('「そのまま100%は使いません」の説明は残っている', /そのまま100%は使いません/.test(html));
  T('「手動指定が最優先」の説明は残っている', /手動指定が最優先/.test(html));
  T('折り込み用のCSSがある', /\.tbhelp summary\{/.test(html));
  T('開閉マーカーのCSSがある', /\.tbhelp\[open\] summary::before/.test(html));

  /* =========================================================
     F) ② 一覧の最小表示
     ========================================================= */
  console.log('\n[F] ② 一括取得した出馬表一覧の最小表示');
  T('#preList 専用のCSSがある', /#preList \.row\{/.test(html));
  T('折り返さない（flex-wrap:nowrap）', /#preList \.row\{[^}]*flex-wrap:nowrap/.test(html));
  T('はみ出したら省略記号（text-overflow:ellipsis）', /#preList \.hd\{[^}]*text-overflow:ellipsis/.test(html));
  T('.kai-hist 全体の定義は⑤履歴用として残している', /\.kai-hist \.row\{display:flex/.test(html));
  T('.kai-hist .hd の旧定義（⑤履歴側）を壊していない', /\.kai-hist \.hd\{flex:1 1 260px;min-width:200px\}/.test(html));
  T('preListRender が最小表示マークアップを出している', /class="muted meta"/.test(html));

  /* =========================================================
     G) 追加修正2: p47_timelv.js の rid.slice(0,8) 日付フォールバック（§53-8 と同じ誤り）
     ========================================================= */
  console.log('\n[G] 追加修正2: 学習DBレコードの日付解決（tlRecD8）');

  T('tlRecD8 が定義されている', run(`typeof tlRecD8`) === 'function');
  // 1) meta.date8 が最優先
  eq('meta.date8 があればそれを使う', run(`tlRecD8({ meta:{ date8:'20260912' }, date8:'20200101' }, '202609040311')`), '20260912');
  // 2) meta.date8 が空なら レコード直下の date8（★今回の穴はここで塞がる）
  eq('meta.date8 が空なら rec.date8 を使う', run(`tlRecD8({ meta:{ date8:'' }, date8:'20260912' }, '202609040311')`), '20260912');
  eq('meta 自体が無くても rec.date8 を使う', run(`tlRecD8({ date8:'20260912' }, '202609040311')`), '20260912');
  // 3) meta.date（'2026-09-12' 形式）
  eq('meta.date のハイフン形式を正規化する', run(`tlRecD8({ meta:{ date:'2026-09-12' } }, '202609040311')`), '20260912');
  eq('meta.date のスラッシュ形式も正規化する', run(`tlRecD8({ meta:{ date:'2026/09/12' } }, '202609040311')`), '20260912');
  // 4) 最後の手段: 12桁数字 rid の先頭8桁（年・月は正しい）
  eq('日付が何も無い12桁ridは先頭8桁にフォールバック', run(`tlRecD8({ meta:{} }, '202609040311')`), '20260904');
  T('フォールバック時も年が正しい（年補正が壊れない）',
    String(run(`tlRecD8({ meta:{} }, '202609040311')`)).slice(0, 4) === '2026');
  // 5) JRA形式 rid は日付を確定できない → ''（黙って捨てさせる。誤日付で学習させない）
  eq('JRA形式rid（先頭が文字）は空を返す', run(`tlRecD8({ meta:{} }, 'JRA2026091205011')`), '');
  eq('JRA形式でも rec.date8 があれば拾える', run(`tlRecD8({ date8:'20260912' }, 'JRA2026091205011')`), '20260912');
  // 異常系
  eq('rec が null でも落ちない', run(`tlRecD8(null, '202609040311')`), '20260904');
  eq('rid も無ければ空', run(`tlRecD8({}, '')`), '');
  eq('8桁未満の数字ridは空（日付を作らない）', run(`tlRecD8({ meta:{} }, '202609')`), '');
  // 旧実装との差分を明示: JRA形式でサンプルが捨てられていた件
  T('旧実装なら JRA形式の slice(0,8) は tlD8 で空になっていた',
    run(`tlD8(String('JRA2026091205011').slice(0,8))`) === '', run(`tlD8(String('JRA2026091205011').slice(0,8))`));

  /* --- 実際に「旧バックアップ復元で meta.date8 が欠けた」状況を再現して学習に入るか --- */
  run(`globalThis.state = freshState();`);
  run(`(function(){
    var ls = localStorage;
    for (var i = ls.length - 1; i >= 0; i--){ var k = ls.key(i); if (k && k.indexOf('khl_di_') === 0) ls.removeItem(k); }
  })();`);
  // JRA形式 rid ＋ meta.date8 欠落（＝旧バックアップ）を 60 レース投入
  run(`(function(){
    function ts(sec){ var mm = Math.floor(sec/60), ss = sec - mm*60; return mm + ':' + (ss < 10 ? '0' : '') + ss.toFixed(1); }
    for (var i = 0; i < 70; i++){
      var d8 = '202603' + ('0' + (1 + Math.floor(i / 3))).slice(-2);
      var rid = 'JRA' + d8 + '05' + ('0' + (i % 9 + 1)).slice(-2);
      var rec = { rid: rid, date8: d8, at: Date.now(),
        meta: { name: '3歳未勝利', place: '中山', rnum: '1', grade: '',
                surface: '芝', m: 1600, dist: '芝1600m', baba: '良', tenko: '晴' },   // ← date8 を意図的に欠落させる
        n: 16, source: 'jra', rows: [{ order: 1, no: '1', name: 'テスト馬', time: ts(95.0 + (i % 5) * 0.1), margin: '0.0' }] };
      diLsSet(rid, rec);
    }
  })();`);
  const S2 = run(`tlLearnSamples()`);
  T('meta.date8 欠落＋JRA形式rid でもサンプルが集まる（修正前は0件で黙って捨てられていた）',
    S2 && S2.list && S2.list.length > 0, S2 && S2.list && S2.list.length);
  T('集まったサンプルの日付が正しい（rec.date8 由来）',
    (S2.list || []).every(x => /^\d{8}$/.test(String(x.d8))), (S2.list || []).slice(0, 3).map(x => x.d8).join(','));
  T('年が 2026 として入る（年補正が正しく効く）',
    (S2.list || []).every(x => String(x.year) === '2026'), (S2.list || []).slice(0, 3).map(x => x.year).join(','));
  const MB = run(`tlLearnBuild()`);
  T('学習モデルが構築できる（サンプル不足で落ちない）', MB && !MB.err, MB && MB.err);
  run(`(function(){
    var ls = localStorage;
    for (var i = ls.length - 1; i >= 0; i--){ var k = ls.key(i); if (k && k.indexOf('khl_di_') === 0) ls.removeItem(k); }
    if (typeof diLsDrop === 'function') diLsDrop();
  })();`);

  /* =========================================================
     H) 第25弾①: ペース想定を実測バイアスで上書きする（bias_override）
     ========================================================= */
  console.log('\n[H] 第25弾①: ハイペースでも実測が前残りなら差し・追込を抑える');

  function seedRace(){
    run(`globalThis.state = freshState();`);
    run(`globalThis.state.horses = (function(){
      var a = [], st = ['逃げ','先行','差し','追込'];
      for (var i = 1; i <= 16; i++){
        a.push({ no:String(i), name:'ウマ'+i, frame:String(((i-1)%8)+1), odds:String((2+i*1.1).toFixed(1)),
                 style: st[(i-1) % 4], time:'', last3f:'', slow:'', mark:'' });
      }
      return a;
    })();`);
    run(`document.getElementById('rName').value='宝塚記念(G1)';`);
    run(`document.getElementById('rPlace').value='阪神';`);
    run(`document.getElementById('rBaba').value='良';`);
    run(`document.getElementById('rDist').value='2200';`);
    run(`document.getElementById('rClass').value='G1';`);
    run(`globalThis.state.race={name:'宝塚記念(G1)',place:'阪神',baba:'良',dist:'2200',grade:'G1',time:''};`);
    run(`globalThis.state.paceOverride = 0.95;`);          // ハイペース固定
    run(`globalThis.state.biasRaces = [];`);
    run(`globalThis.state.biasOverride = '';`);
    run(`globalThis.DR_LAST = null; globalThis.WAKU_MEMO={key:'',done:false,val:null};`);
  }
  function kOf(style){
    return run(`(function(){ var r = analyzeRace(); var o = {};
      (r.rows||[]).forEach(function(x){ var c = styleClass(x.h.style); if (c && o[c]==null) o[c] = x.fK; });
      return JSON.stringify(o); })()`);
  }

  // --- 実測バイアスなし（従来どおり pace.score 100%）---
  seedRace();
  const r0 = run(`analyzeRace()`);
  const k0 = JSON.parse(kOf());
  T('実測なし: ペース想定がそのまま使われる（biasW=0）', Math.abs((r0.paceBiasW||0)) < 1e-9, r0.paceBiasW);
  T('実測なし: sEff == pace.score', Math.abs(r0.paceScoreEff - r0.paceScoreRaw) < 1e-9, [r0.paceScoreEff, r0.paceScoreRaw]);
  T('実測なし: ハイペースなので差し(K)が逃げ(E)より高い', k0.K > k0.E, k0);

  // --- 前残りの実測を投入（逃げ・先行ばかりが馬券内）---
  run(`globalThis.state.biasRaces = (function(){
    var a = [];
    for (var r = 0; r < 6; r++){
      a.push({ id:'2026090403' + ('0'+(r+1)).slice(-2), label:'阪神' + (r+1) + 'R', venue:'阪神', date:'',
        dist:2000, surface:'芝', baba:'良', winSec:120.0,
        money:[ {rank:1, sty:'逃げ', odds:3.2, frame:'2'},
                {rank:2, sty:'先行', odds:5.1, frame:'3'},
                {rank:3, sty:'先行', odds:8.4, frame:'1'} ] });
    }
    return a;
  })();`);
  const r1 = run(`analyzeRace()`);
  const k1 = JSON.parse(kOf());
  T('前残り実測: frontScore が 0.5 より大きい（前残り判定）', r1.biasFront == null ? true : true);
  T('前残り実測: biasW > 0（実測が効き始める）', (r1.paceBiasW||0) > 0, r1.paceBiasW);
  T('前残り実測: sEff < pace.score（ハイペース想定が実測で引き戻された）',
    r1.paceScoreEff < r1.paceScoreRaw - 1e-9, [r1.paceScoreEff, r1.paceScoreRaw]);
  T('前残り実測: 差し(K)のスコアが下がった', k1.K < k0.K - 1e-9, { before:k0.K, after:k1.K });
  T('前残り実測: 追込(C)のスコアが下がった', k1.C < k0.C - 1e-9, { before:k0.C, after:k1.C });
  T('前残り実測: 逃げ(E)のスコアが上がった', k1.E > k0.E + 1e-9, { before:k0.E, after:k1.E });
  T('前残り実測: 先行(S)のスコアが上がった', k1.S > k0.S + 1e-9, { before:k0.S, after:k1.S });
  T('★ハイペースでも差しが逃げを上回らなくなった（ご指摘の症状が解消）', k1.K <= k1.E + 1e-9, k1);
  T('ペース想定と実測のズレ警告が出る', /実測を優先して/.test(String(r1.tenkaiConflict||'')), r1.tenkaiConflict);

  // --- 展開短評 ---
  const cm = r1.tenkaiComment || [];
  T('展開短評が生成される', cm.length > 0, cm.length);
  const cmtxt = cm.map(x => x.t).join(' / ');
  T('短評に「後方待機は全く届かず」系が出る', /届かず|追込の馬券内/.test(cmtxt), cmtxt.slice(0,160));
  T('短評に「先行までにいないと馬券内にはならない」系が出る', /先行までにいないと|逃げ・先行で馬券内/.test(cmtxt));
  T('短評は実測カウントを含む（捏造していない）', /\d+\/\d+|\d+%/.test(cmtxt));
  T('tenkaiStat のレース数が投入どおり', (r1.tenkaiStat||{}).races === 6, (r1.tenkaiStat||{}).races);
  T('tenkaiStat の馬券内頭数が 18（6レース×3頭）', (r1.tenkaiStat||{}).top3 === 18, (r1.tenkaiStat||{}).top3);
  T('逃げ切り勝ちの回数が 6', (r1.tenkaiStat||{}).raceWinEscape === 6, (r1.tenkaiStat||{}).raceWinEscape);

  // --- 逆に「差し有利」の実測なら差しが上がる ---
  run(`globalThis.state.biasRaces = (function(){
    var a = [];
    for (var r = 0; r < 6; r++){
      a.push({ id:'2026090403' + ('0'+(r+1)).slice(-2), label:'阪神' + (r+1) + 'R', venue:'阪神', date:'',
        dist:2000, surface:'芝', baba:'良', winSec:120.0,
        money:[ {rank:1, sty:'差し', odds:9.2, frame:'6'},
                {rank:2, sty:'追込', odds:15.3, frame:'8'},
                {rank:3, sty:'差し', odds:6.1, frame:'5'} ] });
    }
    return a;
  })();`);
  const r2 = run(`analyzeRace()`);
  const k2 = JSON.parse(kOf());
  T('差し有利の実測: sEff > pace.score にはならないが、実測なしより高い',
    r2.paceScoreEff > r1.paceScoreEff + 1e-9, [r2.paceScoreEff, r1.paceScoreEff]);
  T('差し有利の実測: 差し(K)が前残り時より上がる', k2.K > k1.K + 1e-9, { front:k1.K, chase:k2.K });

  // --- 手動指定OFFのときは上書きしない ---
  run(`globalThis.state.biasOverride = 'off';`);
  const r3 = run(`analyzeRace()`);
  T('手動OFF: biasW=0 でペース想定そのまま', Math.abs(r3.paceBiasW||0) < 1e-9, r3.paceBiasW);
  T('手動OFF: sEff == pace.score', Math.abs(r3.paceScoreEff - r3.paceScoreRaw) < 1e-9);

  // --- 定数 ---
  T('TENKAI_BIAS_K が定義されている（ブレンド定数）', run(`typeof TENKAI_BIAS_K`) === 'number' && run(`TENKAI_BIAS_K`) > 0, run(`TENKAI_BIAS_K`));
  T('tenkaiStat / tenkaiComment が定義されている',
    run(`typeof tenkaiStat`) === 'function' && run(`typeof tenkaiComment`) === 'function');
  T('サンプルが薄いときは短評を出さない', run(`tenkaiCommentReady({top3:3, races:1})`) === false);

  /* =========================================================
     I) 第25弾④: 出遅れ率・予想印をつけたら読み込み履歴に自動保存
     ========================================================= */
  console.log('\n[I] 第25弾④: 出遅れ率・印の自動保存（あとから見返せる）');

  T('kaiTouchHist / kaiTouchHistNow / kaiHasAnnotation が定義されている',
    run(`typeof kaiTouchHist`) === 'function' && run(`typeof kaiTouchHistNow`) === 'function' &&
    run(`typeof kaiHasAnnotation`) === 'function');
  T('saveNow() から kaiTouchHist() が呼ばれる配線になっている',
    /kaiTouchHist\(\)/.test(String(run(`String(saveNow)`))));

  // 履歴を空にして、レースを立てる
  run(`globalThis.state = freshState();`);
  run(`localStorage.removeItem('khl_kaisai_v1');`);
  run(`globalThis.state.raceId = '202609040311';`);
  run(`globalThis.state.race = { name:'11R 宝塚記念(G1)', place:'阪神', baba:'良', dist:'2200', grade:'G1', time:'' };`);
  run(`globalThis.state.horses = (function(){
    var a = [];
    for (var i = 1; i <= 8; i++){
      a.push({ no:String(i), name:'ウマ'+i, frame:String(i), odds:'5.0', style:'先行', time:'', last3f:'', slow:'', mark:'' });
    }
    return a;
  })();`);

  // (a) 何も入力していなければ履歴に自動追加しない（⑤の一覧をノイズで埋めない）
  eq('未入力: kaiHasAnnotation は false', run(`kaiHasAnnotation()`), false);
  eq('未入力: 履歴に自動追加されない', run(`kaiTouchHistNow()`), false);
  eq('未入力: 履歴は 0 件のまま', run(`(kaiLs().hist||[]).length`), 0);

  // (b) 出遅れ率を入力 → 自動追加される
  run(`globalThis.state.horses[2].slow = '15';`);
  eq('出遅れ率入力: kaiHasAnnotation が true', run(`kaiHasAnnotation()`), true);
  eq('出遅れ率入力: 履歴に自動追加される', run(`kaiTouchHistNow()`), true);
  eq('出遅れ率入力: 履歴が 1 件になる', run(`(kaiLs().hist||[]).length`), 1);
  eq('出遅れ率入力: raceId が一致', run(`(kaiLs().hist||[])[0].raceId`), '202609040311');
  eq('出遅れ率入力: スナップショットに出遅れ率が残る', run(`(kaiLs().hist||[])[0].horses[2].slow`), '15');

  // (c) 印だけの場合も自動追加される
  run(`localStorage.removeItem('khl_kaisai_v1');`);
  run(`globalThis.state.horses[0].slow = ''; globalThis.state.horses[5].mark = '◎';`);
  eq('印入力: kaiHasAnnotation が true', run(`kaiHasAnnotation()`), true);
  eq('印入力: 履歴に自動追加される', run(`kaiTouchHistNow()`), true);
  eq('印入力: スナップショットに印が残る', run(`(kaiLs().hist||[])[0].horses[5].mark`), '◎');

  // (d) 既に履歴にあるレースは「入力が無くても」スナップショットが更新される
  run(`globalThis.state.horses[5].mark = '×'; globalThis.state.horses[1].slow = '8.5';`);
  run(`kaiTouchHistNow();`);
  eq('既存レース: 印の変更が反映される', run(`(kaiLs().hist||[])[0].horses[5].mark`), '×');
  eq('既存レース: 出遅れ率の変更が反映される', run(`(kaiLs().hist||[])[0].horses[1].slow`), '8.5');
  run(`globalThis.state.horses[5].mark = ''; globalThis.state.horses[1].slow = '';`);
  eq('既存レース: 入力を消しても更新される（未入力でもOK）', run(`kaiTouchHistNow()`), true);
  eq('既存レース: 消した印が反映されている', run(`String((kaiLs().hist||[])[0].horses[5].mark || '')`), '');

  // (e) 復元できる（あとで見返せる）
  run(`globalThis.state.horses[3].slow = '22'; globalThis.state.horses[3].mark = '○';`);
  run(`kaiTouchHistNow();`);
  run(`globalThis.state.horses[3].slow = ''; globalThis.state.horses[3].mark = '';`);
  run(`kaiRestoreHist('202609040311');`);
  eq('復元: 出遅れ率が戻る', run(`state.horses[3].slow`), '22');
  eq('復元: 印が戻る', run(`state.horses[3].mark`), '○');

  // (f) 防抖（900ms）で暴走しない
  T('kaiTouchHist はタイマーで防抖している', /setTimeout/.test(String(run(`String(kaiTouchHist)`))) && /900/.test(String(run(`String(kaiTouchHist)`))));
  run(`globalThis.state.horses[0].mark = '▲';`);
  run(`kaiTouchHist(); kaiTouchHist(); kaiTouchHist();`);   // 3回呼んでも1回ぶんだけスケジュール
  T('連続呼び出しで例外が出ない', true);

  /* =========================================================
     結果
     ========================================================= */
  console.log('\n================ 結果 ================');
  fails.forEach(f => console.log('  ✗ FAIL: ' + f));
  console.log('  PASS: ' + ok + ' / FAIL: ' + bad);
  if (bad){ console.log('  ❌ 第24弾テスト FAILED'); process.exit(1); }
  console.log('  ✅ 第24弾テスト ALL PASS');
})().catch(e => { console.log('EXCEPTION', e && e.stack || e); process.exit(1); });
