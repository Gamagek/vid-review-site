import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const info = Buffer.from('vidbest-portainer-stack-backup-v1');
const key = (secret, salt) => hkdfSync('sha256', Buffer.from(secret), salt, info, 32);

export function writeBackup(path, data, secret) {
  if (!secret) throw new Error('An encryption key is required for the deployment backup');
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret, salt), iv);
  cipher.setAAD(info);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const envelope = { version: 1, algorithm: 'AES-256-GCM', salt: salt.toString('base64'),
    iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  try { writeFileSync(path, JSON.stringify(envelope), { mode: 0o600, flag: 'wx' }); }
  catch { throw new Error('Cannot create the encrypted backup; refusing to deploy'); }
}

export function readBackup(path, secret) {
  try {
    const envelope = JSON.parse(readFileSync(path, 'utf8'));
    if (envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM') throw new Error();
    const salt = Buffer.from(envelope.salt, 'base64');
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    if (salt.length !== 32 || iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key(secret, salt), iv);
    decipher.setAAD(info);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
  } catch { throw new Error('Deployment backup is unreadable or failed authentication'); }
}
