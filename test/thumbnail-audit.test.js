import test from 'node:test';
import assert from 'node:assert/strict';
import {thumbnailEntries,probeThumbnail} from '../scripts/thumbnail-audit.mjs';

test('thumbnail inventory accepts published canonical review URLs and rejects XML entities',()=>{
  assert.deepEqual(thumbnailEntries('<url><loc>https://vid.best/watch/example</loc><video:thumbnail_loc>https://i.ytimg.com/poster.jpg?a=1&amp;b=2</video:thumbnail_loc></url>'),[{page:'https://vid.best/watch/example',thumbnail:'https://i.ytimg.com/poster.jpg?a=1&b=2'}]);
  assert.throws(()=>thumbnailEntries('<!DOCTYPE xml><url></url>'));
  assert.deepEqual(thumbnailEntries('<url><loc>https://evil.example/watch/page</loc></url>'),[]);
});

test('thumbnail checks reject page links and private destinations before fetching',async()=>{
  for(const thumbnail of ['https://www.facebook.com/reel/123','http://vid.best/private','https://127.0.0.1/img','https://vid.best:9443/img','https://user:secret@vid.best/img']) {
    assert.equal((await probeThumbnail({page:'https://vid.best/watch/example',thumbnail},()=>{throw new Error('must not fetch')})).status,'invalid_image_url');
  }
});

test('thumbnail checks redact signed URLs and distinguish images from HTML',async()=>{
  const row={page:'https://vid.best/watch/example',thumbnail:'https://scontent.xx.fbcdn.net/poster.jpg?secret=signature'};
  const ok=await probeThumbnail(row,async()=>new Response(new Uint8Array([255,216,255,217]),{headers:{'Content-Type':'image/jpeg'}}));
  assert.equal(ok.status,'ok');
  assert.equal((await probeThumbnail(row,async()=>new Response('<html>Login</html>',{headers:{'Content-Type':'text/html'}}))).status,'non_image');
  const error=await probeThumbnail(row,async()=>{throw new Error(row.thumbnail)});
  assert.equal(error.status,'unverified_network');
  assert.doesNotMatch(JSON.stringify([ok,error]),/signature|secret=|poster.jpg/);
  const redirect=await probeThumbnail(row,async(url,options)=>{assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://login.invalid'}});});
  assert.equal(redirect.status,'http_error');
});

test('a real watch-page cover is found when optional video sitemap metadata is absent',async()=>{
  const calls=[];const r=await probeThumbnail({page:'https://vid.best/watch/lab-review-1-player-test',thumbnail:''},async(url,options)=>{
    calls.push(url);assert.equal(options.redirect,'manual');
    return url.includes('/watch/')?new Response('<meta content="/review-covers/lab.jpg" property="og:image">',{headers:{'Content-Type':'text/html'}}):new Response(new Uint8Array([255,216,255,217]),{headers:{'Content-Type':'image/jpeg'}});
  });assert.equal(r.status,'ok');assert.equal(r.metadataSource,'watch_open_graph');assert.deepEqual(calls,['https://vid.best/watch/lab-review-1-player-test','https://vid.best/review-covers/lab.jpg']);
});

test('watch fallback rejects private pages and does not count a site icon as a video cover',async()=>{
  assert.equal((await probeThumbnail({page:'https://vid.best/admin',thumbnail:''},()=>{throw Error('no fetch')})).status,'invalid_watch_url');
  const r=await probeThumbnail({page:'https://vid.best/watch/example',thumbnail:''},async()=>new Response('<meta property="og:image" content="https://vid.best/favicon.svg">',{headers:{'Content-Type':'text/html'}}));assert.equal(r.status,'missing');
  const error=await probeThumbnail({page:'https://vid.best/watch/example',thumbnail:''},async()=>{throw Error('private-sentinel')});assert.equal(error.status,'watch_metadata_unverified');assert.doesNotMatch(JSON.stringify(error),/sentinel/);
});

test('a missing YouTube frame diagnoses only the same-video official default and preserves the failure',async()=>{
  const calls=[];const row={page:'https://vid.best/watch/cricket',thumbnail:'https://i.ytimg.com/vi/YVT1oUI2nTE/hq2.jpg'};
  const r=await probeThumbnail(row,async(url)=>{calls.push(url);return url.endsWith('hq2.jpg')?new Response(null,{status:404}):new Response(new Uint8Array([255,216,255,217]),{headers:{'Content-Type':'image/jpeg'}})});
  assert.equal(r.status,'http_error');assert.equal(r.httpStatus,404);assert.equal(r.fallback.status,'ok');assert.equal(r.fallback.variant,'same_video_hqdefault');assert.deepEqual(calls,[row.thumbnail,'https://i.ytimg.com/vi/YVT1oUI2nTE/hqdefault.jpg']);
  const forbidden=await probeThumbnail(row,async()=>new Response(null,{status:403}));assert.equal(forbidden.fallback,undefined);
});
