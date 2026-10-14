import catalog from '../content/daily-weekly-best/catalog.json' with { type: 'json' };

const PREFIX='/daily-weekly-best';
const ORIGIN='https://vid.best';
const paths=Object.freeze([PREFIX,...['films','basketball','games',...catalog.reviews.map(item=>item.slug)].map(slug=>`${PREFIX}/${slug}`)]);
const known=new Set(paths);
export const dailyWeeklyBestPaths=paths;
export function dailyWeeklyBestSitemap() {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path=>`<url><loc>${ORIGIN}${path}</loc><lastmod>${catalog.publishedAt}</lastmod></url>`).join('')}</urlset>`,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=900','X-Content-Type-Options':'nosniff'}});
}
export async function dailyWeeklyBestResponse(request,env) {
  const url=new URL(request.url);
  // Sibling assets such as /daily-weekly-best.css belong to Static Assets.
  if(url.pathname!==PREFIX&&url.pathname!==PREFIX+'.html'&&!url.pathname.startsWith(PREFIX+'/'))return null;
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{Allow:'GET, HEAD','X-Robots-Tag':'noindex'}});
  const path=url.pathname.replace(/\.html$|\/$/,'');
  if(!known.has(path))return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Editorial page not found | Vid.Best</title></head><body><h1>Editorial page not found</h1><a href="/daily-weekly-best">Browse Daily Weekly Best</a></body></html>',{status:404,headers:{'Content-Type':'text/html; charset=utf-8','X-Robots-Tag':'noindex,follow','Cache-Control':'public, max-age=60'}});
  if(path!==url.pathname)return Response.redirect(ORIGIN+path+url.search,301);
  const target=new URL(request.url);target.pathname=path;target.search='';
  const asset=await env.ASSETS.fetch(new Request(target,{method:'GET'}));
  if(!asset.ok||!asset.headers.get('content-type')?.includes('text/html')){
    await asset.body?.cancel();
    return new Response('Editorial page temporarily unavailable',{status:503,headers:{'X-Robots-Tag':'noindex','Retry-After':'60'}});
  }
  const headers=new Headers(asset.headers);
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('Content-Security-Policy',"default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' https://i.ytimg.com; style-src 'self'; script-src 'self'; frame-src https://www.youtube-nocookie.com; upgrade-insecure-requests");
  headers.set('X-Robots-Tag',url.search?'noindex,follow':'index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1');
  headers.set('Cache-Control','public, max-age=300');
  // Only canonical, known pages reach Assets; the existing home feed and D1 are untouched.
  return new Response(asset.body,{status:200,headers});
}
