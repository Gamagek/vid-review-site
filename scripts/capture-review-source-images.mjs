import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

// Owner-authorized, unchanged publisher previews for the already reserved batch.
// No video requests, D1 writes, thumbnail replacements, proxy route or retries.
const manifest = JSON.parse(fs.readFileSync(new URL('../src/review-illustrations.json', import.meta.url)));
const queue = JSON.parse(fs.readFileSync(new URL('../docs/review-image-queue.json', import.meta.url)));
const ids = queue.lastImageProductionBatch?.recordIds;
assert.ok(ids?.length > 0 && ids.length <= 10 && new Set(ids).size === ids.length);
const output = new URL('../public/review-source-images/', import.meta.url);
fs.mkdirSync(output, {recursive: true});

function jpegDimensions(bytes) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'JPEG signature');
  for (let offset = 2; offset + 9 < bytes.length;) {
    assert.equal(bytes[offset++], 0xff, 'JPEG marker');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = bytes.readUInt16BE(offset);
    assert.ok(length >= 2 && offset + length <= bytes.length, 'Bounded JPEG segment');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return {
      width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3),
    };
    offset += length;
  }
  throw Error('JPEG dimensions unavailable');
}

for (const id of ids) {
  const item = manifest.find(row => row.id === id);
  assert.ok(item?.sourceImage, 'Only the reserved, audited source/artwork pairs');
  const source = new URL(item.sourceUrl);
  assert.ok(['www.youtube.com', 'youtube.com'].includes(source.hostname));
  const videoId = source.searchParams.get('v') || source.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})$/)?.[1];
  assert.match(videoId || '', /^[\w-]{11}$/);
  const url = new URL(item.sourceImage.url);
  assert.equal(url.href, `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, 'Exact same-video publisher preview');
  const response = await fetch(url, {redirect: 'error', signal: AbortSignal.timeout(20000)});
  assert.equal(response.status, 200, `Source ${id}`);
  assert.equal(response.headers.get('content-type')?.split(';')[0], 'image/jpeg');
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 150_000) throw Error(`Oversized source ${id}`);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const {width, height} = jpegDimensions(bytes);
  assert.equal(width, item.sourceImage.width);
  assert.equal(height, item.sourceImage.height);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const filename = `${id}-${sha256.slice(0,16)}.jpg`;
  const file = new URL(filename, output);
  if (fs.existsSync(file)) assert.deepEqual(fs.readFileSync(file), bytes);
  else fs.writeFileSync(file, bytes);
  const record = {id, url: url.href, path: '/review-source-images/' + filename,
    bytes: length, sha256, width, height, mime: 'image/jpeg', httpStatus: 200,
    modified: false, checkedAt: new Date().toISOString()};
  console.log('__VIDBEST_SOURCE_RECORD__' + JSON.stringify(record));
  // Optional transfer of public image bytes through a read-only CI log.
  // No credential, private response or production data is included.
  if (process.argv.includes('--emit-transfer')) {
    const base64 = bytes.toString('base64');
    for (let index = 0; index < base64.length; index += 4096) {
      console.log('__VIDBEST_SOURCE_BYTES__' + JSON.stringify({id, index, data: base64.slice(index,index+4096)}));
    }
  }
}
