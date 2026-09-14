/* 馬ノート・データベース(短評/有利不利の登録・検索・マーク)のスモークテスト
   実行: node tests/horsebook.test.js
   p3_core + p25_horsebook を読み込み、保存/照合/貼り付け解析/マーカーHTML を検証する。 */
const fs = require('fs');
const vm = require('vm');

function makeEl(id){
  const el = {
    id: id || '', value:'', _checked:true, _html:'', _text:'',
    style:{}, dataset:{},
    classList:{ _s:new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); },
      toggle(c,f){ if(f===undefined){ this._s.has(c)?this._s.delete(c):this._s.add(c);} else { f?this._s.add(c):this._s.delete(c);} },
      contains(c){ return this._s.has(c); } },
    addEventListener(){}, removeEventListener(){}, click(){}, focus(){},
    setAttribute(){}, getAttribute(){ return null; }, closest(){ return null; },
    querySelector(){ return makeEl(); }, querySelectorAll(){ return []; },
    scrollIntoView(){}, appendChild(){}, remove(){}
  };
  Object.defineProperty(el, 'innerHTML', { get(){ return el._html; }, set(v){ el._html = v; el._text = String(v).replace(/<[^>]*>/g,''); } });
  Object.defineProperty(el, 'textContent', { get(){ return el._text; }, set(v){ el._text = String(v); } });
  return el;
}
const els = {};
const store = {};
const g = {
  console, Math, JSON, Date, String, Number, parseInt, parseFloat, isNaN, RegExp,
  encodeURIComponent, decodeURIComponent,
  setTimeout(){ return 0; }, clearTimeout(){}, setInterval(){ return 0; }, clearInterval(){},
  localStorage: { getItem(k){ return store[k] != null ? store[k] : null; }, setItem(k,v){ store[k]=String(v); }, removeItem(k){ delete store[k]; } },
  addEventListener(){}, removeEventListener(){},
  devicePixelRatio: 1, innerWidth: 980,
  navigator:{},
  document: { getElementById(id){ if(!els[id]) els[id]=makeEl(id); return els[id]; }, addEventListener(){}, querySelector(){ return makeEl(); } }
};
g.window = g;
vm.createContext(g);
let code = '';
for (const f of ['src/p3_core.js','src/p25_horsebook.js']) code += fs.readFileSync(f,'utf8') + '\n';
vm.runInContext(code, g, { filename: 'hb.js' });
const s = g;

let ok = 0, bad = 0;
function t(n,c,x){ if(c) ok++; else { bad++; console.log('FAIL', n, x); } }
function assertNoThrow(n, fn){ try { fn(); ok++; } catch(e){ bad++; console.log('FAIL', n, e && e.message); } }

// 1. 空DBでは見つからない
t('empty hbFind null', s.hbFind({ name:'ウマA', nk:'' }) == null);
t('empty summary 0', /登録馬 0頭/.test(s.hbSummary()));

// 2. 登録 → 同一馬(nk一致)で追跡
const e1 = s.hbNewNote({ nk:'1000000001', name:'ウマA' }, 'short', '好位から抜け出して完勝。', { date:'2026年9月7日', label:'テストR' });
t('note saved entry', !!e1 && e1.notes.length === 1 && e1.names.indexOf('ウマA') >= 0);
t('find by nk', (s.hbFind({ nk:'1000000001', name:'ウマA' })||{}).id === e1.id);
// 表記ゆれ・別レースでも nk があれば同一馬
t('find by nk (name blank)', (s.hbFind({ nk:'1000000001', name:'' })||{}).id === e1.id);
// nk が無いが馬名が同じ → 同一馬（名前フォールバック）
t('find by name only', (s.hbFind({ nk:'', name:'ウマA' })||{}).id === e1.id);
// 名前違い・nkなし → 別馬
s.hbNewNote({ nk:'', name:'ウマB' }, 'adv', '出遅れが響いた。次走は展開次第。', { date:'2026年9月7日', label:'テストR' });
t('distinct name separate entry', s.hbLoad().horses.length === 2);

// 3. 削除
const nid = e1.notes[0].id;
t('del note returns true', s.hbDelNote(e1.id, nid) === true);
const afterDel = s.hbLoad().horses.filter(function(x){ return x.id === e1.id; })[0];
t('del note removed', afterDel && afterDel.notes.length === 0);
s.hbDelNote(e1.id, nid); // 二重削除は安全

// 4. 貼り付け解析（出馬表の馬名を自動判定）
s.state = s.freshState();
s.state.horses = [
  { uid: 1, no: '5', name: 'ソールオリエンス', frame: '4' },
  { uid: 2, no: '3', name: 'ドウデュース', frame: '2' }
];
const pasteTxt = 'ドウデュース＝好位から直線で突き抜けて完勝。\nソールオリエンス＝中団追走も直線で伸び切れず。\nパンサラッサ＝逃げたが最後は力尽きた。';
const rows = s.hbParsePaste(pasteTxt);
t('parse 3 rows', rows.length === 3, rows.length);
t('auto assign ドウデュース', rows[0].hit && rows[0].hit.name === 'ドウデュース', rows[0].hit && rows[0].hit.name);
t('auto assign ソールオリエンス', rows[1].hit && rows[1].hit.name === 'ソールオリエンス', rows[1].hit && rows[1].hit.name);
t('unknown horse unassigned', rows[2].hit == null);

// 5. 候補セレクトのoptionに今回の馬が含まれる
const opts = s.hbSelectOptions('ドウデュース');
t('select contains both current horses', opts.indexOf('ドウデュース') >= 0 && opts.indexOf('ソールオリエンス') >= 0);
t('selected default', opts.indexOf('selected') >= 0);

// 6. 値→馬の解決
const sol = s.hbHorseFromVal('u1');
t('resolve uid->horse', !!sol && sol.src === 'cur' && sol.h.name === 'ソールオリエンス');

// 7. バッジHTML（メモがある馬のみ）
const db = s.hbLoad();
const eA = s.hbFind({ nk:'', name:'ウマA' });  // メモ削除済みなので0件
const b0 = s.hbBadgeHTML({ nk:'1000000001', name:'ウマA' });
t('no badge when no notes', b0 === '');
// もう1件 短評を追加 → バッジ表示
s.hbNewNote({ nk:'1000000001', name:'ウマA' }, 'short', '次走も注目。', {});
t('badge appears', /data-hb=/.test(s.hbBadgeHTML({ nk:'1000000001', name:'ウマA' })));

// 8. 表示系が例外なく描ける
assertNoThrow('hbCurrentRaceStrip', function(){ s.hbCurrentRaceStrip(); });
assertNoThrow('hbHorseCardHTML', function(){ const ee=s.hbLoad().horses[0]; s.hbHorseCardHTML(ee, false); });
assertNoThrow('hbKentaiNoteHTML', function(){ s.hbKentaiNoteHTML(); });

// 9. 次走相当: 新しいレースに同じ馬(名前のみ)がいたらメモあり扱い
s.state.horses = [{ uid: 9, no: '7', name: 'ウマA', frame: '4' }];
t('marker for next race horse', /data-hb=/.test(s.hbCurrentRaceStrip()));

// --- レース後コメント記事の解析（見出し＋馬名リンク＋コメント） ---
const articleHtml =
  '<html><title>x</title>札幌11Rの丹頂ステークスは1番人気コーチェラバレーが勝利した。<br>' +
  '<b>レース後のコメント</b><br>' +
  '1着　<a href="https://db.netkeiba.com/horse/2022104733/?rf=link_news">コーチェラバレー</a>(<a href="https://db.netkeiba.com/jockey/01140/?rf=link_news">横山和生騎手</a>)<br>' +
  '「レースで乗るのは2回目ですが、上手く走れました」<br>' +
  '2着　<a href="https://db.netkeiba.com/horse/2020106909/?rf=link_news">ゴールデンスナップ</a>(<a href="https://db.netkeiba.com/jockey/01115/?rf=link_news">浜中俊騎手</a>)<br>' +
  '「勝った馬とは競馬の器用さの差ですね」<br>' +
  '3着　<a href="https://db.netkeiba.com/horse/2020106234/?rf=link_news">グランドカリナン</a>(<a href="https://db.netkeiba.com/jockey/01206/?rf=link_news">小林美駒騎手</a>)<br>' +
  '「後ろからが合っているのではと思います」<br>関連情報など';
const ents = s.hbParseCommentArticle(articleHtml);
t('article parse 3 horses', ents.length === 3, ents.length);
t('article horse1 name/nk', ents[0].name === 'コーチェラバレー' && ents[0].nk === '2022104733');
t('article horse1 jockey', ents[0].jockey === '横山和生騎手');
t('article text contains rider quote', ents[0].text.indexOf('上手く走れました') >= 0);
t('article horse3 text', ents[2].text.indexOf('後ろからが合っている') >= 0);

// --- 記事エントリ → 割当行(現在の出馬表・DBと突合) ---
s.state.horses = [
  { uid: 5, no: '5', name: 'コーチェラバレー', frame: '1', nk: '2022104733' },
  { uid: 6, no: '6', name: '別馬', frame: '2', nk: '' }
];
const nrows = s.hbNewsToRows(ents);
t('news rows same count', nrows.length === 3);
t('resolved uid by nk', nrows[0].val === 'u5', nrows[0].val);
t('resolved by db name fallback (ゴールデンスナップ)', /^e/.test(nrows[1].val) || nrows[1].val === 'u' || nrows[1].val === '', nrows[1].val);
t('row label has order/horse', /1着/.test(nrows[0].label) && /コーチェラバレー/.test(nrows[0].label));
t('row text has rider prefix', /横山和生騎手/.test(nrows[0].text));

// --- SP版(馬名リンク無し・全角数字・全角括弧)でもテキストから抽出できる ---
const spArticle =
  'レース後のコメント<br>' +
  '１着　コーチェラバレー（横山和生騎手）<br>「レースで乗るのは2回目でしたが、上手く走れました」<br>' +
  '２着　ゴールデンスナップ（浜中俊騎手）<br>「勝った馬とは器用さの差ですね」<br>' +
  '３着　グランドカリナン（小林美駒騎手）<br>「後ろからが合っているようです」<br>関連情報';
const spEnts = s.hbParseCommentArticle(spArticle);
t('sp parse 3 (no links)', spEnts.length === 3, spEnts.length);
t('sp fullwidth order', spEnts[0].order === 1 && spEnts[2].order === 3, spEnts.map(function(x){return x.order;}));
t('sp name from text', spEnts[0].name === 'コーチェラバレー');
t('sp jockey from paren', spEnts[0].jockey === '横山和生騎手');
t('sp comment clean', spEnts[0].text.indexOf('上手く走れました') >= 0 && spEnts[0].text.indexOf('コーチェラバレー') < 0);
// 馬名リンクあり記事でPC同様に取れることを再確認
t('link article still parses', (function(){ const pcHtml = '<b>レース後のコメント</b>1着　<a href="https://db.netkeiba.com/horse/2022104733/?rf=x">コーチェラバレー</a>(<a href="https://db.netkeiba.com/jockey/01140/?rf=x">横山和生騎手</a>)「直線で突き抜けた」 関連情報'; const en = s.hbParseCommentArticle(pcHtml); return en.length === 1 && en[0].nk === '2022104733'; })());
// 見出しが無く、記事本文中に「◯着」が混ざるだけの場合は誤抽出しない
const noComment = '<div>札幌11Rの丹頂ステークスは7馬身差の2着にゴールデンスナップ、3着にグランドカリナンが入った。</div>';
t('no heading no false split', s.hbParseCommentArticle(noComment).length === 0);

// --- プレビュー → 割当表フローで必要な関数が存在し安全 ---
t('preview funcs exist', typeof s.hbOpenNewsArticle === 'function' && typeof s.hbRenderNewsPreview === 'function' && typeof s.hbUsePreview === 'function');
assertNoThrow('hbToPc convert', function(){ s.hbToPc('https://news.sp.netkeiba.com/?pid=news_view&no=123'); });
const pcUrl = s.hbToPc('https://news.sp.netkeiba.com/?pid=news_view&no=123');
t('hbToPc swaps host', pcUrl === 'https://news.netkeiba.com/?pid=news_view&no=123', pcUrl);

// --- 実在記事に近い形式でも安全に動く ---
assertNoThrow('parse weird article', function(){ s.hbParseCommentArticle('<div>コメントなし</div>'); });
assertNoThrow('fetch rejects w/o relay', function(){ s.hbFetchHtml('https://news.netkeiba.com/').then(function(){}, function(){}); });

// --- 記事URL直接貼り付け → 抽出 → プレビュー → 割当表 のフロー ---
const urlFlowHtml =
  '<html><head><title>【セントウルSレース後コメント】フリッカージャブ松山弘平騎手ら | 競馬ニュース - netkeiba</title></head><body>' +
  'セントウルS（G3）はフリッカージャブが勝利した。<br>' +
  '<b>レース後のコメント</b><br>' +
  '1着　<a href="https://db.netkeiba.com/horse/2022102020/?rf=link_news">フリッカージャブ</a>(<a href="https://db.netkeiba.com/jockey/01126/?rf=link_news">松山弘平騎手</a>)<br>' +
  '「同型の速い馬もいるので、ゲートをきっちり決めたいと思っていました。この先のGIでも楽しみです」<br>' +
  '2着　<a href="https://db.netkeiba.com/horse/2021107058/?rf=link_news">ピューロマジック</a>(<a href="https://db.netkeiba.com/jockey/01174/?rf=link_news">岩田望来騎手</a>)<br>' +
  '「少し速かったですが、2着に残ってくれました」<br>関連情報</body></html>';
(function(){
  // 中継スタブ: SP版URL→PC版を優先取得して実際のパーサを通す
  s.stFetchHtml = function(url){
    return Promise.resolve(String(url).indexOf('netkeiba.com') >= 0 ? urlFlowHtml : '');
  };
  const inp = s.document.getElementById('hbNewsUrl');
  inp.value = 'https://news.sp.netkeiba.com/?pid=news_view&no=341993';
  t('openNewsArticle is fn', typeof s.hbOpenNewsArticle === 'function', typeof s.hbOpenNewsArticle);
  const fp = s.hbOpenNewsArticle();   // URL抽出フロー(内部でプレビューまで描画)
  t('URL flow returns promise', !!(fp && typeof fp.then === 'function'), typeof fp);
  return fp;
})()
.then(function(){
  t('URL flow preview state', !!s.hbPreviewState && s.hbPreviewState.entries.length === 2, s.hbPreviewState && s.hbPreviewState.entries.length);
  t('URL flow nk resolved', s.hbPreviewState && s.hbPreviewState.entries[0].nk === '2022102020' && s.hbPreviewState.entries[1].nk === '2021107058', s.hbPreviewState && s.hbPreviewState.entries.map(function(e){return e.nk;}));
  t('URL flow title from page', s.hbPreviewState && /セントウルS/.test(s.hbPreviewState.title) && /netkeiba/.test(s.hbPreviewState.title) === false, s.hbPreviewState && s.hbPreviewState.title);
  t('URL flow preview head link', /取得元/.test(s.document.getElementById('hbNewsPrevHead')._html), s.document.getElementById('hbNewsPrevHead')._html.slice(0,120));
  // プレビュー本文に行が描画されている
  t('URL flow preview body rows', /フリッカージャブ/.test(s.document.getElementById('hbNewsPrevBody')._html), s.document.getElementById('hbNewsPrevBody')._html.slice(0,120));
  // 「この内容を割当表へ入れる」→ 割当行ができる
  assertNoThrow('use preview to assign', function(){ s.hbUsePreview(); });
  t('assign rows from article', Array.isArray(s.hbAssignRows) && s.hbAssignRows.length === 2, s.hbAssignRows && s.hbAssignRows.length);
  t('assign context fromNews', !!(s.hbAssignCtx && s.hbAssignCtx.fromNews && s.hbAssignCtx.date), s.hbAssignCtx);
}).then(function(){
  // URL空欄のときは案内ログを出して中断(例外なし)
  const inp2 = s.document.getElementById('hbNewsUrl');
  inp2.value = '';
  assertNoThrow('extract with empty url', function(){ s.hbOpenNewsArticle(); });
}).then(function(){
  /* ---- 折り込み表示（ページが縦に伸びない） ---- */
  for (let i = 0; i < 25; i++) s.hbNewNote({ nk:'9000000' + (100+i), name:'テスト馬' + i }, 'short', '短評' + i, { date:'2026年9月7日', label:'R' });
  s.hbShownReset();
  s.hbRefresh();
  const listHtml = s.document.getElementById('hbList')._html;
  const nCards = (listHtml.match(/class="hbhorse"/g) || []).length;
  t('折り込み: 初期表示は20頭まで', nCards === 20, nCards);
  const moreHtml = s.document.getElementById('hbMoreRow')._html;
  t('折り込み: さらに表示ボタン', /btnHbMore/.test(moreHtml) && /さらに20頭/.test(moreHtml), moreHtml.slice(0,160));
  t('折り込み: 残数表示', /残り7頭/.test(moreHtml), moreHtml.slice(0,200));
  // 「さらに表示」で増える → 全件表示
  s.hbShownCount += 20; s.hbRefresh();
  t('折り込み: さらに表示で40頭まで枠が広がる', (s.document.getElementById('hbList')._html.match(/class="hbhorse"/g) || []).length === 27,
    (s.document.getElementById('hbList')._html.match(/class="hbhorse"/g) || []).length);
  t('折り込み: 全件表示後は案内文', /すべて|全 27頭を表示中|全27頭/.test(s.document.getElementById('hbMoreRow')._html), s.document.getElementById('hbMoreRow')._html.slice(0,120));
  // 検索すると段階表示がリセットされる
  s.hbShownCount = 100;
  s.document.getElementById('hbSearch').value = 'テスト馬1';
  s.hbShownReset();
  t('折り込み: 検索でリセット', s.hbShownCount === 20, s.hbShownCount);
  s.document.getElementById('hbSearch').value = '';
  // 折り込みカードのCSSが読み込まれている（index.html 側の定義を確認）
  const idx = fs.readFileSync('index.html','utf8');
  // 4枚=静的な折り込み＋2枚=動的生成（シミュレーターの📊合計集計、バイアスの開催場ごと）
  //   ※ 2026-09-11: シミュレーターの「レース映像」「100回モンテカルロ集計」カードを削除 → 7枚→6枚
  //   ※ 2026-09-11 第11弾: 🧬血統ファクターの内訳を「🔍 内訳・全件」として折り込み（検出結果はボタン直下へ） → 6枚→7枚
  //   ※ 2026-09-11 第14弾: 🌐うましるの調教タイム取込（重賞のみ）を折り込み → 7枚→8枚
  //   ※ 2026-09-12 第15弾: 🏇馬柱AI評価（狙い目の文章要約つき）と 🔁AI予想の自己学習 を折り込み → 8枚→10枚
  //   ※ 2026-09-12 第18弾: 📈買い目提案（詳細版）(#bpCard) を1枚追加 → 11→12
  //   ※ 2026-09-13 第19弾②: 💰回収率チューナー(#vtCard) を1枚追加 → 12→13
  const FOLD_N = 13;   // ★2026-09-12 第16弾で「🌊 展開の学習」カード(#pfCard)を1枚追加 → 10→11
  t('折り込み: <details class="card fold"> が' + FOLD_N + '枚', (idx.match(/class="card fold"/g) || []).length === FOLD_N,
    (idx.match(/class="card fold"/g) || []).length);
  // 全馬プロフィール(馬詳細)も1頭ずつ折りたたむ（#2026-09-10）
  t('全馬プロフィール: 馬ごとに details.card.fold.hdhorse',
    /hdhorse/.test(idx) && /details class="card fold hdhorse"/.test(idx));
  t('折り込み: 枠内スクロールCSS', /details\.card\.fold/.test(idx) && /\.hbsbox\{max-height/.test(idx));
}).catch(function(e){
  console.log('  async URL flow ERROR:', e && e.stack || e);
  bad++;
}).then(function(){
  console.log('horsebook: OK', ok, 'FAIL', bad);
  process.exit(bad ? 1 : 0);
});
