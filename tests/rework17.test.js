/* ★2026-09-13 第25弾②: 🏇 騎手・調教師DB（keibalab.jp）パーサのテスト
   実物構造から作成したフィクスチャ（tests/fixtures/keibalab_*.html）に対して検証します。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let PASS = 0, FAIL = 0; const fails = [];
function T(label, ok, extra){ if (ok) PASS++; else { FAIL++; fails.push(label + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); } }
function eq(label, a, b){ T(label + ' (= ' + JSON.stringify(b) + ')', JSON.stringify(a) === JSON.stringify(b), a); }

/* ---- 環境（localStorage のみ。パーサは正規表現ベースなので DOM 不要） ---- */
const store = {};
const sandbox = {
  console, Promise, Date, Math, JSON, parseInt, parseFloat, isNaN, isFinite, String, Number, Object, Array, RegExp, Error,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    get length(){ return Object.keys(store).length; },
    key: i => Object.keys(store)[i]
  }
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
function run(code){ return vm.runInContext(code, sandbox, { timeout: 15000 }); }
run(fs.readFileSync(path.join(__dirname, '../src/p63_jockeydb.js'), 'utf8'));

/* ★2026-09-13 第26弾・重要対策: フィクスチャHTMLを【このテストファイル内に埋め込み】ました。
   tests/fixtures/keibalab_*.html が繰り返し消失し（3回）、そのたびに rework17.test.js が
   ENOENT で落ちました。外部ファイル依存をやめれば二度と壊れません。
   実在すればそちらを優先して読むので、実物HTMLを保存してもらえれば差し替えも可能です。 */
const EMBED = {
  'keibalab_leading_jockey.html': String.raw`<!DOCTYPE html><html><body><div id="mainBlock">
<table><thead><tr><th>順位</th><th>騎手名</th><th>所属</th><th>1着</th><th>2着</th><th>3着</th><th>着外</th><th>騎乗回数</th><th>勝率(%)</th><th>連対率(%)</th><th>複勝率(%)</th><th>賞金(万円)</th></tr></thead><tbody>
<tr><td><img src="ico_rank_01.png"></td><td><a href="https://www.keibalab.jp/db/jockey/05339/">Ｃ．ルメール</a></td><td>[栗]フリー</td><td><a href="/db/jockey/05339/history.html?year=2026&ar=1#2026">101</a></td><td><a href="/db/jockey/05339/history.html?year=2026&ar=2#2026">62</a></td><td><a href="/db/jockey/05339/history.html?year=2026&ar=3#2026">49</a></td><td><a href="/db/jockey/05339/history.html?year=2026&ar=4#2026">148</a></td><td><a href="/db/jockey/05339/history.html?year=2026#2026">360</a></td><td>28.1</td><td>45.3</td><td>58.9</td><td>249,897.6</td></tr>
<tr><td>4</td><td><a href="https://www.keibalab.jp/db/jockey/01170/">横山武史</a></td><td>[美] <a href="https://www.keibalab.jp/db/trainer/01026/">鈴木伸</a></td><td>80</td><td>70</td><td>56</td><td>344</td><td>550</td><td>14.5</td><td>27.3</td><td>37.5</td><td>141,133.4</td></tr>
<tr><td>30</td><td><a href="https://www.keibalab.jp/db/jockey/01208/">田口貫太</a></td><td>[栗] <a href="https://www.keibalab.jp/db/trainer/01065/">大橋勇</a></td><td>29</td><td>28</td><td>44</td><td>390</td><td>491</td><td>5.9</td><td>11.6</td><td>20.6</td><td>61,629.5</td></tr>
</tbody></table>
<ul class="pager"><li><em>1</em></li><li><a href="https://www.keibalab.jp/db/leading.html?page=2&kind=jockey">2</a></li><li><a href="https://www.keibalab.jp/db/leading.html?page=2&kind=jockey">NEXT »</a></li></ul>
</div></body></html>`,
  'keibalab_jockey_01126.html': String.raw`<!DOCTYPE html><html><body><div id="mainBlock">
<ul class="topicpath"><li>騎手:松山 弘平</li></ul>
<h1 class="db_head">松山 弘平 <span>(まつやま こうへい)</span></h1>
<h2>基本情報</h2>
<table class="db_table basic"><tbody>
<tr><th>生年月日</th><td>1990年3月1日(36歳)</td></tr>
<tr><th>初免許年</th><td>2009年</td></tr>
<tr><th>所属</th><td>栗東</td></tr>
<tr><th>所属厩舎</th><td>フリー</td></tr>
<tr><th>平地初騎乗</th><td>2009年3月1日1回<br>小倉8日目<br>1R<br>トミケンプライマリ(1着/16頭)</td></tr>
<tr><th>平地初勝利</th><td>2009年3月1日1回<br>小倉8日目<br>1R<br>トミケンプライマリ(1着/16頭)</td></tr>
<tr><th>障害初騎乗</th><td>なし</td></tr>
<tr><th>障害初勝利</th><td>なし</td></tr>
</tbody></table>
<h5>イチ推しアビリティ</h5>
<ul class="ability"><li>阪神ダ1400m</li><li>中京ダ1200m</li><li>中京芝1600m</li><li>芝重・不良◎</li><li>少頭数◎</li><li>序盤戦(1～3R)◎</li></ul>
<h2>松山弘平 騎手成績<a href="https://www.keibalab.jp/db/jockey/01126/history.html">過去の騎乗成績</a></h2>
<table class="db_table rec"><thead><tr><th>本年成績</th><th>1着</th><th>2着</th><th>3着</th><th>着外</th><th>騎乗回数</th><th>勝率</th><th>連対率</th><th>3着内率</th></tr></thead><tbody>
<tr><th>平地</th><td>93</td><td>70</td><td>66</td><td>349</td><td>578</td><td>16.1</td><td>28.2</td><td>39.6</td></tr>
<tr><th>障害</th><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>-</td><td>-</td><td>-</td></tr>
<tr><th>全レース</th><td>93</td><td>70</td><td>66</td><td>349</td><td>578</td><td>16.1</td><td>28.2</td><td>39.6</td></tr>
</tbody></table>
<table class="db_table rec"><thead><tr><th>累計成績</th><th>1着</th><th>2着</th><th>3着</th><th>着外</th><th>騎乗回数</th><th>勝率</th><th>連対率</th><th>3着内率</th></tr></thead><tbody>
<tr><th>平地</th><td>1,459</td><td>1,320</td><td>1,170</td><td>10,286</td><td>14,235</td><td>10.2</td><td>19.5</td><td>27.7</td></tr>
<tr><th>障害</th><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>-</td><td>-</td><td>-</td></tr>
<tr><th>全レース</th><td>1,459</td><td>1,320</td><td>1,170</td><td>10,286</td><td>14,235</td><td>10.2</td><td>19.5</td><td>27.7</td></tr>
</tbody></table>
<h2>松山弘平 今週の騎乗馬</h2>
<p class="weekhead">2026年9月12日 4回阪神3日目 8戦4勝</p>
<table class="db_table week"><thead><tr><th>場</th><th>R</th><th>レース名</th><th>コース</th><th>人</th><th>着</th><th>馬名</th><th>枠</th><th>馬</th><th>性齢</th><th>斤量</th><th>厩舎</th><th>コンビ</th><th>間隔</th><th>前走</th><th>前人</th><th>前着</th></tr></thead><tbody>
<tr><td>阪神</td><td>11</td><td><a href="https://www.keibalab.jp/db/race/202609120911/">チャレンジＣ</a></td><td>芝2000</td><td>3</td><td>1</td><td><a href="https://www.keibalab.jp/db/horse/2022103995/">ジョバンニ</a></td><td>8</td><td>15</td><td>牡4</td><td>58.0</td><td><a href="https://www.keibalab.jp/db/trainer/01157/">[栗]杉山晴</a></td><td>11戦2勝</td><td>中7週</td><td><a href="https://www.keibalab.jp/db/race/202607191011/">小倉記</a></td><td>1</td><td>2</td></tr>
</tbody></table>
<p class="weekhead">2026年9月13日 4回中山4日目 6戦1勝</p>
<table class="db_table week"><tbody>
<tr><td>中山</td><td>4</td><td><a href="https://www.keibalab.jp/db/race/202609130604/">3歳未勝利</a></td><td>芝1600</td><td>1</td><td>1</td><td><a href="https://www.keibalab.jp/db/horse/2023106620/">ショウナンバーボン</a></td><td>3</td><td>6</td><td>牡3</td><td>57.0</td><td><a href="/db/trainer/01169/">[美]加藤士</a></td><td>0戦0勝</td><td>中3週</td><td><a href="/db/race/202608150106/">未勝利</a></td><td>1</td><td>4</td></tr>
</tbody></table>
</div></body></html>`
};
function FX(name){
  const f = path.join(__dirname, 'fixtures', name);
  try { if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8'); } catch(e){}
  if (EMBED[name] != null) return EMBED[name];
  throw new Error('fixture missing: ' + name);
}
const leadHtml = FX('keibalab_leading_jockey.html');
const detHtml = FX('keibalab_jockey_01126.html');

console.log('\n[A] URL生成');
eq('騎手一覧URL', run(`klListUrl('jockey', 1)`), 'https://www.keibalab.jp/db/leading.html?kind=jockey');
eq('騎手一覧URL(page2)', run(`klListUrl('jockey', 2)`), 'https://www.keibalab.jp/db/leading.html?kind=jockey&page=2');
eq('調教師一覧URL', run(`klListUrl('trainer', 3)`), 'https://www.keibalab.jp/db/leading.html?kind=trainer&page=3');
eq('騎手詳細URL（IDは5桁ゼロ埋め）', run(`klDetailUrl('jockey', '1126')`), 'https://www.keibalab.jp/db/jockey/01126/');
eq('調教師詳細URL', run(`klDetailUrl('trainer', '75')`), 'https://www.keibalab.jp/db/trainer/00075/');
eq('年度別履歴URL', run(`klHistoryUrl('jockey','01126',2026)`), 'https://www.keibalab.jp/db/jockey/01126/history.html?year=2026');
eq('年度別×着順別URL(ar=1)', run(`klHistoryUrl('jockey','01126',2026,1)`), 'https://www.keibalab.jp/db/jockey/01126/history.html?year=2026&ar=1');
eq('着順のみURL(ar=3)', run(`klHistoryUrl('jockey','01126',null,3)`), 'https://www.keibalab.jp/db/jockey/01126/history.html?ar=3');
eq('kind未知値は jockey に丸める', run(`klKind('xxx')`), 'jockey');
eq('klValidId(5桁)', run(`klValidId('01126')`), true);
eq('4桁IDは5桁にゼロ埋めされるので有効（寛容な扱い）', run(`klValidId('1126')`), true);
eq('klId がゼロ埋めする', run(`klId('1126')`), '01126');
eq('数字以外は不正', run(`klValidId('abc')`), false);

console.log('\n[B] klNum（カンマ・マイナス記号の扱い）');
eq('カンマ区切りを数値化', run(`klNum('249,897.6')`), 249897.6);
eq('1,459', run(`klNum('1,459')`), 1459);
eq('「-」は null（障害0戦など）', run(`klNum('-')`), null);
eq('「--」も null', run(`klNum('--')`), null);
eq('空文字は null', run(`klNum('')`), null);
eq('null は null', run(`klNum(null)`), null);
eq('通常数値', run(`klNum('28.1')`), 28.1);

console.log('\n[C] リーディング一覧のパース（名前→ID 解決）');
const lead = run(`klParseLeading(${JSON.stringify(leadHtml)}, 'jockey')`);
eq('3件拾える', lead.rows.length, 3);
eq('1件目: Ｃ．ルメール', lead.rows[0].name, 'Ｃ．ルメール');
eq('1件目: ID=05339', lead.rows[0].id, '05339');
eq('1件目: 1着=101', lead.rows[0].w1, 101);
eq('1件目: 2着=62', lead.rows[0].w2, 62);
eq('1件目: 3着=49', lead.rows[0].w3, 49);
eq('1件目: 着外=148', lead.rows[0].out, 148);
eq('1件目: 騎乗回数=360', lead.rows[0].rides, 360);
eq('1件目: 勝率=28.1', lead.rows[0].winRate, 28.1);
eq('1件目: 連対率=45.3', lead.rows[0].placeRate, 45.3);
eq('1件目: 複勝率=58.9', lead.rows[0].showRate, 58.9);
eq('1件目: 賞金=249897.6', lead.rows[0].money, 249897.6);
eq('2件目: 横山武史=01170', [lead.rows[1].name, lead.rows[1].id], ['横山武史', '01170']);
T('2件目: 所属に調教師名が残る', /美/.test(lead.rows[1].branch) && /鈴木伸/.test(lead.rows[1].branch), lead.rows[1].branch);
eq('3件目: 田口貫太=01208', [lead.rows[2].name, lead.rows[2].id], ['田口貫太', '01208']);
T('順位が取れる（4位・30位）', lead.rows[1].rank === 4 && lead.rows[2].rank === 30, lead.rows.map(r => r.rank));
T('1位は画像なので順位が null', lead.rows[0].rank === null, lead.rows[0].rank);
T('調教師IDも同時に収穫できる', lead.trainers.some(t => t.id === '01026' && /鈴木伸/.test(t.name)), lead.trainers);
T('次のページありを検出', lead.hasNext === true);
eq('空HTMLはエラー', run(`klParseLeading('', 'jockey').err`), 'empty');

console.log('\n[D] 名前→ID 登録簿（表記ゆれ吸収）');
run(`klRegDrop(); klEntDrop();`);
lead.rows.forEach(r => run(`klRegPut('jockey', ${JSON.stringify(r.name)}, '${r.id}', { winRate: ${r.winRate} })`));
eq('登録簿に3件', run(`klRegCount('jockey')`), 3);
eq('完全一致で引ける', run(`klFindId('松山弘平','jockey')`), null);   // ← この一覧には居ない
eq('Ｃ．ルメールを引ける', run(`klFindId('Ｃ．ルメール','jockey')`), '05339');
eq('半角 C.ルメール でも引ける（全角/半角吸収）', run(`klFindId('C.ルメール','jockey')`), '05339');
eq('中黒なしでも引ける', run(`klFindId('Ｃルメール','jockey')`), '05339');
eq('横山武史を引ける', run(`klFindId('横山武史','jockey')`), '01170');
eq('未知の騎手は null', run(`klFindId('存在しない騎手','jockey')`), null);
T('騎手と調教師の登録簿は分離（ID衝突対策）', run(`klRegCount('trainer')`) === 0 && run(`klRegCount('jockey')`) === 3);
run(`klRegPut('trainer','矢作芳','01075');`);
run(`klRegPut('jockey','田辺裕信','01075');`);
eq('★同じ01075でもkind別に引ける(調教師)', run(`klFindId('矢作芳','trainer')`), '01075');
eq('★同じ01075でもkind別に引ける(騎手)', run(`klFindId('田辺裕信','jockey')`), '01075');
eq('kindを跨いで混ざらない', run(`klFindId('矢作芳','jockey')`), null);

console.log('\n[E] 騎手詳細ページのパース');
const det = run(`klParseDetail(${JSON.stringify(detHtml)}, 'jockey', '01126')`);
eq('名前', det.name, '松山 弘平');
eq('読み', det.yomi, 'まつやま こうへい');
eq('ID（5桁正規化）', det.id, '01126');
eq('エラーなし', det.err, '');
eq('生年月日', det.basic['生年月日'], '1990年3月1日(36歳)');
eq('初免許年', det.basic['初免許年'], '2009年');
eq('所属', det.basic['所属'], '栗東');
eq('所属厩舎', det.basic['所属厩舎'], 'フリー');
eq('障害初騎乗=なし', det.basic['障害初騎乗'], 'なし');
T('平地初騎乗の <br> が空白になる', /2009年3月1日1回 小倉8日目 1R トミケンプライマリ/.test(det.basic['平地初騎乗']), det.basic['平地初騎乗']);
eq('誕生日を YYYYMMDD 化', det.birth, '19900301');
eq('年齢', det.age, 36);
eq('初免許年を数値化', det.firstYear, 2009);

console.log('\n[F] イチ推しアビリティ（得意コース・得意馬場・条件・時間帯）');
eq('6項目拾える', det.abilityItems.length, 6);
eq('得意コース3件', det.ability.courses.length, 3);
eq('得意コース1件目', det.ability.courses[0], { venue: '阪神', surface: 'ダ', dist: 1400, text: '阪神ダ1400m' });
eq('得意コース2件目', det.ability.courses[1].venue + det.ability.courses[1].surface + det.ability.courses[1].dist, '中京ダ1200');
eq('得意コース3件目', det.ability.courses[2].venue + det.ability.courses[2].surface + det.ability.courses[2].dist, '中京芝1600');
eq('得意馬場1件（芝重・不良◎）', det.ability.baba.length, 1);
eq('得意馬場の状態', det.ability.baba[0].states, ['重', '不良']);
eq('得意馬場のサーフェス', det.ability.baba[0].surface, '芝');
T('条件（少頭数◎）を拾う', det.ability.cond.some(x => /少頭数/.test(x)), det.ability.cond);
T('時間帯（序盤戦(1～3R)◎）を拾う', det.ability.time.some(x => /序盤戦/.test(x)), det.ability.time);
eq('未分類が無い', det.ability.unknown.length, 0);

console.log('\n[G] 成績テーブル（本年/累計 × 平地/障害/全レース）');
T('本年成績が取れる', !!det.thisYear);
eq('本年・全レース 1着', det.thisYear['全レース'].w1, 93);
eq('本年・全レース 2着', det.thisYear['全レース'].w2, 70);
eq('本年・全レース 3着', det.thisYear['全レース'].w3, 66);
eq('本年・全レース 着外', det.thisYear['全レース'].out, 349);
eq('本年・全レース 騎乗回数', det.thisYear['全レース'].rides, 578);
eq('本年・全レース 勝率', det.thisYear['全レース'].winRate, 16.1);
eq('本年・全レース 3着内率', det.thisYear['全レース'].showRate, 39.6);
eq('本年・平地 勝率', det.thisYear['平地'].winRate, 16.1);
eq('★本年・障害 勝率は null（「-」を数値化しない）', det.thisYear['障害'].winRate, null);
eq('本年・障害 騎乗回数=0', det.thisYear['障害'].rides, 0);
T('累計成績が取れる', !!det.career);
eq('累計・全レース 1着（カンマ除去）', det.career['全レース'].w1, 1459);
eq('累計・全レース 着外', det.career['全レース'].out, 10286);
eq('累計・全レース 騎乗回数', det.career['全レース'].rides, 14235);
eq('累計・全レース 勝率', det.career['全レース'].winRate, 10.2);
T('本年と累計は別テーブルとして分離', det.thisYear['全レース'].rides !== det.career['全レース'].rides);

console.log('\n[H] 今週の騎乗馬（当日の調子＋race_id/馬ID/調教師IDの同時収穫）');
eq('2日ぶん', det.weekly.length, 2);
eq('1日目 date8', det.weekly[0].date8, '20260912');
eq('1日目 8戦4勝', [det.weekly[0].runs, det.weekly[0].wins], [8, 4]);
eq('1日目 回/場/日目', [det.weekly[0].kai, det.weekly[0].venue, det.weekly[0].dayNo], [4, '阪神', 3]);
eq('2日目 date8', det.weekly[1].date8, '20260913');
eq('2日目 6戦1勝', [det.weekly[1].runs, det.weekly[1].wins], [6, 1]);
eq('2日目 場=中山', det.weekly[1].venue, '中山');
const rr = det.weekly[0].races[0] || {};
eq('レース行: 場', rr.venue, '阪神');
eq('レース行: R', rr.rnum, 11);
eq('レース行: レース名', rr.raceName, 'チャレンジＣ');
eq('レース行: コース', rr.course, '芝2000');
eq('レース行: 人気', rr.pop, 3);
eq('レース行: 着順', rr.rank, 1);
eq('レース行: 馬名', rr.horseName, 'ジョバンニ');
eq('レース行: 斤量', rr.weight, 58);
eq('レース行: コンビ', rr.combo, '11戦2勝');
eq('レース行: 間隔', rr.interval, '中7週');
eq('★race_id を収穫', rr.raceId, '202609120911');
eq('★馬ID を収穫', rr.horseId, '2022103995');
eq('★調教師ID を収穫', rr.trainerId, '01157');
const rr2 = det.weekly[1].races[0] || {};
eq('2日目レースの race_id', rr2.raceId, '202609130604');
eq('2日目レースの相対URLからも調教師ID', rr2.trainerId, '01169');

console.log('\n[I] ③ 騎手の調子（実測値だけから算出）');
const form = run(`klFormOf(${JSON.stringify(det)})`);
eq('本年勝率', form.yearWin, 16.1);
eq('累計勝率', form.careerWin, 10.2);
T('調子比 = 16.1/10.2 ≈ 1.58', Math.abs(form.ratio - 16.1 / 10.2) < 1e-9, form.ratio);
eq('★1.30以上なので「絶好調」', form.label, '絶好調');
eq('当日(今週)出走数 = 8+6', form.todayRuns, 14);
eq('当日(今週)勝利数 = 4+1', form.todayWins, 5);
T('当日勝率 ≈ 35.7%', Math.abs(form.todayRate - 5 / 14) < 1e-9, form.todayRate);
/* 不調パターン */
const slump = { thisYear: { '全レース': { winRate: 5.0 } }, career: { '全レース': { winRate: 10.0 } }, weekly: [] };
eq('勝率が累計の半分なら「不調（買いづらい）」', run(`klFormOf(${JSON.stringify(slump)}).label`), '不調（買いづらい）');
const mid = { thisYear: { '全レース': { winRate: 8.5 } }, career: { '全レース': { winRate: 10.0 } }, weekly: [] };
eq('0.85倍なら「やや不調」', run(`klFormOf(${JSON.stringify(mid)}).label`), 'やや不調');
const norm = { thisYear: { '全レース': { winRate: 10.0 } }, career: { '全レース': { winRate: 10.0 } }, weekly: [] };
eq('1.0倍なら「平常」', run(`klFormOf(${JSON.stringify(norm)}).label`), '平常');
eq('データ不足でも落ちない', run(`klFormOf(null).label`), '');

console.log('\n[J] ③ 得意アビリティと今回のレース条件の一致判定');
const race1 = { venue: '阪神', surface: 'ダ', dist: 1400, baba: '重', rnum: 2, heads: 9 };
const am1 = run(`klAbilityMatch(${JSON.stringify(det)}, ${JSON.stringify(race1)})`);
T('得意コース一致（阪神ダ1400m）', am1.course === true, am1.notes);
T('得意馬場一致（芝重・不良◎→ババ「重」）', am1.baba === true, am1.notes);
T('得意時間帯一致（序盤戦(1～3R)◎→2R）', am1.time === true, am1.notes);
T('少頭数◎が効く（9頭）', am1.notes.some(x => /少頭数/.test(x)), am1.notes);
const race2 = { venue: '東京', surface: '芝', dist: 2400, baba: '良', rnum: 11, heads: 18 };
const am2 = run(`klAbilityMatch(${JSON.stringify(det)}, ${JSON.stringify(race2)})`);
T('条件が違えば得意コース不一致', am2.course === false);
T('良馬場は得意馬場に入っていない', am2.baba === false);
T('11Rは序盤戦ではない', am2.time === false);
T('18頭は少頭数ではない', !am2.notes.some(x => /少頭数/.test(x)));
eq('レース情報が無くても落ちない', run(`klAbilityMatch(null, null).course`), false);

console.log('\n[K] キャッシュ（TTL・kind別分離）');
run(`klEntDrop();`);
eq('未取得時は null', run(`klEntGet('jockey','01126')`), null);
run(`klEntSet('jockey','01126', ${JSON.stringify(det)})`);
eq('保存後に引ける', run(`klEntGet('jockey','01126').name`), '松山 弘平');
eq('kind違いでは引けない（ID衝突対策）', run(`klEntGet('trainer','01126')`), null);
run(`klEntDrop();`);
eq('破棄後は null', run(`klEntGet('jockey','01126')`), null);
eq('不正ID(数字以外)は保存できない', run(`klEntSet('jockey','abc', {})`), false);
eq('TTL定数（12時間）', run(`KL_TTL_MS`), 12 * 3600 * 1000);
eq('登録簿TTL（7日）', run(`KL_REG_TTL_MS`), 7 * 24 * 3600 * 1000);

console.log('\n================ 結果 ================');
console.log('  PASS: ' + PASS + ' / FAIL: ' + FAIL);
if (FAIL){ console.log('\n失敗:\n  - ' + fails.join('\n  - ')); process.exit(1); }
console.log('  ✅ 第25弾②（騎手・調教師DBパーサ）ALL PASS');
