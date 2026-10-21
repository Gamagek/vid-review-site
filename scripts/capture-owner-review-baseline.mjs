import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import request from '../content/editorial-quality/2026-10-20-owner-av-request.json' with {type:'json'};
const token=process.env.CLOUDFLARE_API_TOKEN||'';
const account=String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
assert.ok(token&&/^[a-f0-9]{32}$/.test(account),'Configured Cloudflare credentials are required for this read-only snapshot');
const res=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/d1a91eb2-1c41-44b8-aff1-24166f2c91f4/query',{
 method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
 body:JSON.stringify({sql:'SELECT * FROM videos ORDER BY id LIMIT 5001; SELECT name FROM d1_migrations ORDER BY id;'}),
 signal:AbortSignal.timeout(45000)
});
if(!res.ok)throw Error('Read-only D1 request HTTP '+res.status+'; Retry-After='+(res.headers.get('retry-after')||'not supplied')+'. No retry or production writes.');
const raw=await res.text();assert.ok(raw.length<20000000,'Unexpectedly large inventory');
const payload=JSON.parse(raw);
assert.ok(payload.success&&payload.result?.every(x=>x.success!==false),'D1 read failed; codes='+(payload.errors||[]).map(x=>x.code).join(','));
const rows=payload.result[0].results;assert.ok(rows.length>0&&rows.length<=5000);
const fields=Object.keys(rows[0]).filter(k=>!['views','reaction_count','comments_count'].includes(k)).sort();
assert.ok(fields.every(k=>/^[a-z][a-z0-9_]*$/.test(k)));
const stable=rows.map(r=>Object.fromEntries(fields.map(k=>[k,r[k]])));
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function yt(value){try{const u=new URL(value);if(!['youtu.be','youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname))return'';return u.hostname==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v')||u.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/)?.[1]||'';}catch{return'';}}
function privateMedia(row){
 for(const key of ['source_url','source_page_url','embed_url','thumbnail_url','cache_source_url']){
  if(!row[key])continue;
  try{const u=new URL(row[key],'https://vid.best');if(u.username||u.password||[...u.searchParams.keys()].some(k=>/^(?:token|sig|signature|secret|auth|authorization|expires|expire|exp|x-amz-.+)$/i.test(k)))return key;}catch{return key;}
 }return'';
}
const held=[],selected=[];
for(const v of request.youtube){
 const row=stable.find(r=>r.id===v.id);
 assert.ok(row&&row.published===1&&yt(row.source_url)===v.sourceId,'Owner source/publication mismatch for'+v.id);
 const sensitive=privateMedia(row);if(sensitive){held.push({id:row.id,reason:'Private/signed media field requires separate handling',field:sensitive});continue;}
 selected.push(row);
}
const start=Date.parse(request.requestedTikTokLocalDate+'T00:00:00+05:30'),end=start+86400000;
const tiktok=stable.filter(r=>r.media_type==='tiktok'&&r.published===1&&Date.parse(r.created_at)>=start&&Date.parse(r.created_at)<end);
for(const row of tiktok){
 if(request.protectedIds.includes(row.id)||/saiyaara|saiyara|summer-inverted/i.test(row.slug)){held.push({id:row.id,reason:'Existing explicit owner/source/media hold'});continue;}
 const sensitive=privateMedia(row);if(sensitive){held.push({id:row.id,reason:'Private/signed media field requires separate handling',field:sensitive});continue;}
 assert.match(row.source_url,/^https:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9_.]+\/video\/\d{15,25}(?:[/?#]|$)/);
 selected.push(row);
}
const ids=new Set(selected.map(r=>r.id));
const result={checkedAt:new Date().toISOString(),saved:rows.length,published:rows.filter(r=>r.published===1).length,
 fields,allNonCounterSha256:hash(stable),unaffectedNonCounterSha256:hash(stable.filter(r=>!ids.has(r.id))),allBaselineIds:stable.map(r=>r.id),
 youtubeRequested:request.youtube.length,tiktokRequestedLocalDate:request.requestedTikTokLocalDate,tiktokPublishedOnRequestedDate:tiktok.length,
 selected,held,migrations:payload.result[1].results.map(x=>x.name),queryRowsRead:payload.result.map(x=>x.meta?.rows_read??null),
 queryRowsWritten:payload.result.map(x=>x.meta?.rows_written??0),productionWrites:0,r2Writes:0,imageWrites:0};
assert.ok(result.queryRowsWritten.every(x=>x===0));

const changeURL=new URL('../content/editorial-quality/2026-10-21-owner-av-reviews.json',import.meta.url);
if(fs.existsSync(changeURL)){
 const change=JSON.parse(fs.readFileSync(changeURL,'utf8'));
 const same=(row,expected)=>row&&fields.every(k=>row[k]===expected[k]);
 const states=change.records.map(r=>{
  const row=stable.find(v=>v.id===r.id);
  return {id:r.id,state:same(row,{...r.before,...r.after})?'after':same(row,r.before)?'before':'conflict'};
 });
 const baselineIds=new Set(change.baseline.allBaselineIds);
 const protectedHash=hash(stable.filter(r=>baselineIds.has(r.id)&&!ids.has(r.id)));
 result.enrichment={states,before:states.filter(x=>x.state==='before').length,after:states.filter(x=>x.state==='after').length,
  conflicts:states.filter(x=>x.state==='conflict').map(x=>x.id),unaffectedBaselineMatch:protectedHash===change.baseline.unaffectedNonCounterSha256,
  additionalOwnerIds:stable.filter(r=>!baselineIds.has(r.id)).map(r=>r.id),deferred:change.deferred.map(r=>({id:r.id,unchanged:same(stable.find(v=>v.id===r.id),r.before),reason:r.reason})),publicChecks:[]};
 assert.equal(result.enrichment.conflicts.length,0,'Concurrent owner edits in targeted records; do not publish stale preimages');
 assert.ok(result.enrichment.unaffectedBaselineMatch,'Unrelated baseline changed; reconcile owner work before release verification');
 const targets=result.enrichment.after===change.records.length?change.records:change.records.filter((r,i)=>i===0||r.id===394);
 const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
 let next=0;
 async function publicCheck(){
  while(next<targets.length){
   const record=targets[next++],state=states.find(x=>x.id===record.id).state;
   const expected=state==='after'?{...record.before,...record.after}:record.before;
   const url='https://vid.best/watch/'+record.before.slug;
   const response=await fetch(url,{headers:{'User-Agent':'VidBest-SEO-Audit/1.0 (owner-requested review verification)','Cache-Control':'no-cache'},signal:AbortSignal.timeout(30000)});
   const html=await response.text();
   const graphText=html.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/s)?.[1];
   let graph=[];try{graph=JSON.parse(graphText)['@graph']||[];}catch{}
   const page=graph.find(x=>x['@type']==='WebPage');
   const sourceId=yt(record.before.source_url);
   const check={id:record.id,url,state,http:response.status,
    canonical:html.includes('<link rel="canonical" href="'+url+'">'),
    description:html.includes(escape(expected.description)),seoDescription:html.includes(escape(expected.seo_description)),
    review:expected.review_text.split(/\n{2,}/).every(p=>html.includes(escape(p))),
    sourceIdentity:sourceId?html.includes(sourceId):html.includes(record.before.source_url.split('/').at(-1)),
    dates:page?.datePublished===record.before.created_at&&page?.dateModified===record.before.updated_at};
   result.enrichment.publicChecks.push(check);
   assert.equal(check.http,200,'Watch HTTP status for '+record.id);
   for(const k of ['canonical','description','seoDescription','review','sourceIdentity','dates'])assert.ok(check[k],'Public watch '+k+' mismatch for '+record.id);
  }
 }
 await Promise.all(Array.from({length:Math.min(3,targets.length)},publicCheck));
 result.enrichment.publicChecks.sort((a,b)=>a.id-b.id);
}
try{
 const deploymentResponse=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/vid-review-site/deployments',{
  headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
 if(!deploymentResponse.ok){result.workerDeployment={http:deploymentResponse.status,verified:false};}
 else{
  const value=await deploymentResponse.json(),deployments=value.result?.deployments||value.result||[];
  const latest=Array.isArray(deployments)?deployments[0]:null;
  result.workerDeployment={verified:!!latest,http:deploymentResponse.status,id:latest?.id,created_on:latest?.created_on,source:latest?.source,
   strategy:latest?.strategy,versions:latest?.versions?.map(v=>({version_id:v.version_id,percentage:v.percentage}))};
 }
}catch(error){result.workerDeployment={verified:false,error:error.name};}


result.tiktokCalendar=Object.fromEntries([...new Set(stable.filter(r=>r.media_type==='tiktok'&&r.published===1).map(r=>new Date(Date.parse(r.created_at)+330*60000).toISOString().slice(0,10)))].sort().map(day=>[day,stable.filter(r=>r.media_type==='tiktok'&&r.published===1&&new Date(Date.parse(r.created_at)+330*60000).toISOString().slice(0,10)===day).length]));
result.tiktokPublishedOn20October=stable.filter(r=>r.media_type==='tiktok'&&r.published===1&&new Date(Date.parse(r.created_at)+330*60000).toISOString().slice(0,10)==='2026-10-20'&&!privateMedia(r));

fs.writeFileSync('owner-review-baseline.json',JSON.stringify(result,null,2)+'\n');
const encoded=Buffer.from(JSON.stringify(result)).toString('base64'),size=5000,n=Math.ceil(encoded.length/size);
for(let i=0;i<n;i++)console.log('VIDBEST_BASELINE_CHUNK '+(i+1)+'/'+n+' '+encoded.slice(i*size,(i+1)*size));
console.log(JSON.stringify({checkedAt:result.checkedAt,saved:result.saved,published:result.published,selected:result.selected.length,held:result.held.length,productionWrites:0}));
