import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';

const CatboxUploader = registerPlugin('CatboxUploader');
const MediaCache = registerPlugin('MediaCache');

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_STATUS_MEDIA_BYTES = MAX_UPLOAD_BYTES;
export const MAX_CHAT_MEDIA_BYTES = MAX_UPLOAD_BYTES;

function extensionOf(name = '') {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]{1,10})$/);
  return m ? m[1] : '';
}

export function getAttachmentKind(file) {
  if (!file) return null;
  if (file.type?.startsWith('image/')) return 'image';
  if (file.type?.startsWith('video/')) return 'video';
  const ext = extensionOf(file.name);
  if (file.type === 'application/pdf' || ext === 'pdf') return 'file';
  if (file.type === 'application/octet-stream' || ext === 'bin') return 'file';
  return null;
}

export function isSupportedAttachment(file) {
  return Boolean(getAttachmentKind(file));
}

export async function compressImage(file) {
  if (!file?.type?.startsWith('image/')) return file;
  if (file.size <= 900 * 1024 && file.type !== 'image/heic' && file.type !== 'image/heif') return file;
  try {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = reject;
        element.src = url;
      });
      const maxSide = 1920;
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
      if (!blob) return file;
      return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now(),
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return file;
  }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('The selected file could not be read.'));
    reader.onabort = () => reject(new Error('The file read was cancelled.'));
    reader.readAsDataURL(file);
  });
}

export async function uploadFileToCatbox(file, onProgress) {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('File uploads are available in the Android app.');
  }
  if (!file) throw new Error('Please choose a file.');
  if (!isSupportedAttachment(file)) throw new Error('Supported files: images, videos, PDF and .bin.');

  const prepared = await compressImage(file);
  if (prepared.size > MAX_UPLOAD_BYTES) throw new Error('File is larger than 15 MB.');

  // Large base64 strings crossing the WebView/native bridge can fail on
  // Android 10+ even when the network itself is fine. Newer native plugin
  // builds accept 256 KiB chunks and stream the final multipart upload.
  if (typeof CatboxUploader.beginUpload === 'function') {
    let uploadId = '';
    try {
      const begun = await CatboxUploader.beginUpload({
        fileName: prepared.name || 'upload.bin',
        mimeType: prepared.type || 'application/octet-stream',
        totalBytes: prepared.size,
      });
      uploadId = String(begun?.uploadId || '');
      if (!uploadId) throw new Error('The media upload session could not be created.');

      const chunkSize = 256 * 1024;
      let sent = 0;
      onProgress?.(0);
      for (let offset = 0; offset < prepared.size; offset += chunkSize) {
        const chunk = new Uint8Array(await prepared.slice(offset, Math.min(prepared.size, offset + chunkSize)).arrayBuffer());
        let binary = '';
        for (let i = 0; i < chunk.length; i += 0x8000) {
          binary += String.fromCharCode(...chunk.subarray(i, Math.min(i + 0x8000, chunk.length)));
        }
        await CatboxUploader.appendUploadChunk({ uploadId, chunkBase64: btoa(binary) });
        sent += chunk.length;
        onProgress?.(Math.max(0, Math.min(1, sent / prepared.size)));
      }

      const result = await CatboxUploader.finishUpload({ uploadId });
      const url = String(result?.url || '').trim();
      if (!url.startsWith('https://files.catbox.moe/')) throw new Error('The file host returned an invalid link.');
      onProgress?.(1);
      uploadId = '';
      return { url, file: prepared, size: prepared.size, kind: getAttachmentKind(prepared) };
    } catch (error) {
      if (uploadId) await CatboxUploader.cancelUpload({ uploadId }).catch(() => {});
      throw error;
    }
  }

  // Compatibility fallback for an older already-installed debug APK.
  let listener = null;
  if (onProgress) {
    try {
      onProgress(0);
      listener = await CatboxUploader.addListener('uploadProgress', ev => {
        const total = Number(ev?.total) || prepared.size;
        onProgress(Math.max(0, Math.min(1, Number(ev?.sent || 0) / total)));
      });
    } catch { listener = null; }
  }
  try {
    const dataUrl = await readAsDataUrl(prepared);
    const result = await CatboxUploader.upload({
      fileBase64: dataUrl,
      fileName: prepared.name || 'upload.bin',
      mimeType: prepared.type || 'application/octet-stream',
    });
    const url = String(result?.url || '').trim();
    if (!url.startsWith('https://files.catbox.moe/')) throw new Error('The file host returned an invalid link.');
    onProgress?.(1);
    return { url, file: prepared, size: prepared.size, kind: getAttachmentKind(prepared) };
  } finally {
    try { await listener?.remove(); } catch {}
  }
}
export async function uploadChatMedia(_uid, _chatId, _messageId, file, onProgress) {
  return uploadFileToCatbox(file, onProgress);
}

// Kept as compatibility aliases for the current app code and older callers.
export async function uploadChatImage(uid, chatId, messageId, file) {
  const result = await uploadChatMedia(uid, chatId, messageId, file);
  if (result.kind !== 'image') throw new Error('Please choose an image.');
  return result.url;
}

export async function uploadStatusMedia(_uid, _statusId, file, onProgress) {
  const result = await uploadFileToCatbox(file, onProgress);
  if (result.kind !== 'image' && result.kind !== 'video') throw new Error('Status supports only images and videos.');
  return result.url;
}

// Catbox anonymous uploads cannot be deleted by the app without a Catbox userhash.
// These no-op functions keep existing delete paths safe when a chat/status record is removed.
export async function deleteChatImage() { return false; }
export async function deleteStatusMedia() { return false; }

// ---- Automatic persistent download of received media ------------------------
const cacheInflight = new Map();
const prefetched = new Set();
const keepAlive = [];

function cacheKey(url) { return String(url || '').trim(); }

export async function getCachedMediaUrl(url, kind = '') {
  const source = cacheKey(url);
  if (!source) return '';
  if (!Capacitor.isNativePlatform()) return source;

  const key = source;
  try {
    const existing = await MediaCache.get({ key });
    if (existing?.exists && existing?.path) return Capacitor.convertFileSrc(existing.path);
  } catch {}

  if (kind !== 'image' && kind !== 'video') return source;
  if (navigator.onLine === false) return source;

  if (!cacheInflight.has(key)) {
    cacheInflight.set(key, MediaCache.cache({ url: source, key }).finally(() => cacheInflight.delete(key)));
  }
  try {
    const cached = await cacheInflight.get(key);
    if (cached?.path) return Capacitor.convertFileSrc(cached.path);
  } catch {}
  return source;
}

export function prefetchMedia(url, kind) {
  const source = cacheKey(url);
  if (!source || prefetched.has(source)) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  prefetched.add(source);

  if (Capacitor.isNativePlatform() && (kind === 'image' || kind === 'video')) {
    void getCachedMediaUrl(source, kind);
    return;
  }

  try {
    if (kind === 'image') {
      const img = new Image();
      img.decoding = 'async';
      img.src = source;
      keepAlive.push(img);
    } else if (kind === 'video') {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.src = `${source}#t=0.001`;
      video.load();
      keepAlive.push(video);
    }
    if (keepAlive.length > 40) {
      const old = keepAlive.shift();
      try { if (old.tagName === 'VIDEO') { old.removeAttribute('src'); old.load(); } else { old.src = ''; } } catch {}
    }
  } catch {}
}

// Adds the media-fragment that makes the WebView paint the first frame of a
// video instead of the generic grey "play" logo.
export function videoFirstFrameSrc(url) {
  if (!url) return '';
  return url.includes('#') ? url : `${url}#t=0.001`;
}

// Downloads a Catbox file as bytes. On the phone this goes through the native
// plugin (no browser CORS rules); in a browser it falls back to fetch().
export async function downloadBytes(url) {
  if (!String(url || '').startsWith('https://files.catbox.moe/')) throw new Error('Invalid file link.');
  if (Capacitor.isNativePlatform()) {
    const res = await CatboxUploader.download({ url });
    const bin = atob(String(res?.data || ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error('Download failed.');
  return new Uint8Array(await r.arrayBuffer());
}

// Reads a File/Blob as raw bytes (used before locking it -- the plain bytes
// never touch the network, only the AES-GCM ciphertext does).
export async function fileToBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

// Uploads already-encrypted bytes as an opaque .bin file. Catbox (and anyone
// with the link) only ever sees ciphertext -- the real name/type live inside
// the encrypted `lock` object attached to the message, not in this filename.
export async function uploadEncryptedBytes(bytes, onProgress) {
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const file = new File([blob], `locked-${Date.now()}.bin`, { type: 'application/octet-stream' });
  return uploadFileToCatbox(file, onProgress);
}
