#!/usr/bin/env node
// Portainer CE standalone Compose stack updater for Vid.Best.
// No TLS bypass, no shell invocation, no secret output, and no automatic stack deletion.
// GitHub Actions should run this on PUSH to main only, after regression tests pass.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

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
const services = [...newContent.matchAll(/^  ([a-zA-Z][a-zA-Z0-9_.-]+):\s*$/gm)]
  .map(x => x[1]).filter(x => !["volumes","networks"].includes(x));
const expected = new Set(services);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(path, { method = "GET", body, timeout = 30000 } = {}) {
  const url = new URL(path.replace(/^\//, ""), base);
  const options = {
    method,
    headers: { "X-API-Key": apiKey, "Accept": "application/json" },
    signal: AbortSignal.timeout(timeout)
  };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  const raw = await response.text();
  if (!response.ok) {
    // Do not print response bodies: some API failures echo secret environment values.
    throw new Error("Portainer " + method + " " + url.pathname +
      " returned HTTP " + response.status);
  }
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw new Error("Unexpected non-JSON Portainer response from " + url.pathname); }
}

const updatePath = "api/stacks/" + stackId + "?endpointId=" + endpointId;
const getPath = "api/stacks/" + stackId;
const original = await api(getPath);
if (original.Name !== "video-site" || Number(original.EndpointId) !== endpointId ||
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
console.log("Target verified: video-site, stack " + stackId + ", endpoint " + endpointId);
console.log("Baseline YAML SHA256 prefix " + hash(oldContent) +
  "; candidate " + hash(newContent));
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

let updated = false;
try {
  await api(updatePath, { method: "PUT", body: payload(newContent), timeout: 180000 });
  updated = true;
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
  if (updated) {
    try {
      await api(updatePath, { method: "PUT", body: payload(oldContent), timeout: 180000 });
      console.error("Rollback submitted: previously deployed YAML restored; inspect health.");
    } catch (rollbackError) {
      console.error("Rollback failed: " + rollbackError.message);
    }
  }
  process.exitCode = 1;
}
