/* 2026-09-10: 取得テキストの文字コード自動修復の回帰テスト
   実行: node tests/textrepair.test.js

   古い中継(リレー)を使っていると、EUC-JP のページ(db.netkeiba.com)が
   UTF-8 として返り、日本語が化けて 馬データ・出馬表以外の取得 が全滅する。
   nkRepairText() がそれを復元できることを実データ(fixture)で確認する。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let ok = 0, bad = 0;
const t = (n, c, x) => { if (c){ ok++; } else { bad++; console.log('FAIL', n, x === undefined ? '' : JSON.stringify(x)); } };

// p3_core.js から修復関数だけを取り出して評価（DOM不要）
const src = fs.readFileSync(path.join(ROOT, 'src/p3_core.js'), 'utf8');
const g = { console, TextDecoder, Uint8Array, String, Object };
vm.createContext(g);
const start = src.indexOf('function nkJPCount(');
const end = src.indexOf('/* 「あれば配線する」版');
t('p3_core.js に修復関数がある', start > 0 && end > start);
vm.runInContext(src.slice(start, end), g, { filename: 'repair.js' });

const orig = fs.readFileSync(path.join(ROOT, 'tests/fixtures/dbrace.utf8.html'), 'utf8');
const jp = s => g.nkJPCount(s);

t('原本は日本語を含む', jp(orig) > 1000, jp(orig));

/* ケース1: EUC-JP のバイト列を UTF-8(latin1) として読んでしまった化け（最も多い） */
const garbled1 = Buffer.from(orig, 'utf8').toString('latin1');
t('ケース1: 化けていると判定される', g.nkLooksGarbled(garbled1) === true);
const fixed1 = g.nkRepairText(garbled1);
t('ケース1: 復元して日本語が戻る', jp(fixed1) === jp(orig), jp(fixed1) + ' vs ' + jp(orig));
t('ケース1: 本文が一致する', fixed1 === orig);

/* ケース2: 正常なテキストは触らない */
t('ケース2: 正常テキストは変更しない', g.nkRepairText(orig) === orig);
t('ケース2: 正常テキストは化け判定されない', g.nkLooksGarbled(orig) === false);

/* ケース3: ASCIIだけのテキストも変更しない */
const ascii = '<html><body>' + 'a'.repeat(500) + '</body></html>';
t('ケース3: ASCIIのみは変更しない', g.nkRepairText(ascii) === ascii);

/* ケース4: 短いテキストは判定しない（誤検出防止） */
t('ケース4: 短いテキストは化け判定しない', g.nkLooksGarbled('ãããã') === false);

/* ケース5: db.netkeiba のレース結果ページが修復後に解析できる */
const raceHtml = fs.readFileSync(path.join(ROOT, 'tests/fixtures/dbrace_202509040211.utf8.html'), 'utf8');
const garbledRace = Buffer.from(raceHtml, 'utf8').toString('latin1');
t('ケース5: レース結果ページも復元できる', g.nkRepairText(garbledRace) === raceHtml);

console.log((bad ? 'NG' : 'OK') + ' ' + ok + ' PASS / ' + bad + ' FAIL');
process.exit(bad ? 1 : 0);
