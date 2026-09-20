const url = "https://vid.best/api/videos?q=Saiyaara&limit=48";
const response = await fetch(url, { headers: { Accept: "application/json" } });
console.log("HTTP", response.status);
const body = await response.text();
if (!response.ok) throw new Error(body);
const data = JSON.parse(body);
for (const v of data.videos || []) console.log(JSON.stringify({id:v.id,slug:v.slug,title:v.title,provider:v.provider,media_type:v.media_type,source_url:v.source_url,embed_url:v.embed_url,thumbnail_url:v.thumbnail_url,published:v.published}));
console.log("TOTAL", data.pagination?.total ?? 0);

const slug = "fyppppppppppppppppppppppp-fyp-ahaanpanday-aneetpadda-saiyaara";
const pageResponse = await fetch("https://vid.best/watch/" + slug, { headers: { Accept: "text/html" } });
console.log("PAGE_HTTP", pageResponse.status);
const pageHtml = await pageResponse.text();
console.log("PAGE_TITLE", (pageHtml.match(/<title>([^<]+)<\/title>/i) || [,""])[1]);
console.log("HAS_TIKTOK_IFRAME", /<iframe[^>]+src="https:\/\/www\.tiktok\.com\/player\/v1\/7669587518156705056/i.test(pageHtml));
console.log("HAS_TIKTOK_FALLBACK_VIDEO", /<video[^>]+id="watch-media-video"/i.test(pageHtml));
console.log("PLAYER_SNIPPET", (pageHtml.match(/<div class="watch-player-stage">([\s\S]*?)<\/div>/i) || [,""])[1].slice(0,1800));

console.log("POST_DEPLOY_CHECK", new Date().toISOString());
