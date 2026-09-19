import { get, onValue, push, ref, remove, set } from 'firebase/database';
import { db } from '../firebase';

export const STATUS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function postStatus(uid, { type, content }) {
  const createdAt = Date.now();
  const statusRef = push(ref(db, `statuses/${uid}`));
  await set(statusRef, { type, content, createdAt, expiresAt: createdAt + STATUS_TTL_MS });
  return statusRef.key;
}

// Live, already-filtered-to-non-expired list for one user, newest last.
export function listenStatus(uid, callback) {
  return onValue(ref(db, `statuses/${uid}`), snap => {
    const data = snap.val() || {};
    const now = Date.now();
    const list = Object.entries(data)
      .map(([id, s]) => ({ id, ...s }))
      .filter(s => s.expiresAt > now)
      .sort((a, b) => a.createdAt - b.createdAt);
    callback(list);
  });
}

// Best-effort cleanup of a user's own expired statuses -- run whenever their
// app is open, since there is no server/Cloud Function to do this centrally.
export async function cleanupExpiredStatus(uid) {
  const snap = await get(ref(db, `statuses/${uid}`));
  const data = snap.val() || {};
  const now = Date.now();
  await Promise.all(
    Object.entries(data)
      .filter(([, s]) => s.expiresAt <= now)
      .map(([id]) => remove(ref(db, `statuses/${uid}/${id}`)).catch(() => {}))
  );
}

export async function markStatusViewed(ownerUid, statusId, viewerUid) {
  await set(ref(db, `statusViews/${ownerUid}/${statusId}/${viewerUid}`), true);
}

export function listenStatusViewCount(ownerUid, statusId, callback) {
  return onValue(ref(db, `statusViews/${ownerUid}/${statusId}`), snap => callback(Object.keys(snap.val() || {}).length));
}

export async function reactToStatus(ownerUid, statusId, viewerUid, emoji) {
  await set(ref(db, `statusReactions/${ownerUid}/${statusId}/${viewerUid}`), emoji);
}

export function listenStatusReactions(ownerUid, statusId, callback) {
  return onValue(ref(db, `statusReactions/${ownerUid}/${statusId}`), snap => callback(snap.val() || {}));
}

export async function commentOnStatus(ownerUid, statusId, fromUid, text) {
  const clean = text.trim();
  if (!clean) return;
  await push(ref(db, `statusComments/${ownerUid}/${statusId}`), { from: fromUid, text: clean, createdAt: Date.now() });
}

export function listenStatusComments(ownerUid, statusId, callback) {
  return onValue(ref(db, `statusComments/${ownerUid}/${statusId}`), snap => {
    const data = snap.val() || {};
    callback(Object.entries(data).map(([id, c]) => ({ id, ...c })).sort((a, b) => a.createdAt - b.createdAt));
  });
}

// Admin-only: remove someone's status entirely (also clears its views/
// reactions/comments). Relies on the admin's broad read/write already
// granted elsewhere; the rules give any signed-in user read on statuses
// (like WhatsApp contacts seeing each other's status), same as the admin.
export async function adminDeleteStatus(ownerUid, statusId) {
  const { deleteStatusMedia } = await import('./media');
  await Promise.all([
    remove(ref(db, `statuses/${ownerUid}/${statusId}`)),
    remove(ref(db, `statusViews/${ownerUid}/${statusId}`)),
    remove(ref(db, `statusReactions/${ownerUid}/${statusId}`)),
    remove(ref(db, `statusComments/${ownerUid}/${statusId}`)),
    deleteStatusMedia(ownerUid, statusId),
  ]);
}
