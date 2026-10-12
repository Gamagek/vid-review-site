import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../public/home-player.js",import.meta.url),"utf8");
function facade() {
  function element() {
    return { style: {}, listeners: new Map(), setAttribute() {}, removeAttribute() {},
      addEventListener(name, fn) { this.listeners.set(name,fn); }, replaceChildren(...children) { this.children=children; } };
  }
  const surface=element(), fallback=element(), status=element();
  const cover={ complete:true, naturalWidth:384 };
  const card={ isConnected:true, dataset:{ videoId:"162",videoProvider:"facebook",videoTitle:"Outdoor challenge",videoSource:"https://www.facebook.com/reel/123",videoThumbnail:"/facebook-previews/tiny.jpg" },
    classList:{ add() {} },getBoundingClientRect(){return {top:0,bottom:216};},
    querySelector(name){return {".preview-surface":surface,".media-fallback":fallback,".preview-status":status,".tile-media > img":cover}[name]||null;} };
  const scope={document:{addEventListener(){},createElement:element},window:{innerHeight:800},URL,URLSearchParams,location:{origin:"https://vid.best"}};
  runInNewContext(source,scope);
  scope.mountFacebookFacade(card);
  return {surface,fallback,status,card};
}

test("Facebook tiles use a saved tiny image immediately and create the official player only on tap",()=>{
  const h=facade();
  const [poster,play]=h.surface.children;
  assert.equal(poster.src,"/facebook-previews/tiny.jpg");
  assert.equal(poster.width,384);
  assert.equal(h.surface.children.length,2);
  assert.equal(h.fallback.hidden,true);
  play.listeners.get("click")({preventDefault(){},stopPropagation(){}});
  const iframe=h.surface.children[0];
  assert.equal(new URL(iframe.src).hostname,"www.facebook.com");
  assert.equal(h.card.dataset.facebookPlayerMounted,"1");
});

test("an unavailable Facebook poster leaves the provider fallback visible instead of a blank cover",()=>{
  const h=facade(), poster=h.surface.children[0];
  poster.listeners.get("error")();
  assert.equal(poster.hidden,true);
  assert.equal(h.fallback.hidden,false);
  assert.equal(h.surface.style.background,"transparent");
});
