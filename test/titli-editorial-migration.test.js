import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import change from '../content/editorial-quality/2026-10-20-titli.json' with {type:'json'};
import {auditEditorial} from '../scripts/editorial-quality-audit.mjs';
import worker from '../src/seo-edge.js';
import illustrations from '../src/review-illustrations.json' with {type:'json'};

const migration=readFileSync(new URL('../migrations/0047_titli_source_context.sql',import.meta.url),'utf8');
const record=change.records[0];
const headings=text=>text.split('\n').filter(line=>/^[^\p{L}\p{N}]*[1-6]\. /u.test(line));
function fixture(){
  const db=new DatabaseSync(':memory:');
  for(const name of ['0001_initial.sql','0016_rights_certified_r2_cache.sql','0017_authorized_auto_cache.sql'])
    db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const insert=row=>{const keys=Object.keys(row);db.prepare(`INSERT INTO videos (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));};
  insert({...record.before,views:107,reaction_count:13,comments_count:4});
  insert({...record.before,id:999,slug:'protected-owner-review',primary_category:'Funny & Comedy'});
  return db;
}

test('Titli migration changes only three intended fields once and preserves other records and counters',()=>{
  const db=fixture();
  try{
    const before=db.prepare('SELECT * FROM videos ORDER BY id').all();
    db.exec(migration);assert.equal(db.prepare('SELECT changes() AS n').get().n,1);
    const after=db.prepare('SELECT * FROM videos ORDER BY id').all();
    assert.deepEqual({...after[0]},{...before[0],...record.after});
    assert.deepEqual({...after[1]},{...before[1]});
    assert.deepEqual(Object.keys(record.after).sort(),['description','review_text','seo_description']);
    db.exec(migration);assert.equal(db.prepare('SELECT changes() AS n').get().n,0);
    assert.deepEqual(db.prepare('SELECT * FROM videos ORDER BY id').all(),after);
  }finally{db.close();}
});

test('every changed owner field, date, identity, draft or protected category prevents the Titli update',()=>{
  for(const [key,value] of Object.entries(record.before)){
    const db=fixture();
    try{
      const alternative=key==='id'?998:key==='primary_category'?'Funny & Comedy':key==='media_type'?'facebook':key==='cache_status'?'failed':
        ['featured','trending','published','redistribution_certified'].includes(key)?1-value:
        typeof value==='number'?value+7:value===null?'owner-edit':value+' (owner edit)';
      db.prepare(`UPDATE videos SET ${key} = ? WHERE id = 135`).run(alternative);
      const before=db.prepare('SELECT * FROM videos ORDER BY id').all();
      db.exec(migration);assert.equal(db.prepare('SELECT changes() AS n').get().n,0,key);
      assert.deepEqual(db.prepare('SELECT * FROM videos ORDER BY id').all(),before,key);
    }finally{db.close();}
  }
});

test('Titli retains its opening, six headings and every paragraph outside the selected source-context replacement',()=>{
  assert.equal(record.after.review_text,record.before.review_text.replace(change.reviewReplacement.before,change.reviewReplacement.after));
  assert.equal(record.after.review_text.split('\n')[0],record.before.review_text.split('\n')[0]);
  assert.equal(headings(record.before.review_text).length,6);
  assert.deepEqual(headings(record.after.review_text),headings(record.before.review_text));
  for(const paragraph of record.before.review_text.split('\n\n'))
    if(paragraph!==change.reviewReplacement.before)assert.ok(record.after.review_text.includes(paragraph));
  assert.doesNotMatch(record.after.description+' '+record.after.seo_description,/Munnar|In this fresh|Last updated/);
  assert.match(record.after.review_text,/without a fresh viewing or listen/);
  assert.match(record.after.review_text,/making page credits Farah Khan/);
  assert.ok(change.remainingReview.includes('not been independently re-verified'));
  assert.equal(change.imagePause.generated,0);assert.equal(change.imagePause.edited,0);
  assert.equal(auditEditorial([record.before]).counts.genericListingIntros,1);
  assert.equal(auditEditorial([{...record.before,...record.after}]).counts.genericListingIntros,0);
});

test('new activity counts survive the Titli correction with both original dates and SEO title/tags intact',()=>{
  const db=fixture();
  try{
    db.exec('UPDATE videos SET views = 2048, reaction_count = 88, comments_count = 9 WHERE id = 135');
    db.exec(migration);
    const row=db.prepare('SELECT * FROM videos WHERE id = 135').get();
    assert.equal(row.description,record.after.description);
    assert.deepEqual([row.views,row.reaction_count,row.comments_count],[2048,88,9]);
    for(const key of ['created_at','updated_at','seo_title','seo_tags','title','source_url','embed_url','thumbnail_url'])assert.equal(row[key],record.before[key],key);
  }finally{db.close();}
});

test('Titli server HTML, API, canonical, image association and sitemap retain source and original dates',async t=>{
  const db=fixture();t.after(()=>db.close());
  for(const name of ['0002_discovery_requests.sql','0003_security_rate_limits.sql','0004_maintenance_indexes.sql',
    '0005_source_video_metadata.sql','0009_app_settings.sql','0010_video_analysis.sql','0014_member_notifications.sql',
    '0018_tiktok_oembed_cache.sql','0019_tiktok_oembed_backfill.sql','0020_member_personalization.sql',
    '0022_facebook_readable_slugs.sql','0030_facebook_preview_jobs.sql'])
    db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  db.exec(migration);
  const after=db.prepare('SELECT * FROM videos ORDER BY id').all();
  function statement(sql,params=[]){return{bind(...values){return statement(sql,values);},
    async first(){return db.prepare(sql).get(...params)||null;},
    async all(){return{success:true,results:db.prepare(sql).all(...params)};},
    async run(){throw Error('Unexpected verification write');}};}
  const origin='https://vid.best';
  const env={PUBLIC_BASE_URL:origin,DB:{prepare:statement,async batch(statements){return Promise.all(statements.map(s=>s.all()));}}};
  const ctx={waitUntil(){throw Error('Unexpected background mutation');}};
  const request=path=>worker.fetch(new Request(origin+path,{headers:{'User-Agent':'VidBest-SEO-Audit/1.0 (Titli regression)'}}),env,ctx);
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const response=await request('/watch/'+record.before.slug);assert.equal(response.status,200);
  const html=await response.text();
  assert.ok(html.includes(`<link rel="canonical" href="${origin}/watch/${record.before.slug}">`));
  assert.ok(html.includes(escape(record.after.description)));
  assert.ok(html.includes(escape(record.after.seo_description)));
  for(const paragraph of record.after.review_text.split('\n\n'))assert.ok(html.includes(escape(paragraph)),paragraph);
  assert.doesNotMatch(html,/Last updated/);
  const graph=JSON.parse(html.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/s)[1])['@graph'];
  const page=graph.find(x=>x['@type']==='WebPage');
  assert.equal(page.datePublished,record.before.created_at);assert.equal(page.dateModified,record.before.updated_at);
  const art=illustrations.find(x=>x.slug===record.before.slug);
  if(art)assert.equal(page.primaryImageOfPage,origin+art.path);
  const payload=await(await request('/api/videos/'+record.before.slug)).json();
  const video=payload.video||payload;
  for(const [key,value] of Object.entries(record.after))assert.equal(video[key],value,key);
  for(const key of ['title','seo_title','source_url','thumbnail_url','created_at','updated_at'])assert.equal(video[key],record.before[key],key);
  assert.deepEqual(video.seo_tags,JSON.parse(record.before.seo_tags));
  const xml=await(await request('/sitemaps/videos-1.xml')).text();
  assert.ok(xml.includes(`<loc>${origin}/watch/${record.before.slug}</loc>`));
  assert.ok(xml.includes(`<lastmod>${record.before.updated_at}</lastmod>`));
  assert.deepEqual(db.prepare('SELECT * FROM videos ORDER BY id').all(),after);
});
