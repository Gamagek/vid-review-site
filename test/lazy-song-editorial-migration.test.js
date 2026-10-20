import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import change from '../content/editorial-quality/2026-10-20-lazy-song.json' with {type:'json'};
import {auditEditorial} from '../scripts/editorial-quality-audit.mjs';
import worker from '../src/seo-edge.js';

const migration=readFileSync(new URL('../migrations/0048_lazy_song_source_context.sql',import.meta.url),'utf8');
const record=change.records[0];
const headings=text=>text.split('\n').filter(line=>/^[^\p{L}\p{N}]*[1-4]\. /u.test(line));
function fixture(){
  const db=new DatabaseSync(':memory:');
  for(const name of ['0001_initial.sql','0016_rights_certified_r2_cache.sql','0017_authorized_auto_cache.sql'])
    db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const insert=row=>{const keys=Object.keys(row);db.prepare(`INSERT INTO videos (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));};
  insert({...record.before,views:107,reaction_count:13,comments_count:4});
  insert({...record.before,id:999,slug:'protected-owner-review',primary_category:'Funny & Comedy'});
  return db;
}

test('Lazy Song migration changes only three intended fields once, preserving other records and counters',()=>{
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

test('every changed owner field, date, identity, draft or protected category prevents the Lazy Song update',()=>{
  assert.equal(Object.keys(record.before).length,29);
  for(const [key,value] of Object.entries(record.before)){
    const db=fixture();
    try{
      const alternative=key==='id'?998:key==='primary_category'?'Funny & Comedy':key==='media_type'?'facebook':key==='cache_status'?'failed':
        ['featured','trending','published','redistribution_certified'].includes(key)?1-value:
        typeof value==='number'?value+7:value===null?'owner-edit':value+' (owner edit)';
      db.prepare(`UPDATE videos SET ${key} = ? WHERE id = 180`).run(alternative);
      const before=db.prepare('SELECT * FROM videos ORDER BY id').all();
      db.exec(migration);assert.equal(db.prepare('SELECT changes() AS n').get().n,0,key);
      assert.deepEqual(db.prepare('SELECT * FROM videos ORDER BY id').all(),before,key);
    }finally{db.close();}
  }
});

test('Lazy Song retains opening, four headings and sections1–3 outside the exact section4 body replacement',()=>{
  assert.equal(record.after.review_text,record.before.review_text.replace(change.reviewReplacement.before,change.reviewReplacement.after));
  assert.equal(record.after.review_text.split('\n')[0],record.before.review_text.split('\n')[0]);
  assert.equal(headings(record.before.review_text).length,4);
  assert.deepEqual(headings(record.after.review_text),headings(record.before.review_text));
  assert.deepEqual(record.after.review_text.split('\n\n').slice(0,4),record.before.review_text.split('\n\n').slice(0,4));
  assert.equal(record.before.review_text.split('\n\n').at(-1).split('\n').slice(1).join('\n'),change.reviewReplacement.before);
  assert.doesNotMatch(record.after.description+' '+record.after.seo_description,/In this fresh|most viewed|legendary|Last updated|Poreotics|one-shot/);
  assert.match(record.after.review_text,/without a fresh viewing or listen/);
  assert.match(record.after.review_text,/not a measured audience response or a statement about production cost/);
  assert.match(record.after.review_text,/not evidence that this upload was replaced or withdrawn/);
  assert.ok(change.remainingReview.includes('not been independently re-verified'));
  for(const key of ['generated','edited','published'])assert.equal(change.imagePause[key],0);
  assert.equal(auditEditorial([record.before]).counts.genericListingIntros,1);
  assert.equal(auditEditorial([{...record.before,...record.after}]).counts.genericListingIntros,0);
});

test('new activity counts survive Lazy Song correction; dates, title/tags and source posters remain intact',()=>{
  const db=fixture();
  try{
    db.exec('UPDATE videos SET views = 2048, reaction_count = 88, comments_count = 9 WHERE id = 180');
    db.exec(migration);
    const row=db.prepare('SELECT * FROM videos WHERE id = 180').get();
    assert.equal(row.description,record.after.description);
    assert.deepEqual([row.views,row.reaction_count,row.comments_count],[2048,88,9]);
    for(const key of ['created_at','updated_at','seo_title','seo_tags','title','source_url','embed_url','thumbnail_url'])assert.equal(row[key],record.before[key],key);
  }finally{db.close();}
});

test('Lazy Song server HTML, API, canonical, source/schema/social image and sitemap preserve identity and dates',async t=>{
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
  const request=path=>worker.fetch(new Request(origin+path,{headers:{'User-Agent':'VidBest-SEO-Audit/1.0 (Lazy Song regression)'}}),env,ctx);
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const response=await request('/watch/'+record.before.slug);assert.equal(response.status,200);
  const html=await response.text();
  assert.ok(html.includes(`<link rel="canonical" href="${origin}/watch/${record.before.slug}">`));
  assert.ok(html.includes(escape(record.after.description)));
  assert.ok(html.includes(escape(record.after.seo_description)));
  assert.ok(html.includes(`<title>${escape(record.before.seo_title)} | Vid.Best</title>`));
  for(const paragraph of record.after.review_text.split('\n\n'))assert.ok(html.includes(escape(paragraph)),paragraph);
  assert.doesNotMatch(html,/Last updated/);
  const graph=JSON.parse(html.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/s)[1])['@graph'];
  const page=graph.find(x=>x['@type']==='WebPage');
  const source=graph.find(x=>x['@type']==='VideoObject');
  assert.equal(page.datePublished,record.before.created_at);assert.equal(page.dateModified,record.before.updated_at);
  // Actual read-only D1 has no source publication metadata for180. Preserve
  // omission rather than fabricating a source upload date or VideoObject.
  assert.equal(source,undefined);
  assert.ok(html.includes(`<meta property="og:image" content="${record.before.thumbnail_url}">`));
  assert.ok(html.includes(`<meta name="twitter:image" content="${record.before.thumbnail_url}">`));
  const payload=await(await request('/api/videos/'+record.before.slug)).json();
  const video=payload.video||payload;
  for(const [key,value] of Object.entries(record.after))assert.equal(video[key],value,key);
  for(const key of ['title','seo_title','source_url','thumbnail_url','created_at','updated_at'])assert.equal(video[key],record.before[key],key);
  assert.deepEqual(video.seo_tags,JSON.parse(record.before.seo_tags));
  const xml=await(await request('/sitemaps/videos-1.xml')).text();
  assert.ok(xml.includes(`<loc>${origin}/watch/${record.before.slug}</loc>`));
  assert.ok(xml.includes(`<lastmod>${record.before.updated_at}</lastmod>`));
  const entry=[...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].find(x=>x[1].includes(`<loc>${origin}/watch/${record.before.slug}</loc>`))?.[1];
  assert.ok(entry.includes(`<video:description>${escape(record.after.seo_description)}</video:description>`));
  assert.ok(entry.includes(`<video:thumbnail_loc>${record.before.thumbnail_url}</video:thumbnail_loc>`));
  assert.doesNotMatch(entry,/<video:publication_date>|<video:duration>/);
  assert.deepEqual(db.prepare('SELECT * FROM videos ORDER BY id').all(),after);
});
