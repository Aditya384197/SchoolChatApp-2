import { Capacitor } from '@capacitor/core';
import { get, ref } from 'firebase/database';
import { db } from '../firebase';
import { addKnownContact } from './directory';

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

export function normalizePhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  return digits.slice(-10); // compare last 10 digits, so country-code/leading-0 formatting differences don't matter
}

// Privacy model: a normal user can't read the full user directory anymore
// (see database.rules.json), so matching can't scan a bulk users list --
// instead each device contact's phone number is looked up individually
// against phoneIndex/{number} -> uid (an exact-match index written at
// registration). Any match found is written into the current user's own
// knownContacts, which is what actually makes that person visible in the
// main list going forward. Nothing about this is shown anywhere -- it just
// runs quietly in the background.
export async function matchAndSaveContacts(myUid) {
  const contacts = await getPhoneContacts();
  if (!contacts.length) return;
  const numbers = new Set();
  contacts.forEach(c => (c.tel || []).forEach(t => {
    const n = normalizePhone(t);
    if (n) numbers.add(n);
  }));
  await Promise.all([...numbers].map(async n => {
    const snap = await get(ref(db, `phoneIndex/${n}`)).catch(() => null);
    const uid = snap?.val();
    if (uid && uid !== myUid) await addKnownContact(myUid, uid).catch(() => {});
  }));
}
