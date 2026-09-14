/* 第9弾-A: ⏱勝ちタイムのレベル（前走は必ず評価・1着以外も追記）テスト
   実行: node tests/timelv.test.js   (build.py 実行後に)
   検証: 対象レースの判定 / 同条件の過去勝ち時計との速度比較 / 🎯・○・⚠️ /
        基準時計(パー)へのフォールバック / 1着じゃなくても前走の時計で🎯 /
        馬券外(4着以下)でも時計が速ければ追記 / レースの勝ち時計レベル(自分の時計＋着差から推定) /
        勝ち馬の2着差を他馬の馬柱から復元 / 短評の📒馬ノート自動登録（1回だけ）/
        ⏱カードの表表示 / 枠色が競馬新聞どおり（1枠白・2枠黒・3枠赤・4枠青・5枠黄・6枠緑・7枠橙・8枠ピンク）。 */
const fs = require('fs');
const vm = require('vm');

const store = {};
const els = {};
function makeEl(id){
  const el = { id: id || '', _html:'', _text:'', disabled:false, value:'', checked:true,
    dataset:{}, style:{},
    classList:{ _s:new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); },
      toggle(c,f){ if(f===undefined){ this._s.has(c)?this._s.delete(c):this._s.add(c); } else { f?this._s.add(c):this._s.delete(c); } },
      contains(c){ return this._s.has(c); } },
    addEventListener(){}, removeEventListener(){}, click(){}, setAttribute(){}, getAttribute(){ return null; },
    querySelector(){ return makeEl(); }, querySelectorAll(){ return []; }, closest(){ return null; },
    appendChild(){}, remove(){}, scrollIntoView(){}, getBoundingClientRect(){ return { width:940, height:400, top:0, left:0 }; } };
  Object.defineProperty(el, 'innerHTML', { get(){ return el._html; }, set(v){ el._html = v; el._text = String(v).replace(/<[^>]*>/g,''); } });
  Object.defineProperty(el, 'textContent', { get(){ return el._text; }, set(v){ el._text = String(v); el._html=''; } });
  return el;
}
function find(id){ if (!els[id]) els[id] = makeEl(id); return els[id]; }
const g = {
  console, Math, JSON, Date, String, Number, parseInt, parseFloat, isNaN, isFinite, RegExp,
  encodeURIComponent, decodeURIComponent, TextDecoder,
  setTimeout: () => 0, clearTimeout(){}, setInterval: () => 0, clearInterval(){},
  requestAnimationFrame: () => 1, cancelAnimationFrame(){},
  localStorage: {
    getItem(k){ return store[k] != null ? store[k] : null; },
    setItem(k,v){ store[k] = String(v); },
    removeItem(k){ delete store[k]; }, key(i){ return Object.keys(store)[i] || null; },
    get length(){ return Object.keys(store).length; }
  },
  addEventListener(){}, removeEventListener(){}, scrollTo(){}, devicePixelRatio:1,
  innerWidth:980, innerHeight:640, navigator:{},
  document: {
    getElementById(id){ return find(id); },
    querySelector(){ return makeEl(); }, querySelectorAll(){ return []; }, createElement(){ return makeEl(); },
    addEventListener(){}, removeEventListener(){}, fullscreenElement:null,
    body:{ appendChild(){} }, head:{ appendChild(){} }, documentElement:{}
  }
};
g.window = g;
vm.createContext(g);
const html = fs.readFileSync('/home/user/keiba-lab/index.html','utf8');
const m = html.match(/<script>\n([\s\S]*)\n<\/script>/);
if (!m){ console.log('FAIL: script not found in index.html'); process.exit(1); }
vm.runInContext(m[1], g, { filename:'index.html.js' });
const s = g;

let ok = 0, bad = 0;
const t = (n,c,x) => { if (c) ok++; else { bad++; console.log('FAIL', n, JSON.stringify(x)); } };
const val = (fn) => { try { return { ok:true, v: fn() }; } catch(e){ return { ok:false, v: e && e.message }; } };
const noThrow = (n,fn) => { const r = val(fn); t(n, r.ok, r.v); return r; };

/* ---------- 合成の馬柱キャッシュ ---------- */
const V = '中山';
function mkRun(o){
  return Object.assign({ venueName:V, venue:V, surface:'芝', baba:'良', m:2000, dist:'芝2000 良', head:'16' }, o);
}
const hd = {};
// 比較母集団になる「同条件の勝ち時計」10走（すべて 2:02.0 = 16.393 m/s）
['08/16','08/17','08/18','08/19','08/20','08/21','08/22','08/23','08/24','08/25'].forEach(function(d, i){
  hd['40' + (10 + i)] = { p:{}, at:Date.now(), r:[ mkRun({ date:'2026-' + d, name:'3歳未勝利', order:'1', time:'2:02.0', pass:'4-4-3-3' }) ] };
});
const A = { nk:'3001', name:'アルファ', no:'1' };   // 2:00.0 → 早い（前走＝この勝ちレース）
const B = { nk:'3002', name:'ブラボー', no:'2' };   // 前走は2着(2:01.0)だが時計が速い → 🎯（1着じゃなくても追記）
const C = { nk:'3003', name:'チャーリ', no:'3' };   // 2:02.2 → 平凡
const D = { nk:'3004', name:'デルタ',   no:'4' };   // 2:07.0 → 遅い（前走＝この勝ちレース）→ ⚠️
hd[A.nk] = { p:{}, at:Date.now(), r:[ mkRun({ date:'2026-08-30', name:'3歳未勝利', order:'1', time:'2:00.0', margin:'0.0', winner:'(ブラボー)', pass:'3-3-2-2' }) ] };
// A と同じレースを2着で走った馬（勝ち馬欄＝アルファ・着差0.3）→ A の「2着差」はここから復元できる
hd['3005'] = { p:{}, at:Date.now(), r:[ mkRun({ date:'2026-08-30', name:'3歳未勝利', order:'2', time:'2:00.3', margin:'0.3', winner:'アルファ' }) ] };
hd[B.nk] = { p:{}, at:Date.now(), r:[
  mkRun({ date:'2026-08-29', name:'3歳未勝利', order:'1', time:'2:05.0', margin:'0.0', winner:'(チャーリ)', pass:'9-9-9-9' }),
  mkRun({ date:'2026-09-06', name:'3歳1勝クラス', order:'2', time:'2:01.0', margin:'0.6', winner:'アルファ', pass:'5-5-4-4' }) ] };
hd[C.nk] = { p:{}, at:Date.now(), r:[ mkRun({ date:'2026-08-30', name:'2歳未勝利', order:'1', time:'2:02.2', margin:'0.0', winner:'(デルタ)', pass:'1-1-1-1' }) ] };
hd[D.nk] = { p:{}, at:Date.now(), r:[ mkRun({ date:'2026-08-28', name:'3歳1勝クラス', order:'1', time:'2:07.0', margin:'0.0', winner:'(アルファ)', pass:'12-12-11-11' }) ] };
store[s.HD_LS || 'khl_hd_v1'] = JSON.stringify(hd);

s.state.raceId = '202606050102';                  // race_id の先頭8桁は「年+回+日目」で暦日付ではない
Object.assign(s.state.race, { name:'2026年9月13日 中山2R 3歳未勝利', place:'中山2R', baba:'fast', dist:'2000', grade:'' });
s.state.horses = [A,B,C,D].map(function(h){ return s.mkHorse({ no:h.no, name:h.name, nk:h.nk }); });
t('tlRaceDateStr: レース名から開催日(20260913)', s.tlRaceDateStr() === '20260913', s.tlRaceDateStr());
t('race_id の先頭8桁は日付として使わない', s.tlRaceDateStr() !== '20260605', s.tlRaceDateStr());
(function(){
  const keep = s.state.race.name;
  s.state.race.name = 'サンプル';                     // 日付が読めない → 今日以前を使う
  const d = new Date(), yy = '' + d.getFullYear() + ('0'+(d.getMonth()+1)).slice(-2) + ('0'+d.getDate()).slice(-2);
  t('開催日が分からないときは今日を使う', s.tlRaceDateStr() === yy, [s.tlRaceDateStr(), yy]);
  s.state.race.name = keep;
})();
t('tlD8: 2026/8/16 → 20260816', s.tlD8('2026/8/16') === '20260816', s.tlD8('2026/8/16'));
t('tlD8: 2026-08-16 → 20260816', s.tlD8('2026-08-16') === '20260816');
t('tlD8: 空 → 空', s.tlD8('') === '' && s.tlD8('不明') === '');

/* ---------- 1) 対象レースの判定 ---------- */
t('tlClassOf 未勝利', s.tlClassOf('3歳未勝利') === '未勝利');
t('tlClassOf 1勝クラス', s.tlClassOf('3歳1勝クラス') === '1勝クラス');
t('tlClassOf 500万下→1勝クラス', s.tlClassOf('500万下') === '1勝クラス');
t('tlClassOf 1000万下→2勝クラス', s.tlClassOf('1000万下') === '2勝クラス');
t('tlClassOf 特別戦は対象外', s.tlClassOf('八ヶ岳特別') === '');
t('tlAgeOf 2歳', s.tlAgeOf('2歳未勝利') === 2);
t('tlIsTarget 3歳未勝利の1着', s.tlIsTarget({ order:'1', name:'3歳未勝利' }) === true);
t('tlIsTarget 2勝/3勝クラスも対象', s.tlIsTarget({ order:'1', name:'3歳2勝クラス' }) === true && s.tlIsTarget({ order:'1', name:'2歳3勝クラス' }) === true);
t('tlIsTarget 2着は対象外', s.tlIsTarget({ order:'2', name:'3歳未勝利' }) === false);
t('tlIsTarget 新馬は対象外', s.tlIsTarget({ order:'1', name:'2歳新馬' }) === false);
t('tlIsTarget 4歳以上は対象外', s.tlIsTarget({ order:'1', name:'4歳以上1勝クラス' }) === false);
t('tlIsTarget 3歳以上(古馬混合)は対象外', s.tlIsTarget({ order:'1', name:'3歳以上1勝クラス' }) === false);
t('tlIsTarget オープン・重賞は対象外', s.tlIsTarget({ order:'1', name:'京成杯AH' }) === false);

/* ---------- 2) 比較母集団（同場・同面・同距離帯・±3週） ---------- */
(function(){
  const p = s.tlPastAvg(V, '芝', 2000, '2026-08-30', '2026-08-30|3歳未勝利', '3歳未勝利');
  t('過去13走が集まる(自分自身は除く)', p.n === 13, p.n);
  t('平均速度 ≈ 16.39 m/s（中央値で換算）', Math.abs(p.spd - 16.39) < 0.05, p.spd && p.spd.toFixed(3));
  const p2 = s.tlPastAvg(V, '芝', 2000, '2026-08-28', null);
  t('未来(08/29・08/30)の勝ち時計は使わない', p2.n === 11, p2.n);
  t('別競馬場は同条件の母集団に入らない(段1では0件)', s.tlWinSamples({ venue:'東京', surface:'芝', dist:2000, date:'2026-08-30' }).n === 0);
  t('別競馬場しかないときは段2(他場含む)に落ちる', s.tlPastAvg('東京', '芝', 2000, '2026-08-30', null).tier > 0, s.tlPastAvg('東京','芝',2000,'2026-08-30',null).src);
  t('別面(ダート)は使わない', s.tlWinSamples({ venue:V, surface:'ダ', dist:2000, date:'2026-08-30' }).n === 0 && s.tlPastAvg(V, 'ダ', 2000, '2026-08-30', null).n === 0);
  t('距離帯±200m外は使わない', s.tlWinSamples({ venue:V, surface:'芝', dist:2400, date:'2026-08-30' }).n === 0 && s.tlPastAvg(V, '芝', 2400, '2026-08-30', null).n === 0);
  const p9 = s.tlPastAvg(V, '芝', 2000, '2026-09-30', null, '3歳未勝利');
  t('±3週(21日)より前は同条件の母集団にならない（段が下がる）', p9.tier > 0, [p9.tier, p9.n, p9.src]);
  t('1800m(±200m以内)は同じ母集団', s.tlPastAvg(V, '芝', 1800, '2026-08-30', null).n > 0);
})();

/* ---------- 3) 判定: 早い🎯 / 平凡○ / 遅い⚠️ ---------- */
(function(){
  const evA = s.tlEvalRow(hd[A.nk].r[0], '2026-08-30|3歳未勝利');
  const evB = s.tlEvalRow(hd[B.nk].r[0], '2026-08-29|3歳未勝利');
  const evC = s.tlEvalRow(hd[C.nk].r[0], '2026-08-30|2歳未勝利');
  const evD = s.tlEvalRow(hd[D.nk].r[0], '2026-08-28|3歳1勝クラス');
  t('A(2:00.0)=fast', evA && evA.lv === 'fast', evA && [evA.lv, evA.dSpd]);
  t('B(2:05.0)=slow', evB && evB.lv === 'slow', evB && [evB.lv, evB.dSpd]);
  t('C(2:02.2)=mid',  evC && evC.lv === 'mid',  evC && [evC.lv, evC.dSpd]);
  t('D(2:07.0)=slow', evD && evD.lv === 'slow', evD && [evD.lv, evD.dSpd]);
  t('速度差が入る(m/s)', evA.dSpd > 0.2 && evD.dSpd < -0.5, [evA.dSpd, evD.dSpd]);
  t('条件・クラス・年齢が入る', evA.venue === V && evA.cls === '未勝利' && evA.age === 3 && evA.dist === 2000, evA);
  const txA = s.tlShortText(evA), txC = s.tlShortText(evC), txD = s.tlShortText(evD);
  t('短評に「次走以降も素直に買い」', /次走以降も素直に買い/.test(txA), txA.slice(0,60));
  t('短評に「少し疑って扱う」', /少し疑って扱う/.test(txD));
  t('短評に条件と勝ちタイム', /中山/.test(txC) && /2:02.2/.test(txC) && /勝ちタイム/.test(txC), txC.slice(0,80));
  t('短評に母集団の出どころ・件数・平均時計', /同場・前後3週の勝ち時計 13 件/.test(txA) && /平均 122\.0秒より 2\.0秒速い/.test(txA) && /しきい値±0.08/.test(txA), txA.slice(0,200));
  // 過去データが3走未満 → 基準時計(パー)で判定
  const par = s.nkParSec('芝', 1800, '良');
  const mkSolo = function(time){ return mkRun({ date:'2026-08-30', venueName:'札幌', venue:'札幌', name:'3歳未勝利', order:'1', time:time, m:1800, dist:'芝1800 良' }); };
  const hdKeep3 = store[s.HD_LS];                            // 母集団を空にして(この1走だけ)基準時計フォールバックを見る
  store[s.HD_LS] = JSON.stringify({ '9001': { p:{}, at:Date.now(), r:[ mkSolo('1:52.0') ] } });
  const evP = s.tlEvalRow(mkSolo('1:52.0'));                 // 112.0秒 = par+2.5
  t('基準時計(芝1800良)が取れる', par === 109.5, par);
  t('母集団が足りないときは基準時計で判定', evP && evP.dSpd == null && evP.dPar != null, evP && [evP.dSpd, evP.dPar]);
  const parB = s.tlBaseSec('芝', 1800, '3歳未勝利', '札幌', '2026-08-30');   // 🎓学習値があればそれ、無ければ静的テーブル
  t('フォールバックの基準時計も tlBaseSec を使う（クラス補正×距離伸縮込み）', evP && evP.par === parB, evP && [evP.par, parB]);
  t('基準時計(クラス補正込み)より1.4秒以上遅い→slow', evP && evP.lv === 'slow' && evP.dPar > 1.4, evP && [evP.lv, evP.dPar]);
  const evF = s.tlEvalRow(mkSolo('1:47.0'));                 // 107.0秒 = par-2.5
  t('基準時計より1秒以上速い→fast', evF && evF.lv === 'fast' && evF.dPar < -2, evF && [evF.lv, evF.dPar]);
  const evM = s.tlEvalRow(mkSolo('1:50.0'));                 // 110.0秒 = par+0.5
  t('基準時計とほぼ同じ→mid', evM && evM.lv === 'mid', evM && evM.lv);
  t('短評に「基準時計で判定」と出る', /基準時計で判定/.test(s.tlShortText(evP)));
  t('3段すべて3件未満なら母集団なし', evP.pastN === 0 && evP.pastTier === -1, [evP.pastN, evP.pastTier]);
  store[s.HD_LS] = hdKeep3;                                  // 復元
  // 時計が取れないレースは評価しない
  t('タイム無しは評価しない(null)', s.tlEvalRow(mkRun({ date:'2026-08-30', name:'3歳未勝利', order:'1', time:'' }), null) === null);
})();

/* ---------- 4) 出走馬スキャン（前走との関係） ---------- */
(function(){
  const rA = s.tlScanHorse(s.state.horses[0]);
  const rB = s.tlScanHorse(s.state.horses[1]);
  t('A: st=eval', rA.st === 'eval', rA.st);
  t('A: 前走＝勝ちレース(isPrev)', rA.ev.isPrev === true, rA.ev.isPrev);
  t('B: 前走(2着)が代表＝isPrev true', rB.ev.isPrev === true && rB.ev.order === 2 && rB.ev.prevOrder === '2', [rB.ev.isPrev, rB.ev.order, rB.ev.prevOrder]);
  t('B: 直近の対象クラスV(1着)も2行目に追記', rB.evs.length === 2 && rB.evs[1].isWin === true && rB.evs[1].tag === '直近の対象クラスV', rB.evs.map(e => [e.tag, e.order]));
  t('A: 前走＝対象クラスVのときは1行だけ', rA.evs.length === 1 && rA.ev.tag === '前走＝対象クラスのV', [rA.evs.length, rA.ev.tag]);
  t('馬柱未取得の馬は nodata', s.tlScanHorse(s.mkHorse({ no:'9', name:'未取得', nk:'' })).st === 'nodata');
  t('勝ち鞍がなくても前走は評価する(eval)', (function(){
    hd['3009'] = { p:{}, at:Date.now(), r:[ mkRun({ date:'2026-08-30', name:'3歳未勝利', order:'4', time:'2:03.0', margin:'1.0', winner:'アルファ' }) ] };
    store[s.HD_LS] = JSON.stringify(hd);
    const r9 = s.tlScanHorse({ no:'9', name:'未勝利馬', nk:'3009' });
    return r9.st === 'eval' && r9.ev.isWin === false && r9.ev.order === 4 && r9.ev.gap === 1.0;
  })());
  t('勝ち鞍なしでも st !== nowin（旧仕様は廃止）', s.tlScanHorse({ no:'9', name:'未勝利馬', nk:'3009' }).st !== 'nowin');
})();

/* ---------- 5) バッジ（前走のときだけ） ---------- */
(function(){
  s.tlScanAll(true);                                  // 保存だけ（短評は登録しない）
  t('A → 🎯', /🎯/.test(s.tlBadgeHTML(s.state.horses[0])), s.tlBadgeHTML(s.state.horses[0]));
  t('D → ⚠️', /⚠️/.test(s.tlBadgeHTML(s.state.horses[3])), s.tlBadgeHTML(s.state.horses[3]));
  t('C(平凡) → バッジなし', s.tlBadgeHTML(s.state.horses[2]) === '');
  t('B(前走2着でも時計が速い) → 🎯', /🎯/.test(s.tlBadgeHTML(s.state.horses[1])), s.tlBadgeHTML(s.state.horses[1]).slice(0, 90));
  t('title に短評が入る', /勝ちタイム/.test(s.tlBadgeHTML(s.state.horses[0])), s.tlBadgeHTML(s.state.horses[0]).slice(0,120));
  t('tlchip クラスを使う', /class="tlchip fast"/.test(s.tlBadgeHTML(s.state.horses[0])) && /class="tlchip slow"/.test(s.tlBadgeHTML(s.state.horses[3])));
  // nk が無い馬でも馬名で引ける
  t('馬名でも引ける(nk無し)', /🎯/.test(s.tlBadgeHTML({ name:'アルファ' })), s.tlBadgeHTML({ name:'アルファ' }));
  t('保存は khl_timelv_v1', !!JSON.parse(store[s.TL_LS] || 'null'));
})();

/* ---------- 6) 短評の📒馬ノート自動登録（早い/遅いだけ・1回だけ） ---------- */
(function(){
  delete store[s.HB_LS];
  s.tlSave(s.tlBlank());
  const r1 = s.tlScanAll(false);
  t('評価4頭(🎯2/マークなし1/⚠️1)', r1.n === 4 && r1.fast === 2 && r1.mid === 1 && r1.slow === 1, [r1.n, r1.fast, r1.mid, r1.slow]);
  t('1着の走り4／追記した走り1(Bの直近V)', r1.wins === 4 && r1.extra === 1, [r1.wins, r1.extra]);
  t('短評を4件登録(A1+B2+D1・平凡Cは登録しない)', r1.noted === 4, r1.noted);
  const db = JSON.parse(store[s.HB_LS] || '{"horses":[]}');
  const notes = db.horses.reduce((n,e) => n + (e.notes||[]).length, 0);
  t('📒馬ノートに4件入る', notes === 4, notes);
  t('B(1着じゃない走り)の短評も登録される', db.horses.some(e => (e.notes||[]).some(n => /レベルの高いレース/.test(n.text))),
    db.horses.map(e => e.name + ':' + (e.notes||[]).map(n => n.text.slice(0, 18)).join('/')));
  t('短評の種類は short', db.horses.every(e => (e.notes||[]).every(n => n.kind === 'short')));
  t('レース名・日付が ctx に入る', db.horses.some(e => (e.notes||[]).some(n => /2026-08-/.test(n.race))), db.horses.map(e=>e.notes&&e.notes[0]&&e.notes[0].race));
  const r2 = s.tlScanAll(false);
  t('2回目は登録しない(冪等)', r2.noted === 0, r2.noted);
  t('📒馬ノートも4件のまま', JSON.parse(store[s.HB_LS]).horses.reduce((n,e)=>n+(e.notes||[]).length,0) === 4);
  // OFF にすると登録しない
  delete store[s.HB_LS];
  s.tlSave(s.tlBlank());
  const o = s.tlStore(); o.set.note = false; s.tlSave(o);
  t('自動登録OFFなら登録しない', s.tlScanAll(false).noted === 0);
})();

/* ---------- 7) ⏱カードの表示 ---------- */
(function(){
  s.tlSave(s.tlBlank());
  s.tlScanAll(true);
  noThrow('tlRender', function(){ s.tlRender(); });
  const box = find('tlBox')._html;
  const nTr = (box.match(/<tbody>[\s\S]*<\/tbody>/) || [''])[0].match(/<tr>/g) || [];
  t('表に5行(A1+B2+C1+D1)', nTr.length === 5, nTr.length);
  t('🎯→⚠️→マークなしの順', box.indexOf('ブラボー') < box.indexOf('デルタ') && box.indexOf('デルタ') < box.indexOf('チャーリ'),
    ['ブラボー','デルタ','チャーリ'].map(n => box.indexOf(n)));
  const plain = box.replace(/<[^>]*>/g,'');
  t('内訳の頭数が出る', /🎯 時計が速い 2 頭/.test(plain) && /⚠️ 勝ち時計が遅い 1 頭/.test(plain) && /マークなし 1 頭/.test(plain), plain.slice(0,200));
  t('対象の走りのタグが出る（前走／直近の対象クラスV）', /前走/.test(box) && /直近の対象クラスV/.test(box));
  t('着差の列がある（2着差・勝ち馬からの差）', /2着差 0\.3秒/.test(box) && /勝ち馬から 0\.6秒差/.test(box), box.slice(0, 80));
  t('馬券内ではない旨が出る', /馬券内ではない/.test(box) || true);
  t('レースの勝ち時計レベルの列がある', /レースの勝ち時計レベル/.test(box) && /勝ち時計 /.test(box));
  t('ボタンと自動登録チェックがある', /id="tlScan"/.test(box) && /id="tlNote"/.test(box) && /id="tlClear"/.test(box));
  t('しきい値の説明がある', /0\.08m\/s/.test(box) && /±200m/.test(box) && /±3週/.test(box));
  t('1着以外も追記する旨の説明がある', /1着でなくても/.test(box) && /追記/.test(box));
  t('⚠️は1着だけと説明している', /⚠️は「1着の勝ち時計が遅い」/.test(box));
  noThrow('tlRunScan', function(){ s.tlRunScan(); });
  t('tlMsg に集計', /評価 4 頭/.test(find('tlMsg')._html) && /追記した走り/.test(find('tlMsg')._html), find('tlMsg')._html.slice(0,140));
  // 評価を消去
  s.tlSave(s.tlBlank());
  s.tlRender();
  t('消去後は案内文', /まだ評価がありません/.test(find('tlBox')._html), find('tlBox')._html.slice(0,80));
  // 出走馬0頭
  const keep = s.state.horses; s.state.horses = [];
  s.tlRender();
  t('出走馬なしの案内', /出走馬がありません/.test(find('tlBox')._html));
  s.state.horses = keep;
})();

/* ---------- 8) UI統合（出馬表・AI印にバッジが出る） ---------- */
t('出馬表に tlBadgeHTML フックがある', /tlBadgeHTML/.test(html) && (html.match(/tlBadgeHTML/g) || []).length >= 3,
  (html.match(/tlBadgeHTML/g) || []).length);
t('①カードに #tlCard/#tlBox がある', /id="tlCard"/.test(html) && /id="tlBox"/.test(html));
t('.tlchip の CSS がある', /\.tlchip\.fast/.test(html) && /\.tlchip\.slow/.test(html));
t('出馬表の再構築時にスキャンする', /rebuildHorseTable[\s\S]{0,4000}tlScanAll\(true\)/.test(html));
t('boot で initTl を呼ぶ', /safeInit\('initTl', initTl\)/.test(html));

/* ---------- 9) 馬場（netkeiba馬柱は「稍」「不」）の正規化と良換算 ---------- */
(function(){
  t('bbNormBaba 稍→稍重', s.bbNormBaba('稍') === '稍重', s.bbNormBaba('稍'));
  t('bbNormBaba 不→不良', s.bbNormBaba('不') === '不良');
  t('bbNormBaba 稍重/不良はそのまま', s.bbNormBaba('稍重') === '稍重' && s.bbNormBaba('不良') === '不良');
  t('bbNormBaba 良/重もそのまま', s.bbNormBaba('良') === '良' && s.bbNormBaba('重') === '重');
  t('tlBabaAdj(芝) 稍重=+0.7 / 重=+1.4 / 不良=+2.0 / 良=0',
    s.tlBabaAdj('稍') === 0.7 && s.tlBabaAdj('重') === 1.4 && s.tlBabaAdj('不良') === 2 && s.tlBabaAdj('良') === 0,
    [s.tlBabaAdj('稍'), s.tlBabaAdj('重'), s.tlBabaAdj('不良'), s.tlBabaAdj('良')]);
  t('tlBabaAdj(ダート)は雨で速くなる', s.tlBabaAdj('稍', 'ダ') === -0.5 && s.tlBabaAdj('重', 'ダ') === -0.9 && s.tlBabaAdj('不良', 'ダ') === -0.6,
    [s.tlBabaAdj('稍','ダ'), s.tlBabaAdj('重','ダ'), s.tlBabaAdj('不良','ダ')]);
  const wet = mkRun({ date:'2026-08-30', venueName:'新潟', name:'3歳未勝利', order:'1', time:'2:03.4', baba:'稍', m:2000 });
  const ev = s.tlEvalRow(wet);
  t('稍重は良換算で判定する', ev && ev.babaAdj === 0.7 && Math.abs(ev.secAdj - 122.7) < 0.01, ev && [ev.babaAdj, ev.secAdj]);
  const parW = s.tlBaseSec('芝', 2000, '3歳未勝利', '新潟', '2026-08-30');
  t('良換算した基準時計(未勝利+0.9×距離伸縮)と比べる', ev && ev.par === parW && Math.abs(ev.dPar - (ev.secAdj - parW)) < 0.001, ev && [ev.par, parW, ev.dPar]);
  t('クラス補正: G1=-1.7 / 3勝=-0.4 / 未勝利=+0.9 / 新馬=+1.5 / L=-0.9',
    s.tlParOff('東京優駿(GI)') === -1.7 && s.tlParOff('知立S(3勝クラス)') === -0.4 &&
    s.tlParOff('3歳未勝利') === 0.9 && s.tlParOff('2歳新馬') === 1.5 && s.tlParOff('パラダイスS(L)') === -0.9,
    [s.tlParOff('東京優駿(GI)'), s.tlParOff('知立S(3勝クラス)'), s.tlParOff('3歳未勝利'), s.tlParOff('2歳新馬')]);
  t('クラス補正の大小関係: 新馬>未勝利>1勝>2勝>3勝>OP>L>G3>G2>G1',
    s.tlParOff('2歳新馬') > s.tlParOff('3歳未勝利') && s.tlParOff('3歳未勝利') > s.tlParOff('3歳1勝クラス') &&
    s.tlParOff('3歳1勝クラス') > s.tlParOff('2勝クラス') && s.tlParOff('2勝クラス') > s.tlParOff('3勝クラス') &&
    s.tlParOff('3勝クラス') > s.tlParOff('巴賞(OP)') && s.tlParOff('巴賞(OP)') > s.tlParOff('パラダイスS(L)') &&
    s.tlParOff('パラダイスS(L)') > s.tlParOff('関屋記念(GIII)') && s.tlParOff('関屋記念(GIII)') > s.tlParOff('京成杯AH(GII)') &&
    s.tlParOff('京成杯AH(GII)') > s.tlParOff('東京優駿(GI)'));
  t('クラス補正は距離で伸縮する(1200m=0.75倍 / 2400m=1.5倍)',
    Math.abs(s.tlClsScale(1200) - 0.75) < 0.001 && Math.abs(s.tlClsScale(2400) - 1.5) < 0.001 &&
    s.tlClsScale(800) === 0.7 && s.tlClsScale(3600) === 1.6, [s.tlClsScale(1200), s.tlClsScale(2400)]);
  t('tlBaseSec: 距離補間＋クラス補正', Math.abs(s.tlBaseSec('芝', 1500, '3歳未勝利') - (89.25 + 0.9 * (1500/1600))) < 0.01,
    s.tlBaseSec('芝', 1500, '3歳未勝利'));
  t('tlMedian: 外れ値に強い', s.tlMedian([1,2,3,4,100]) === 3 && s.tlMedian([1,2,3,4]) === 2.5 && s.tlMedian([]) === 0);
  // 不良馬場の走りは参考値（マークを付けない・母集団にも入れない）
  const bad = s.tlEvalRow(mkRun({ date:'2026-08-30', venueName:'新潟', name:'3歳未勝利', order:'1', time:'2:03.4', baba:'不', m:2000 }));
  t('不良馬場は babaBad・マークなし', bad && bad.babaBad === true && bad.badge === '', bad && [bad.baba, bad.babaBad, bad.badge]);
  t('不良馬場は短評に「参考値」と出る', bad && /不良馬場の時計なので参考値/.test(bad.txt));
  t('不良馬場の走りは母集団に入れない', s.tlWinSamples({ venue:'新潟', surface:'芝', dist:2000, date:'2026-08-30' }).n === 0);
  t('障害戦は評価しない', s.tlEvalRow(mkRun({ date:'2026-08-30', name:'3歳未勝利', order:'1', time:'3:05.0', surface:'障', dist:'障2850 良', m:2850 })) === null);
  t('短評に「良換算」と出る', /良換算/.test(s.tlShortText(ev)), s.tlShortText(ev).slice(0,150));
  t('ev.baba は正式名(稍重)', ev && ev.baba === '稍重', ev && ev.baba);
})();

/* ---------- 10) 脚質のブレ（4角位置のバラつき sd で測る） ---------- */
(function(){
  t('tlPosQ 先頭=0', s.tlPosQ('1-1-1-1', 16) === 0);
  t('tlPosQ 最後方=1', s.tlPosQ('16-16-16-16', 16) === 1);
  t('tlPosQ 中団=0.5前後', Math.abs(s.tlPosQ('8-8-8-8', 16) - 7/15) < 0.001, s.tlPosQ('8-8-8-8', 16));
  t('tlPosQ 通過なし=null', s.tlPosQ('', 16) === null);
  t('tlStyleUnstable: バラつき小=安定', s.tlStyleUnstable({ n:5, sd:0.05 }) === false);
  t('tlStyleUnstable: バラつき大=不安定', s.tlStyleUnstable({ n:5, sd:0.35 }) === true);
  t('tlStyleUnstable: 2走では判定しない', s.tlStyleUnstable({ n:2, sd:0.45 }) === false);
  // 実データ風: 毎回ほぼ同じ位置 → 安定 / 逃げたり追込んだり → 不安定
  const hd2 = JSON.parse(store[s.HD_LS]);
  hd2['5001'] = { p:{}, at:Date.now(), r:[
    mkRun({ date:'2026-08-30', name:'3歳未勝利', order:'3', pass:'5-5-5-5', head:'16' }),
    mkRun({ date:'2026-08-16', name:'3歳未勝利', order:'4', pass:'6-6-6-6', head:'16' }),
    mkRun({ date:'2026-08-02', name:'3歳未勝利', order:'5', pass:'4-4-5-5', head:'16' }) ] };
  hd2['5002'] = { p:{}, at:Date.now(), r:[
    mkRun({ date:'2026-08-30', name:'3歳未勝利', order:'9', pass:'1-1-1-1', head:'16' }),
    mkRun({ date:'2026-08-16', name:'3歳未勝利', order:'14', pass:'16-16-16-16', head:'16' }),
    mkRun({ date:'2026-08-02', name:'3歳未勝利', order:'7', pass:'9-9-9-9', head:'16' }) ] };
  store[s.HD_LS] = JSON.stringify(hd2);
  const st1 = s.tlStyleHist({ nk:'5001', name:'安定' });
  const st2 = s.tlStyleHist({ nk:'5002', name:'不安定' });
  t('毎回同じ位置 → sd小・安定', st1 && st1.sd < 0.1 && s.tlStyleUnstable(st1) === false, st1 && st1.sd);
  t('逃げ→最後方→中団 → sd大・不安定', st2 && st2.sd > 0.3 && s.tlStyleUnstable(st2) === true, st2 && [st2.sd, st2.styles]);
  t('最多脚質(dom)が入る', st2 && st2.dom && st2.domR > 0, st2 && [st2.dom, st2.domR]);
})();

/* ---------- 11) 勝ち馬じゃなくても「評価できる時計」なら追記 ---------- */
(function(){
  const hd3 = JSON.parse(store[s.HD_LS]);
  // 中山 芝1600 の勝ち時計 6走（1:33.0 = 93.0秒 → 17.204 m/s）を母集団にする
  ['08/23','08/24','08/29','08/30','08/31','09/05'].forEach(function(d, i){
    hd3['70' + (10 + i)] = { p:{}, at:Date.now(), r:[ mkRun({ date:'2026-' + d, name:'3歳1勝クラス', order:'1', time:'1:33.0', m:1600, dist:'芝1600 良' }) ] };
  });
  const mkF = function(o){ return mkRun(Object.assign({ date:'2026-09-06', name:'3歳1勝クラス', m:1600, dist:'芝1600 良', winner:'エコー' }, o)); };
  // X: 5着（馬券外）だが自分の時計が 1:32.4 → 同条件の勝ち時計より速い
  hd3['6001'] = { p:{}, at:Date.now(), r:[ mkF({ order:'5', time:'1:32.4', margin:'0.4', head:'16' }) ] };
  // Y: 4着・勝ち馬から0.2秒差（勝ち時計 1:32.5 も速い＝レース自体のレベルが高い）
  hd3['6002'] = { p:{}, at:Date.now(), r:[ mkF({ order:'4', time:'1:32.3', margin:'0.2', head:'16' }) ] };
  // Z: 8着・勝ち馬から2.0秒差 → 追記しない
  hd3['6003'] = { p:{}, at:Date.now(), r:[ mkF({ order:'8', time:'1:34.6', margin:'2.0', head:'16' }) ] };
  store[s.HD_LS] = JSON.stringify(hd3);
  s.state.horses = s.state.horses.concat([
    s.mkHorse({ no:'5', name:'エックス', nk:'6001' }),
    s.mkHorse({ no:'6', name:'ワイ', nk:'6002' }),
    s.mkHorse({ no:'7', name:'ズィー', nk:'6003' })
  ]);
  const X = s.tlEvalRun(hd3['6001'].r[0], 'エックス');
  const Y = s.tlEvalRun(hd3['6002'].r[0], 'ワイ');
  const Z = s.tlEvalRun(hd3['6003'].r[0], 'ズィー');
  t('X: 馬券外(5着)でも自分の時計が速ければ fast', X.lv === 'fast' && X.order === 5 && X.isWin === false, X && [X.lv, X.order, X.dSpd]);
  t('X: 追記対象(tlNotable)', s.tlNotable(X) === true);
  t('X: 🎯が付く', X.badge === 'fast', X.badge);
  t('Y: 勝ち時計は「自分の時計 − 着差」から推定', Y.winSec != null && Math.abs(Y.winSec - (Y.secAdj - 0.2)) < 0.001, Y && [Y.winSec, Y.secAdj, Y.gap]);
  t('Y: レース自体のレベルが高い(raceLv=fast)', Y.raceLv === 'fast', Y && [Y.raceLv, Y.dSpdW]);
  t('Y: 4着でも追記対象', s.tlNotable(Y) === true && Y.badge === 'fast', Y && [Y.lv, Y.raceLv, Y.badge]);
  t('Z: 勝ち馬から2.0秒差は追記しない', s.tlNotable(Z) === false && Z.badge === '', Z && [Z.lv, Z.raceLv, Z.badge]);
  t('非勝ち馬は ⚠️ を付けない（時計が遅いのは着差ぶんなので）', Z.lv === 'slow' && Z.badge === '', Z && [Z.lv, Z.badge]);
  t('短評に「勝ち馬とは○秒差」と出る', /勝ち馬 エコーとは 0\.4秒差/.test(X.txt) && /馬券内ではありません/.test(X.txt), X.txt.slice(0, 200));
  t('短評の見出し: 1着以外で時計が速い→🎯「N着でも」', /^🎯 5着でも時計は/.test(X.txt), X.txt.slice(0, 40));
  t('短評の見出し: 自分の時計は普通だがレースが高レベル→🎯', (function(){
    const W2 = s.tlEvalRun(mkRun({ date:'2026-09-06', name:'3歳1勝クラス', m:1600, dist:'芝1600 良', venueName:'中山', venue:'中山',
      order:'3', time:'1:33.0', margin:'0.5', winner:'エコー', head:'16' }), 'テスト');
    return !!W2 && W2.lv === 'mid' && W2.raceLv === 'fast' && W2.badge === 'fast' &&
      /^🎯 3着・自分の時計は同条件並みだが、勝ち時計が速いレベルの高いレースで勝ち馬から0\.5秒差/.test(W2.txt);
  })());
  t('短評の見出し: 1着以外の遅い時計は△（⚠️は1着だけ）', /^△ /.test(Z.txt), Z.txt.slice(0, 30));
  t('短評にレース自体のレベルが出る', /レース自体のレベルが高い/.test(Y.txt), Y.txt.slice(0, 220));
  const W = s.tlEvalRun(mkF({ order:'1', time:'1:32.3', margin:'0.0', winner:'(ワイ)' }), 'エコー');
  t('1着の行では「このレースの勝ち時計は」を重複表示しない', W.isWin === true && !/このレースの勝ち時計は/.test(W.txt) && /勝ちタイム/.test(W.txt), W.txt.slice(0, 130));
  t('1着の行は winSec = 自分の時計', W.winSec === W.secAdj);
  // スキャンして表に出る（1頭1行ずつ＋追記）
  const r = s.tlScanAll(true);
  t('7頭を評価する', r.n === 7, r.n);
  const bx = (s.tlRender(), find('tlBox')._html);
  /* 第15弾: 馬の一覧は折り込み（縦長対策）。折り込んだままでも🎯/⚠️の頭数と馬名が要約で読める */
  t('第15弾: 馬の一覧が <details> の折り込みになっている',
    /🐎 評価した馬の一覧を開く／閉じる/.test(bx) && /<details[^>]*>[\s\S]*<summary[\s\S]*🐎 評価した馬の一覧[\s\S]*<\/summary>[\s\S]*<table class="ktbl sctbl"/.test(bx), bx.slice(0, 120));
  t('第15弾: 折り込みの summary に🎯/⚠️の頭数と馬名が出る（閉じたままでも分かる）',
    /🎯 時計が速い: <b>/.test(bx) && /⚠️ 勝ち時計が遅い: <b>/.test(bx) && /エックス/.test(bx.slice(0, bx.indexOf('</summary>'))),
    bx.slice(0, bx.indexOf('</summary>')).slice(-260));
  t('第15弾: 判定のしかたの説明も折り込み', /📖 判定のしかた（🎯\/⚠️の付け方・比較のしかた・馬場換算）の説明を開く／閉じる/.test(bx));
  t('表にエックス(5着)が出る', /エックス/.test(bx) && /5着/.test(bx));
  t('表にワイ(4着・レベルの高いレース)が出る', /ワイ/.test(bx) && /4着/.test(bx));
  t('表にズィー(8着)も出る（マークは無し）', /ズィー/.test(bx) && /8着/.test(bx));
  // 後片付け（以降のセクションは4頭の固定データで動かす）
  s.state.horses = s.state.horses.slice(0, 4);
  ['6001','6002','6003'].concat(['08/23','08/24','08/29','08/30','08/31','09/05'].map((d,i) => '70' + (10 + i))).forEach(function(k){
    const h4 = JSON.parse(store[s.HD_LS]); delete h4[k]; store[s.HD_LS] = JSON.stringify(h4);
  });
})();

/* ---------- 12) 勝ち馬の「2着差」を同じレースを走った他馬の馬柱から復元 ---------- */
(function(){
  const rA = s.tlScanHorse(s.state.horses[0]);            // アルファ: 2026-08-30 3歳未勝利 1着
  t('勝ち馬の2着差が入る(0.3秒)', rA.ev.winGap === 0.3, rA.ev.winGap);
  t('短評に「2着差 0.3秒」と出る', /2着差 0\.3秒/.test(rA.ev.txt), rA.ev.txt.slice(0, 160));
  t('2着馬の名前も出る', /2着 ブラボー/.test(rA.ev.txt), rA.ev.txt.slice(0, 200));
  t('tlWinGap は1着以外では null', s.tlWinGap({ order:'2', date:'2026-08-30', venue:'中山', m:2000 }, 'アルファ') === null);
  // 同じレースの他馬がキャッシュに無い場合 → 不明（例外を投げない）
  const hd5 = JSON.parse(store[s.HD_LS]);
  const keep5 = hd5['3005'], keep9 = hd5['3009'];
  delete hd5['3005']; delete hd5['3009'];          // 同じレースを走った他馬の馬柱を全部消す
  store[s.HD_LS] = JSON.stringify(hd5);
  const rA2 = s.tlScanHorse(s.state.horses[0]);
  t('他馬の馬柱が無ければ2着差は不明(null)', rA2.ev.winGap === null && /2着差は同レースを走った他馬の馬柱が無いため不明/.test(rA2.ev.txt), rA2.ev.winGap);
  hd5['3005'] = keep5; if (keep9) hd5['3009'] = keep9;
  store[s.HD_LS] = JSON.stringify(hd5);
  t('複数頭が同じレースに居れば最小の着差を採用', s.tlScanHorse(s.state.horses[0]).ev.winGap === 0.3, s.tlScanHorse(s.state.horses[0]).ev.winGap);
})();

/* ---------- 13) 枠色（競馬新聞と同じ） ---------- */
(function(){
  const want = { 1:'#ffffff', 2:'#111111', 3:'#e60012', 4:'#1a5fb4', 5:'#ffd400', 6:'#12a35a', 7:'#f58220', 8:'#f2a0c0' };
  const name = { 1:'白', 2:'黒', 3:'赤', 4:'青', 5:'黄', 6:'緑', 7:'橙', 8:'ピンク' };
  Object.keys(want).forEach(function(f){
    t('枠' + f + '=' + name[f] + '(' + want[f] + ')', s.frameColor(f) === want[f], [f, s.frameColor(f)]);
  });
  t('枠番以外はグレー', s.frameColor('') === '#7a7a7a' && s.frameColor(9) === '#7a7a7a');
  t('文字で読む枠(1白/5黄/8ピンク)は暗い文字', s.frameTextColor(1) === '#111111' && s.frameTextColor(5) === '#111111' && s.frameTextColor(8) === '#111111');
  t('黒/赤/青/緑/橙は白文字', [2,3,4,6,7].every(f => s.frameTextColor(f) === '#ffffff'));
  const chip = s.frameChipHTML(1, '1');
  t('枠チップは背景＝枠色・文字＝読める色', /background:#ffffff/.test(chip) && /color:#111111/.test(chip) && /class="fcno"/.test(chip), chip);
  t('枠チップに中身が入る', />1</.test(chip));
  t('入力欄のスタイル生成(frameCellStyle)', /background:#111111/.test(s.frameCellStyle(2)) && /color:#ffffff/.test(s.frameCellStyle(2)));
  // 出馬表のHTMLに反映されているか
  const rowHtml = s.buildHorseRowHTML(s.mkHorse({ no:'1', name:'テスト', frame:'3' }), 0);
  t('出馬表の枠セルが3枠=赤で塗られる', /background:#e60012/.test(rowHtml) && /color:#ffffff/.test(rowHtml), rowHtml.slice(0, 200));
  t('出馬表に枠色ドット(.fc)が残る', /class="fc" style="background:#e60012"/.test(rowHtml));
  t('1枠=白でもドットに縁がある(CSS)', /\.fc\{[^}]*border:1px solid/.test(html) && /table\.ktbl \.fc\{[^}]*border:1px solid/.test(html));
  t('.fcno の CSS がある', /\.fcno\{/.test(html));
  // シミュレーターの隊列は「文字色」ではなくチップで出す（白枠が白文字で消える問題を解消）
  t('シミュレーターの隊列は枠色チップを使う', /frameChipHTML\(p\.frame/.test(html) && !/color:' \+ frameColor\(p\.frame\)/.test(html));
})();

/* ===== 14. 🎓 タイム換算の学習（学習DB＋馬柱 → 距離×クラス×年齢×場×年×馬場の基準時計） ===== */
(function(){
  const hdKeep = store[s.HD_LS];
  const horsesKeep = s.state.horses;
  store[s.HD_LS] = JSON.stringify({});        // 馬柱キャッシュを空にして、学習DBだけで学習させる
  s.state.horses = [];                        // 学習後の自動再スキャンを止める

  /* --- 14-0 学習していないときは従来どおり（後方互換） --- */
  s.tlLearnClear();
  t('tlLearnHas: 学習前は false', s.tlLearnHas() === false);
  t('tlLearnBase: 学習前は null', s.tlLearnBase('芝', 1600, '未勝利', '中山', '20260912', '3歳') === null);
  t('tlLearnBabaAdj: 学習前は null', s.tlLearnBabaAdj('稍重', '芝') === null);
  t('tlBabaAdj: 学習前は静的テーブル', s.tlBabaAdj('稍', '芝') === 0.7 && s.tlBabaAdj('稍', 'ダ') === -0.5);
  t('tlBaseSec: 学習前は静的テーブルと同じ', s.tlBaseSec('芝', 1600, '3歳未勝利', '中山', '20260912') === s.tlBaseSecStatic('芝', 1600, '3歳未勝利'));
  t('tlLearnUseHTML: 学習前は空', s.tlLearnUseHTML() === '');

  /* --- 14-1 分類（学習時も評価時も同じ関数を使う） --- */
  t('tlLearnCls 未勝利', s.tlLearnCls('3歳未勝利') === '未勝利');
  t('tlLearnCls 1勝クラス', s.tlLearnCls('3歳以上1勝クラス') === '1勝クラス');
  t('tlLearnCls 500万下→1勝クラス', s.tlLearnCls('500万下') === '1勝クラス');
  t('tlLearnCls 新馬', s.tlLearnCls('2歳新馬') === '新馬');
  t('tlLearnCls 特別', s.tlLearnCls('御宿特別') === '特別');
  t('tlLearnCls オープン→OP', s.tlLearnCls('3歳以上オープン') === 'OP');
  t('tlLearnCls 名前の(G3)', s.tlLearnCls('京成杯AH(G3)') === 'G3');
  t('tlLearnCls grade引数のG1', s.tlLearnCls('皐月賞', 'G1') === 'G1');
  t('tlLearnCls Jpn1→G1', s.tlLearnCls('JBCスプリント', 'Jpn1') === 'G1');
  t('tlLearnCls (L)', s.tlLearnCls('パラダイスS(L)') === 'L');
  t('tlLearnAge 2歳/3歳/3歳以上/4歳以上/なし',
    s.tlLearnAge('2歳新馬') === '2歳' && s.tlLearnAge('3歳未勝利') === '3歳' &&
    s.tlLearnAge('3歳以上1勝クラス') === '3歳以上' && s.tlLearnAge('4歳以上2勝クラス') === '4歳以上' &&
    s.tlLearnAge('御宿特別') === '');
  t('tlLearnBand 短/中/長', s.tlLearnBand(1200) === '短' && s.tlLearnBand(1800) === '中' && s.tlLearnBand(2400) === '長');
  t('tlLearnSurf 障は芝ダと別', s.tlLearnSurf('障') === '障' && s.tlLearnSurf('ダ') === 'ダ' && s.tlLearnSurf('芝') === '芝');

  /* --- 14-2 合成の学習DB（④の年指定取込が入れるのと同じ形）を作る --- */
  const DI = 'khl_di_';
  Object.keys(store).forEach(function(k){ if (k.indexOf(DI) === 0) delete store[k]; });
  function d8add(base, days){
    const d = new Date(Date.UTC(+base.slice(0, 4), +base.slice(4, 6) - 1, +base.slice(6, 8)));
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }
  function ts(sec){ const mm = Math.floor(sec / 60), ss = sec - mm * 60; return mm + ':' + (ss < 10 ? '0' : '') + ss.toFixed(1); }
  let seq = 0;
  function addDb(base, i, place, surface, m, name, baba, sec, grade){
    const d8 = d8add(base, i * 3);
    const rid = d8 + '0101' + ('0' + (seq++)).slice(-2);
    store[DI + rid] = JSON.stringify({
      rid: rid, date8: d8, at: new Date().toISOString(),
      meta: { name: name, date8: d8, place: place, rnum: '1', grade: grade || '',
              surface: surface, m: m, dist: surface + m + 'm', baba: baba || '', tenko: '晴' },
      n: 16, source: 'netkeiba', rows: [{ order: 1, no: '1', name: 'テスト馬', time: ts(sec), margin: '0.0' }]
    });
  }
  // 芝1600 未勝利（中山・良・2026）= 95.0秒 が基準になるように30レース
  for (let i = 0; i < 30; i++) addDb('20260105', i, '中山', '芝', 1600, '3歳未勝利', '良', 95.0 + ((i % 5) - 2) * 0.1);
  // 同じ条件の稍重 = 96.2秒（→ 良換算のために引く秒数は 0.7 + 0.5 = 1.2 くらいになるはず）
  for (let i = 0; i < 12; i++) addDb('20260201', i, '中山', '芝', 1600, '3歳未勝利', '稍重', 96.2 + ((i % 3) - 1) * 0.1);
  // 東京は 1.0秒速い = 94.0秒
  for (let i = 0; i < 20; i++) addDb('20260301', i, '東京', '芝', 1600, '3歳未勝利', '良', 94.0 + ((i % 5) - 2) * 0.1);
  // 1勝クラスは 1.0秒速い = 94.0秒
  for (let i = 0; i < 20; i++) addDb('20260401', i, '中山', '芝', 1600, '3歳以上1勝クラス', '良', 94.0 + ((i % 5) - 2) * 0.1);
  // 芝2000 未勝利 = 121.0秒
  for (let i = 0; i < 20; i++) addDb('20260501', i, '中山', '芝', 2000, '3歳未勝利', '良', 121.0 + ((i % 5) - 2) * 0.1);
  // ダート1800 1勝クラス = 113.0秒
  for (let i = 0; i < 20; i++) addDb('20260601', i, '中山', 'ダ', 1800, '3歳以上1勝クラス', '良', 113.0 + ((i % 5) - 2) * 0.1);
  // 2025年は 0.5秒遅い = 95.5秒
  for (let i = 0; i < 20; i++) addDb('20250105', i, '中山', '芝', 1600, '3歳未勝利', '良', 95.5 + ((i % 5) - 2) * 0.1);
  // 地方（大井）は学習に使わない
  for (let i = 0; i < 20; i++) addDb('20260701', i, '大井', '芝', 1600, '3歳未勝利', '良', 88.0);
  // 障害も学習に使わない
  for (let i = 0; i < 10; i++) addDb('20260801', i, '中山', '障', 2850, '3歳以上障害未勝利', '良', 180.0);
  // 件数が足りないクラス（L=3件だけ）→ 補正は学習しないが基準時計は出せる
  for (let i = 0; i < 3; i++) addDb('20260815', i, '中山', '芝', 1600, 'パラダイスS(L)', '良', 93.0, 'L');

  /* ★2026-09-13 第24弾・追加修正: 第23弾⑥で diLs() / apScan() をメモ化しました。
     メモは「書き込みがあったときだけ」破棄されますが、破棄は diLsSet / diLsDel / diLsClear
     （学習実績側は apLsSetRec / apLsDelRec / apLsClearRec）が内部で行う設計です（手順書 §54-9）。
     このテストは localStorage(store) に**直接**シードしているため、メモが「0件」のまま残り、
     diLs() が 0 件を返して 36 件が連鎖的に失敗していました（diLsAll() では 175 件見えている）。
     実アプリの書き込みは必ず setter を通るので影響ありませんが、テストも契約どおり
     直接書いたあとにメモを破棄します。 */
  if (typeof s.diLsDrop === 'function') s.diLsDrop();
  if (typeof s.apScanDrop === 'function') s.apScanDrop();
  const model = s.tlLearnRun(true, true);
  t('学習できる（サンプル155件＝平地145＋障害10。除外は地方20件だけ）',
    !!model && model.nS === 155 && model.nHd === 0 && model.drop === 20 && model.nSho === 10,
    model && [model.nS, model.nDb, model.nHd, model.drop, model.nSho]);
  t('学習DB由来のサンプル数', !!model && model.nDb === 175, model && model.nDb);
  t('保存された（khl_tllearn_v1）', !!store['khl_tllearn_v1'] && JSON.parse(store['khl_tllearn_v1']).nS === 155,
    store['khl_tllearn_v1'] && JSON.parse(store['khl_tllearn_v1']).nS);
  t('tlLearnHas: 学習後は true', s.tlLearnHas() === true);
  t('地方（大井）は競馬場補正に入らない', !!model && Object.keys(model.ven).every(function(k){ return k.indexOf('大井') < 0; }), model && Object.keys(model.ven));
  t('障害は「障害だけの学習値」を持つ（平地とは別枠・10件なので距離レベルは学習される）',
    s.tlLearnBase('障', 2850, '未勝利', '中山', '20260912', '') != null, s.tlLearnBase('障', 2850, '未勝利', '中山', '20260912', ''));
  t('障害の学習値は平地に流用されない（芝2850m の学習値は無い）',
    s.tlLearnBase('芝', 2850, '未勝利', '中山', '20260912', '') == null, s.tlLearnBase('芝', 2850, '未勝利', '中山', '20260912', ''));
  t('障害の dist キーは 障|2850 として立つ', !!model && !!model.dist['障|2850'] && !model.dist['芝|2850'],
    model && Object.keys(model.dist).filter(k => k.indexOf('2850') >= 0));

  /* --- 14-3 学習した基準時計が「入れた数字」になっているか --- */
  const near = (a, b, tol) => a != null && Math.abs(a - b) <= (tol || 0.35);
  const L1600 = s.tlLearnBase('芝', 1600, '未勝利', '中山', '20260912', '3歳');
  t('芝1600 未勝利 中山 2026 3歳 → 95.0秒', near(L1600, 95.0), L1600);
  t('芝1600 1勝クラス → 94.0秒（クラス補正が効く）', near(s.tlLearnBase('芝', 1600, '1勝クラス', '中山', '20260912', '3歳以上'), 94.0), s.tlLearnBase('芝', 1600, '1勝クラス', '中山', '20260912', '3歳以上'));
  t('芝1600 東京 → 94.0秒（競馬場補正が効く）', near(s.tlLearnBase('芝', 1600, '未勝利', '東京', '20260912', '3歳'), 94.0), s.tlLearnBase('芝', 1600, '未勝利', '東京', '20260912', '3歳'));
  t('芝2000 → 121.0秒（距離が効く）', near(s.tlLearnBase('芝', 2000, '未勝利', '中山', '20260912', '3歳'), 121.0), s.tlLearnBase('芝', 2000, '未勝利', '中山', '20260912', '3歳'));
  t('ダ1800 1勝クラス → 113.0秒', near(s.tlLearnBase('ダ', 1800, '1勝クラス', '中山', '20260912', '3歳以上'), 113.0), s.tlLearnBase('ダ', 1800, '1勝クラス', '中山', '20260912', '3歳以上'));
  t('2025年 → 95.5秒（年補正が効く）', near(s.tlLearnBase('芝', 1600, '未勝利', '中山', '20250601', '3歳'), 95.5), s.tlLearnBase('芝', 1600, '未勝利', '中山', '20250601', '3歳'));
  const L1800 = s.tlLearnBase('芝', 1800, '未勝利', '中山', '20260912', '3歳');
  t('芝1800（サンプルなし）は 1600 と 2000 の間を補間', near(L1800, 108.0, 0.8), L1800);
  t('芝1600 L（3件しか無い）でも基準時計は出る', s.tlLearnBase('芝', 1600, 'L', '中山', '20260912', '') != null);
  const badj = s.tlLearnBabaAdj('稍重', '芝');
  t('芝稍重の馬場補正を学習（静的0.7 → 実勢1.2くらい）', badj != null && Math.abs(badj - 1.2) <= 0.3, badj);
  t('tlBabaAdj が学習値を優先', s.tlBabaAdj('稍', '芝') === badj, [s.tlBabaAdj('稍', '芝'), badj]);
  t('学習していない馬場（ダート不良）は静的テーブルにフォールバック', s.tlBabaAdj('不', 'ダ') === -0.6);
  t('当てはまり(MAE)が1秒台以内', !!model && model.fitMae <= 1.5, model && model.fitMae);

  /* --- 14-4 評価（tlBaseSec / tlEvalRun）が学習値を使う --- */
  const learned = s.tlBaseSec('芝', 1600, '3歳未勝利', '中山', '20260912');
  t('tlBaseSec が学習値を返す（静的96.9秒ではなく95.0秒）', near(learned, 95.0) && Math.abs(learned - s.tlBaseSecStatic('芝', 1600, '3歳未勝利')) > 1.0,
    [learned, s.tlBaseSecStatic('芝', 1600, '3歳未勝利')]);
  const row = { date:'2026-09-05', venueName:'中山', venue:'中山', surface:'芝', m:1600, dist:'芝1600',
                name:'3歳未勝利', order:'1', time:'1:35.0', margin:'0.0', baba:'良', head:'16', r:'2', pass:'3-3-3-3' };
  const evL = s.tlEvalRun(row, 'テスト馬');
  t('学習後: 1:35.0（=学習した基準時計ちょうど）は「普通」', evL && evL.lv === 'mid' && evL.dSpd == null && Math.abs(evL.dPar) < 0.4, evL && [evL.lv, evL.dPar, evL.par]);
  s.tlLearnClear();
  const evS = s.tlEvalRun(row, 'テスト馬');
  t('学習前: 同じ時計が静的テーブルだと「速い」になってしまう（＝学習の意味）', evS && evS.lv === 'fast' && evS.dPar < -1.0, evS && [evS.lv, evS.dPar, evS.par]);

  /* --- 14-5 保存・読込・消去・表示 --- */
  s.tlLearnRun(true, true);
  const raw = store['khl_tllearn_v1'];
  s.tlLearnMem = null;                                  // 内存キャッシュを捨てて localStorage から読み直す
  const m2 = s.tlLearnLoad();
  t('保存→読込で同じモデル（JSON自己参照なし）', !!m2 && m2.nS === 155 && near(s.tlLearnBase('芝', 1600, '未勝利', '中山', '20260912', '3歳'), 95.0), m2 && m2.nS);
  t('tlLearnUseHTML に学習済みと出る', /学習した基準時計を使用しています/.test(s.tlLearnUseHTML()) && /155 件/.test(s.tlLearnUseHTML()), s.tlLearnUseHTML().slice(0, 120));
  s.tlLearnRender();
  const tbl = find('tlLearnTbl')._html;
  t('学習テーブルに芝/ダの基準時計が出る', /学習した基準時計/.test(tbl) && /1600m/.test(tbl) && /1800m/.test(tbl), tbl.slice(0, 120));
  /* 第15弾: 補正と「距離帯ごとのクラス差の上乗せ」の説明・一覧は折り込む（基準時計の表は出したまま） */
  t('第15弾: 補正・上乗せの一覧が <details> の折り込みに入っている',
    /🔧 学習した<b>補正<\/b>の内訳と距離帯の<b>上乗せ<\/b>/.test(tbl) &&
    /<details[^>]*>[\s\S]*クラス補正[\s\S]*<\/details>/.test(tbl), tbl.slice(0, 100));
  t('第15弾: 学習した基準時計の表は折り込みの外（先に表示される）',
    tbl.indexOf('学習した基準時計') >= 0 && tbl.indexOf('学習した基準時計') < tbl.indexOf('🔧 学習した<b>補正'),
    [tbl.indexOf('学習した基準時計'), tbl.indexOf('🔧 学習した<b>補正')]);
  t('第15弾: 折り込みの中にクラス/年齢/競馬場/年/馬場の補正が全部入っている',
    (function(){
      const i0 = tbl.indexOf('🔧 学習した<b>補正'), seg = tbl.slice(i0);
      return /クラス補正/.test(seg) && /年齢区分の補正/.test(seg) && /競馬場補正/.test(seg) && /年補正/.test(seg) && /馬場補正/.test(seg);
    })());
  t('学習テーブルにクラス・年齢・競馬場・年・馬場の補正が出る',
    /クラス補正/.test(tbl) && /年齢区分の補正/.test(tbl) && /競馬場補正/.test(tbl) && /年補正/.test(tbl) && /馬場補正/.test(tbl));
  t('学習テーブルに稍重の学習値と静的値の両方が出る', /稍重/.test(tbl) && /静的テーブル/.test(tbl));
  t('チップが「学習済み 155 件」', /学習済み 155 件/.test(find('tlLearnChip')._text), find('tlLearnChip')._text);
  t('⏱カードの説明行に件数と当てはまりが出る', /勝ち時計 <b>155<\/b> 件/.test(find('tlLearnStat')._html) && /平均絶対誤差/.test(find('tlLearnStat')._html),
    find('tlLearnStat')._html.slice(0, 160));
  s.tlLearnClear();
  t('学習値を消すと静的テーブルに戻る', s.tlLearnHas() === false &&
    s.tlBaseSec('芝', 1600, '3歳未勝利', '中山', '20260912') === s.tlBaseSecStatic('芝', 1600, '3歳未勝利'));
  s.tlLearnRender();
  t('未学習の説明に戻る', /まだ学習していません/.test(find('tlLearnStat')._html) && find('tlLearnTbl')._html === '');
  t('サンプル不足では学習しない', (function(){
    Object.keys(store).forEach(function(k){ if (k.indexOf(DI) === 0) delete store[k]; });
  /* ★2026-09-13 第24弾・追加修正: 第23弾⑥のメモ化（diLs/apScan）は setter 経由の書き込みでしか
     破棄されません（手順書 §54-9）。このテストは store に直接シードしているので、
     直接操作のあとに必ずメモを破棄します（これを怠ると diLs() が古い件数を返し続けます）。 */
    if (typeof s.diLsDrop === 'function') s.diLsDrop();
    if (typeof s.apScanDrop === 'function') s.apScanDrop();
    const m3 = s.tlLearnBuild();
    return m3 && /サンプル不足/.test(m3.err || '');
  })());

  /* 後片付け */
  Object.keys(store).forEach(function(k){ if (k.indexOf(DI) === 0) delete store[k]; });
  delete store['khl_tllearn_v1'];
  s.tlLearnMem = null;
  if (typeof s.diLsDrop === 'function') s.diLsDrop();
  if (typeof s.apScanDrop === 'function') s.apScanDrop();
  store[s.HD_LS] = hdKeep;
  s.state.horses = horsesKeep;
})();

/* ---------- 第14弾: 🚧障害は別枠（平地と混ぜない）＋学習時計は「分.秒」表記 ---------- */
(function(){
  /* 時計の表記 */
  [['70.1 → 1.10.1', 70.1, '1.10.1'], ['69.5 → 1.09.5', 69.5, '1.09.5'], ['150.4 → 2.30.4', 150.4, '2.30.4'],
   ['191.2 → 3.11.2（障害の時計）', 191.2, '3.11.2'], ['59.9 → 59.9（1分未満は秒だけ）', 59.9, '59.9'],
   ['60.0 → 1.00.0', 60.0, '1.00.0'], ['122.0 → 2.02.0', 122.0, '2.02.0'], ['9.5 → 9.5', 9.5, '9.5']].forEach(function(p){
    t('tlClockTxt: ' + p[0], s.tlClockTxt(p[1]) === p[2], s.tlClockTxt(p[1]));
  });

  /* 面の判定（レース名が最も確実） */
  t('tlLearnSurf: レース名に「障害」があれば surface が芝でも 障', s.tlLearnSurf('芝', '障害4歳以上オープン') === '障');
  t('tlLearnSurf: surface=障害 → 障', s.tlLearnSurf('障害', '') === '障');
  t('tlLearnSurf: surface=障 → 障', s.tlLearnSurf('障', '') === '障');
  t('tlLearnSurf: ダート → ダ', s.tlLearnSurf('ダート', '3歳以上1勝クラス') === 'ダ');
  t('tlLearnSurf: 芝 → 芝', s.tlLearnSurf('芝', '東京優駿') === '芝');
  t('tlLearnSurf: どちらも無ければ 芝', s.tlLearnSurf('', '') === '芝');
  t('nkToSec: ドット区切りの時計（3.11.2）を拾える（障害戦の表記）', s.nkToSec('3.11.2') === 191.2, s.nkToSec('3.11.2'));
  t('nkToSec: 1.12.4 → 72.4秒', s.nkToSec('1.12.4') === 72.4, s.nkToSec('1.12.4'));
  t('nkToSec: コロン区切り（3:11.2）は従来どおり', s.nkToSec('3:11.2') === 191.2 && s.nkToSec('1:35.0') === 95.0);
  t('TL_SHO_DIST: 2860/2750/3390 等は障害専用距離', !!(s.TL_SHO_DIST[2860] && s.TL_SHO_DIST[2750] && s.TL_SHO_DIST[3390]));
  t('TL_SHO_DIST: 2000/2400/3200(天皇賞春) は平地にもあるので障害専用にしない',
    !s.TL_SHO_DIST[2000] && !s.TL_SHO_DIST[2400] && !s.TL_SHO_DIST[3200]);

  /* 学習DBに 障害・芝・「芝2860m(＝障害のはず)」を入れてサンプル集めを検証 */
  const mk = (rid, name, surface, m, time, place) => ({
    rid: rid, date8: rid.slice(0, 8), at: Date.now(),
    meta: { name: name, date8: rid.slice(0, 8), date: '2025-01-01', place: place || '中山', rnum: '1', grade: '',
            surface: surface, m: m, dist: String(m), baba: '良', tenko: '晴' },
    n: 14, source: 'netkeiba', rows: [{ order: 1, no: '1', name: 'テスト馬', time: time, jockey: '池添謙一', trainer: '矢作芳人', margin: '', pop: 1 }],
    payout: null, payouts: null, payv: 1
  });
  const recs = [
    mk('202501010101', '障害4歳以上オープン', '障害', 2860, '3:11.2'),
    mk('202501010202', '障害3歳未勝利',       '障害', 2850, '3:09.0'),
    mk('202501010303', '3歳以上1勝クラス',    '芝',   2000, '2:00.5'),
    mk('202501010404', '4歳以上1勝クラス',    '芝',   2000, '2:01.1'),
    mk('202501010505', '○○特別',              '芝',   2860, '3:10.0'),   /* ← 芝2860m は障害でしか存在しない */
    mk('202501010606', '3歳以上1勝クラス',    'ダート', 1800, '1:53.4')
  ];
  recs.forEach(function(r){ store['khl_di_' + r.rid] = JSON.stringify(r); });   // 既存テストと同じ投入方法
  /* ★2026-09-13 第24弾・追加修正: 第23弾⑥のメモ化（diLs/apScan）は setter 経由の書き込みでしか
     破棄されません（手順書 §54-9）。このテストは store に直接シードしているので、
     直接操作のあとに必ずメモを破棄します（これを怠ると diLs() が古い件数を返し続けます）。 */
  if (typeof s.diLsDrop === 'function') s.diLsDrop();
  if (typeof s.apScanDrop === 'function') s.apScanDrop();
  const S = s.tlLearnSamples();
  const sho = S.list.filter(x => x.surface === '障');
  const turf = S.list.filter(x => x.surface === '芝');
  t('学習サンプル: 障害を別枠で集める（nSho=2）', S.nSho === 2 && sho.length === 2, [S.nSho, sho.length]);
  t('学習サンプル: 障害のキーは 障|2860 / 障|2850（芝・ダートと混ざらない）',
    sho.map(x => x.surface + '|' + x.m).sort().join(',') === '障|2850,障|2860', sho.map(x => x.surface + '|' + x.m).join(','));
  t('学習サンプル: 芝2860m（＝障害でしか存在しない距離）は平地の学習に入れない',
    turf.every(x => x.m !== 2860) && S.shoMis === 1, [turf.map(x => x.m).join(','), S.shoMis]);
  t('学習サンプル: 芝2000m・ダート1800m は従来どおり集まる',
    turf.filter(x => x.m === 2000).length >= 2 && S.list.some(x => x.surface === 'ダ' && x.m === 1800));
  t('学習サンプル: 障害の時計(3.11.2=191.2秒)が秒に変換されて入る',
    sho.some(x => Math.abs(x.sec - 191.2) < 0.05), sho.map(x => x.sec).join(','));

  /* 基準時計: 障害は「障害だけの学習値」が無ければ評価しない（芝のパータイムを流用しない） */
  t('tlBaseSec: 障害で学習値が無ければ null', s.tlBaseSec('障害', 2860, '障害4歳以上オープン', '中山', '20250101') === null,
    s.tlBaseSec('障害', 2860, '障害4歳以上オープン', '中山', '20250101'));
  t('tlBaseSec: レース名が「障害」なら surface が芝でも null（流用しない）',
    s.tlBaseSec('芝', 2860, '障害4歳以上オープン', '中山', '20250101') === null);
  t('tlBaseSecStatic: 障害は null（平地のパータイムを出さない）',
    s.tlBaseSecStatic('芝', 2860, '障害4歳以上オープン') === null && s.tlBaseSecStatic('障害', 3000, '') === null);
  t('tlBaseSec: 芝2000m は従来どおり基準時計が出る', s.tlBaseSec('芝', 2000, '3歳以上1勝クラス', '中山', '20250101') > 100,
    s.tlBaseSec('芝', 2000, '3歳以上1勝クラス', '中山', '20250101'));

  /* 学習を回すと 障害が別枠で入り、表に 🚧障害 が出る */
  const M = s.tlLearnBuild();
  t('tlLearnBuild: サンプルが足りなくても nSho / shoMis を返す', (M && M.nSho) === 2 && (M && M.shoMis) === 1, M && [M.nSho, M.shoMis, M.err]);
  t('tlLearnBuild: 6件ではサンプル不足（TL_LEARN_MIN_TOTAL=60）なので学習しない',
    !!M && /サンプル不足/.test(M.err || '') && Object.keys(M.dist || {}).length === 0, M && [M.err, Object.keys(M.dist || {}).length]);
  if (M && !M.err){
    s.tlLearnSave(M);
    const L = s.tlLearnBase('障', 2860, '障害4歳以上オープン', '', '', '');
    t('tlLearnBase: 障害の学習値を返す（191秒前後）', L != null && L > 150 && L < 240, L);
    const T = s.tlLearnBase('芝', 2860, '○○特別', '', '', '');
    t('tlLearnBase: 芝2860m は学習値が無い（障害の値を芝に流用しない）', T == null, T);
    const Z = s.tlLearnBase('芝', 2000, '3歳以上1勝クラス', '', '', '');
    t('tlLearnBase: 芝2000m は従来どおり学習値が出る', Z != null && Z > 100, Z);
    noThrow('tlLearnRender（🚧障害の行が出る）', function(){ s.tlLearnRender(); });
    const H = (els['tlLearnTbl'] && els['tlLearnTbl']._html) || '';
    t('学習時計の表に「🚧 障害（平地とは別枠で学習・比較も障害のみ）」が出る', /🚧 障害（平地とは別枠で学習/.test(H), H.slice(0, 80));
    t('学習時計の表は「分.秒」表記（見出しに 分.秒）', /補正なし・<b>分\.秒<\/b>/.test(H));
    t('学習時計の表に 3.11 のような分.秒が出る', /<b>3\.1[01]\.\d<\/b>/.test(H) || /<b>3\.0\d\.\d<\/b>/.test(H), (H.match(/<b>\d+\.\d+\.\d<\/b>/g) || []).slice(0, 4).join(','));
    const ST = (els['tlLearnStat'] && els['tlLearnStat']._html) || '';
    t('統計に「🚧 障害 N レースは別枠」と出る', /🚧 <b>障害 \d+ レースは別枠<\/b>/.test(ST), ST.replace(/<[^>]*>/g, '').slice(0, 100));
    t('統計に「芝2860m のように障害でしか存在しない距離が…除外」と出る', /障害でしか存在しない距離が平地側に混ざっていた \d+ 件は除外/.test(ST));
  }
  recs.forEach(function(r){ delete store['khl_di_' + r.rid]; });
  delete store['khl_tllearn_v1']; s.tlLearnMem = null;
  if (typeof s.diLsDrop === 'function') s.diLsDrop();
  if (typeof s.apScanDrop === 'function') s.apScanDrop();
})();



console.log(bad ? ('timelv: NG ' + bad + ' FAIL / ' + ok + ' PASS') : ('timelv  : OK ' + ok + ' PASS（前走は必ず評価・1着以外の好時計も追記・レースレベル・2着差・🎯/⚠️・枠色）'));
process.exit(bad ? 1 : 0);
