import test from "node:test";
import assert from "node:assert/strict";
import {capturePublishedD1ToR2,maybeCapturePublishedD1} from "../src/d1-r2-capture.js";

const sample=[
 {id:2,slug:"new-review",title:"New review",description:"New",review_text:"<script>unsafe</script> Review",media_type:"youtube",primary_category:"Music",published:1,created_at:"2026-10-23T00:00:00Z",updated_at:"2026-10-23T00:00:00Z",views:2,featured:0,trending:1},
 {id:1,slug:"older-review",title:"Old review",description:"Old",review_text:"Reviewed",media_type:"youtube",primary_category:"Technology",published:1,created_at:"2026-10-22T00:00:00Z",updated_at:"2026-10-22T00:00:00Z",views:1,featured:1,trending:0},
];
const capturedAt=new Date().toISOString();
const key="vidbest-resilience-20261023/20261023T1210Z/published-library.json";
function remoteBucket(records=sample,daysOld=0) {
 const t=new Date(Date.now()-daysOld*86400000).toISOString();
 const pointer={format:"vidbest-public-library-pointer-v1",record_count:records.length,captured_at:t,object_key:key};
 const lib={format:"vidbest-public-video-library-v1",record_count:records.length,captured_at:t,records:records.map(r=>({...r,published:true}))};
 return {async get(k){
   const value=k==="vidbest-resilience-public/latest.json"?pointer:k===key?lib:null;
   return value?{size:JSON.stringify(value).length,json:async()=>value}:null;
 }};
}
function req(path,headers){return new Request("https://vid.best"+path,{headers});}
async function moduleForTest(n){return import("../src/d1-r2-emergency.js?case="+n);}

test("published anonymous /api/videos survives D1 failure with proper filters",async()=>{
 const {emergencyPublicFallback:f}=await moduleForTest("listing");
 const r=await f(req("/api/videos?category=Music&limit=5"),{BUCKET:remoteBucket()});
 assert.equal(r.status,200);
 assert.equal(r.headers.get("X-VidBest-Fallback"),"r2-public-readonly");
 const v=await r.json();assert.equal(v.pagination.total,1);
 assert.equal(v.videos[0].id,2);assert.equal(v.videos[0].published,true);
});
test("watch review escapes user content and preserves canonical",async()=>{
 const {emergencyPublicFallback:f}=await moduleForTest("watch");
 const r=await f(req("/watch/new-review"),{BUCKET:remoteBucket()});
 assert.equal(r.status,200);const h=await r.text();
 assert.match(h,/&lt;script&gt;unsafe&lt;\/script&gt;/);
 assert.doesNotMatch(h,/<script>unsafe/);
 assert.match(h,/https:\/\/vid.best\/watch\/new-review/);
 assert.match(h,/Temporary read-only mode/);
});
test("authenticated, member, mutation, admin and cross-host requests never fallback",async()=>{
 const {emergencyPublicFallback:f}=await moduleForTest("auth");
 const env={BUCKET:remoteBucket()};
 assert.equal(await f(req("/api/videos",{Cookie:"x=y"}),env),null);
 assert.equal(await f(req("/api/videos",{Authorization:"Bearer x"}),env),null);
 assert.equal(await f(req("/api/admin/videos"),env),null);
 assert.equal(await f(new Request("https://vid.best/api/videos",{method:"POST"}),env),null);
 assert.equal(await f(new Request("https://other.example/api/videos"),env),null);
});
test("expired snapshot is rejected; multi-day stale HTML is noindex",async()=>{
 const exp=await moduleForTest("expired");
 assert.equal(await exp.emergencyPublicFallback(req("/api/videos"),{BUCKET:remoteBucket(sample,8)}),null);
 const stale=await moduleForTest("stale");
 const r=await stale.emergencyPublicFallback(req("/watch/older-review"),{BUCKET:remoteBucket(sample,2)});
 assert.equal(r.headers.get("X-Robots-Tag"),"noindex,follow");
});
test("unknown API filters are not silently ignored",async()=>{
 const {emergencyPublicFallback:f}=await moduleForTest("badfilter");
 assert.equal(await f(req("/api/videos?private=1"),{BUCKET:remoteBucket()}),null);
});
function state(){
 const objects=new Map(),calls={reads:0,writes:0};
 const DB={prepare(sql){
  if(/^(SELECT COUNT)/.test(sql))return {async first(){calls.reads++;return {total:2,maxid:2,lastmod:"2026-10-23T00:00:00Z"};}};
  if(/^SELECT id FROM videos/.test(sql))return {async first(){calls.reads++;return {id:2}}};
  if(/^SELECT v\.id/.test(sql))return {bind(){return {async all(){calls.reads++;return {results:sample};}}}};
  throw Error("Unexpected SQL statement");
 }};
 const BUCKET={
  async put(k,v){calls.writes++;objects.set(k,v);},
  async get(k){
   if(!objects.has(k))return null;
   const body=objects.get(k);
   return {size:body.length,text:async()=>body,json:async()=>JSON.parse(body)};
  }
 };
 return {env:{DB,BUCKET},calls,objects};
}
test("four-hourly snapshot uses D1 SELECT only and verifies immutable R2 data",async()=>{
 const s=state();
 const result=await capturePublishedD1ToR2(s.env,Date.parse("2026-10-24T00:00:00Z"));
 assert.equal(result.count,2);assert.equal(s.calls.writes,2);
 const p=JSON.parse(s.objects.get("vidbest-resilience-public/latest.json"));
 assert.equal(p.record_count,2);
 assert.ok(s.objects.has(p.object_key));
 const body=JSON.parse(s.objects.get(p.object_key));
 assert.ok(body.records.every(r=>r.published===true));
});
test("schedule only fires on guarded four-hour UTC boundary and environment flag",async()=>{
 const s=state();const pending=[];
 const ctx={waitUntil(p){pending.push(p)}};
 await maybeCapturePublishedD1({cron:"*/15 * * * *",scheduledTime:Date.parse("2026-10-24T01:00:00Z")},{...s.env,D1_PUBLIC_FALLBACK_CAPTURE:"1"},ctx);
 assert.equal(pending.length,0);
 await maybeCapturePublishedD1({cron:"*/15 * * * *",scheduledTime:Date.parse("2026-10-24T00:00:00Z")},{...s.env,D1_PUBLIC_FALLBACK_CAPTURE:"0"},ctx);
 assert.equal(pending.length,0);
 await maybeCapturePublishedD1({cron:"*/15 * * * *",scheduledTime:Date.parse("2026-10-24T00:00:00Z")},{...s.env,D1_PUBLIC_FALLBACK_CAPTURE:"1"},ctx);
 assert.equal(pending.length,1);await Promise.all(pending);
});
test("D1 failure cannot replace last good R2 pointer",async()=>{
 const s=state();
 s.objects.set("vidbest-resilience-public/latest.json",JSON.stringify({saved:"original"}));
 s.env.DB={prepare(){throw Error("D1 unavailable")}};
 await assert.rejects(capturePublishedD1ToR2(s.env),/D1 unavailable/);
 assert.equal(JSON.parse(s.objects.get("vidbest-resilience-public/latest.json")).saved,"original");
 assert.equal(s.calls.writes,0);
});
