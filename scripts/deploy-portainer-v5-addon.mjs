#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readCompose, verifyPreservation, containerFailures } from "./portainer-safety.mjs";
import { writeBackup, readBackup } from "./portainer-backup.mjs";
import { createV5Candidate, legacyV5Images } from "./portainer-v5-addon.mjs";
import { createPortainerClient, readDockerInventory } from "./portainer-client.mjs";

const deploy=process.argv.includes("--deploy");
if(process.argv.slice(2).some(a=>!["--check-only","--deploy"].includes(a)) ||
  (deploy && process.argv.includes("--check-only")))throw Error("Invalid mode");
if(deploy && process.env.PORTAINER_ADDON_ACTIVATION!=="true")throw Error("Production addon deployment not authorized");
const required=k=>{const v=String(process.env[k]||"").trim();if(!v)throw Error("Missing: "+k);return v};
const base=new URL(required("PORTAINER_URL"));
if(base.origin!=="https://portainer.megasale.win" || base.pathname!=="/")throw Error("Refusing unexpected Portainer host");
const stackId=Number(required("PORTAINER_STACK_ID"));
const endpointId=Number(required("PORTAINER_ENDPOINT_ID"));
if(stackId!==27||endpointId!==3)throw Error("Portainer target mismatch");
const key=required("PORTAINER_API_KEY"),cfId=required("CF_ACCESS_CLIENT_ID"),cfSecret=required("CF_ACCESS_CLIENT_SECRET");
const headers={"X-API-Key":key,"CF-Access-Client-Id":cfId,"CF-Access-Client-Secret":cfSecret,"Accept":"application/json"};
const api=createPortainerClient({base,headers,readOnly:!deploy});
async function fetchPortainer(path,method="GET",body,timeout=40000){
  return api(path,{method,body,timeout});
}
const stack=await fetchPortainer("api/stacks/27");
if(stack.Name!=="video-site"||Number(stack.Id)!==27||Number(stack.EndpointId)!==3||
  Number(stack.Type)!==2||Number(stack.Status)!==1||!Array.isArray(stack.Env)||stack.GitConfig)
  throw Error("Target must be active standalone video-site stack 27 on endpoint 3");
const liveFile=await fetchPortainer("api/stacks/27/file");
const oldYaml=liveFile.StackFileContent;
if(typeof oldYaml!=="string"||!oldYaml.trim())throw Error("Missing live YAML backup");
const oldEnv=stack.Env;
const oldDoc=readCompose(oldYaml,"Live");
const {content:candidateYaml,unchanged}=createV5Candidate(oldYaml);
const candidate=readCompose(candidateYaml,"Candidate");
verifyPreservation(oldDoc,candidate);
const existing=oldEnv.find(x=>x.name==="LEGACY_V5_DB_PASSWORD");
if(existing && (!/^[0-9a-f]{64}$/.test(existing.value||"")))throw Error("Existing legacy database password has unexpected format");
const newEnv=existing?oldEnv:[...oldEnv,{name:"LEGACY_V5_DB_PASSWORD",value:randomBytes(32).toString("hex")}];
if(!oldEnv.some(x=>x.name==="SIGN_SECRET" && x.value))throw Error("Existing signed gateway secret absent; refusing addon");
const backupFile=required("PORTAINER_BACKUP_FILE");
if(!backupFile.endsWith(".enc.json") || !backupFile.startsWith("/"))throw Error("Encrypted backup must be an absolute .enc.json file");
const backupKey=String(process.env.PORTAINER_BACKUP_ENCRYPTION_KEY||key);
const backup={version:1,stackId:27,endpointId:3,name:"video-site",yaml:oldYaml,env:oldEnv};
if(!deploy){
  writeBackup(backupFile,backup,backupKey);
  if(!isDeepStrictEqual(readBackup(backupFile,backupKey),backup))throw Error("Encrypted addon backup verification failed");
  console.log("Read-only addon preflight: encrypted rollback backup prepared and authenticated");
}
else if(!isDeepStrictEqual(readBackup(backupFile,backupKey),backup))throw Error("Live stack changed since encrypted backup");
const filters=encodeURIComponent(JSON.stringify({label:["com.docker.compose.project=video-site"]}));
const containerPath="api/endpoints/3/docker/containers/json?all=1&filters="+filters;
const before=await readDockerInventory(api,endpointId,containerPath);
const issues=containerFailures(before,oldDoc);
if(issues.length)throw Error("Baseline production stack unhealthy: "+issues.join(","));
const tunnel=before.find(x=>x.Labels?.["com.docker.compose.service"]==="cloudflared");
if(!tunnel?.Id)throw Error("Management tunnel missing");
if(unchanged){console.log("Optional v5 services already present and structurally identical; no writes required");process.exit(0);}
console.log("Legacy-v5 overlay verified: add 4 internal services, preserve 3 live services and tunnel; app, R2 and existing volumes unchanged");
if(!deploy){console.log("V5 ADDON PREFLIGHT PASSED: no production writes");process.exit(0);}
const tunnelImage=oldDoc.services.cloudflared.image;
const imageFilters=encodeURIComponent(JSON.stringify({reference:[tunnelImage]}));
const tunnelImages=await fetchPortainer("api/endpoints/3/docker/images/json?filters="+imageFilters);
if(!Array.isArray(tunnelImages)||!tunnelImages.some(i=>i.Id===tunnel.ImageID&&i.RepoTags?.includes(tunnelImage)))
  throw Error("Cached management Tunnel image does not match its running image; refusing implicit pull or replacement");
async function ensureImage(name) {
  const path="api/endpoints/3/docker/images/"+encodeURIComponent(name)+"/json";
  try{await fetchPortainer(path);console.log("Addon Docker image cached: "+name);return}
  catch(e){if(e.httpStatus!==404)throw e}
  const [img,tag]=name.split(":");
  const target=new URL("api/endpoints/3/docker/images/create?fromImage="+encodeURIComponent(img)+"&tag="+encodeURIComponent(tag),base);
  const res=await fetch(target,{method:"POST",headers,redirect:"manual",signal:AbortSignal.timeout(180000)});
  if(!res.ok)throw Error("Image pull failed for "+name+" HTTP "+res.status);
  // Docker emits newline-delimited progress events, which may contain errors even for HTTP 200.
  const output=await res.text();
  let failed=false;
  for(const line of output.split("\n")){if(!line.trim())continue;try{const p=JSON.parse(line);if(p.error||p.errorDetail)failed=true}catch{failed=true}}
  if(failed)throw Error("Image pull stream failed for "+name);
  await fetchPortainer(path);
  console.log("Addon image prepared: "+name);
}
for(const i of legacyV5Images)await ensureImage(i);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function healthy(yaml,env,expectedTunnel){
  const parsed=readCompose(yaml,"Health");
  for(let attempts=0;attempts<72;attempts++){
    await wait(5000);
    let current, stored, list;
    try{
      current=await fetchPortainer("api/stacks/27");
      if(Number(current.Status)===3)continue;
      if(Number(current.Status)!==1)continue;
      stored=await fetchPortainer("api/stacks/27/file");
      list=await fetchPortainer(containerPath);
    }catch{continue}
    const currentTunnel=list.find(c=>c.Labels?.["com.docker.compose.service"]==="cloudflared");
    if(currentTunnel?.Id!==expectedTunnel)throw Error("Tunnel container identity changed unexpectedly");
    if(stored.StackFileContent===yaml&&isDeepStrictEqual(current.Env,env)&&
      !containerFailures(list,parsed).length)return true;
  }
  return false;
}
const payload=(content,env)=>({StackFileContent:content,Env:env,Prune:false,PullImage:false});
try{
  await fetchPortainer("api/stacks/27?endpointId=3","PUT",payload(candidateYaml,newEnv),180000);
  if(!await healthy(candidateYaml,newEnv,tunnel.Id))throw Error("Optional v5 services not healthy after deployment");
  console.log("V5 ADDON DEPLOYED: PostgreSQL, Redis, metadata gateway and internal Nginx healthy; original tunnel preserved");
}catch(error){
  console.error("Optional v5 deployment verification failed: "+error.message);
  // Cloudflare 524 / transport timeout is ambiguous: Portainer can keep
  // applying the first update even though the client connection has ended.
  // Blindly sending a second stack PUT for rollback can race and damage it.
  // All transport failures, including ECONNRESET wrapped in TypeError, can
  // leave the origin applying an update. A second PUT must never race it.
  console.error("No automatic rollback attempted. Inspect live stack state before any further write.");
  try {
    const status=await fetchPortainer("api/stacks/27");
    const currentFile=await fetchPortainer("api/stacks/27/file");
    const isOriginal=currentFile.StackFileContent===oldYaml && isDeepStrictEqual(status.Env,oldEnv);
    const isCandidate=currentFile.StackFileContent===candidateYaml && isDeepStrictEqual(status.Env,newEnv);
    console.error("READ-ONLY RECOVERY SNAPSHOT: stack active="+(Number(status.Status)===1)+
      "; original-config="+isOriginal+"; addon-config="+isCandidate);
  } catch {
    console.error("READ-ONLY RECOVERY SNAPSHOT unavailable. Further writes remain blocked.");
  }
  process.exitCode=1;
}
