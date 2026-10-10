#!/usr/bin/env node
// Portainer CE standalone Compose stack updater for Vid.Best.
// No TLS bypass, no shell invocation, no secret output, and no automatic stack deletion.
// GitHub Actions should run this on PUSH to main only, after regression tests pass.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
if (args.some(arg => !["--check-only", "--deploy"].includes(arg)) ||
    (args.includes("--check-only") && args.includes("--deploy"))) {
  throw new Error("Choose --check-only or --deploy; unknown or conflicting arguments refused");
}
// Default to read-only, even when invoked directly outside GitHub Actions.
const checkOnly = !args.includes("--deploy");
if (!checkOnly && process.env.PORTAINER_AUTO_DEPLOY_ENABLED !== "true") {
  throw new Error("Production writes require --deploy and PORTAINER_AUTO_DEPLOY_ENABLED=true");
}
const required = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error("Missing required deployment setting: " + name);
  return value;
};
const base = new URL(required("PORTAINER_URL"));
if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
  throw new Error("PORTAINER_URL must be a normal HTTPS origin");
}
if (base.pathname !== "/") throw new Error("PORTAINER_URL must not contain a path");
const apiKey = required("PORTAINER_API_KEY");
const cfAccessId = String(process.env.CF_ACCESS_CLIENT_ID || "").trim();
const cfAccessSecret = String(process.env.CF_ACCESS_CLIENT_SECRET || "").trim();
if (Boolean(cfAccessId) !== Boolean(cfAccessSecret)) {
  throw new Error("Both Cloudflare Access service token components must be configured together");
}
const protectedHost = base.hostname === "portainer.megasale.win";
if (protectedHost && !cfAccessId) {
  throw new Error("Cloudflare Access service token is required for the protected Portainer hostname");
}
// This is a non-secret fingerprint of the Client ID retrieved from Cloudflare.
// It distinguishes a wrong token/UUID in GitHub Secrets without logging either credential.
const expectedAccessIdHash = String(process.env.CF_ACCESS_EXPECTED_CLIENT_ID_SHA256 || "").trim();
if (expectedAccessIdHash && !/^[a-f0-9]{64}$/.test(expectedAccessIdHash)) {
  throw new Error("CF_ACCESS_EXPECTED_CLIENT_ID_SHA256 must be a SHA-256 fingerprint");
}
if (expectedAccessIdHash &&
    createHash("sha256").update(cfAccessId).digest("hex") !== expectedAccessIdHash) {
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(cfAccessId);
  throw new Error("Cloudflare Access credential identity mismatch: CF_ACCESS_CLIENT_ID does not match " +
    "the Client ID of VidBest-GitHub-AutoDeploy allowed by the Portainer policy" +
    (uuid ? "; a token UUID was supplied instead of a Client ID" : "") +
    ". Correct the effective GitHub Secret in portainer-production or its repository fallback. No request sent.");
}
if (expectedAccessIdHash) console.log("Cloudflare Access Client ID identity verified against the configured policy token.");
console.log(checkOnly ? "Mode: READ-ONLY; only GET requests permitted." : "Mode: DEPLOY; production write flag verified.");
const stackId = Number(required("PORTAINER_STACK_ID"));
const endpointId = Number(required("PORTAINER_ENDPOINT_ID"));
if (!Number.isSafeInteger(stackId) || stackId < 1 ||
    !Number.isSafeInteger(endpointId) || endpointId < 1) {
  throw new Error("Stack and Endpoint IDs must be positive integers");
}
const filePath = String(process.env.PORTAINER_STACK_FILE || "ops/portainer/vidbest-v56.yaml");
if (!/^ops\/portainer\/[a-zA-Z0-9_.-]+\.ya?ml$/.test(filePath) || filePath.includes("..")) {
  throw new Error("Stack file must be a reviewed YAML under ops/portainer/");
}
const newContent = readFileSync(filePath, "utf8");
if (!newContent.includes("\nservices:\n") ||
    !newContent.includes("  app:") ||
    !newContent.includes("  cloudflared:") ||
    !newContent.includes("  rapidapi-tester:")) {
  throw new Error("Expected Vid.Best services are missing from the Stack YAML");
}
if ((newContent.match(/^  cloudflared:/gm) || []).length !== 1) {
  throw new Error("Exactly one cloudflared service is required");
}
const hash = (input) => createHash("sha256").update(input).digest("hex").slice(0, 12);
const composeLines = newContent.split(/\r?\n/);
const servicesStart = composeLines.findIndex(line => /^services:\s*$/.test(line));
const servicesEnd = composeLines.findIndex((line, i) =>
  i > servicesStart && /^[a-zA-Z][a-zA-Z0-9_-]*:\s*(?:#.*)?$/.test(line));
if (servicesStart < 0) throw new Error("Unable to parse the services section");
const serviceSection = composeLines.slice(servicesStart + 1,
  servicesEnd > 0 ? servicesEnd : undefined).join("\n");
const services = [...serviceSection.matchAll(/^  ([a-zA-Z][a-zA-Z0-9_.-]+):\s*$/gm)]
  .map(x => x[1]);
if (!services.includes("app") || !services.includes("cloudflared") ||
    !services.includes("rapidapi-tester")) {
  throw new Error("Expected stack services missing after parsing");
}
const expected = new Set(services);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(path, { method = "GET", body, timeout = 30000 } = {}) {
  if (checkOnly && method !== "GET") throw new Error("Read-only mode refuses all non-GET API requests");
  const url = new URL(path.replace(/^\//, ""), base);
  const options = {
    method,
    headers: { "X-API-Key": apiKey, "Accept": "application/json" },
    // Do not follow an HTML login redirect and mistake the final 200 for JSON.
    redirect: "manual",
    signal: AbortSignal.timeout(timeout)
  };
  if (cfAccessId) {
    options.headers["CF-Access-Client-Id"] = cfAccessId;
    options.headers["CF-Access-Client-Secret"] = cfAccessSecret;
  }
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  let response;
  try { response = await fetch(url, options); }
  catch {
    // Node transport errors can include sensitive request details in nested causes.
    throw new Error("Portainer API transport failed at " + url.pathname +
      "; check trusted TLS, tunnel reachability and request timeout");
  }
  // Never print responses or redirect query strings. Those can contain credentials.
  // Only report the status, MIME type, and a fixed classification of a login page.
  const reportedMime = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const mime = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(reportedMime) ? reportedMime : "";
  const location = response.headers.get("location") || "";
  console.log("Portainer API " + method + " " + url.pathname + " -> HTTP " +
    response.status + "; Content-Type: " + (mime || "missing or invalid"));
  if (response.status >= 300 && response.status < 400) {
    const loginRedirect = location.includes("/cdn-cgi/access/") ||
      location.includes("cloudflareaccess.com");
    throw new Error("Portainer API returned HTTP " + response.status +
      (loginRedirect ? " (Cloudflare Access login redirect; check Service Auth token)" :
      " (unexpected redirect)") + " at " + url.pathname);
  }
  if (!response.ok) {
    throw new Error("Portainer " + method + " " + url.pathname +
      " returned HTTP " + response.status + " (" + (mime || "unknown content type") + ")");
  }
  if (mime && mime !== "application/json" && !mime.endsWith("+json")) {
    throw new Error("Portainer API returned HTTP " + response.status + " " + mime +
      " at " + url.pathname + "; expected JSON (possible Access login or proxy rewrite)");
  }
  const raw = await response.text();
  if (!raw.trim()) throw new Error("Portainer API returned an empty JSON response at " + url.pathname);
  try { return JSON.parse(raw); }
  catch { throw new Error("Portainer API returned HTTP " + response.status +
    " with malformed JSON at " + url.pathname); }
}

const updatePath = "api/stacks/" + stackId + "?endpointId=" + endpointId;
const getPath = "api/stacks/" + stackId;
const original = await api(getPath);
if (Number(original.Id) !== stackId || original.Name !== "video-site" || Number(original.EndpointId) !== endpointId ||
    Number(original.Type) !== 2) {
  throw new Error("Wrong target: must be the existing video-site standalone Compose stack");
}
if (!Array.isArray(original.Env)) {
  throw new Error("Portainer did not return the current stack Env array; refusing to overwrite it");
}
const stored = await api("api/stacks/" + stackId + "/file");
if (typeof stored.StackFileContent !== "string" || !stored.StackFileContent.trim()) {
  throw new Error("Cannot back up the current Stack YAML; refusing to deploy");
}
const oldContent = stored.StackFileContent;
const oldEnv = original.Env;
// For initial connection tests only: no Portainer POST, PUT, or DELETE requests.
console.log("Target verified: video-site, stack " + stackId + ", endpoint " + endpointId);
console.log("Baseline YAML SHA256 prefix " + hash(oldContent) +
  "; candidate " + hash(newContent));
if (checkOnly) {
  console.log("READ-ONLY PREFLIGHT PASSED: " +
    (cfAccessId ? "Cloudflare Service Auth, " : "") +
    "Portainer API, Stack identity, existing environment and YAML backup read verified. No deployment performed.");
  process.exit(0);
}
if (oldContent === newContent) {
  console.log("No stack content changes; preserving running containers.");
  process.exit(0);
}

const payload = content => ({
  StackFileContent: content,
  Env: oldEnv,          // MUST preserve existing Portainer secrets and variables.
  Prune: false,        // Never prune unmanaged containers, images or volumes.
  PullImage: false     // No implicit unreviewed image updates.
});

async function healthy() {
  const filters = encodeURIComponent(JSON.stringify({
    label: ["com.docker.compose.project=video-site"]
  }));
  const containers = await api("api/endpoints/" + endpointId +
    "/docker/containers/json?all=1&filters=" + filters);
  if (!Array.isArray(containers)) throw new Error("Unexpected Docker containers response");
  const seen = new Map();
  for (const c of containers) {
    if (c.Labels?.["com.docker.compose.project"] === "video-site") {
      seen.set(c.Labels["com.docker.compose.service"], c);
    }
  }
  const failures = [];
  for (const service of expected) {
    const c = seen.get(service);
    if (!c) { failures.push(service + ":missing"); continue; }
    if (c.State !== "running") { failures.push(service + ":" + c.State); continue; }
    if (/unhealthy/i.test(c.Status || "")) failures.push(service + ":unhealthy");
    if (["app", "rapidapi-tester", "legacy-v7"].includes(service) &&
        !/\(healthy\)/i.test(c.Status || "")) failures.push(service + ":not-healthy-yet");
  }
  return failures;
}

let attempted = false;
try {
  attempted = true;
  await api(updatePath, { method: "PUT", body: payload(newContent), timeout: 180000 });
  let failures = ["waiting"];
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    try { failures = await healthy(); }
    catch (err) { failures = ["health-query-failed"]; }
    if (failures.length === 0) {
      console.log("Deployment healthy: " + [...expected].sort().join(", "));
      process.exit(0);
    }
  }
  throw new Error("Health checks did not pass: " + failures.join(", "));
} catch (error) {
  console.error("Deployment failed: " + error.message);
  // A write request can fail after the server already applied changes.
  // Always try to restore the prior YAML if a PUT was attempted.
  if (attempted) {
    try {
      await api(updatePath, { method: "PUT", body: payload(oldContent), timeout: 180000 });
      console.error("Rollback submitted: previously deployed YAML restored; inspect health.");
    } catch (rollbackError) {
      console.error("Rollback failed: " + rollbackError.message);
    }
  }
  process.exitCode = 1;
}
