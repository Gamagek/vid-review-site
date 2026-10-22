/**
 * Administrator-only import of Gemini analyses exported to Google Drive as JSON.
 * Drive files are supplied by an authenticated administrator or reviewed operator.
 * No Google tokens are accepted or stored here. Default is preview-only.
 */
const MAX_BODY = 180000;
const reply = (body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const clean=(v,max)=>typeof v==="string"?v.trim().slice(0,max):"";
function youtubeId(input){
  try {
    const u=new URL(input);
    if(!["youtube.com","www.youtube.com","m.youtube.com","youtu.be"].includes(u.hostname.toLowerCase()))return null;
    const id=u.hostname.toLowerCase()==="youtu.be"?u.pathname.slice(1):u.pathname.startsWith("/shorts/")?u.pathname.split("/")[2]:u.searchParams.get("v");
    return /^[A-Za-z0-9_-]{11}$/.test(id||"")?id:null;
  }catch{return null;}
}
export async function importGeminiReview(request,env){
  let raw;
  try {
    const body=await request.text();
    if(body.length>MAX_BODY)return reply({error:"Import too large"},413);
    raw=JSON.parse(body);
  }catch{return reply({error:"Expected JSON"},400);}
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return reply({error:"Expected JSON object"},400);
  const id=Number(raw.video_id);
  if(!Number.isSafeInteger(id)||id<1)return reply({error:"Valid video_id required"},400);
  const source=clean(raw.source_url,2048);
  const sourceId=youtubeId(source);
  if(!sourceId)return reply({error:"A valid YouTube source_url is required"},400);
  const row=await env.DB.prepare("SELECT id,slug,title,source_url,review_text,published FROM videos WHERE id=?").bind(id).first();
  if(!row)return reply({error:"Video not found"},404);
  if(youtubeId(row.source_url)!==sourceId)return reply({error:"Source URL does not match saved video"},409);
  const evidence=raw.analysis;
  if(!evidence||typeof evidence!=="object"||Array.isArray(evidence)||evidence.accessible!==true)return reply({error:"Gemini analysis must confirm accessible video"},422);
  const scenes=Array.isArray(evidence.observed_scenes)?evidence.observed_scenes.filter(x=>typeof x==="string"&&x.trim()).slice(0,30):[];
  if(scenes.length<3)return reply({error:"At least three observed scenes required"},422);
  const review=clean(raw.review_text||evidence.review,60000);
  const description=clean(raw.description,4000);
  const seoTitle=clean(raw.seo_title,180);
  const seoDescription=clean(raw.seo_description||evidence.seo_description,300);
  const seoTags=clean(raw.seo_tags,2000);
  if(review.length<650||!description||!seoTitle||!seoDescription||!seoTags)return reply({error:"Review >=650 characters and all SEO fields required"},422);
  const current=String(row.review_text||"");
  if(current.length>=600&&!raw.override_existing)return reply({error:"Existing review is already substantial; override_existing required"},409);
  const preview={video_id:id,slug:row.slug,title:row.title,source_url:row.source_url,review_text:review,description,seo_title:seoTitle,seo_description:seoDescription,seo_tags:seoTags,observed_scenes:scenes,uncertainty:Array.isArray(evidence.uncertainty)?evidence.uncertainty:[],current_review_length:current.length,requires_editorial_review:true};
  if(raw.commit!==true)return reply({success:true,committed:false,preview});
  if(raw.editorial_verified!==true)return reply({error:"editorial_verified must be true to commit"},422);
  const result=await env.DB.prepare("UPDATE videos SET review_text=?,description=?,seo_title=?,seo_description=?,seo_tags=? WHERE id=? AND source_url=? AND review_text=?")
    .bind(review,description,seoTitle,seoDescription,seoTags,id,row.source_url,row.review_text).run();
  if(result.meta?.changes!==1)return reply({error:"Concurrent edit detected; reload and review again"},409);
  return reply({success:true,committed:true,video_id:id,slug:row.slug,review_length:review.length,published_date_preserved:true});
}
