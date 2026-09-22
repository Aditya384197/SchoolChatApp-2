import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, updateProfile
} from 'firebase/auth';
import { ref, get, set, update, remove, runTransaction } from 'firebase/database';
import { auth, db } from '../firebase';
import { ADMIN_ACCESS_EMAIL } from '../adminAccess';
import { normalizePhone } from './contacts';

// --- Registration is split into two phases so sign-up can resume cleanly if
// interrupted, while staying wired to real Firebase Authentication and the
// existing security rules underneath. No invite/admin code fields exist
// anymore: anyone can sign up with email + password. Admin access is
// granted silently, with nothing shown anywhere in the UI, only when the
// email used to sign up matches ADMIN_ACCESS_EMAIL (see adminAccess.js). ---

// Phase 1: create the Firebase Auth account and (silently) resolve admin
// status for this email.
export async function beginRegistration(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  try {
    let becameAdmin = false;
    if (email.trim().toLowerCase() === ADMIN_ACCESS_EMAIL.toLowerCase()) {
      // config/adminUid can only ever be written once — first claim by this
      // exact email wins, permanently. No separate lock step needed.
      const result = await runTransaction(ref(db, 'config/adminUid'), (current) => {
        if (current !== null) return; // already claimed — abort
        return cred.user.uid;
      });
      becameAdmin = result.committed && result.snapshot.val() === cred.user.uid;
    }
    return { uid: cred.user.uid, email: cred.user.email, willBeAdmin: becameAdmin };
  } catch (e) {
    await cred.user.delete().catch(() => {});
    throw e;
  }
}

function randomUserCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I, easy to read aloud
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return 'SC-' + s;
}

// Claims a short, unique, shareable ID for this account (e.g. "SC-K3F9Q2")
// so a friend can find you by typing it in, without the app exposing
// everyone's profile to everyone by default. Retries on the rare collision.
async function claimUserCode(uid) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomUserCode();
    const result = await runTransaction(ref(db, `userCodeIndex/${code}`), current => {
      if (current !== null) return; // taken — abort, caller retries with a new code
      return uid;
    });
    if (result.committed && result.snapshot.val() === uid) return code;
  }
  throw new Error('यूज़र आईडी नहीं बन पाई, फिर कोशिश करें।');
}

function emailKey(email) {
  return (email || '').trim().toLowerCase().replace(/[.#$/\[\]]/g, '_');
}

// Phase 2: write the actual profile (name/phone/avatar/photo) once collected.
// Role is recomputed fresh from config/adminUid here rather than trusted
// from phase 1, so this also correctly resumes an interrupted sign-up.
export async function completeRegistration({ uid, email, name, phone, avatar, photoUrl }) {
  const adminUidSnap = await get(ref(db, 'config/adminUid'));
  const role = adminUidSnap.val() === uid ? 'admin' : 'user';
  const userCode = await claimUserCode(uid);

  if (auth.currentUser) await updateProfile(auth.currentUser, { displayName: name.trim() });
  await set(ref(db, `users/${uid}`), {
    name: name.trim(),
    email,
    phone: phone?.trim() || '',
    avatar: avatar || '🧑‍🎓',
    photoUrl: photoUrl || '',
    role,
    userCode,
    createdAt: Date.now(),
    lastSeen: Date.now(),
    online: true
  });
  const n = normalizePhone(phone);
  if (n) await set(ref(db, `phoneIndex/${n}`), uid).catch(() => {});
  // Email is already guaranteed unique by Firebase Auth itself, so this can
  // just be set directly -- it's what lets someone be found by exact email
  // even before they're anyone's phone contact (see lib/directory.js).
  await set(ref(db, `emailIndex/${emailKey(email)}`), uid).catch(() => {});
  localStorage.setItem('schoolChatVerified', '1');
  return role;
}

// Checked right after every sign-in/registration: an admin-removed member's
// uid stays permanently listed here, so even though their email/password
// itself can't be deleted from this client-only app, they can never get
// back past this check.
export async function isBanned(uid) {
  const snap = await get(ref(db, `config/banned/${uid}`));
  return snap.val() === true;
}

export async function updateOwnProfile(uid, { name, phone, avatar, photoUrl }) {
  const patch = {};
  if (name !== undefined) patch.name = name.trim();
  if (phone !== undefined) patch.phone = phone.trim();
  if (avatar !== undefined) patch.avatar = avatar;
  if (photoUrl !== undefined) patch.photoUrl = photoUrl;
  if (name !== undefined && auth.currentUser) await updateProfile(auth.currentUser, { displayName: name.trim() });
  if (phone !== undefined) {
    const oldSnap = await get(ref(db, `users/${uid}/phone`));
    const oldN = normalizePhone(oldSnap.val());
    const newN = normalizePhone(phone);
    if (oldN && oldN !== newN) await remove(ref(db, `phoneIndex/${oldN}`)).catch(() => {});
    if (newN) await set(ref(db, `phoneIndex/${newN}`), uid).catch(() => {});
  }
  await update(ref(db, `users/${uid}`), patch);
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  if (await isBanned(cred.user.uid)) {
    await signOut(auth);
    throw new Error('आपकी एक्सेस हटा दी गई है।');
  }
  await set(ref(db, `users/${cred.user.uid}/lastSeen`), Date.now());
  await set(ref(db, `users/${cred.user.uid}/online`), true);
  localStorage.setItem('schoolChatVerified', '1');
  return cred;
}

export async function logout() {
  // Mark offline is best-effort only -- if this write hangs or fails (e.g.
  // no connectivity right at that moment), signing out must still happen.
  // Previously this was awaited unguarded, so a slow/failed write could
  // silently block sign-out entirely (tapping "yes" appeared to do nothing).
  if (auth.currentUser) {
    set(ref(db, `users/${auth.currentUser.uid}/online`), false).catch(() => {});
  }
  localStorage.removeItem('schoolChatVerified');
  // Bounded too, for the same reason -- signOut() is normally fast and
  // local, but never let a stuck network call make "Yes" feel broken.
  await Promise.race([
    signOut(auth),
    new Promise(resolve => setTimeout(resolve, 4000)),
  ]);
}
