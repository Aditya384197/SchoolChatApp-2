import { Capacitor, registerPlugin } from '@capacitor/core';

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

async function compressImage(file) {
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
    try { await listener?.remove(); } catch { /* ignore */ }
  }
}

export async function uploadChatMedia(_uid, _chatId, _messageId, file, onProgress) {
  return uploadFileToCatbox(file, onProgress);
}

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

export async function deleteChatImage() { return false; }
export async function deleteStatusMedia() { return false; }

// ---------------------------------------------------------------------------
// Persistent media cache
// ---------------------------------------------------------------------------
// Android uses MediaCachePlugin, which streams the file to the app's private
// files directory. The cache survives app/process restarts until the message
// is deleted. A small in-flight map prevents the same URL from being fetched
// several times when multiple listeners/components notice it at once.
const inFlight = new Map();

function cacheKey(url, kind) {
  return `v1|${String(kind || 'media')}|${String(url || '').trim()}`;
}

function rememberedPathKey(url, kind) {
  return `schoolChatMediaPath:${cacheKey(url, kind)}`;
}

export function rememberedCachedMediaSource(url, kind) {
  try {
    const path = localStorage.getItem(rememberedPathKey(url, kind));
    return path ? Capacitor.convertFileSrc(path) : '';
  } catch {
    return '';
  }
}

async function nativeCachedUrl(url, kind) {
  if (!Capacitor.isNativePlatform() || !url) return '';
  const remembered = rememberedCachedMediaSource(url, kind);
  try {
    const result = await MediaCache.get({ key: cacheKey(url, kind) });
    if (result?.exists && result.path) {
      try { localStorage.setItem(rememberedPathKey(url, kind), result.path); } catch {}
      return Capacitor.convertFileSrc(result.path);
    }
  } catch {
    // Use the remembered path only when the native lookup is unavailable.
  }
  return remembered;
}

export async function getCachedMediaSource(url, kind) {
  return nativeCachedUrl(url, kind);
}

export async function ensureMediaCached(url, kind) {
  const clean = String(url || '').trim();
  if (!clean || (kind !== 'image' && kind !== 'video')) return '';
  const cached = await nativeCachedUrl(clean, kind);
  if (cached) return cached;
  if (!Capacitor.isNativePlatform()) return clean;
  if (inFlight.has(cacheKey(clean, kind))) return inFlight.get(cacheKey(clean, kind));

  const key = cacheKey(clean, kind);
  const job = MediaCache.cache({ url: clean, key })
    .then(result => {
      if (!result?.path) return '';
      try { localStorage.setItem(rememberedPathKey(clean, kind), result.path); } catch {}
      return Capacitor.convertFileSrc(result.path);
    })
    .catch(() => '')
    .finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

export async function deleteCachedMedia(url, kind) {
  const clean = String(url || '').trim();
  if (!clean) return;
  try { localStorage.removeItem(rememberedPathKey(clean, kind)); } catch {}
  if (!Capacitor.isNativePlatform()) return;
  try { await MediaCache.remove({ key: cacheKey(clean, kind) }); } catch { /* best effort */ }
}

export function prefetchMedia(url, kind) {
  const clean = String(url || '').trim();
  if (!clean || (kind !== 'image' && kind !== 'video')) return Promise.resolve('');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve('');
  return ensureMediaCached(clean, kind);
}

export function videoFirstFrameSrc(url) {
  if (!url) return '';
  return url.includes('#') ? url : `${url}#t=0.001`;
}
