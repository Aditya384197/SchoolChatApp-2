import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

export async function prepareNotifications() {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const current = await LocalNotifications.checkPermissions();
    if (current.display !== 'granted') {
      const requested = await LocalNotifications.requestPermissions();
      if (requested.display !== 'granted') return false;
    }
    await LocalNotifications.registerActionTypes({ types: [{
      id: 'SCHOOL_CHAT_MESSAGE',
      actions: [
        { id: 'reply', title: 'Reply', foreground: true },
        { id: 'mark-read', title: 'Mark read', foreground: true }
      ]
    }] }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export async function showMessageNotification({ title, body, id = Date.now(), extra = null }) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const ready = await prepareNotifications();
    if (!ready) return;
    await LocalNotifications.schedule({
      notifications: [{
        id: Math.abs(Number(id)) % 2147483647,
        title,
        body,
        schedule: { at: new Date(Date.now() + 50) },
        extra,
        actionTypeId: 'SCHOOL_CHAT_MESSAGE'
      }]
    });
  } catch {
    // Notifications are optional; chat functionality must continue if unavailable.
  }
}

export async function listenNotificationActions(onAction) {
  if (!Capacitor.isNativePlatform()) return () => {};
  const handle = await LocalNotifications.addListener('localNotificationActionPerformed', action => {
    try { onAction?.(action); } catch {}
  });
  return () => handle.remove();
}
