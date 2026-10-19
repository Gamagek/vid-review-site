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
