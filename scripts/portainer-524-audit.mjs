#!/usr/bin/env node
import { readCompose } from "./portainer-safety.mjs";
const getRequired=k=>{const s=String(process.env[k]||"").trim();if(!s)throw Error("Missing "+k);return s};
const host=new URL(getRequired("PORTAINER_URL"));
if(host.origin!=="https://portainer.megasale.win")throw Error("Unexpected Portainer host");
const headers={"X-API-Key":getRequired("PORTAINER_API_KEY"),
 "CF-Access-Client-Id":getRequired("CF_ACCESS_CLIENT_ID"),
 "CF-Access-Client-Secret":getRequired("CF_ACCESS_CLIENT_SECRET"),
 Accept:"application/json"};
async function get(p){
 const url=new URL(p,host);
 const r=await fetch(url,{method:"GET",headers,redirect:"manual",signal:AbortSignal.timeout(45000)});
 if(r.status!==200)throw Error("READ-ONLY "+url.pathname+" returned HTTP "+r.status);
 const mime=r.headers.get("content-type")||"";
 if(!mime.startsWith("application/json"))throw Error("READ-ONLY "+url.pathname+" returned non-JSON");
 return r.json();
}
const stack=await get("/api/stacks/27");
if(stack.Name!=="video-site"||Number(stack.EndpointId)!==3)throw Error("Target stack identity mismatch");
console.log("POST-524 STACK STATUS: "+(Number(stack.Status)===1?"Active":Number(stack.Status)===3?"Deploying":"Other ("+Number(stack.Status)+")"));
const file=await get("/api/stacks/27/file");
const yaml=readCompose(file.StackFileContent||"","Live");
const allow=["app","cloudflared","rapidapi-tester","legacy-v5-postgres","legacy-v5-redis","legacy-v5","legacy-v5-nginx"];
const present=allow.filter(n=>yaml.services[n]);
const version=yaml.services.app?.environment?.APP_VERSION;
console.log("POST-524 LIVE VERSION: "+(typeof version==="string"&&/^[A-Za-z0-9_.-]{1,96}$/.test(version)?version:"unavailable"));
console.log("POST-524 LIVE SERVICES: "+present.join(","));
const query=encodeURIComponent(JSON.stringify({label:["com.docker.compose.project=video-site"]}));
const containers=await get("/api/endpoints/3/docker/containers/json?all=1&filters="+query);
for(const n of present){
 const cs=containers.filter(c=>c.Labels?.["com.docker.compose.service"]===n);
 const state=cs.map(c=>{const st=String(c.State||"unknown").toLowerCase();
  return ["running","created","exited","dead","restarting"].includes(st)?st:"other";});
 console.log("POST-524 CONTAINER "+n+": "+(state.join(",")||"missing")+
   (cs.some(c=>(c.Status||"").includes("(unhealthy)"))?" unhealthy":""));
}
console.log("POST-524 AUDIT COMPLETE: read-only GET requests only, no secret or YAML contents logged.");
