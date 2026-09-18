import { get, ref, remove, set, update } from 'firebase/database';
import { db } from '../firebase';

// Removes a member: their profile, every chat they're part of (both sides
// and the admin mirror), and other members' unread-pointers into those
// chats. IMPORTANT limitation: this cannot delete their underlying Firebase
// Authentication credential (email/password) -- that requires the Admin SDK
// on a server, which this client-only app doesn't have. So they are banned
// instead: config/banned/{uid} is set, and the app force-signs-out anyone
// whose uid appears there the moment they sign in, before they can see or
// send anything. Functionally they're removed; their old email/password
// itself just can't be deleted from here.
export async function removeUser(uid) {
  const chatsSnap = await get(ref(db, 'chats'));
  const chats = chatsSnap.val() || {};
  const writes = {
    [`users/${uid}`]: null,
    [`config/banned/${uid}`]: true,
  };
  Object.entries(chats).forEach(([chatId, chat]) => {
    if (chat?.participants?.[uid]) {
      writes[`chats/${chatId}`] = null;
      writes[`adminMirror/${chatId}`] = null;
      Object.keys(chat.participants).forEach(otherUid => {
        if (otherUid !== uid) writes[`users/${otherUid}/unread/${chatId}`] = null;
      });
    }
  });
  await update(ref(db), writes);
}
