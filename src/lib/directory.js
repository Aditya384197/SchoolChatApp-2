import { get, onValue, ref, remove, set } from 'firebase/database';
import { db } from '../firebase';

// Adds someone to the current user's own "known contacts" -- the only
// mechanism (besides a phone-contact match) that makes another person's
// profile visible in the main list. One-directional: this makes THEM
// visible to YOU; it does not make you visible to them.
export async function addKnownContact(myUid, otherUid) {
  if (otherUid === myUid) return;
  await set(ref(db, `users/${myUid}/knownContacts/${otherUid}`), true);
}

export async function removeKnownContact(myUid, otherUid) {
  await remove(ref(db, `users/${myUid}/knownContacts/${otherUid}`));
}

export async function blockUser(myUid, otherUid) {
  await Promise.all([
    set(ref(db, `blocks/${myUid}/${otherUid}`), true),
    remove(ref(db, `users/${myUid}/knownContacts/${otherUid}`)),
  ]);
}

export async function unblockUser(myUid, otherUid) {
  await remove(ref(db, `blocks/${myUid}/${otherUid}`));
}

export function listenKnownContacts(myUid, callback) {
  return onValue(ref(db, `users/${myUid}/knownContacts`), s => callback(s.val() || {}));
}

function emailKey(email) {
  return (email || '').trim().toLowerCase().replace(/[.#$/\[\]]/g, '_');
}

// Exact-match lookup only (never partial/fuzzy) -- typing someone's code
// does not let you browse or guess other people. Returns the found user's
// uid+profile, or null.
export async function findByCode(code) {
  const clean = code.trim().toUpperCase();
  if (!clean) return null;
  const idxSnap = await get(ref(db, `userCodeIndex/${clean}`));
  const uid = idxSnap.val();
  if (!uid) return null;
  const userSnap = await get(ref(db, `users/${uid}`));
  const profile = userSnap.val();
  if (!profile) return null;
  return { uid, ...profile };
}

// Same idea, but for an exact email address. This is the one search mode
// that deliberately bypasses the "must already be a known contact" rule --
// an exact email is treated as proof you already know who you're looking
// for, same as being handed their user ID directly.
export async function findByEmail(email) {
  if (!email || !email.includes('@')) return null;
  const key = emailKey(email);
  const idxSnap = await get(ref(db, `emailIndex/${key}`));
  const uid = idxSnap.val();
  if (!uid) return null;
  const userSnap = await get(ref(db, `users/${uid}`));
  const profile = userSnap.val();
  if (!profile) return null;
  return { uid, ...profile };
}
