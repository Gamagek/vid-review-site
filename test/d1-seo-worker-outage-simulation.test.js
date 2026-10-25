// Synthetic D1 outage at the real SEO Worker entrypoint; never touches production.
import test from "node:test";
import assert from "node:assert/strict";
import seoWorker from "../src/seo-edge.js";

const slug="simulated-d1-7500-review";
const captured=new Date(Date.now()-4*60*1000).toISOString();
const objKey="vidbest-resilience-public/slots/41.json";
const publicRecord={
 id: 99998,slug,title:"Simulated D1 outage test",description:"Offline synthetic test",
 review_text:"Synthetic public review: <script>not executable</script>",
 seo_title:"Simulated D1 recovery",seo_description:"Public SEO summary",
 created_at:"2026-10-22T00:00:00Z",updated_at:"2026-10-22T00:00:00Z",
 media_type:"youtube",source_url:"https://www.youtube.com/watch?v=fakesimulation",
 primary_category:"Music",published:true,featured:0,trending:0,views:0,
};
const pointer={format:"vidbest-public-library-pointer-v1",object_key:objKey,record_count:1,captured_at:captured};
const backup={format:"vidbest-public-video-library-v1",record_count:1,captured_at:captured,records:[publicRecord]};
const calls={queries:[],writes:[]};
const env={
 APP_NAME:"Vid.Best",
 DB:{prepare(sql){calls.queries.push(sql);throw Object.assign(new Error("D1_ERROR_7500 simulated read limit"),{code:7500})}},
 BUCKET:{
   async get(key){
     const data=key==="vidbest-resilience-public/latest.json"?pointer:
       key===objKey?backup:null;
     return data?{size:Buffer.byteLength(JSON.stringify(data)),json:async()=>data}:null;
   },
   async put(...args){calls.writes.push(args);throw Error("R2 PUT forbidden in outage test");},
 },
};
const ctx={waitUntil(p){if(p&&typeof p.catch==="function")p.catch(()=>{})}};
test("synthetic D1 7500: exact SEO Worker entrypoint serves existing public API listing",async()=>{
  const r=await seoWorker.fetch(new Request("https://vid.best/api/videos?limit=1"),env,ctx);
  assert.equal(r.status,200);
  assert.equal(r.headers.get("X-VidBest-Fallback"),"r2-public-readonly");
  const body=await r.json();
  assert.equal(body.pagination.total,1);
  assert.equal(body.videos[0].slug,slug);
  assert.equal(calls.writes.length,0);
});
test("synthetic D1 7500: exact SEO Worker entrypoint renders /watch HTML without script execution",async()=>{
  const r=await seoWorker.fetch(new Request("https://vid.best/watch/"+slug),env,ctx);
  assert.equal(r.status,200);
  assert.equal(r.headers.get("X-VidBest-Fallback"),"r2-public-readonly");
  const html=await r.text();
  assert.match(html,/Synthetic public review/);
  assert.match(html,/&lt;script&gt;not executable&lt;\/script&gt;/);
  assert.match(html,/rel="canonical"/);
  assert.equal(calls.writes.length,0);
});
test("synthetic D1 7500: cookie-bearing requests cannot receive public emergency snapshot",async()=>{
  let r;
  try {r=await seoWorker.fetch(new Request("https://vid.best/watch/"+slug,{headers:{Cookie:"__Host-vidbest_member=private"}}),env,ctx);}
  catch{return}
  assert.notEqual(r.headers.get("X-VidBest-Fallback"),"r2-public-readonly");
});
test("synthetic D1 7500: mutations cannot invoke emergency snapshot",async()=>{
  let r;
  try {r=await seoWorker.fetch(new Request("https://vid.best/api/videos",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}),env,ctx);}
  catch{return}
  assert.notEqual(r.headers.get("X-VidBest-Fallback"),"r2-public-readonly");
});
