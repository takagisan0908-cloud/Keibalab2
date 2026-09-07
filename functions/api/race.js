functions/api/race.js
// Cloudflare Pages Functions: functions/api/race.js
// 「GitHub リポジトリ → Cloudflare Pages」連携で /api/race として自動デプロイされます
// 呼び出し例:
//   GET  /api/race?url=<URLエンコードしたURL>
//   POST /api/race?url=<...>&method=POST&body=cname%3Dpw01sli00%2FAF   (JRA POST中継)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*'
};
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

async function doFetch(u) {
  const target = (u.searchParams.get('url') || '').trim();
  if (!/^https?:\/\//i.test(target)) return new Response('bad url', { status: 400, headers: CORS });
  const method = (u.searchParams.get('method') || 'GET').toUpperCase();
  const body = u.searchParams.get('body') != null ? u.searchParams.get('body') : undefined;
  const hdrs = { 'User-Agent': UA, 'Accept': 'text/html,application/json,*/*' };
  const fopt = { redirect: 'follow', headers: hdrs };
  if (method !== 'GET'){ fopt.method = method; hdrs['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'; fopt.body = body || ''; }
  try {
    const r = await fetch(target, fopt);
    const buf = new Uint8Array(await r.arrayBuffer());
    const text = decodeBody(buf, target, r.headers.get ? r.headers.get('content-type') : '');
    const ctype = (r.headers.get('content-type') || 'text/html; charset=utf-8').split(';')[0] + '; charset=utf-8';
    return new Response(text, { status: r.ok ? 200 : 502, headers: Object.assign({}, CORS, { 'Content-Type': ctype, 'Cache-Control': 'no-store' }) });
  } catch (e) {
    return new Response('fetch error: ' + String(e && e.message || e), { status: 502, headers: CORS });
  }
}
export async function onRequestGet(context) {
  return doFetch(new URL(context.request.url));
}
export async function onRequestPost(context) {
  return doFetch(new URL(context.request.url));
}
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
