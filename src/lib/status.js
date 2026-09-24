import { get, onValue, push, ref, remove, set } from 'firebase/database';
import { db } from '../firebase';

export const STATUS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const MAX_ACTIVE_STATUS = 3; // a user can keep at most 3 statuses live at once

// extra (optional, video only): { duration, segments: [{s,e},...] (kept parts, seconds), overlay: {text,x,y,color,size} }
export async function postStatus(uid, { type, content, ...extra }) {
  const now = Date.now();
  const existing = await get(ref(db, `statuses/${uid}`));
  const active = Object.values(existing.val() || {}).filter(s => s && s.expiresAt > now).length;
  if (active >= MAX_ACTIVE_STATUS) {
    const err = new Error('STATUS_LIMIT');
    err.code = 'status-limit';
    throw err;
  }
  const createdAt = Date.now();
  const statusRef = push(ref(db, `statuses/${uid}`));
  const record = { type, content, createdAt, expiresAt: createdAt + STATUS_TTL_MS };
  if (extra.duration > 0) record.duration = Math.round(extra.duration * 100) / 100;
  if (Array.isArray(extra.segments) && extra.segments.length) record.segments = extra.segments;
  if (extra.overlay && extra.overlay.text) record.overlay = extra.overlay;
  await set(statusRef, record);
  return statusRef.key;
}

// Owner removes one of their own statuses (plus its views/reactions/comments).
export async function deleteOwnStatus(uid, statusId) {
  await Promise.all([
    remove(ref(db, `statuses/${uid}/${statusId}`)),
    remove(ref(db, `statusViews/${uid}/${statusId}`)).catch(() => {}),
    remove(ref(db, `statusReactions/${uid}/${statusId}`)).catch(() => {}),
    remove(ref(db, `statusComments/${uid}/${statusId}`)).catch(() => {}),
  ]);
}

// Which of these users currently have a live (non-expired) status. One
// listener per user path -- the rules only allow reading statuses/{uid},
// never the whole /statuses tree at once.
export function listenActiveStatusOwners(uids, callback) {
  const active = new Map();
  const emit = () => callback(new Set([...active.entries()].filter(([, v]) => v).map(([k]) => k)));
  const stops = uids.map(uid => onValue(ref(db, `statuses/${uid}`), snap => {
    const now = Date.now();
    active.set(uid, Object.values(snap.val() || {}).some(s => s && s.expiresAt > now));
    emit();
  }, () => { active.set(uid, false); emit(); }));
  return () => stops.forEach(stop => stop && stop());
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

export const IMAGE_STATUS_SECONDS = 5;

// Kept (not cut) parts of a video status, as [{s,e}] in seconds. Firebase
// may hand arrays back as plain objects, so both shapes are accepted.
export function normalizeSegments(item) {
  const raw = item?.segments;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : Object.values(raw);
  return list
    .map(x => ({ s: Number(x?.s), e: Number(x?.e) }))
    .filter(x => Number.isFinite(x.s) && Number.isFinite(x.e) && x.e - x.s > 0.05)
    .sort((a, b) => a.s - b.s);
}

// Total playing time of one status, used to size its bar in the top progress line.
export function statusSeconds(item, learned = 0) {
  if (!item || item.type !== 'video') return IMAGE_STATUS_SECONDS;
  const segs = normalizeSegments(item);
  if (segs.length) return segs.reduce((sum, x) => sum + (x.e - x.s), 0);
  return Number(item.duration) || Number(learned) || IMAGE_STATUS_SECONDS;
}
