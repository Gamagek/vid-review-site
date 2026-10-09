import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the exact helper shipped in the Compose heredoc, including Compose's $$ expansion.
const yaml = readFileSync(new URL('../ops/portainer/vidbest-v56.yaml', import.meta.url), 'utf8').replaceAll('$$', '$');
const helper = yaml.match(/function privateWatermarkedMedia\(body, expectedId\) \{[\s\S]*?\n      \}/)[0];
const resolve = vm.runInNewContext(`(function () {
  const looksLikeUrl = value => typeof value === 'string' && /^https:\/\//.test(value);
  ${helper}
  return privateWatermarkedMedia;
})()`);
const id = '7578945803910270230';

test('Portainer resolves both tester-supported watermarked response shapes', () => {
  assert.equal(resolve({ data: { id, wmplay: 'https://cdn.example/one.mp4' } }, id), 'https://cdn.example/one.mp4');
  assert.equal(resolve({ data: { video_id: id, download_link: { watermark: 'https://cdn.example/two.mp4' } } }, id), 'https://cdn.example/two.mp4');
  assert.equal(resolve({ video_id: id, download_link: { watermark_hd: 'https://cdn.example/hd.mp4' } }, id), 'https://cdn.example/hd.mp4');
});

test('Portainer does not substitute another video or an unwatermarked link', () => {
  assert.equal(resolve({ data: { id: '7332342275151760642', wmplay: 'https://cdn.example/wrong.mp4' } }, id), null);
  assert.equal(resolve({ data: { id, play: 'https://cdn.example/no-watermark.mp4' } }, id), null);
  assert.equal(resolve({ download_link: { watermark: 'https://cdn.example/missing-id.mp4' } }, id), null);
});
