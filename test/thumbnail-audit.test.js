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
