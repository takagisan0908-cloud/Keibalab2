var SIMAGG_DROP_N = 0;   // ③を離れて消した集計のレース数
/* =========================================================
   メイン：タブ切替・モーダル・保存/読込・初期化
   ========================================================= */

/* ---------- モーダル ---------- */
function showModal(html, bind){
  var root = $('modalRoot'), body = $('modalBody');
  body.innerHTML = html;
  root.classList.remove('hidden');
  if (bind) bind(body);
  setTimeout(function(){ root.querySelector('.modalbox').focus && root.querySelector('.modalbox').focus(); }, 10);
}
function closeModal(){
  $('modalRoot').classList.add('hidden');
  $('modalBody').innerHTML = '';
}
function showConfirm(msg, onYes){
  showModal(
    '<h2>確認</h2><p>' + esc(msg) + '</p>' +
    '<div style="text-align:right;display:flex;gap:8px;justify-content:flex-end">' +
    '<button class="btn ghost" data-mno>キャンセル</button><button class="btn primary" data-myes>OK</button></div>',
    function(root){
      root.querySelector('[data-mno]').addEventListener('click', closeModal);
      root.querySelector('[data-myes]').addEventListener('click', function(){ closeModal(); onYes && onYes(); });
    }
  );
}

/* ---------- タブ ---------- */
var _curTab = 't-top';
function setNav(){
  document.querySelectorAll('nav.tabs .tab').forEach(function(b){
    b.classList.toggle('active', b.dataset.t === _curTab);
  });
  document.querySelectorAll('main .page').forEach(function(p){
    p.classList.toggle('active', p.id === _curTab);
  });
}
function goTab(id){
  // シミュを離れるとき走行中を止める
  if (sim && sim.running && id !== 't-sim'){
    sim.running = false;
    if (sim.raf) cancelAnimationFrame(sim.raf);
    $('btnRun').disabled = false; $('btnRerun').disabled = false;
  }
  /* 2026-09-11 第12弾: ③のタブを離れるとシミュレーションの合計集計は全部消す。
     集計はメモリだけで持つ方式に変えたので、端末の保存領域(localStorage)は一切使いません。
     → 学習DB・AI予想の学習データを第一優先で保存できるようになった。 */
  if (id !== 't-sim' && _curTab === 't-sim'){
    try { if (typeof simAggDropAll === 'function') SIMAGG_DROP_N = simAggDropAll(); } catch(e){}
  }
  _curTab = id;
  setNav();
  if (id === 't-kentai'){ renderKentaiFull(); if (typeof rnRefresh === 'function') rnRefresh(); try { if (typeof pfPaint === 'function') pfPaint(); } catch(e){}
    /* ★2026-09-13 第23弾①: ②予想タブを開くたびに最新の単勝オッズを取り直す。
       取れたときだけ nkOddsRefreshForView の中で AI印・軸/妙味/穴・買い目まで描き直します。
       定期ポーリングはしないので、タブを開いたとき以外に通信は発生しません。 */
    try { if (typeof nkOddsRefreshForView === 'function') nkOddsRefreshForView('②AI予想タブを開きました'); } catch(e){}
  }
  if (id === 't-sim'){
    buildSimPanel();
    try { if (typeof simAggEnter === 'function') simAggEnter(); } catch(e){}
    try {                                   // ③を離れて消えた分があれば知らせる
      if (typeof SIMAGG_DROP_N !== 'undefined' && SIMAGG_DROP_N){
        if (typeof simAggNoteDropped === 'function'){ window.SIMAGG_DROPPED = SIMAGG_DROP_N; simAggNoteDropped(); }
        SIMAGG_DROP_N = 0;
      }
    } catch(e){}
  }
  if (id === 't-horse' && typeof hbRefresh === 'function') hbRefresh();
  if (id === 't-input'){ if (typeof hbSyncInputBadges === 'function') hbSyncInputBadges(); if (typeof kaiHistRender === 'function') kaiHistRender(); if (typeof rkRender === 'function') rkRender();
    /* ★2026-09-13 第23弾⑤: 一括取得したレースの一覧を描き直す（出馬表キャッシュの有無もここで判定） */
    try { if (typeof preListRender === 'function') preListRender(); } catch(e){}
  }
  if (id === 't-jravideo' && typeof jvRefresh === 'function') jvRefresh();
  // ④天気予報タブ: 開いた時に「当日開催の競馬場名ボタン」をすぐ出す（保存済みの住所・開催を使う）
  /* ★2026-09-13 第25弾②: 🏇騎手・調教師DBタブを開いたら登録簿・キャッシュの状況を更新 */
  if (id === 't-jockeydb' && typeof jockeyDbOnShow === 'function'){ try { jockeyDbOnShow(); } catch(e){} }
  if (id === 't-tenki' && typeof tkRenderVenueBar === 'function'){
    try { tkRenderPcList(); } catch(e){}
    try { if (typeof tkOnTabOpen === 'function') tkOnTabOpen(); } catch(e){}
  }
  // ⑥重賞データ分析タブ: 旧④過去データ・旧⑧血統オカルトの表示もここで更新する
  if (id === 't-grade'){
    if (typeof histRefreshHeader === 'function') histRefreshHeader();
    if (typeof bfRender === 'function'){ try { bfRender(); } catch(e){} }
    if (typeof bfRenderToday === 'function'){ try { bfRenderToday(); } catch(e){} }
    if (typeof bfRenderDeep === 'function'){ try { bfRenderDeep(); bfRenderDeepHit(); } catch(e){} }
  }
  window.scrollTo({ top:0, behavior:'smooth' });
}
/* ---------- エクスポート/インポート ---------- */
function doExport(){
  var obj = {
    app:'keiba-lab', ver:1, saved: new Date().toISOString(),
    race: state.race, weights: state.weights, urlRelay: state.urlRelay || '',
    raceId: state.raceId || '', raceAt: state.raceAt || 0, biasRaces: state.biasRaces || [], biasTrash: state.biasTrash || [],
    learn: state.learn || null, paceOverride: (state.paceOverride == null ? null : state.paceOverride),
    biasOverride: state.biasOverride || '',
    horses: state.horses.map(function(h){
      return Object.assign({}, h);
    })
  };
  var blob = new Blob([JSON.stringify(obj, null, 1)], { type:'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  var d = new Date();
  var fn = 'keiba-' + d.getFullYear() + ('0'+(d.getMonth()+1)).slice(-2) + ('0'+d.getDate()).slice(-2) + '-' + ('0'+d.getHours()).slice(-2) + ('0'+d.getMinutes()).slice(-2) + '.json';
  a.download = fn;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 2000);
}
function doImport(file){
  var rd = new FileReader();
  rd.onload = function(){
    try {
      var o = JSON.parse(rd.result);
      if (!o || !Array.isArray(o.horses)) throw new Error('形式が不正です');
      state.race = Object.assign(defaultRace(), o.race || {});
      state.weights = Object.assign(defaultWeights(), o.weights || {});
      state.urlRelay = o.urlRelay || '';
      // 2026-09-11: Netlify は廃止（関数を削除）したため、保存済みの Netlify 中継URLは捨てる。
      // 残していると毎回「死んだURL」を先に試して⑥などの取得が遅くなる/失敗する。
      if (/netlify/i.test(state.urlRelay)){
        try { console.warn('[keiba-lab] 保存済みの中継URLが Netlify（廃止）だったため解除しました: ' + state.urlRelay); } catch(e2){}
        state.urlRelay = '';
      }
      state.raceId = o.raceId || '';
      state.raceAt = parseInt(o.raceAt, 10) || 0;
      state.biasRaces = Array.isArray(o.biasRaces) ? o.biasRaces : [];
      state.biasTrash = Array.isArray(o.biasTrash) ? o.biasTrash : [];
      state.learn = Object.assign(defaultLearn(), o.learn || {});
      state.paceOverride = (o.paceOverride == null) ? null : o.paceOverride;
      state.biasOverride = (o.biasOverride == null) ? '' : String(o.biasOverride);
      state.horses = o.horses.map(function(p){ return mkHorse(p); });
      var wb = $('weightSliders'); if (wb) wb.dataset.built = '';
      var rli = $('urlRelayInp'); if (rli) rli.value = state.urlRelay;
      syncRaceDomFromState(); refreshRaceLine();
      rebuildHorseTable();
      saveNow();
      goTab('t-input');
      showModal('<h2>✅ 読込完了</h2><p>' + state.horses.length + '頭のデータを復元しました。</p><button class="btn primary" data-mcl>閉じる</button>', function(root){
        root.querySelector('[data-mcl]').addEventListener('click', closeModal);
      });
    } catch(e){
      showModal('<h2>⚠ 読込エラー</h2><p>' + esc(e.message) + '</p><button class="btn primary" data-mcl>閉じる</button>', function(root){
        root.querySelector('[data-mcl]').addEventListener('click', closeModal);
      });
    }
  };
  rd.readAsText(file);
}

/* ---------- 初期化 ---------- */
function boot(){
  /* ★2026-09-13 第25弾②: 🏇騎手・調教師DBタブの配線 */
  try { if (typeof jockeyDbInit === 'function') jockeyDbInit(); } catch(e){}
  /* ★2026-09-13 第24弾・追加修正: 学習DB/学習実績のメモ化（第23弾⑥）は
     「同じタブ内の書き込み」しか検知できません（diLsSet/apLsSet… が内部で drop するため）。
     別のタブで④の取込やバックアップ復元をすると、こちらのタブのメモが古いまま残り、
     diLs() が「0件」を返し続けて ⏱タイム換算学習・📚学習DB過去実績・③回収率チューナー が
     まるでデータが無いように振る舞うことがあります（第23弾以前は毎回読み直していたので起きませんでした）。
     → ブラウザ標準の storage イベント（他タブの localStorage 書き込みで発火）でメモを破棄します。
        自分のタブの書き込みでは発火しないので、第23弾⑥の高速化（17〜22倍）はそのまま活きます。 */
  try {
    window.addEventListener('storage', function(ev){
      try {
        var k = (ev && ev.key) || '';
        // 学習DB(khl_di_*)・学習実績・旧形式の集約キー のときだけ破棄（無関係なキーで捨てない）
        /* 実在するキー（src/p32_dateimport.js・src/p30_learnrec.js で定義）:
             khl_di_*      … 学習DB（1レース1キー）        khl_date_v1 … 学習DB 旧集約キー
             khl_ap_*      … 学習実績の記録本体             khl_apm_*   … 年月ごとの学習集計
             khl_aplearn_v1… 学習実績 旧集約キー
           key が null（= clear() や容量超過での一括削除）のときも必ず破棄します。 */
        var hit = !k || k.indexOf('khl_di_') === 0 || k.indexOf('khl_ap_') === 0 ||
                  k.indexOf('khl_apm_') === 0 || k === 'khl_date_v1' || k === 'khl_aplearn_v1';
        if (!hit) return;
        if (typeof diLsDrop === 'function') diLsDrop();
        if (typeof apScanDrop === 'function') apScanDrop();
        if (typeof vtDropRCache === 'function') vtDropRCache();
      } catch(e){}
    });
  } catch(e){}
  /* 2026-09-11 第12弾: 📊シミュレーションの合計集計は「③のタブを開いている間だけのメモリ保持」に
     変更したので、旧バージョンが localStorage に残した khl_simagg_v1 を削除して保存領域を空ける。 */
  try {
    if (typeof simAggDropOld === 'function'){
      var _freed = simAggDropOld();
      if (_freed > 2048) setTimeout(function(){
        try {
          storeMsg('🧹 旧バージョンの<b>📊合計集計（' + (_freed / 1048576).toFixed(2) + 'MB）</b>を削除して保存領域を空けました。' +
            '合計集計は<b>③のタブを開いている間だけ</b>のメモリ保持に変わったので、端末の保存領域は使いません。' + storeText(), false);
        } catch(e){}
      }, 1200);
    }
  } catch(e){}
  // タブ
  document.querySelectorAll('nav.tabs .tab').forEach(function(b){
    b.addEventListener('click', function(){ goTab(b.dataset.t); });
  });
  document.querySelectorAll('[data-goto]').forEach(function(b){
    b.addEventListener('click', function(){ goTab(b.dataset.goto); });
  });
  // トップバー
  on('btnNew', 'click', function(){
    showConfirm('編集中の内容をクリアして新規レースにしますか？', function(){
      state.horses = [];
      state.race = defaultRace();
      state.weights = defaultWeights();
      state.learn = defaultLearn();
      state.paceOverride = null;
      state.biasOverride = '';
      syncRaceDomFromState(); refreshRaceLine(); rebuildHorseTable();
      var wb = $('weightSliders'); if (wb) wb.dataset.built = ''; // 次回スライダーを作り直す
      goTab('t-input');
    });
  });
  on('btnExport', 'click', doExport);
  on('btnImportB', 'click', function(){ $('fileImport').click(); });
  on('fileImport', 'change', function(e){
    if (e.target.files && e.target.files[0]) doImport(e.target.files[0]);
    e.target.value = '';
  });
  // モーダル背景クリックで閉じる
  on('modalRoot', 'click', function(e){ if (e.target.id === 'modalRoot') closeModal(); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeModal(); });

  safeInit('入力タブ', initInputTab);
  safeInit('取込', initImport);
  safeInit('initUrlImport', initUrlImport);
  if (typeof initRs === 'function') safeInit('initRs', initRs);
  if (typeof initMemo === 'function') safeInit('initMemo', initMemo);
  if (typeof initNk === 'function') initNk();   // netkeiba馬データ(旧jiro8廃止後)
  if (typeof initRn === 'function') safeInit('initRn', initRn);
  if (typeof initBias === 'function') safeInit('initBias', initBias);
  safeInit('initAnalysisTab', initAnalysisTab);
  safeInit('initSimTab', initSimTab);
  if (typeof initHist === 'function') safeInit('initHist', initHist);
  if (typeof initStyleAI === 'function') safeInit('initStyleAI', initStyleAI);
  if (typeof initUmasiru === 'function') safeInit('initUmasiru', initUmasiru);
  if (typeof initJra === 'function') safeInit('initJra', initJra);
  if (typeof initHorseBook === 'function') safeInit('initHorseBook', initHorseBook);
  if (typeof initKaisai === 'function') safeInit('initKaisai', initKaisai);
  if (typeof initJv === 'function') safeInit('initJv', initJv);
  if (typeof initAp === 'function') safeInit('initAp', initAp);
  if (typeof initPg === 'function') safeInit('initPg', initPg);
  if (typeof initBf === 'function') safeInit('initBf', initBf);
  if (typeof initDi === 'function') safeInit('initDi', initDi);
  if (typeof initRk === 'function') safeInit('initRk', initRk);
  if (typeof initHd === 'function') safeInit('initHd', initHd);
  if (typeof initBb === 'function') safeInit('initBb', initBb);
  if (typeof initYo === 'function') safeInit('initYo', initYo);
  if (typeof initAih === 'function') safeInit('initAih', initAih);
  if (typeof initDr === 'function') safeInit('initDr', initDr);
  if (typeof initBetCalc === 'function') safeInit('initBetCalc', initBetCalc);
  if (typeof initLive === 'function') safeInit('initLive', initLive);
  if (typeof initGc === 'function') safeInit('initGc', initGc);
  if (typeof initTenki === 'function') safeInit('initTenki', initTenki);
  if (typeof initTl === 'function') safeInit('initTl', initTl);   // 勝ちタイムのレベル(🎯/⚠️)
  if (typeof initPf === 'function') safeInit('initPf', initPf);   // ★第16弾: 展開学習(ペース適性×コーナー通過順バイアス)
  if (typeof apdInit === 'function') safeInit('apdInit', apdInit);   // ★第17弾・提案1: AI予想の診断(計測のみ)
  if (typeof initPre === 'function') safeInit('initPre', initPre);   // ★第17弾: 出走前の出馬表一括取得(事前予想の保存)
  if (typeof initPk === 'function') safeInit('initPk', initPk);   // ★第18弾: 軸・妙味・穴の一覧
  if (typeof initBt === 'function') safeInit('initBt', initBt);   // ★第18弾: バックテスト
  if (typeof initBp === 'function') safeInit('initBp', initBp);   // ★第18弾: 買い目提案(詳細版)
  if (typeof initPb === 'function') safeInit('initPb', initPb);   // ★第18弾: 前日の馬場→当日のバイアス想定
  if (typeof initVt === 'function') safeInit('initVt', initVt);   // ★第19弾②: 回収率チューナー（実測バックテスト）
  if (typeof amInit === 'function') safeInit('amInit', amInit);   // ★第20弾: 🤖自動マクロ（設定☑の復元＋未確定週の水曜自動削除）
  if (typeof wtInit === 'function') safeInit('wtInit', wtInit);   // ★第21弾⑤: 🎛重みの自動補正（☑復元・補正バー描画）
  if (typeof initOddsFresh === 'function') safeInit('initOddsFresh', initOddsFresh);   // ★第23弾①: ②予想タブの「今すぐ最新オッズ」
  if (typeof baInit === 'function') safeInit('baInit', baInit);   // ★第21弾④: 🌊トラックバイアスの自動取得（発走+12分ごとにチェック）＋水曜削除
  reportInitErrors();
  if (typeof initTheme === 'function') safeInit('initTheme', initTheme);
  if (typeof initNav === 'function') safeInit('initNav', initNav);

  // 保存データ復元
  var loaded = loadFromLS();
  syncRaceDomFromState(); refreshRaceLine(); rebuildHorseTable();
  var rl0 = $('urlRelayInp'); if (rl0) rl0.value = state.urlRelay || '';
  goTab('t-top');
  if (!loaded){
    var s = $('saveState'); if (s) s.textContent = '初回起動: トップの「データ入力」で出馬表を読み込むか「サンプル18頭を入れる」で試せます';
  }
}
boot();
