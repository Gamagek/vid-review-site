import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const ORIGIN='https://vid.best';
const allArt=JSON.parse(fs.readFileSync(new URL('../src/review-illustrations.json',import.meta.url),'utf8'));
const requested=process.argv.find(value=>value.startsWith('--ids='))?.slice(6).split(',').map(Number);
assert.ok(!requested || requested.every(id=>Number.isSafeInteger(id)&&id>0),'Use published illustration IDs');
const art=requested?allArt.filter(item=>requested.includes(item.id)):allArt.slice(-10);
assert.ok(art.length>0&&art.length<=10,'Verify one batch of up to ten illustrations');
assert.ok(!requested||new Set(requested).size===art.length,'Every requested ID must have a manifest entry');
const headers={'User-Agent':'VidBest-SEO-Audit/illustrations-1.0'};
const get=async path=>{const r=await fetch(ORIGIN+path,{headers,redirect:'manual',signal:AbortSignal.timeout(20000)});assert.equal(r.status,200,path);return r;};
const root=await (await get('/sitemap.xml')).text();
const imageIndex=await (await get('/image-sitemap.xml')).text();
const imageMap=await (await get('/sitemaps/images-1.xml')).text();
const videos=await (await get('/sitemaps/videos-1.xml')).text();
const robots=await (await get('/robots.txt')).text();
assert.ok(root.includes('<loc>'+ORIGIN+'/sitemaps/images-1.xml</loc>'));
assert.ok(!root.includes('<loc>'+ORIGIN+'/image-sitemap.xml</loc>'));
assert.ok(imageIndex.includes('<loc>'+ORIGIN+'/sitemaps/images-1.xml</loc>'));
assert.ok(robots.includes('Sitemap: '+ORIGIN+'/image-sitemap.xml'));
const children=[...root.matchAll(/<loc>([^<]+)<\/loc>/g)].map(x=>x[1]);
const fetchedMaps=new Map([['/sitemaps/images-1.xml',imageMap],['/sitemaps/videos-1.xml',videos]]);
for(const url of children){const path=new URL(url).pathname;const content=fetchedMaps.get(path)||await (await get(path)).text();assert.ok(content.includes('<urlset '),url);assert.ok(!content.includes('<sitemapindex'),url);}
const results=[];
for(const a of art){
  const r=await get(a.path);assert.equal(r.headers.get('content-type')?.split(';')[0],'image/webp');
  if(r.headers.has('content-length'))assert.equal(Number(r.headers.get('content-length')),a.bytes);
  const reader=r.body.getReader();const chunks=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>a.bytes){await reader.cancel();throw Error('Oversized asset');}chunks.push(value);}
  const bytes=Buffer.concat(chunks);assert.equal(length,a.bytes);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),a.sha256);
  if(a.previousPath){const prior=await fetch(ORIGIN+a.previousPath,{headers,redirect:'manual',signal:AbortSignal.timeout(20000)});assert.equal(prior.status,301);assert.equal(prior.headers.get('location'),ORIGIN+a.path);}
  const html=await (await get('/watch/'+a.slug)).text();assert.ok(html.includes('src="'+ORIGIN+a.path+'"'));assert.ok(html.includes(a.caption));
  assert.ok(!/AI[\s-]*generated/i.test(a.alt+a.caption));
  const schema=JSON.parse(html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1]);
  const page=schema['@graph'].find(x=>x['@type']==='WebPage');const video=schema['@graph'].find(x=>x['@type']==='VideoObject');assert.equal(page.image.contentUrl,ORIGIN+a.path);assert.ok(!video?.thumbnailUrl?.includes(ORIGIN+a.path));
  assert.equal(page.primaryImageOfPage,ORIGIN+a.path);
  assert.ok(html.includes('<meta property="og:image" content="'+ORIGIN+a.path+'">'));
  assert.ok(html.includes('<meta name="twitter:image" content="'+ORIGIN+a.path+'">'));
  if(a.previewFallbackFrom||a.previewFallbackThumbnailSha256){const payload=await(await get('/api/videos/'+a.slug)).json();assert.equal(payload.video.review_preview_url,a.path);if(a.previewFallbackThumbnailSha256)assert.equal(payload.video.preview_poster_url,a.path);}
  const mapEntry=[...imageMap.matchAll(/<url>([\s\S]*?)<\/url>/g)].find(x=>x[1].includes('<loc>'+ORIGIN+'/watch/'+a.slug+'</loc>'))?.[1];
  assert.ok(mapEntry?.includes('<image:loc>'+ORIGIN+a.path+'</image:loc>'));assert.ok(videos.includes('<image:loc>'+ORIGIN+a.path+'</image:loc>'));
  results.push({id:a.id,slug:a.slug,assetPath:a.path,status:r.status,mime:'image/webp',bytes:a.bytes,sha256:a.sha256,pageAssociation:true,socialMetadataAssociation:true,placeholderPreviewAssociation:!!(a.previewFallbackFrom||a.previewFallbackThumbnailSha256),imageSitemapAssociation:true,videoThumbnailUnchanged:true,datePublished:page.datePublished,dateModified:page.dateModified});
}
const result={checkedAt:new Date().toISOString(),rootChildren:children.length,imageMapPages:[...imageMap.matchAll(/<url>/g)].length,imageEntries:[...imageMap.matchAll(/<image:loc>/g)].length,results,inspectionCalls:0,sitemapSubmissions:0,videoProviderRequests:0,d1Writes:0,limit:'HTTP/hash/HTML associations only; not Google image indexing or source video playback.'};
fs.writeFileSync('review-illustration-verification.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({checkedAt:result.checkedAt,rootChildren:result.rootChildren,imageMapPages:result.imageMapPages,imageEntries:result.imageEntries,illustrations:results.length,allPassed:true,inspectionCalls:0,sitemapSubmissions:0}));
