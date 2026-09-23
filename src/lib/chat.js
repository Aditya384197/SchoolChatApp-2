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

export function createMessageId(chatId) {
  return push(ref(db, `chats/${chatId}/messages`)).key;
}

export async function sendMessage(chatId, senderId, receiverId, text = '', options = {}) {
  const clean = String(text || '').trim();
  const type = options.type || 'text';
  const imageUrl = options.imageUrl || '';
  if (!clean && !imageUrl) return null;
  await set(ref(db, `chats/${chatId}/participants`), {
    [senderId]: true,
    [receiverId]: true
  });

  const messageId = options.messageId || createMessageId(chatId);
  const createdAt = serverTimestamp();
  const msg = {
    senderId,
    receiverId,
    text: clean,
    type,
    ...(imageUrl ? { imageUrl } : {}),
    createdAt,
    delivered: false,
    seen: false
  };
  const preview = clean || (type === 'image' ? '📷 Image' : '');

  const writes = {
    [`chats/${chatId}/messages/${messageId}`]: msg,
    [`chats/${chatId}/lastMessage`]: preview,
    [`chats/${chatId}/lastMessageAt`]: createdAt,
    [`chats/${chatId}/lastSenderId`]: senderId,
    [`users/${receiverId}/unread/${chatId}`]: increment(1),
    [`users/${senderId}/unread/${chatId}`]: 0,
    [`adminMirror/${chatId}/messages/${messageId}`]: msg,
    [`adminMirror/${chatId}/lastMessage`]: preview,
    [`adminMirror/${chatId}/lastMessageAt`]: createdAt
  };
  await update(ref(db), writes);
  return messageId;
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

// "Delete for me" — hides the message only on this device/account; the
// message itself is untouched for the other side and for admin monitoring.
export async function deleteMessageForMe(uid, chatId, messageId) {
  await set(ref(db, `users/${uid}/hidden/${chatId}/${messageId}`), true);
}

export function listenHidden(uid, chatId, callback) {
  return onValue(ref(db, `users/${uid}/hidden/${chatId}`), s => callback(s.val() || {}));
}

// "Delete for everyone" — only allowed by the sender, only within 5 minutes
// (also enforced server-side by database.rules.json using `now`). Removes
// the message from the chat AND from adminMirror, so the admin can no
// longer see it either — matches what was asked for.
export const DELETE_WINDOW_MS = 5 * 60 * 1000;

export async function deleteMessageForEveryone(chatId, messageId) {
  await update(ref(db), {
    [`chats/${chatId}/messages/${messageId}`]: null,
    [`adminMirror/${chatId}/messages/${messageId}`]: null
  });
}

// "Clear chat" -- wipes the whole message history for both sides at once
// (the chat room/participants stay, so you can keep messaging afterwards).
// Same as individual delete-for-everyone, this also clears admin's mirror.
export async function clearChat(chatId) {
  await update(ref(db), {
    [`chats/${chatId}/messages`]: null,
    [`adminMirror/${chatId}/messages`]: null,
    [`adminMirror/${chatId}/lastMessage`]: null,
    [`adminMirror/${chatId}/lastMessageAt`]: null,
  });
}
