import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,access,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {editorialQueue,sourceIdentity,editorialSource,validateObservations,validateReview,baseline,sha256,collectionProposals} from '../scripts/editorial/core.mjs';
import {GeminiClient,groundingSources} from '../scripts/editorial/gemini.mjs';
import {exportCatalog} from '../scripts/editorial/catalog.mjs';
import {analyzeRecord} from '../scripts/editorial/pipeline.mjs';
import {acquire,segments,capture,run} from '../scripts/editorial/media.mjs';
import {guardedSql,prepare} from '../scripts/prepare-editorial-package.mjs';
import {capturedReviewFrame} from '../src/review-captured-frame.js';
import {reviewGrounding} from '../src/review-grounding.js';

const row=(id=31,review='Short existing review.')=>({id,slug:`source-${id}`,title:`Source ${id}`,published:1,
  media_type:'youtube',source_url:'https://youtu.be/abcdefghijk',source_page_url:null,thumbnail_url:'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
  created_at:'2026-10-19T12:34:56.000Z',updated_at:'2026-10-20T12:34:56.000Z',review_text:review,
  description:'Existing listing',seo_title:'Existing SEO',seo_description:'Existing meta',seo_tags:'["existing"]',
  primary_category:'Music',redistribution_certified:1});
const segment={index:0,start:0,duration:3,has_audio:true,sha256:'a'.repeat(64)};
const raw={accessible:true,visual_access:true,audio_access:true,scenes:[{seconds:1,observation:'A blue circle moves across a warm background.',audio:'A steady simple tone.',
  why_it_matters:'The movement follows the steady sound.',strengths:['Readable composition'],limitations:['Little variation']}],audio_summary:'An audible tone.',lenses:['visual craft'],uncertainties:[]};
const evidence=()=>[validateObservations(structuredClone(raw),segment)];
const prose='The moving circle gives the composition a clear point of attention. Its path leaves space around the central shape, making the small changes in position easy to follow. The continuous tone supplies a steady reference for this movement. The visual material offers little variation, which can feel calm during a brief viewing but gives the sequence less development over time. This reading concerns the relationship between the visible movement and the audible sound; it does not establish an intention on the part of the creator.';
const review=()=>({description:'A moving circle and steady tone create a spare audiovisual exercise with a clear focal point.',
  sections:['Movement and space','A steady audible reference','The limits of repetition','A restrained visual exercise'].map(heading=>({heading,paragraphs:[prose],kind:'interpretation',scene_refs:['0-0'],source_refs:[]})),
  best_scenes:[{scene_id:'0-0',reason:'The circle and negative space are clearly visible.'}],verdict:'A focused exercise with limited development.',
  seo_title:'Movement and Sound — An Audiovisual Study',seo_description:'Explore how a simple moving circle and steady tone shape a short visual exercise, including its strengths and limited variation.',
  tags:['visual composition','sound'],recommendations:[],illustration_prompt:'An original conceptual anime illustration of a blue circular shape moving through warm abstract space, preserving the spare composition of the reference.'});

test('shortest queue preserves originals, deterministic ties and all protected exclusions',()=>{
  const rows=[row(32,'one two three'),row(33,'a'),row(31,'two'),{...row(4),review_text:''},{...row(34),published:0},
    {...row(35),media_type:'raw'},{...row(36),is_test:true},{...row(37),source_url:'https://example.com/video'}];
  const before=structuredClone(rows);
  assert.deepEqual(editorialQueue(rows,{limit:3}).map(x=>x.id),[33,31,32]);
  assert.deepEqual(editorialQueue(rows,{limit:3,completed:[33]}).map(x=>x.id),[31,32]);
  assert.deepEqual(rows,before);assert.throws(()=>editorialQueue([...rows,row(31)]),/Invalid catalog/);
  const cached={...row(),media_type:'r2',source_url:'https://vid.best/media/uploads/tiktok/1234567890123456789.mp4',source_page_url:'https://www.tiktok.com/@creator/video/1234567890123456789'};
  assert.equal(editorialSource(cached).provider,'tiktok');assert.equal(editorialQueue([cached]).length,1);
});

test('exact source identity rejects deceptive URLs and normalizes only known video IDs',()=>{
  assert.equal(sourceIdentity('https://www.youtube.com/shorts/abcdefghijk?si=track').url,'https://www.youtube.com/watch?v=abcdefghijk');
  for(const u of ['https://youtube.com.evil.test/watch?v=abcdefghijk','http://youtu.be/abcdefghijk','https://user:pass@youtu.be/abcdefghijk','https://youtu.be/abc','https://www.tiktok.com/@creator'])assert.throws(()=>sourceIdentity(u));
});

test('audio, silence, timestamp range and segment offsets must match actual media',()=>{
  assert.equal(validateObservations(raw,{...segment,start:600}).scenes[0].seconds,601);
  assert.throws(()=>validateObservations({...raw,audio_access:false},segment),/Audio/);
  assert.throws(()=>validateObservations(raw,{...segment,has_audio:false}),/Silent/);
  assert.throws(()=>validateObservations({...raw,scenes:[{...raw.scenes[0],seconds:99}]},segment),/outside/);
  const silent={...raw,audio_access:false,scenes:[{...raw.scenes[0],audio:''}]};
  assert.equal(validateObservations(silent,{...segment,has_audio:false}).audio_access,false);
});

test('review rejects fabricated evidence, background citations, related IDs and human viewing claims',()=>{
  const r=row();assert.ok(validateReview(review(),evidence(),[r],r).review_text.length>1200);
  const missing=review();missing.sections[0].scene_refs=['9-99'];assert.throws(()=>validateReview(missing,evidence(),[r],r),/Unknown/);
  const bg=review();bg.sections[0].kind='background';assert.throws(()=>validateReview(bg,evidence(),[r],r),/Unsupported/);
  const invented=review();invented.recommendations=[{id:9999,reason:'Invented page'}];assert.throws(()=>validateReview(invented,evidence(),[r],r),/existing/);
  const fake=review();fake.sections[0].paragraphs.push('I personally watched this video.');assert.throws(()=>validateReview(fake,evidence(),[r],r),/authorship/);
});

test('available model IDs normalize correctly and a temporary failure uses only configured fallback',async()=>{
  const calls=[];let failures=0;
  const client=new GeminiClient({key:'not-a-real-key',wait:async()=>{},fetcher:async(url,options)=>{
    calls.push(String(url));assert.equal(options.headers['x-goog-api-key'],'not-a-real-key');assert.equal(options.redirect,'error');
    if(String(url).includes('/models?'))return Response.json({models:['gemini-test','gemini-fallback'].map(n=>({name:'models/'+n,supportedGenerationMethods:['generateContent']}))});
    if(String(url).includes('/gemini-test:')){failures++;return new Response('',{status:503});}
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"ok":true}'}]}}]});
  }});
  const models=await client.models(['gemini-test','gemini-fallback']);assert.deepEqual(models,['gemini-test','gemini-fallback']);
  assert.equal((await client.generate(models,[{text:'test'}])).model,'gemini-fallback');assert.equal(failures,2);
  await assert.rejects(client.request('https://evil.test/upload'),/Untrusted/);assert.equal(calls.length,4);
});

test('grounding accepts only actually cited HTTPS chunks',()=>{
  const g=groundingSources({value:'background',grounding:{groundingChunks:[{web:{uri:'https://example.com/official',title:'Official'}},{web:{uri:'https://example.com/unused'}},{web:{uri:'javascript:alert(1)'}}],
    groundingSupports:[{groundingChunkIndices:[0,2],segment:{text:'A supported fact.'}}],searchEntryPoint:{renderedContent:'<p>Search</p>'}}});
  assert.equal(g.sources.length,1);assert.equal(g.sources[0].supported_text,'A supported fact.');assert.equal(g.status,'grounded');
  assert.equal(groundingSources({value:'Unsupported prose'}).status,'no_citable_sources');
});

test('uploaded Gemini files are journaled before failed processing and deleted without leaking credentials',async()=>{
  const work=await mkdtemp(join(tmpdir(),'av-upload-'));const file=join(work,'segment.mp4'),journal=join(work,'owned-files.json');
  await writeFile(file,'fixture-video');const calls=[];
  const client=new GeminiClient({key:'fixture-secret',journal,wait:async()=>{},fetcher:async(url,options)=>{
    const u=String(url);calls.push({url:u,method:options.method});assert.ok(!u.includes('fixture-secret'));
    if(u.endsWith('/upload/v1beta/files'))return new Response('',{headers:{'x-goog-upload-url':'https://generativelanguage.googleapis.com/upload/session'}});
    if(u.endsWith('/upload/session'))return Response.json({file:{name:'files/owned-file',state:'PROCESSING',uri:'https://generativelanguage.googleapis.com/v1beta/files/owned-file'}});
    if(options.method==='DELETE')return new Response('',{status:200});
    return Response.json({name:'files/owned-file',state:'FAILED'});
  }});
  try{
    await assert.rejects(client.upload(file),/did not become active/);
    assert.deepEqual(JSON.parse(await readFile(journal,'utf8')),['files/owned-file']);await client.cleanup();
    assert.deepEqual(JSON.parse(await readFile(journal,'utf8')),[]);assert.equal(calls.at(-1).method,'DELETE');
    await assert.rejects(client.removeFile('files/someone-elses-file'),/unowned/);
  }finally{await rm(work,{recursive:true,force:true});}
});

test('read-only catalog performs a single bounded SELECT and never retries a quota failure',async()=>{
  let calls=0;
  const fetcher=async(url,opts)=>{calls++;const query=JSON.parse(opts.body).sql;assert.match(query,/^SELECT /);assert.match(query,/LIMIT 1001/);assert.doesNotMatch(query,/INSERT|UPDATE|DELETE|CREATE/);
    return Response.json({success:true,result:[{results:[row()],meta:{rows_written:0,rows_read:1}}]});};
  assert.equal((await exportCatalog({token:'fixture',account:'a'.repeat(32),fetcher})).meta.rows_written,0);assert.equal(calls,1);
  calls=0;await assert.rejects(exportCatalog({token:'fixture',account:'a'.repeat(32),fetcher:async()=>{calls++;return new Response('',{status:429});}}),/no retry/);assert.equal(calls,1);
});

test('guarded SQL detects stale edits, changes one row and preserves dates, sources and counters',()=>{
  const db=new DatabaseSync(':memory:');const r={...row(),views:77,reaction_count:9,comments_count:2};
  const keys=Object.keys(r);db.exec('CREATE TABLE videos ('+keys.map(k=>`${k} ${typeof r[k]==='number'?'INTEGER':'TEXT'}`).join(',')+')');
  db.prepare('INSERT INTO videos VALUES ('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>r[k]));
  const after={...r,description:"A creator's new description.",review_text:'New verified editorial content.'};
  db.exec(guardedSql({...r,review_text:'stale'},after));assert.equal(db.prepare('SELECT changes() n').get().n,0);
  db.exec(guardedSql(r,after));assert.equal(db.prepare('SELECT changes() n').get().n,1);
  const saved=db.prepare('SELECT * FROM videos').get();for(const k of ['created_at','updated_at','slug','source_url','views','reaction_count','comments_count'])assert.equal(saved[k],r[k]);
  db.exec(guardedSql(after,r));assert.equal(db.prepare('SELECT review_text FROM videos').get().review_text,r.review_text);db.close();
});

test('captured frame honors owner edits and rejects forged metadata and non-source artwork',()=>{
  const r=row(),image={kind:'video_frame',seconds:1,sourceDuration:3,source_sha256:'a'.repeat(64),sha256:'b'.repeat(64),path:`/review-source-images/${r.id}-${'b'.repeat(16)}.jpg`,
    sourceUrl:r.source_url,expectedThumbnail:r.thumbnail_url,bytes:1234,width:640,height:360,caption:'Frame from reviewed video.'};
  assert.equal(capturedReviewFrame(r,image,r.thumbnail_url,'https://vid.best').kind,'video_frame');
  for(const changed of [{thumbnail_url:'https://example.com/new.jpg'},{source_url:'https://youtu.be/zyxwvutsrqp'},{published:0},{id:4}])assert.equal(capturedReviewFrame({...r,...changed},image,r.thumbnail_url,'https://vid.best'),null);
  assert.equal(capturedReviewFrame(r,{...image,seconds:4},r.thumbnail_url,'https://vid.best'),null);
  assert.equal(capturedReviewFrame(r,{...image,path:'/../private'},r.thumbnail_url,'https://vid.best'),null);
});

test('background citations are escaped and stale paired reviews hide source widgets',()=>{
  const escape=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const r=row(),art={grounding:{reviewText:r.review_text,sources:[{url:'https://example.com/credit',title:'<script>unsafe</script>'},{url:'javascript:alert(1)'}],searchEntryPoint:'<style>p{color:red}</style><p>Search</p>'}};
  const html=reviewGrounding(r,art,escape);assert.ok(html.includes('sandbox="allow-popups allow-popups-to-escape-sandbox"'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('javascript:'));
  assert.equal(reviewGrounding({...r,review_text:'Owner revision'},art,escape),'');
});

test('category period shortlists require three distinct evidence-qualified reviews and retain date basis',()=>{
  const rows=[row(31),row(32),row(33)];const packages=rows.map(r=>({status:'ready_for_editorial_review',baseline:baseline(r),review:{verdict:'Specific rationale'}}));
  assert.equal(collectionProposals(packages.slice(0,2),rows).length,0);
  const lists=collectionProposals(packages,rows);assert.equal(lists.length,2);assert.ok(lists.every(l=>l.items.length===3&&l.date_basis.includes('Asia/Colombo')));
  assert.equal(collectionProposals(packages,rows.map(r=>({...r,review_text:'Changed'}))).length,0);
});

test('a blocked media pipeline cleans temporary local and provider files, with no partial artifact',async()=>{
  const out=await mkdtemp(join(tmpdir(),'av-test-'));let work,cleaned=0;
  const media={acquire:async(r,w)=>{work=w;await writeFile(join(w,'private.mp4'),'raw');throw Error('Source blocked');}};
  await assert.rejects(analyzeRecord(row(),[row()],{out,models:['gemini-test'],client:{cleanup:async()=>{cleaned++;}},media}),/Source blocked/);
  assert.ok(cleaned>0);await assert.rejects(access(work));assert.deepEqual(await readdir(out),[]);await rm(out,{recursive:true,force:true});
});

test('full package and source preparation preserve identities and reject an edited catalog baseline',async()=>{
  const out=await mkdtemp(join(tmpdir(),'av-package-'));const root=await mkdtemp(join(tmpdir(),'av-repo-'));
  let work;const jpeg=Buffer.from('ffd8'+('ab'.repeat(500)),'hex'),webp=Buffer.from('RIFF-fixture-WEBP');
  const meta=bytes=>({sha256:sha256(bytes),bytes:bytes.length,width:640,height:360});
  const media={acquire:async(r,w)=>{work=w;await writeFile(join(w,'source.mp4'),'temporary');return {path:join(w,'source.mp4'),duration:3,has_audio:true,sha256:'a'.repeat(64)};},
    segments:async()=>[{...segment,path:'fixture.mp4'}],capture:async(s,t,d)=>{await writeFile(d,jpeg);return {...meta(jpeg),seconds:t,kind:'video_frame',source_sha256:s.sha256};},
    illustration:async(c,m,f,p,w,d)=>{await writeFile(d,webp);return {...meta(webp),kind:'conceptual_anime',caption:'Conceptual illustration, not a frame.',displayWatermark:'vid.best'};}};
  const client={upload:async()=>({name:'files/test',uri:'https://generativelanguage.googleapis.com/v1beta/files/test'}),removeFile:async()=>{},cleanup:async()=>{},generate:async(models,parts,opts)=>{
    if(parts[0].fileData)return {model:'gemini-test',value:structuredClone(raw)};
    if(opts?.search)return {model:'gemini-test',value:'No reliable external credits found.'};
    if(parts[0].inlineData)return {model:'gemini-test',value:{usable:true,matches_observation:true}};
    return {model:'gemini-test',value:review()};
  }};
  try{
    const r=row();const p=await analyzeRecord(r,[r],{out,models:['gemini-test'],imageModels:['gemini-image-test'],client,media});
    assert.equal(p.status,'ready_for_editorial_review');assert.equal(p.cleanup.local_video_deleted,true);await assert.rejects(access(work));
    const files=await readdir(join(out,String(r.id)));assert.ok(files.every(f=>/\.json$|\.jpg$|\.webp$/.test(f)));
    await mkdir(join(root,'src'));await mkdir(join(root,'docs'));
    await writeFile(join(root,'src/review-illustrations.json'),'[]');await writeFile(join(root,'docs/review-illustration-prompts.json'),'{"images":[]}');
    const prepared=join(out,'prepared');await mkdir(prepared);
    await prepare({packageFile:join(out,String(r.id),'package.json'),catalog:[r],root,out:prepared});
    const entry=JSON.parse(await readFile(join(prepared,'src/review-illustrations.json'),'utf8'))[0];
    assert.equal(entry.sourceImage.kind,'video_frame');assert.equal(entry.sourceImage.sourceDuration,3);
    assert.equal(capturedReviewFrame(r,entry.sourceImage,r.thumbnail_url,'https://vid.best').url,'https://vid.best'+p.images.frame.path);
    const sql=await readFile(join(prepared,'guarded-update.sql'),'utf8');assert.ok(!/SET[^;]*(?:created_at|updated_at)\s*=/.test(sql.split(' WHERE ')[0]));
    // Exercise the actual renderer and both sitemap families with this prepared manifest.
    await cp(new URL('../src/',import.meta.url),join(prepared,'src'),{recursive:true,force:false,errorOnExist:false});
    await cp(new URL('../public/instagram-utils.js',import.meta.url),join(prepared,'public/instagram-utils.js'));
    await mkdir(join(prepared,'content/daily-weekly-best'),{recursive:true});
    await cp(new URL('../content/daily-weekly-best/catalog.json',import.meta.url),join(prepared,'content/daily-weekly-best/catalog.json'));
    // cp preserves the already prepared manifest when force=false.
    await writeFile(join(prepared,'package.json'),'{"type":"module"}');
    const worker=(await import(pathToFileURL(join(prepared,'src/seo-edge.js')).href)).default;
    const db=new DatabaseSync(':memory:');
    for(const name of ['0001_initial.sql','0002_discovery_requests.sql','0003_security_rate_limits.sql','0004_maintenance_indexes.sql','0005_source_video_metadata.sql',
      '0006_test_player_and_comment_images.sql','0007_universal_video_experience.sql','0008_verified_demo_metadata.sql','0009_app_settings.sql','0010_video_analysis.sql','0011_spirituality_buddhism.sql','0022_facebook_readable_slugs.sql','0030_facebook_preview_jobs.sql']){
      db.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
    }
    db.prepare('INSERT INTO videos (id,slug,title,source_url,embed_url,media_type,primary_category,subcategory,description,review_text,thumbnail_url,published,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(r.id,r.slug,r.title,r.source_url,'https://www.youtube-nocookie.com/embed/abcdefghijk','youtube','Music','Music Videos',p.review.description,p.review.review_text,r.thumbnail_url,1,r.created_at,r.updated_at);
    db.prepare('INSERT INTO video_source_metadata (video_id,source_published_at) VALUES (?,?)').run(r.id,'2020-01-01T00:00:00Z');
    const statement=(sql,params=[])=>({bind:(...args)=>statement(sql,args),first:async()=>db.prepare(sql).get(...params)||null,all:async()=>({results:db.prepare(sql).all(...params)}),run:async()=>({success:true,...db.prepare(sql).run(...params)})});
    const env={DB:{prepare:sql=>statement(sql)},APP_NAME:'Vid.Best',PUBLIC_BASE_URL:'https://vid.best'};
    const get=async path=>{const response=await worker.fetch(new Request('https://vid.best'+path,{headers:{'User-Agent':'VidBest-SEO-Audit/1.0'}}),env,{waitUntil(){}});assert.equal(response.status,200);return response.text();};
    const html=await get('/watch/'+r.slug);
    assert.ok(html.includes('src="https://vid.best'+p.images.frame.path+'"'));assert.ok(html.includes('src="https://vid.best'+p.images.artwork.path+'"'));
    const graph=JSON.parse(html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1])['@graph'];
    assert.equal(graph.find(x=>x['@type']==='Article').image.length,2);assert.equal(graph.find(x=>x['@type']==='Article').datePublished,r.created_at);
    assert.deepEqual(graph.find(x=>x['@type']==='VideoObject').thumbnailUrl,[r.thumbnail_url]);
    const sourceMap=await get('/sitemaps/images-source-1.xml'),artMap=await get('/sitemaps/images-editorial-1.xml'),videoMap=await get('/sitemaps/videos-1.xml');
    assert.ok(sourceMap.includes(p.images.frame.path));assert.ok(artMap.includes(p.images.artwork.path));assert.ok(videoMap.includes(p.images.frame.path)&&videoMap.includes(p.images.artwork.path));
    assert.ok(videoMap.includes('<video:thumbnail_loc>'+r.thumbnail_url+'</video:thumbnail_loc>'));db.close();
    await assert.rejects(prepare({packageFile:join(out,String(r.id),'package.json'),catalog:[{...r,description:'New owner description'}],root,out:prepared}),/Stale/);
  }finally{await rm(out,{recursive:true,force:true});await rm(root,{recursive:true,force:true});}
});

const hasFfmpeg=spawnSync('ffmpeg',['-version'],{stdio:'ignore'}).status===0;
test('real FFmpeg retains video, audio and timeline; captures a real JPEG and denies uncertified copies',{skip:!hasFfmpeg},async()=>{
  const work=await mkdtemp(join(tmpdir(),'av-ffmpeg-'));const input=join(work,'fixture.mp4');
  try{
    await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=12','-f','lavfi','-i','sine=frequency=440:sample_rate=22050','-t','2','-c:v','libx264','-c:a','aac','-shortest',input]);
    await assert.rejects(acquire({...row(),redistribution_certified:0},work,{localFile:input}),/permission/);
    const source=await acquire(row(),work,{localFile:input});const parts=await segments(source,work);assert.equal(parts.length,1);assert.equal(parts[0].has_audio,true);assert.ok(Math.abs(parts[0].duration-2)<0.2);
    const still=await capture(source,1,join(work,'frame.jpg'));assert.equal(still.width,320);assert.equal((await readFile(join(work,'frame.jpg'))).readUInt16BE(0),0xffd8);
  }finally{await rm(work,{recursive:true,force:true});}
});
