/* 2026-09-13 第22弾 の回帰テスト
   実行: node tests/rework14.test.js

   ご依頼: 「記事URLを貼り付けて抽出の際に、抽出記事の中からレース名を自動検出して
            該当馬を参照する事で短評の書き込みができるようにする
            （現在は選択した出馬表に限る記事の抽出にしか対応できていない為）」

   検証内容:
     A) 記事本文からレース名・場・R番号・グレード・距離・race_id を自動検出できる
     B) 1記事に複数レースがあっても、馬コメントを正しいレースに振り分けられる
     C) 今開いている出馬表に居ない馬でも、出馬表キャッシュ／学習DB／馬ノートから参照できる
     D) ローカルに1頭も居ないレースだけ、netkeibaから出馬表を取りに行って再照合できる
     E) どのデータにも居ない馬は、記事の馬名＋競走馬IDで馬ノートを新規作成して登録できる
     F) p25_horsebook（プレビュー→割当表→保存）まで通しで動く
     G) index.html / build.py への組み込み
*/
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
let ok = 0, bad = 0;
function T(name, cond, extra){
  if (cond) { ok++; }
  else { bad++; console.log('  ✗ FAIL: ' + name + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); }
}
function eq(name, got, want){
  const g = JSON.stringify(got), w = JSON.stringify(want);
  T(name + ' (' + g + ' == ' + w + ')', g === w, { got: got, want: want });
}
function mkLS(){
  const m = {};
  return {
    _m: m,
    get length(){ return Object.keys(m).length; },
    key(i){ return Object.keys(m)[i] || null; },
    getItem(k){ return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem(k, v){ m[k] = String(v); },
    removeItem(k){ delete m[k]; }
  };
}
function makeEl(id){
  const el = { id: id || '', value: '', _html: '', style: {}, dataset: {}, checked: true, disabled: false, open: false,
    classList: { _s: new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); }, contains(c){ return this._s.has(c); },
      toggle(c, f){ if (f === undefined){ this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { f ? this._s.add(c) : this._s.delete(c); } } },
    _attrs: {},
    setAttribute(k, v){ this._attrs[k] = String(v); }, getAttribute(k){ return this._attrs[k] == null ? null : this._attrs[k]; },
    addEventListener(){}, appendChild(){}, focus(){}, closest(){ return null; }, scrollIntoView(){},
    querySelector(){ return makeEl(); }, querySelectorAll(){ return []; } };
  Object.defineProperty(el, 'innerHTML', { get(){ return el._html; }, set(v){ el._html = v; } });
  Object.defineProperty(el, 'textContent', { get(){ return el._t || ''; }, set(v){ el._t = String(v); } });
  return el;
}
function mkG(ls, fetchSpy){
  const els = {};
  const g = {
    console, Math, JSON, Date, String, Number, parseInt, parseFloat, isNaN, isFinite, RegExp,
    Array, Object, Boolean, Error, Promise, encodeURIComponent, decodeURIComponent,
    setTimeout(fn2){ try { fn2(); } catch(e){} return 0; },
    clearTimeout(){}, setInterval(){ return 0; }, clearInterval(){},
    requestAnimationFrame(){ return 0; }, cancelAnimationFrame(){},
    localStorage: ls, addEventListener(){}, devicePixelRatio: 1, innerWidth: 980,
    navigator: {}, window: null,
    fetch(u){ if (fetchSpy) fetchSpy.push(String(u)); return Promise.reject(new Error('no fetch in test')); },
    document: { getElementById(id){ if (!els[id]) els[id] = makeEl(id); return els[id]; },
                addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
                createElement(){ return makeEl('tmp'); }, head: { appendChild(){} } }
  };
  g.window = g; g.globalThis = g; g.__els = els;
  vm.createContext(g);
  return g;
}
function load(g, files){
  let code = '';
  files.forEach(function(f){ code += fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n'; });
  vm.runInContext(code, g, { filename: 'keiba.js' });
  return function(src){ return vm.runInContext(src, g); };
}
const readFix = function(n){ return fs.readFileSync(path.join(FIX, n), 'utf8'); };
const tick = () => new Promise(r => setTimeout(r, 0));

/* p25 + p62 + 横断検索に使う各モジュール */
const CORE = ['src/p00_fflate.js', 'src/p3_core.js', 'src/p4_parse.js',
              'src/p12_urlimport.js', 'src/p18_racesearch.js', 'src/p30_learnrec.js',
              'src/p25_horsebook.js', 'src/p62_articleref.js'];

/* ============================================================
   A) 記事からレース名を自動検出（実物記事フィクスチャ）
   ============================================================ */
async function sectionA(){
  console.log(' A. 記事本文からレース名・場・R・グレード・距離・race_id を自動検出');
  const g = mkG(mkLS());
  const run = load(g, CORE);
  run('globalThis.__ART = ' + JSON.stringify(readFix('nk_news_comment_342561.html')) + ';');
  const r = run('arParseArticle(globalThis.__ART)');

  T('実物記事（チャレンジCレース後コメント）をパースできる', !!r && r.entries.length > 0);
  eq('検出したレースは1件', r.races.length, 1);
  const rc = r.races[0];
  eq('場名', rc.venue, '阪神');
  eq('R番号', rc.rno, 11);
  eq('レース名', rc.name, 'チャレンジカップ');
  eq('グレード', rc.grade, 'GIII');
  eq('距離', rc.dist, '芝2000m');
  eq('race_id（関連情報の結果リンクから）', rc.rid, '202609040311');
  eq('回次（第77回）', rc.kai, 77);
  T('表示ラベルに 場＋R＋レース名＋グレード＋距離 が出る', /阪神11R チャレンジカップ\(GIII\) 芝2000m/.test(run('arRaceLabel(arParseArticle(globalThis.__ART).races[0])')));
  eq('記事の配信日', r.dateText, '2026年9月12日');
  T('記事タイトル', /チャレンジCレース後コメント/.test(r.title));

  eq('抽出できた馬コメントは8件', r.entries.length, 8);
  eq('1着の馬名', r.entries[0].name, 'ジョバンニ');
  eq('1着の競走馬ID（馬名リンクから）', r.entries[0].nk, '2022103995');
  eq('1着の騎手', r.entries[0].jockey, '松山弘平騎手');
  T('1着のコメント本文が入っている', /なかなか重賞に手が届いていませんでした/.test(r.entries[0].text));
  T('コメントに配信元クレジット（ラジオNIKKEI）が混ざらない',
    r.entries.every(function(e){ return !/ラジオNIKKEI/.test(e.text); }), r.entries[r.entries.length - 1].text);
  T('8着同着も拾える', r.entries.some(function(e){ return e.name === 'ピースワンデュック' && e.order === 8; }));
  T('全部の馬にレース名が付いている', r.entries.every(function(e){ return !!e.raceLabel; }));

  /* 本文の外（関連情報・みんなのコメント）にある他レース名を拾っていないこと */
  T('関連情報の「メイクデビュー阪神6R」をレースとして拾わない',
    !r.races.some(function(x){ return x.rno === 6; }), JSON.stringify(r.races.map(function(x){ return x.venue + x.rno + 'R'; })));
  T('「関連情報」以降のテキストを本文に含めていない', r.body.to < r.T.text.length);
}

/* ============================================================
   B) 1記事に複数レース → グループ化と race_id の対応付け
   ============================================================ */
async function sectionB(){
  console.log(' B. 複数レース記事のグループ化＋race_idの正しい対応付け');
  const g = mkG(mkLS());
  const run = load(g, CORE);
  run('globalThis.__ART = ' + JSON.stringify(readFix('nk_news_comment_multi.html')) + ';');
  const r = run('arParseArticle(globalThis.__ART)');

  eq('2レースを検出', r.races.length, 2);
  const a = r.races[0], b = r.races[1];
  eq('1レース目 場名', a.venue, '中山');
  eq('1レース目 R番号', a.rno, 11);
  eq('1レース目 レース名', a.name, 'セントライト記念');
  eq('2レース目 場名', b.venue, '阪神');
  eq('2レース目 R番号', b.rno, 10);
  eq('2レース目 レース名', b.name, 'ローズステークス');
  /* ★ race_id は「関連情報」にまとめて並ぶので、位置が近いだけだと別のレースのIDを拾う。
        文書順＋R番号の一致で対応づけているかをここで確認します。 */
  eq('1レース目の race_id（R番号11と一致する方）', a.rid, '202609050411');
  eq('2レース目の race_id（R番号10と一致する方）', b.rid, '202609050310');
  T('race_id 下2桁とR番号が食い違う組み合わせになっていない',
    a.rid.slice(10) === '11' && b.rid.slice(10) === '10');

  eq('グループは2つ', r.groups.length, 2);
  eq('1グループ目の頭数', r.groups[0].entries.length, 3);
  eq('2グループ目の頭数', r.groups[1].entries.length, 3);
  T('1グループ目はセントライト記念', /セントライト記念/.test(r.groups[0].label));
  T('2グループ目はローズステークス', /ローズステークス/.test(r.groups[1].label));
  T('各馬コメントが正しいレースに付いている',
    r.groups[0].entries.every(function(e){ return ['ミュージアムマイル','ショウヘイ','ファイアンクランツ'].indexOf(e.name) >= 0; }) &&
    r.groups[1].entries.every(function(e){ return ['カムニャック','パラディレーヌ','タイセイプランセス'].indexOf(e.name) >= 0; }));
  /* ★ レース境目でブロックを打ち切らないと、前のレース最後の馬の短評に
        次のレースの概要文がまるごと混ざります（実装途中で実際に起きました） */
  T('レース1最後の馬の短評に次のレース概要が混ざらない',
    !/阪神10R|ローズステークス/.test(r.groups[0].entries[2].text), r.groups[0].entries[2].text);
  T('競走馬IDも全頭取れている', r.entries.every(function(e){ return /^\d{10}$/.test(e.nk || ''); }));
}

/* ============================================================
   C) 横断参照: 今の出馬表に居なくても探せる
   ============================================================ */
async function sectionC(){
  console.log(' C. 該当馬の横断参照（出馬表キャッシュ／学習DB／馬ノート）');
  const g = mkG(mkLS());
  const run = load(g, CORE);

  /* --- C-1: 今の出馬表が「別レース」でも、出馬表キャッシュから引ける --- */
  run('globalThis.__CARD = ' + JSON.stringify(readFix('nk_shutuba_202609040311.html')) + ';');
  run(`
    // 今開いている出馬表＝まったく別のレース（記事の馬は1頭も居ない）
    state.race = { name:'2歳未勝利', place:'中山', dist:'1600', grade:'', baba:'良', time:'' };
    state.raceId = '202609050505';
    state.horses = [ mkHorse({ no:'1', name:'アカノタニン', nk:'2020999999' }),
                     mkHorse({ no:'2', name:'ベツレース',   nk:'2020999998' }) ];
    // 出馬表キャッシュに記事のレース（阪神11R チャレンジC）を入れておく
    nkCardSet('202609040311', globalThis.__CARD, '20260912');
    arIdxReset();
  `);
  run('globalThis.__ART = ' + JSON.stringify(readFix('nk_news_comment_342561.html')) + ';');
  const r = run('arParseArticle(globalThis.__ART)');
  const rows = run('(function(){ hbPreviewState = { date:"2026年9月12日", title:"t", url:"u", html:globalThis.__ART, entries: arParseArticle(globalThis.__ART).entries, races: arParseArticle(globalThis.__ART).races, groups: arParseArticle(globalThis.__ART).groups }; return hbNewsToRows(hbPreviewState.entries); })()');

  eq('記事の8頭ぶんが行になる', rows.length, 8);
  const nCard = rows.filter(function(x){ return x.src === 'card'; }).length;
  eq('8頭すべて出馬表キャッシュから参照できた', nCard, 8);
  T('「該当する登録馬なし」が1件も無い', rows.every(function(x){ return !!x.val; }));
  T('割当値は xref（今回の出走外）になっている', rows.every(function(x){ return /^x\d+$/.test(x.val); }), rows.map(function(x){ return x.val; }).join(','));
  const giov = rows.filter(function(x){ return x.name === 'ジョバンニ'; })[0];
  T('ジョバンニの行がある', !!giov);
  T('ジョバンニは競走馬ID 2022103995 で紐づく', giov && giov.found && String(giov.found.nk) === '2022103995', giov && JSON.stringify(giov.found));
  T('参照元ラベルが「💾 出馬表キャッシュ」', /出馬表キャッシュ/.test(run('arSrcLabel("card")')));
  T('行に検出したレース名が保持されている（区切り見出し用）', giov && /阪神11R チャレンジカップ/.test(giov.raceLabel), giov && giov.raceLabel);
  eq('短評に付記するレース名が入る（表示ラベルと同じ形）', giov && giov.ctx.label, '阪神11R チャレンジカップ(GIII) 芝2000m（netkeiba レース後コメント）');

  /* --- C-2: キャッシュにも無ければ学習DBから引ける --- */
  run(`
    nkCardClear();
    // 学習DBに「ジョバンニ」だけ入れておく（predHorses 側・競走馬IDつき）
    globalThis.__recs = { '202609040311': { rid:'202609040311', meta:{ date8:'20260912', place:'阪神', name:'チャレンジＣ' },
      predHorses:[ { no:'15', name:'ジョバンニ', nk:'2022103995' } ], result:null } };
    apScan = function(){ return globalThis.__recs; };
    arIdxReset();
  `);
  const f2 = run('arFind("ジョバンニ", "2022103995")');
  T('学習DBからジョバンニを参照できる', !!f2 && f2.src === 'learn', JSON.stringify(f2));
  eq('学習DBのレース名が付く', f2.raceName, 'チャレンジＣ');
  const rows2 = run('hbNewsToRows(hbPreviewState.entries)');
  T('学習DBに居る馬だけ learn になる', rows2.filter(function(x){ return x.src === 'learn'; }).length === 1,
    rows2.map(function(x){ return x.src; }).join(','));
  T('学習DBに居ない馬は 🆕新規 になる', rows2.filter(function(x){ return x.src === 'new'; }).length === 7);

  /* --- C-3: 馬ノートDBにあれば e<id> を返す（既存の保存経路がそのまま使える） --- */
  run(`
    globalThis.__recs = {};
    var db = hbLoad();
    db.horses.push({ id:'hTEST01', nk:'2022104896', names:['カラマティアノス'], notes:[], memo:'', updatedAt:'' });
    hbCommit(db);
    arIdxReset();
  `);
  const rows3 = run('hbNewsToRows(hbPreviewState.entries)');
  const kara = rows3.filter(function(x){ return x.name === 'カラマティアノス'; })[0];
  T('馬ノートDBにある馬は e<id> になる', kara && /^ehTEST01$/.test(kara.val), kara && kara.val);
  eq('参照元は book', kara && kara.src, 'book');

  /* --- C-4: 今開いている出馬表に居る馬はそちらを優先 --- */
  run(`
    state.horses = [ mkHorse({ no:'9', name:'ジョバンニ', nk:'2022103995', uid: 4242 }) ];
    arIdxReset();
  `);
  const rows4 = run('hbNewsToRows(hbPreviewState.entries)');
  const giov4 = rows4.filter(function(x){ return x.name === 'ジョバンニ'; })[0];
  T('今の出馬表に居る馬は u<uid> が優先される', giov4 && /^u4242$/.test(giov4.val), giov4 && giov4.val);
  eq('参照元は cur', giov4 && giov4.src, 'cur');
  T('検索範囲の内訳が表示できる', /検索範囲: 今の出馬表 \d+頭／出馬表キャッシュ \d+頭／学習DB \d+頭／馬ノート \d+頭/.test(run('arIndexStat()')), run('arIndexStat()'));
}

/* ============================================================
   D) ローカルに1頭も居ないレースだけ netkeiba から取得
   ============================================================ */
async function sectionD(){
  console.log(' D. 見つからないレースだけ netkeiba から出馬表を取得して再照合');
  const g = mkG(mkLS());
  const run = load(g, CORE);
  run('globalThis.__ART = ' + JSON.stringify(readFix('nk_news_comment_342561.html')) + ';');
  run(`
    state.race = { name:'2歳未勝利', place:'中山', dist:'1600', grade:'', baba:'良', time:'' };
    state.horses = [ mkHorse({ no:'1', name:'アカノタニン', nk:'2020999999' }) ];
    globalThis.__CARD = ${JSON.stringify(readFix('nk_shutuba_202609040311.html'))};
    globalThis.__FETCH = [];
    nkFetchCardText = function(rid, opt){
      globalThis.__FETCH.push(String(rid));
      if (String(rid) === '202609040311'){
        nkCardSet(rid, globalThis.__CARD, '20260912');
        return Promise.resolve(globalThis.__CARD);
      }
      return Promise.reject(new Error('not found: ' + rid));
    };
  `);
  const parsed = run('arParseArticle(globalThis.__ART)');
  run('hbPreviewState = { date:"2026年9月12日", title:"t", url:"u", html:globalThis.__ART, entries:' +
      JSON.stringify(parsed.entries) + ', races:' + JSON.stringify(parsed.races) + ', groups:null, year:2026 };');
  run('hbPreviewState.groups = arParseArticle(globalThis.__ART).groups;');

  const need = run('arNeedOnline(hbPreviewState.groups)');
  eq('未取得として拾うレースは1件', need.length, 1);
  eq('そのレースの race_id', need[0] && need[0].rid, '202609040311');

  const res = await run('arResolveOnline(arNeedOnline(hbPreviewState.groups), { year: 2026 })');
  eq('1レースぶん取得できた', res.done, 1);
  eq('失敗は0', res.fail, 0);
  eq('取得に行った race_id', run('globalThis.__FETCH'), ['202609040311']);
  T('取得した出馬表がキャッシュに保存された（2回目は通信ゼロ）', run('nkCardHas("202609040311")'));

  const rows = run('hbNewsToRows(hbPreviewState.entries)');
  eq('8頭すべて参照できた', rows.filter(function(x){ return x.src === 'card'; }).length, 8);
  T('🆕新規が1件も無い', rows.filter(function(x){ return x.src === 'new'; }).length === 0,
    rows.map(function(x){ return x.name + ':' + x.src; }).join(','));

  /* 2回目はもう取りに行かない（＝取得済みレースを何度も叩かない） */
  run('globalThis.__FETCH = [];');
  const need2 = run('arNeedOnline(hbPreviewState.groups)');
  eq('取得済みなので未取得レースは0件', need2.length, 0);

  /* レース名しか分からない記事 → rsSearch で race_id を解決してから取りに行く */
  run(`
    nkCardClear(); arXrefReset(); arIdxReset();
    state.horses = [ mkHorse({ no:'1', name:'アカノタニン', nk:'2020999999' }) ];
    globalThis.__FETCH = [];
    globalThis.__RS = [];
    rsSearch = function(year, name){
      globalThis.__RS.push(year + '|' + name);
      return Promise.resolve({ matches: [
        { rid:'202001010203', dateRaw:'2020.01.01', none:false },
        { rid:'202609040311', dateRaw:'2026.09.12', none:false }
      ] });
    };
  `);
  const res2 = await run('arResolveOnline([{ venue:"阪神", rno:11, name:"チャレンジカップ", at:0, key:"v:阪神11" }], { year: 2026 })');
  eq('レース名検索を呼び出した', run('globalThis.__RS'), ['2026|チャレンジカップ']);
  eq('新しい日付の race_id を選んで取得した', run('globalThis.__FETCH'), ['202609040311']);
  eq('1レースぶん取得できた(2)', res2.done, 1);
}

/* ============================================================
   E) どのデータにも居ない馬 → 記事から新規登録できる
   ============================================================ */
async function sectionE(){
  console.log(' E. 該当データが無い馬を、記事の馬名＋競走馬IDで新規登録できる');
  const g = mkG(mkLS());
  const run = load(g, CORE);
  run('globalThis.__ART = ' + JSON.stringify(readFix('nk_news_comment_342561.html')) + ';');
  run(`
    state.race = { name:'2歳未勝利', place:'中山', dist:'1600', grade:'', baba:'良', time:'' };
    state.horses = [];
    arIdxReset(); arXrefReset();
    hbPreviewState = { date:'2026年9月12日', title:'t', url:'u', html:globalThis.__ART,
                       entries: arParseArticle(globalThis.__ART).entries,
                       races: arParseArticle(globalThis.__ART).races,
                       groups: arParseArticle(globalThis.__ART).groups };
  `);
  const rows = run('hbNewsToRows(hbPreviewState.entries)');
  eq('8頭ぶん行がある', rows.length, 8);
  eq('全部 🆕新規扱い', rows.filter(function(x){ return x.src === 'new'; }).length, 8);
  T('全部に割当値が付いている（＝登録できる）', rows.every(function(x){ return /^x\d+$/.test(x.val); }));
  T('競走馬IDが保持されている', run('arXrefList()').every(function(x){ return /^\d{10}$/.test(String(x.nk)); }),
    JSON.stringify(run('arXrefList()').map(function(x){ return x.nk; })));

  /* x<n> → 馬オブジェクト → 馬ノート新規作成 まで通る */
  const obj = run('hbHorseFromVal("' + rows[0].val + '")');
  T('hbHorseFromVal が x 参照を解決できる', !!obj && !!obj.h);
  eq('解決した馬名', obj && obj.h && obj.h.name, 'ジョバンニ');
  eq('解決した競走馬ID', obj && obj.h && String(obj.h.nk), '2022103995');

  run('globalThis.__ROWS = ' + JSON.stringify(rows) + ';');
  run(`
    hbAssignRows = globalThis.__ROWS;
    hbAssignCtx = { date:'2026年9月12日', label:'チャレンジＣ（netkeiba レース後コメント）', fromNews:true };
    // 割当表のDOMをスタブ（各行のセレクト＝自動割当値のまま、テキスト＝行の文言）
    globalThis.__SEL = {};
    document.querySelector = function(sel){
      var m = /data-hbsel="(\\d+)"/.exec(sel);
      if (m){ var i = +m[1]; return { value: hbAssignRows[i].val }; }
      var t = /data-hbtxt="(\\d+)"/.exec(sel);
      if (t){ var j = +t[1]; return { value: hbAssignRows[j].text }; }
      return null;
    };
    $('hbKindShort').checked = true; $('hbKindAdv').checked = false; $('hbKindMemo').checked = false;
    hbSaveAssign();
  `);
  const db = run('hbLoad()');
  eq('8頭ぶんの馬ノートが新規作成された', db.horses.length, 8);
  const e0 = db.horses.filter(function(e){ return String(e.nk) === '2022103995'; })[0];
  T('ジョバンニのノートがある', !!e0);
  eq('馬名が記録されている', e0 && e0.names[0], 'ジョバンニ');
  eq('短評が1件入っている', e0 && e0.notes.length, 1);
  eq('種別は short', e0 && e0.notes[0].kind, 'short');
  T('短評本文が入っている', e0 && /なかなか重賞に手が届いていませんでした/.test(e0.notes[0].text));
  T('★検出したレース名が短評に付記されている', e0 && /阪神11R チャレンジカップ\(GIII\)/.test(e0.notes[0].race), e0 && e0.notes[0].race);
  eq('記事の配信日が登録日になる', e0 && e0.notes[0].date, '2026年9月12日');

  /* 同じ記事を取り直しても二重登録されず、同じノートに追記される */
  run('hbAssignRows = globalThis.__ROWS; hbSaveAssign();');
  const db2 = run('hbLoad()');
  eq('馬ノートの頭数は増えない（競走馬IDで同一馬と判定）', db2.horses.length, 8);
  const e0b = db2.horses.filter(function(e){ return String(e.nk) === '2022103995'; })[0];
  eq('短評は2件に増える', e0b && e0b.notes.length, 2);

  /* 馬名が変わっても競走馬IDが同じなら同一馬として扱える */
  run(`
    hbNewNote({ name:'ジョバンニ改名後', nk:'2022103995' }, 'short', '改名後の短評', { date:'2027年1月1日', label:'テスト' });
  `);
  const db3 = run('hbLoad()');
  eq('改名しても頭数は増えない', db3.horses.length, 8);
  const e0c = db3.horses.filter(function(e){ return String(e.nk) === '2022103995'; })[0];
  T('旧名も新名も両方覚えている', e0c && e0c.names.indexOf('ジョバンニ') >= 0 && e0c.names.indexOf('ジョバンニ改名後') >= 0,
    e0c && JSON.stringify(e0c.names));
}

/* ============================================================
   F) p25 との接続（プレビュー → 割当表 → プルダウン）
   ============================================================ */
async function sectionF(){
  console.log(' F. プレビュー・割当表・プルダウンまで通しで動く');
  const g = mkG(mkLS());
  const run = load(g, CORE);
  run('globalThis.__ART = ' + JSON.stringify(readFix('nk_news_comment_multi.html')) + ';');
  run(`
    globalThis.__CARD = ${JSON.stringify(readFix('nk_shutuba_202609040311.html'))};
    nkCardSet('202609040311', globalThis.__CARD, '20260912');
    // 今開いている出馬表は「別レース」＝ 第22弾以前の挙動なら全滅するケース
    state.race = { name:'2歳未勝利', place:'中山', dist:'1600', grade:'', baba:'良', time:'' };
    state.horses = [ mkHorse({ no:'1', name:'アカノタニン', nk:'2020999999' }) ];
    arIdxReset(); arXrefReset();
    var p = arParseArticle(globalThis.__ART);
    hbPreviewState = { date:'2026年9月13日', title:p.title, url:'https://example.test/', html:globalThis.__ART,
                       entries:p.entries, races:p.races, groups:p.groups, year:2026 };
  `);
  run('hbRenderNewsPreview()');
  const head = run('$("hbNewsPrevHead").innerHTML');
  const body = run('$("hbNewsPrevBody").innerHTML');
  T('プレビュー見出しに「🏁 レース名の検出: 2件」が出る', /レース名の検出: <b>2<\/b> 件/.test(head), head.slice(0, 200));
  T('プレビュー見出しに race_id 判明件数が出る', /race_id 判明 2 件/.test(head));
  T('プレビュー見出しに検索範囲の内訳が出る', /検索範囲: 今の出馬表/.test(head));
  T('プレビュー本文にレースごとの見出しが出る', (body.match(/🏁 /g) || []).length >= 2, body.slice(0, 200));
  T('セントライト記念のグループが出る', /セントライト記念/.test(body));
  T('ローズステークスのグループが出る', /ローズステークス/.test(body));
  T('「2レースぶん」と明記される', /<b>2レースぶん<\/b>/.test(body));
  T('該当データが無い馬は🆕と表示される', /🆕 該当データなし/.test(body));

  /* 割当表へ投入 */
  run('hbUsePreview()');
  const assignHTML = run('$("hbAssignRows").innerHTML');
  const arows = run('hbAssignRows');
  eq('6頭ぶんが割当表に入る', arows.length, 6);
  eq('割当表にレース区切りの見出しが2つ出る', (assignHTML.match(/border-left:3px solid var\(--accent\)/g) || []).length, 2);
  T('区切り見出しにセントライト記念／ローズステークスが出る', /セントライト記念/.test(assignHTML) && /ローズステークス/.test(assignHTML));
  T('行ラベルにはレース名を繰り返さない（見出しと二重にならない）', !/hbassign[\s\S]{0,200}🏁/.test(assignHTML));
  T('参照元バッジが出る', /から自動割当|🆕 該当データなし/.test(assignHTML));
  const ri = run('$("hbRaceInfo").innerHTML');
  T('登録先レース情報に検出したレース名が出る', /セントライト記念/.test(ri) && /ローズステークス/.test(ri), ri);
  T('「現在のレース名と違っていても登録できます」と出る', /違っていても登録できます/.test(ri));

  /* プルダウンの選択肢に xref が出る */
  const opts = run('hbSelectOptions("ジョバンニ")');
  T('プルダウンに「📰 記事から参照した馬」グループが出る', /📰 記事から参照した馬/.test(opts), opts.slice(0, 200));
  T('今回の出走馬グループも残っている', /今回の出走馬/.test(opts));
  T('xref の value=x<n> が入っている', /value="x\d+"/.test(opts));

  /* プレビューの使い回し: 別レースを開き直しても正しく再照合される */
  run(`
    nkCardClear(); arIdxReset(); arXrefReset();
    state.horses = [ mkHorse({ no:'15', name:'ジョバンニ', nk:'2022103995', uid: 777 }) ];
  `);
  const rows5 = run('hbNewsToRows(hbPreviewState.entries)');
  const gj = rows5.filter(function(x){ return x.name === 'ミュージアムマイル'; })[0];
  T('キャッシュを消した後は該当データなしに戻る', gj && gj.src === 'new', gj && gj.src);
}

/* ============================================================
   G) 組み込み確認
   ============================================================ */
function sectionG(){
  console.log(' G. index.html / build.py への組み込み');
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ['function arDetectRaces','function arParseArticle','function arBuildIndex','function arResolveOnline',
   'function arXrefAdd','function arEntriesToRows','function arToText','function hbResolveMissingRaces'].forEach(function(f){
    T('index.html に ' + f + ' がある', idx.indexOf(f) >= 0);
  });
  T('race_id の構造コメントが入っている', /場コードは入っていません/.test(idx));
  T('&amp;id= にも対応している', /&amp;\|&\|\\\)id=|\(\?:&amp;\|&\|\?\\?\)id=/.test(idx) || idx.indexOf('(?:&amp;|&|\\?)id=') >= 0);
  T('xref の選択グループが入っている', /記事から参照した馬/.test(idx));
  ['arNetChk'].forEach(function(id){
    T('#' + id + ' がある', idx.indexOf('id="' + id + '"') >= 0);
  });
  T('レースごとの見出し（🏁）が割当表に出る', /🏁 ' \+/.test(idx) || idx.indexOf('🏁 ') >= 0);

  const order = fs.readFileSync(path.join(ROOT, 'build.py'), 'utf8');
  const pos = function(n){ return order.indexOf("'" + n + "'"); };
  T('build.py に p62_articleref', pos('p62_articleref') > 0);
  T('p62 は p25_horsebook より後（hb* を使う）', pos('p62_articleref') > pos('p25_horsebook'));
  T('p62 は p12_urlimport より後（nkCard*/nkParseShutuba を使う）', pos('p62_articleref') > pos('p12_urlimport'));
  T('p62 は p18_racesearch より後（rsSearch を使う）', pos('p62_articleref') > pos('p18_racesearch'));
  T('p62 は p30_learnrec より後（apScan を使う）', pos('p62_articleref') > pos('p30_learnrec'));
  T('p62 は p61_wtauto より後', pos('p62_articleref') > pos('p61_wtauto'));

  /* 既存の単一レース記事の挙動を壊していないこと（p25 のフォールバック経路） */
  const p25 = fs.readFileSync(path.join(ROOT, 'src/p25_horsebook.js'), 'utf8');
  T('arParseArticle が使えない時は hbParseCommentArticle にフォールバックする', /entries = hbParseCommentArticle\(html\); races = \[\]; groups = \[\];/.test(p25));
  T('hbNewsToRows にもフォールバックがある', /if \(typeof arEntriesToRows === 'function'\)/.test(p25));
  T('競走馬ID抽出が末尾スラッシュ/クエリ付きにも対応', /db\\\.netkeiba\\\.com\\\/horse\\\/\(\\d\{8,12\}\)/.test(fs.readFileSync(path.join(ROOT, 'src/p12_urlimport.js'), 'utf8')));
}

/* ============================================================
   H) 出馬表キャッシュの日付・レース名（race_idからは復元できないぶん）
   ============================================================ */
async function sectionH(){
  console.log(' H. 出馬表キャッシュに開催日とレース名を持たせる（TTL判定と表示用）');
  const g = mkG(mkLS());
  const run = load(g, CORE);
  run('globalThis.__CARD = ' + JSON.stringify(readFix('nk_shutuba_202609040311.html')) + ';');

  /* race_id の先頭8桁は日付ではない（YYYYMM+回）。ここを間違えると TTL 判定が壊れます。 */
  eq('ページ見出しから開催日を拾える', run('nkCardD8FromHtml(globalThis.__CARD)'), '20260912');
  eq('ページ見出しからレース名を拾える', run('nkCardNameFromHtml(globalThis.__CARD)'), 'チャレンジＣ(G3)');
  eq('race_id の先頭8桁は日付ではない', run('"202609040311".slice(0,8)'), '20260904');
  eq('race_id 下2桁がR番号', run('parseInt("202609040311".slice(10,12),10)'), 11);

  /* d8 を渡さずに保存しても、ページから拾った日付が入る → 過去レースなら7日TTLになる */
  run('nkCardClear(); nkCardSet("202609040311", globalThis.__CARD, nkCardD8FromHtml(globalThis.__CARD));');
  const it = run('nkCardLs().h["202609040311"]');
  eq('d8 が入る', it.d8, '20260912');
  eq('レース名が入る', it.name, 'チャレンジＣ(G3)');
  T('空 d8 で保存すると当日扱い(30分TTL)になるので、必ず拾ってから入れる',
    run('(function(){ nkCardClear(); nkCardSet("X1", globalThis.__CARD, ""); return nkCardLs().h["X1"].d8; })()') === '');

  /* 横断インデックスがキャッシュのレース名を出せる */
  run('nkCardClear(); nkCardSet("202609040311", globalThis.__CARD, "20260912"); arIdxReset();');
  const hit = run('arFind("ジョバンニ", "2022103995")');
  T('キャッシュから参照できる', !!hit && hit.src === 'card');
  eq('どのレースの出馬表か分かる', hit && hit.raceName, 'チャレンジＣ(G3)');
  eq('レースIDも分かる', hit && hit.raceId, '202609040311');

  /* 圧縮されて保存されている（40件で localStorage が溢れないため） */
  const sizes = run('(function(){ var o = nkCardLs(); var it = o.h["202609040311"]; return { raw: it.n, packed: String(it.s).length }; })()');
  T('出馬表は圧縮保存される（50%未満）', sizes.packed < sizes.raw * 0.5, JSON.stringify(sizes));
}

/* ============================================================
   I) 読み込み履歴の日付（race_id 先頭8桁を日付と誤読していた件）
   ============================================================ */
async function sectionI(){
  console.log(' I. 📋読み込み履歴に正しい開催日が出る（race_id先頭8桁は日付ではない）');
  const g = mkG(mkLS());
  const run = load(g, ['src/p00_fflate.js', 'src/p3_core.js', 'src/p4_parse.js',
                       'src/p12_urlimport.js', 'src/p26_kaisai.js']);

  /* race_id = 202609040311 は「2026年9月・4回・3日目・11R」＝実際の開催日は 2026/9/12 */
  eq('race_id 先頭8桁は開催日ではない', run('"202609040311".slice(0,8)'), '20260904');
  eq('実物の出馬表から拾える開催日', run('nkCardD8FromHtml(' + JSON.stringify(readFix('nk_shutuba_202609040311.html')) + ')'), '20260912');

  /* 何も確定していないときは「空」を返す（誤った日付を出すよりマシ） */
  run('state.raceDate8 = ""; state.race = {}; kai.cache = null; nkCardClear();');
  eq('手がかりが無ければ空を返す', run('kaiHistDate8("202609040311")'), '');

  /* ① 日付ピッカーで選んだ開催日が最優先 */
  run('kai.cache = { date: "20260912", venues: [] };');
  eq('日付ピッカーの値を優先', run('kaiHistDate8("202609040311")'), '20260912');

  /* ② nkSetRaceDate8 が確定した state.raceDate8 */
  run('kai.cache = null; state.raceDate8 = "20260912"; state.race = {};');
  eq('確定したレース日を使う', run('kaiHistDate8("202609040311")'), '20260912');

  /* ③ state.race.date（ページ見出し由来） */
  run('state.raceDate8 = ""; state.race = { date: "2026年9月12日" };');
  eq('state.race.date から復元', run('kaiHistDate8("202609040311")'), '20260912');

  /* ⑤ 出馬表キャッシュのページ見出し */
  run('state.race = {}; nkCardSet("202609040311", ' + JSON.stringify(readFix('nk_shutuba_202609040311.html')) + ', "");');
  eq('出馬表キャッシュの見出しから復元', run('kaiHistDate8("202609040311")'), '20260912');

  /* kaiAddHist が正しい日付で保存する */
  run(`
    nkCardClear();
    state.raceDate8 = '20260912';
    state.race = { name:'チャレンジＣ', place:'阪神', dist:'2000', grade:'G3', baba:'良', date:'2026年9月12日' };
    state.raceId = '202609040311';
    state.horses = [ mkHorse({ no:'15', name:'ジョバンニ', nk:'2022103995' }) ];
    kaiAddHist('202609040311');
  `);
  const h0 = run('kaiLs().hist[0]');
  eq('履歴に正しい開催日が入る', h0.date, '20260912');
  eq('表示ラベルも正しい曜日になる', run('kaiDateLabel(kaiLs().hist[0].date)'), '2026年9月12日(土)');
  T('誤表示（2026年9月4日）にならない', run('kaiDateLabel(kaiLs().hist[0].date)').indexOf('9月4日') < 0);

  /* 旧バージョンで保存された「誤った日付」の履歴を修復できる */
  run(`
    var ls = kaiLs();
    ls.hist = [
      { raceId:'202609040311', date:'20260904', place:'阪神', rnum:'11', name:'チャレンジＣ',
        race:{ name:'チャレンジＣ', place:'阪神', date:'2026年9月12日' }, horses:[] },   // ← 旧バグの値（race.date から復元できる）
      { raceId:'202609050411', date:'20260905', place:'中山', rnum:'11', name:'セントライト記念',
        race:{ name:'セントライト記念', place:'中山' }, horses:[] },                    // ← 復元できない → 空にする
      { raceId:'202609060412', date:'20260913', place:'中山', rnum:'12', name:'正しい日付',
        race:{ name:'正しい日付', place:'中山', date:'2026年9月13日' }, horses:[] }      // ← 正常なので触らない
    ];
    kaiLsSet(ls);
    globalThis.__CH = kaiFixHistDates(kaiLs());
  `);
  T('修復が必要と判定された', run('globalThis.__CH') === true);
  /* kaiLs() は毎回読み直すので、修復→書き戻し→読み直し の順で確認します */
  const fixed = run('(function(){ var ls = kaiLs(); kaiFixHistDates(ls); kaiLsSet(ls); return kaiLs().hist.map(function(h){ return h.date; }); })()');
  eq('修復後の日付（①正しい日付に復活／②復元できず空／③正常なのでそのまま）', fixed, ['20260912', '', '20260913']);
  /* 2回実行しても何も変わらない（冪等） */
  const fixed2 = run('(function(){ var ls = kaiLs(); var c = kaiFixHistDates(ls); kaiLsSet(ls); return { changed: c, dates: kaiLs().hist.map(function(h){ return h.date; }) }; })()');
  eq('2回目は「変更なし」になる', fixed2.changed, false);
  eq('2回目も日付は同じ', fixed2.dates, ['20260912', '', '20260913']);

  /* 一覧描画: 日付が空なら「( / 阪神11R)」のように崩さない */
  run('kaiRenderHist();');
  const html = run('$("kaiHist").innerHTML');
  T('正しい日付の行は 2026年9月12日(土) と出る', /2026年9月12日\(土\)/.test(html), html.slice(0, 300));
  T('日付が空の行は「日付なし / 場・R」だけ出る', /\(中山 11R\)/.test(html) || /\( \/ 中山/.test(html) === false);
  T('誤った 2026年9月4日 が出ない', html.indexOf('2026年9月4日') < 0);
}

(async function main(){
  try {
    await sectionA();
    await sectionB();
    await sectionC();
    await sectionD();
    await sectionE();
    await sectionF();
    sectionG();
    await sectionH();
    await sectionI();
  } catch(e){
    bad++;
    console.log('  ✗ ERROR: ' + ((e && e.stack) || e));
  }
  console.log('rework14: OK', ok, 'FAIL', bad);
  process.exit(bad ? 1 : 0);
})();
