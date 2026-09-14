/* 2026-09-13 第24弾 の「配布ビルド」スモークテスト
   実行: node tests/rework16smoke.test.js   (build.py 実行後に)

   rework16.test.js が「関数単位」の検証なのに対し、こちらは
   **実際に配布する index.html を起動して画面を描画した結果**を検証します。
   （関数が正しくても配線・要素ID・描画順が違えば画面には出ないため）

   確認すること:
     A) 起動（boot）が例外なく通り、defaultWeights に waku が入っている
     B) 重み設定に「🎯 枠順(重賞のみ)」スライダーが実際に描画される
     C) 重賞＋⑥データありのとき、AI表の枠色セルに ▲/▼ が出て、適用ノートが出る
     D) 持ちタイム列に距離(m)ラベルが出る
     E) 重賞以外に切り替えると「今回は不使用」ノートに変わる
     F) ② 出馬表一覧が1行の最小表示で描画される（長文ステータスが無い）
     G) ③ トラックバイアス説明が <details class="tbhelp"> で折り込まれ、4項目が残る
*/
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT='/home/user/keiba-lab';
function makeEl(id){const el={id:id||'',value:'',_h:'',_t:'',style:{},dataset:{},checked:true,disabled:false,open:false,
 classList:{_s:new Set(),add(c){this._s.add(c);},remove(c){this._s.delete(c);},contains(c){return this._s.has(c);},
 toggle(c,f){if(f===undefined){this._s.has(c)?this._s.delete(c):this._s.add(c);}else{f?this._s.add(c):this._s.delete(c);}}},
 _a:{},setAttribute(k,v){this._a[k]=String(v);},getAttribute(k){return this._a[k]==null?null:this._a[k];},
 addEventListener(){},appendChild(){},focus(){},closest(){return null;},scrollIntoView(){},remove(){},click(){},
 getBoundingClientRect(){return{width:940,height:400,top:0,left:0};},
 querySelector(){return makeEl();},querySelectorAll(){return[];}};
 Object.defineProperty(el,'innerHTML',{get(){return el._h||'';},set(v){el._h=v;}});
 Object.defineProperty(el,'textContent',{get(){return el._t||'';},set(v){el._t=String(v);}});return el;}
const store={},els={};
const g={console,Math,JSON,Date,String,Number,parseInt,parseFloat,isNaN,isFinite,RegExp,Array,Object,Boolean,Error,Promise,
 encodeURIComponent,decodeURIComponent,TextDecoder,
 setTimeout(f){try{f()}catch(e){}return 0;},clearTimeout(){},setInterval(){return 0;},clearInterval(){},
 requestAnimationFrame(){return 0;},cancelAnimationFrame(){},scrollTo(){},
 localStorage:{getItem(k){return store[k]==null?null:store[k];},setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];},get length(){return Object.keys(store).length;},key(i){return Object.keys(store)[i]||null;}},
 addEventListener(t,f){ (g.__lis[t]||(g.__lis[t]=[])).push(f); },removeEventListener(){},
 devicePixelRatio:1,innerWidth:980,innerHeight:800,__lis:{},
 matchMedia(){return{matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}};},
 getComputedStyle(){return{getPropertyValue(){return'';}};},
 location:{href:'http://localhost/',search:'',hash:'',reload(){}},history:{pushState(){},replaceState(){}},
 navigator:{userAgent:'node',clipboard:{writeText(){return Promise.resolve();}}},
 Blob:function(){},URL:{createObjectURL(){return'blob:x';},revokeObjectURL(){}},
 fetch(){return Promise.reject(new Error('no fetch'));},
 document:{getElementById(id){if(!els[id])els[id]=makeEl(id);return els[id];},addEventListener(){},removeEventListener(){},
 querySelector(){return null;},querySelectorAll(){return[];},createElement(){return makeEl('tmp');},
 head:{appendChild(){}},body:{appendChild(){},style:{}},documentElement:{style:{},scrollTop:0},title:'',hidden:false}};
g.__lis={};
g.window=g;g.globalThis=g;vm.createContext(g);
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const m=html.match(/<script>([\s\S]*)<\/script>/);
vm.runInContext(m[1],g,{filename:'index.js'});
const run=s=>vm.runInContext(s,g);
let ok=0,bad=0;const T=(n,c,x)=>{if(c)ok++;else{bad++;console.log('  ✗ '+n+(x!==undefined?'  → '+x:''));}};

console.log('[起動スモーク] index.html (第24弾ビルド)');
T('boot が例外なく通っている', run(`typeof analyzeRace`)==='function');
T('defaultWeights に waku', run(`defaultWeights().waku`)===3, run(`defaultWeights().waku`));

// --- 重賞16頭を立てて AI予想タブを描画 ---
g.__S=(function(){const a=[];for(let y=2016;y<=2025;y++){for(let f=1;f<=8;f++){for(let k=0;k<2;k++){
 let o = f===1?(k===0?1:3):(f===8?10+k:5+k);
 a.push({yr:y,rid:String(y)+'0101010'+f+k,o:o,no:String(f*2+k-1),frame:String(f),name:'馬'+f+'_'+k,id:'i'+f+k,raceN:16});}} }return a;})();
run(`globalThis.state = freshState();`);
run(`globalThis.state.horses = (function(){var a=[];for(var i=1;i<=16;i++){a.push({no:String(i),name:'ウマ'+i,frame:String(((i-1)%8)+1),odds:String((2+i*1.3).toFixed(1)),style:(i%4===0?'逃げ':(i%4===1?'先行':(i%4===2?'差し':'追込'))),time:'',last3f:'',slow:''});}return a;})();`);
run(`globalThis.state.raceId='202609040311';`);
run(`globalThis.state.race={name:'宝塚記念(G1)',place:'阪神・芝・良',baba:'良',dist:'2200',grade:'G1',time:''};`);
run(`globalThis.state.gradeSel={};`);
run(`globalThis.DR_LAST={rid:'202609040311',name:'宝塚記念(G1)',samples:globalThis.__S};`);
run(`globalThis.WAKU_MEMO={key:'',done:false,val:null};`);
['rName','rPlace','rBaba','rDist','rClass','rTime'].forEach((id,i)=>{
  run(`document.getElementById('${id}').value = ${JSON.stringify(['宝塚記念(G1)','阪神','良','2200','G1',''][i])};`);
});

run(`buildWeightSliders();`);
const wbox=String(run(`document.getElementById('weightSliders').innerHTML`));
T('重み設定に「🎯 枠順(重賞のみ)」スライダーが出る', /枠順/.test(wbox)&&/waku/.test(wbox));

run(`renderKentaiFull();`);
const tbl=String(run(`document.getElementById('aiTbl').innerHTML`));
const note=String(run(`document.getElementById('aiNote').innerHTML`));
T('AI表が描画されている（行がある）', /<tr/.test(tbl), tbl.slice(0,80));
T('枠色セルに有利▲マークが出る', /▲/.test(tbl));
T('枠色セルに不利▼マークが出る', /▼/.test(tbl));
T('適用ノートに「枠順ファクターを適用」', /枠順ファクターを適用/.test(note), note.slice(0,120));
T('適用ノートに過去10年の走数', /過去10年 \d+ 走/.test(note));
T('ホバー説明に枠別成績', /過去10年成績/.test(tbl));

// 持ちタイム列: 距離ラベル
run(`globalThis.state.horses[0].time='2:11.6'; globalThis.state.horses[0].prevD='2200';`);
run(`renderKentaiFull();`);
const tbl2=String(run(`document.getElementById('aiTbl').innerHTML`));
T('持ちタイム列に距離(m)ラベルが出る', /\(\d{3,4}m/.test(tbl2)||/m・前走/.test(tbl2));

// 重賞以外 → 不使用ノート
run(`document.getElementById('rClass').value=''; globalThis.state.race.grade=''; globalThis.state.race.name='3歳未勝利';`);
run(`globalThis.DR_LAST={rid:'202609040311',name:'3歳未勝利',samples:globalThis.__S};`);
run(`globalThis.WAKU_MEMO={key:'',done:false,val:null};`);
run(`renderKentaiFull();`);
const note2=String(run(`document.getElementById('aiNote').innerHTML`));
T('重賞以外は「今回は不使用」と明示', /今回は不使用/.test(note2), note2.slice(0,120));

// --- ② 一覧の最小表示 ---
run(`preNoteFetched('202609040311','20260913',{place:'阪神',rnum:'11',name:'チャレンジC',n:16,pre:true,odds:3});`);
run(`preListRender();`);
const pl=String(run(`document.getElementById('preList').innerHTML`));
T('一覧が1行マークアップ（muted meta）', /class="muted meta"/.test(pl), pl.slice(0,140));
T('長文ステータスが消えている', !/端末に出馬表あり（通信せず開けます）/.test(pl));
T('race_id は本文に無く title だけ', !/>202609040311</.test(pl)&&/race_id: 202609040311/.test(pl));
T('削除ボタンが ✕', />✕</.test(pl));

// --- ③ 折り込み ---
T('index.html に details.tbhelp', /<details class="tbhelp">/.test(html));
T('説明4項目が残っている', /「前日」の決めかた/.test(html)&&/測りかたは当日判定と同じ物差し/.test(html)&&/そのまま100%は使いません/.test(html)&&/手動指定が最優先/.test(html));

/* =========================================================
   H) 第23弾⑥のメモ化による退行の修正（他タブ書き込みの検知）
   ---------------------------------------------------------
   第23弾⑥で diLs() / apScan() をメモ化しましたが、破棄は setter 経由の書き込みでしか行われません。
   そのため【別のタブ】で④の取込やバックアップ復元をすると、こちらのタブのメモが古いまま残り、
   diLs() が 0 件を返し続けて ⏱タイム換算学習などが「データが無い」ように振る舞います。
   （実測: timelv.test.js が 36件失敗／_24=第22弾ビルドでは 255件成功していた＝第23弾での退行）
   → ブラウザ標準の storage イベントでメモを破棄するようにしました。その配線を検証します。
   ========================================================= */
console.log('\n[H] 第23弾⑥メモ化の退行修正（他タブ書き込みの検知）');
const stLis = (g.__lis && g.__lis['storage']) || [];
T('window に storage リスナーが登録されている', stLis.length > 0, stLis.length);

// 学習DBを空にした状態でメモを温め、store を直接書き換える（＝他タブからの書き込みを模す）
run(`Object.keys(localStorage._m||{}).forEach(function(){});`);
run('diLsDrop();');
run('diLs();');                                     // ここで diLsMem が「0件」で確定
T('空の状態でメモが温まる（diLs()=0件）', run(`Object.keys(diLs().races||{}).length`) === 0);

// 他タブが学習DBを書いた状況を store 直接書込で作り、storage イベントを発火する
g.__rec = { rid:'202609040311', date8:'20260904', at:Date.now(),
  meta:{ name:'宝塚記念(G1)', date8:'20260904', place:'阪神', rnum:'11', grade:'G1',
         surface:'芝', m:2200, dist:'芝2200m', baba:'良', tenko:'晴' },
  n:16, source:'netkeiba', rows:[{order:1,no:'1',name:'テスト馬',time:'2:11.6',margin:'0.0'}] };
run(`localStorage.setItem('khl_di_202609040311', JSON.stringify(globalThis.__rec));`);
T('storage発火前はメモが古く diLs()=0件のまま', run(`Object.keys(diLs().races||{}).length`) === 0);

stLis.forEach(fn => { try { fn({ key: 'khl_di_202609040311' }); } catch(e){} });
T('storage イベント後にメモが破棄され diLs() が実データを返す',
  run(`Object.keys(diLs().races||{}).length`) === 1, run(`Object.keys(diLs().races||{}).length`));

// 無関係なキーでは破棄しない（第23弾⑥の高速化を無駄にしない）
run('diLs();');
const before = run(`diLs()`);
stLis.forEach(fn => { try { fn({ key: 'khl_kenkou_v1' }); } catch(e){} });
T('無関係なキーの storage ではメモを捨てない（高速化を維持）', run(`diLs()`) === before);

// key=null（clear() や容量超過での一括削除）では必ず破棄する
/* 2件目は rid を変えて入れる（diLsAll() は rec.rid で集約するため、
   同じ rid だとキーが2つあっても1件にまとまってしまい件数の検証にならない） */
run(`globalThis.__rec2 = JSON.parse(JSON.stringify(globalThis.__rec)); globalThis.__rec2.rid = '202609040312';`);
run(`localStorage.setItem('khl_di_202609040312', JSON.stringify(globalThis.__rec2));`);
run('diLs();');
stLis.forEach(fn => { try { fn({ key: null }); } catch(e){} });
T('key=null（clear/一括削除）でも破棄される', run(`Object.keys(diLs().races||{}).length`) === 2,
  run(`Object.keys(diLs().races||{}).length`));

console.log('\n================ 結果 ================');
console.log('  PASS: '+ok+' / FAIL: '+bad);
console.log(bad?'  ❌ スモーク FAILED':'  ✅ 配布ビルドのスモーク ALL PASS');
process.exit(bad?1:0);
