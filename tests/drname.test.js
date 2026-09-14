/* ⑥重賞データ分析: 同名レースの照合（冠スポンサー・略称・地方Jpn）の軽量テスト
   実行: node tests/drname.test.js */
const fs = require('fs'), vm = require('vm');
let ok = 0, bad = 0;
function t(name, cond, extra){ if (cond){ ok++; } else { bad++; console.log('  FAIL', name, extra === undefined ? '' : extra); } }
const g = {
  console, Math, JSON, Date, String, Number, Array, Object, Error, Promise, Boolean,
  parseInt, parseFloat, isNaN, isFinite, RegExp, encodeURIComponent, decodeURIComponent,
  setTimeout(){ return 0; }, clearTimeout(){}, setInterval(){ return 0; },
  localStorage:{ _d:{}, getItem(k){ return this._d[k]==null?null:this._d[k]; }, setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; } },
  document:{ getElementById(){ return null; }, querySelector(){ return null; }, querySelectorAll(){ return []; }, addEventListener(){} },
  addEventListener(){}, navigator:{ userAgent:'test' }
};
g.window = g; g.globalThis = g; g.self = g;
vm.createContext(g);
const code = ['p3_core','p31_bloodfactor','p36_datarace'].map(f => fs.readFileSync('src/' + f + '.js','utf8')).join('\n');
vm.runInContext(code, g, { filename:'dr.js' });

const eq = (a, b) => vm.runInContext('drRaceEq(' + JSON.stringify(a) + ',' + JSON.stringify(b) + ')', g);
const cases = [
  // 冠スポンサー（開催カレンダーは素の名前・netkeibaは冠つき）
  ['日刊スポ賞中山金杯(GIII)','中山金杯',true],
  ['スポニチ賞京都金杯(GIII)','京都金杯',true],
  ['テレビ東京杯青葉賞(GII)','青葉賞',true],
  ['報知杯弥生賞ディープインパクト記念(GII)','弥生賞',true],
  ['第41回 日刊スポ賞中山金杯(GIII)','中山金杯',true],
  // 略称（カップ/C・ステークス/S・競走の有無）
  ['ジャパンC(GI)','ジャパンカップ',true],
  ['ステイヤーズS(GII)','ステイヤーズステークス',true],
  ['根岸S(GIII)','根岸ステークス',true],
  ['東京大賞典競走(GI)','東京大賞典',true],
  ['JBCクラシック競走(JpnI)','JBCクラシック',true],
  ['帝王賞競走(JpnI)','帝王賞',true],
  ['阪神牝馬ステークス','阪神牝馬特別',true],
  // netkeiba DB の強い省略形（2026-09-10 に年間重賞140レースを実測して追加）
  ['アメリカジョッキーC(GII)','アメリカジョッキークラブカップ',true],   // 〜クラブカップ → C
  ['阪神スプリングJ(GII)','阪神スプリングジャンプ',true],             // ジャンプ → J
  ['ダービー卿チャレンジ(GIII)','ダービー卿チャレンジトロフィー',true],   // トロフィー → T（末尾略号の有無）
  ['ニュージーランドT(GII)','ニュージーランドトロフィー',true],
  ['読売マイラーズC(GII)','マイラーズカップ',true],                  // 2文字冠(読売)＋C
  ['アイビスサマーD(GIII)','アイビスサマーダッシュ',true],            // ダッシュ → D
  ['京成杯オータムH(GIII)','京成杯オータムハンデ',true],              // ハンデ → H
  ['サウジアラビアRC(GIII)','サウジアラビアロイヤルカップ',true],       // ロイヤルカップ → RC
  ['アイルランドT(GII)','アイルランドトロフィー',true],
  ['マイルチャンピオンS(GI)','マイルチャンピオンシップ',true],
  ['阪神ジュベナイルF(GI)','阪神ジュベナイルフィリーズ',true],         // フィリーズ → F
  ['朝日フューチュリティ(GI)','朝日杯フューチュリティステークス',true],
  ['チャンピオンズC(GI)','チャンピオンズカップ',true],
  // 別レースを混ぜない
  ['ジャパンカップダート','ジャパンカップ',false],
  ['JCベストレース記念(3勝)','ジャパンカップ',false],
  ['中山金杯','京都金杯',false],
  ['京都新聞杯(GII)','新聞杯',false],
  ['2歳未勝利','3歳未勝利',false],
  ['阪神ジュベナイルフィリーズ(GI)','朝日杯フューチュリティステークス',false],
  ['アイビスサマーJ(GIII)','アイビスサマーダッシュ',false]      // 略号が違えば別レース扱い
];
cases.forEach(function(c){ t('drRaceEq: ' + c[0] + ' ⇄ ' + c[1] + ' = ' + c[2], eq(c[0], c[1]) === c[2]); });
t('名前が空なら不一致', eq('', '中山金杯') === false);
// 年まとめ用の素のレース名
t('drPrevRaceBase: 年まとめラベル',
  vm.runInContext('drPrevRaceBase("TV西日本北九州記念(GIII)")', g) === 'TV西日本北九州記念');
// 前走の上がり3F順位: 馬名の照合キー（空白・記号を落として比較）
t('drNameKey: 空白/中点/大文字小文字を無視',
  vm.runInContext('drNameKey("ハクサン ムーン")', g) === vm.runInContext('drNameKey("ハクサン・ムーン")', g) &&
  vm.runInContext('drNameKey("ビッグシーザー")', g) === vm.runInContext('drNameKey(" ビッグシーザー　")', g));
t('drNameKey: 別馬は別キー', vm.runInContext('drNameKey("ハクサンムーン")', g) !== vm.runInContext('drNameKey("ショウナンマイティ")', g));
// 地方(Jpn)の競馬場もDB検索の対象
t('地方場の regex に大井/船橋/佐賀が含まれる', /大井/.test(vm.runInContext('DR_VEN_NAMES', g)) && /船橋/.test(vm.runInContext('DR_VEN_NAMES', g)) && /佐賀/.test(vm.runInContext('DR_VEN_NAMES', g)));
// レースページ由来の名前は netkeiba の略称表記（マイルチャンピオンS など）。
// 半角略号のままだと DB検索が0件になるため、展開語と前方一致語を候補に入れる
[['マイルチャンピオンS(GI)','マイルチャンピオンシップ','マイルチャンピオン'],
 ['阪神C(GII)','阪神カップ','阪神'],
 ['アイビスサマーD(GIII)','アイビスサマーダッシュ','アイビスサマー']].forEach(function(c){
  const ws = vm.runInContext('drSearchWords(' + JSON.stringify(c[0]) + ')', g);
  t('drSearchWords: ' + c[0] + ' に展開語 ' + c[1], ws.indexOf(c[1]) >= 0, ws.join(','));
  t('drSearchWords: ' + c[0] + ' に前方一致語 ' + c[2], ws.indexOf(c[2]) >= 0, ws.join(','));
});
// レースページの見出しは netkeiba の短縮名のことがある（マイルCS 等）→ 正式名へ展開
[['マイルCS','マイルチャンピオンシップ'],['NHKマイルC','NHKマイルカップ'],['ジャパンC','ジャパンカップ'],['阪神JF','阪神ジュベナイルフィリーズ']].forEach(function(c){
  t('drExpandName: ' + c[0] + ' → ' + c[1],
    vm.runInContext('drExpandName(' + JSON.stringify(c[0]) + ')', g) === c[1]);
  t('drSearchWords: ' + c[0] + ' の先頭が展開後の正式名',
    vm.runInContext('drSearchWords(' + JSON.stringify(c[0]) + ')[0]', g) === c[1]);
});
// DB検索のキーワード: 正式名を先に、略称は最後（DB検索は半角略号だと0件になる）
['ジャパンカップ','日刊スポーツ賞中山金杯','JBCクラシック競走'].forEach(function(nm){
  const ws = vm.runInContext('drSearchWords(' + JSON.stringify(nm) + ')', g);
  t('drSearchWords: ' + nm + ' の先頭が正式名', ws[0] === nm.replace(/競走$/,''), ws[0]);
  t('drSearchWords: ' + nm + ' は略称を最後に回す', !/[A-Z]$/.test(ws[0]) || ws.length === 1, ws.join(','));
});
console.log(bad ? ('drname: NG ' + bad + ' FAIL / ' + ok + ' PASS') : ('drname : OK ' + ok + ' PASS（冠スポンサー・略称の照合／地方Jpn／馬名キー）'));
process.exit(bad ? 1 : 0);
