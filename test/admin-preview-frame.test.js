import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../public/admin-preview-frame.js', import.meta.url), 'utf8');
test('owner-uploaded frames are small, preserve portrait/landscape proportions and release the local file', async () => {
  for (const [width, height, expected] of [[1920,1080,[384,216]],[1080,1920,[122,216]]]) {
    const events=new Map(), calls=[];
    const video={videoWidth:width,videoHeight:height,duration:10,
      addEventListener(name,handler){events.set(name,handler);},
      set src(value){assert.equal(value,'blob:local-file');events.get('loadeddata')();},
      set currentTime(value){assert.equal(value,0.5);events.get('seeked')();},
      pause(){calls.push('pause');},removeAttribute(){calls.push('remove');},load(){calls.push('load');}};
    const canvas={getContext(){return {drawImage(frame,x,y,w,h){assert.equal(frame,video);assert.deepEqual([w,h],expected);}};},
      toBlob(done,type,quality){assert.equal(type,'image/webp');assert.equal(quality,0.72);done(new Blob(['real frame'],{type}));}};
    const scope={document:{createElement(tag){return tag==='video'?video:canvas;}},
      window:{setTimeout,clearTimeout},URL:{createObjectURL(){return 'blob:local-file';},revokeObjectURL(value){assert.equal(value,'blob:local-file');calls.push('revoke');}}};
    runInNewContext(source,scope);
    const image=await scope.window.VidBestPreviewFrame.capture({});
    assert.equal(image.type,'image/webp');
    assert.deepEqual([canvas.width,canvas.height],expected);
    assert.deepEqual(calls,['pause','remove','load','revoke']);
  }
});
