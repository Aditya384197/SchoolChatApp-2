import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';

const CatboxUploader = registerPlugin('CatboxUploader');

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

  // Real progress comes from the native side (bytes actually sent).
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

// ---- Automatic download of received media (WhatsApp-style) -------------------
// As soon as an incoming image/video message is seen (chat open or not) the
// file starts loading in the background, so tapping it later opens instantly
// instead of starting a fresh download. Only runs while the phone is online.
const prefetched = new Set();
const keepAlive = [];

export function prefetchMedia(url, kind) {
  try {
    if (!url || prefetched.has(url)) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    prefetched.add(url);
    if (kind === 'image') {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      keepAlive.push(img);
    } else if (kind === 'video') {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.src = `${url}#t=0.001`;
      video.load();
      keepAlive.push(video);
    }
    if (keepAlive.length > 40) {
      const old = keepAlive.shift();
      try { if (old.tagName === 'VIDEO') { old.removeAttribute('src'); old.load(); } else { old.src = ''; } } catch { /* ignore */ }
    }
  } catch { /* prefetch is best-effort only */ }
}

// Adds the media-fragment that makes the WebView paint the first frame of a
// video instead of the generic grey "play" logo.
export function videoFirstFrameSrc(url) {
  if (!url) return '';
  return url.includes('#') ? url : `${url}#t=0.001`;
}
