import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";

const secret = "correct-horse-battery-staple-admin-secret";
const env = { ADMIN_SECRET_KEY: secret, APP_NAME: "Test" };

function send(path, init = {}) {
  return worker.fetch(new Request(`https://example.com${path}`, init), env, { waitUntil() {} });
}

test("rejects non-object JSON before processing it", async () => {
  const response = await send("/api/discovery-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "[]",
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, error: "JSON body must be an object" });
});

test("exchanges the admin secret for an HttpOnly session cookie", async () => {
  const response = await send("/api/admin/session", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("Set-Cookie");
  assert.match(cookie, /^__Host-vidbest_admin=/);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.doesNotMatch(cookie, new RegExp(secret));
});

test("requires same-origin requests when a cookie authenticates a mutation", async () => {
  const login = await send("/api/admin/session", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const cookie = login.headers.get("Set-Cookie").split(";", 1)[0];
  const response = await send("/api/admin/session", { method: "POST", headers: { Cookie: cookie } });
  assert.equal(response.status, 403);
});

test("rejects active-content uploads", async () => {
  const response = await send("/api/assets?filename=attack.svg", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "image/svg+xml",
      "Content-Length": "12",
      "X-File-Name": "attack.svg",
    },
    body: "<svg></svg>",
  });
  assert.equal(response.status, 415);
});

