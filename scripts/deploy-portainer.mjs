#!/usr/bin/env node
// Portainer CE standalone Compose stack updater for Vid.Best.
// No TLS bypass, no shell invocation, no secret output, and no automatic stack deletion.
// GitHub Actions should run this on PUSH to main only, after regression tests pass.
import { appendFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { containerFailures, readCompose, verifyPreservation } from "./portainer-safety.mjs";
import { readBackup, writeBackup } from "./portainer-backup.mjs";
import { createPortainerClient, readDockerInventory } from "./portainer-client.mjs";

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
const candidateCompose = readCompose(newContent, "Candidate");
const hash = (input) => createHash("sha256").update(input).digest("hex").slice(0, 12);
const backupFile = String(process.env.PORTAINER_BACKUP_FILE || "").trim();
if (backupFile && (!isAbsolute(backupFile) || !backupFile.endsWith(".enc.json"))) {
  throw new Error("Encrypted backup must use an absolute .enc.json path outside the repository");
}
const backupRelativePath = relative(resolve(process.cwd()), resolve(backupFile));
if (backupFile && !backupRelativePath.startsWith(".." + sep)) {
  throw new Error("Encrypted backup must be outside the repository");
}
if (!checkOnly && !backupFile) throw new Error("Production writes require a previously uploaded encrypted backup");
const backupKey = String(process.env.PORTAINER_BACKUP_ENCRYPTION_KEY || apiKey);
const healthSeconds = Number(process.env.PORTAINER_HEALTH_TIMEOUT_SECONDS || 480);
if (!Number.isInteger(healthSeconds) || healthSeconds < 180 || healthSeconds > 900) {
  throw new Error("Health timeout must be between 180 and 900 seconds");
}
const healthAttempts = Math.ceil(healthSeconds / 5);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const headers = { "X-API-Key": apiKey, Accept: "application/json" };
if (cfAccessId) {
  headers["CF-Access-Client-Id"] = cfAccessId;
  headers["CF-Access-Client-Secret"] = cfAccessSecret;
}
const api = createPortainerClient({ base, headers, readOnly: checkOnly });

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
const backupData = { version: 1, stackId, endpointId, name: "video-site", yaml: oldContent, env: oldEnv };
if (checkOnly && backupFile) {
  writeBackup(backupFile, backupData, backupKey);
  if (!isDeepStrictEqual(readBackup(backupFile, backupKey), backupData)) {
    throw new Error("Encrypted backup verification failed; refusing to continue");
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "backup_created=true\n");
  console.log("Encrypted YAML and environment backup created and authenticated; no plaintext secret file written.");
}
if (!checkOnly) {
  if (!isDeepStrictEqual(readBackup(backupFile, backupKey), backupData)) {
    throw new Error("Live stack changed since its backup was uploaded; refusing stale deployment");
  }
}
const baselineCompose = readCompose(oldContent, "Live");
const services = verifyPreservation(baselineCompose, candidateCompose);
if (Number(original.Status) !== 1) throw new Error("Existing stack must be Active before automatic deployment");
if (!checkOnly && original.GitConfig) throw new Error("File updater refuses a Git-managed Portainer stack");

const filters = encodeURIComponent(JSON.stringify({ label: ["com.docker.compose.project=video-site"] }));
const containersPath = "api/endpoints/" + endpointId + "/docker/containers/json?all=1&filters=" + filters;
const baselineContainers = await readDockerInventory(api, endpointId, containersPath);
const initialFailures = containerFailures(baselineContainers, baselineCompose);
if (initialFailures.length) throw new Error("Existing stack is not healthy: " + initialFailures.join(", "));
const tunnel = baselineContainers.find(c => c.Labels?.["com.docker.compose.project"] === "video-site" &&
  c.Labels?.["com.docker.compose.service"] === "cloudflared");
const tunnelImage = baselineCompose.services.cloudflared.image;
if (!tunnel?.Id || !tunnel.ImageID || typeof tunnelImage !== "string") throw new Error("Cannot verify the management Tunnel image");
if (baselineCompose.services.cloudflared.pull_policy && baselineCompose.services.cloudflared.pull_policy !== "never") {
  throw new Error("Management Tunnel pull policy must not refresh its image during automatic deployment");
}
// Image inspection through Portainer's Docker proxy can hang even when the
// stack and container listing are healthy. Do not require that slow endpoint
// during read-only preflight. Deployment still preserves the running tunnel
// container identity in waitForCompletion and forbids image pulls.
console.log("Management Tunnel container identity verified from Docker listing; image inspect skipped.");
// For initial connection tests only: no Portainer POST, PUT, or DELETE requests.
console.log("Target verified: video-site, stack " + stackId + ", endpoint " + endpointId);
console.log("Baseline YAML SHA256 prefix " + hash(oldContent) +
  "; candidate " + hash(newContent));
if (checkOnly) {
  // Structural audit: expose only service/volume names and a strictly validated
  // public APP_VERSION label. Never emit Compose YAML, env values or credentials.
  const serviceNames = c => Object.keys(c.services).sort();
  const cleanNames = names => names.filter(n => /^[a-z][a-z0-9_.-]{0,63}$/.test(n));
  const liveServices = cleanNames(serviceNames(baselineCompose));
  const candidateServices = cleanNames(serviceNames(candidateCompose));
  const configuredVersion = baselineCompose.services.app?.environment?.APP_VERSION;
  const version = typeof configuredVersion === "string" &&
    /^[A-Za-z0-9_.-]{1,96}$/.test(configuredVersion) ? configuredVersion : "unavailable";
  console.log("LIVE STRUCTURAL INVENTORY (no secrets): app version=" + version +
    "; services=" + liveServices.join(",") +
    "; named volumes=" + cleanNames(Object.keys(baselineCompose.volumes || {}).sort()).join(","));
  console.log("CANDIDATE STRUCTURAL INVENTORY: services=" + candidateServices.join(",") +
    "; additions=" + candidateServices.filter(n => !liveServices.includes(n)).join(",") +
    "; removed=" + liveServices.filter(n => !candidateServices.includes(n)).join(","));

  console.log("READ-ONLY PREFLIGHT PASSED: " +
    (cfAccessId ? "Cloudflare Service Auth, " : "") +
    "Portainer API, Stack identity, existing environment, YAML backup, storage preservation and baseline health verified. No deployment performed.");
  process.exit(0);
}
if (oldContent === newContent) {
  console.log("No stack content changes; preserving running containers.");
  process.exit(0);
}

// A running tunnel is insufficient if its mutable local tag now points to a
// different image. Check the cached tag with a GET list, without image-inspect
// or any pull, before allowing Compose to touch production.
const imageFilters = encodeURIComponent(JSON.stringify({ reference: [tunnelImage] }));
const images = await api("api/endpoints/" + endpointId + "/docker/images/json?filters=" + imageFilters);
if (!Array.isArray(images) || !images.some(image => image.Id === tunnel.ImageID && image.RepoTags?.includes(tunnelImage))) {
  throw new Error("Cached management Tunnel image does not match its running image; refusing implicit pull or replacement");
}

const payload = content => ({
  StackFileContent: content,
  Env: oldEnv,          // MUST preserve existing Portainer secrets and variables.
  Prune: false,        // Never prune unmanaged containers, images or volumes.
  PullImage: false     // No implicit unreviewed image updates.
});

async function stackState() {
  const state = await api(getPath);
  if (Number(state.Id) !== stackId || state.Name !== "video-site" || Number(state.EndpointId) !== endpointId) {
    throw new Error("Stack identity changed while waiting for deployment");
  }
  return state;
}

async function waitForCompletion(content, compose) {
  let failures = ["waiting"];
  const deadline = Date.now() + healthSeconds * 1000;
  for (let i = 0; i < healthAttempts && Date.now() < deadline; i++) {
    if (i) await sleep(5000);
    let state;
    try { state = await stackState(); }
    catch { failures = ["stack-query-failed"]; continue; }
    const status = Number(state.Status);
    if (status === 3) { failures = ["stack-deploying"]; continue; }
    if (status === 4) throw new Error("Portainer stack deployment entered Error state");
    if (status !== 1) throw new Error("Portainer stack did not return to Active state");
    try {
      const source = await api("api/stacks/" + stackId + "/file");
      if (source.StackFileContent !== content || !isDeepStrictEqual(state.Env, oldEnv)) {
        failures = ["stack-content-or-environment-not-converged"]; continue;
      }
      const containers = await api(containersPath);
      failures = containerFailures(containers, compose);
      const currentTunnel = containers.find(c => c.Labels?.["com.docker.compose.project"] === "video-site" &&
        c.Labels?.["com.docker.compose.service"] === "cloudflared");
      if (currentTunnel?.Id !== tunnel.Id) failures.push("management-tunnel-replaced");
    } catch { failures = ["health-query-failed"]; }
    if (!failures.length) return;
  }
  throw new Error("Health checks did not pass: " + failures.join(", "));
}

try {
  await api(updatePath, { method: "PUT", body: payload(newContent), timeout: 180000 });
  await waitForCompletion(newContent, candidateCompose);
  console.log("Deployment verified Active and healthy: " + services.sort().join(", "));
} catch (error) {
  console.error("Deployment failed or outcome unresolved: " + error.message);
  // A timed-out/524 PUT may have succeeded on the origin. Never issue an
  // automatic second PUT: it could race the first and damage a live stack.
  // Retain the encrypted backup for operator-reviewed recovery only.
  console.error("No automatic rollback attempted. Inspect live stack state, YAML and container health before any further write.");
  process.exitCode = 1;
}
