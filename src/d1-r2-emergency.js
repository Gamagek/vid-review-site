// Emergency *public* read-only listing/watch fallback. Never run for members/admins/mutations.
// Immutable R2 library is verified before its pointer is advanced. Oracle remains separate.
const POINTER="vidbest-resilience-public/latest.json";
let memo=null;
const H=7*86400000, F=86400000;
const fields=["id","slug","title","description","review_text","seo_title","seo_description","seo_tags","thumbnail_url","source_url","source_page_url","embed_url","media_type","r2_key","primary_category","subcategory","created_at","updated_at","featured","trending","views","reaction_count","published","source_published_at","source_duration"];
function esc(value){return String(value??"").slice(0,70000).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));}
function allowed(request){
  if(request.method!=="GET"||request.headers.has("Cookie")||request.headers.has("Authorization"))return false;
  const u=new URL(request.url);
  if(u.protocol!=="https:"||u.hostname!=="vid.best")return false;
  return u.pathname==="/api/videos"||/^\/api\/videos\/[a-z0-9_-]+$/.test(u.pathname)||/^\/watch\/[a-z0-9_-]+$/.test(u.pathname)||u.pathname==="/videos"||/^\/category\/[a-z0-9-]+$/.test(u.pathname);
}
async function snapshot(env){
  if(!env.BUCKET?.get)return null;
  if(memo&&Date.now()-memo.at<60000)return memo.value;
  let value=null;
  try{
    const p=await env.BUCKET.get(POINTER);
    if(!p||p.size>10000)return null;
    const meta=await p.json(), age=Date.now()-Date.parse(meta.captured_at);
    if(meta.format!=="vidbest-public-library-pointer-v1"||!Number.isSafeInteger(meta.record_count)||meta.record_count<1||meta.record_count>5000||!Number.isFinite(age)||age<0||age>H||!/^vidbest-resilience-(?:20261023\/\d{8}T\d{4}Z\/published-library\.json|public\/slots\/\d{2}\.json)$/.test(meta.object_key||""))return null;
    const o=await env.BUCKET.get(meta.object_key);
    if(!o||o.size>5000000)return null;
    const b=await o.json();
    if(b.format!=="vidbest-public-video-library-v1"||b.captured_at!==meta.captured_at||!Array.isArray(b.records)||b.records.length!==meta.record_count||b.record_count!==meta.record_count)return null;
    const ids=new Set();
    for(const v of b.records){
      if(!v||!Number.isSafeInteger(v.id)||v.id<1||typeof v.slug!=="string"||!/^[a-z0-9-]+$/.test(v.slug)||v.published!==true||ids.has(v.id))return null;
      ids.add(v.id);
    }
    value={records:b.records,age};
  }catch{}
  memo={at:Date.now(),value};
  return value;
}
function headers(type,age,html=false){
  return {"Content-Type":type,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-VidBest-Fallback":"r2-public-readonly","X-VidBest-Snapshot-Age-Seconds":String(Math.floor(age/1000)),...(age>F?{"X-Robots-Tag":"noindex,follow"}:{}),...(html?{"Content-Security-Policy":"default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'none'; connect-src 'self'"}:{})};
}
function safeUrl(raw){try{const u=new URL(String(raw||""),"https://vid.best");return u.protocol==="https:"&&!u.username&&!u.password?u.href:"";}catch{return "";}}
function video(v){
  let tags=[];try{tags=JSON.parse(v.seo_tags||"[]");}catch{}if(!Array.isArray(tags))tags=[];
  return {...Object.fromEntries(fields.map(k=>[k,v[k]??null])),featured:Boolean(v.featured),trending:Boolean(v.trending),published:true,provider:String(v.media_type||"embed"),seo_tags:tags,reactions:{like:0,love:0,useful:0},reactions_unavailable:true};
}
function list(u,rows){
  const permitted=new Set(["category","subcategory","q","sort","featured","trending","limit","offset"]);
  if([...u.searchParams.keys()].some(k=>!permitted.has(k)||u.searchParams.getAll(k).length!==1))return null;
  const cat=u.searchParams.get("category")||"",sub=u.searchParams.get("subcategory")||"",q=(u.searchParams.get("q")||"").toLowerCase();
  if(q.length>120)return null;
  const items=rows.filter(v=>(!cat||v.primary_category===cat)&&(!sub||v.subcategory===sub)&&(!q||[v.title,v.description,v.seo_tags].some(s=>String(s||"").toLowerCase().includes(q)))&&(u.searchParams.get("featured")!=="1"||Boolean(v.featured))&&(u.searchParams.get("trending")!=="1"||Boolean(v.trending)));
  const newest=(a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||""))||b.id-a.id;
  const sort=u.searchParams.get("sort")||"newest";
  items.sort((a,b)=>sort==="popular"?Number(b.views||0)-Number(a.views||0)||newest(a,b):sort==="reactions"?Number(b.reaction_count||0)-Number(a.reaction_count||0)||newest(a,b):sort==="trending"?Number(b.trending||0)-Number(a.trending||0)||Number(b.reaction_count||0)-Number(a.reaction_count||0)||newest(a,b):newest(a,b));
  const limit=Math.max(1,Math.min(48,parseInt(u.searchParams.get("limit")||"18",10)||18)),offset=Math.max(0,Math.min(5000,parseInt(u.searchParams.get("offset")||"0",10)||0));
  return {videos:items.slice(offset,offset+limit).map(video),pagination:{limit,offset,total:items.length},readonly_fallback:true};
}
function page(title,description,canonical,contents,age,image=""){
  const robots=age>F?"noindex,follow":"index,follow";
  const head='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><meta name="description" content="'+esc(description)+'"><meta name="robots" content="'+robots+'"><link rel="canonical" href="'+esc(canonical)+'"><meta property="og:title" content="'+esc(title)+'">'+(image?'<meta property="og:image" content="'+esc(image)+'">':'')+'<link rel="stylesheet" href="/styles.css"></head><body>';
  const html=head+'<header class="site-header"><a href="/">Vid.Best</a></header><main style="max-width:980px;margin:2rem auto;padding:0 1rem"><aside role="status" style="padding:1rem;border:1px solid currentColor">Temporary read-only mode. This saved public review may be outdated. Comments, views and reactions may be unavailable.</aside>'+contents+'</main><footer><a href="/videos">Browse reviews</a></footer></body></html>';
  return new Response(html,{status:200,headers:{...headers("text/html; charset=utf-8",age,true),"X-Robots-Tag":robots}});
}
function watchPage(row,age){
  const source=safeUrl(row.source_page_url||row.source_url),img=safeUrl(row.thumbnail_url);
  const image=img?'<img loading="lazy" width="640" height="360" style="max-width:100%;height:auto" src="'+esc(img)+'" alt="'+esc(row.title)+'">':"";
  const link=source?'<p><a rel="noopener noreferrer nofollow" target="_blank" href="'+esc(source)+'">Open original video</a></p>':"";
  const text=String(row.review_text||row.description||"").split(/\n\s*\n/).filter(Boolean).slice(0,100).map(s=>'<p>'+esc(s)+'</p>').join("");
  const body='<article><h1>'+esc(row.title)+'</h1>'+image+link+'<p>'+esc(row.description||"")+'</p><h2>Review</h2>'+text+'<p><small>Originally published '+esc(String(row.created_at||"").slice(0,10))+'</small></p></article>';
  return page(row.seo_title||row.title,row.seo_description||row.description||"","https://vid.best/watch/"+encodeURIComponent(row.slug),body,age,img);
}
export async function emergencyPublicFallback(request,env){
  if(!allowed(request))return null;
  const s=await snapshot(env);if(!s)return null;
  const u=new URL(request.url),p=u.pathname;
  if(p==="/api/videos"){const d=list(u,s.records);return d?new Response(JSON.stringify(d),{headers:headers("application/json; charset=utf-8",s.age)}):null;}
  const api=p.match(/^\/api\/videos\/([a-z0-9_-]+)$/);
  if(api){if(u.search)return null;const v=s.records.find(x=>x.slug===api[1]);return v?new Response(JSON.stringify({video:video(v),readonly_fallback:true}),{headers:headers("application/json; charset=utf-8",s.age)}):null;}
  const watch=p.match(/^\/watch\/([a-z0-9_-]+)$/);
  if(watch){if(u.search)return null;const v=s.records.find(x=>x.slug===watch[1]);return v?watchPage(v,s.age):null;}
  if(u.search)return null;
  let videos=s.records,title="All published videos";
  if(p!=="/videos"){
    const cat=p.match(/^\/category\/([a-z0-9-]+)$/);if(!cat)return null;
    const slugify=v=>String(v||"").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
    const category=videos.find(v=>slugify(v.primary_category)===cat[1])?.primary_category;
    if(!category)return null;videos=videos.filter(v=>v.primary_category===category);title=category+" reviews";
  }
  const cards=videos.slice(0,500).map(v=>'<article><h2><a href="/watch/'+encodeURIComponent(v.slug)+'">'+esc(v.title)+'</a></h2><p>'+esc(String(v.description||"").slice(0,250))+'</p></article>').join("");
  return page(title,"Published Vid.Best video review library","https://vid.best"+p,"<h1>"+esc(title)+"</h1>"+cards,s.age);
}