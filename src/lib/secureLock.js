// "Secure lock" for chat messages / photos / videos.
//
// * Every user has a Privacy Key (an ECDH P-256 key pair). The private half is
//   kept encrypted with the user's own Privacy Password (PBKDF2 -> AES-GCM),
//   the public half is published so friends can lock things for them.
// * A sender locks content with a random AES-256 key; that key is wrapped so
//   only the receiver can unwrap it:
//     - receiver already has a Privacy Key -> wrapped with ECDH ("ecdh")
//     - receiver has none yet              -> the key waits for them at
//       pendingKeys/<receiver>/... (rules: only the receiver can read it)
// * Locked photos/videos are uploaded as encrypted .bin files, so the public
//   file link alone shows nothing.
import { get, ref, set, remove } from 'firebase/database';
import { db } from '../firebase';
import { downloadBytes } from './media';

const enc = new TextEncoder();
const dec = new TextDecoder();
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const SESSION_MS = 2 * 60 * 1000; // an unlocked key stays usable for 2 minutes
const sessions = new Map(); // uid -> { priv, until }

export const LOCK_PLACEHOLDER = '🔒 Locked message';
export const MIN_PRIVACY_PASSWORD = 6;

const b64 = buf => {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = s => {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};
const rand = n => crypto.getRandomValues(new Uint8Array(n));

async function passwordKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const vaultCacheKey = uid => `schoolChatVault_${uid}`;
const failKey = uid => `schoolChatVaultFails_${uid}`;
const untilKey = uid => `schoolChatVaultUntil_${uid}`;

async function readVault(uid) {
  const local = localStorage.getItem(vaultCacheKey(uid));
  if (local) { try { return JSON.parse(local); } catch { /* fall through to the server copy */ } }
  const snap = await get(ref(db, `userVaults/${uid}`));
  if (!snap.exists()) return null;
  localStorage.setItem(vaultCacheKey(uid), JSON.stringify(snap.val()));
  return snap.val();
}

export async function hasVault(uid) {
  if (localStorage.getItem(vaultCacheKey(uid))) return true;
  return Boolean(await readVault(uid));
}

export function isUnlocked(uid) {
  const s = sessions.get(uid);
  if (!s) return false;
  if (Date.now() > s.until) { sessions.delete(uid); return false; }
  return true;
}
export function lockSession(uid) { sessions.delete(uid); }

export function secondsUntilRetry(uid) {
  return Math.max(0, Math.ceil((Number(localStorage.getItem(untilKey(uid)) || 0) - Date.now()) / 1000));
}

export async function createVault(uid, password) {
  if (String(password || '').length < MIN_PRIVACY_PASSWORD) { const e = new Error('short'); e.code = 'password-short'; throw e; }
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveKey', 'deriveBits']);
  const pubJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const salt = rand(16); const iv = rand(12);
  const wrap = await passwordKey(password, salt);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrap, enc.encode(JSON.stringify(privJwk)));
  const vault = { salt: b64(salt), iv: b64(iv), data: b64(data) };
  await set(ref(db, `userVaults/${uid}`), vault);
  await set(ref(db, `userPubKeys/${uid}`), JSON.stringify(pubJwk));
  localStorage.setItem(vaultCacheKey(uid), JSON.stringify(vault));
  sessions.set(uid, { priv: pair.privateKey, until: Date.now() + SESSION_MS });
}

export async function unlockVault(uid, password) {
  const wait = secondsUntilRetry(uid);
  if (wait > 0) { const e = new Error('wait'); e.code = 'too-many'; e.seconds = wait; throw e; }
  const vault = await readVault(uid);
  if (!vault) { const e = new Error('no-vault'); e.code = 'no-vault'; throw e; }
  try {
    const wrap = await passwordKey(password, unb64(vault.salt));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(vault.iv) }, wrap, unb64(vault.data));
    const priv = await crypto.subtle.importKey('jwk', JSON.parse(dec.decode(plain)), ECDH, false, ['deriveKey', 'deriveBits']);
    sessions.set(uid, { priv, until: Date.now() + SESSION_MS });
    localStorage.removeItem(failKey(uid)); localStorage.removeItem(untilKey(uid));
    return true;
  } catch {
    const fails = Number(localStorage.getItem(failKey(uid)) || 0) + 1;
    localStorage.setItem(failKey(uid), String(fails));
    if (fails % 5 === 0) localStorage.setItem(untilKey(uid), String(Date.now() + 30000));
    const e = new Error('wrong-password'); e.code = 'wrong-password'; throw e;
  }
}

export async function changeVaultPassword(uid, oldPassword, newPassword) {
  if (String(newPassword || '').length < MIN_PRIVACY_PASSWORD) { const e = new Error('short'); e.code = 'password-short'; throw e; }
  await unlockVault(uid, oldPassword);
  const vault = await readVault(uid);
  const wrapOld = await passwordKey(oldPassword, unb64(vault.salt));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(vault.iv) }, wrapOld, unb64(vault.data));
  const salt = rand(16); const iv = rand(12);
  const wrapNew = await passwordKey(newPassword, salt);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapNew, plain);
  const next = { salt: b64(salt), iv: b64(iv), data: b64(data) };
  await set(ref(db, `userVaults/${uid}`), next);
  localStorage.setItem(vaultCacheKey(uid), JSON.stringify(next));
}

// Readable short id of the user's public key, e.g. "A1B2-C3D4-E5F6".
export async function getKeyId(uid) {
  const snap = await get(ref(db, `userPubKeys/${uid}`));
  if (!snap.exists()) return '';
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(snap.val())));
  const hex = [...hash.slice(0, 6)].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

// ---- lock / unlock a payload -------------------------------------------------
// bytes: Uint8Array of the text / photo / video. Returns { lock, cipher }.
export async function lockPayload({ recipientUid, chatId, messageId, bytes, caption = '', kind, mime = '' }) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = rand(12);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const lock = { v: 1, kind, iv: b64(iv) };
  if (mime) lock.mime = mime;
  if (caption) {
    const capIv = rand(12);
    lock.capIv = b64(capIv);
    lock.cap = b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: capIv }, key, enc.encode(caption)));
  }
  const rawKey = await crypto.subtle.exportKey('raw', key);
  const pubSnap = await get(ref(db, `userPubKeys/${recipientUid}`));
  if (pubSnap.exists()) {
    const recipientPub = await crypto.subtle.importKey('jwk', JSON.parse(pubSnap.val()), ECDH, false, []);
    const eph = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
    const wrapKey = await crypto.subtle.deriveKey({ name: 'ECDH', public: recipientPub }, eph.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const wrapIv = rand(12);
    lock.mode = 'ecdh';
    lock.epk = JSON.stringify(await crypto.subtle.exportKey('jwk', eph.publicKey));
    lock.wkIv = b64(wrapIv);
    lock.wk = b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv }, wrapKey, rawKey));
  } else {
    // Receiver has not created a Privacy Key yet: the key waits for them.
    lock.mode = 'pending';
    await set(ref(db, `pendingKeys/${recipientUid}/${chatId}/${messageId}`), b64(rawKey));
  }
  if (kind === 'text') lock.ct = b64(cipher);
  return { lock, cipher };
}

export async function unlockPayload({ meUid, chatId, messageId, lock, fileUrl }) {
  const session = sessions.get(meUid);
  if (!session || Date.now() > session.until) { const e = new Error('locked'); e.code = 'session-locked'; throw e; }
  let rawKey;
  if (lock.mode === 'ecdh') {
    const epk = await crypto.subtle.importKey('jwk', JSON.parse(lock.epk), ECDH, false, []);
    const wrapKey = await crypto.subtle.deriveKey({ name: 'ECDH', public: epk }, session.priv, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    rawKey = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(lock.wkIv) }, wrapKey, unb64(lock.wk));
  } else {
    const snap = await get(ref(db, `pendingKeys/${meUid}/${chatId}/${messageId}`));
    if (!snap.exists()) { const e = new Error('key-missing'); e.code = 'key-missing'; throw e; }
    rawKey = unb64(snap.val());
  }
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  const cipher = lock.kind === 'text' ? unb64(lock.ct) : await downloadBytes(fileUrl);
  const bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(lock.iv) }, key, cipher));
  let caption = '';
  if (lock.cap) caption = dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(lock.capIv) }, key, unb64(lock.cap)));
  return { bytes, caption, text: lock.kind === 'text' ? dec.decode(bytes) : '' };
}

export async function forgetPendingKey(meUid, chatId, messageId) {
  await remove(ref(db, `pendingKeys/${meUid}/${chatId}/${messageId}`)).catch(() => {});
}
