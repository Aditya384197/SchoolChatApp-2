import React, { useEffect, useState } from 'react';
import { usePrefs } from '../context/Prefs';

// Simple, device-local PIN lock (like a phone's app-lock, not an account
// feature). Only PIN is implemented -- a drawn pattern lock is a separate,
// fairly large UI component and was left out of this pass; PIN covers the
// same "keep this app out of casual hands" need. The same PinPad is reused
// for per-chat "Chat Lock" (a separate PIN, separate from the whole-app
// lock, scoped to one contact) by passing a different storageKey.
const KEY = 'schoolChatPinHash';

function hash(pin) {
  // Not cryptographic security -- this is a convenience lock, not account
  // security (the real account is still protected by Firebase Auth). Good
  // enough to stop someone picking up the phone from reading the chat.
  let h = 0;
  for (let i = 0; i < pin.length; i++) h = (h * 31 + pin.charCodeAt(i)) >>> 0;
  return String(h);
}

export function isPinSet() {
  return !!localStorage.getItem(KEY);
}

export function clearPin() {
  localStorage.removeItem(KEY);
}

export function chatPinKey(otherUid) {
  return `schoolChatChatPinHash_${otherUid}`;
}

export function isChatPinSet(otherUid) {
  return !!localStorage.getItem(chatPinKey(otherUid));
}

export function clearChatPin(otherUid) {
  localStorage.removeItem(chatPinKey(otherUid));
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30000;
const failKey = key => `${key}_fails`;
const untilKey = key => `${key}_lockUntil`;

function remainingLockMs(key) {
  return Math.max(0, Number(localStorage.getItem(untilKey(key)) || 0) - Date.now());
}

export function PinPad({ mode, onSuccess, onCancel, storageKey }) {
  const { t } = usePrefs();
  const key = storageKey || KEY;
  // mode: 'set' | 'verify' | 'change'
  const [stage, setStage] = useState(mode === 'change' ? 'verifyOld' : mode === 'set' ? 'setNew' : 'verify');
  const [value, setValue] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');
  const [lockedMs, setLockedMs] = useState(() => (stage === 'verify' || stage === 'verifyOld') ? remainingLockMs(key) : 0);

  const PIN_LENGTH = 4;
  const locked = lockedMs > 0;

  useEffect(() => {
    if (!locked) return undefined;
    const id = setInterval(() => {
      const left = remainingLockMs(key);
      setLockedMs(left);
      if (left <= 0) { localStorage.removeItem(failKey(key)); setError(''); }
    }, 250);
    return () => clearInterval(id);
  }, [locked, key]);

  function registerWrongAttempt() {
    const fails = Number(localStorage.getItem(failKey(key)) || 0) + 1;
    localStorage.setItem(failKey(key), String(fails));
    if (fails >= MAX_ATTEMPTS) {
      localStorage.setItem(untilKey(key), String(Date.now() + LOCKOUT_MS));
      localStorage.setItem(failKey(key), '0');
      setLockedMs(LOCKOUT_MS);
    }
  }

  function press(d) {
    if (locked || value.length >= PIN_LENGTH) return;
    setError('');
    const next = value + d;
    setValue(next);
    if (next.length === PIN_LENGTH) handlePossibleSubmit(next);
  }

  function handlePossibleSubmit(pin) {
    setTimeout(() => submit(pin), 120);
  }

  function submit(pin) {
    if (stage === 'verify') {
      if (hash(pin) === localStorage.getItem(key)) { localStorage.removeItem(failKey(key)); onSuccess?.(); }
      else { registerWrongAttempt(); setError(t('wrongPin')); setValue(''); }
      return;
    }
    if (stage === 'verifyOld') {
      if (hash(pin) === localStorage.getItem(key)) { localStorage.removeItem(failKey(key)); setStage('setNew'); setValue(''); }
      else { registerWrongAttempt(); setError(t('wrongPin')); setValue(''); }
      return;
    }
    if (stage === 'setNew') {
      setFirstPin(pin); setStage('confirmNew'); setValue('');
      return;
    }
    if (stage === 'confirmNew') {
      if (pin === firstPin) {
        localStorage.setItem(key, hash(pin));
        onSuccess?.();
      } else {
        setError(t('pinMismatch'));
        setStage('setNew'); setValue(''); setFirstPin('');
      }
    }
  }

  const titles = {
    verify: t('unlockPrompt'),
    verifyOld: t('enterOldPin'),
    setNew: t('enterNewPin'),
    confirmNew: t('reenterPin'),
  };

  return (
    <div className="pin-pad">
      <b>{titles[stage]}</b>
      <div className="pin-dots">{Array.from({ length: PIN_LENGTH }).map((_, i) => <span key={i} className={i < value.length ? 'filled' : ''} />)}</div>
      {locked
        ? <div className="pin-lockout"><small>{t('tooManyAttempts')}</small><b>{Math.ceil(lockedMs / 1000)}s</b></div>
        : (error && <small className="error">{error}</small>)}
      <div className={`pin-grid${locked ? ' disabled' : ''}`}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) => d === '' ? <span key={i} /> :
          <button key={i} type="button" disabled={locked} onClick={() => d === '⌫' ? setValue(v => v.slice(0, -1)) : press(d)}>{d}</button>)}
      </div>
      {onCancel && <button type="button" className="link" onClick={onCancel}>{t('cancel')}</button>}
    </div>
  );
}

export function LockScreen({ onUnlock }) {
  return (
    <div className="lock-screen">
      <img src="/school-chat-icon.png" alt="" />
      <PinPad mode="verify" onSuccess={onUnlock} />
    </div>
  );
}
