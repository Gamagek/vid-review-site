import { spawn } from 'node:child_process';
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { sha256, editorialSource } from './core.mjs';

export function run(command, args, { timeout = 600000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error(`${command} timed out`)); }, timeout);
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.stdout.on('data', b => { if (stdout.length < 1_000_000) stdout += b; });
    child.stderr.on('data', b => { if (stderr.length < 20000) stderr += b; });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolvePromise(stdout) :
      // Downloader/FFmpeg output can contain signed URLs; never put it in logs/artifacts.
      reject(Error(`${command} failed (exit ${code}); no media published`)); });
  });
}

export async function probe(path, runner = run) {
  const data = JSON.parse(await runner('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], {timeout:30000}));
  const video = data.streams?.find(s => s.codec_type === 'video');
  const duration = Number(data.format?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0 || duration > 10800) throw Error('Media must be a playable video of at most 3 hours');
  return { duration, has_audio: data.streams.some(s => s.codec_type === 'audio'), width: video.width, height: video.height };
}

export async function acquire(row, work, { localFile, runner = run } = {}) {
  const target = join(work, 'source.mp4');
  const source = editorialSource(row);
  // Retain the existing admin certification; temporary deletion is not a rights license.
  if (row.analysis_download_authorized !== true && Number(row.redistribution_certified) !== 1) {
    throw Error('No saved permission for a temporary analysis copy; supply an authorized catalog/media file');
  }
  if (localFile) await copyFile(resolve(localFile), target);
  else {
    let url = source.url;
    if (row.r2_key) {
      if (!/^uploads\/(?:tiktok\/)?[a-zA-Z0-9/_-]+\.mp4$/.test(row.r2_key)) throw Error('Invalid saved R2 media key');
      url = 'https://vid.best/media/' + row.r2_key;
    }
    // Public exact sources / existing authorized cache only. No cookies, login, proxies or DRM bypass.
    await runner('python3', ['-m', 'yt_dlp', '--ignore-config', '--no-playlist', '--no-progress', '--quiet',
      '--no-warnings', '--no-cache-dir', '--retries', '1', '--fragment-retries', '1', '--socket-timeout', '20',
      '--max-filesize', '512M', '--restrict-filenames',
      '-f', 'bv*[height<=480]+ba/b[height<=480]/b', '--merge-output-format', 'mp4', '--remux-video', 'mp4',
      '-o', target, '--', url], { timeout: 900000 });
  }
  const size = (await stat(target)).size;
  if (!size || size > 536870912) throw Error('Temporary source exceeds 512 MiB');
  return { path: target, ...(await probe(target, runner)), bytes: size, sha256: sha256(await readFile(target)) };
}

export async function segments(source, work, runner = run) {
  const result = [];
  // 10-minute chunks retain all audio and the full timeline; no montage presented as full coverage.
  for (let start = 0, index = 0; start < source.duration; start += 600, index++) {
    const duration = Math.min(600, source.duration - start);
    const path = join(work, `segment-${index}.mp4`);
    await runner('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(start), '-i', source.path,
      '-t', String(duration), '-map', '0:v:0', '-map', '0:a:0?', '-vf', "scale=w='min(854,iw)':h='min(480,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      '-r', '12', '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '360k', '-maxrate', '600k', '-bufsize', '1200k',
      '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart', path]);
    const meta = await probe(path, runner);
    if (Math.abs(meta.duration - duration) > 0.5 || source.has_audio !== meta.has_audio ||
      (await stat(path)).size > 50_000_000) throw Error('Compressed segment lost coverage/audio or exceeds size budget');
    result.push({ path, index, start, duration, has_audio: meta.has_audio, sha256: sha256(await readFile(path)) });
  }
  return result;
}

export async function capture(source, seconds, dest, runner = run) {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds >= source.duration) throw Error('Capture must be inside observed source timeline');
  for (const quality of [4, 7, 11]) {
    await runner('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(seconds), '-i', source.path,
      '-frames:v', '1', '-vf', "scale=w='min(960,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", '-q:v', String(quality), dest], {timeout:60000});
    if ((await stat(dest)).size <= 150000) break;
  }
  const bytes = await readFile(dest);
  if (bytes.length > 150000 || bytes.length < 200 || bytes.readUInt16BE(0) !== 0xffd8) throw Error('Invalid or oversized captured JPEG');
  const image = JSON.parse(await runner('ffprobe', ['-v','error','-show_streams','-of','json',dest], {timeout:30000})).streams[0];
  return { sha256: sha256(bytes), bytes: bytes.length, width: image.width, height: image.height,
    seconds, kind: 'video_frame', source_sha256: source.sha256 };
}

export async function illustration(client, models, framePath, prompt, work, dest, runner = run) {
  if (!models?.length) throw Error('Configure an available GEMINI_IMAGE_MODEL for the companion illustration');
  const response = await client.generate(models, [{ inlineData: { mimeType:'image/jpeg', data:(await readFile(framePath)).toString('base64') } },
    { text: `Create an original conceptual anime illustration for an editorial review, inspired by this reference frame. Preserve the meaningful composition and visual theme. It must read as an illustration, never documentary footage. No text, logos or signatures. ${prompt}` }], {json:false,image:true});
  const part = response.parts.find(p => p.inlineData?.data || p.inline_data?.data);
  const data = part?.inlineData || part?.inline_data;
  if (!data || !['image/png','image/jpeg','image/webp'].includes(data.mimeType || data.mime_type)) throw Error('Gemini returned no supported generated image');
  const bytes = Buffer.from(data.data, 'base64');
  if (!bytes.length || bytes.length > 15000000) throw Error('Generated illustration is empty or oversized');
  const original = join(work, 'generated-image'); await writeFile(original, bytes);
  await runner('ffmpeg', ['-hide_banner','-loglevel','error','-nostdin','-y','-i',original,'-frames:v','1',
    '-vf', "scale=w='min(960,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", '-c:v','libwebp','-quality','78', dest], {timeout:60000});
  const output = await readFile(dest);
  if (!output.length || output.length > 350000) throw Error('Companion image exceeds 350 KB');
  const image = JSON.parse(await runner('ffprobe',['-v','error','-show_streams','-of','json',dest], {timeout:30000})).streams[0];
  return { sha256:sha256(output),bytes:output.length,width:image.width,height:image.height,kind:'conceptual_anime',model:response.model,
    caption:'Conceptual anime illustration inspired by the reviewed video.',displayWatermark:'vid.best' };
}

export function safeOutput(root, relative) {
  const path = resolve(root, relative);
  if (!path.startsWith(resolve(root) + sep)) throw Error('Path escapes output directory');
  return path;
}
