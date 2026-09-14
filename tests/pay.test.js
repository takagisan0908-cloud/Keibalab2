/* 払戻金(単勝以外含む全券種)パーサーのスモークテスト
   実行: node tests/pay.test.js
   p31_bloodfactor.js の bfParsePayback / bfPayoutMap を、
   netkeiba の実測HTML(結果ページの払戻セクション)フィクスチャと照合する。
   - tests/fixtures/pay_db.html  … db.netkeiba.com/race/ 形式(<tbody class="..">)
   - tests/fixtures/pay_race.html … race.netkeiba.com/race/result.html 形式(<tr class="..">)
   実測内容(2026年6月4日 東京11R想定): 単勝 4=1270 / 複勝 4=340・2=200・9=130 /
   枠連 2-4=4510 / 馬連 2-4=3690 / ワイド 2-4=1120・4-9=730・2-9=410 /
   馬単 4→2=7440 / 3連複 2-4-9=3720 / 3連単 4→2→9=35360 */
const fs = require('fs');
const vm = require('vm');
const g = { console, Math, JSON, String, Number, parseInt, parseFloat, isNaN, RegExp };
vm.createContext(g);
let code = fs.readFileSync('src/p31_bloodfactor.js', 'utf8');
vm.runInContext(code, g, { filename: 'p31.js' });

/* 生リスト: 券種別に的中1件ずつ { t, nos, yen } */
const RAW_EXPECTED = [
  { t: 'tan',    nos: [4],        yen: 1270 },
  { t: 'fuku',   nos: [4],        yen: 340 },
  { t: 'fuku',   nos: [2],        yen: 200 },
  { t: 'fuku',   nos: [9],        yen: 130 },
  { t: 'wakuren',nos: [2, 4],     yen: 4510 },
  { t: 'umaren', nos: [2, 4],     yen: 3690 },
  { t: 'wide',   nos: [2, 4],     yen: 1120 },
  { t: 'wide',   nos: [4, 9],     yen: 730 },
  { t: 'wide',   nos: [2, 9],     yen: 410 },
  { t: 'umatan', nos: [4, 2],     yen: 7440 },
  { t: 'sanfuku',nos: [2, 4, 9],  yen: 3720 },
  { t: 'santan', nos: [4, 2, 9],  yen: 35360 }
];
const NORM_EXPECTED = {
  win:     { nos: ['4'],         pays: [1270] },
  place:   { nos: ['4', '2', '9'], pays: [340, 200, 130] },
  wakuren: { nos: ['2-4'],       pays: [4510] },
  umaren:  { nos: ['2-4'],       pays: [3690] },
  wide:    { nos: ['2-4', '4-9', '2-9'], pays: [1120, 730, 410] },
  umatan:  { nos: ['4→2'],       pays: [7440] },
  sanfuku: { nos: ['2-4-9'],     pays: [3720] },
  santan:  { nos: ['4→2→9'],     pays: [35360] }
};

const errs = [];
function t(name, cond, detail){
  if (!cond) errs.push(name + (detail ? ' :: ' + JSON.stringify(detail) : ''));
}

for (const f of ['pay_db.html', 'pay_race.html']){
  const html = fs.readFileSync('tests/fixtures/' + f, 'utf8');
  const raw = vm.runInContext('bfParsePayback(' + JSON.stringify(html) + ')', g);
  t(f + ' raw 12件', raw && raw.length === 12, raw && raw.length);
  t(f + ' raw 内容一致', JSON.stringify(raw) === JSON.stringify(RAW_EXPECTED), raw);
  const norm = vm.runInContext('bfPayoutMap(' + JSON.stringify(raw) + ')', g);
  t(f + ' norm 内容一致', JSON.stringify(norm) === JSON.stringify(NORM_EXPECTED), norm);
  // 券種キーが8つ揃っている(払戻未確定の券種も null キーで存在する)
  const keys = vm.runInContext('Object.keys(bfPayoutMap(' + JSON.stringify(raw) + ')).sort().join()', g);
  t(f + ' norm キー8種', keys === 'place,sanfuku,santan,umaren,umatan,wakuren,wide,win', keys);
}

/* 異常入力: 払戻無しHTML → null / 全キーnullマップ */
t('no-payback html -> null', vm.runInContext('bfParsePayback("<html><body>no pay</body></html>")', g) === null);
const empty = vm.runInContext('bfPayoutMap(null)', g);
t('bfPayoutMap(null) はキー8種 null', empty && Object.keys(empty).length === 8 && !empty.win && !empty.santan, empty);
t('bfPayoutMap(空) も同様', JSON.stringify(vm.runInContext('bfPayoutMap([])', g)) === JSON.stringify(empty));

if (errs.length){
  console.log('pay.test FAIL (' + errs.length + ')');
  errs.forEach(e => console.log('  - ' + e));
  process.exit(1);
}
console.log('pay.test OK: 両形式(db/race) × 全券種(単勝〜3連単) × 正規化 を一致確認');
