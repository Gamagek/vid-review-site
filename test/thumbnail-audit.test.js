import test from 'node:test';
import assert from 'node:assert/strict';
import {thumbnailEntries,probeThumbnail} from '../scripts/thumbnail-audit.mjs';
import {createHash} from 'node:crypto';

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
  const row={page:'https://vid.best/watch/example',thumbnail:'https://scontent.xx.fbcdn.net/poster.jpg?secret=private-image-sentinel'};
  const ok=await probeThumbnail(row,async()=>new Response(new Uint8Array([255,216,255,217]),{headers:{'Content-Type':'image/jpeg'}}));
  assert.equal(ok.status,'ok');
  assert.equal((await probeThumbnail(row,async()=>new Response('<html>Login</html>',{headers:{'Content-Type':'text/html'}}))).status,'non_image');
  const error=await probeThumbnail(row,async()=>{throw new Error(row.thumbnail)});
  assert.equal(error.status,'unverified_network');
  assert.doesNotMatch(JSON.stringify([ok,error]),/private-image-sentinel|secret=|poster\.jpg/);
  const redirect=await probeThumbnail(row,async(url,options)=>{assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://login.invalid'}});});
  assert.equal(redirect.status,'http_error');
});

test('known title artwork remains in the source-poster queue while ordinary SVGs remain images',async()=>{
  const response = () => new Response('<svg xmlns="http://www.w3.org/2000/svg"><text>Title artwork</text></svg>',{
    headers:{'Content-Type':'image/svg+xml; charset=utf-8','X-VidBest-Poster-Kind':'placeholder'},
  });
  const row={page:'https://vid.best/watch/example',thumbnail:'https://vid.best/api/facebook/thumbnail?id=159&v=version'};
  const placeholder=await probeThumbnail(row,async()=>response());
  assert.equal(placeholder.status,'placeholder');
  assert.equal(placeholder.httpStatus,200);
  assert.ok(placeholder.bytes>0);
  assert.equal((await probeThumbnail({...row,thumbnail:'https://vid.best/review-covers/owner.svg'},async()=>response())).status,'ok');
  assert.equal((await probeThumbnail({...row,thumbnail:'https://scontent.xx.fbcdn.net/poster.svg'},async()=>response())).status,'ok');
  const ordinary=await probeThumbnail(row,async()=>new Response('<svg/>',{headers:{'Content-Type':'image/svg+xml'}}));
  assert.equal(ordinary.status,'ok');
  assert.doesNotMatch(JSON.stringify(placeholder),/id=159|version/);
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

test('allowed raster image families receive bounded signature and complete-byte hash evidence',async()=>{
  const fixtures = [
    ['jpeg','image/jpeg',new Uint8Array([255,216,255,217])],
    ['png','image/png',new Uint8Array([137,80,78,71,13,10,26,10])],
    ['webp','image/webp',Buffer.from('RIFF0000WEBP')],
    ['gif','image/gif',Buffer.from('GIF89a')],
    ['bmp','image/bmp',Buffer.from('BMfixture')],
    ['avif','image/avif',Buffer.from([0,0,0,24,...Buffer.from('ftypavif'),0,0,0,0,...Buffer.from('mif1avif')])],
    ['avif','image/avif',Buffer.from([0,0,0,24,...Buffer.from('ftypmif1'),0,0,0,0,...Buffer.from('avifmif1')])],
  ];
  for (const [signature,type,bytes] of fixtures) {
    const result = await probeThumbnail({page:'https://vid.best/watch/example',thumbnail:'https://i.ytimg.com/poster'},async()=>new Response(bytes,{headers:{'Content-Type':type}}));
    assert.equal(result.status,'ok');
    assert.equal(result.bodySignature,signature);
    assert.equal(result.bodyVerification,'signature_match');
    assert.equal(result.bytes,bytes.byteLength);
    assert.equal(result.bodySha256,createHash('sha256').update(bytes).digest('hex'));
  }
});

test('SVG recognition tolerates BOM/XML/comments without executing or expanding source markup',async()=>{
  const row={page:'https://vid.best/watch/example',thumbnail:'https://vid.best/api/facebook/thumbnail?id=159'};
  for (const body of ['<svg/>','\uFEFF<?xml version="1.0"?>\n<!-- owner image -->\n<svg xmlns="http://www.w3.org/2000/svg"/>']) {
    const result=await probeThumbnail(row,async()=>new Response(body,{headers:{'Content-Type':'image/svg+xml','X-VidBest-Poster-Kind':'placeholder'}}));
    assert.equal(result.status,'placeholder');assert.equal(result.bodySignature,'svg');
  }
  const unknown=await probeThumbnail(row,async()=>new Response('<!DOCTYPE svg [<!ENTITY private "hidden">]><svg>&private;</svg>',{headers:{'Content-Type':'image/svg+xml','X-VidBest-Poster-Kind':'placeholder'}}));
  assert.equal(unknown.status,'unverified_image_body');
  assert.doesNotMatch(JSON.stringify(unknown),/ENTITY|hidden|id=159/);
});

test('image-labelled HTML and mismatched raster types no longer count as available image bodies',async()=>{
  const row={page:'https://vid.best/watch/example',thumbnail:'https://scontent.xx.fbcdn.net/poster?private=secret'};
  const html='<html><title>Sign in</title></html>';
  const unknown=await probeThumbnail(row,async()=>new Response(html,{headers:{'Content-Type':'image/jpeg'}}));
  assert.equal(unknown.status,'unverified_image_body');
  assert.equal(unknown.bodyVerification,'signature_unrecognized');
  assert.equal(unknown.bodySha256,createHash('sha256').update(html).digest('hex'));
  const mismatch=await probeThumbnail(row,async()=>new Response('GIF87a',{headers:{'Content-Type':'image/png'}}));
  assert.equal(mismatch.status,'mime_mismatch');assert.equal(mismatch.bodySignature,'gif');
  assert.doesNotMatch(JSON.stringify([unknown,mismatch]),/private=|secret|Sign in|poster\?/);
});

test('streaming hash covers bytes beyond the bounded header with one unchanged request',async()=>{
  const bytes=new Uint8Array(7000).fill(42);bytes.set([255,216,255]);let calls=0;
  const result=await probeThumbnail({page:'https://vid.best/watch/example',thumbnail:'https://i.ytimg.com/poster'},async(url,options)=>{
    calls++;assert.equal(options.redirect,'manual');assert.equal(options.headers.Accept,'image/*');
    return new Response(new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,2));controller.enqueue(bytes.subarray(2,5000));controller.enqueue(bytes.subarray(5000));controller.close();}}),{headers:{'Content-Type':'image/jpeg'}});
  });
  assert.equal(calls,1);assert.equal(result.status,'ok');assert.equal(result.bytes,7000);
  assert.equal(result.bodySha256,createHash('sha256').update(bytes).digest('hex'));
});

test('empty and oversized bodies cannot produce a misleading available or partial-hash result',async()=>{
  const row={page:'https://vid.best/watch/example',thumbnail:'https://i.ytimg.com/poster'};
  const empty=await probeThumbnail(row,async()=>new Response(new Uint8Array(),{headers:{'Content-Type':'image/jpeg'}}));
  assert.equal(empty.status,'empty');assert.equal(empty.bodyVerification,'empty');
  let cancelled=false;
  const large=await probeThumbnail(row,async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(2*1024*1024+1));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'image/jpeg'}}));
  assert.equal(large.status,'invalid_size');assert.equal(large.bodySha256,undefined);assert.equal(cancelled,true);
  const declared=await probeThumbnail(row,async()=>new Response(new Uint8Array([255,216,255]),{headers:{'Content-Type':'image/jpeg','Content-Length':String(2*1024*1024+1)}}));
  assert.equal(declared.status,'invalid_size');assert.equal(declared.bodySha256,undefined);
});

test('stream failures redact error URLs, add no retry and never persist a partial digest',async()=>{
  let calls=0;
  const result=await probeThumbnail({page:'https://vid.best/watch/example',thumbnail:'https://scontent.xx.fbcdn.net/poster?signature=private'},async()=>{
    calls++;return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([255,216,255]));controller.error(new Error('signature=private'));}}),{headers:{'Content-Type':'image/jpeg'}});
  });
  assert.equal(result.status,'unverified_network');assert.equal(calls,1);assert.equal(result.bodySha256,undefined);
  assert.doesNotMatch(JSON.stringify(result),/signature|private/);
});
