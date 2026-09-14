/* レース名の略称照合（netkeiba の2文字略号）のテスト
   実測: 同じ「京成杯オータムハンデ」が netkeiba 内で4通りに表記される
     JRA重賞日程: 京成杯オータムハンデ / レース一覧: 京成杯AH / 結果ページ: 京成杯AH(G3) / DB: 京成杯オータムH
   これが全部「同じレース」と判定できること、そして別レースを混ぜないことを確認する。
   実行: node tests/abbrname.test.js */
const fs = require('fs'), vm = require('vm');
let ok = 0, bad = 0;
function t(name, cond, extra){ if (cond){ ok++; } else { bad++; console.log('  FAIL', name, extra === undefined ? '' : extra); } }
const g = {
  console, Math, JSON, Date, String, Number, Array, Object, Error, Promise, Boolean, Set, Map,
  parseInt, parseFloat, isNaN, isFinite, RegExp, encodeURIComponent, decodeURIComponent,
  setTimeout(){ return 0; }, clearTimeout(){}, setInterval(){ return 0; },
  localStorage:{ _d:{}, getItem(k){ return this._d[k]==null?null:this._d[k]; }, setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; } },
  document:{ getElementById(){ return null; }, querySelector(){ return null; }, querySelectorAll(){ return []; }, addEventListener(){} },
  addEventListener(){}, navigator:{ userAgent:'test' }
};
g.window = g; g.globalThis = g; g.self = g;
vm.createContext(g);
vm.runInContext(['p3_core','p18_racesearch','p31_bloodfactor','p36_datarace','p39_gradecal']
  .map(f => fs.readFileSync('src/' + f + '.js','utf8')).join('\n'), g, { filename:'abbr.js' });
const F = (fn, args) => vm.runInContext(fn + '(' + args.map(x => JSON.stringify(x)).join(',') + ')', g);

/* --- 1) 略号を展開できる（AH/JCC/SC/SD/CT/FS/JF/CS/GJ/HJ/JS/M） --- */
[
  ['京成杯AH', '京成杯オータムハンデ'],
  ['アメリカJCC', 'アメリカジョッキークラブカップ'],
  ['AJCC', 'アメリカジョッキークラブカップ'],
  ['京王杯SC', '京王杯スプリングカップ'],
  ['アイビスSD', 'アイビスサマーダッシュ'],
  ['ダービー卿CT', 'ダービー卿チャレンジトロフィー'],
  ['朝日杯FS', '朝日杯フューチュリティステークス'],
  ['阪神JF', '阪神ジュベナイルフィリーズ'],
  ['マイルCS', 'マイルチャンピオンシップ'],
  ['中山GJ', '中山グランドジャンプ'],
  ['京都HJ', '京都ハイジャンプ'],
  ['京都JS', '京都ジャンプステークス'],
  ['ヴィクトリアM', 'ヴィクトリアマイル']
].forEach(p => t('drExpandAbbr: ' + p[0], F('drExpandAbbr', [p[0]]) === p[1], F('drExpandAbbr', [p[0]])));

/* --- 2) 同じレースの別表記が「一致」する --- */
[
  ['京成杯AH', '京成杯オータムハンデ'],
  ['京成杯AH', '京成杯オータムH'],
  ['京成杯AH(G3)', '京成杯オータムハンデキャップ'],
  ['京成杯オータムH(GIII)', '京成杯オータムハンデ'],
  ['アメリカJCC(GII)', 'アメリカジョッキークラブカップ'],
  ['朝日杯FS(GI)', '朝日杯フューチュリティステークス'],
  ['阪神JF(GI)', '阪神ジュベナイルフィリーズ'],
  ['マイルCS(GI)', 'マイルチャンピオンシップ'],
  ['ヴィクトリアM(GI)', 'ヴィクトリアマイル'],
  ['京王杯SC(GII)', '京王杯スプリングカップ'],
  ['アイビスSD(GIII)', 'アイビスサマーダッシュ'],
  ['ダービー卿CT(GIII)', 'ダービー卿チャレンジトロフィー'],
  ['中山GJ(JG1)', '中山グランドジャンプ'],
  ['京都HJ(JG2)', '京都ハイジャンプ'],
  ['札幌2歳S(GIII)', '札幌2歳ステークス'],
  ['紫苑S(GII)', '紫苑ステークス'],
  ['ステイヤーズS(GII)', 'ステイヤーズステークス'],
  ['日刊スポ賞中山金杯(GIII)', '中山金杯'],
  ['第71回京成杯オータムH(GIII)', '京成杯オータムハンデ']
].forEach(p => t('drRaceEq(一致): ' + p.join(' ⇄ '), F('drRaceEq', p) === true));

/* --- 3) 別レースを混ぜない --- */
[
  ['ジャパンC', 'ジャパンカップダート'],
  ['京成杯AH', '中山金杯'],
  ['アイビスSD', '阪神スプリングジャンプ'],
  ['朝日杯FS', '阪神ジュベナイルフィリーズ'],
  ['サマーD', 'サマーJ'],
  ['ヴィクトリアM', 'ヴィクトリアカップ'],
  ['京都JS', '京都HJ']
].forEach(p => t('drRaceEq(別レース): ' + p.join(' ⇄ '), F('drRaceEq', p) === false));

/* --- 4) ⑥カレンダーの照合キー（gcNameCore）でも同じ結果になる --- */
[
  ['京成杯オータムハンデ', '京成杯AH'],
  ['京成杯オータムハンデ', '京成杯オータムH'],
  ['朝日杯フューチュリティステークス', '朝日杯FS'],
  ['アメリカジョッキークラブカップ', 'アメリカJCC'],
  ['ヴィクトリアマイル', 'ヴィクトリアM'],
  ['札幌2歳ステークス', '札幌2歳S']
].forEach(p => {
  const a = F('gcNameCore', [p[0]]), b = F('gcNameCore', [p[1]]);
  t('gcNameCore: ' + p.join(' ⇄ '), a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0, a + ' / ' + b);
});

/* --- 5) 日程表の正式名へ戻すキー（drNameSkeleton）が略号でも揃う --- */
[['京成杯AH', '京成杯オータムハンデ'], ['朝日杯FS', '朝日杯フューチュリティステークス'],
 ['アメリカJCC', 'アメリカジョッキークラブカップ'], ['ヴィクトリアM', 'ヴィクトリアマイル']]
  .forEach(p => t('drNameSkeleton: ' + p.join(' ⇄ '), F('drNameSkeleton', [p[0]]) === F('drNameSkeleton', [p[1]]),
    F('drNameSkeleton', [p[0]]) + ' / ' + F('drNameSkeleton', [p[1]])));

/* --- 6) DB検索のキーワードが「展開した正式名」から始まる（略号形は0件になるため） --- */
[
  ['京成杯AH', '京成杯オータムハンデ'],
  ['朝日杯FS', '朝日杯フューチュリティステークス'],
  ['ヴィクトリアM', 'ヴィクトリアマイル'],
  ['マイルCS', 'マイルチャンピオンシップ'],
  ['京成杯オータムハンデ', '京成杯オータムハンデ']
].forEach(p => {
  const w = F('drSearchWords', [p[0]]);
  t('drSearchWords(' + p[0] + ') の先頭が正式名', Array.isArray(w) && w[0] === p[1], JSON.stringify(w));
  t('drSearchWords(' + p[0] + ') にゴミ語(1文字残し)が無い', w.every(x => !/[A-Z]$/.test(x) || x.length > 4), JSON.stringify(w));
});

console.log('abbrname : ' + (bad ? 'NG ' : 'OK ') + ok + ' PASS' + (bad ? ' / ' + bad + ' FAIL' : '') +
  '（京成杯AH＝京成杯オータムハンデ などの2文字略号／gcNameCore／DB検索語）');
process.exit(bad ? 1 : 0);
