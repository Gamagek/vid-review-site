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
fs.writeFileSync('owner-review-baseline.json',JSON.stringify(result,null,2)+'\n');
const encoded=Buffer.from(JSON.stringify(result)).toString('base64'),size=5000,n=Math.ceil(encoded.length/size);
for(let i=0;i<n;i++)console.log('VIDBEST_BASELINE_CHUNK '+(i+1)+'/'+n+' '+encoded.slice(i*size,(i+1)*size));
console.log(JSON.stringify({checkedAt:result.checkedAt,saved:result.saved,published:result.published,selected:result.selected.length,held:result.held.length,productionWrites:0}));
