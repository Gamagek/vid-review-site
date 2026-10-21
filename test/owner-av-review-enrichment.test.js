import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import change from '../content/editorial-quality/2026-10-21-owner-av-reviews.json' with {type:'json'};
import request from '../content/editorial-quality/2026-10-20-owner-av-request.json' with {type:'json'};
import youtube from '../content/editorial-quality/evidence/2026-10-21-youtube-av.json' with {type:'json'};
import tiktok from '../content/editorial-quality/evidence/2026-10-21-tiktok-av.json' with {type:'json'};
import worker from '../src/seo-edge.js';

const migration=readFileSync(new URL('../migrations/0049_owner_av_review_enrichment.sql',import.meta.url),'utf8');
const blocks=new Map(migration.split(/\n(?=-- Vid\.Best \d+\n)/).slice(1).map(sql=>[Number(sql.match(/^-- Vid\.Best (\d+)/)[1]),sql]));
const origin='https://vid.best';
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const nonCounter=row=>Object.fromEntries(Object.entries(row).filter(([k])=>!['views','reaction_count','comments_count'].includes(k)));
function insert(db,row){
 const keys=Object.keys(row);
 db.prepare('INSERT INTO videos ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>row[k]));
}
function fixture(records=change.records){
 const db=new DatabaseSync(':memory:');
 for(const name of ['0001_initial.sql','0016_rights_certified_r2_cache.sql','0017_authorized_auto_cache.sql'])
  db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 for(const r of records)insert(db,{...r.before,views:107,reaction_count:13,comments_count:4});
 return db;
}

test('owner scope matches31exact YouTube sources and only the requested published TikTok date',()=>{
 assert.equal(change.records.length,61);
 assert.equal(change.scope.requested,72);
 assert.equal(blocks.size,61);
 assert.equal(new Set(change.records.map(r=>r.id)).size,61);
 assert.deepEqual(change.deferred.map(r=>r.id),[307,312,313,316,317,318,319,322,323,325,326]);
 for(const owner of request.youtube){
  const r=change.records.find(x=>x.id===owner.id);
  assert.ok(r&&r.before.source_url.includes(owner.sourceId),String(owner.id));
  assert.equal(r.before.published,1);
  assert.ok(youtube.identityMatches.some(x=>x.id===r.id&&x.hits[0].item_id===r.sourceEvidence.item_id));
 }
 for(const r of change.records){
  assert.equal(Object.keys(r.before).length,29);
  assert.deepEqual(Object.keys(r.after).sort(),[...change.allowedChangedFields].sort());
  assert.ok(!change.protectedIds.includes(r.id));
  assert.equal(r.sourceEvidence.source_url,r.before.source_url);
  assert.equal(r.sourceEvidence.visual_access,true);
  assert.equal(r.before.published,1);
  if(r.before.media_type==='tiktok'){
   assert.equal(new Date(Date.parse(r.before.created_at)+330*60000).toISOString().slice(0,10),'2026-10-19');
   const evidence=tiktok.groundedVisualEvidence.find(x=>x.vidbest_id===r.id);
   assert.ok(evidence&&evidence.visual_access&&evidence.item_id===r.sourceEvidence.item_id);
  }
 }
 assert.equal(change.records.filter(r=>r.before.media_type==='youtube').length,31);
 assert.equal(change.records.filter(r=>r.before.media_type==='tiktok').length,30);
 for(const n of Object.values(change.imagePause))assert.equal(n,0);
 assert.doesNotMatch(migration.replace(/'(?:''|[^'])*'/g,"'literal'"),/\b(?:DELETE|INSERT|ALTER|CREATE|DROP|REPLACE)\b/i);
 assert.doesNotMatch(migration,/\b(?:created_at|updated_at|source_url|embed_url|thumbnail_url|published|title|views|reaction_count|comments_count)\s*=/i);
});

test('each review has at least3specific subtopics, bounded metadata and unique substantive prose',()=>{
 const windows=new Map();
 for(const r of change.records){
  const sections=r.after.review_text.split(/\n{2,}/);
  assert.ok(sections.length>=3&&sections.length<=4,String(r.id));
  sections.forEach((s,n)=>assert.match(s,new RegExp('^'+(n+1)+'\\. [^\\n]+\\n\\S')));
  const words=sections.map(s=>s.slice(s.indexOf('\n')+1)).join(' ').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,'').split(/\s+/);
  assert.ok(words.length>=90&&words.length<=350,String(r.id));
  assert.ok(r.after.seo_title.length<=80);
  assert.ok(r.after.seo_description.length<=180);
  assert.ok(/[.!?]$/.test(r.after.seo_description));
  assert.ok(Array.isArray(JSON.parse(r.after.seo_tags)));
  assert.notEqual(r.after.review_text,r.before.review_text);
  assert.doesNotMatch(r.after.review_text,/The public TikTok caption|A Vid\.Best editorial look|guaranteed (?:indexing|approval)|I watched|we listened|we watched/i);
  if(r.sourceEvidence.audioCoverage!=='direct_audiovisual_analysis')assert.match(r.after.review_text,/audio|speech|soundtrack/i);
  else assert.ok(youtube.directSourceAnalysis.videos.some(v=>v.id===r.id&&v.status==='evidence_ready'&&v.analysis.visual_access&&v.analysis.audio_access&&v.matchesDuration));
  for(let i=0;i<=words.length-20;i++){
   const key=words.slice(i,i+20).join(' ');
   assert.ok(!windows.has(key)||windows.get(key)===r.id,'Repeated20word passage between'+windows.get(key)+'and'+r.id);
   windows.set(key,r.id);
  }
 }
 assert.equal(change.records.filter(r=>r.sourceEvidence.audioCoverage==='direct_audiovisual_analysis').length,16);
});

test('migration updates only61intended editorial records once, retaining dates, counters, holds and deferred sources',()=>{
 const db=fixture();try{
  for(const d of change.deferred)insert(db,{...d.before,views:88,reaction_count:7,comments_count:2});
  for(const id of change.protectedIds)insert(db,{...change.records[0].before,id,slug:'protected-'+id,views:19});
  const before=db.prepare('SELECT * FROM videos ORDER BY id').all();
  db.exec('UPDATE videos SET views=2048,reaction_count=88,comments_count=9 WHERE id=394');
  const current=db.prepare('SELECT * FROM videos ORDER BY id').all();
  const initialTotal=db.prepare('SELECT total_changes() AS n').get().n;
  db.exec(migration);
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n-initialTotal,61);
  const after=db.prepare('SELECT * FROM videos ORDER BY id').all();
  for(let i=0;i<current.length;i++){
   const r=change.records.find(x=>x.id===current[i].id);
   assert.deepEqual({...after[i]},{...current[i],...(r?.after||{})},String(current[i].id));
  }
  const total=db.prepare('SELECT total_changes() AS n').get().n;
  db.exec(migration);
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n,total);
  assert.deepEqual(db.prepare('SELECT * FROM videos ORDER BY id').all(),after);
  assert.deepEqual(before.filter(v=>change.deferred.some(d=>d.id===v.id)),after.filter(v=>change.deferred.some(d=>d.id===v.id)));
 }finally{db.close();}
});

test('every29-field owner drift for every target fails closed without blocking independent records',()=>{
 for(const r of change.records){
  const db=fixture([r]);try{
   for(const [key,value] of Object.entries(r.before)){
    db.exec('SAVEPOINT owner_edit');
    const alternative=key==='id'?r.id+2000:key==='primary_category'?'Music':key==='media_type'?'facebook':key==='cache_status'?'failed':
     ['featured','trending','published','redistribution_certified'].includes(key)?1-value:typeof value==='number'?value+7:value===null?'owner-edit':value+' (owner edit)';
    db.prepare('UPDATE videos SET '+key+'=? WHERE id=?').run(alternative,r.id);
    const before=db.prepare('SELECT * FROM videos').all();
    const total=db.prepare('SELECT total_changes() AS n').get().n;
    db.exec(blocks.get(r.id));
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n,total,r.id+':'+key);
    assert.deepEqual(db.prepare('SELECT * FROM videos').all(),before,r.id+':'+key);
    db.exec('ROLLBACK TO owner_edit; RELEASE owner_edit');
   }
  }finally{db.close();}
 }
 const db=fixture();try{
  db.exec("UPDATE videos SET review_text='New owner review' WHERE id=394");
  db.exec(migration);
  assert.equal(db.prepare('SELECT review_text FROM videos WHERE id=394').get().review_text,'New owner review');
  assert.equal(db.prepare('SELECT review_text FROM videos WHERE id=393').get().review_text,change.records.find(r=>r.id===393).after.review_text);
 }finally{db.close();}
});

test('all61server-rendered watch pages and APIs expose full reviews while source schemas, social images and original sitemap dates remain intact',async t=>{
 const db=fixture();t.after(()=>db.close());
 for(const name of ['0002_discovery_requests.sql','0003_security_rate_limits.sql','0004_maintenance_indexes.sql',
  '0005_source_video_metadata.sql','0009_app_settings.sql','0010_video_analysis.sql','0014_member_notifications.sql',
  '0018_tiktok_oembed_cache.sql','0019_tiktok_oembed_backfill.sql','0020_member_personalization.sql',
  '0022_facebook_readable_slugs.sql','0030_facebook_preview_jobs.sql'])
  db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 function statement(sql,params=[]){return{bind(...values){return statement(sql,values);},
  async first(){return db.prepare(sql).get(...params)||null;},
  async all(){return{success:true,results:db.prepare(sql).all(...params)};},
  async run(){throw Error('Unexpected verification mutation');}};}
 const env={PUBLIC_BASE_URL:origin,DB:{prepare:statement,async batch(statements){return Promise.all(statements.map(s=>s.all()));}}};
 const ctx={waitUntil(){throw Error('Unexpected background mutation');}};
 const get=path=>worker.fetch(new Request(origin+path,{headers:{'User-Agent':'VidBest-SEO-Audit/1.0 (owner review regression)'}}),env,ctx);
 const graph=html=>JSON.parse(html.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/s)[1])['@graph'];
 const sourceState=html=>({video:graph(html).find(x=>x['@type']==='VideoObject'),
  images:[...html.matchAll(/<meta\b[^>]*(?:property="og:image"|name="twitter:image")[^>]*>/g)].map(x=>x[0]),
  pageImage:graph(html).find(x=>x['@type']==='WebPage')?.primaryImageOfPage});
 const before=new Map();
 for(const r of change.records){
  const response=await get('/watch/'+r.before.slug);assert.equal(response.status,200);
  before.set(r.id,sourceState(await response.text()));
 }
 db.exec(migration);
 const rows=db.prepare('SELECT * FROM videos ORDER BY id').all();
 for(const r of change.records){
  const response=await get('/watch/'+r.before.slug);assert.equal(response.status,200);
  const html=await response.text();
  assert.ok(html.includes('<link rel="canonical" href="'+origin+'/watch/'+r.before.slug+'">'));
  assert.ok(html.includes(escape(r.after.description)));
  assert.ok(html.includes(escape(r.after.seo_description)));
  for(const p of r.after.review_text.split(/\n{2,}/))assert.ok(html.includes(escape(p)),String(r.id));
  const page=graph(html).find(x=>x['@type']==='WebPage');
  assert.equal(page.datePublished,r.before.created_at);
  assert.equal(page.dateModified,r.before.updated_at);
  assert.deepEqual(sourceState(html),before.get(r.id),String(r.id));
  const payload=await(await get('/api/videos/'+r.before.slug)).json(),video=payload.video||payload;
  for(const [key,value] of Object.entries(r.after))assert.deepEqual(video[key],key==='seo_tags'?JSON.parse(value):value,r.id+':'+key);
  for(const key of ['title','slug','source_url','source_page_url','embed_url','thumbnail_url','published','created_at','updated_at','r2_key','redistribution_certified'])
   assert.equal(video[key],r.before[key],r.id+':'+key);
 }
 const xml=await(await get('/sitemaps/videos-1.xml')).text();
 for(const r of change.records){
  assert.ok(xml.includes('<loc>'+origin+'/watch/'+r.before.slug+'</loc>'),String(r.id));
  assert.ok(xml.includes('<lastmod>'+r.before.updated_at+'</lastmod>'),String(r.id));
 }
 assert.deepEqual(db.prepare('SELECT * FROM videos ORDER BY id').all(),rows);
});
