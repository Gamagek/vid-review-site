import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeJuicerTikTokPost,juicerObjectKey,syncJuicerFeedCache,getJuicerCachedPost,
  getJuicerSyncState,juicerCachedMetadata,juicerCacheSyncEndpoint
} from "../src/juicer-feed-cache.js";

const post = (id="7698515511952395542") => ({
  id:511579834,external_id:id,platform:"TikTok",moderation_status:"public",
  url:"https://www.tiktok.com/@altxr.nate/video/"+id,
  message:"Trying not to laugh at these dad jokes 🤣 #dadjokes #funny",
  poster:{name:"altxr.nate",display_name:"Alter Nate"},
  external_created_at:"2026-10-19T15:52:18.000-07:00",media:[]
});
function mockBucket() {
  const map = new Map();let puts=0;
  return { map,
    get:async key=> map.has(key)?{json:async()=>JSON.parse(map.get(key))}:null,
    put:async (key,value)=>{puts++;map.set(key,String(value));},
    get puts(){return puts}
  };
}
test("normalises only public TikTok videos into safe canonical official embed",()=>{
 const v=normalizeJuicerTikTokPost(post());
 assert.equal(v.video_id,"7698515511952395542");
 assert.equal(v.source_url,"https://www.tiktok.com/@altxr.nate/video/7698515511952395542");
 assert.equal(v.embed_url,"https://www.tiktok.com/player/v1/7698515511952395542");
 assert.match(v.embed_html, /loading="lazy"/);
 assert.ok(!JSON.stringify(v).includes("poster_images.jpg"));
 assert.ok(!JSON.stringify(v).includes("media"));
 assert.equal(normalizeJuicerTikTokPost({...post(),moderation_status:"rejected"}),null);
 assert.equal(normalizeJuicerTikTokPost({...post(),external_id:"not-canonical"}),null);
 assert.equal(normalizeJuicerTikTokPost({...post(),url:"https://evil.com/@altxr.nate/video/7698515511952395542"}),null);
 assert.equal(normalizeJuicerTikTokPost({...post(),url:"https://www.tiktok.com/@a/video/7698515511952395542?x=tracking"}),null);
 assert.throws(()=>juicerObjectKey("../../foo"));
});
test("sync persists id-based R2 snapshots, 24h cooldown and preserves records after feed source removal",async()=>{
 const bucket=mockBucket(),env={BUCKET:bucket,JUICER_API_KEY:"test-only",JUICER_FEED_ID:"460118"};
 const realFetch=globalThis.fetch;let calls=0;let feed=[post()];
 globalThis.fetch=async (url,init)=>{
   calls++;
   assert.equal(new URL(url).host,"api.juicer.io");
   assert.equal(init.headers.Authorization,"Bearer test-only");
   return Response.json({data:feed,meta:{total_pages:1,page:1}});
 };
 try {
   let a=await syncJuicerFeedCache(env);
   assert.equal(a.ok,true);assert.equal(a.last_batch.saved,1);
   assert.equal((await getJuicerCachedPost(env,"7698515511952395542")).creator_name,"Alter Nate");
   assert.equal((await getJuicerSyncState(env)).next_page,1);
   assert.equal(calls,1);
   let b=await syncJuicerFeedCache(env);
   assert.equal(b.skipped,true);assert.equal(calls,1);
   feed=[];
   b=await syncJuicerFeedCache(env,{force:true});
   assert.equal(b.last_batch.saved,0);assert.equal(calls,2);
   assert.equal((await getJuicerCachedPost(env,"7698515511952395542")).caption,post().message,
     "snapshot survives after the original source no longer returns this post");
   const out=await juicerCachedMetadata(new Request("https://vid.best/api/tiktok/juicer-cache/7698515511952395542"),env,"7698515511952395542");
   assert.equal(out.status,200);
   assert.equal((await out.json()).video.embed_url,"https://www.tiktok.com/player/v1/7698515511952395542");
 }finally{globalThis.fetch=realFetch}
});
test("sync skips safely without secret or R2 and denies unauthenticated data fetch",async()=>{
 const r=await syncJuicerFeedCache({BUCKET:mockBucket()});
 assert.equal(r.skipped,true);assert.match(r.reason,/JUICER_API_KEY/);
 assert.equal((await syncJuicerFeedCache({JUICER_API_KEY:"unused"})).skipped,true);
 assert.equal((await juicerCachedMetadata(new Request("https://vid.best/api/tiktok/juicer-cache/notvalid"),{BUCKET:mockBucket()},"nope")).status,400);
 const admin=await juicerCacheSyncEndpoint(new Request("https://vid.best/api/admin/juicer-cache/sync",{method:"POST"}),{BUCKET:mockBucket()});
 assert.equal(admin.status,503);
});
test("large feeds resume pagination from saved R2 state, without duplicate object writes",async()=>{
 const bucket=mockBucket();const env={BUCKET:bucket,JUICER_API_KEY:"test-only",JUICER_FEED_ID:"460118"};
 const realFetch=globalThis.fetch;let requests=[];
 globalThis.fetch=async url=>{
  let page=Number(new URL(url).searchParams.get("page"));requests.push(page);
  return Response.json({data:[post(String(7698515511952395542n+BigInt(page)))],meta:{total_pages:5}});
 };
 try{
  const a=await syncJuicerFeedCache(env,{maxPages:2});
  assert.deepEqual(requests,[1,2]);assert.equal(a.next_page,3);assert.equal(a.completed,false);
  const b=await syncJuicerFeedCache(env,{force:true,resume:true,maxPages:3});
  assert.deepEqual(requests,[1,2,3,4,5]);assert.equal(b.completed,true);assert.equal(b.next_page,1);
  assert.equal((await getJuicerCachedPost(env,"7698515511952395547")).video_id,"7698515511952395547");
 }finally{globalThis.fetch=realFetch}
});
