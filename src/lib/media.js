import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';

export const MAX_STATUS_MEDIA_BYTES = 15 * 1024 * 1024; // 15MB, matches storage.rules

// Photos/videos for status updates go to Firebase Storage (not the Realtime
// Database — RTDB isn't built for large binary blobs, and base64-encoding a
// video into it would blow past practical size limits fast). Profile photos
// stay as small base64 in RTDB as before; that's a different, much smaller
// use case.
export async function uploadStatusMedia(uid, statusId, file) {
  if (file.size > MAX_STATUS_MEDIA_BYTES) {
    throw new Error('फ़ाइल बहुत बड़ी है (अधिकतम 15MB)।');
  }
  const path = `statusMedia/${uid}/${statusId}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file, { contentType: file.type });
  return getDownloadURL(ref);
}

export async function deleteStatusMedia(uid, statusId) {
  const ref = storageRef(storage, `statusMedia/${uid}/${statusId}`);
  await deleteObject(ref).catch(() => {}); // fine if it's already gone
}
