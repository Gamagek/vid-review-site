import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { isDeepStrictEqual } from "node:util";
import { readCompose, verifyPreservation } from "./portainer-safety.mjs";
const names = ["legacy-v5-postgres","legacy-v5-redis","legacy-v5","legacy-v5-nginx"];
const data = ["legacy-v5-pg-data","legacy-v5-redis-data"];
export const legacyV5Services = Object.freeze(names);
export const legacyV5Images = Object.freeze(["postgres:16-alpine","redis:7-alpine","nginx:1.27-alpine"]);
export function createV5Candidate(liveYaml) {
  const old = readCompose(liveYaml,"Live");
  if (!["app","cloudflared","rapidapi-tester"].every(n => old.services[n])) throw Error("Live stack is missing production services");
  const present = names.filter(n => old.services[n]);
  if (present.length && present.length !== names.length) throw Error("Partial optional v5 installation requires manual review");
  if (!present.length && data.some(v => old.volumes?.[v])) throw Error("Optional v5 volumes already owned by another service");
  const server = readFileSync("ops/portainer/legacy-v5-server.cjs","utf8").trimEnd();
  const nginx = readFileSync("ops/portainer/legacy-v5-nginx.conf","utf8").trimEnd();
  if (server.includes("VIDBEST_LEGACY_V5_SOURCE") || nginx.includes("VIDBEST_LEGACY_NGINX_SOURCE"))
    throw Error("Reserved delimiter present in addon source");
  const startApp = "cat > /app/server.cjs <<'VIDBEST_LEGACY_V5_SOURCE'\n" + server +
    "\nVIDBEST_LEGACY_V5_SOURCE\nnpm init -y >/dev/null 2>&1\n" +
    "npm install --no-audit --no-fund --silent pg redis\nexec node /app/server.cjs";
  const startNginx = "cat > /etc/nginx/conf.d/default.conf <<'VIDBEST_LEGACY_NGINX_SOURCE'\n" +
    nginx + "\nVIDBEST_LEGACY_NGINX_SOURCE\nexec nginx -g 'daemon off;'";
  const dbPass = "$"+"{LEGACY_V5_DB_PASSWORD}",sign = "$"+"{SIGN_SECRET}";
  const additions = {
    "legacy-v5-postgres": {
      image:"postgres:16-alpine",restart:"unless-stopped",
      environment:{POSTGRES_USER:"app",POSTGRES_DB:"videos",POSTGRES_PASSWORD:dbPass},
      volumes:["legacy-v5-pg-data:/var/lib/postgresql/data"],
      healthcheck:{test:["CMD-SHELL","pg_isready -U app -d videos"],interval:"10s",timeout:"5s",retries:10,start_period:"40s"}
    },
    "legacy-v5-redis": {
      image:"redis:7-alpine",restart:"unless-stopped",
      command:["redis-server","--appendonly","yes","--maxmemory","128mb","--maxmemory-policy","allkeys-lru"],
      volumes:["legacy-v5-redis-data:/data"],
      healthcheck:{test:["CMD","redis-cli","ping"],interval:"10s",timeout:"5s",retries:10,start_period:"15s"}
    },
    "legacy-v5": {
      image:"node:22-alpine",restart:"unless-stopped",working_dir:"/app",
      environment:{SIGN_SECRET:sign,DATABASE_URL:"postgres://app:"+dbPass+"@legacy-v5-postgres:5432/videos",
        REDIS_URL:"redis://legacy-v5-redis:6379"},
      depends_on:["legacy-v5-postgres","legacy-v5-redis"],expose:["8080"],
      command:["/bin/sh","-ec",startApp],
      healthcheck:{test:["CMD-SHELL","wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1"],interval:"20s",timeout:"5s",retries:10,start_period:"180s"}
    },
    "legacy-v5-nginx": {
      image:"nginx:1.27-alpine",restart:"unless-stopped",depends_on:["legacy-v5"],expose:["8080"],
      command:["/bin/sh","-ec",startNginx],
      healthcheck:{test:["CMD-SHELL","wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1"],interval:"20s",timeout:"5s",retries:6,start_period:"45s"}
    }
  };
  const doc = parseDocument(liveYaml,{uniqueKeys:true,merge:true,prettyErrors:false,logLevel:"silent"});
  if (doc.errors.length || doc.warnings.length)throw Error("Cannot safely parse live YAML");
  if (!doc.has("volumes"))doc.set("volumes",{});
  for(const [n,s] of Object.entries(additions)) {
    if(present.length && !isDeepStrictEqual(old.services[n],s))throw Error("Installed optional v5 differs; manual review needed");
    if(!present.length)doc.setIn(["services",n],s);
  }
  for(const n of data)if(!doc.hasIn(["volumes",n]))doc.setIn(["volumes",n],{});
  const output=doc.toString({lineWidth:0});
  const parsed=readCompose(output,"Candidate");
  verifyPreservation(old,parsed);
  if(!names.every(n=>parsed.services[n]))throw Error("Missing optional service");
  return {content:output,services:names,unchanged:present.length===names.length};
}
