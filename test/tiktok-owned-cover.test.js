import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const code = readFileSync(new URL('../public/home-player.js', import.meta.url), 'utf8');
const approved = 'https://vid.best/review-covers/meri-aashiqui-illustrated-v1.webp';
const cached = 'https://p16-common-sign.tiktokcdn-eu.com/expired-fixture.image';

function harness({ thumbnail = approved, top = 0, slug = 'tiktok-discovery', category = 'Entertainment, Movies & Games' } = {}) {
  let requests = 0;
  const tags = [];
  function element(tag = 'span') {
    const classes = new Set();
    const listeners = new Map();
    return { tagName: tag.toUpperCase(), dataset: {}, style: {}, children: [], textContent: '',
      classList: { add(value) { classes.add(value); }, remove(value) { classes.delete(value); }, contains(value) { return classes.has(value); } },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute() {},
      addEventListener(type, listener) { listeners.set(type, listener); },
      trigger(type) { listeners.get(type)?.(); },
      remove() { this.removed = true; },
    };
  }
  const surface = element(), status = element(), badge = element();
  badge.textContent = category;
  const card = { ...element('article'), isConnected: true,
    dataset: { videoId: '12', videoSlug: slug, videoProvider: 'tiktok', videoTitle: 'Meri Aashiqui Tum Se Hi',
      videoSource: 'https://www.tiktok.com/@creator/video/6718335390845095173', videoThumbnail: thumbnail },
    getBoundingClientRect() { return { top, bottom: top + 216 }; },
    querySelector(selector) { return { '.preview-surface': surface, '.preview-status': status, '.category-badge': badge }[selector] || null; },
  };
  const scope = { URL, URLSearchParams, location: { origin: 'https://vid.best' },
    window: { innerHeight: 800 },
    document: { addEventListener() {}, createElement(tag) { tags.push(tag); return element(tag); } },
    fetch() { requests++; throw new Error('A saved cover must not request provider metadata or a player'); },
  };
  runInNewContext(code, scope);
  const image = () => surface.children[0]?.children[0]?.children.find(node => node.tagName === 'IMG');
  return { scope, card, surface, status, tags, image, requests: () => requests };
}

test('a saved local TikTok cover appears before cached metadata without loading a video', () => {
  const h = harness();
  h.scope.renderTikTokFacade(h.card);
  assert.equal(h.image().src, approved);
  assert.equal(h.image().loading, 'eager');
  assert.equal(h.surface.children[0].children[2].children[0].textContent, 'Illustrated cover · not a video frame');
  h.image().trigger('load');
  assert.equal(h.surface.children[0].children[0].classList.contains('has-image'), true);
  assert.equal(h.requests(), 0);
  assert.equal(h.tags.includes('iframe') || h.tags.includes('video'), false);
});

test('late TikTok metadata cannot replace a selected local cover', () => {
  const h = harness();
  h.scope.renderTikTokFacade(h.card);
  h.scope.applyCachedTikTokPreview(h.card, { thumbnail_url: cached, title: 'Provider title', author_name: 'creator', cache_source: 'd1' });
  assert.equal(h.image().src, approved);
  assert.equal(h.card.dataset.videoThumbnail, approved);
  assert.equal(h.card.dataset.tiktokThumbnail, cached, 'source metadata remains source metadata');
  assert.equal(h.requests(), 0);
});

test('offscreen saved TikTok covers remain lazy', () => {
  const h = harness({ top: 3000 });
  h.scope.renderTikTokFacade(h.card);
  assert.equal(h.image().src, approved);
  assert.equal(h.image().loading, 'lazy');
});

test('real local source posters are not relabelled as illustrations', () => {
  const h = harness({ thumbnail: '/review-covers/verified-source-poster.jpg' });
  h.scope.renderTikTokFacade(h.card);
  assert.equal(h.image().src, 'https://vid.best/review-covers/verified-source-poster.jpg');
  assert.equal(h.surface.children[0].children[2].children[0].textContent, 'TikTok · tap to load one player');
});

test('cover priority refuses external, credentialed, private-path and signed or non-image targets', () => {
  for (const thumbnail of [
    'https://outside.example/review-covers/owner.webp', 'https://vid.best.evil.test/review-covers/owner.webp',
    'https://user:fixture@vid.best/review-covers/owner.webp', 'http://vid.best/review-covers/owner.webp',
    '/api/private.webp', '/review-covers/owner.webp?fixture_token=private', '/review-covers/owner.webp#fragment',
    '/review-covers/not-an-image.html', 'javascript:fixture()', '',
  ]) {
    const h = harness({ thumbnail });
    h.card.dataset.tiktokThumbnail = cached;
    h.scope.renderTikTokFacade(h.card);
    assert.equal(h.scope.ownedTikTokCover(h.card), '');
    assert.equal(h.image().src, '/api/tiktok/cached-poster?id=6718335390845095173');
    assert.equal(h.requests(), 0);
  }
  const h = harness({ thumbnail: '/review-covers/owner.webp' });
  assert.equal(h.scope.ownedTikTokCover(h.card), 'https://vid.best/review-covers/owner.webp');
});

test('Saiyaara, Summer and comedy retain their existing cached-poster path', () => {
  for (const options of [
    { slug: 'saiyaara-a-cinematic-romance' }, { slug: 'summer-inverted-7332342275151760642' },
    { category: 'Funny & Comedy' },
  ]) {
    const h = harness(options);
    h.card.dataset.tiktokThumbnail = cached;
    h.scope.renderTikTokFacade(h.card);
    assert.equal(h.image().src, '/api/tiktok/cached-poster?id=6718335390845095173');
    assert.equal(h.image().loading, 'lazy');
  }
});

test('a failed saved cover retains the truthful placeholder without retries', () => {
  const h = harness();
  h.scope.renderTikTokFacade(h.card);
  const image = h.image();
  image.trigger('error');
  assert.equal(image.removed, true);
  assert.equal(h.surface.children[0].children[0].children[0].textContent, 'TikTok');
  assert.equal(h.requests(), 0);
});

test('late metadata never remounts an active TikTok player', () => {
  const h = harness();
  h.card.classList.add('tiktok-player-active');
  const player = { tagName: 'IFRAME' };
  h.surface.children = [player];
  h.scope.applyCachedTikTokPreview(h.card, { thumbnail_url: cached });
  assert.equal(h.surface.children[0], player);
});

test('homepage versions the changed TikTok cover renderer', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /\/home-player\.js\?v=20261019-tiktok-poster/);
});
