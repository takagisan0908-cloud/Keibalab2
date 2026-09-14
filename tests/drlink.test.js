/* ⑥重賞データ分析: 「カレンダーで選んだレース」と「📊過去10年分析」が連携することのテスト
   ・①でレースを読み込んでいなくても📊が動く（対象レースの解決順）
   ・📅カレンダーの分析結果が📊側にも写る（drMirror）
   ・📊のプルダウンに重賞日程が出る（drRenderPick）
   実行: node tests/drlink.test.js */
const fs = require('fs'), vm = require('vm');
let ok = 0, bad = 0;
function t(name, cond, extra){ if (cond){ ok++; } else { bad++; console.log('  FAIL', name, extra === undefined ? '' : extra); } }
function makeEl(id){
  const el = { id:id||'', value:'', _html:'', _text:'', style:{}, checked:false, open:false, disabled:false,
    classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, toggle(c,f){ if(f===undefined){this._s.has(c)?this._s.delete(c):this._s.add(c);} else if(f){this._s.add(c);} else {this._s.delete(c);} }, contains(c){ return this._s.has(c); } },
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
  document:{ getElementById(id){ if(!els[id]) els[id]=makeEl(id); return els[id]; }, querySelector(){ return null; }, querySelectorAll(){ return []; }, createElement(){ return makeEl(); }, addEventListener(){}, body:makeEl('body') },
  addEventListener(){}, navigator:{ userAgent:'test' },
  fetch(){ return Promise.reject(new Error('no network in test')); }
};
g.window = g; g.globalThis = g; g.self = g;
vm.createContext(g);
vm.runInContext(['p3_core','p31_bloodfactor','p36_datarace','p39_gradecal'].map(f => fs.readFileSync('src/' + f + '.js','utf8')).join('\n'), g, { filename:'dr.js' });

/* 通信を伴う関数は差し替えて「呼び出し方」だけを検証する */
const calls = { rid: [], rendered: [] };
g.drAnalyzeRid = function(rid, opt, prog){ calls.rid.push(rid); if (prog) prog('テスト'); return Promise.resolve(FAKE()); };
g.drRenderAll = function(res, box){ calls.rendered.push(box && box.id ? box.id : '(引数なし=drOut)'); return res; };
function FAKE(){
  return { name:'', rid:'202506050811',   // name は呼び出し側（対象レース名）が使われることを確認するため空にする samples:[], yearsUsed:10, racesUsed:[{year:2025,rid:'202506050811'}],
    excluded:[], errors:[], venueDiff:[], tables:{ all:{ n:160, w:10, t2:10, t3:10, oth:130, roiW:1000 }, base:19 },
    fetchHorseOk:160, fetchHorseTotal:160 };
}

(async function(){
  /* --- 1) 重賞日程があれば📊のプルダウンに出る --- */
  vm.runInContext(`
    var ls = gcLs();
    ls.sched = { '2026': [
      { date:'20261227', name:'有馬記念', venue:'中山', grade:'G1' },
      { date:'20261129', name:'ジャパンカップ', venue:'東京', grade:'G1' },
      { date:'20260913', name:'セントライト記念', venue:'中山', grade:'G2' }
    ] };
    gcSave(ls);
    drRenderPick();
  `, g);
  const pick = String(els['drPick']._html || '');
  t('drPick にプルダウンが出る', pick.indexOf('id="drSelRace"') > 0);
  t('drPick の選択肢に重賞名が並ぶ', pick.indexOf('有馬記念') > 0 && pick.indexOf('ジャパンカップ') > 0 && pick.indexOf('セントライト記念') > 0);
  t('drPick に月別のグループがある', pick.indexOf('optgroup label="12月"') > 0 && pick.indexOf('optgroup label="9月"') > 0);
  t('drPick に分析ボタンがある（data-dract=pick）', pick.indexOf('data-dract="pick"') > 0);

  /* --- 2) 対象レースの解決順: ① → 📅 → 直近 --- */
  vm.runInContext("state.raceId = ''; state.gradeSel = null; DR_LAST = null;", g);
  t('何も無ければ対象なし', vm.runInContext('drPickRid()', g) === null);
  vm.runInContext("state.gradeSel = { rid:'202606050811', name:'有馬記念' };", g);
  let p2 = vm.runInContext('drPickRid()', g);
  t('📅で選んだレースを対象にする', p2 && p2.rid === '202606050811' && p2.from === '📅カレンダー', JSON.stringify(p2));
  vm.runInContext("state.raceId = '202609050211';", g);
  let p3 = vm.runInContext('drPickRid()', g);
  t('①で読み込んだレースを優先する', p3 && p3.rid === '202609050211' && p3.from === '①データ入力', JSON.stringify(p3));
  t('対象名が出る', vm.runInContext('drTargetName()', g) === '有馬記念', vm.runInContext('drTargetName()', g));

  /* --- 3) ①を読み込んでいなくても drRun が📅の対象で分析する --- */
  vm.runInContext("state.raceId = ''; state.race = { name:'' }; state.gradeSel = { rid:'202606050811', name:'有馬記念' };", g);
  calls.rid.length = 0;
  vm.runInContext('drRun(false)', g);
  await new Promise(r => setTimeout(r, 30));
  t('drRun が📅の対象ridで分析を始める', calls.rid.join(',') === '202606050811', calls.rid.join(','));
  t('drRun 完了メッセージが出る', String(els['drMsg']._html || '').indexOf('✅ 完了') >= 0, String(els['drMsg']._text || ''));
  t('drOut に描画している', calls.rendered.indexOf('(引数なし=drOut)') >= 0, calls.rendered.join(','));

  /* --- 4) 対象が何も無いときは案内を出す（無反応にしない） --- */
  vm.runInContext("state.raceId = ''; state.gradeSel = null; DR_LAST = null;", g);
  vm.runInContext('drRun(false)', g);
  const m4 = String(els['drMsg']._html || '');
  t('対象なしは案内メッセージ', m4.indexOf('分析するレースがまだありません') > 0 && m4.indexOf('プルダウン') > 0, String(els['drMsg']._text || ''));

  /* --- 5) 📅カレンダーのクリック結果は📊カード(#drOut)1枚だけに出る（旧⑥分析結果カードは統合済み） --- */
  calls.rendered.length = 0;
  vm.runInContext("state.raceId = ''; state.gradeSel = null;", g);
  vm.runInContext('gcAnalyzeRid("202608030811", "菊花賞", "京都", "20261025")', g);
  await new Promise(r => setTimeout(r, 40));
  t('カレンダー経由でも drOut に描画される（表示先は1箇所）', calls.rendered.indexOf('(引数なし=drOut)') >= 0, calls.rendered.join(','));
  t('カレンダー経由の完了メッセージが📊側(drMsg)に出る', String(els['drMsg']._html || '').indexOf('✅ 完了') >= 0, String(els['drMsg']._text || ''));
  t('drStat に対象レース名', String(els['drStat']._html || '').indexOf('菊花賞') > 0, String(els['drStat']._html || ''));
  t('対象レースが📅のレースになる', (vm.runInContext('drPickRid()', g) || {}).rid === '202608030811', JSON.stringify(vm.runInContext('drPickRid()', g)));
  t('旧 gcOut には描画しない（二重表示しない）', calls.rendered.indexOf('gcOut') < 0, calls.rendered.join(','));
  t('drMirror は廃止（関数が無い）', vm.runInContext("typeof drMirror", g) === 'undefined');
  t('gcShowAnalyzed は廃止（関数が無い）', vm.runInContext("typeof gcShowAnalyzed", g) === 'undefined');
  t('HTML に旧⑥分析結果カードが無い', !/id="gcAnaCard"|id="gcOut"/.test(fs.readFileSync('src/p2_body.html','utf8')));
  t('HTML に統合先の id="drCard" がある', /id="drCard"/.test(fs.readFileSync('src/p2_body.html','utf8')));

  /* --- 6) プルダウンで選んだレース（日程にrace_idが無い）は gcResolveRid で解決する --- */
  let resolved = null;
  g.gcResolveRid = function(d8, name, prog){ resolved = { d8: d8, name: name }; return Promise.resolve('202606040811'); };
  els['drSelRace'] = els['drSelRace'] || makeEl('drSelRace');
  els['drSelRace'].value = '20261227|有馬記念|中山';
  calls.rid.length = 0;
  vm.runInContext('drRunPick()', g);
  await new Promise(r => setTimeout(r, 30));
  t('選択したレースの日付と名前を解決に渡す', resolved && resolved.d8 === '20261227' && resolved.name === '有馬記念', JSON.stringify(resolved));
  t('解決されたridで分析する', calls.rid.join(',') === '202606040811', calls.rid.join(','));
  t('選択が対象レースとして保存される', (vm.runInContext('drPickRid()', g) || {}).rid === '202606040811');

  /* --- 7) 未選択のまま「このレースを分析」を押したときの案内 --- */
  els['drSelRace'].value = '';
  vm.runInContext('drRunPick()', g);
  t('未選択は案内が出る', String(els['drMsg']._text || '').indexOf('プルダウンでレースを選んで') > 0, String(els['drMsg']._text || ''));

  console.log(bad ? ('drlink: NG ' + bad + ' FAIL / ' + ok + ' PASS') : ('drlink  : OK ' + ok + ' PASS（カレンダー⇄📊分析の連携・表示先1枚への統合・対象レースの解決順）'));
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('drlink: ERR', e && e.stack || e); process.exit(1); });
