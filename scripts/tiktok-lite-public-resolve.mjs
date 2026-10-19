// Public-only TikTok Lite short-link resolver and official oEmbed research.
// No media downloads, account cookies, evasion, or production writes.
const codes=["ZSghb7Ugh","ZSghbWTcF","ZSghbEXbL","ZSghgf6BE","ZSghgf9tH","ZSghgANxn","ZSghgfeLP","ZSghgSduH","ZSghgfQQx","ZSghgU3q3","ZSghgwNJr","ZSghpeSWq","ZSghpRPpF","ZSghpdywa","ZSghgbrnh","ZSghgwpJw","ZSghg3Twc","ZSghgERKd","ZSghp8EJn","ZSghgswSV","ZSghp9W15","ZSghpNKga","ZSghpLEPd","ZSghpFXo5","ZSghp5DXu","ZSghp6F1t","ZSghpxhL8","ZSghpnjAR","ZSghpc9w3","ZSghp4snF","ZSghsJb4N","ZSghsRPUc","ZSghsanbM","ZSghsYqdP","ZSghsDXur","ZSghsBR5K","ZSghsQHDr","ZSghsggMR","ZSghspWYA","ZSghstwFd","ZSghsQcgT","ZSghsWD5E"];
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const headers={"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",Accept:"text/html,application/json;q=0.8"};
const videoId = u => String(u||"").match(/\/video\/(\d{15,25})/)?.[1]||"";
async function resolve(code) {
 const source="https://vm.tiktok.com/"+code+"/";
 let url=source, redirects=[];
 for(let i=0;i<7;i++){
   try {
    let r=await fetch(url,{method:"GET",redirect:"manual",headers,signal:AbortSignal.timeout(13500)});
    const loc=r.headers.get("location"), status=r.status;
    if(loc&&[301,302,303,307,308].includes(status)){
      url=new URL(loc,url).href; redirects.push({status,to:url.slice(0,250)});
      if(!/^https:\/\/(?:vm\.)?tiktok\.com\//.test(url) && !/^https:\/\/www\.tiktok\.com\//.test(url)) break;
      continue;
    }
    const html=await r.text();
    const canonical=html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i)?.[1]||"";
    const og=html.match(/<meta[^>]*property=["']og:url["'][^>]*content=["']([^"']+)/i)?.[1]||"";
    const id=videoId(url)||videoId(canonical)||videoId(og)||html.match(/"itemId":"(\d{15,25})"/)?.[1]||"";
    return {source,code,canonicalUrl: id?(videoId(url)?url:(videoId(canonical)?canonical:og)):"",id,finalUrl:url,status,redirects,contentBytes:html.length};
   }catch(e){return {source,code,error:String(e.message).slice(0,120),redirects,finalUrl:url};}
 }
 return {source,code,finalUrl:url,redirects,id:videoId(url)};
}
async function enrich(r) {
 if(!r.id) return r;
 const cleanUrl=r.canonicalUrl||r.finalUrl;
 try {
 const u="https://www.tiktok.com/oembed?url="+encodeURIComponent(cleanUrl);
 const res=await fetch(u,{headers:{"Accept":"application/json","User-Agent":headers["User-Agent"]},signal:AbortSignal.timeout(15000)});
 if(res.ok){
  const data=await res.json();
  return {...r,oembedStatus:res.status,title:String(data.title||"").slice(0,450),author_name:data.author_name||"",author_url:data.author_url||"",thumbnail_url:data.thumbnail_url||""};
 }
 return {...r,oembedStatus:res.status};
 }catch(e){return {...r,oembedError:String(e.message).slice(0,120)}}
}
let idx=0;
const results=new Array(codes.length);
async function runner(){while(idx<codes.length){const i=idx++;let res=await resolve(codes[i]);res=await enrich(res);results[i]=res;console.log("TIKTOK_RESOLVED "+JSON.stringify(res));await sleep(200);}}
await Promise.all(Array.from({length:6},runner));
console.log("TIKTOK_SUMMARY "+JSON.stringify({requested:codes.length,valid:results.filter(x=>x?.id).length,unresolved:results.filter(x=>!x?.id).map(x=>x.code),uniqueIds:new Set(results.map(x=>x?.id).filter(Boolean)).size}));


const probes=[{url:"https://www.tiktok.com/@brunavanessafatima/video/7683247291393707278",code:"ZSghgf6BE"},{url:"https://www.tiktok.com/@julian70908/photo/7656037838999293217",code:"ZSghb7Ugh"}];
for (const one of probes) {
 try {
  const res=await fetch(one.url,{headers,signal:AbortSignal.timeout(15000)}),html=await res.text();
  const htmlMeta={};
  for(const prop of ["og:title","og:description","twitter:description","description"]){
    const pattern=new RegExp("<meta[^>]+(?:property|name)=[\\\\\"']"+prop+"[\\\\\"'][^>]+content=[\\\\\"']([^\\\\\"']{0,800})","i");
    htmlMeta[prop]=html.match(pattern)?.[1]||"";
  }
  const hydrated=html.match(/<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i);
  let data=null;try{data=JSON.parse(hydrated?.[1]||"null")}catch{}
  const defaultScope=data?.__DEFAULT_SCOPE__||{};
  const detail=defaultScope["webapp.video-detail"]||{};
  const item=detail.itemInfo?.itemStruct||detail.itemInfo||{};
  const user=item.author||{};
  console.log("TIKTOK_PROBE "+JSON.stringify({code:one.code,status:res.status,bytes:html.length,htmlMeta,scriptFound:!!hydrated,scopeKeys:Object.keys(defaultScope).slice(0,25),detailKeys:Object.keys(detail).slice(0,20),itemKeys:Object.keys(item).slice(0,24),videoDesc:item.desc||"",music:item.music?.title||"",stats:item.stats||null,username:user.uniqueId||"",createTime:item.createTime||"",oembedSnippet:(await (await fetch("https://www.tiktok.com/oembed?url="+encodeURIComponent(one.url),{signal:AbortSignal.timeout(9000)})).text()).slice(0,500)}));
 }catch(e){console.log("TIKTOK_PROBE "+JSON.stringify({code:one.code,error:String(e.message)}))}
}


async function getItem(r) {
 if(!r.id)return {code:r.code,id:null,kind:"photo",finalUrl:r.finalUrl};
 try{
  const res=await fetch(r.finalUrl,{headers,signal:AbortSignal.timeout(14000)});
  const html=await res.text();
  const startTag=html.indexOf('id="__UNIVERSAL_DATA_FOR_REHYDRATION__"');
  const startBody=html.indexOf('>',startTag)+1;
  const endBody=html.indexOf('</script>',startBody);
  const root=JSON.parse(startTag>=0&&startBody>0&&endBody>startBody?html.slice(startBody,endBody):'null');
  const detail=root?.__DEFAULT_SCOPE__?.["webapp.video-detail"]||{};
  const item=detail.itemInfo?.itemStruct||{};
  const music=item.music||{};
  const video=item.video||{};
  return {code:r.code,id:r.id,url:r.finalUrl,ok:!!item.id,statusCode:detail.statusCode,
   handle:item.author?.uniqueId||r.finalUrl.match(/@([^/]+)/)?.[1]||"",
   caption:String(item.desc||"").slice(0,1100),
   music:String(music.title||"").slice(0,160),musicAuthor:String(music.authorName||"").slice(0,90),
   duration:video.duration||null,
   publishedTimestamp:item.createTime||null,
   cover:video.cover||video.originCover||video.dynamicCover||"",
   stats:{plays:item.stats?.playCount||null,likes:item.stats?.diggCount||null},
   tags:(item.challenges||[]).map(x=>x.title).slice(0,12)};
 }catch(e){return {code:r.code,id:r.id,url:r.finalUrl,error:String(e.message).slice(0,150)}}
}
let detailIndex=0;const details=new Array(results.length);
async function detailRunner(){while(detailIndex<results.length){const i=detailIndex++;details[i]=await getItem(results[i]);console.log("TIKTOK_INFO "+JSON.stringify(details[i]));await sleep(150);}}
await Promise.all(Array.from({length:6},detailRunner));
console.log("TIKTOK_INFO_SUMMARY "+JSON.stringify({total:details.length,withItem:details.filter(x=>x.ok).length,missing:details.filter(x=>!x.ok).map(x=>x.code)}));
