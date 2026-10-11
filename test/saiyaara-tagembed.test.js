import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const loader = readFileSync(new URL('../public/saiyaara-tagembed.js', import.meta.url), 'utf8');
function fixture() {
  let requests = 0;
  const observers = [];
  class Element {
    constructor(tag = 'div') {
      this.tag = tag; this.children = []; this.dataset = {}; this.style = {}; this.attrs = {};
      this.listeners = {}; this.className = ''; this.parent = null; this.connected = false;
      this.rect = { width: 360, height: 650 };
      this.classList = { add: (...names) => { this.className += ' ' + names.join(' '); },
        remove: name => { this.className = this.className.split(' ').filter(n => n !== name).join(' '); } };
    }
    get isConnected() { return this.connected || Boolean(this.parent?.isConnected); }
    set src(value) { this.attrs.src = value; if (this.tag === 'iframe') {
      assert.ok(this.listeners.load, 'attach load handler before assigning src'); requests++;
    } }
    get src() { return this.attrs.src; }
    setAttribute(name, value) { this.attrs[name] = value; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    fire(name) { this.listeners[name]?.({ preventDefault() {}, stopPropagation() {} }); }
    append(...nodes) { for (const node of nodes) { node.remove(); this.children.push(node); node.parent = this; } }
    moveBefore(node) { this.append(node); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); this.parent = null; }
    replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this.append(...nodes); }
    getBoundingClientRect() { return this.rect; }
    querySelector(selector) { return this.all().find(n => selector[0] === '.' && n.className.split(' ').includes(selector.slice(1))) || null; }
    all() { return this.children.flatMap(n => [n, ...n.all()]); }
  }
  const document = { readyState: 'complete', body: { dataset: {} }, querySelectorAll: () => [], createElement: tag => new Element(tag) };
  class ResizeObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {} disconnect() { this.disconnected = true; }
  }
  const window = { ResizeObserver, addEventListener() {} };
  runInNewContext(loader, { document, window, ResizeObserver });
  const host = () => { const el = new Element(); el.connected = true; return el; };
  return { api: window.VidBestSaiyaaraTagembed, host, requests: () => requests, observers };
}

test('grid, watch and swipe render a cached poster with zero provider requests', () => {
  const { api, host, requests } = fixture();
  for (const mode of ['tile', 'watch', 'swipe']) {
    const el = host(); api.mount(el, mode); api.mount(el, mode);
    assert.equal(el.querySelector('.saiyaara-tagembed-poster').src, api.posterUrl);
    assert.equal(el.querySelector('.saiyaara-tagembed-frame'), null);
    assert.equal(el.dataset.tagembedState, 'preview');
  }
  assert.equal(requests(), 0);
  assert.doesNotMatch(loader, /IntersectionObserver|setTimeout|embed\.min\.js|postMessage/);
});

test('a double tap loads once; listeners precede navigation and load clears the cover', () => {
  const { api, host, requests } = fixture(); const el = host(); api.mount(el);
  const cover = el.querySelector('.saiyaara-preview-cover'); cover.fire('click'); cover.fire('click');
  const frame = el.querySelector('.saiyaara-tagembed-frame');
  assert.equal(requests(), 1); assert.equal(el.dataset.tagembedState, 'loading');
  assert.equal(frame.src, 'https://widget.tagembed.com/2236794?postId=5592899&caption=0&header=0');
  assert.match(frame.attrs.allow, /autoplay/);
  frame.fire('load'); assert.equal(cover.hidden, true); assert.equal(el.dataset.tagembedState, 'frame-loaded');
  assert.equal(el.querySelector('.saiyaara-tagembed-status').hidden, true);
});

test('only one provider plays per document; closing and failures restore the poster without retries', () => {
  const { api, host, requests } = fixture(); const a = host(), b = host();
  api.mount(a); api.mount(b); a.querySelector('.saiyaara-preview-cover').fire('click');
  b.querySelector('.saiyaara-preview-cover').fire('click');
  assert.equal(a.querySelector('.saiyaara-tagembed-frame'), null);
  assert.equal(a.dataset.tagembedState, 'preview');
  b.querySelector('.saiyaara-tagembed-frame').fire('error');
  assert.equal(b.dataset.tagembedState, 'failed'); assert.equal(requests(), 2);
  assert.equal(b.querySelector('.saiyaara-preview-cover').disabled, false);
  api.stop(b); assert.equal(requests(), 2);
});

test('fullscreen transfer and return preserve the same iframe without new provider requests', () => {
  const { api, host, requests } = fixture(); const a = host(), b = host();
  api.mount(a); a.querySelector('.saiyaara-preview-cover').fire('click');
  const frame = a.querySelector('.saiyaara-tagembed-frame'); frame.fire('load');
  assert.equal(api.transfer(a, b, 'swipe'), true);
  assert.equal(b.querySelector('.saiyaara-tagembed-frame'), frame);
  assert.equal(a.dataset.tagembedState, 'preview');
  assert.equal(api.transfer(b, a, 'watch'), true);
  api.unmount(b);
  assert.equal(a.querySelector('.saiyaara-tagembed-frame'), frame);
  assert.equal(requests(), 1);
});

test('older browsers stop the hidden player without silently reloading it', () => {
  const { api, host, requests } = fixture(); const a = host(), b = host(); b.moveBefore = undefined;
  api.mount(a); a.querySelector('.saiyaara-preview-cover').fire('click');
  assert.equal(api.transfer(a, b, 'swipe'), false); api.mount(b, 'swipe');
  assert.equal(a.querySelector('.saiyaara-tagembed-frame'), null);
  assert.equal(b.querySelector('.saiyaara-tagembed-frame'), null); assert.equal(requests(), 1);
});

test('portrait canvas contains the complete post in small, landscape and fullscreen bounds', () => {
  const { api, host, observers } = fixture(); const el = host(); api.mount(el);
  const viewport = el.querySelector('.saiyaara-player-viewport');
  const canvas = el.querySelector('.saiyaara-tagembed-canvas');
  for (const [width, height] of [[230, 200], [360, 500], [800, 350], [1000, 900]]) {
    viewport.rect = { width, height }; observers[0].callback();
    const scale = Number(canvas.style.transform.match(/scale\(([^)]+)\)/)[1]);
    assert.ok(360 * scale <= width + .001); assert.ok(650 * scale <= height + .001);
  }
  api.unmount(el); assert.equal(observers[0].disconnected, true);
});
