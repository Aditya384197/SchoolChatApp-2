import React, { useEffect, useMemo, useState } from 'react';
import { usePrefs } from '../context/Prefs';

const KEY = 'schoolChatPinHash';
export const PRIVACY_PIN_KEY = 'schoolChatPrivacyPinHash';
const RETRY_LIMIT = 5;
const LOCKOUT_MS = 30 * 1000;

function hash(pin) {
  let h = 0;
  for (let i = 0; i < pin.length; i++) h = (h * 31 + pin.charCodeAt(i)) >>> 0;
  return String(h);
}

function stateKey(key, suffix) {
  return `schoolChatPin_${suffix}_${key}`;
}

export function isPinSet() {
  return !!localStorage.getItem(KEY);
}

export function clearPin() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(stateKey(KEY, 'attempts'));
  localStorage.removeItem(stateKey(KEY, 'lockedUntil'));
}

export function isPrivacyPinSet() {
  return !!localStorage.getItem(PRIVACY_PIN_KEY);
}

export function clearPrivacyPin() {
  localStorage.removeItem(PRIVACY_PIN_KEY);
  localStorage.removeItem(stateKey(PRIVACY_PIN_KEY, 'attempts'));
  localStorage.removeItem(stateKey(PRIVACY_PIN_KEY, 'lockedUntil'));
}

export function chatPinKey(otherUid) {
  return `schoolChatChatPinHash_${otherUid}`;
}

export function isChatPinSet(otherUid) {
  return !!localStorage.getItem(chatPinKey(otherUid));
}

export function clearChatPin(otherUid) {
  const key = chatPinKey(otherUid);
  localStorage.removeItem(key);
  localStorage.removeItem(stateKey(key, 'attempts'));
  localStorage.removeItem(stateKey(key, 'lockedUntil'));
}

function remainingLockSeconds(key) {
  const until = Number(localStorage.getItem(stateKey(key, 'lockedUntil')) || 0);
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

export function PinPad({ mode, onSuccess, onCancel, storageKey, onSet, onVerified }) {
  const { t } = usePrefs();
  const key = storageKey || KEY;
  const [stage, setStage] = useState(mode === 'change' ? 'verifyOld' : mode === 'set' ? 'setNew' : 'verify');
  const [value, setValue] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');
  const [lockSeconds, setLockSeconds] = useState(() => remainingLockSeconds(key));
  const [attempts, setAttempts] = useState(() => Number(localStorage.getItem(stateKey(key, 'attempts')) || 0));

  const PIN_LENGTH = 4;
  const checkingPin = stage === 'verify' || stage === 'verifyOld';
  const locked = lockSeconds > 0 && checkingPin;

  useEffect(() => {
    if (!checkingPin) return undefined;
    const tick = () => {
      const next = remainingLockSeconds(key);
      setLockSeconds(next);
      if (next === 0) {
        localStorage.removeItem(stateKey(key, 'lockedUntil'));
        localStorage.removeItem(stateKey(key, 'attempts'));
        setAttempts(0);
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [key, checkingPin]);

  const title = useMemo(() => ({
    verify: t('unlockPrompt'),
    verifyOld: t('enterOldPin'),
    setNew: t('enterNewPin'),
    confirmNew: t('reenterPin'),
  }[stage]), [stage, t]);

  function registerFailure() {
    const next = attempts + 1;
    if (next >= RETRY_LIMIT) {
      const until = Date.now() + LOCKOUT_MS;
      localStorage.setItem(stateKey(key, 'lockedUntil'), String(until));
      localStorage.setItem(stateKey(key, 'attempts'), String(next));
      setAttempts(next);
      setLockSeconds(30);
      setError(t('tooManyPinAttempts'));
      setValue('');
      return;
    }
    localStorage.setItem(stateKey(key, 'attempts'), String(next));
    setAttempts(next);
    setError(`${t('wrongPin')} (${next}/${RETRY_LIMIT})`);
    setValue('');
  }

  function clearFailureState() {
    localStorage.removeItem(stateKey(key, 'attempts'));
    localStorage.removeItem(stateKey(key, 'lockedUntil'));
    setAttempts(0);
    setLockSeconds(0);
  }

  function press(d) {
    if (locked || value.length >= PIN_LENGTH) return;
    setError('');
    const next = value + d;
    setValue(next);
    if (next.length === PIN_LENGTH) window.setTimeout(() => submit(next), 110);
  }

  function submit(pin) {
    if (locked) return;
    if (stage === 'verify') {
      if (hash(pin) === localStorage.getItem(key)) {
        clearFailureState();
        onVerified?.(pin);
        onSuccess?.();
      } else {
        registerFailure();
      }
      return;
    }
    if (stage === 'verifyOld') {
      if (hash(pin) === localStorage.getItem(key)) {
        clearFailureState();
        setStage('setNew');
        setValue('');
        setError('');
      } else {
        registerFailure();
      }
      return;
    }
    if (stage === 'setNew') {
      setFirstPin(pin);
      setStage('confirmNew');
      setValue('');
      return;
    }
    if (stage === 'confirmNew') {
      if (pin === firstPin) {
        localStorage.setItem(key, hash(pin));
        clearFailureState();
        onSet?.(pin);
        onSuccess?.();
      } else {
        setError(t('pinMismatch'));
        setStage('setNew');
        setValue('');
        setFirstPin('');
      }
    }
  }

  function backspace() {
    if (locked) return;
    setError('');
    setValue(v => v.slice(0, -1));
  }

  return (
    <div className="pin-pad">
      <b>{title}</b>
      <div className="pin-dots">
        {Array.from({ length: PIN_LENGTH }).map((_, i) => <span key={i} className={i < value.length ? 'filled' : ''} />)}
      </div>
      {checkingPin && attempts > 0 && lockSeconds === 0 && <small className="pin-attempts">{attempts}/{RETRY_LIMIT}</small>}
      {locked ? (
        <div className="pin-lockout">
          <b>{t('tooManyPinAttempts')}</b>
          <span>{t('tryAgainIn')} <strong>{lockSeconds}s</strong></span>
        </div>
      ) : error ? <small className="error pin-error">{error}</small> : null}
      <div className={`pin-grid${locked ? ' disabled' : ''}`}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) => d === '' ? <span key={i} /> :
          <button key={i} type="button" disabled={locked} onClick={() => d === '⌫' ? backspace() : press(d)}>{d}</button>)}
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
