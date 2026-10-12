import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ORIGIN = 'https://vid.best';
const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif','image/svg+xml','image/bmp']);
const decode = value => value.replace(/&amp;/g, '&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");

export function thumbnailEntries(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsafe sitemap XML');
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(match => {
    const page = decode(match[1].match(/<loc>([^<]+)<\/loc>/)?.[1] || '');
    const thumbnail = decode(match[1].match(/<video:thumbnail_loc>([^<]+)<\/video:thumbnail_loc>/)?.[1] || '');
    return {page, thumbnail};
  }).filter(row => /^https:\/\/vid\.best\/watch\/[a-z0-9-]+$/.test(row.page));
}

function allowedImage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'vid.best' || url.hostname === 'i.ytimg.com' ||
       /(^|\.)(fbcdn\.net|tiktokcdn(?:-[a-z0-9-]+)?\.com|muscdn\.com)$/.test(url.hostname));
  } catch { return false; }
}

export async function probeThumbnail(row, fetcher = fetch) {
  const result = {page:row.page, status:'missing'};
  if (!row.thumbnail) return result;
  try { result.host = new URL(row.thumbnail).hostname; } catch {}
  if (!allowedImage(row.thumbnail)) return {...result, status:'invalid_image_url'};
  let response;
  try {
    response = await fetcher(row.thumbnail, {redirect:'manual', signal:AbortSignal.timeout(12000),
      headers:{'User-Agent':'VidBest-SEO-Audit/1.0 (owner thumbnail monitoring)', Accept:'image/*'}});
    result.httpStatus = response.status;
    result.contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!response.ok || !TYPES.has(result.contentType)) {
      await response.body?.cancel();
      return {...result, status:response.ok ? 'non_image' : 'http_error'};
    }
    if (Number(response.headers.get('content-length')) > MAX_BYTES || !response.body) {
      await response.body?.cancel();
      return {...result, status:'invalid_size'};
    }
    const reader = response.body.getReader();
    let size = 0;
    try {
      for (;;) {
        const {value,done} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); return {...result,status:'invalid_size'}; }
      }
    } finally { reader.releaseLock(); }
    return {...result, bytes:size, status:size ? 'ok' : 'empty'};
  } catch {
    await response?.body?.cancel().catch(() => {});
    // Fetch errors can contain signed source URLs. Never persist their text.
    return {...result, status:'unverified_network'};
  }
}

async function readXml(path) {
  const response = await fetch(ORIGIN + path, {redirect:'manual',signal:AbortSignal.timeout(20000),headers:{'User-Agent':'VidBest-SEO-Audit/1.0'}});
  if (!response.ok) throw new Error(`Sitemap unavailable: HTTP ${response.status}`);
  const xml = await response.text();
  if (xml.length > MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Invalid sitemap');
  return xml;
}

async function main() {
  const index = await readXml('/sitemap.xml');
  const paths = [...index.matchAll(/<loc>https:\/\/vid\.best(\/sitemaps\/videos-\d+\.xml)<\/loc>/g)].map(x=>x[1]);
  if (!paths.length || paths.length > 10) throw new Error('Unexpected sitemap count');
  const entries = [];
  for (const path of paths) entries.push(...thumbnailEntries(await readXml(path)));
  if (entries.length > 1000) throw new Error('Thumbnail audit limit exceeded');
  const results = [];
  for (let i=0;i<entries.length;i+=4) results.push(...await Promise.all(entries.slice(i,i+4).map(row=>probeThumbnail(row))));
  const counts = results.reduce((out,row)=>(out[row.status]=(out[row.status]||0)+1,out),{});
  await writeFile('thumbnail-audit-report.json',JSON.stringify({generatedAt:new Date().toISOString(),productionWrites:'none',counts,results},null,2)+'\n');
  const summary = `Published thumbnail checks: ${results.length}\nImage HTTP checks: ${JSON.stringify(counts)}\nSource URLs and credentials: omitted. HTTP image availability does not prove Google indexing or visual relevance.\n`;
  await writeFile('thumbnail-audit-summary.txt',summary);
  console.log(summary);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(()=>{console.error('Thumbnail audit could not complete; no credential or URL details logged.');process.exitCode=1;});
