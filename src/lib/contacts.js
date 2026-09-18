export async function getPhoneContacts() {
  if (!('contacts' in navigator) || !navigator.contacts?.select) return [];
  try {
    return await navigator.contacts.select(['name', 'tel'], { multiple: true });
  } catch {
    return [];
  }
}
