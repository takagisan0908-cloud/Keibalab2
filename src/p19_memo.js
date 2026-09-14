/* =========================================================
   19 展開メモ・次走サポート（直近の重賞から）
   「次のレースに該当馬がいる時」に、その馬の直近の重賞レース
   （netkeiba の過去成績: コーナー通過順・着順・人気など）から
   展開の利/不利を自動推定し、今回の展開予想(ペース診断)と
   照合した「追加メモ」を馬ごとに表示します。

   ※ JRA公式YouTubeの動画そのものを解析する事はできないため、
      動画で裏取りするための「▶YouTubeで確認」リンクを併記。
      メモ文言は コーナー通過順＋着順 からの自動推定です。
   ========================================================= */
var MEMO_LS = 'khl_memo_v1';

function mmLs(){ try { return JSON.parse(localStorage.getItem(MEMO_LS) || '{}'); } catch(e){ return {}; } }
function mmLsSet(o){ try { safeSetItem(MEMO_LS, JSON.stringify(o))   /* 📌メモ */; } catch(e){} }
function mmEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); }
function mmLog(msg){
  var el = $('memoLog'); if (!el) return;
  el.innerHTML += (el.innerHTML ? '<br>' : '') + '・' + mmEsc(msg);
}

/* 重賞判定（(GI)〜(GIII) / (G1)〜(G3) 表記） */
function mmGrade(name){
  var m = String(name).match(/\((G|J-G?\s?)(I{1,3}|1|II|2|III|3)\)/i);
  if (!m) return '';
  var body = String(m[0]).toUpperCase().replace(/[()]/g, '');
  return body.replace(/\s/g, '');
}

/* 通過順 → 4角位置 */
function mmPos4(passing){
  var vals = String(passing || '').split(/[\-–—～~／\/・、]/).map(function(x){ return parseInt(x, 10); }).filter(function(x){ return !isNaN(x); });
  return vals.length ? vals[vals.length - 1] : null;
}

/* 1走分の展開メモ文を自動生成 */
function mmRunMemo(r){
  var out = {
    date: r.date || '', name: r.raceName || '', grade: mmGrade(r.raceName),
    heads: parseInt(r.heads, 10) || 0, no: r.no || '', order: r.order || 0,
    pop: r.pop || '', dist: r.dist || '', baba: r.baba || '',
    passing: r.passing || '', last3: r.last3 || '', pos4: null, style: '', phrase: '', kind: 'ok'
  };
  var n = out.heads;
  var pos4 = mmPos4(r.passing);
  out.pos4 = pos4;
  if (!pos4 || !n || n < 3 || !r.order){ out.phrase = '（通過順データなし）'; out.kind = 'na'; return out; }
  var st = (typeof histStyle === 'function') ? histStyle(r.passing, n) : { tag: '' };
  out.style = st.tag || '';
  var r4 = (pos4 - 1) / (n - 1);
  var gained = pos4 - r.order;           // +: 直線で抜いた / -: 直線で後退
  var deep = r.order > Math.max(4, Math.ceil(n * 0.55));
  var popTxt = out.pop ? '（人気' + out.pop + '番）' : '';
  var base = '4角' + pos4 + '番手→' + r.order + '着' + popTxt;
  var ph = '', kind = 'ok';
  if (r.order === 1){
    if (pos4 === 1) ph = 'ハナを切ってそのまま押し切り勝ち。';
    else if (r4 <= 0.2) ph = '好位追走から直線で抜け出して勝ち。';
    else ph = '後方待機から一気の差し切り。展開が完全に向いた。';
    kind = 'win';
  } else if (r.order <= 3){
    if (gained >= 3) ph = '後方から強襲して馬券内（差し・追込が届く流れ）。';
    else if (gained >= 1) ph = '直線で着順を上げて馬券内。';
    else if (pos4 <= 2) ph = '先団で運んで粘り込み馬券内。';
    else ph = '中団から押し上げて馬券内。';
    kind = 'good';
  } else {
    if (pos4 <= 2 && gained <= -3 && n >= 8){
      ph = '先頭/2番手で粘るも直線で失速（前が崩れる展開で不利）。'; kind = 'bad';
    } else if (gained <= -3){
      ph = '直線で後退（追走に苦労/外を回されるなど展開不利の可能性）。'; kind = 'bad';
    } else if (gained >= 2){
      ph = '後方から順位を上げるもここまで（展開は利したが決め手不足）。'; kind = 'ok';
    } else if (r4 >= 0.6){
      ph = deep ? '後方のまま伸び切れず（展開に乗れず）。' : '後方待機も直線の伸びが今ひとつ。';
      kind = 'bad';
    } else {
      ph = '中団で直線勝負も際立たず（展開が向かなかった可能性）。'; kind = 'bad';
    }
  }
  out.phrase = ph; out.kind = kind;
  return out;
}

/* 馬の過去成績(重賞のみ・新しい順)からメモ列を作る */
function mmMemoList(parsed){
  var races = (parsed && parsed.races) ? parsed.races : [];
  var grads = races.filter(function(r){ return mmGrade(r.raceName); });
  return grads.slice(0, 6).map(function(r){
    var m = mmRunMemo(r);
    m.grade = mmGrade(r.raceName);
    m.name = String(r.raceName).replace(/[（(]\s*(?:J[\s・\-]?)?G[IVX1-3]+[）)]\s*$/i, '').trim();
    m.raw = m.pos4 ? ('4角' + m.pos4 + '番手→' + (m.order ? m.order + '着' : '途中棄権/取消')) : '';
    return m;
  });
}

/* 今回の展開予想との照合コメント */
function mmRelate(pace, styleTag){
  if (!pace || pace.score == null) return '';
  var s = pace.score, lab = pace.label || '';
  if (!styleTag || styleTag === '不明' || styleTag === '') return '今回の展開予想: <b>' + mmEsc(lab) + '</b>。';
  if (s >= 0.62){
    if (styleTag === '差し' || styleTag === '追込')
      return '今回の展開予想: <b>' + mmEsc(lab) + '</b>想定 → 差し・追込に分があり、過去の「差して届かない」不利は解消方向。直線勝負なら台頭に注意。';
    return '今回の展開予想: <b>' + mmEsc(lab) + '</b>想定 → 先行勢は厳しい流れ。過去に前で潰された経緯があれば今回も要注意。';
  }
  if (s <= 0.44){
    if (styleTag === '逃げ' || styleTag === '先行')
      return '今回の展開予想: <b>' + mmEsc(lab) + '</b>想定 → 前残りの展開なら先行・好位のこの馬に展開が向きやすい。';
    return '今回の展開予想: <b>' + mmEsc(lab) + '</b>想定 → 差し・追込には分が悪い。過去の「前が止まらず届かない」ケースが再現されやすい。';
  }
  return '今回の展開予想: <b>' + mmEsc(lab) + '</b>想定 → 平均的な流れなら脚質通りの運びが期待される。';
}

/* 馬1頭分の表示行（HTML） */
function mmHorseRow(h, memoList, relate){
  var name = (h.name ? h.name : '馬名不明') + (h.no ? '' : '');
  var no = h.no ? h.no + '' : '?';
  var lines;
  if (!h.nk){
    lines = '<span class="small muted">競走馬IDが無いため過去成績を取得できません（出馬表を「URL取込」で入れると対象になります）</span>';
  } else if (!memoList || !memoList.length){
    lines = '<span class="small muted">直近に重賞出走がありません（または未取得）</span>';
  } else {
    lines = memoList.slice(0, 4).map(function(m){
      var icon = m.kind === 'bad' ? '⚠️' : (m.kind === 'win' ? '🏆' : (m.kind === 'good' ? '◯' : '・'));
      var tag = m.style && m.style !== '不明' ? ' [' + mmEsc(m.style) + ']' : '';
      var yt = m.date && m.name
        ? ' <a href="https://www.youtube.com/results?search_query=' + encodeURIComponent('JRA ' + m.name + ' ' + m.date) + '" target="_blank" rel="noopener" style="color:var(--info-ink);font-size:.85em">▶YouTube</a>'
        : '';
      var dist = (m.dist ? m.dist + '・' : '') + (m.baba ? m.baba : '');
      return '<div class="small" style="margin:3px 0">' + icon + ' <b>' + mmEsc(m.date) + '</b> ' +
        mmEsc(m.name) + (m.grade ? ' <span style="color:var(--mut)">' + mmEsc(m.grade) + '</span>' : '') +
        (dist ? ' <span style="color:var(--mut)">' + mmEsc(dist) + '</span>' : '') + tag + '<br>' +
        '　' + (m.raw ? '<b>' + mmEsc(m.raw) + '</b> ' : '') + mmEsc(m.phrase) + yt + '</div>';
    }).join('');
  }
  return '<tr><td style="white-space:nowrap"><b>' + no + '</b> ' + mmEsc(h.name || '') + '</td>' +
    '<td>' + lines + '</td><td class="small">' + relate + '</td></tr>';
}

/* 全馬分の実行 */
function mmRunAll(){
  var info = $('memoInfo'), log = $('memoLog'), out = $('memoOut');
  var horses = (state.horses || []).filter(function(h){ return h.no && (h.name || h.odds); });
  if (!horses.length){
    if (info) info.textContent = '出馬表がありません。先に①で出馬表を入力してください。';
    return;
  }
  var withNk = horses.filter(function(h){ return h.nk; }).length;
  if (info) info.innerHTML = '対象 ' + horses.length + '頭（うち過去成績を取得できる馬 ' + withNk + '頭）。出馬表はURL取込推奨。';
  if (log) log.innerHTML = '';
  var pace = null;
  try { pace = (typeof paceAnalysis === 'function' && typeof readRaceMeta === 'function') ? paceAnalysis(horses, readRaceMeta()) : null; } catch(e){}
  if (out) out.innerHTML = '<div style="color:var(--mut)" class="small">取得中…（1頭ごとに数秒かかります）</div>';

  var idx = 0;
  function next(){
    if (idx >= horses.length){
      finish(); return;
    }
    var h = horses[idx++];
    if (!h.nk){
      rows.push({ h: h, memo: null });
      mmLog(h.no + ' ' + (h.name || '') + ' … 馬IDなし');
      next(); return;
    }
    var lsKey = 'm:' + h.nk;
    var cached = mmLs()[lsKey];
    var p;
    if (cached) p = Promise.resolve(cached);
    else {
      mmLog(h.no + ' ' + (h.name || '') + ' … 過去成績を取得中');
      if (typeof stFetchHtml !== 'function'){ p = Promise.reject(new Error('取得関数なし')); }
      else p = stFetchHtml('https://db.netkeiba.com/horse/ajax_horse_results.html?id=' + h.nk).then(function(html){
        if (typeof stParseHorseResults !== 'function') throw new Error('解析関数なし');
        var pr = stParseHorseResults(html);
        var o = mmLs(); o[lsKey] = pr; mmLsSet(o);
        return pr;
      });
    }
    p.then(function(pr){
      rows.push({ h: h, memo: mmMemoList(pr) });
      next();
    }).catch(function(err){
      rows.push({ h: h, memo: null });
      mmLog(h.no + ' ' + (h.name || '') + ' … 取得失敗（' + (err && err.message ? err.message : err) + '）');
      next();
    });
  }
  var rows = [];
  function finish(){
    var head = '<table><thead><tr><th style="width:120px">馬番 馬名</th><th>直近の重賞での展開メモ（自動推定）</th><th>今回の展開予想と照合</th></tr></thead><tbody>';
    var body = rows.map(function(r){
      var rel = '';
      if (r.h.style) rel = mmRelate(pace, String(r.h.style).trim());
      else rel = '<span class="small muted">脚質が未入力（🩺脚質AI or 手入力で反映すると照合文が出ます）</span>';
      return mmHorseRow(r.h, r.memo, rel);
    }).join('');
    var tail = '</tbody></table>';
    out.innerHTML = '<div class="tblwrap">' + head + body + tail + '</div>';
    var foot = '<div class="small muted" style="margin-top:6px">' +
      '※ 展開メモは 各レースの「4角通過位置→着順」の関係から自動推定したもので、実際の不利（出遅れ・斜行など）は映像で確認が必要です。' +
      'JRA公式YouTubeに重賞レース映像が上がっていますので、各行の <b>▶YouTube</b> でそのレースを検索して裏取りできます。' +
      '（映像内の音声・字幕の自動解析には対応していません）</div>';
    if (out) out.innerHTML += foot;
    if (info) info.textContent = '自動生成が完了しました。';
  }
  next();
}

function initMemo(){
  if (typeof on === 'function') on('btnMemoRun', 'click', mmRunAll);
}
