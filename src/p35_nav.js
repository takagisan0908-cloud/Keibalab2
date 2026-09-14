/* =========================================================
   35 ナビゲーションUI（トップページ＋左ドロワー目次）
   ---------------------------------------------------------
   - トップページ(t-top): 全タブを「目次カード」で表示し、
     押すと goTab() でそのページへ移動
   - ヘッダー左の「☰ 目次」ボタン → 左側からドロワーを開く
     （GitHub風）。ドロワーには トップページ＋各タブの一覧。
   - すべて既存の goTab(id) / setNav() に委譲するので、
     各タブの初期化・再描画ロジックには影響しません。
   ========================================================= */
var NAV_ITEMS = [
  { t:'t-input',    icon:'📥', name:'データ入力',            sub:'netkeiba URL取込・レース選択・出馬表・全馬データ', cur:true },
  { t:'t-kentai',   icon:'🧠', name:'展開予想・AI印',        sub:'ペース診断・AI印・買い目・トラックバイアス・自己学習' },
  { t:'t-sim',      icon:'🏇', name:'レースシミュレーター',  sub:'着順サンプル・📊合計集計（出遅れ率・脚質のブレを反映）' },
  { t:'t-horse',    icon:'📒', name:'馬ノート',              sub:'短評・有利不利・メモ（馬ごとのDB）' },
  { t:'t-jravideo', icon:'🎬', name:'JRA映像',               sub:'結果ページへの自動ナビ（直近約2ヶ月）' },
  { t:'t-grade',    icon:'📊', name:'重賞データ分析',          sub:'同名重賞 過去10年の傾向・馬券内共通点・過去データ・血統オカルト' },
  { t:'t-tenki',    icon:'☀️', name:'天気予報',                sub:'当日開催場の1時間ごと天気（気温・湿度・降水・風）' }
];
function navDrawerHTML(){
  var h = [];
  h.push('<button type="button" class="dnav dtop" data-goto="t-top"><span class="ico">🏠</span><span class="lab">トップページ<span class="sub">すべての機能の入口</span></span><span class="arrow">›</span></button>');
  NAV_ITEMS.forEach(function(it){
    var active = (typeof _curTab !== 'undefined' && _curTab === it.t);
    h.push('<button type="button" class="dnav' + (active ? ' cur' : '') + '" data-goto="' + it.t + '">' +
      '<span class="ico">' + it.icon + '</span>' +
      '<span class="lab">' + esc(it.name) + (it.sub ? '<span class="sub">' + esc(it.sub) + '</span>' : '') + '</span>' +
      '<span class="arrow">›</span></button>');
  });
  return h.join('');
}
function navHomeHTML(){
  return NAV_ITEMS.map(function(it){
    return '<button type="button" class="hm-tile" data-goto="' + it.t + '">' +
      '<span class="hrow"><span class="ico">' + it.icon + '</span><b>' + esc(it.name) + '</b><span class="arrow">›</span></span>' +
      (it.sub ? '<span class="sub">' + esc(it.sub) + '</span>' : '') + '</button>';
  }).join('');
}
function navRender(){
  var d = $('drawerList'); if (d) d.innerHTML = navDrawerHTML();
  var h = $('homeMenu'); if (h) h.innerHTML = navHomeHTML();
}
function navOpen(){
  var dr = $('drawer'), bk = $('drawerBack');
  if (dr) dr.classList.add('open');
  if (bk) bk.classList.add('show');
  try { document.body.style.overflow = 'hidden'; } catch(e){}
}
function navClose(){
  var dr = $('drawer'), bk = $('drawerBack');
  if (dr) dr.classList.remove('open');
  if (bk) bk.classList.remove('show');
  try { document.body.style.overflow = ''; } catch(e){}
}
function initNav(){
  navRender();
  // ハンバーガー → 開く
  var nb = $('navBtn');
  if (nb) nb.addEventListener('click', function(){ navOpen(); });
  // 閉じる（✕ / 背景 / Esc）
  var cx = $('drawerClose'); if (cx) cx.addEventListener('click', navClose);
  var bk = $('drawerBack'); if (bk) bk.addEventListener('click', navClose);
  document.addEventListener('keydown', function(e){ if (e && e.key === 'Escape') navClose(); });
  // ドロワー内の「data-goto」で移動して閉じる
  var dl = $('drawerList');
  if (dl) dl.addEventListener('click', function(e){
    var b = (e.target && e.target.closest) ? e.target.closest('[data-goto]') : null;
    if (!b || typeof goTab !== 'function') return;
    goTab(b.getAttribute('data-goto'));
    navClose();
  });
  // トップページの目次カード（homeMenu）も同様に移動
  var hm = $('homeMenu');
  if (hm) hm.addEventListener('click', function(e){
    var b = (e.target && e.target.closest) ? e.target.closest('[data-goto]') : null;
    if (!b || typeof goTab !== 'function') return;
    goTab(b.getAttribute('data-goto'));
  });
}

/* =========================================================
   テーマ切替（2026-09-11追加）
   - 既定＝Spotify風ダーク（html に data-theme を付けない）
   - html[data-theme="light"] で従来のライトテーマ
   - 選択は localStorage に記憶（端末ごと）
   ========================================================= */
var THEME_KEY = 'khl_theme_v1';
function themeGet(){
  try { return (localStorage.getItem(THEME_KEY) === 'light') ? 'light' : 'dark'; }
  catch(e){ return 'dark'; }
}
function themeApply(mode){
  var m = (mode === 'light') ? 'light' : 'dark';
  try {
    document.documentElement.setAttribute('data-theme', m);
    safeSetItem(THEME_KEY, m);   /* 🎨テーマ設定 */
  } catch(e){}
  var b = $('btnTheme');
  if (b){
    b.textContent = (m === 'light') ? '🌙 ダークにする' : '☀️ ライトにする';
    b.title = 'いまは' + (m === 'light' ? 'ライト' : 'ダーク') + 'テーマです（クリックで切替・記憶されます）';
  }
  var tc = document.querySelector && document.querySelector('meta[name="theme-color"]');
  if (tc) tc.setAttribute('content', m === 'light' ? '#0b3a2a' : '#121212');
}
function themeToggle(){ themeApply(themeGet() === 'dark' ? 'light' : 'dark'); }
function initTheme(){
  themeApply(themeGet());
  var b = $('btnTheme');
  if (b) b.addEventListener('click', function(e){ e.preventDefault(); themeToggle(); });
}
