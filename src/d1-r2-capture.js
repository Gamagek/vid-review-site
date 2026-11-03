// Autonomous 4-hourly public-only D1 -> private R2 snapshot.
// No imports, backups of private tables, D1 writes, or dependency on Oracle.
const pointerKey = "vidbest-resilience-public/latest.json";
const columns = ["id","slug","title","description","review_text","seo_title",
 "seo_description","seo_tags","thumbnail_url","source_url","source_page_url",
 "embed_url","media_type","r2_key","primary_category","subcategory",
 "created_at","updated_at","featured","trending","views","reaction_count","published"];
export async function capturePublishedD1ToR2(env, scheduledAt=Date.now()) {
  if(!env.DB?.prepare || !env.BUCKET?.put || !env.BUCKET?.get) return {skipped:"bindings-missing"};
  const before=await env.DB.prepare("SELECT COUNT(*) AS total,MAX(id) AS maxid,MAX(updated_at) AS lastmod FROM videos WHERE published=1").first();
  const total=Number(before?.total);
  if(!Number.isSafeInteger(total)||total<1||total>5000)throw Error("Public snapshot count outside safety bound");
  const results=[],ids=new Set(),sql="SELECT "+columns.map(c=>"v."+c).join(",")+",m.source_published_at,m.source_duration FROM videos v LEFT JOIN video_source_metadata m ON m.video_id=v.id WHERE v.published=1 ORDER BY v.created_at DESC,v.id DESC LIMIT ? OFFSET ?";
  for(let offset=0;offset<total;offset+=48){
    const r=await env.DB.prepare(sql).bind(48,offset).all();
    const rows=r?.results||[];
    if(rows.length!==Math.min(48,total-offset))throw Error("Incomplete public pagination");
    for(const x of rows){
      if(x.published!==1||!Number.isSafeInteger(x.id)||x.id<1||typeof x.slug!=="string"||!/^[a-z0-9-]+$/.test(x.slug)||ids.has(x.id))throw Error("Invalid/duplicate public record");
      ids.add(x.id);
      const published=Object.fromEntries([...columns,"source_published_at","source_duration"].map(k=>[k,x[k]??null]));
      results.push({...published,published:true});
    }
  }
  const after=await env.DB.prepare("SELECT COUNT(*) AS total,MAX(id) AS maxid,MAX(updated_at) AS lastmod FROM videos WHERE published=1").first();
  const head=await env.DB.prepare("SELECT id FROM videos WHERE published=1 ORDER BY created_at DESC,id DESC LIMIT 1").first();
  if(after?.total!==before?.total||after?.maxid!==before?.maxid||after?.lastmod!==before?.lastmod||head?.id!==results[0]?.id||ids.size!==total)throw Error("Public database changed during snapshot; old copy preserved");
  const captured=new Date().toISOString(),snapshotId="scheduled-"+Math.floor(scheduledAt/1000);
  const body=JSON.stringify({format:"vidbest-public-video-library-v1",snapshot_id:snapshotId,captured_at:captured,record_count:total,source:"d1",records:results});
  const size=new TextEncoder().encode(body).byteLength;
  if(size>5000000)throw Error("Refusing oversized public library");
  // 42 four-hour slots provide a bounded seven-day storage window.
  const slot=String(Math.floor(scheduledAt/14400000)%42).padStart(2,"0");
  const key="vidbest-resilience-public/slots/"+slot+".json";
  await env.BUCKET.put(key,body,{httpMetadata:{contentType:"application/json"}});
  const readback=await env.BUCKET.get(key);
  if(!readback||await readback.text()!==body)throw Error("R2 data readback failed; pointer unchanged");
  const pointer={format:"vidbest-public-library-pointer-v1",object_key:key,
    snapshot_id:snapshotId,captured_at:captured,record_count:total,bytes:size,
    scope:"published-video-data-only",full_d1_backup:false,oracle_copy:false};
  await env.BUCKET.put(pointerKey,JSON.stringify(pointer),{httpMetadata:{contentType:"application/json"}});
  const result=await env.BUCKET.get(pointerKey);
  if(!result||(await result.json())?.object_key!==key)throw Error("R2 pointer readback failed");
  return {count:total,bytes:size,objectKey:key};
}
export async function maybeCapturePublishedD1(controller,env,ctx){
  if(env.D1_PUBLIC_FALLBACK_CAPTURE!=="1"||controller?.cron!=="*/15 * * * *")return;
  const time=Number(controller?.scheduledTime)||Date.now(),date=new Date(time);
  if(date.getUTCMinutes()!==0||date.getUTCHours()%4!==0)return;
  const task=capturePublishedD1ToR2(env,time).catch(()=>console.warn("Public D1 fallback snapshot deferred; prior snapshot retained"));
  if(ctx?.waitUntil)ctx.waitUntil(task);else await task;
}