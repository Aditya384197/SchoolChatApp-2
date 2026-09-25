import { get, ref, set } from 'firebase/database';
import { db } from '../firebase';

const IDENTITY_PREFIX = 'schoolChatSecureIdentity_';
const PROTECTED_PREFIX = 'schoolChatProtectedIdentity_';
const PBKDF2_ITERATIONS = 120000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function storageKey(prefix, uid) { return `${prefix}${uid}`; }

function bytesToBase64(bytes) {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

function base64ToBytes(value) {
  const bin = atob(String(value || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBase32(length = 16) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

async function derivePasswordKey(pin, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function sealJson(payload, pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePasswordKey(pin, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload)));
  return { v: 1, salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(ciphertext)) };
}

async function openJson(sealed, pin) {
  if (!sealed?.salt || !sealed?.iv || !sealed?.data) throw new Error('Protected key data is unavailable.');
  const key = await derivePasswordKey(pin, base64ToBytes(sealed.salt));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(sealed.iv) },
    key,
    base64ToBytes(sealed.data)
  );
  return JSON.parse(decoder.decode(plain));
}

async function createIdentity() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const publicKey = await crypto.subtle.exportKey('raw', pair.publicKey);
  const privateKey = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  return {
    publicKey: bytesToBase64(new Uint8Array(publicKey)),
    privateKey: bytesToBase64(new Uint8Array(privateKey)),
    secureKey: `SCK-${randomBase32(18)}`,
  };
}

async function publishPublicKey(uid, publicKey) {
  const snap = await get(ref(db, `users/${uid}/encryptionPublicKey`)).catch(() => null);
  if (snap?.val() !== publicKey) {
    await set(ref(db, `users/${uid}/encryptionPublicKey`), publicKey);
  }
}

export async function ensureIdentityKey(uid) {
  if (!uid) throw new Error('User identity is missing.');
  const plainKey = storageKey(IDENTITY_PREFIX, uid);
  let identity = null;
  try { identity = JSON.parse(localStorage.getItem(plainKey) || 'null'); } catch { identity = null; }

  if (!identity?.publicKey || !identity?.privateKey || !identity?.secureKey) {
    let protectedIdentity = null;
    try { protectedIdentity = JSON.parse(localStorage.getItem(storageKey(PROTECTED_PREFIX, uid)) || 'null'); } catch { protectedIdentity = null; }
    if (protectedIdentity?.publicKey) {
      await publishPublicKey(uid, protectedIdentity.publicKey);
      return { publicKey: protectedIdentity.publicKey, protected: true };
    }
    identity = await createIdentity();
    localStorage.setItem(plainKey, JSON.stringify(identity));
  }

  await publishPublicKey(uid, identity.publicKey);
  return { publicKey: identity.publicKey, protected: false, secureKey: identity.secureKey };
}

export async function protectIdentityWithPin(uid, pin) {
  const plainKey = storageKey(IDENTITY_PREFIX, uid);
  let identity = null;
  try { identity = JSON.parse(localStorage.getItem(plainKey) || 'null'); } catch { identity = null; }
  if (!identity?.publicKey || !identity?.privateKey || !identity?.secureKey) {
    const pub = await get(ref(db, `users/${uid}/encryptionPublicKey`)).catch(() => null);
    if (pub?.val()) {
      throw new Error('This device no longer has the private secure key. Recreate the privacy key on this device before locking files.');
    }
    identity = await createIdentity();
  }
  const sealed = await sealJson({ privateKey: identity.privateKey, secureKey: identity.secureKey }, pin);
  const record = { publicKey: identity.publicKey, sealed };
  localStorage.setItem(storageKey(PROTECTED_PREFIX, uid), JSON.stringify(record));
  localStorage.removeItem(plainKey);
  await publishPublicKey(uid, identity.publicKey);
}

export async function unprotectIdentityWithPin(uid, pin) {
  const protectedKey = storageKey(PROTECTED_PREFIX, uid);
  let record = null;
  try { record = JSON.parse(localStorage.getItem(protectedKey) || 'null'); } catch { record = null; }
  if (!record?.publicKey || !record?.sealed) throw new Error('Secure identity is not configured.');
  const secrets = await openJson(record.sealed, pin);
  return { publicKey: record.publicKey, privateKey: secrets.privateKey, secureKey: secrets.secureKey };
}

export async function disableIdentityProtection(uid, pin) {
  const identity = await unprotectIdentityWithPin(uid, pin);
  localStorage.setItem(storageKey(IDENTITY_PREFIX, uid), JSON.stringify(identity));
  localStorage.removeItem(storageKey(PROTECTED_PREFIX, uid));
  return identity;
}

export async function openIdentity(uid, pin = '') {
  const protectedRecord = (() => {
    try { return JSON.parse(localStorage.getItem(storageKey(PROTECTED_PREFIX, uid)) || 'null'); } catch { return null; }
  })();
  if (protectedRecord?.sealed) {
    if (!pin) throw new Error('PRIVACY_PIN_REQUIRED');
    return unprotectIdentityWithPin(uid, pin);
  }
  const plain = (() => {
    try { return JSON.parse(localStorage.getItem(storageKey(IDENTITY_PREFIX, uid)) || 'null'); } catch { return null; }
  })();
  if (plain?.privateKey && plain?.secureKey) return plain;
  await ensureIdentityKey(uid);
  const retry = JSON.parse(localStorage.getItem(storageKey(IDENTITY_PREFIX, uid)) || 'null');
  if (!retry?.privateKey || !retry?.secureKey) throw new Error('Secure key is unavailable on this device.');
  return retry;
}

export async function getPersonalSecureKey(uid, pin) {
  const identity = await openIdentity(uid, pin);
  return identity.secureKey;
}

export async function prepareLockedAttachment(file, receiverUid, caption = '') {
  if (!file) throw new Error('Please choose a file.');
  if (file.size > 15 * 1024 * 1024) throw new Error('File is larger than 15 MB.');
  const publicSnap = await get(ref(db, `users/${receiverUid}/encryptionPublicKey`));
  const receiverPublic = publicSnap.val();
  if (!receiverPublic) {
    const e = new Error('The recipient must open the latest School Chat version once before receiving locked files.');
    e.code = 'recipient-key-missing';
    throw e;
  }

  const receiverKey = await crypto.subtle.importKey(
    'raw', base64ToBytes(receiverPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const wrapKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: receiverKey },
    ephemeral.privateKey,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );

  const contentKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const fileIv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await file.arrayBuffer();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: fileIv }, contentKey, bytes);

  const metaIv = crypto.getRandomValues(new Uint8Array(12));
  const metadata = encoder.encode(JSON.stringify({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, caption: String(caption || '') }));
  const encryptedMetadata = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: metaIv }, contentKey, metadata);

  const contentRaw = await crypto.subtle.exportKey('raw', contentKey);
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedKey = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv }, wrapKey, contentRaw);
  const ephemeralPublic = await crypto.subtle.exportKey('raw', ephemeral.publicKey);

  const secure = {
    version: 1,
    mode: 'E2EE-ECDH-P256-AES256-GCM',
    senderEphemeralPublicKey: bytesToBase64(new Uint8Array(ephemeralPublic)),
    wrapIv: bytesToBase64(wrapIv),
    wrappedKey: bytesToBase64(new Uint8Array(wrappedKey)),
    fileIv: bytesToBase64(fileIv),
    metadataIv: bytesToBase64(metaIv),
    metadata: bytesToBase64(new Uint8Array(encryptedMetadata)),
    originalSize: file.size,
  };

  return {
    file: new File([ciphertext], `${file.name}.locked`, { type: 'application/octet-stream', lastModified: Date.now() }),
    secure,
  };
}

export async function decryptLockedAttachment(message, uid, pin, enteredSecureKey) {
  const secure = message?.secureAttachment;
  if (!secure || secure.version !== 1) throw new Error('This locked file format is not supported.');
  const identity = await openIdentity(uid, pin);
  if (String(enteredSecureKey || '').trim().toUpperCase() !== String(identity.secureKey || '').toUpperCase()) {
    const e = new Error('SECURE_KEY_INVALID');
    e.code = 'secure-key-invalid';
    throw e;
  }

  const privateKey = await crypto.subtle.importKey(
    'pkcs8', base64ToBytes(identity.privateKey), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']
  );
  const senderEphemeral = await crypto.subtle.importKey(
    'raw', base64ToBytes(secure.senderEphemeralPublicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const wrapKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: senderEphemeral },
    privateKey,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
  const rawContentKey = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(secure.wrapIv) },
    wrapKey,
    base64ToBytes(secure.wrappedKey)
  );
  const contentKey = await crypto.subtle.importKey('raw', rawContentKey, { name: 'AES-GCM' }, false, ['decrypt']);

  const response = await fetch(message.fileUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Locked file download failed (${response.status}).`);
  const encryptedBytes = await response.arrayBuffer();
  const plainBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(secure.fileIv) }, contentKey, encryptedBytes
  );
  const metaBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(secure.metadataIv) }, contentKey, base64ToBytes(secure.metadata)
  );
  const metadata = JSON.parse(decoder.decode(metaBytes));

  return {
    blob: new Blob([plainBytes], { type: metadata.type || 'application/octet-stream' }),
    name: metadata.name || 'Secure file',
    type: metadata.type || 'application/octet-stream',
    size: Number(metadata.size) || plainBytes.byteLength,
    kind: metadata.type?.startsWith('image/') ? 'image' : metadata.type?.startsWith('video/') ? 'video' : 'file',
    caption: String(metadata.caption || ''),
  };
}
