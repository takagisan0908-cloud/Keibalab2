/* 天気予報タブ（tenki.jp）の軽量テスト
   実行: node tests/tenki.test.js
   ・競馬場→郵便番号の表（ホームメイトの所在地）
   ・tenki.jp 1時間ごとページの解析（fixture）
   ・発走Rの印・要約・コメント生成
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
const els = {};
const g = {
  console, Math, JSON, Date, String, Number, Array, Object, Error, Promise, Boolean,
  parseInt, parseFloat, isNaN, isFinite, RegExp, encodeURIComponent, decodeURIComponent,
  setTimeout(){ return 0; }, clearTimeout(){}, setInterval(){ return 0; }, clearInterval(){},
  localStorage:{ _d:{}, getItem(k){ return this._d[k]==null?null:this._d[k]; }, setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; } },
  document:{ getElementById(id){ if(!els[id]) els[id]=makeEl(id); return els[id]; },
    querySelector(){ return null; }, querySelectorAll(){ return []; }, createElement(){ return makeEl(); },
    addEventListener(){}, body:makeEl('body') },
  addEventListener(){}, navigator:{ userAgent:'test' }
};
g.window = g; g.globalThis = g; g.self = g;
vm.createContext(g);
const code = ['p3_core','p5_engine','p46_tenki'].map(f => fs.readFileSync('src/' + f + '.js','utf8')).join('\n');
vm.runInContext(code, g, { filename:'tenki.js' });

// ---- 1) 競馬場 → 郵便番号 ----
const all = vm.runInContext('TK_TRACKS', g);
t('競馬場の郵便番号表が20件以上', all.length >= 20, all.length);
const jra = ['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉'];
jra.forEach(function(nm){
  const tr = vm.runInContext('tkTrackOf("' + nm + '")', g);
  t('JRA ' + nm + ' の郵便番号', tr && /^\d{3}-\d{4}$/.test(tr.pc), tr && tr.pc);
});
t('郵便番号の重複なし', new Set(all.map(x => x.pc)).size === all.length);
t('函館は駒場町の町域番号(042-0935)', vm.runInContext('tkTrackOf("函館")', g).pc === '042-0935');

// ---- 2) 1時間ごとページの解析 ----
const html = fs.readFileSync('tests/fixtures/tenki_1h.html','utf8');
g.__fixture = html;
const days = vm.runInContext('tkParse1h(__fixture)', g);
t('テーブルを2日分パース', days.length === 2, days.length);
const d0 = days[0];
t('日付が取れている(YYYYMMDD)', /^\d{8}$/.test(d0.d8), d0.d8);
t('時刻・天気・気温・降水確率・降水量・湿度・風が取れている',
  d0.rows.length >= 3 && d0.rows[0].hour != null && !!d0.rows[0].telop && d0.rows[0].temp != null &&
  d0.rows[0].pop != null && d0.rows[0].precip != null && d0.rows[0].hum != null && d0.rows[0].wspd != null,
  JSON.stringify(d0.rows[0] || {}));
t('風向が日本語で取れている(過去の時刻)', /[北南東西]/.test(String(d0.rows[0].wind || '')), d0.rows[0].wind);
t('風向が日本語で取れている(これからの時刻)', /[北南東西]/.test(String(d0.rows[1].wind || '')), d0.rows[1].wind);
t('今日/明日の区別', days[0].which === 'today' && days[1].which === 'tomorrow');
t('過去時刻のフラグ', typeof d0.rows[0].past === 'boolean');

// ---- 3) 表示用（要約・コメント・発走Rの印） ----
g.__day = d0;
const sum = vm.runInContext('tkSummary(__day.rows)', g);
t('要約: 最高/最低気温', sum.tmax >= sum.tmin, sum.tmax + '/' + sum.tmin);
t('要約: 降水確率の最大', sum.popMax != null);
t('要約: 降水量の合計', sum.rain >= 0);
g.__races = [{ r:9, time:('0' + d0.rows[0].hour).slice(-2) + ':50' }];
const tbl = vm.runInContext('tkTableHTML(__day, __races)', g);
t('表に時刻ヘッダが出る', tbl.indexOf('時刻') >= 0 && tbl.indexOf('時') > 0);
t('同じ時刻の発走レースに印(9R)', tbl.indexOf('9R') >= 0);
t('表に湿度・風速・降水量の行', tbl.indexOf('湿度(%)') >= 0 && tbl.indexOf('風速(m/s)') >= 0 && tbl.indexOf('降水量(mm/h)') >= 0);
const cm = vm.runInContext('tkComment(tkSummary(__day.rows), ["9R 14:50"])', g).join(' ').replace(/<[^>]*>/g,'');
t('コメントに発走時刻が入る', cm.indexOf('14:50') >= 0, cm.slice(0, 60));
t('天気の絵文字', vm.runInContext('tkWeatherEmoji("晴れ時々曇り")', g).indexOf('🌤') === 0, vm.runInContext('tkWeatherEmoji("晴れ時々曇り")', g));

console.log(bad ? ('tenki: NG ' + bad + ' FAIL / ' + ok + ' PASS') : ('tenki : OK ' + ok + ' PASS（競馬場の郵便番号・1時間ごと解析・表組み）'));
process.exit(bad ? 1 : 0);
