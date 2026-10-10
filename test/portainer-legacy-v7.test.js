import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import test from "node:test";

const yaml = readFileSync(new URL("../ops/portainer/vidbest-v56-with-optional-v7.yaml", import.meta.url), "utf8");

function extractHereDoc(name) {
  const start = "        cat > /app/" + name + " <<'VIDBEST_LEGACY_V7'\n";
  const begin = yaml.indexOf(start);
  assert.notEqual(begin, -1, "Missing embedded original legacy player source");
  const codeStart = begin + start.length;
  const terminator = "\n        VIDBEST_LEGACY_V7\n";
  const end = yaml.indexOf(terminator, codeStart);
  assert.notEqual(end, -1, "Missing terminal legacy player marker");
  return yaml.slice(codeStart, end).split("\n").map((line) => {
    assert.ok(line.startsWith("        "), "YAML block indentation must be preserved");
    return line.slice(8);
  }).join("\n");
}

test("the optional v7 Portainer stack preserves production services without a second tunnel", () => {
  for (const name of ["app", "cloudflared", "rapidapi-tester", "legacy-v7"]) {
    assert.ok(yaml.includes("\n  " + name + ":\n"), name + " service missing");
  }
  assert.equal((yaml.match(/^  cloudflared:/gm) || []).length, 1);
  assert.match(yaml, /APP_VERSION: "56-R2-ADMIN-APPROVED-RAPIDAPI-CACHE"/);
  assert.match(yaml, /R2_BUCKET_NAME: "vid-assets"/);
  assert.match(yaml, /CACHE_HOOK_SECRET: "\$\{CACHE_HOOK_SECRET\}"/);
  assert.match(yaml, /"http:\/\/legacy-v7:8080\/watch"/);
  assert.ok(yaml.includes('if (url.pathname === "/watch")'), "Existing R2-first player must remain");
  assert.ok(yaml.includes('if (url.pathname === "/status")'), "Existing polling endpoint must remain");
  assert.ok(yaml.includes('if (url.pathname === "/cache/authorized"'), "Admin-only cache webhook must remain");
});

test("embedded historical v7 player parses and only embeds official TikTok playback", () => {
  const source = extractHereDoc("server.cjs");
  assert.doesNotThrow(() => new Script(source, { filename: "legacy-v7/server.cjs" }));
  assert.match(source, /www\.tiktok\.com\/player\/v1/);
  assert.match(source, /www\.tiktok\.com\/embed\/v2/);
  assert.doesNotMatch(source, /spawn\(|exec\(|yt-dlp/);
  assert.ok(yaml.includes('SIGN_SECRET: "${SIGN_SECRET}"'));
  assert.ok(yaml.includes("new RegExp(\"^/@[A-Za-z0-9_.]{1,32}/video/[0-9]{15,25}/?$\")"));
});
