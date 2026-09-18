import {
  increment,
  onValue,
  push,
  ref,
  serverTimestamp,
  set,
  update
} from 'firebase/database';
import { db } from '../firebase';

export const chatIdFor = (a, b) => [a, b].sort().join('_');

export function listenMessages(chatId, callback) {
  const r = ref(db, `chats/${chatId}/messages`);
  return onValue(r, (snap) => {
    const data = snap.val() || {};
    const list = Object.entries(data)
      .map(([id, m]) => ({ id, ...m }))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    callback(list);
  });
}

export async function sendMessage(chatId, senderId, receiverId, text) {
  const clean = text.trim();
  if (!clean) return null;
  await set(ref(db, `chats/${chatId}/participants`), {
    [senderId]: true,
    [receiverId]: true
  });

  const messageRef = push(ref(db, `chats/${chatId}/messages`));
  const createdAt = serverTimestamp();
  const msg = {
    senderId,
    receiverId,
    text: clean,
    createdAt,
    delivered: false,
    seen: false
  };

  const writes = {
    [`chats/${chatId}/messages/${messageRef.key}`]: msg,
    [`chats/${chatId}/lastMessage`]: clean,
    [`chats/${chatId}/lastMessageAt`]: createdAt,
    [`chats/${chatId}/lastSenderId`]: senderId,
    [`users/${receiverId}/unread/${chatId}`]: increment(1),
    [`users/${senderId}/unread/${chatId}`]: 0,
    [`adminMirror/${chatId}/messages/${messageRef.key}`]: msg,
    [`adminMirror/${chatId}/lastMessage`]: clean,
    [`adminMirror/${chatId}/lastMessageAt`]: createdAt
  };
  await update(ref(db), writes);
  return messageRef.key;
}

export async function markDelivered(chatId, messageId) {
  const patch = { delivered: true };
  await update(ref(db, `chats/${chatId}/messages/${messageId}`), patch);
  await update(ref(db, `adminMirror/${chatId}/messages/${messageId}`), patch);
}

export async function markSeen(chatId, messageId) {
  const patch = { delivered: true, seen: true };
  await update(ref(db, `chats/${chatId}/messages/${messageId}`), patch);
  await update(ref(db, `adminMirror/${chatId}/messages/${messageId}`), patch);
}

export async function clearUnread(uid, chatId) {
  await set(ref(db, `users/${uid}/unread/${chatId}`), 0);
}
