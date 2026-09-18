import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, updateProfile
} from 'firebase/auth';
import { ref, get, set, update, runTransaction } from 'firebase/database';
import { auth, db } from '../firebase';
import { ADMIN_ACCESS_EMAIL } from '../adminAccess';

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

// Phase 2: write the actual profile (name/phone/avatar/photo) once collected.
// Role is recomputed fresh from config/adminUid here rather than trusted
// from phase 1, so this also correctly resumes an interrupted sign-up.
export async function completeRegistration({ uid, email, name, phone, avatar, photoUrl }) {
  const adminUidSnap = await get(ref(db, 'config/adminUid'));
  const role = adminUidSnap.val() === uid ? 'admin' : 'user';

  if (auth.currentUser) await updateProfile(auth.currentUser, { displayName: name.trim() });
  await set(ref(db, `users/${uid}`), {
    name: name.trim(),
    email,
    phone: phone?.trim() || '',
    avatar: avatar || '🧑‍🎓',
    photoUrl: photoUrl || '',
    role,
    createdAt: Date.now(),
    lastSeen: Date.now(),
    online: true
  });
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
  if (auth.currentUser) {
    await set(ref(db, `users/${auth.currentUser.uid}/online`), false);
  }
  localStorage.removeItem('schoolChatVerified');
  return signOut(auth);
}
