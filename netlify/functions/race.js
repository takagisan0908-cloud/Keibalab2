// Netlify Function: netkeiba等の静的HTMLをサーバー側で取得する小さな中継
// 配置先: netlify/functions/race.js のままフォルダごと Netlify Drop へドラッグ&ドロップ
// 呼び出し: /.netlify/functions/race?url=<エンコードしたURL>
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
function decodeBody(buf, url, ctype){
  let enc = '';
  if (/jra\.go\.jp/.test(url)) enc = 'shift_jis';
  else if (/jiro8\.sakura\.ne\.jp/.test(url)) enc = 'shift_jis';
  else if (/db\.netkeiba\.com/.test(url) && !/ajax_|output=json|api_|\.json/i.test(url)) enc = 'euc-jp';
  if (!enc){
    const c = String(ctype || '').match(/charset\s*=\s*["']?([\w-]+)/i);
    if (c) enc = c[1];
  }
  if (!enc) enc = 'utf-8';
  try { return new TextDecoder(enc).decode(buf); }
  catch(e){ return new TextDecoder('utf-8').decode(buf); }
}
exports.handler = async (event) => {
  const q = (event.queryStringParameters || {});
  const target = (q.url || '').trim();
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': '*'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (!/^https?:\/\//i.test(target)) return { statusCode: 400, headers: cors, body: 'bad url' };
  const method = (q.method || 'GET').toUpperCase();
  const body = q.body != null ? q.body : undefined;
  try {
    const hdrs = { 'User-Agent': UA, 'Accept': 'text/html,application/json,*/*' };
    const fopt = { redirect: 'follow', headers: hdrs };
    if (method !== 'GET'){ fopt.method = method; hdrs['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'; fopt.body = body || ''; }
    const r = await fetch(target, fopt);
    if (!r.ok) return { statusCode: 502, headers: cors, body: 'upstream HTTP ' + r.status };
    const buf = new Uint8Array(await r.arrayBuffer());
    const text = decodeBody(buf, target, r.headers.get && r.headers.get('content-type'));
    return {
      statusCode: 200,
      headers: Object.assign(cors, {
        'Content-Type': (r.headers.get('content-type') || 'text/html; charset=utf-8').split(';')[0] + '; charset=utf-8',
        'Cache-Control': 'no-store'
      }),
      body: text
    };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: 'fetch error: ' + String(e && e.message || e) };
  }
};
