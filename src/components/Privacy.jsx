import React, { useEffect, useState } from 'react';
import { Lock, Unlock, Copy } from 'lucide-react';
import { usePrefs } from '../context/Prefs';
import {
  hasVault, isUnlocked, createVault, unlockVault, changeVaultPassword,
  getKeyId, lockSession, unlockPayload, MIN_PRIVACY_PASSWORD
} from '../lib/secureLock';

// Settings -> Privacy: create/unlock the Privacy Key that locked
// messages/files are wrapped against. Unlocking stays in effect for a couple
// of minutes (see secureLock.js), after which the password is asked again.
export function PrivacyPanel({ me }) {
  const { t } = usePrefs();
  const [exists, setExists] = useState(null);
  const [unlocked, setUnlocked] = useState(isUnlocked(me.uid));
  const [keyId, setKeyId] = useState('');
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [oldPw, setOldPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [changing, setChanging] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => { hasVault(me.uid).then(setExists); }, [me.uid]);
  useEffect(() => { if (unlocked) getKeyId(me.uid).then(setKeyId); }, [unlocked, me.uid]);
  useEffect(() => {
    if (!wait) return undefined;
    const id = setInterval(() => setWait(w => (w > 1 ? w - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [wait]);

  async function doCreate() {
    setError('');
    if (pw.length < MIN_PRIVACY_PASSWORD) { setError(t('privacyPasswordShort')); return; }
    if (pw !== pw2) { setError(t('pinMismatch')); return; }
    setBusy(true);
    try { await createVault(me.uid, pw); setExists(true); setUnlocked(true); setPw(''); setPw2(''); }
    catch { setError(t('privacyPasswordShort')); }
    finally { setBusy(false); }
  }
  async function doUnlock() {
    setError(''); setBusy(true);
    try { await unlockVault(me.uid, pw); setUnlocked(true); setPw(''); }
    catch (e) {
      if (e.code === 'too-many') { setWait(e.seconds); setError(t('tooManyAttempts')); } else setError(t('wrongPin'));
    } finally { setBusy(false); }
  }
  async function doChange() {
    setError('');
    if (pw.length < MIN_PRIVACY_PASSWORD) { setError(t('privacyPasswordShort')); return; }
    if (pw !== pw2) { setError(t('pinMismatch')); return; }
    setBusy(true);
    try { await changeVaultPassword(me.uid, oldPw, pw); setChanging(false); setPw(''); setPw2(''); setOldPw(''); setUnlocked(true); }
    catch (e) { setError(e.code === 'wrong-password' ? t('wrongPin') : t('privacyPasswordShort')); }
    finally { setBusy(false); }
  }

  if (exists === null) return <div className="media-spinner inline" />;
  return (
    <div className="privacy-panel">
      <p className="muted small">{t('privacyHint')}</p>
      {!exists && (
        <>
          <label>{t('privacyPasswordNew')}<input type="password" value={pw} onChange={e => setPw(e.target.value)} /></label>
          <label>{t('reenterPin')}<input type="password" value={pw2} onChange={e => setPw2(e.target.value)} /></label>
          {error && <div className="error">{error}</div>}
          <button className="primary" onClick={doCreate} disabled={busy}>{busy ? t('saving') : t('privacyCreate')}</button>
        </>
      )}
      {exists && !unlocked && !changing && (
        <>
          <label>{t('privacyPasswordEnter')}<input type="password" value={pw} onChange={e => setPw(e.target.value)} /></label>
          {wait > 0 ? <div className="pin-lockout"><small>{t('tooManyAttempts')}</small><b>{wait}s</b></div> : (error && <div className="error">{error}</div>)}
          <button className="primary" onClick={doUnlock} disabled={busy || wait > 0}>{busy ? t('saving') : t('privacyUnlock')}</button>
        </>
      )}
      {exists && unlocked && !changing && (
        <>
          <div className="privacy-status"><Unlock size={18} /> {t('privacyUnlocked')}</div>
          <label>{t('privacyKeyId')}<div className="id-row"><input value={keyId} readOnly /><button type="button" className="secondary" onClick={() => navigator.clipboard?.writeText(keyId)}><Copy size={14} /> {t('copy')}</button></div></label>
          <div className="step-actions">
            <button className="secondary" onClick={() => { lockSession(me.uid); setUnlocked(false); }}>{t('privacyLockNow')}</button>
            <button className="primary" onClick={() => setChanging(true)}>{t('privacyChangePassword')}</button>
          </div>
        </>
      )}
      {exists && changing && (
        <>
          <label>{t('privacyPasswordOld')}<input type="password" value={oldPw} onChange={e => setOldPw(e.target.value)} /></label>
          <label>{t('privacyPasswordNew')}<input type="password" value={pw} onChange={e => setPw(e.target.value)} /></label>
          <label>{t('reenterPin')}<input type="password" value={pw2} onChange={e => setPw2(e.target.value)} /></label>
          {error && <div className="error">{error}</div>}
          <div className="step-actions">
            <button className="secondary" onClick={() => { setChanging(false); setError(''); }}>{t('back')}</button>
            <button className="primary" onClick={doChange} disabled={busy}>{busy ? t('saving') : t('save')}</button>
          </div>
        </>
      )}
    </div>
  );
}

// Inline bubble shown for a `type: 'locked'` chat message. Handles the whole
// unlock flow itself: session already open -> decrypt immediately; vault
// exists but is locked -> ask the Privacy Password; no vault yet -> point at
// Settings -> Privacy.
export function LockedBubble({ me, chatId, message, onOpenMedia, onGoPrivacy }) {
  const { t } = usePrefs();
  const [state, setState] = useState('locked'); // locked | needVault | needPassword | busy | open
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [wait, setWait] = useState(0);
  const [content, setContent] = useState(null);
  const blobUrlRef = React.useRef('');

  useEffect(() => () => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current); }, []);
  useEffect(() => {
    if (!wait) return undefined;
    const id = setInterval(() => setWait(w => (w > 1 ? w - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [wait]);

  async function decrypt() {
    setState('busy'); setErr('');
    try {
      const { bytes, text, caption } = await unlockPayload({ meUid: me.uid, chatId, messageId: message.id, lock: message.lock, fileUrl: message.fileUrl });
      if (message.lock.kind === 'text') { setContent({ text }); setState('open'); return; }
      const blob = new Blob([bytes], { type: message.lock.mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setContent({ url, kind: message.lock.kind, caption, name: message.fileName || 'file' });
      setState('open');
    } catch (e) {
      setErr(e.code === 'key-missing' ? t('privacyKeyMissing') : t('privacyDecryptFailed'));
      setState('locked');
    }
  }
  async function begin() {
    setErr('');
    if (isUnlocked(me.uid)) { await decrypt(); return; }
    setState((await hasVault(me.uid)) ? 'needPassword' : 'needVault');
  }
  async function submitPassword(e) {
    e.preventDefault(); setErr('');
    setState('busy');
    try { await unlockVault(me.uid, pw); setPw(''); await decrypt(); }
    catch (e2) {
      if (e2.code === 'too-many') { setWait(e2.seconds); setErr(t('tooManyAttempts')); } else setErr(t('wrongPin'));
      setState('needPassword');
    }
  }

  if (state === 'open' && content) {
    if (content.text !== undefined) return <p className="locked-open-text">🔓 {content.text}</p>;
    return (
      <div className="locked-open-media">
        {content.kind === 'image' && <img src={content.url} alt="" onClick={() => onOpenMedia?.({ kind: 'image', url: content.url, caption: content.caption })} />}
        {content.kind === 'video' && <video src={content.url} controls playsInline onClick={e => e.stopPropagation()} />}
        {content.kind === 'file' && <a className="message-file" href={content.url} download={content.name}>📎 <span>{content.name}</span></a>}
        {content.caption && <p className="locked-open-text">{content.caption}</p>}
      </div>
    );
  }
  return (
    <div className="locked-bubble">
      <button type="button" className="locked-tap" onClick={begin} disabled={state === 'busy'}>
        <Lock size={17} /> <span>{t('lockedMessage')}</span>
      </button>
      {state === 'needVault' && (
        <div className="locked-inline">
          <small>{t('privacyKeyMissingSetup')}</small>
          <button type="button" className="primary" onClick={onGoPrivacy}>{t('privacyCreate')}</button>
        </div>
      )}
      {state === 'needPassword' && (
        <form className="locked-inline" onSubmit={submitPassword}>
          <input type="password" placeholder={t('privacyPasswordEnter')} value={pw} onChange={e => setPw(e.target.value)} autoFocus />
          {wait > 0 ? <div className="pin-lockout"><small>{t('tooManyAttempts')}</small><b>{wait}s</b></div> : (err && <small className="error">{err}</small>)}
          <button type="submit" className="primary" disabled={wait > 0}>{t('privacyUnlock')}</button>
        </form>
      )}
      {state === 'locked' && err && <small className="error">{err}</small>}
    </div>
  );
}
