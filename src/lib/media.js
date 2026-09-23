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
  if (file.size <= 2.5 * 1024 * 1024 && file.type !== 'image/heic' && file.type !== 'image/heif') return file;
  try {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = reject;
        element.src = url;
      });
      const maxSide = 2048;
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.84));
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

export async function uploadFileToCatbox(file) {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('File uploads are available in the Android app.');
  }
  if (!file) throw new Error('Please choose a file.');
  if (!isSupportedAttachment(file)) throw new Error('Supported files: images, videos, PDF and .bin.');

  const prepared = await compressImage(file);
  if (prepared.size > MAX_UPLOAD_BYTES) throw new Error('File is larger than 15 MB.');

  const dataUrl = await readAsDataUrl(prepared);
  const result = await CatboxUploader.upload({
    fileBase64: dataUrl,
    fileName: prepared.name || 'upload.bin',
    mimeType: prepared.type || 'application/octet-stream',
  });
  const url = String(result?.url || '').trim();
  if (!url.startsWith('https://files.catbox.moe/')) throw new Error('The file host returned an invalid link.');
  return { url, file: prepared, size: prepared.size, kind: getAttachmentKind(prepared) };
}

export async function uploadChatMedia(_uid, _chatId, _messageId, file) {
  return uploadFileToCatbox(file);
}

// Kept as compatibility aliases for the current app code and older callers.
export async function uploadChatImage(uid, chatId, messageId, file) {
  const result = await uploadChatMedia(uid, chatId, messageId, file);
  if (result.kind !== 'image') throw new Error('Please choose an image.');
  return result.url;
}

export async function uploadStatusMedia(_uid, _statusId, file) {
  const result = await uploadFileToCatbox(file);
  if (result.kind !== 'image' && result.kind !== 'video') throw new Error('Status supports only images and videos.');
  return result.url;
}

// Catbox anonymous uploads cannot be deleted by the app without a Catbox userhash.
// These no-op functions keep existing delete paths safe when a chat/status record is removed.
export async function deleteChatImage() { return false; }
export async function deleteStatusMedia() { return false; }
