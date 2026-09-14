/* トップレベルのグローバル名が衝突していないかの検査
   実行: node tests/globals.test.js

   なぜ必要か（2026-09-12 第17弾で実際に踏んだ事故）:
     build.py は src/*.js を 1 つの <script> に連結するので、全ファイルが
     **同じグローバル名前空間**を共有します。p52_histfeat.js が
       function clamp(lo, hi, x)
     を定義したところ、p3_core.js の
       function clamp(v, a, b)
     を上書きし（連結順で後ろが勝つ）、**引数の順序が違う**ため
     全ファイルの clamp が壊れました（paceOverride のスコアが undefined になる等）。
     1ファイルずつの構文チェック(node -e)では絶対に検出できないので、ここで検査します。

   検査内容:
     1) トップレベルの `function NAME` / `var NAME` が複数ファイルに重複していないこと
     2) 同一ファイル内での重複定義も検出
     3) 危険な「引数順が違う同名関数」の代表例 clamp について、定義が p3_core.js の1つだけであること
     4) build.py の SOURCES に挙がっているファイルが実在し、逆に src の .js が全て SOURCES に入っていること
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
let ok = 0, bad = 0;
function T(name, cond, extra){
  if (cond) { ok++; }
  else { bad++; console.log('  ✗ FAIL: ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

const files = fs.readdirSync(SRC).filter(function(f){ return /\.js$/.test(f); }).sort();
T('src に .js がある', files.length > 30, files.length);

const decl = {};          // name → [{file, line, kind}]
files.forEach(function(f){
  const s = fs.readFileSync(path.join(SRC, f), 'utf8');
  const lines = s.split('\n');
  lines.forEach(function(line, i){
    let m = /^function\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (m) { (decl[m[1]] = decl[m[1]] || []).push({ file: f, line: i + 1, kind: 'function' }); return; }
    m = /^var\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (m) { (decl[m[1]] = decl[m[1]] || []).push({ file: f, line: i + 1, kind: 'var' }); }
  });
});

console.log('globals: トップレベル名の衝突検査（連結ビルド用）');

const crossDup = [];
const selfDup = [];
Object.keys(decl).forEach(function(name){
  const list = decl[name];
  if (list.length < 2) return;
  const uniqFiles = {};
  list.forEach(function(x){ uniqFiles[x.file] = (uniqFiles[x.file] || 0) + 1; });
  const fileNames = Object.keys(uniqFiles);
  if (fileNames.length > 1) crossDup.push({ name: name, where: list });
  fileNames.forEach(function(fn){
    if (uniqFiles[fn] > 1) selfDup.push({ name: name, file: fn, count: uniqFiles[fn] });
  });
});

T('ファイル間で重複するトップレベル名が無い', crossDup.length === 0,
  crossDup.map(function(x){ return x.name + ' → ' + x.where.map(function(w){ return w.file + ':' + w.line; }).join(', '); }));
T('同一ファイル内の重複定義が無い', selfDup.length === 0, selfDup);

/* clamp は p3_core.js の clamp(v,a,b) 1つだけであること */
T('clamp の定義は1つだけ', (decl['clamp'] || []).length === 1, decl['clamp']);
T('clamp は p3_core.js で定義されている', (decl['clamp'] || [])[0] && decl['clamp'][0].file === 'p3_core.js', decl['clamp']);
const coreClamp = fs.readFileSync(path.join(SRC, 'p3_core.js'), 'utf8');
T('clamp の引数順は (v, a, b) のまま', /function clamp\(v,\s*a,\s*b\)/.test(coreClamp));

/* 引数順が違う同名関数を作りやすい名前（ユーティリティ系）は特に確認する */
['clamp', 'esc', 'num', 'normCol', 'clamp01', 'pfNameKey', 'hfNameKey'].forEach(function(n){
  const l = decl[n] || [];
  T('ユーティリティ名 ' + n + ' の定義は高々1つ', l.length <= 1, l.map(function(x){ return x.file + ':' + x.line; }));
});

/* build.py の SOURCES と src の一致 */
const b = fs.readFileSync(path.join(ROOT, 'build.py'), 'utf8');
const m = /ORDER\s*=\s*\[([\s\S]*?)\n\]/.exec(b);
T('build.py に ORDER(連結順リスト) がある', !!m);
if (m){
  // コメント行(# ...)を除いてから、ブロック内の 'name' を全部拾う（1行に複数並んでいるため）
  const body = m[1].split('\n').filter(function(line){ return !/^\s*#/.test(line); }).join('\n');
  const listed = [];
  let mm2;
  const re2 = /'([\w]+)'/g;
  while ((mm2 = re2.exec(body)) !== null) listed.push(mm2[1]);
  T('ORDER が空でない', listed.length > 30, listed.length);
  const missing = listed.filter(function(n){ return !fs.existsSync(path.join(SRC, n + '.js')); });
  T('ORDER の全ファイルが実在する', missing.length === 0, missing);
  const notListed = files.map(function(f){ return f.replace(/\.js$/, ''); })
    .filter(function(n){ return listed.indexOf(n) < 0; });
  T('src の .js が全て ORDER に入っている', notListed.length === 0, notListed);
  const dupInList = listed.filter(function(n, i){ return listed.indexOf(n) !== i; });
  T('ORDER に重複が無い', dupInList.length === 0, dupInList);
  // 第17弾で追加したものが确実に入っている
  ['p48_racedata', 'p49_jockeylay', 'p50_pacefit', 'p51_apdiag', 'p52_histfeat'].forEach(function(n){
    T('ORDER に ' + n + ' がある', listed.indexOf(n) >= 0);
  });
  // p52 は p30 より後に連結されてもよい（関数宣言は巻き上げられる）が、p3_core より後であること
  T('p3_core が p52 より前に連結される（clamp を先に定義するため）',
    listed.indexOf('p3_core') < listed.indexOf('p52_histfeat'),
    [listed.indexOf('p3_core'), listed.indexOf('p52_histfeat')]);
}

/* ビルド済み index.html にも重複が入っていないか（念のため） */
const idx = path.join(ROOT, 'index.html');
if (fs.existsSync(idx)){
  const html = fs.readFileSync(idx, 'utf8');
  const n = (html.match(/^function clamp\(/gm) || []).length;
  T('index.html 内の function clamp 定義は1つ', n === 1, n);
}

console.log('');
console.log((bad ? 'FAIL' : 'PASS') + ' globals: ok=' + ok + ' bad=' + bad);
process.exit(bad ? 1 : 0);
