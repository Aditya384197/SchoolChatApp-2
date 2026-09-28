const STORAGE_KEY = 'schoolChatAdminSecretCode';
const DEFAULT_CODE = 'SC-ADMIN-7K4Q9X2M';

export function getAdminCode() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored || DEFAULT_CODE;
  } catch { return DEFAULT_CODE; }
}

export function validateAdminCode(code) {
  const value = String(code || '').trim();
  return value.length >= 10 && value.length <= 24 && /^[A-Za-z0-9_-]+$/.test(value) && /[A-Za-z]/.test(value) && /\d/.test(value);
}

export function setAdminCode(code) {
  const value = String(code || '').trim();
  if (!validateAdminCode(value)) throw new Error('Admin code must be 10–24 characters and contain both letters and numbers.');
  localStorage.setItem(STORAGE_KEY, value);
  return value;
}
