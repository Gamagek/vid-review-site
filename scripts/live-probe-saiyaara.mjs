const url = "https://vid.best/api/videos?q=Saiyaara&limit=48";
const response = await fetch(url, { headers: { Accept: "application/json" } });
console.log("HTTP", response.status);
const body = await response.text();
if (!response.ok) throw new Error(body);
const data = JSON.parse(body);
for (const v of data.videos || []) console.log(JSON.stringify({id:v.id,slug:v.slug,title:v.title,provider:v.provider,media_type:v.media_type,source_url:v.source_url,embed_url:v.embed_url,thumbnail_url:v.thumbnail_url,published:v.published}));
console.log("TOTAL", data.pagination?.total ?? 0);