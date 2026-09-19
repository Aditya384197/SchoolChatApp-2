import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';

export const MAX_STATUS_MEDIA_BYTES = 15 * 1024 * 1024; // 15MB, matches storage.rules
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
