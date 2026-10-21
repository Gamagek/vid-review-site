import test from "node:test";
import assert from "node:assert/strict";
import {validatePublicOrigin, escapeHtml, githubLoginAllowed, proxyMcpRequest, UPSTREAM_MCP_URL} from "../src/security.js";

test("reject invalid or placeholder origins", () => {
  for (const origin of ["", "http://demo.workers.dev", "https://demo.workers.dev/path", "https://REPLACE-ME.workers.dev", "https://attacker@example.com"]) {
    assert.throws(() => validatePublicOrigin(origin));
  }
  assert.equal(validatePublicOrigin("https://demo.workers.dev"), "https://demo.workers.dev");
});

test("authorize only the nominated GitHub login", () => {
  assert.equal(githubLoginAllowed("Gamagek", "gamagek"), true);
  assert.equal(githubLoginAllowed("OtherUser", "Gamagek"), false);
  assert.equal(githubLoginAllowed("Gamagek", ""), false);
});

test("escape untrusted OAuth client metadata", () => {
  assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
});

test("proxy sends only intended headers and key to fixed host", async () => {
  const original = new Request("https://demo.workers.dev/mcp?target=https://attacker.invalid", {
    method: "POST",
    headers: {Authorization: "Bearer USER_SECRET", Cookie: "session=secret", "mcp-session-id": "abc", "content-type":"application/json"},
    body: JSON.stringify({jsonrpc:"2.0",method:"tools/list",id:1})
  });
  let called = 0;
  const result = await proxyMcpRequest(original, "TEST_SERVER_KEY", async (url, opts) => {
    called++;
    assert.equal(url, UPSTREAM_MCP_URL);
    assert.equal(opts.headers.get("authorization"), "Bearer TEST_SERVER_KEY");
    assert.equal(opts.headers.get("cookie"), null);
    assert.equal(opts.headers.get("mcp-session-id"), "abc");
    assert.match(await new Response(opts.body).text(), /tools\/list/);
    return new Response("data: {}\n\n", {status:200,headers:{"content-type":"text/event-stream","mcp-session-id":"next","set-cookie":"leak=1"}});
  });
  assert.equal(called, 1);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("set-cookie"), null);
  assert.equal(result.headers.get("mcp-session-id"), "next");
});

test("proxy does not follow upstream redirects with API key", async () => {
  const request = new Request("https://demo.workers.dev/mcp", {method:"GET"});
  const result = await proxyMcpRequest(request, "KEY", async (_url, opts) => {
    assert.equal(opts.redirect, "manual");
    return new Response(null, {status:302,headers:{Location:"https://attacker.invalid"}});
  });
  assert.equal(result.status, 502);
});

test("proxy rejects unrelated paths and no key", async () => {
  assert.equal((await proxyMcpRequest(new Request("https://demo.workers.dev/mcp/evil"), "KEY")).status, 404);
  assert.equal((await proxyMcpRequest(new Request("https://demo.workers.dev/mcp"), "")).status, 503);
});