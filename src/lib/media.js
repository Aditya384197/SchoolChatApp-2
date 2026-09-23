import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';

export const MAX_STATUS_MEDIA_BYTES = 15 * 1024 * 1024; // 15MB, matches storage.rules
export const MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 45 * 1000;

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

// Photos/videos for status updates go to Firebase Storage (not the Realtime
// Database — RTDB isn't built for large binary blobs, and base64-encoding a
// video into it would blow past practical size limits fast). Profile photos
// stay as small base64 in RTDB as before; that's a different, much smaller
// use case.
//
// IMPORTANT: this requires Firebase Storage to actually be enabled for the
// project (Console → Build → Storage → Get started) with storage.rules
// applied -- see FIREBASE_SETUP.md #3b. If that step was skipped, every
// upload here fails. This function used to just hang forever with no
// feedback in that case ("posting..." never finished); it now times out and
// surfaces a clear error instead.

async function compressChatImage(file) {
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
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
      if (!blob) return file;
      return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return file;
  }
}

export async function uploadChatImage(uid, chatId, messageId, file) {
  if (!storage) throw new Error('Firebase Storage शुरू नहीं हो पाया — फ़ोटो नहीं भेजी जा सकती।');
  if (!file?.type?.startsWith('image/')) throw new Error('कृपया केवल फ़ोटो चुनें।');
  if (file.size > 20 * 1024 * 1024) throw new Error('फ़ोटो बहुत बड़ी है। अधिकतम 20MB की मूल फ़ोटो चुनें।');
  const prepared = await compressChatImage(file);
  if (prepared.size > MAX_CHAT_IMAGE_BYTES) throw new Error('फ़ोटो compress करने के बाद भी 8MB से बड़ी है।');
  const path = `chatMedia/${chatId}/${uid}/${messageId}`;
  const objectRef = storageRef(storage, path);
  try {
    await withTimeout(
      uploadBytes(objectRef, prepared, { contentType: prepared.type || 'image/jpeg' }),
      UPLOAD_TIMEOUT_MS,
      'फ़ोटो अपलोड नहीं हो सकी — इंटरनेट या Firebase Storage जाँचें।'
    );
    return await getDownloadURL(objectRef);
  } catch (e) {
    if (e?.code === 'storage/unauthorized') throw new Error('फ़ोटो अपलोड की अनुमति नहीं मिली — storage.rules अपडेट करें।');
    throw e;
  }
}

export async function deleteChatImage(uid, chatId, messageId) {
  if (!storage) return;
  await deleteObject(storageRef(storage, `chatMedia/${chatId}/${uid}/${messageId}`)).catch(() => {});
}

export async function uploadStatusMedia(uid, statusId, file) {
  if (!storage) {
    throw new Error('Firebase Storage शुरू नहीं हो पाया — फ़ाइल अपलोड नहीं हो सकती।');
  }
  if (file.size > MAX_STATUS_MEDIA_BYTES) {
    throw new Error('फ़ाइल बहुत बड़ी है (अधिकतम 15MB)।');
  }
  const path = `statusMedia/${uid}/${statusId}`;
  const ref = storageRef(storage, path);
  try {
    await withTimeout(
      uploadBytes(ref, file, { contentType: file.type }),
      UPLOAD_TIMEOUT_MS,
      'अपलोड बहुत समय ले रहा है — शायद Firebase Storage अभी तक enable नहीं है (देखें FIREBASE_SETUP.md #3b), या इंटरनेट धीमा है।'
    );
    return await getDownloadURL(ref);
  } catch (e) {
    if (e?.code === 'storage/unauthorized') {
      throw new Error('अपलोड की परमिशन नहीं मिली — storage.rules लागू करें (FIREBASE_SETUP.md #3b)।');
    }
    if (e?.code === 'storage/unknown' || e?.code === 'storage/retry-limit-exceeded') {
      throw new Error('Firebase Storage से कनेक्ट नहीं हो पाया — शायद अभी तक enable नहीं किया गया है (FIREBASE_SETUP.md #3b)।');
    }
    throw e;
  }
}

export async function deleteStatusMedia(uid, statusId) {
  if (!storage) return;
  const ref = storageRef(storage, `statusMedia/${uid}/${statusId}`);
  await deleteObject(ref).catch(() => {}); // fine if it's already gone
}
