"use strict";
const http = require("node:http");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const { createClient } = require("redis");
const PORT = 8080;
const SECRET = process.env.SIGN_SECRET || "";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 5000 });
const redis = createClient({ url: process.env.REDIS_URL || "redis://legacy-v5-redis:6379" });
const locks = new Map();
let ready = false;
let nextFetch = 0;
let blockedUntil = 0;
const POS_TTL = 24 * 3600;
const NEG_TTL = 5 * 60;
const escapeHtml = s => String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
function source(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.hostname !== "www.tiktok.com" || u.username || u.password || u.port) return null;
    const m = /^\/@([A-Za-z0-9_.]{1,32})\/video\/([0-9]{15,25})\/?$/.exec(u.pathname);
    if (!m) return null;
    return { id:m[2],url:"https://www.tiktok.com/@" + m[1] + "/video/" + m[2] };
  } catch { return null; }
}
function authorize(parsed, params) {
  const exp = params.get("exp") || "", sig = params.get("sig") || "";
  if (!SECRET || !parsed || !/^[0-9]{9,12}$/.test(exp) || Number(exp) <= Date.now()/1000 ||
      Number(exp) > Date.now()/1000 + 7200 || !/^[0-9a-f]{64}$/i.test(sig)) return false;
  const expected = crypto.createHmac("sha256", SECRET).update(parsed.id + "." + exp).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"));
}
async function lookup(parsed) {
  const cacheKey = "v5:" + parsed.id;
  const hot = await redis.get(cacheKey);
  if (hot) { try { return JSON.parse(hot); } catch {} }
  const fromDb = await pool.query("SELECT data FROM videos WHERE id=$1 AND expires_at>NOW()", [parsed.id]);
  if (fromDb.rows[0]) {
    await redis.set(cacheKey, JSON.stringify(fromDb.rows[0].data), { EX:POS_TTL });
    return fromDb.rows[0].data;
  }
  if (Date.now() < blockedUntil || Date.now() < nextFetch) return null;
  if (locks.has(parsed.id)) return locks.get(parsed.id);
  const task = (async () => {
    nextFetch = Date.now() + 4000;
    let result;
    try {
      const response = await fetch("https://www.tiktok.com/oembed?url=" + encodeURIComponent(parsed.url),
        { signal:AbortSignal.timeout(12000), headers:{ Accept:"application/json" } });
      if (response.status===429 || response.status===403) { blockedUntil=Date.now()+3600*1000; return null; }
      if (!response.ok) return null;
      const obj = await response.json();
      if (!obj || typeof obj !== "object") return null;
      result = {
        id:parsed.id, title:String(obj.title||"TikTok video").slice(0,250),
        author:String(obj.author_name||"").slice(0,100),
        thumbnail:(typeof obj.thumbnail_url === "string" && /^https:\/\//.test(obj.thumbnail_url))
          ? obj.thumbnail_url.slice(0,2000) : ""
      };
      await pool.query(
        "INSERT INTO videos (id,url,data,expires_at) VALUES ($1,$2,$3,NOW()+INTERVAL '24 hours') " +
        "ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, url=EXCLUDED.url, expires_at=EXCLUDED.expires_at",
        [parsed.id,parsed.url,JSON.stringify(result)]);
      await redis.set(cacheKey,JSON.stringify(result),{EX:POS_TTL});
      return result;
    } catch { return null; }
  })().finally(()=>locks.delete(parsed.id));
  locks.set(parsed.id,task);
  return task;
}
const send=(res,status,type,body)=>{res.writeHead(status,{
  "Content-Type":type,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; frame-ancestors https://vid.best https://video.megasale.win; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://www.tiktok.com; frame-src https://www.tiktok.com https://*.tiktok.com; img-src https:; connect-src 'self'; base-uri 'none'"
});res.end(body)};
function render(data,parsed) {
  const caption=escapeHtml(data?.title || "TikTok video");
  const url=escapeHtml(parsed.url),id=escapeHtml(parsed.id);
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>body{background:#080808;color:#fff;font:16px system-ui;margin:0;min-height:100vh;display:grid;place-items:center}.box{width:min(100%,605px);text-align:center}.launch{background:#222;border:1px solid #777;color:white;padding:16px;cursor:pointer;font:inherit;width:100%;min-height:300px}.stage{display:block;margin:auto;max-width:100%}a{color:#cef}</style></head>' +
  '<body><div class="box"><button class="launch" id="activate">Play TikTok video<br>'+caption+'</button><div class="stage" id="stage"></div>' +
  '<p><a href="'+url+'" rel="noopener noreferrer" target="_blank">Open on TikTok</a></p></div>' +
  '<script>document.getElementById("activate").addEventListener("click",function(){this.remove();' +
  'const quote=document.createElement("blockquote");quote.className="tiktok-embed";quote.cite="'+url+'";' +
  'quote.setAttribute("data-video-id","'+id+'");quote.style.maxWidth="605px";' +
  'document.getElementById("stage").append(quote);const script=document.createElement("script");' +
  'script.src="https://www.tiktok.com/embed.js";script.async=true;document.body.append(script);},{once:true});</script></body></html>';
}
async function handler(req,res) {
  const u=new URL(req.url||"/","http://localhost");
  if(req.method!=="GET") return send(res,405,"text/plain","Method Not Allowed");
  if(u.pathname==="/health") return send(res,ready?200:503,"text/plain",ready?"OK legacy-v5":"Starting");
  if(!ready) return send(res,503,"text/plain","Starting");
  if(!["/watch","/metadata"].includes(u.pathname)) return send(res,404,"text/plain","Not Found");
  const parsed=source(u.searchParams.get("url")||"");
  if(!authorize(parsed,u.searchParams)) return send(res,403,"text/plain","Forbidden");
  const data=await lookup(parsed);
  if(u.pathname==="/metadata")return send(res,200,"application/json; charset=utf-8",
    JSON.stringify(data||{id:parsed.id,title:"TikTok video",available:false}));
  return send(res,200,"text/html; charset=utf-8",render(data,parsed));
}
async function start(){
  if(!SECRET || !process.env.DATABASE_URL)throw Error("Required signed gateway configuration missing");
  redis.on("error",()=>{});
  await redis.connect();
  await pool.query("CREATE TABLE IF NOT EXISTS videos (id TEXT PRIMARY KEY,url TEXT NOT NULL,data JSONB NOT NULL,expires_at TIMESTAMPTZ NOT NULL)");
  ready=true;
  http.createServer((req,res)=>handler(req,res).catch(()=>send(res,503,"text/plain","Temporarily unavailable")))
    .listen(PORT,"0.0.0.0",()=>console.log("Vid.Best optional v5 gateway listening"));
}
start().catch(()=>{console.error("Legacy v5 startup blocked; check database and Redis health");process.exit(1)});