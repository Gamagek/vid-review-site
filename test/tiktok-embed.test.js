import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
const code = readFileSync(new URL('../public/tiktok-embed.js', import.meta.url), 'utf8');
const share = 'https://www.tiktok.com/@creator/video/6718335390845095173';
function harness(fetcher = async () => Response.json({ ok: true, video_id: '6718335390845095173', source_url: share })) {
  const messages = new Set(), timers = new Map(), saved = new Map(); let count = 0;
  const window = { addEventListener(type, fn) { if (type === 'message') messages.add(fn); }, removeEventListener(type, fn) { messages.delete(fn); },
    setTimeout(fn) { const id = ++count; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } };
  const context = { window, URL, AbortSignal, location: { origin: 'https://vid.best' }, fetch: fetcher,
    sessionStorage: { getItem: k => saved.get(k), setItem: (k,v) => saved.set(k,v) } };
  runInNewContext(code, context);
  return { api: window.VidBestTikTok, timers, saved, emit(event) { for (const fn of [...messages]) fn(event); } };
}
test('same-video requests coalesce, canonical URL is encoded once, and retries reuse metadata', async () => {
  let calls = 0, finish;
  const h = harness(async target => { calls++; assert.equal(new URL(target, 'https://vid.best').searchParams.get('url'), share); await new Promise(r => { finish = r; }); return Response.json({ ok: true, video_id: '6718335390845095173', source_url: share }); });
  const jobs = Array.from({length:20}, () => h.api.getMetadata(share + '?a=1&b=2'));
  assert.equal(calls, 1); finish(); await Promise.all(jobs); await h.api.getMetadata(share); assert.equal(calls, 1);
});
test('429 persists a retry deadline and does not loop requests', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return Response.json({ ok:false }, { status:429, headers:{'Retry-After':'120'} }); });
  await assert.rejects(h.api.getMetadata(share)); await assert.rejects(h.api.getMetadata(share)); assert.equal(calls, 1);
  assert.ok([...h.saved.values()].some(v => JSON.parse(v).until > Date.now() + 100000));
});
test('iframe load is not readiness; wrong origin/window are ignored and a paused ready player stays healthy', () => {
  const h = harness(), frame = { contentWindow:{} }; let ready = 0, errors = 0;
  h.api.observe(frame, { ready() { ready++; }, error() { errors++; } });
  const data = { type:'onPlayerReady', 'x-tiktok-player':true };
  h.emit({origin:'https://evil.test',source:frame.contentWindow,data}); h.emit({origin:'https://www.tiktok.com',source:{},data});
  assert.equal(ready, 0); assert.equal(h.timers.size, 1);
  h.emit({origin:'https://www.tiktok.com',source:frame.contentWindow,data});
  h.emit({origin:'https://www.tiktok.com',source:frame.contentWindow,data:{...data,type:'onStateChange',value:2}});
  assert.equal(ready, 1); assert.equal(h.timers.size, 0); assert.equal(errors, 0);
});
test('no ready message times out; disposal ignores old iframe messages after retry', () => {
  const h = harness(), frame = { contentWindow:{} }; let errors = 0, ready = 0;
  const dispose = h.api.observe(frame, { ready() {ready++;}, error(){errors++;} });
  [...h.timers.values()][0](); assert.equal(errors, 1); dispose();
  h.emit({origin:'https://www.tiktok.com',source:frame.contentWindow,data:{type:'onPlayerReady','x-tiktok-player':true}});
  assert.equal(ready, 0); assert.equal(h.timers.size, 0);
});
test('autoplay rejection keeps the real player available for a user tap', () => {
  const h = harness(), frame = {contentWindow:{}}; let ready = 0, blocked = 0, errors = 0;
  h.api.observe(frame,{ready(){ready++;},autoplay(){blocked++;},error(){errors++;}});
  h.emit({origin:'https://www.tiktok.com',source:frame.contentWindow,data:{type:'onPlayerError','x-tiktok-player':true,value:{errorCode:3002}}});
  assert.equal(ready,1);assert.equal(blocked,1);assert.equal(errors,0);assert.equal(h.timers.size,0);
});
test('rejects mismatched video metadata and unsupported or credential-bearing links', async () => {
  const h=harness(async()=>Response.json({ok:true,video_id:'7552567024304540959',source_url:share}));
  await assert.rejects(h.api.getMetadata(share), /different/);
  for (const value of [share.replace('https:','http:'),share.replace('www.tiktok.com','user@www.tiktok.com'),'https://example.com/@creator/video/6718335390845095173']) assert.equal(h.api.parse(value),null);
});
