import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import catalog from '../content/daily-weekly-best/catalog.json' with {type:'json'};
import seoEdge from '../src/seo-edge.js';
import {dailyWeeklyBestPaths} from '../src/daily-weekly-best.js';
import {renderMarkdown,build} from '../scripts/build-daily-weekly-best.mjs';
import {publishEditorialDiscovery} from '../scripts/publish-daily-weekly-best.mjs';
import {verifyEditorialSources} from '../scripts/verify-daily-weekly-best-sources.mjs';
import {syncSearchConsole,publicUrl} from '../scripts/search-console-audit.mjs';

const origin='https://vid.best';
function assetsEnv() {
  return {DB:{prepare(){throw new Error('Editorial pages must not access existing video data');}},ASSETS:{async fetch(request){
    const path=new URL(request.url).pathname.replace(/\.html$/,'');
    const text=await readFile(new URL('../public'+path+'.html',import.meta.url),'utf8');
    return new Response(text,{headers:{'content-type':'text/html; charset=utf-8'}});
  }}};
}
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

test('all editorial pages serve full canonical HTML and HEAD without touching the video database',async()=>{
  for(const path of dailyWeeklyBestPaths){
    const response=await seoEdge.fetch(new Request(origin+path),assetsEnv(),{});
    assert.equal(response.status,200);
    assert.match(response.headers.get('x-robots-tag'),/^index,follow/);
    assert.match(response.headers.get('content-security-policy'),/frame-src https:\/\/www\.youtube-nocookie\.com/);
    const html=await response.text();
    assert.ok(html.includes(`<link rel="canonical" href="${origin+path}">`));
    assert.match(html,/<h1>/);
    const head=await seoEdge.fetch(new Request(origin+path,{method:'HEAD'}),assetsEnv(),{});
    assert.equal(head.status,200);assert.equal(await head.text(),'');
  }
});

test('canonical aliases redirect and unknown editorial routes never become the homepage',async()=>{
  for(const suffix of ['.html','/']){
    const response=await seoEdge.fetch(new Request(origin+'/daily-weekly-best/films'+suffix),assetsEnv(),{});
    assert.equal(response.status,301);assert.equal(response.headers.get('location'),origin+'/daily-weekly-best/films');
  }
  for(const path of ['/daily-weekly-best/private','/daily-weekly-best/films/extra','/daily-weekly-bests']){
    const response=await seoEdge.fetch(new Request(origin+path),assetsEnv(),{});
    assert.equal(response.status,404);assert.match(response.headers.get('x-robots-tag'),/noindex/);
  }
  const denied=await seoEdge.fetch(new Request(origin+'/daily-weekly-best',{method:'POST'}),assetsEnv(),{});
  assert.equal(denied.status,405);
  const query=await seoEdge.fetch(new Request(origin+'/daily-weekly-best?tracking=example'),assetsEnv(),{});
  assert.equal(query.status,200);assert.equal(query.headers.get('x-robots-tag'),'noindex,follow');
});

test('home exposes just the footer access link and keeps editorial selections out of its main grid',async()=>{
  const home=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const main=home.match(/<main\b[\s\S]*?<\/main>/)[0];
  assert.doesNotMatch(main,/daily-weekly-best|daily-weekly-covers|Hexed|Dune: Part Three/);
  const footer=home.match(/<footer\b[\s\S]*?<\/footer>/)[0];
  assert.match(footer,/<a href="\/daily-weekly-best">Daily Weekly Best<\/a>/);
  assert.equal((home.match(/href="\/daily-weekly-best"/g)||[]).length,1);
});

test('review documents distinguish original video dates, article dates, symbolic covers and source ownership',async()=>{
  for(const item of catalog.reviews){
    const html=await readFile(new URL('../public/daily-weekly-best/'+item.slug+'.html',import.meta.url),'utf8');
    const graph=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
    const article=graph.find(row=>row['@type']==='Article'),video=graph.find(row=>row['@type']==='VideoObject');
    assert.ok(article.wordCount>=3000);
    assert.equal(article.datePublished,catalog.publishedAt);
    assert.equal(video.uploadDate,item.sourcePublishedAt);
    assert.equal(video.embedUrl,'https://www.youtube-nocookie.com/embed/'+item.videoId);
    assert.equal(video.creator.name,item.publisher);
    assert.equal(video.thumbnailUrl,'https://i.ytimg.com/vi/'+item.videoId+'/hqdefault.jpg');
    assert.equal(video.contentUrl,undefined);assert.equal(video.isLiveBroadcast,undefined);
    assert.doesNotMatch(html,/Last updated|dateModified|aggregateRating|reviewRating/);
    assert.match(html,/Illustrated editorial cover/);
    assert.match(html,/<p class="dwb-basis">[^<]{30,}<\/p>/);
  }
});

test('sitemap exposes fourteen public editorial pages and the hub links every review',async()=>{
  const response=await seoEdge.fetch(new Request(origin+'/sitemaps/daily-weekly-best.xml'),assetsEnv(),{});
  const xml=await response.text();
  const urls=[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match=>match[1]);
  assert.equal(urls.length,14);assert.equal(new Set(urls).size,14);
  const hub=await readFile(new URL('../public/daily-weekly-best.html',import.meta.url),'utf8');
  for(const item of catalog.reviews)assert.ok(hub.includes('href="/daily-weekly-best/'+item.slug+'"'));
  for(const url of urls)assert.equal(publicUrl(url),url);
});

test('Markdown cannot inject markup, and committed pages match their complete source documents',async()=>{
  const {html}=renderMarkdown('## <img src=x onerror=alert(1)>\n\n<script>alert(1)</script>');
  assert.doesNotMatch(html,/<img|<script/);assert.match(html,/&lt;script&gt;/);
  assert.equal((await build({check:true})).length,10);
});

test('editorial discovery fails closed before any Google call unless all live public checks pass',async()=>{
  let called=false;
  for(const report of [{publicAuditStatus:'failed',pages:[]},{publicAuditStatus:'success',pages:[]}]){
    await assert.rejects(publishEditorialDiscovery(report,{getToken:async()=>{called=true;}}),/editorial_public_verification_required/);
  }
  assert.equal(called,false);
});

test('verified editorial publication submits only root and editorial maps and inspects only ten new reviews',async()=>{
  const calls=[];
  const report={publicAuditStatus:'success',pages:dailyWeeklyBestPaths.map(path=>({url:origin+path,getStatus:200,headStatus:200,errors:[]}))};
  const result=await publishEditorialDiscovery(report,{secret:'configured',getToken:async()=>'private-sentinel',wait:async()=>{},now:0,
    fetchImpl:async(url,options)=>{
      calls.push({url,method:options.method||'GET'});
      if(options.method==='PUT')return new Response(null,{status:204});
      if(options.method==='POST'){
        const page=JSON.parse(options.body).inspectionUrl;
        assert.ok(catalog.reviews.some(item=>page===origin+'/daily-weekly-best/'+item.slug));
        return json({inspectionResult:{indexStatusResult:{verdict:'NEUTRAL',coverageState:'URL is unknown to Google',userCanonical:page}}});
      }
      return url.includes('/sitemaps/')?json({path:decodeURIComponent(url.split('/sitemaps/')[1]),isPending:true,errors:'0'}):json({permissionLevel:'siteOwner'});
    }});
  assert.equal(result.status,'success');assert.equal(result.inspections.length,10);
  assert.equal(calls.filter(call=>call.method==='PUT').length,2);
  assert.ok(calls.every(call=>!call.url.includes('indexing.googleapis.com')&&!call.url.includes('videos-1')));
  assert.doesNotMatch(JSON.stringify(result),/private-sentinel/);
});

test('ordinary editorial diagnostic remains read-only and collection pages spend no inspection quota',async()=>{
  let posts=0,puts=0;
  const result=await syncSearchConsole([origin+'/daily-weekly-best',origin+'/daily-weekly-best/films',origin+'/daily-weekly-best/harry-potter-new-school-year'],{
    secret:'configured',budget:10,submitSitemaps:false,getToken:async()=>'test',wait:async()=>{},
    fetchImpl:async(url,options)=>{
      if(options.method==='PUT')puts++;
      if(options.method==='POST'){posts++;return json({inspectionResult:{indexStatusResult:{verdict:'NEUTRAL'}}});}
      return url.includes('/sitemaps/')?json({path:origin+'/sitemap.xml',isPending:false}):json({permissionLevel:'siteOwner'});
    }});
  assert.equal(puts,0);assert.equal(posts,1);assert.equal(result.inspections.length,1);
});

test('source verification rejects HTML masquerading as a successful poster and never stores response bodies',async()=>{
  const result=await verifyEditorialSources({fetchImpl:async(url,options)=>{
    assert.equal(options.headers,undefined);
    if(url.includes('oembed')){
      const source=new URL(new URL(url).searchParams.get('url'));
      const item=catalog.reviews.find(row=>row.videoId===source.searchParams.get('v'));
      return json({title:item.videoTitle,author_name:item.publisher,html:'<iframe src="https://www.youtube.com/embed/'+item.videoId+'"></iframe>'});
    }
    return new Response('<html>private-sentinel</html>',{headers:{'content-type':'text/html'}});
  }});
  assert.equal(result.status,'failed');assert.equal(result.records.length,10);
  assert.ok(result.records.every(row=>!row.verified&&row.error==='source_poster_unavailable'));
  assert.doesNotMatch(JSON.stringify(result),/private-sentinel/);
});
