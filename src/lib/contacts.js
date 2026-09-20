import { Capacitor } from '@capacitor/core';

// The old implementation used the browser's Contact Picker API
// (navigator.contacts), which does not exist inside a Capacitor Android
// WebView -- it silently always returned []. Swapped to the native
// @capacitor-community/contacts plugin, which actually works on-device.
export async function getPhoneContacts() {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const { Contacts } = await import('@capacitor-community/contacts');
    const perm = await Contacts.requestPermissions();
    if (perm.contacts !== 'granted') return [];
    const result = await Contacts.getContacts({ projection: { name: true, phones: true } });
    return (result.contacts || []).map(c => ({
      name: c.name?.display || '',
      tel: (c.phones || []).map(p => p.number).filter(Boolean),
    }));
  } catch {
    return [];
  }
}

function normalizePhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  return digits.slice(-10); // compare last 10 digits, so country-code/leading-0 formatting differences don't matter
}

// Matches the device's contact phone numbers against the given users' phone
// field. Returns a Set of matching user uids. Never shown anywhere in the
// UI by itself -- used only to quietly prioritise people you actually know
// (see AppShell's contact sort).
export async function matchContactUids(users) {
  const contacts = await getPhoneContacts();
  if (!contacts.length) return new Set();
  const deviceNumbers = new Set();
  contacts.forEach(c => (c.tel || []).forEach(t => {
    const n = normalizePhone(t);
    if (n) deviceNumbers.add(n);
  }));
  const matched = new Set();
  users.forEach(u => {
    const n = normalizePhone(u.phone);
    if (n && deviceNumbers.has(n)) matched.add(u.uid);
  });
  return matched;
}
