import React, { useState } from 'react';

// Simple, device-local PIN lock (like a phone's app-lock, not an account
// feature). Only PIN is implemented -- a drawn pattern lock is a separate,
// fairly large UI component and was left out of this pass; PIN covers the
// same "keep this app out of casual hands" need.
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

export function PinPad({ mode, onSuccess, onCancel }) {
  // mode: 'set' | 'verify' | 'change'
  const [stage, setStage] = useState(mode === 'change' ? 'verifyOld' : mode === 'set' ? 'setNew' : 'verify');
  const [value, setValue] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');

  function press(d) {
    if (value.length >= 6) return;
    setError('');
    const next = value + d;
    setValue(next);
    if (next.length < 4) return;
    if (next.length === 4 || next.length === 6) handlePossibleSubmit(next);
  }

  function handlePossibleSubmit(pin) {
    setTimeout(() => submit(pin), 120);
  }

  function submit(pin) {
    if (stage === 'verify') {
      if (hash(pin) === localStorage.getItem(KEY)) onSuccess?.();
      else { setError('गलत पिन'); setValue(''); }
      return;
    }
    if (stage === 'verifyOld') {
      if (hash(pin) === localStorage.getItem(KEY)) { setStage('setNew'); setValue(''); }
      else { setError('गलत पिन'); setValue(''); }
      return;
    }
    if (stage === 'setNew') {
      setFirstPin(pin); setStage('confirmNew'); setValue('');
      return;
    }
    if (stage === 'confirmNew') {
      if (pin === firstPin) {
        localStorage.setItem(KEY, hash(pin));
        onSuccess?.();
      } else {
        setError('पिन मेल नहीं खाया, दोबारा कोशिश करें');
        setStage('setNew'); setValue(''); setFirstPin('');
      }
    }
  }

  const titles = {
    verify: 'ऐप अनलॉक करने के लिए पिन डालें',
    verifyOld: 'पहले पुराना पिन डालें',
    setNew: 'नया पिन डालें (4-6 अंक)',
    confirmNew: 'पिन दोबारा डालें',
  };

  return (
    <div className="pin-pad">
      <b>{titles[stage]}</b>
      <div className="pin-dots">{Array.from({ length: 6 }).map((_, i) => <span key={i} className={i < value.length ? 'filled' : ''} />)}</div>
      {error && <small className="error">{error}</small>}
      <div className="pin-grid">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) => d === '' ? <span key={i} /> :
          <button key={i} type="button" onClick={() => d === '⌫' ? setValue(v => v.slice(0, -1)) : press(d)}>{d}</button>)}
      </div>
      {onCancel && <button type="button" className="link" onClick={onCancel}>रद्द करें</button>}
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
