import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, updateProfile
} from 'firebase/auth';
import { ref, get, set, runTransaction } from 'firebase/database';
import { auth, db } from '../firebase';

// --- Registration is split into two phases so the sign-up flow can feel
// step-based (code -> phone -> profile) while staying wired to real Firebase
// Authentication and the existing security rules underneath. ---

// Phase 1: create the Firebase Auth account and resolve the invite/admin
// code. Config is only readable once signed in, so the account has to exist
// before we can check the code -- if the code turns out to be wrong, the
// just-created account is rolled back so no orphan accounts pile up.
export async function beginRegistration(email, password, inviteCode, adminCode) {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  try {
    const snap = await get(ref(db, 'config/inviteCode'));
    const validInvite = snap.exists() && snap.val() === inviteCode;

    // config/adminUid can only ever be written once — first correct-code
    // claim wins — so this also doubles as "lock admin entry after the
    // first admin" behaviour, with no separate lock button needed.
    let becameAdmin = false;
    if (adminCode) {
      const codeSnap = await get(ref(db, 'config/adminCode'));
      const codeMatches = codeSnap.exists() && codeSnap.val() === adminCode;
      if (codeMatches) {
        const result = await runTransaction(ref(db, 'config/adminUid'), (current) => {
          if (current !== null) return; // someone already claimed it — abort
          return cred.user.uid;
        });
        becameAdmin = result.committed && result.snapshot.val() === cred.user.uid;
      }
    }

    if (!validInvite && !becameAdmin) {
      throw new Error(adminCode ? 'गलत एडमिन कोड (या एडमिन पहले से बन चुका है)।' : 'गलत जोड़ने वाला कोड।');
    }
    return { uid: cred.user.uid, email: cred.user.email, willBeAdmin: becameAdmin };
  } catch (e) {
    await cred.user.delete().catch(() => {});
    throw e;
  }
}

// Phase 2: write the actual profile (name/phone/avatar/photo) once collected.
// Role is recomputed fresh from config/adminUid here (rather than trusted
// from phase 1) so this also correctly resumes an interrupted sign-up: if
// someone closes the app between phase 1 and phase 2, next time they open it
// they land back on the profile step with their already-decided role intact.
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

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
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
