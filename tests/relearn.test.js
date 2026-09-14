const fs=require('fs'),vm=require('vm');
function mkLS(){const m={};return{get length(){return Object.keys(m).length;},key(i){return Object.keys(m)[i]||null;},getItem(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null;},setItem(k,v){m[k]=String(v);},removeItem(k){delete m[k];}};}
function makeEl(id){const el={id:id||'',value:'',_html:'',_text:'',style:{},dataset:{},disabled:false,classList:{_s:new Set(),add(c){this._s.add(c);},remove(c){this._s.delete(c);},contains(c){return this._s.has(c);}},setAttribute(){},getAttribute(){return null;},addEventListener(){},querySelector(){return makeEl();},querySelectorAll(){return[];}};Object.defineProperty(el,'innerHTML',{get(){return el._html;},set(v){el._html=v;el._text=String(v).replace(/<[^>]*>/g,'');}});return el;}
const els={},ls=mkLS();
const g={console,Math,JSON,Date,String,Number,parseInt,parseFloat,isNaN,RegExp,encodeURIComponent,decodeURIComponent,
  setTimeout(){return 0;},clearTimeout(){},setInterval(){return 0;},requestAnimationFrame(){return 0;},cancelAnimationFrame(){},
  localStorage:ls,addEventListener(){},devicePixelRatio:1,innerWidth:980,navigator:{},window:null,state:{apModel:'hyb'},
  document:{getElementById(id){if(!els[id])els[id]=makeEl(id);return els[id];}}};
g.window=g;
/* AI予想: 再学習ボタン + 回収率「1万円AI買い目」のスモークテスト
   実行: node tests/relearn.test.js
   ・保存済み過去レース(学習DB)を現在のモデルで再評価→年月バケット再構築
   ・回収率は各レース1万円を印(◎〜△)へAI信頼度で単勝配分した想定
   ・再実行しても二重計上しない(冪等) を検証 */
// 学習DB(日別取込で保存された想定)を diLs() として注入
const DB={races:{}};
(function(){ let seed=7; function rnd(){ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; }
  const months=['202511','202512','202601'];
  months.forEach((ym,mi)=>{ for(let k=1;k<=6;k++){
    const N=14, rows=[], order=[]; for(let i=1;i<=N;i++) order.push(i);
    for(let i=N-1;i>0;i--){const j=Math.floor(rnd()*(i+1));const t=order[i];order[i]=order[j];order[j]=t;}
    const styles=['逃げ','先行','差し','追込','先行','差し','追込','逃げ','差し','先行','差し','追込','先行','差し'];
    for(let no=1;no<=N;no++){ const odds=1.6+Math.pow(no-1,1.6)*1.1+rnd()*3;
      rows.push({order:order[no-1],no:no,name:'ウ'+no,odds:odds.toFixed(1),passing:no<=2?'1-1-1-1':(no<=5?'5-5-5-5':'9-9-9-9'),style:styles[no-1]}); }
    const rid=ym+'14'+('0'+(mi*6+k)).slice(-4)+('0'+k).slice(-1);
    DB.races[rid]={rid,date8:ym+'14',rows};
  }});
})();
g.diLs=function(){ return DB; };
g.diRenderStat=function(){};
vm.createContext(g);
let code='';for(const f of ['src/p3_core.js','src/p5_engine.js','src/p14_history.js','src/p30_learnrec.js'])code+=fs.readFileSync(f,'utf8')+'\n';vm.runInContext(code,g,{filename:'k.js'});
const prog=`(function(){
  var errs=[];
  function t(n,c,d){ if(!c) errs.push(n+(d?(' :: '+d):'')); }
  // 1) apBetPlan
  var mkmarks=[{no:'1',odds:2.5,order:2,pu:0.5,aiRank:1,oddsRank:1},{no:'2',odds:5,order:1,pu:0.25,aiRank:2,oddsRank:2},{no:'3',odds:10,order:7,pu:0.15,aiRank:3,oddsRank:3},{no:'4',odds:20,order:5,pu:0.07,aiRank:4,oddsRank:4},{no:'5',odds:40,order:9,pu:0.03,aiRank:5,oddsRank:5}];
  var plan=apBetPlan(mkmarks);
  t('betplan not null', !!plan);
  var stSum=0; mkmarks.forEach(function(m){ stSum+=plan.stakeOf(m.no); });
  t('stake sum=10000', stSum===10000, 'sum='+stSum);
  t('stakes multiple of 100', mkmarks.every(function(m){ return plan.stakeOf(m.no)%100===0; }));
  t('◎ largest stake', plan.stakeOf('1')>plan.stakeOf('2'), 's='+plan.stakeOf('1'));
  var ret=0; mkmarks.forEach(function(m){ if(m.order===1) ret+=plan.stakeOf(m.no)*m.odds; });
  t('return calc sane', ret>0 && ret<50000, 'ret='+ret);
  // 2) 再学習
  apRelearnAll();
  t('relearn busy=false', AP_RELEARN_BUSY===false);
  t('relearn ok=18', !!(AP_RELEARN_LAST&&AP_RELEARN_LAST.ok===18), JSON.stringify(AP_RELEARN_LAST));
  var yms=apYms();
  t('3 months', yms.indexOf('202511')>=0&&yms.indexOf('202512')>=0&&yms.indexOf('202601')>=0, yms.join(','));
  var ymsA=['202511','202512','202601'];
  ymsA.forEach(function(ym){
    var b=apMB(ym);
    t('n=6 '+ym, !!(b&&b.c.hit.n===6), b?b.c.hit.n:'no');
    t('roi costU=60000 '+ym, b&&b.c.roi.costU===60000, b?b.c.roi.costU:'no');
    ['hit','roi','hyb'].forEach(function(c){ var cb=b.c[c]; if(cb.costU>0){ var pct=cb.grossU/cb.costU*100; t('roiPct sane '+ym+'/'+c, pct>=0&&pct<1000, pct.toFixed(1)); } });
  });
  var S=apParamsFor('202601');
  t('params totalR=12', S.totalR===12, 'totalR='+S.totalR);
  // 冪等性
  var costBefore=apMB('202511').c.hit.costU;
  apRelearnAll();
  t('idempotent', apMB('202511').c.hit.costU===costBefore, apMB('202511').c.hit.costU+' vs '+costBefore);
  // 3) 旧保存レコードへの「全券種払戻」後付け反映(apPatchPayout: 一括取込の更新時に呼ばれる想定)
  var upRid=Object.keys(diLs().races).filter(function(k){ return k.indexOf('202511')===0; })[0];
  var rec0=apGet(upRid);
  t('patch target exists', !!rec0 && !!rec0.result, upRid);
  t('patch target lacks full pay', !rec0.result.payout || !('santan' in (rec0.result.payout||{})), JSON.stringify(rec0.result.payout));
  var fullPay={ win:{nos:['4'],pays:[1270]}, place:{nos:['4','2','9'],pays:[340,200,130]},
    wakuren:{nos:['2-4'],pays:[4510]}, umaren:{nos:['2-4'],pays:[3690]}, wide:{nos:['2-4','4-9','2-9'],pays:[1120,730,410]},
    umatan:{nos:['4→2'],pays:[7440]}, sanfuku:{nos:['2-4-9'],pays:[3720]}, santan:{nos:['4→2→9'],pays:[35360]} };
  var rawList=[{t:'tan',nos:[4],yen:1270},{t:'fuku',nos:[4],yen:340},{t:'santan',nos:[4,2,9],yen:35360}];
  var b0=[], c0b=0;
  ['hit','roi','hyb'].forEach(function(c){ b0.push(apMB('202511').c[c].costU); });
  t('patch changed=true', apPatchPayout(upRid, fullPay, rawList)===true);
  var rec1=apGet(upRid);
  t('payout replaced by full', !!rec1.result.payout && rec1.result.payout.win && rec1.result.payout.santan && rec1.result.payout.wide, JSON.stringify(rec1.result.payout));
  t('payouts raw saved', !!rec1.result.payouts && rec1.result.payouts.length===3, JSON.stringify(rec1.result.payouts));
  t('patch idempotent(2回目false)', apPatchPayout(upRid, fullPay, rawList)===false);
  var b1=[];
  ['hit','roi','hyb'].forEach(function(c){ b1.push(apMB('202511').c[c].costU); });
  t('bucket集計は不変(二重計上なし)', b0.join()===b1.join(), b0.join()+' vs '+b1.join());
  return errs;
})()`;
let errs=[];
try{ errs=vm.runInContext(prog,g); }catch(e){ console.log('RELEARN CHECK FAIL '+e.message); process.exit(1); }
if(errs.length){ console.log('RELEARN CHECK FAIL'); errs.forEach(function(e){console.log('  - '+e);}); process.exit(1); }
console.log('relearn+1man-buy : OK (betPlan配分・再学習18R再構築・年月バケット・ROI1万円ベース・冪等性)');
