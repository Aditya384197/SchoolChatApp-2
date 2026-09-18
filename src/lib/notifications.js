import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

export async function prepareNotifications() {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const current = await LocalNotifications.checkPermissions();
    if (current.display === 'granted') return true;
    const requested = await LocalNotifications.requestPermissions();
    return requested.display === 'granted';
  } catch {
    return false;
  }
}

export async function showMessageNotification({ title, body, id = Date.now() }) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const ready = await prepareNotifications();
    if (!ready) return;
    await LocalNotifications.schedule({
      notifications: [{
        id: Math.abs(Number(id)) % 2147483647,
        title,
        body,
        schedule: { at: new Date(Date.now() + 50) }
      }]
    });
  } catch {
    // Notifications are optional; chat functionality must continue if unavailable.
  }
}
