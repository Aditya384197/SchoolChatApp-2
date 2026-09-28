import { onDisconnect, onValue, ref, serverTimestamp, set } from 'firebase/database';
import { db } from '../firebase';

export function startPresence(uid) {
  const statusRef = ref(db, `users/${uid}`);
  const connectedRef = ref(db, '.info/connected');
  let active = true;

  const setOnlineState = async (online) => {
    if (!active) return;
    await set(ref(db, `users/${uid}/online`), online);
    if (!online) await set(ref(db, `users/${uid}/lastSeen`), serverTimestamp());
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      setOnlineState(true).catch(() => {});
    } else {
      setOnlineState(false).catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  const unsubscribe = onValue(connectedRef, async (snapshot) => {
    if (snapshot.val() !== true || !active) return;
    await onDisconnect(ref(db, `users/${uid}/online`)).set(false).catch(() => {});
    await onDisconnect(ref(db, `users/${uid}/lastSeen`)).set(serverTimestamp()).catch(() => {});
    await set(ref(db, `users/${uid}/online`), true);
    await set(ref(db, `users/${uid}/lastSeen`), serverTimestamp());
  });

  return () => {
    active = false;
    unsubscribe();
    document.removeEventListener('visibilitychange', onVisibility);
    set(ref(db, `users/${uid}/online`), false).catch(() => {});
    set(ref(db, `users/${uid}/lastSeen`), serverTimestamp()).catch(() => {});
  };
}

export function listenTyping(chatId, callback) {
  return onValue(ref(db, `chats/${chatId}/typing`), (snapshot) => {
    callback(snapshot.val() || {});
  });
}

export async function setTyping(chatId, uid, value) {
  await set(ref(db, `chats/${chatId}/typing/${uid}`), Boolean(value));
  if (value) {
    await onDisconnect(ref(db, `chats/${chatId}/typing/${uid}`)).set(false);
  }
}
