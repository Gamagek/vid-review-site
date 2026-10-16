import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const ORIGIN = 'https://vid.best';
const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif','image/svg+xml','image/bmp']);
const SIGNATURE_TYPES = {jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',avif:'image/avif',svg:'image/svg+xml',bmp:'image/bmp'};
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

// Bounded header recognition, not an image decoder, SVG safety validator or visual/rights check.
// Use only bytes from the existing request; never execute SVG or fetch related resources.
function imageSignature(bytes) {
  const starts = values => values.every((value,index) => bytes[index] === value);
  const ascii = (start,end) => String.fromCharCode(...bytes.subarray(start,end));
  if (bytes.length >= 3 && starts([255,216,255])) return 'jpeg';
  if (bytes.length >= 8 && starts([137,80,78,71,13,10,26,10])) return 'png';
  if (bytes.length >= 12 && ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP') return 'webp';
  if (bytes.length >= 6 && ['GIF87a','GIF89a'].includes(ascii(0,6))) return 'gif';
  if (bytes.length >= 2 && ascii(0,2) === 'BM') return 'bmp';
  if (bytes.length >= 16 && ascii(4,8) === 'ftyp') {
    const brands = [ascii(8,12)];
    for (let index=16; index+4<=Math.min(bytes.length,64); index+=4) brands.push(ascii(index,index+4));
    if (brands.some(brand => brand === 'avif' || brand === 'avis')) return 'avif';
  }
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/,'');
  if (/^\s*(?:<\?xml\s[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:[\s/>])/i.test(text)) return 'svg';
  return 'unrecognized';
}

async function boundedBody(response) {
  if (!response.body || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Invalid size');
  const reader = response.body.getReader();const parts=[];let size=0;
  try { for (;;) { const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>MAX_BYTES){await reader.cancel();throw new Error('Invalid size');}parts.push(value); }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return bytes;
}

async function watchThumbnail(row, fetcher) {
  if (!/^https:\/\/vid\.best\/watch\/[a-z0-9-]+$/.test(row.page)) return {page:'outside_canonical_public_review_routes',status:'invalid_watch_url'};
  let response;
  try {
    response=await fetcher(row.page,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{'User-Agent':'VidBest-SEO-Audit/1.0',Accept:'text/html'}});
    if(!response.ok||!/^text\/html\b/i.test(response.headers.get('content-type')||'')){
      await response.body?.cancel();return {page:row.page,status:'watch_metadata_unverified',httpStatus:response.status};
    }
    const html=new TextDecoder().decode(await boundedBody(response));
    for(const tag of html.match(/<meta\b[^>]{0,4096}>/gi)||[]){
      const attrs={};for(const match of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(["'])(.*?)\2/g))attrs[match[1].toLowerCase()]=decode(match[3]);
      if((attrs.property||attrs.name||'').toLowerCase()!=='og:image'||!attrs.content)continue;
      const url=new URL(attrs.content,row.page);
      if(url.pathname==='/favicon.svg')continue;
      const result=await probeThumbnail({...row,thumbnail:url.href},fetcher);
      return {...result,metadataSource:'watch_open_graph'};
    }
    return {page:row.page,status:'missing',metadataSource:'watch_open_graph'};
  } catch { await response?.body?.cancel().catch(()=>{});return {page:row.page,status:'watch_metadata_unverified'}; }
}

export async function probeThumbnail(row, fetcher = fetch) {
  const result = {page:row.page, status:'missing'};
  if (!row.thumbnail) return watchThumbnail(row,fetcher);
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
      const failed={...result,status:response.ok?'non_image':'http_error'};
      const imageUrl=new URL(row.thumbnail);
      if(response.status===404&&imageUrl.hostname==='i.ytimg.com'&&/^\/vi\/[a-zA-Z0-9_-]{11}\/hq[123]\.jpg$/.test(imageUrl.pathname)&&!imageUrl.search){
        const candidate=new URL('hqdefault.jpg',imageUrl).href;
        failed.fallback={variant:'same_video_hqdefault',...await probeThumbnail({...row,thumbnail:candidate},fetcher)};
      }
      return failed;
    }
    if (Number(response.headers.get('content-length')) > MAX_BYTES || !response.body) {
      await response.body?.cancel();
      return {...result, status:'invalid_size'};
    }
    const reader = response.body.getReader();
    let size = 0;
    const hash = createHash('sha256');
    const prefix = new Uint8Array(4096);
    let prefixSize = 0;
    try {
      for (;;) {
        const {value,done} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); return {...result,status:'invalid_size'}; }
        hash.update(value);
        const head = value.subarray(0,prefix.length-prefixSize);
        prefix.set(head,prefixSize);
        prefixSize += head.byteLength;
      }
    } finally { reader.releaseLock(); }
    const bodySignature = imageSignature(prefix.subarray(0,prefixSize));
    const bodyVerification = !size ? 'empty' : bodySignature === 'unrecognized' ? 'signature_unrecognized' :
      SIGNATURE_TYPES[bodySignature] === result.contentType ? 'signature_match' : 'mime_mismatch';
    const bodyEvidence = {bytes:size,bodySha256:hash.digest('hex'),bodySignature,bodyVerification};
    if (!size) return {...result,...bodyEvidence,status:'empty'};
    if (bodyVerification !== 'signature_match') return {...result,...bodyEvidence,
      status:bodyVerification === 'mime_mismatch' ? 'mime_mismatch' : 'unverified_image_body'};
    const imageUrl = new URL(row.thumbnail);
    // Only trust the explicit marker on our own known fallback endpoint.
    // A valid owner SVG or provider image is not automatically a placeholder.
    const placeholder = imageUrl.hostname === 'vid.best' && imageUrl.pathname === '/api/facebook/thumbnail' &&
      result.contentType === 'image/svg+xml' && response.headers.get('X-VidBest-Poster-Kind') === 'placeholder';
    return {...result,...bodyEvidence,status:placeholder ? 'placeholder' : 'ok'};
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
  const summary = `Published thumbnail checks: ${results.length}\nImage checks: ${JSON.stringify(counts)}\nKnown title-artwork placeholders: ${counts.placeholder || 0} (HTTP image available; source poster still needed)\nComplete allowed image responses include bounded header-signature checks and SHA-256 of the already-fetched bytes. No additional image requests.\nSource URLs and credentials: omitted. Header signatures are not image decoding, visual relevance, rights, playback or Google indexing proof.\n`;
  await writeFile('thumbnail-audit-summary.txt',summary);
  console.log(summary);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(()=>{console.error('Thumbnail audit could not complete; no credential or URL details logged.');process.exitCode=1;});
