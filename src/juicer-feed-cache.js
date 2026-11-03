// Durable Juicer post-metadata snapshots; never proxy or store video bytes.
// The cached official TikTok iframe is independent of Juicer feed/source IDs.
const PREFIX = "metadata/juicer/tiktok/v1/";
const STATE_KEY = PREFIX + "sync-state.json";
const ONE_DAY = 86_400_000;
const MAX_PAGES = 3;
const PAGE_SIZE = 100;

const numericId = value => /^\d{15,25}$/.test(String(value || "")) ? String(value) : null;
const clean = (value, max) => String(value == null ? "" : value)
  .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
function postUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || !["www.tiktok.com", "tiktok.com"].includes(url.hostname) ||
        url.username || url.password || url.port || url.search || url.hash) return null;
    const match = url.pathname.match(/^\/@([A-Za-z0-9_.]{1,32})\/video\/(\d{15,25})\/?$/);
    return match ? { handle: match[1], id: match[2],
      url: "https://www.tiktok.com/@" + match[1] + "/video/" + match[2] } : null;
  } catch { return null; }
}
export function normalizeJuicerTikTokPost(post, timestamp = new Date().toISOString()) {
  if (String(post?.platform || "").toLowerCase() !== "tiktok" ||
      (post.moderation_status && post.moderation_status !== "public")) return null;
  const source = postUrl(post?.url);
  if (!source || (post?.external_id && numericId(post.external_id) !== source.id)) return null;
  const iframe = "https://www.tiktok.com/player/v1/" + source.id;
  const published = String(post.external_created_at || "");
  return {
    version: 1,
    provider: "TikTok",
    video_id: source.id,
    source_url: source.url,
    creator_handle: source.handle,
    creator_name: clean(post.poster?.display_name || post.poster?.name || source.handle, 100),
    caption: clean(post.message, 1000),
    source_post_id: Number.isSafeInteger(Number(post.id)) ? Number(post.id) : null,
    source_published_at: Number.isFinite(Date.parse(published)) ? new Date(published).toISOString() : null,
    embed_url: iframe,
    embed_html: '<iframe src="' + iframe + '" width="325" height="580" title="TikTok video" loading="lazy" allow="fullscreen" allowfullscreen></iframe>',
    captured_at: timestamp,
  };
}
export function juicerObjectKey(id) {
  const value = numericId(id);
  if (!value) throw new Error("A canonical TikTok video ID is required");
  return PREFIX + "posts/" + value + ".json";
}
const parseJson = async object => {
  if (!object) return null;
  try { return await object.json(); } catch { return null; }
};
export async function getJuicerCachedPost(env, id) {
  if (!env.BUCKET?.get) return null;
  const value = numericId(id);
  return value ? parseJson(await env.BUCKET.get(juicerObjectKey(value))) : null;
}
export async function getJuicerSyncState(env) {
  if (!env.BUCKET?.get) return null;
  return parseJson(await env.BUCKET.get(STATE_KEY));
}
const safeResponse = (body, status=200) => Response.json(body, {
  status, headers: { "Cache-Control":"no-store", "X-Robots-Tag":"noindex,nofollow" },
});
export async function juicerCachedMetadata(request, env, id) {
  if (!numericId(id)) return safeResponse({ok:false,error:"Invalid video ID"},400);
  const post = await getJuicerCachedPost(env,id);
  if (!post) return safeResponse({ok:false,error:"No saved Juicer metadata for this video"},404);
  return Response.json({ok:true,video:post},{headers:{
    "Cache-Control":"public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    "X-Content-Type-Options":"nosniff",
  }});
}
async function fetchPage(key, feedId, page) {
  const url = new URL("https://api.juicer.io/v1/feeds/" + feedId + "/posts");
  url.searchParams.set("page",String(page));
  url.searchParams.set("per_page",String(PAGE_SIZE));
  url.searchParams.set("status","public");
  const response = await fetch(url, {
    method:"GET", redirect:"error", signal:AbortSignal.timeout(12000),
    headers: { "Authorization":"Bearer " + key, "Accept":"application/json" },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Juicer feed API returned HTTP " + response.status);
  }
  const size = Number(response.headers.get("Content-Length") || 0);
  if (size > 1_500_000) { await response.body?.cancel(); throw new Error("Juicer response exceeds safe limit"); }
  const text = await response.text();
  if (text.length > 1_500_000) throw new Error("Juicer response exceeds safe limit");
  let json; try { json = JSON.parse(text); } catch { throw new Error("Juicer API returned invalid JSON"); }
  if (!Array.isArray(json?.data)) throw new Error("Juicer API did not return a post list");
  return json;
}
const comparable = value => JSON.stringify({
  source_url:value.source_url,creator_handle:value.creator_handle,
  creator_name:value.creator_name,caption:value.caption,
  source_published_at:value.source_published_at,embed_url:value.embed_url
});
export async function syncJuicerFeedCache(env, {force=false,resume=false,maxPages=MAX_PAGES}={}) {
  if (!env.BUCKET?.get || !env.BUCKET?.put)
    return {ok:false,skipped:true,reason:"R2 BUCKET binding is unavailable"};
  const key = String(env.JUICER_API_KEY || "");
  const feedId = Number(env.JUICER_FEED_ID || 460118);
  if (!key || !Number.isSafeInteger(feedId) || feedId < 1)
    return {ok:false,skipped:true,reason:"Set JUICER_API_KEY secret and JUICER_FEED_ID before synchronization"};
  const now = Date.now();
  const state = await getJuicerSyncState(env) || {};
  if (!force && state.next_eligible_at && Date.parse(state.next_eligible_at) > now) {
    return {ok:true,skipped:true,next_eligible_at:state.next_eligible_at,next_page:state.next_page};
  }
  if (!force && state.last_attempt_at && now - Date.parse(state.last_attempt_at) < 300_000) {
    return {ok:true,skipped:true,reason:"A feed refresh was attempted recently"};
  }
  const currentPage = force && !resume ? 1 : Math.max(1,Number(state.next_page) || 1);
  let nextPage = currentPage;
  let processed=0,saved=0,unchanged=0,invalid=0;
  const cap=Math.max(1,Math.min(MAX_PAGES,Number(maxPages)||MAX_PAGES));
  let more=false;
  for(let i=0;i<cap;i++) {
    const payload=await fetchPage(key,feedId,nextPage);
    for (const raw of payload.data) {
      const item=normalizeJuicerTikTokPost(raw,new Date(now).toISOString());
      if(!item){invalid++;continue}
      processed++;
      const path=juicerObjectKey(item.video_id);
      const existing=await parseJson(await env.BUCKET.get(path));
      if(existing && comparable(existing)===comparable(item)){unchanged++;continue}
      if(existing?.captured_at)item.captured_at=existing.captured_at;
      await env.BUCKET.put(path,JSON.stringify(item),{
        httpMetadata:{contentType:"application/json; charset=utf-8",cacheControl:"private, max-age=0"},
        customMetadata:{source:"juicer",provider:"tiktok"}
      });
      saved++;
    }
    const totalPages=Number(payload.meta?.total_pages)||0;
    more = totalPages ? nextPage < totalPages : payload.data.length === PAGE_SIZE;
    if(!more) {nextPage=1;break}
    nextPage++;
  }
  const completed=!more, nextAllowed=new Date(now+ONE_DAY).toISOString();
  const updated={
    version:1,feed_id:feedId,
    last_attempt_at:new Date(now).toISOString(),
    next_eligible_at: nextAllowed,
    next_page:nextPage,
    completed,
    last_batch:{processed,saved,unchanged,invalid}
  };
  await env.BUCKET.put(STATE_KEY,JSON.stringify(updated),{
    httpMetadata:{contentType:"application/json; charset=utf-8",cacheControl:"private, max-age=0"}
  });
  return {ok:true, ...updated};
}
export async function juicerCacheStatus(env) {
  return safeResponse({
    configured:Boolean(env.JUICER_API_KEY),
    storage:Boolean(env.BUCKET?.get),
    feed_id:Number(env.JUICER_FEED_ID||460118),
    state: await getJuicerSyncState(env),
  });
}
export async function juicerCacheSyncEndpoint(request,env) {
  try {
    const length = Number(request.headers.get("content-length")||0);
    if(length > 128) return safeResponse({ok:false,error:"Request body too large"},413);
    let resume=false;
    if(length>0) {
      const body=await request.json();
      resume=body?.resume === true;
    }
    const result=await syncJuicerFeedCache(env,{force:true,resume});
    return safeResponse(result,result.ok?200:503);
  } catch (error) {
    return safeResponse({ok:false,error:String(error.message).slice(0,150)},502);
  }
}
