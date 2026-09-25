import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { onValue, ref, update } from 'firebase/database';
import {
  ArrowLeft, MessageCircle, Search, Send, Phone, PhoneOff, Mic, MicOff, ImagePlus,
  ShieldCheck, Users, X, LayoutGrid, MessagesSquare, Info, Camera,
  Settings as SettingsIcon, Copy, Share2, Video, File as FileIcon, Image as ImageIcon, Type as TypeIcon, Volume2,
  Trash2, CheckSquare, Check, LogOut, User, RefreshCw, Ban, MoreVertical, Lock,
  ChevronDown, Bluetooth, Smartphone, Pencil
} from 'lucide-react';
import { auth, db, firebaseInitError } from './firebase';
import { beginRegistration, completeRegistration, login, logout, isBanned, updateOwnProfile, changeUserCode, validateUserId } from './lib/auth';
import {
  chatIdFor, clearUnread, listenMessages, markDelivered, markSeen, sendMessage, createMessageId,
  deleteMessageForMe, deleteMessageForEveryone, listenHidden, DELETE_WINDOW_MS, clearChat
} from './lib/chat';
import { getPhoneContacts, matchAndSaveContacts, normalizePhone } from './lib/contacts';
import { listenKnownContacts, addKnownContact, removeKnownContact, blockUser, unblockUser, findByCode, findByEmail } from './lib/directory';
import { removeUser } from './lib/admin';
import { listenTyping, setTyping, startPresence } from './lib/presence';
import { prepareNotifications, showMessageNotification, listenNotificationActions } from './lib/notifications';
import { Avatar, AvatarPicker, PhotoPicker, AVATARS } from './components/Profile';
import { isPinSet, LockScreen, PinPad, clearPin, isChatPinSet, clearChatPin, chatPinKey } from './components/AppLock';
import { usePrefs, localeFor, LANGUAGES } from './context/Prefs';
import { StatusViewer } from './components/StatusViewer';
import { postStatus, cleanupExpiredStatus, listenActiveStatusOwners, listenStatus, MAX_ACTIVE_STATUS } from './lib/status';
import { MediaViewer, ChatImage, VideoThumb } from './components/MediaViewer';
import { VideoEditor } from './components/VideoEditor';
import { MyStatusPanel } from './components/MyStatusPanel';
import { uploadStatusMedia, uploadChatMedia, getAttachmentKind, deleteChatImage, prefetchMedia, fileToBytes, uploadEncryptedBytes, compressImage } from './lib/media';
import { lockPayload, hasVault } from './lib/secureLock';
import { PrivacyPanel, LockedBubble } from './components/Privacy';
import { useBackHandler } from './lib/backStack';
import { initNativeBack, setExitWarningHandler } from './lib/nativeBack';
import { APP_VERSION, UPDATE_URL } from './appMeta';
import { useVoiceCall } from './lib/calls';
import { getAudioRoutes, setAudioRoute } from './lib/audioRoute';

function formatLastSeen(ts, t, lang) {
  const unavailable = `${t('lastSeen')} ${t('notAvailable')}`;
  if (!ts) return unavailable;
  const date = new Date(ts); if (Number.isNaN(date.getTime())) return unavailable;
  const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()); const days = Math.round((today-d)/86400000);
  const loc=localeFor(lang); const time=date.toLocaleTimeString(loc,{hour:'2-digit',minute:'2-digit'});
  if(days===0) return `${t('lastSeen')} ${time}`; if(days===1) return `${t('yesterday')} ${time}`;
  return `${t('lastSeen')} ${date.toLocaleDateString(loc,{day:'2-digit',month:'short',year:'numeric'})}, ${time}`;
}

// Consistent header used by every settings sub-panel/full-screen: back
// arrow always on the left, centred title, balanced empty space on the
// right (never a cross/X for "go back one step").
function PanelHeader({ title, onBack }) {
  // Deliberately not relying on CSS :active here: when tapping this button
  // navigates to a new panel, the old button unmounts and a brand new back
  // button mounts at the same screen position -- in this WebView the new
  // element could inherit a "stuck" active/pressed state that never clears
  // since it never got its own matching pointer-down. A React-driven class,
  // always starting clean on every fresh mount, can't get stuck that way.
  const [pressed, setPressed] = useState(false);
  return (
    <div className="panel-header">
      <button
        className={`icon${pressed ? ' pressed' : ''}`}
        onClick={onBack}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        onPointerCancel={() => setPressed(false)}
      ><ArrowLeft /></button>
      <b className="panel-header-title">{title}</b>
      <span className="panel-header-spacer" />
    </div>
  );
}

function StepDots({ step, total = 3 }) {
  return (
    <div className="step-dots">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={`dot ${i + 1 === step ? 'active' : i + 1 < step ? 'done' : ''}`} />
      ))}
    </div>
  );
}

// Steps 2 (phone) + 3 (profile: name/avatar/photo) — shared by a fresh
// registration (after step 1 creates the account) and by someone resuming
// an interrupted sign-up (account already exists, profile doesn't yet).
function ProfileSteps({ identity, initialPhone = '', onDone }) {
  const { t } = usePrefs();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [photoUrl, setPhotoUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const savedPhone = initialPhone || localStorage.getItem('schoolChatPendingPhone') || '';

  async function finish(skip = false) {
    const chosenName = name.trim() || (identity.email || '').split('@')[0] || 'Student';
    if (!skip && !name.trim()) { setError(t('nameRequired')); return; }
    setError(''); setBusy(true);
    try {
      await completeRegistration({
        uid: identity.uid,
        email: identity.email,
        name: chosenName,
        phone: savedPhone,
        requirePhone: identity.requirePhone ?? Boolean(savedPhone),
        avatar,
        photoUrl: skip ? '' : photoUrl,
      });
      localStorage.removeItem('schoolChatPendingPhone');
      onDone?.();
    } catch (e) {
      setError(e.message || t('start'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card auth-card">
      <StepDots step={2} total={2} />
      <h1>{t('buildProfile')}</h1>
      <p className="muted auth-center-note">{t('profileOptionalHint')}</p>
      <form onSubmit={e => { e.preventDefault(); finish(false); }}>
        <label>{t('name')}<input value={name} onChange={e => setName(e.target.value)} autoFocus /></label>
        <p className="muted small">{t('addPhoto')} <span className="optional">({t('optional')})</span></p>
        <PhotoPicker photoUrl={photoUrl} onChange={setPhotoUrl} />
        <p className="muted small">{t('chooseAvatar')}</p>
        <AvatarPicker selected={avatar} onSelect={a => { setAvatar(a); setPhotoUrl(''); }} />
        {error && <div className="error">{error}</div>}
        <div className="step-actions">
          <button type="button" className="secondary" onClick={() => finish(true)} disabled={busy}>{t('skipForNow')}</button>
          <button className="primary" disabled={busy}>{busy ? t('saving') : t('saveAndStart')}</button>
        </div>
      </form>
    </section>
  );
}

function RegisterWizard({ onSwitch }) {
  const { t } = usePrefs();
  const [identity, setIdentity] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (identity) return <ProfileSteps identity={identity} initialPhone={phone} />;

  async function submit(e) {
    e.preventDefault();
    setError('');
    const normalized = normalizePhone(phone);
    if (normalized && normalized.length !== 10) {
      setError(t('validPhoneError'));
      return;
    }
    setBusy(true);
    localStorage.setItem('schoolChatPendingPhone', phone);
    try {
      const result = await beginRegistration(email, password, phone);
      setIdentity({ ...result, phone, requirePhone: false });
    } catch (e) {
      localStorage.removeItem('schoolChatPendingPhone');
      setError(e.message || t('pleaseWait'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card auth-card">
      <img className="brand-image" src="/school-chat-icon.png" alt={t('appName')} />
      <h1>{t('newAccount')}</h1>
      <StepDots step={1} total={2} />
      <form onSubmit={submit}>
        <label>{t('email')}<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" /></label>
        <label>{t('password')}<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength="6" required autoComplete="new-password" /></label>
        <label>{t('phone')} <span className="optional">({t('optional')})</span><input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder={t('phonePlaceholder')} /></label>
        <p className="muted small form-hint">{t('phoneHint')}</p>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? t('pleaseWait') : t('createAccount')}</button>
      </form>
      <button className="link" onClick={onSwitch}>{t('haveAccount')}</button>
    </section>
  );
}

function LoginForm({ onSwitch }) {
  const { t } = usePrefs();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await login(email, password);
    } catch (e) {
      setError(e.message || t('pleaseWait'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card auth-card">
      <img className="brand-image" src="/school-chat-icon.png" alt={t('appName')} />
      <h1>{t('appName')}</h1>
      <p className="muted">{t('tagline')}</p>
      <form onSubmit={submit}>
        <label>{t('email')}<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>{t('password')}<input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? t('pleaseWait') : t('login')}</button>
      </form>
      <button className="link" onClick={onSwitch}>{t('newAccount')}</button>
    </section>
  );
}

function AuthScreen({ bannedMsg }) {
  const { t } = usePrefs();
  const [mode, setMode] = useState('login');
  return (
    <main className="auth">
      {bannedMsg && <div className="error banned-banner">{bannedMsg}</div>}
      {mode === 'register'
        ? <RegisterWizard onSwitch={() => setMode('login')} />
        : <LoginForm onSwitch={() => setMode('register')} />}
      {mode === 'login' && <button className="link outside" onClick={() => setMode('register')}>{t('noAccount')}</button>}
    </main>
  );
}

// Shown when someone is signed in (auth account exists) but never finished
// the profile step — e.g. they closed the app between phase 1 and phase 2
// of registration. Resumes straight at the phone/profile steps.
function CompleteProfileScreen({ me }) {
  return (
    <main className="auth">
      <ProfileSteps identity={{ uid: me.uid, email: me.email }} />
    </main>
  );
}

function MessageBubble({ me, message, chatId, onSeen, onLongPress, selectionMode, selected, onToggleSelect, onOpenMedia, onGoPrivacy }) {
  const mine=message.senderId===me.uid, pressTimer=useRef(null);
  function start(){if(!selectionMode) pressTimer.current=setTimeout(()=>onLongPress(message),500)} function stop(){clearTimeout(pressTimer.current)}
  function tap(){if(selectionMode){onToggleSelect(message.id);return} if(!mine) onSeen(message.id)}
  const attachmentType = message.type || (message.imageUrl ? 'image' : 'text');
  const attachmentUrl = message.fileUrl || message.imageUrl || '';
  if (message.type === 'locked') {
    return (
      <div data-message-date={message.createdAt ? new Date(message.createdAt).toDateString() : ''}
        className={`bubble locked-wrap ${mine ? 'mine bubble-enter-mine' : 'theirs bubble-enter-theirs'} ${selected ? 'selected' : ''}`}
        onClick={() => { if (selectionMode) onToggleSelect(message.id); }}
        onPointerDown={start} onPointerUp={stop} onPointerLeave={stop}
        onContextMenu={e => { e.preventDefault(); onLongPress(message); }}>
        <LockedBubble me={me} chatId={chatId} message={message} onOpenMedia={onOpenMedia} onGoPrivacy={onGoPrivacy} />
        <div className="message-meta"><span>{message.createdAt ? new Date(message.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '…'}</span>{mine && <span className={`ticks ${message.seen ? 'seen' : ''}`}>{message.delivered ? '✓✓' : '✓'}</span>}</div>
      </div>
    );
  }
  function openMedia(e, kind) {
    if (selectionMode) return; // in selection mode a tap just toggles the selection
    e.stopPropagation();
    if (!mine) onSeen(message.id);
    onOpenMedia?.({ kind, url: attachmentUrl, caption: message.text || '' });
  }
  return <div data-message-date={message.createdAt?new Date(message.createdAt).toDateString():''} className={`bubble ${mine?'mine bubble-enter-mine':'theirs bubble-enter-theirs'} ${selected?'selected':''}`} onClick={tap} onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onContextMenu={e=>{e.preventDefault();onLongPress(message)}}>
    {attachmentType==='image' && attachmentUrl && <ChatImage url={attachmentUrl} alt={message.text||'Image'} onOpen={e=>openMedia(e,'image')}/>}
    {attachmentType==='video' && attachmentUrl && <VideoThumb url={attachmentUrl} onOpen={e=>openMedia(e,'video')}/>}
    {attachmentType==='file' && attachmentUrl && <a className="message-file" href={attachmentUrl} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>📎 <span>{message.fileName||'File'}</span></a>}
    {message.text&&<div>{message.text}</div>}
    <div className="message-meta"><span>{message.createdAt?new Date(message.createdAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'…'}</span>{mine&&<span className={`ticks ${message.seen?'seen':''}`}>{message.delivered?'✓✓':'✓'}</span>}</div>
  </div>
}

function MessageInfo({message,me,onClose}){
  const {t}=usePrefs(); const fmt=ts=>ts?new Date(ts).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):t('notAvailable');
  const attachmentUrl=message.fileUrl||message.imageUrl||''; const type=message.type||(message.imageUrl?'image':'text');
  return <div className="info-overlay" onClick={onClose}><aside className="message-info" onClick={e=>e.stopPropagation()}><PanelHeader title={t('messageInfo')} onBack={onClose}/><div className="info-message-preview">{type==='image'&&attachmentUrl&&<img src={attachmentUrl} alt=""/>}{type==='video'&&attachmentUrl&&<video src={attachmentUrl} controls playsInline preload="metadata"/>}{type==='file'&&attachmentUrl&&<a className="message-file" href={attachmentUrl} target="_blank" rel="noopener noreferrer">📎 <span>{message.fileName||'File'}</span></a>}{message.text&&<p>{message.text}</p>}<small>{fmt(message.createdAt)}</small></div><div className="info-list"><div><b>{message.senderId===me.uid?t('sent'):t('received')}</b><span>{fmt(message.createdAt)}</span></div><div><b>{t('delivered')}</b><span>{fmt(message.deliveredAt)}</span></div><div><b>{t('seen')}</b><span>{fmt(message.seenAt)}</span></div></div></aside></div>
}

function BulkDeleteSheet({ canDeleteForEveryone, onClose, onDeleteForMe, onDeleteForEveryone }) {
  const { t } = usePrefs();
  useBackHandler(onClose);
  return (
    <div className="msg-actions" onClick={onClose}>
      <div className="sheet slide-up" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <button onClick={onDeleteForMe}><Trash2 size={18} /> {t('deleteForMe')}</button>
        {canDeleteForEveryone && <button className="danger" onClick={onDeleteForEveryone}><Trash2 size={18} /> {t('deleteForEveryone')}</button>}
        <button className="cancel" onClick={onClose}>{t('cancel')}</button>
      </div>
    </div>
  );
}

function ChatMenu({ me, user, chatId, messages = [], onClose, onBlocked }) {
  const { t } = usePrefs();
  useBackHandler(onClose);
  const [confirmClear, setConfirmClear] = useState(false);
  const [lockPanel, setLockPanel] = useState(false);
  const locked = isChatPinSet(user.uid);

  async function doBlock() {
    await blockUser(me.uid, user.uid);
    onBlocked?.();
  }
  async function doClear() {
    await Promise.all(messages.filter(m => m.imageUrl).map(m => deleteChatImage(m.senderId, chatId, m.id).catch(() => {})));
    await clearChat(chatId);
    setConfirmClear(false);
    onClose();
  }

  if (lockPanel) {
    return (
      <div className="overlay" onClick={onClose}>
        <aside className="drawer" onClick={e => e.stopPropagation()}>
          <PanelHeader title={t('chatLock')} onBack={() => setLockPanel(false)} />
          <div className="pin-page">
            {locked
              ? <PinPad mode="change" storageKey={chatPinKey(user.uid)} onSuccess={() => setLockPanel(false)} onCancel={() => setLockPanel(false)} />
              : <PinPad mode="set" storageKey={chatPinKey(user.uid)} onSuccess={() => setLockPanel(false)} onCancel={() => setLockPanel(false)} />}
          </div>
          {locked && <button className="link" style={{ margin: '10px auto' }} onClick={() => { clearChatPin(user.uid); setLockPanel(false); }}>{t('removeAppLock')}</button>}
        </aside>
      </div>
    );
  }

  return (
    <div className="chat-menu-overlay" onClick={onClose}>
      <div className="chat-menu-popover" onClick={e => e.stopPropagation()}>
        <button onClick={doBlock}><Ban size={18} /> {t('block')}</button>
        {confirmClear ? (
          <>
            <p style={{ padding: '0 20px 6px', fontSize: 13 }}>{t('clearChatConfirm')}</p>
            <button className="danger" onClick={doClear}><Trash2 size={18} /> {t('yes')}</button>
          </>
        ) : (
          <button onClick={() => setConfirmClear(true)}><Trash2 size={18} /> {t('clearChat')}</button>
        )}
        <button onClick={() => setLockPanel(true)}><Lock size={18} /> {t('chatLock')} <span className="row-end status-text">{locked ? t('chatLockOn') : t('chatLockOff')}</span></button>
        <button onClick={onClose}><ArrowLeft size={18} /> {t('back')}</button>
      </div>
    </div>
  );
}

function Chat({ me, user, onBack, onStartVoiceCall, callBusy }) {
  const { t, lang } = usePrefs();
  const chatId = chatIdFor(me.uid, user.uid);
  const [messages, setMessages] = useState([]);
  const [hidden, setHidden] = useState({});
  const [text, setText] = useState('');
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [attachmentPreview, setAttachmentPreview] = useState('');
  const [attachmentKind, setAttachmentKind] = useState(null);
  const [typingUsers, setTypingUsers] = useState({});
  const [sending, setSending] = useState(false);
  const [imageError, setImageError] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [infoMessage, setInfoMessage] = useState(null);
  const [activeDate, setActiveDate] = useState('');
  const [nearBottom, setNearBottom] = useState(true);
  const [imageSourceOpen, setImageSourceOpen] = useState(false);
  const [viewerMedia, setViewerMedia] = useState(null);
  const [uploadPct, setUploadPct] = useState(null);
  const [lockOn, setLockOn] = useState(false);
  const galleryRef = useRef(null); const cameraRef = useRef(null);
  const [chatUnlocked, setChatUnlocked] = useState(!isChatPinSet(user.uid));
  const [copiedTick, setCopiedTick] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimer = useRef(null);
  const typingActive = useRef(false);
  const fileInputRef = useRef(null);
  const selectionMode = selectedIds.size > 0;

  function clearSelection() { setSelectedIds(new Set()); }
  useBackHandler(selectionMode ? clearSelection : onBack);

  useEffect(() => listenMessages(chatId, setMessages), [chatId]);
  useEffect(() => listenHidden(me.uid, chatId, setHidden), [chatId, me.uid]);
  useEffect(() => listenTyping(chatId, setTypingUsers), [chatId]);
  useEffect(() => {
    let active = true;
    messages.forEach(m => {
      if (m.receiverId === me.uid && !m.delivered) markDelivered(chatId, m.id).catch(() => {});
    });
    const incoming = messages.filter(m => m.receiverId === me.uid);
    const latest = incoming[incoming.length - 1];
    if (active && latest && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
    return () => { active = false; };
  }, [messages, me.uid, chatId]);

  // Received photos/videos start downloading the moment they arrive (like
  // WhatsApp), so opening them later is instant.
  useEffect(() => {
    messages.forEach(m => {
      if (m.receiverId !== me.uid) return;
      const kind = m.type || (m.imageUrl ? 'image' : '');
      if (kind === 'image' || kind === 'video') prefetchMedia(m.fileUrl || m.imageUrl, kind);
    });
  }, [messages, me.uid]);

  useEffect(() => {
    clearUnread(me.uid, chatId).catch(() => {});
    messages.filter(m => m.receiverId === me.uid && !m.seen).forEach(m => markSeen(chatId, m.id).catch(() => {}));
  }, [chatId, me.uid, messages.length]);

  async function handleTyping(value) {
    setText(value);
    clearTimeout(typingTimer.current);
    if (value && !typingActive.current) {
      typingActive.current = true;
      await setTyping(chatId, me.uid, true).catch(() => {});
    }
    if (!value && typingActive.current) {
      typingActive.current = false;
      await setTyping(chatId, me.uid, false).catch(() => {});
      return;
    }
    if (value) {
      typingTimer.current = setTimeout(() => {
        typingActive.current = false;
        setTyping(chatId, me.uid, false).catch(() => {});
      }, 1400);
    }
  }

  useEffect(() => () => { if (attachmentPreview) URL.revokeObjectURL(attachmentPreview); }, [attachmentPreview]);

  function pickChatAttachment(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const kind = getAttachmentKind(file);
    if (!kind) { setImageError('Supported files: images, videos, PDF and .bin.'); return; }
    if (file.size > 15 * 1024 * 1024) { setImageError('File is larger than 15 MB.'); return; }
    setImageError('');
    if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
    setAttachmentFile(file);
    setAttachmentKind(kind);
    setAttachmentPreview(kind === 'image' || kind === 'video' ? URL.createObjectURL(file) : '');
  }

  function clearChatAttachment() {
    if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
    setAttachmentFile(null);
    setAttachmentKind(null);
    setAttachmentPreview('');
    setImageError('');
  }

  async function submit(e) {
    e.preventDefault();
    const value = text.trim();
    if ((!value && !attachmentFile) || sending) return;
    setSending(true);
    setImageError('');
    setText('');
    clearTimeout(typingTimer.current);
    typingActive.current = false;
    setTyping(chatId, me.uid, false).catch(() => {});

    if (attachmentFile) {
      const file = attachmentFile;
      const kind = attachmentKind;
      const messageId = createMessageId(chatId);
      const wasLocked = lockOn;
      clearChatAttachment();
      try {
        if (wasLocked) {
          const prepared = kind === 'image' ? await compressImage(file) : file;
          const bytes = await fileToBytes(prepared);
          const { lock, cipher } = await lockPayload({ recipientUid: user.uid, chatId, messageId, bytes, caption: value, kind, mime: prepared.type || file.type });
          const uploaded = await uploadEncryptedBytes(cipher, setUploadPct);
          await sendMessage(chatId, me.uid, user.uid, '', {
            type: 'locked', lock, fileUrl: uploaded.url,
            fileName: prepared.name || file.name, fileType: prepared.type || file.type, fileSize: prepared.size,
            messageId
          });
        } else {
          const uploaded = await uploadChatMedia(me.uid, chatId, messageId, file, setUploadPct);
          await sendMessage(chatId, me.uid, user.uid, value, {
            type: kind,
            fileUrl: uploaded.url,
            fileName: uploaded.file.name,
            fileType: uploaded.file.type || file.type || 'application/octet-stream',
            fileSize: uploaded.file.size,
            messageId
          });
        }
      } catch (error) {
        setImageError(error?.message || 'File could not be sent. Please try again.');
        setText(value);
        setSending(false);
        setUploadPct(null);
        setAttachmentFile(file);
        setAttachmentKind(kind);
        setAttachmentPreview(kind === 'image' || kind === 'video' ? URL.createObjectURL(file) : '');
        return;
      }
    } else if (lockOn) {
      const messageId = createMessageId(chatId);
      try {
        const { lock } = await lockPayload({ recipientUid: user.uid, chatId, messageId, bytes: new TextEncoder().encode(value), kind: 'text' });
        await sendMessage(chatId, me.uid, user.uid, '', { type: 'locked', lock, messageId });
      } catch {
        setImageError(t('privacyDecryptFailed'));
        setText(value);
        setSending(false);
        return;
      }
    } else {
      sendMessage(chatId, me.uid, user.uid, value).catch(() => {});
    }
    setLockOn(false);
    setSending(false);
    setUploadPct(null);
    inputRef.current?.focus();
  }

  const visibleMessages = messages.filter(m => !hidden[m.id]);
  function handleScroll(){const el=listRef.current;if(!el)return;setNearBottom(el.scrollHeight-el.scrollTop-el.clientHeight<80);const nodes=[...el.querySelectorAll('[data-message-date]')];let cur='';for(const n of nodes){if(n.offsetTop-el.scrollTop<=90)cur=n.dataset.messageDate||cur;else break}if(cur)setActiveDate(new Date(cur).toLocaleDateString(localeFor(lang),{day:'numeric',month:'long',year:'numeric'}));}
  function scrollBottom(){listRef.current?.scrollTo({top:listRef.current.scrollHeight,behavior:'smooth'});}
  const selectedMsgs = visibleMessages.filter(m => selectedIds.has(m.id));
  const allSelected = visibleMessages.length > 0 && selectedIds.size === visibleMessages.length;
  const canDeleteForEveryone = selectedMsgs.length > 0 && selectedMsgs.every(
    m => m.senderId === me.uid && m.createdAt && (Date.now() - m.createdAt < DELETE_WINDOW_MS)
  );

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(visibleMessages.map(m => m.id)));
  }
  function joinedText() {
    return [...selectedMsgs].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map(m => m.text || (m.imageUrl ? '[Image]' : '')).filter(Boolean).join('\n');
  }
  async function copySelected() {
    try {
      await navigator.clipboard.writeText(joinedText());
      setCopiedTick(true);
      setTimeout(() => { setCopiedTick(false); clearSelection(); }, 500);
    } catch { /* clipboard unavailable */ }
  }
  async function shareSelected() {
    if (navigator.share) {
      try { await navigator.share({ text: joinedText() }); } catch { /* user cancelled */ }
    } else {
      await copySelected();
    }
    clearSelection();
  }
  async function deleteForMeBulk() {
    await Promise.all([...selectedIds].map(id => deleteMessageForMe(me.uid, chatId, id)));
    setShowDeleteSheet(false); clearSelection();
  }
  async function deleteForEveryoneBulk() {
    const selected = visibleMessages.filter(m => selectedIds.has(m.id));
    await Promise.all(selected.map(async m => {
      if (m.imageUrl) await deleteChatImage(m.senderId, chatId, m.id).catch(() => {});
      await deleteMessageForEveryone(chatId, m.id);
    }));
    setShowDeleteSheet(false); clearSelection();
  }

  const otherTyping = Boolean(typingUsers[user.uid]);

  if (!chatUnlocked) {
    return (
      <div className="lock-screen">
        <Avatar user={user} size="lg" />
        <PinPad mode="verify" storageKey={chatPinKey(user.uid)} onSuccess={() => setChatUnlocked(true)} onCancel={onBack} />
      </div>
    );
  }

  return (
    <div className="screen chat-screen">
      {selectionMode ? (
        <header className="topbar selection-bar">
          <button className="icon" onClick={clearSelection}><ArrowLeft /></button>
          <b className="grow">{selectedIds.size} {t('selectedCount')}</b>
          <button className="icon" onClick={selectAll} title={t('selectAll')}><CheckSquare size={20} /></button>
          <button className="icon" onClick={copySelected} title={t('copy')}>{copiedTick ? <Check size={20} /> : <Copy size={20} />}</button>
          <button className="icon" onClick={shareSelected} title={t('share')}><Share2 size={20} /></button>
          {selectedIds.size===1&&<button className="icon" onClick={()=>setInfoMessage(selectedMsgs[0])} title={t('messageInfo')}><Info size={20}/></button>}
          <button className="icon" onClick={() => setShowDeleteSheet(true)} title={t('delete')}><Trash2 size={20} /></button>
        </header>
      ) : (
        <header className="topbar">
          <button className="icon" onClick={onBack}><ArrowLeft /></button>
          <Avatar user={user} size="sm" />
          <div className="chat-title">
            <b>{user.name}</b>
            <small>{user.online ? t('online2') : formatLastSeen(user.lastSeen, t, lang)}</small>
            {otherTyping && <span className="typing-label">{t('typing')}</span>}
          </div>
          <button className="icon call-icon" onClick={() => onStartVoiceCall?.(user)} title={t('voiceCall')} disabled={callBusy}><Phone size={21} /></button>
          <button className="icon" onClick={() => setShowChatMenu(true)} title={t('chatMenu')}><MoreVertical /></button>
        </header>
      )}
      {showChatMenu && (
        <ChatMenu
          me={me} user={user} chatId={chatId} messages={messages} onClose={() => setShowChatMenu(false)}
          onBlocked={onBack}
        />
      )}
      <div className="messages" ref={listRef} onScroll={handleScroll}>
        {activeDate&&<div className="chat-date-chip">{activeDate}</div>}
        {visibleMessages.map(m => (
          <MessageBubble
            key={m.id} me={me} message={m} chatId={chatId}
            onSeen={id => markSeen(chatId, id).catch(() => {})}
            onLongPress={msg => setSelectedIds(new Set([msg.id]))}
            selectionMode={selectionMode} selected={selectedIds.has(m.id)} onToggleSelect={toggleSelect}
            onOpenMedia={setViewerMedia}
            onGoPrivacy={() => { setShowChatMenu(false); setLockPanel2(true); }}
          />
        ))}
        {otherTyping && <div className="typing-bubble"><span></span><span></span><span></span></div>}
      </div>
      {imageError && <div className="error chat-image-error">{imageError}</div>}
      {sending && uploadPct !== null && <div className="upload-progress"><span style={{ width: `${Math.round(uploadPct * 100)}%` }} /><small>{t('uploading')} {Math.round(uploadPct * 100)}%</small></div>}
      {attachmentFile && (
        <div className="chat-attachment-preview">
          {attachmentKind === 'image' && attachmentPreview && <img src={attachmentPreview} alt="" />}
          {attachmentKind === 'video' && attachmentPreview && <video src={attachmentPreview} muted playsInline />}
          {attachmentKind === 'file' && <div className="attachment-file-preview">📎 <b>{attachmentFile.name}</b><small>{Math.ceil(attachmentFile.size / 1024)} KB</small></div>}
          <input value={text} onChange={e=>setText(e.target.value)} placeholder={t('imageCaption')} />
          <button type="button" className="icon" onClick={clearChatAttachment} title="Remove"><X size={18} /></button>
        </div>
      )}
      <form className="composer" onSubmit={submit}>
        <button type="button" className="icon attach-btn" onClick={() => setImageSourceOpen(true)} title="Attach" disabled={sending}><ImagePlus size={21} /></button>
        <button type="button" className={`icon lock-toggle-btn ${lockOn ? 'active' : ''}`} onClick={() => setLockOn(v => !v)} disabled={sending} title={lockOn ? t('lockToggleOff') : t('lockToggleOn')}><Lock size={19} /></button>
        <input ref={inputRef} value={text} onChange={e => handleTyping(e.target.value)} placeholder={t('messagePlaceholder')} />
        <button className="send" disabled={sending} onMouseDown={e => e.preventDefault()}><Send size={20} /></button>
      </form>
      <input ref={galleryRef} type="file" hidden accept="image/*,video/*" onChange={pickChatAttachment}/><input ref={cameraRef} type="file" hidden accept="image/*" capture="environment" onChange={pickChatAttachment}/><input ref={fileInputRef} type="file" hidden accept="image/*,video/*,application/pdf,application/octet-stream,.pdf,.bin" onChange={pickChatAttachment}/>
      {imageSourceOpen&&<div className="source-overlay" onClick={()=>setImageSourceOpen(false)}><div className="source-card" onClick={e=>e.stopPropagation()}><b>Attach file</b><button onClick={()=>{setImageSourceOpen(false);cameraRef.current?.click()}}><Camera/>Camera</button><button onClick={()=>{setImageSourceOpen(false);galleryRef.current?.click()}}><ImageIcon/>Gallery</button><button onClick={()=>{setImageSourceOpen(false);fileInputRef.current?.click()}}><FileIcon/>Files</button><button className="cancel" onClick={()=>setImageSourceOpen(false)}>Cancel</button></div></div>}
      {!nearBottom&&<button className="scroll-bottom" onClick={scrollBottom}><ArrowLeft size={17} style={{transform:'rotate(-90deg)'}}/></button>}
      {infoMessage&&<MessageInfo message={infoMessage} me={me} onClose={()=>setInfoMessage(null)}/>}
      {viewerMedia&&<MediaViewer kind={viewerMedia.kind} url={viewerMedia.url} caption={viewerMedia.caption} onClose={()=>setViewerMedia(null)}/>}
      {showDeleteSheet&&(
        <BulkDeleteSheet
          canDeleteForEveryone={canDeleteForEveryone}
          onClose={() => setShowDeleteSheet(false)}
          onDeleteForMe={deleteForMeBulk}
          onDeleteForEveryone={deleteForEveryoneBulk}
        />
      )}
    </div>
  );
}

function ContactRow({ u, subtitle, statusUids, unread, onOpenStatus, onOpenChat, onLongPress }) {
  const pressTimer = useRef(null);
  function start() { pressTimer.current = setTimeout(onLongPress, 500); }
  function stop() { clearTimeout(pressTimer.current); }
  return (
    <div className="user-row">
      <button className={`avatar-wrap ${statusUids.has(u.uid) ? 'has-status' : ''}`} onClick={onOpenStatus}>
        <Avatar user={u} />
      </button>
      <button
        className="grow user-row-text" onClick={onOpenChat}
        onPointerDown={start} onPointerUp={stop} onPointerLeave={stop}
        onContextMenu={e => { e.preventDefault(); onLongPress(); }}
      >
        <b>{u.name}</b><small className="truncate">{subtitle}</small>
      </button>
      {unread > 0 && <span className="row-unread">{unread}</span>}
      <button className="icon" onClick={onOpenChat}><MessageCircle size={20} /></button>
    </div>
  );
}

function ContactActionSheet({ user, me, onClose }) {
  const { t } = usePrefs();
  useBackHandler(onClose);
  async function doDelete() {
    await removeKnownContact(me.uid, user.uid);
    onClose();
  }
  async function doBlock() {
    await blockUser(me.uid, user.uid);
    onClose();
  }
  return (
    <div className="msg-actions" onClick={onClose}>
      <div className="sheet slide-up" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <p style={{ padding: '0 20px 8px', fontWeight: 700 }}>{user.name}</p>
        <button onClick={doDelete}><Trash2 size={18} /> {t('delete')}</button>
        <button className="danger" onClick={doBlock}><Ban size={18} /> {t('block')}</button>
        <button className="cancel" onClick={onClose}>{t('cancel')}</button>
      </div>
    </div>
  );
}

function CallAvatar({ user }) {
  return <Avatar user={user} size="lg" />;
}

// Small "call in progress" pill shown while the call screen is minimised.
// Sits in the bottom-left corner by default; drag it to any corner and it
// snaps there (and remembers the choice).
function MiniCallPill({ name, duration, onRestore }) {
  const [corner, setCorner] = useState(() => localStorage.getItem('schoolChatMiniCallCorner') || 'bl');
  const [drag, setDrag] = useState(null);
  const ref = useRef(null);
  const st = useRef({ down: false, moved: false, sx: 0, sy: 0, ox: 0, oy: 0 });
  function down(e) {
    const r = ref.current.getBoundingClientRect();
    st.current = { down: true, moved: false, sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function move(e) {
    const s = st.current;
    if (!s.down) return;
    const dx = e.clientX - s.sx; const dy = e.clientY - s.sy;
    if (!s.moved && Math.hypot(dx, dy) > 8) s.moved = true;
    if (s.moved) setDrag({ x: s.ox + dx, y: s.oy + dy });
  }
  function up() {
    const s = st.current;
    if (!s.down) return;
    s.down = false;
    if (!s.moved) { onRestore(); return; }
    const r = ref.current.getBoundingClientRect();
    const right = r.left + r.width / 2 > window.innerWidth / 2;
    const bottom = r.top + r.height / 2 > window.innerHeight / 2;
    const next = `${bottom ? 'b' : 't'}${right ? 'r' : 'l'}`;
    setCorner(next);
    localStorage.setItem('schoolChatMiniCallCorner', next);
    setDrag(null);
  }
  return (
    <button ref={ref} className={`mini-call-pill corner-${corner}${drag ? ' dragging' : ''}`}
      style={drag ? { left: drag.x, top: drag.y, right: 'auto', bottom: 'auto' } : undefined}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <span className="mini-call-icon"><Phone size={15} /></span><span className="mini-call-name">{name}</span><b>{duration}</b>
    </button>
  );
}

function IncomingVoiceCall({ call, onAccept, onDecline }) {
  const { t } = usePrefs();
  const peer = call.peer || { uid: call.callerId, name: 'School Chat' };
  useEffect(() => {
    let ctx; let timer; let stopped = false;
    const beep = () => {
      try {
        ctx ||= new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.frequency.value = 880; gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
        osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.3);
      } catch {}
    };
    beep(); timer = setInterval(() => { if (!stopped) beep(); }, 1200);
    return () => { stopped = true; clearInterval(timer); try { ctx?.close(); } catch {} };
  }, []);
  return (
    <div className="voice-overlay call2">
      <div className="call2-bg" />
      <div className="call2-body">
        <div className="call2-top"><span className="call2-badge"><Phone size={13} /> {t('incomingVoiceCall')}</span></div>
        <div className="call2-center">
          <div className="call2-avatar ring"><CallAvatar user={peer} /></div>
          <b className="call2-name">{peer.name}</b>
          <span className="call2-status">School Chat</span>
        </div>
        <div className="call2-actions two">
          <div className="call2-act"><button className="call2-btn decline" onClick={() => onDecline(call)}><PhoneOff size={28} /></button><small>{t('decline')}</small></div>
          <div className="call2-act"><button className="call2-btn accept" onClick={() => onAccept(call)}><Phone size={28} /></button><small>{t('accept')}</small></div>
        </div>
      </div>
    </div>
  );
}

function ActiveVoiceCall({ call, remoteStream, muted, onToggleMute, onHangUp }) {
  const { t } = usePrefs();
  const [elapsed, setElapsed] = useState(0);
  const [route, setRoute] = useState('earpiece');
  const [routes, setRoutes] = useState({ bluetooth: false });
  const [routeOpen, setRouteOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const audioRef = useRef(null);
  const routeRef = useRef('earpiece');
  useBackHandler(() => { if (!minimized) { setMinimized(true); return true; } return false; });
  useEffect(() => { routeRef.current = route; }, [route]);
  useEffect(() => {
    if (!call.startedAt) { setElapsed(0); return undefined; }
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - call.startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [call.startedAt]);
  useEffect(() => {
    let live = true;
    const refresh = () => getAudioRoutes().then(value => {
      if (!live) return;
      setRoutes(value);
      if (!value.bluetooth && routeRef.current === 'bluetooth') {
        setAudioRoute('earpiece').catch(() => {});
        setRoute('earpiece');
        setRouteOpen(false);
      }
    });
    setAudioRoute('earpiece').catch(() => {});
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  useEffect(() => { if (audioRef.current) { audioRef.current.srcObject = remoteStream || null; if (remoteStream) audioRef.current.play().catch(() => {}); } }, [remoteStream]);
  async function chooseRoute(r) {
    const ok = await setAudioRoute(r);
    if (ok) { setRoute(r); setRouteOpen(false); }
  }
  async function toggleOutput() {
    if (routes.bluetooth) { setRouteOpen(v => !v); return; }
    await chooseRoute(route === 'speaker' ? 'earpiece' : 'speaker');
  }
  const mins = Math.floor(elapsed / 60);
  const secs = String(elapsed % 60).padStart(2, '0');
  const duration = `${mins}:${secs}`;
  const connected = call.status !== 'ringing' && call.status !== 'connecting';
  const status = call.status === 'ringing' ? (call.peer?.online ? t('ringing') : t('calling')) : call.status === 'connecting' ? t('connecting') : duration;
  const name = call.peer?.name || t('user');
  const RouteIcon = route === 'bluetooth' ? Bluetooth : route === 'speaker' ? Volume2 : Smartphone;
  const routeLabel = route === 'bluetooth' ? t('bluetooth') : route === 'speaker' ? t('speaker') : t('earpiece');

  if (minimized) return <MiniCallPill name={name} duration={duration} onRestore={() => setMinimized(false)} />;
  return (
    <div className="voice-overlay call2 active-call-overlay">
      <div className="call2-bg" />
      <div className="call2-body">
        <div className="call2-top">
          <button className="call2-min" onClick={() => setMinimized(true)} aria-label={t('back')}><ChevronDown size={28} /></button>
          <span className="call2-badge"><Lock size={12} /> School Chat</span>
          <span className="call2-min-spacer" />
        </div>
        <div className="call2-center">
          <div className={`call2-avatar ${connected ? 'live' : 'ring'}`}><CallAvatar user={call.peer} /></div>
          <b className="call2-name">{name}</b>
          <span className={`call2-status ${connected ? 'live' : ''}`}>{status}</span>
        </div>
        <audio ref={audioRef} autoPlay playsInline />
        <div className="call2-actions">
          <div className="call2-act route-wrap">
            <button className={`call2-btn ${route !== 'earpiece' ? 'on' : ''}`} onClick={toggleOutput}><RouteIcon size={26} /></button>
            <small>{routeLabel}</small>
            {routeOpen && routes.bluetooth && (
              <div className="route-menu">
                <button onClick={() => chooseRoute('earpiece')}><Smartphone size={16} /> {t('earpiece')}</button>
                <button onClick={() => chooseRoute('speaker')}><Volume2 size={16} /> {t('speaker')}</button>
                <button onClick={() => chooseRoute('bluetooth')}><Bluetooth size={16} /> {t('bluetooth')}</button>
              </div>
            )}
          </div>
          <div className="call2-act">
            <button className={`call2-btn ${muted ? 'on' : ''}`} onClick={onToggleMute}>{muted ? <MicOff size={26} /> : <Mic size={26} />}</button>
            <small>{muted ? t('unmute') : t('mute')}</small>
          </div>
          <div className="call2-act">
            <button className="call2-btn end" onClick={onHangUp}><PhoneOff size={28} /></button>
            <small>{t('endCall')}</small>
          </div>
        </div>
      </div>
    </div>
  );
}

function AppShell({ me, profile }) {
  const { t, lang, background } = usePrefs();
  const [users, setUsers] = useState([]);
  const [knownContacts, setKnownContacts] = useState({});
  const [adminUid, setAdminUid] = useState(null);
  const [query, setQuery] = useState('');
  const [discovered, setDiscovered] = useState(null); // a person found via exact email/ID search, not yet in your list
  const [discovering, setDiscovering] = useState(false);
  const [chatUser, setChatUser] = useState(null);
  const [contactAction, setContactAction] = useState(null);
  const [settings, setSettings] = useState(false);
  const [unread, setUnread] = useState({});
  const [previews, setPreviews] = useState({});
  const [notificationsReady, setNotificationsReady] = useState(false);
  const [view, setView] = useState('chats'); // 'chats' | 'admin' — admin gets its own tab, not just a settings sub-panel
  useBackHandler(view === 'admin' ? () => setView('chats') : null);
  const [statusUids, setStatusUids] = useState(new Set());
  const [statusOwner, setStatusOwner] = useState(null); // whose status is being viewed
  const [statusStart, setStatusStart] = useState(0);
  const [composing, setComposing] = useState(false);
  const voiceCall = useVoiceCall({ uid: me.uid, users });

  // Privacy: a normal user can no longer read the whole /users directory
  // (see database.rules.json) -- only their own "known contacts" (people a
  // phone-contact match or a Find-by-ID search has already introduced) plus
  // the admin (always reachable, for Direct Chat to Admin) are visible.
  // Admin themselves is exempt from all of this (handled separately below).
  useEffect(() => listenKnownContacts(me.uid, setKnownContacts), [me.uid]);
  useEffect(() => onValue(ref(db, 'config/adminUid'), s => setAdminUid(s.val())), []);

  // Admin is reachable via its own dedicated "Direct chat with admin" row in
  // Settings (below) -- it is deliberately NOT added to visibleUids, so it
  // never shows up as a regular, unexplained entry in "Your contacts".
  const visibleUids = useMemo(() => {
    const s = new Set(Object.keys(knownContacts));
    s.delete(me.uid);
    return [...s];
  }, [knownContacts, me.uid]);

  // Admin's own profile, fetched separately, only for that Settings row --
  // and only shown once the admin account actually has a completed profile
  // (a name), so a half-registered admin account never appears as a ghost
  // "?" contact anywhere.
  const [adminProfile, setAdminProfile] = useState(null);
  useEffect(() => {
    if (!adminUid || adminUid === me.uid) { setAdminProfile(null); return undefined; }
    return onValue(ref(db, `users/${adminUid}`), s => {
      const val = s.val();
      setAdminProfile(val && val.name ? { uid: adminUid, ...val } : null);
    });
  }, [adminUid, me.uid]);

  useEffect(() => {
    if (profile.role === 'admin') return undefined; // admin uses its own full-list read, below
    const stops = visibleUids.map(uid => onValue(ref(db, `users/${uid}`), s => {
      const val = s.val();
      // Skip accounts that never finished profile setup (no name yet) --
      // otherwise a phone-contact match that signed up but hit "Skip for
      // now" would show up here as a nameless "?" contact.
      const usable = val && val.name;
      setUsers(prev => {
        const rest = prev.filter(u => u.uid !== uid);
        return usable ? [...rest, { uid, ...val }] : rest;
      });
    }));
    return () => stops.forEach(stop => stop && stop());
  }, [visibleUids, profile.role]);

  // Admin keeps seeing literally everyone -- that's the whole point of the
  // disclosed monitoring model, and the rules grant admin unrestricted read
  // of /users specifically for this.
  useEffect(() => {
    if (profile.role !== 'admin') return undefined;
    return onValue(ref(db, 'users'), s => {
      const all = s.val() || {};
      setUsers(Object.entries(all).map(([uid, u]) => ({ uid, ...u })).filter(u => u.uid !== me.uid));
    });
  }, [me.uid, profile.role]);

  // Quiet, background match: phone contacts -> registered numbers -> saved
  // into this user's own knownContacts (see lib/contacts.js), which is what
  // actually makes someone show up above. Runs once per session.
  useEffect(() => {
    matchAndSaveContacts(me.uid).catch(() => {});
  }, [me.uid]);

  // The same search box also doubles as "find someone new": typing a
  // complete-looking exact email or user ID looks them up directly (the
  // only two ways to reach someone who isn't already a phone-contact
  // match). Plain names never do this lookup -- they only filter the list
  // already visible below, on purpose.
  useEffect(() => {
    const q = query.trim();
    setDiscovered(null);
    const looksLikeEmail = q.includes('@') && q.includes('.') && q.length > 5;
    const looksLikeCode = /^[A-Za-z0-9_-]{4,24}$/.test(q) && (/\d/.test(q) || /^SC-/i.test(q)); // old SC-XXXXXX ids or a custom id (letters + digits)
    if (!looksLikeEmail && !looksLikeCode) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setDiscovering(true);
      try {
        const found = looksLikeEmail ? await findByEmail(q) : await findByCode(q);
        if (!cancelled && found && found.uid !== me.uid) setDiscovered(found);
      } catch { /* not found, ignore */ }
      finally { if (!cancelled) setDiscovering(false); }
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, me.uid]);

  async function openDiscovered(found) {
    await addKnownContact(me.uid, found.uid);
    setDiscovered(null);
    setQuery('');
    setChatUser(found);
  }

  useEffect(() => onValue(ref(db, `users/${me.uid}/unread`), s => setUnread(s.val() || {})), [me.uid]);
  useEffect(() => {
    startPresence(me.uid);
    prepareNotifications().then(setNotificationsReady);
    cleanupExpiredStatus(me.uid).catch(() => {});
  }, [me.uid]);
  useEffect(() => {
    let stop;
    listenNotificationActions(action => {
      const extra = action?.notification?.extra || {};
      if (extra?.type === 'message' && extra.senderId) {
        localStorage.setItem('schoolChatPendingChat', extra.senderId);
      }
      if (extra?.type === 'message' && extra.chatId && action.actionId === 'mark-read') {
        clearUnread(me.uid, extra.chatId).catch(() => {});
      }
    }).then(fn => { stop = fn; });
    return () => stop?.();
  }, [me.uid]);

  useEffect(() => {
    const pending = localStorage.getItem('schoolChatPendingChat');
    if (!pending || !users.length) return;
    const found = users.find(u => u.uid === pending);
    if (found) { setChatUser(found); localStorage.removeItem('schoolChatPendingChat'); }
  }, [users]);
  useEffect(() => {
    const stop = onValue(ref(db, `missedCalls/${me.uid}`), snap => {
      const all = snap.val() || {};
      const pending = Object.entries(all).filter(([, item]) => item && !item.notified);
      pending.forEach(([id, item]) => {
        if (!notificationsReady) return;
        showMessageNotification({
          title: t('missedVoiceCall'),
          body: `${item.callerName || t('user')} ${t('calledYou')}`,
          id: Math.abs(Number(String(id).replace(/\D/g, '').slice(-9) || Date.now()) % 2147483647),
          extra: { type: 'missedCall', callerId: item.callerId }
        }).catch(() => {});
        update(ref(db, `missedCalls/${me.uid}/${id}`), { notified: true }).catch(() => {});
      });
    });
    return () => stop?.();
  }, [me.uid, notificationsReady, t]);

  // Who has a live status (green ring). Rules only allow reading statuses/{uid}
  // one user at a time, so listen per user instead of the whole /statuses tree.
  const statusWatchKey = users.map(u => u.uid).sort().join(',');
  useEffect(() => listenActiveStatusOwners([me.uid, ...users.map(u => u.uid)], setStatusUids), [me.uid, statusWatchKey]);

  // One listener per contact does double duty: foreground notifications for
  // incoming messages, and the last-message preview + recency sort in the
  // chat list below. Full closed-app push notifications require FCM/backend.
  useEffect(() => {
    const stops = users.map(user => {
      const chatId = chatIdFor(me.uid, user.uid);
      let first = true;
      return onValue(ref(db, `chats/${chatId}/messages`), snap => {
        const data = snap.val() || {};
        const list = Object.entries(data).map(([id, m]) => ({ id, ...m })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        const latest = list[list.length - 1];
        if (latest && latest.receiverId === me.uid && !latest.seen) {
          const kind = latest.type || (latest.imageUrl ? 'image' : '');
          if (kind === 'image' || kind === 'video') prefetchMedia(latest.fileUrl || latest.imageUrl, kind); // auto-download
        }
        if (latest) {
          setPreviews(prev => ({ ...prev, [chatId]: { text: latest.text, mine: latest.senderId === me.uid, at: latest.createdAt || 0 } }));
        }
        if (!first && latest?.receiverId === me.uid && !latest.seen && notificationsReady && chatUser?.uid !== user.uid) {
          showMessageNotification({ title: user.name, body: latest.text || (latest.type === 'video' ? '🎥 Video' : latest.type === 'file' ? `📎 ${latest.fileName || 'File'}` : '📷 Image'), id: Number(Date.now() % 2147483647), extra: { type: 'message', senderId: user.uid, chatId } });
        }
        first = false;
      });
    });
    return () => stops.forEach(stop => stop && stop());
  }, [users, me.uid, notificationsReady, chatUser?.uid]);

  const filtered = useMemo(() => users
    .filter(u =>
      (u.name || '').toLowerCase().includes(query.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(query.toLowerCase()) ||
      (u.phone || '').includes(query)
    )
    .sort((a, b) => {
      const pa = previews[chatIdFor(me.uid, a.uid)]?.at || 0;
      const pb = previews[chatIdFor(me.uid, b.uid)]?.at || 0;
      if (pa !== pb) return pb - pa;
      return Number(b.online) - Number(a.online) || (a.name || '').localeCompare(b.name || '');
    }),
  [users, query, previews, me.uid]);

  const totalUnread = Object.values(unread).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const adminUser = adminProfile;
  const isAdmin = profile.role === 'admin';

  const callUi = (
    <>
      {voiceCall.callError && (
        <div className="call-error-toast" onClick={() => voiceCall.setCallError('')}>{voiceCall.callError}</div>
      )}
      {voiceCall.incomingCall && (
        <IncomingVoiceCall
          call={voiceCall.incomingCall}
          onAccept={voiceCall.acceptCall}
          onDecline={voiceCall.declineCall}
        />
      )}
      {voiceCall.activeCall && (
        <ActiveVoiceCall
          call={voiceCall.activeCall}
          remoteStream={voiceCall.remoteStream}
          muted={voiceCall.muted}
          onToggleMute={voiceCall.toggleMute}
          onHangUp={voiceCall.hangUp}
        />
      )}
    </>
  );

  if (chatUser) return (<>
    <Chat me={me} user={chatUser} onBack={() => setChatUser(null)} onStartVoiceCall={voiceCall.startCall} callBusy={Boolean(voiceCall.activeCall || voiceCall.incomingCall)} />
    {callUi}
  </>);

  if (isAdmin && view === 'admin') {
    return (
      <div className="screen slide-screen">
        <header className="topbar">
          <button className="icon" onClick={() => setView('chats')}><ArrowLeft /></button>
          <div className="brand-line"><ShieldCheck /><div><b>Admin Dashboard</b><small>{profile.name}</small></div></div>
        </header>
        <main className="content"><AdminPanel users={users} me={me} /></main>
        <AdminTabBar view={view} setView={setView} />
      </div>
    );
  }

  const backgroundStyle = background === 'dots'
    ? { backgroundImage: 'radial-gradient(circle, rgba(100,116,139,.20) 1px, transparent 1.4px)', backgroundSize: '18px 18px' }
    : background === 'grid'
      ? { backgroundImage: 'linear-gradient(rgba(100,116,139,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(100,116,139,.12) 1px, transparent 1px)', backgroundSize: '26px 26px' }
      : background === 'waves'
        ? { backgroundImage: 'radial-gradient(ellipse at 15% 15%, rgba(59,130,246,.10) 0 18%, transparent 19%), radial-gradient(ellipse at 85% 75%, rgba(34,197,94,.08) 0 16%, transparent 17%)' }
        : background === 'diagonal'
          ? { backgroundImage: 'repeating-linear-gradient(135deg, rgba(100,116,139,.10) 0 1px, transparent 1px 18px)' }
          : undefined;

  return (
    <div className={`screen app-background-${background}`} style={backgroundStyle}>
      <header className="topbar">
        <div className="brand-line">
          <Avatar user={profile} size="sm" />
          <div><b>{t('appName')}</b></div>
        </div>
        <button className="icon settings-icon" onClick={() => setSettings(true)}>
          <SettingsIcon />{totalUnread > 0 && <span className="badge">{totalUnread > 99 ? '99+' : totalUnread}</span>}
        </button>
      </header>
      <main className="content">
        <div className="search"><Search size={19} /><input placeholder={t('searchPlaceholder')} value={query} onChange={e => setQuery(e.target.value)} /></div>

        {discovering && <div className="empty small">{t('pleaseWait')}</div>}
        {discovered && (
          <button className="user-row discovered-row" onClick={() => openDiscovered(discovered)}>
            <Avatar user={discovered} />
            <span className="grow user-row-text"><b>{discovered.name}</b><small className="truncate">{t('foundAdded')}</small></span>
          </button>
        )}

        <div className="section-title"><h3>{t('yourContacts')}</h3><span>{users.filter(u => u.online).length} {t('online')}</span></div>
        {filtered.map(u => {
          const subtitle = u.online ? t('online2') : formatLastSeen(u.lastSeen, t, lang);
          return (
            <ContactRow key={u.uid} u={u} subtitle={subtitle} statusUids={statusUids}
              unread={unread[chatIdFor(me.uid, u.uid)]}
              onOpenStatus={() => { setStatusStart(0); setStatusOwner(u); }} onOpenChat={() => setChatUser(u)}
              onLongPress={() => setContactAction(u)}
            />
          );
        })}
        {!filtered.length && <div className="empty"><Users size={38} /><p>{t('noUsersFound')}</p></div>}
      </main>
      {contactAction && (
        <ContactActionSheet
          user={contactAction} me={me}
          onClose={() => setContactAction(null)}
        />
      )}
      {settings && <SettingsDrawer
        me={me} profile={profile} adminUser={adminUser}
        onClose={() => setSettings(false)} onOpenChat={setChatUser}
        onOpenAdmin={() => { setSettings(false); setView('admin'); }}
        onOpenMyStatus={(i = 0) => { setStatusStart(i); setStatusOwner({ ...profile, uid: me.uid }); }}
        onAddStatus={() => setComposing(true)}
        hasMyStatus={statusUids.has(me.uid)}
      />}
      {statusOwner && <StatusViewer key={statusOwner.uid} owner={statusOwner} me={me} startIndex={statusStart} onClose={() => setStatusOwner(null)} />}
      {composing && <StatusComposer me={me} onClose={() => setComposing(false)} />}
      {isAdmin && <AdminTabBar view={view} setView={setView} />}
      {callUi}
    </div>
  );
}

function StatusComposer({ me, onClose }) {
  const { t } = usePrefs();
  const [tab, setTab] = useState('text');
  const [text, setText] = useState('');
  const [bg, setBg] = useState('#0f6fe8');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState(null); // { segments, duration, overlay } from the video editor
  const [videoDur, setVideoDur] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const fileRef = useRef(null);
  const BG_CHOICES = ['#0f6fe8', '#16a34a', '#dc2626', '#7c3aed', '#0f172a', '#ea580c'];
  useBackHandler(editing ? null : onClose);
  useEffect(() => listenStatus(me.uid, list => setActiveCount(list.length)), [me.uid]);
  const limitReached = activeCount >= MAX_ACTIVE_STATUS;

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function clearSelectedFile() {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview('');
    setEdit(null);
    setVideoDur(0);
  }

  function pickFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const isPhoto = tab === 'photo' && f.type.startsWith('image/');
    const isVideo = tab === 'video' && f.type.startsWith('video/');
    if (!isPhoto && !isVideo) { setError(tab === 'photo' ? t('choosePhotoError') : t('chooseVideoError')); return; }
    if (f.size > 15 * 1024 * 1024) { setError('File is larger than 15 MB.'); return; }
    if (preview) URL.revokeObjectURL(preview);
    setError('');
    setEdit(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function publish() {
    setError('');
    if (limitReached) { setError(t('statusLimit')); return; }
    setBusy(true); setPct(0);
    try {
      if (tab === 'text') {
        if (!text.trim()) { setError(t('writeSomethingError')); setBusy(false); return; }
        await postStatus(me.uid, { type: 'text', content: JSON.stringify({ text: text.trim(), bg }) });
      } else {
        if (!file) { setError(tab === 'photo' ? t('choosePhotoError') : t('chooseVideoError')); setBusy(false); return; }
        const statusId = `${Date.now()}`;
        const url = await uploadStatusMedia(me.uid, statusId, file, setPct);
        const extra = tab === 'video' ? { duration: edit?.duration || videoDur, segments: edit?.segments, overlay: edit?.overlay } : {};
        await postStatus(me.uid, { type: tab === 'photo' ? 'image' : 'video', content: url, ...extra });
      }
      onClose();
    } catch (e) {
      console.error('Status publish failed:', e);
      if (e?.code === 'status-limit') setError(t('statusLimit'));
      else setError((e.message || t('statusPostFailed')) + (e?.code ? ` (${e.code})` : ''));
    } finally {
      setBusy(false);
    }
  }

  const overlay = edit?.overlay;
  return (
    <div className="status-composer-overlay" onClick={busy ? undefined : onClose}>
      <div className="status-composer" onClick={e => e.stopPropagation()}>
        <PanelHeader title={t('statusComposerTitle')} onBack={onClose} />
        <div className="composer-tabs">
          <button className={tab === 'text' ? 'active' : ''} disabled={busy} onClick={() => { setTab('text'); clearSelectedFile(); }}><TypeIcon size={16} /> {t('textTab')}</button>
          <button className={tab === 'photo' ? 'active' : ''} disabled={busy} onClick={() => { setTab('photo'); clearSelectedFile(); }}><ImageIcon size={16} /> {t('photoTab')}</button>
          <button className={tab === 'video' ? 'active' : ''} disabled={busy} onClick={() => { setTab('video'); clearSelectedFile(); }}><Video size={16} /> {t('videoTab')}</button>
        </div>

        {tab === 'text' && (
          <div className="status-text-preview" style={{ background: bg }}>
            <textarea value={text} onChange={e => setText(e.target.value)} placeholder={t('writeSomething')} maxLength={200} />
          </div>
        )}
        {tab === 'text' && (
          <div className="bg-choices">
            {BG_CHOICES.map(c => <button key={c} className={bg === c ? 'active' : ''} style={{ background: c }} onClick={() => setBg(c)} />)}
          </div>
        )}

        {tab !== 'text' && (
          <div className="status-media-pick-wrap">
            <button type="button" className="media-pick-box" onClick={() => { if (!busy) fileRef.current?.click(); }}>
              {preview
                ? (tab === 'photo'
                  ? <img src={preview} alt="" />
                  : <video src={`${preview}#t=0.001`} muted playsInline preload="auto" onLoadedMetadata={e => setVideoDur(e.currentTarget.duration || 0)} />)
                : <span>{tab === 'photo' ? t('choosePhoto') : t('chooseVideo')}</span>}
            </button>
            {preview && tab === 'video' && overlay?.text && (
              <div className="status-overlay-text small-preview" style={{ left: `${overlay.x}%`, top: `${overlay.y}%`, color: overlay.color, fontSize: `${(overlay.size || 6) * 0.55}vw` }}>{overlay.text}</div>
            )}
            {preview && !busy && <button type="button" className="icon status-media-clear" onClick={clearSelectedFile} title="Remove"><X size={18} /></button>}
            {preview && tab === 'video' && !busy && (
              <button type="button" className="status-media-edit" onClick={() => setEditing(true)}><Pencil size={15} /> {t('editBtn')}</button>
            )}
            {preview && tab === 'video' && edit && (edit.segments.length > 0 || overlay) && (
              <span className="status-media-badge">✂ {Math.round(edit.duration)}s</span>
            )}
            {busy && (
              <div className="media-upload-overlay">
                <div className="media-spinner big" />
                <b>{Math.round(pct * 100)}%</b>
                <small>{t('uploading')}</small>
              </div>
            )}
          </div>
        )}
        <input ref={fileRef} type="file" hidden accept={tab === 'photo' ? 'image/*' : 'video/*'} onChange={pickFile} />

        {limitReached && <div className="error">{t('statusLimit')}</div>}
        {error && <div className="error">{error}</div>}
        <button className="primary status-publish" onClick={publish} disabled={busy || limitReached}>{busy ? t('publishing') : t('publish')}</button>
      </div>
      {editing && preview && (
        <VideoEditor src={preview} initial={edit} onCancel={() => setEditing(false)} onDone={r => { setEdit(r); setEditing(false); }} />
      )}
    </div>
  );
}

function AdminTabBar({ view, setView }) {
  const { t } = usePrefs();
  return (
    <nav className="tab-bar">
      <button className={view === 'chats' ? 'active' : ''} onClick={() => setView('chats')}><MessagesSquare size={20} /><span>{t('chatsTab')}</span></button>
      <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}><LayoutGrid size={20} /><span>{t('adminTab')}</span></button>
    </nav>
  );
}

function ProfileEditPanel({ me, profile, onClose }) {
  const { t } = usePrefs();
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone || '');
  const [avatar, setAvatar] = useState(profile.avatar || AVATARS[0]);
  const [photoUrl, setPhotoUrl] = useState(profile.photoUrl || '');
  const [userCode, setUserCode] = useState(profile.userCode || '');
  const [idError, setIdError] = useState('');
  const [saving, setSaving] = useState(false);

  const idMessage = problem => t(problem === 'mix' ? 'userIdInvalidMix' : problem === 'length' ? 'userIdInvalidLength' : 'userIdInvalidChars');

  async function save() {
    setIdError('');
    const codeChanged = Boolean(profile.userCode) && userCode.trim().toUpperCase() !== String(profile.userCode).toUpperCase();
    if (codeChanged) {
      // The ID is only saved when it mixes letters AND digits.
      const problem = validateUserId(userCode);
      if (problem) { setIdError(idMessage(problem)); return; }
    }
    setSaving(true);
    try {
      if (codeChanged) await changeUserCode(me.uid, profile.userCode, userCode);
      await updateOwnProfile(me.uid, { name, phone, avatar, photoUrl });
      onClose();
    } catch (e) {
      if (e?.code === 'user-id-taken') setIdError(t('userIdTaken'));
      else if (e?.code === 'user-id-mix') setIdError(idMessage('mix'));
      else if (e?.code === 'user-id-length') setIdError(idMessage('length'));
      else if (e?.code === 'user-id-chars') setIdError(idMessage('chars'));
      else setIdError(e?.message || t('statusPostFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-panel">
      <PhotoPicker photoUrl={photoUrl} onChange={setPhotoUrl} />
      <p className="muted small">{t('chooseAvatar')}</p>
      <AvatarPicker selected={avatar} onSelect={a => { setAvatar(a); setPhotoUrl(''); }} />
      <label>{t('name')}<input value={name} onChange={e => setName(e.target.value)} /></label>
      <label>{t('phone')}<input value={phone} onChange={e => setPhone(e.target.value)} /></label>
      <label>{t('email')} <span className="optional">({t('emailLoginIdHint')})</span><input value={profile.email} readOnly /></label>
      {profile.userCode && (
        <label>{t('yourId')}
          <div className="id-row">
            <input value={userCode} maxLength={20} autoCapitalize="characters" autoCorrect="off" spellCheck={false}
              onChange={e => { setUserCode(e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 20)); setIdError(''); }} />
            <button type="button" className="secondary" onClick={() => navigator.clipboard?.writeText(userCode)}>{t('copy')}</button>
          </div>
        </label>
      )}
      {idError && <div className="error">{idError}</div>}
      {profile.userCode && <p className="muted small">{t('userIdHint')}</p>}
      {profile.userCode && <p className="muted small">{t('shareIdHint')}</p>}
      <div className="step-actions">
        <button className="secondary" onClick={onClose}>{t('back')}</button>
        <button className="primary" onClick={save} disabled={saving}>{saving ? t('saving') : t('save')}</button>
      </div>
    </div>
  );
}

function SettingsDrawer({ me, profile, adminUser, onClose, onOpenChat, onOpenAdmin, onOpenMyStatus, onAddStatus, hasMyStatus, initialPanel }) {
  const { t, lang, setLang, theme, setTheme, background, setBackground } = usePrefs();
  const [panel, setPanel] = useState(initialPanel || 'main');
  const [loggingOut, setLoggingOut] = useState(false);
  const panelRef = useRef(panel);
  useEffect(() => { panelRef.current = panel; }, [panel]);
  const backHandler = useRef(() => {
    if (panelRef.current !== 'main') setPanel('main');
    else onClose();
  }).current;
  useBackHandler(backHandler);

  let panelContent;
  if (panel === 'editProfile') panelContent = <>
    <PanelHeader title={t('editProfile')} onBack={() => setPanel('main')} />
    <ProfileEditPanel me={me} profile={profile} onClose={() => setPanel('main')} />
  </>;
  else if (panel === 'myStatus') panelContent = <>
    <PanelHeader title={t('myStatus')} onBack={() => setPanel('main')} />
    <MyStatusPanel me={me} onView={onOpenMyStatus} onAdd={onAddStatus} />
  </>;
  else if (panel === 'language') panelContent = <>
    <PanelHeader title={t('language')} onBack={() => setPanel('main')} />
    <div className="lang-list">
      {LANGUAGES.map(l => (
        <button key={l.code} className={lang === l.code ? 'active' : ''} onClick={() => { setLang(l.code); setPanel('main'); }}>
          <span>{l.label}</span>{lang === l.code && <Check size={19} />}
        </button>
      ))}
    </div>
  </>;
  else if (panel === 'theme') panelContent = <>
    <PanelHeader title={t('theme')} onBack={() => setPanel('main')} />
    <div className="theme-options">
      <button className={theme === 'light' ? 'active' : ''} onClick={() => { setTheme('light'); setPanel('main'); }}>{t('themeLight')}</button>
      <button className={theme === 'dark' ? 'active' : ''} onClick={() => { setTheme('dark'); setPanel('main'); }}>{t('themeDark')}</button>
      <button className={theme === 'system' ? 'active' : ''} onClick={() => { setTheme('system'); setPanel('main'); }}>{t('themeSystem')}</button>
    </div>
  </>;
  else if (panel === 'background') panelContent = <>
    <PanelHeader title={t('background')} onBack={() => setPanel('main')} />
    <div className="theme-options background-options">{['none','dots','grid','waves','diagonal'].map(x=><button key={x} className={background===x?'active':''} onClick={()=>{setBackground(x);setPanel('main')}}>{x==='none'?t('backgroundNone'):x==='dots'?t('backgroundDots'):x==='grid'?t('backgroundGrid'):x==='waves'?t('backgroundWaves'):t('backgroundDiagonal')}</button>)}</div>
  </>;
  else if (panel === 'privacy') panelContent = <>
    <PanelHeader title={t('privacy')} onBack={() => setPanel('main')} />
    <PrivacyPanel me={me} />
  </>;
  else if (panel === 'applock') panelContent = <>
    <PanelHeader title={t('appLock')} onBack={() => setPanel('main')} />
    <div className="pin-page"><PinPad mode={isPinSet() ? 'change' : 'set'} onSuccess={() => setPanel('main')} onCancel={() => setPanel('main')} /></div>
    {isPinSet() && <button className="link" style={{ margin: '10px auto' }} onClick={() => { clearPin(); setPanel('main'); }}>{t('removeAppLock')}</button>}
  </>;
  else if (panel === 'update') panelContent = <>
    <PanelHeader title={t('update')} onBack={() => setPanel('main')} />
    <div className="update-panel">
      <p>{t('currentVersion')}: <b>v{APP_VERSION}</b></p>
      <p className="muted small">{t('updateHint')}</p>
      <button className="primary" onClick={() => window.open(UPDATE_URL, '_blank')}>{t('checkUpdate')}</button>
    </div>
  </>;
  else if (panel === 'logout') panelContent = <>
    <PanelHeader title={t('logout')} onBack={() => setPanel('main')} />
    <div className="logout-confirm inline-logout">
      <b>{t('logoutConfirmTitle')}</b>
      <div className="step-actions" style={{ width: '100%', maxWidth: 260 }}>
        <button className="secondary" onClick={() => setPanel('main')}>{t('cancel')}</button>
        <button className="primary" disabled={loggingOut} onClick={() => { setLoggingOut(true); logout(); }}>{loggingOut ? t('pleaseWait') : t('logout')}</button>
      </div>
    </div>
  </>;
  else panelContent = <>
    <PanelHeader title={t('settings')} onBack={onClose} />
    <div className="settings-main-content">
      <button className="setting-row" onClick={() => setPanel('editProfile')}><User /> {t('profile')} <span className="row-end">›</span></button>
      <button className="setting-row" onClick={() => setPanel('myStatus')}><ImageIcon /> {t('status')} <span className="row-end status-text">{hasMyStatus ? t('statusSet') : t('statusAdd')}</span></button>
      {adminUser && <button className="setting-row" onClick={() => { onOpenChat(adminUser); onClose(); }}><ShieldCheck /> {t('directChatAdmin')} <span className="row-end">›</span></button>}
      <button className="setting-row" onClick={() => setPanel('language')}><MessagesSquare /> {t('language')} <span className="row-end status-text">{LANGUAGES.find(l => l.code === lang)?.label}</span></button>
      <button className="setting-row" onClick={() => setPanel('theme')}><LayoutGrid /> {t('theme')} <span className="row-end status-text">{theme === 'light' ? t('themeLight') : theme === 'dark' ? t('themeDark') : t('themeSystem')}</span></button>
      <button className="setting-row" onClick={() => setPanel('background')}><LayoutGrid /> {t('background')} <span className="row-end status-text">{background==='none'?t('backgroundNone'):t('backgroundPattern')}</span></button>
      <button className="setting-row" onClick={() => setPanel('privacy')}><Lock /> {t('privacy')} <span className="row-end">›</span></button>
      <button className="setting-row" onClick={() => setPanel('applock')}><ShieldCheck /> {t('appLock')} <span className="row-end status-text">{isPinSet() ? t('on') : t('off')}</span></button>
      <button className="setting-row" onClick={() => setPanel('update')}><RefreshCw /> {t('update')} <span className="row-end status-text">v{APP_VERSION}</span></button>
      {profile.role === 'admin' && <button className="setting-row" onClick={onOpenAdmin}><LayoutGrid /> {t('adminDashboardOpen')} <span className="row-end">›</span></button>}
      <button className="setting-row danger" onClick={() => setPanel('logout')}><LogOut /> {t('logout')}</button>
    </div>
  </>;

  return (
    <div className="overlay settings-overlay" onClick={onClose}>
      <aside className="drawer settings-drawer" onClick={e => e.stopPropagation()}>
        <div key={panel} className="settings-panel-view">{panelContent}</div>
      </aside>
    </div>
  );
}

function AdminPanel({ users, me }) {
  const { t, lang } = usePrefs();
  const [selectedChat, setSelectedChat] = useState(null);
  const [logs, setLogs] = useState([]);
  const [mirrors, setMirrors] = useState({});
  const [query, setQuery] = useState('');
  const [removing, setRemoving] = useState(null);
  const [, forceTick] = useState(0);

  useBackHandler(removing ? () => setRemoving(null) : (selectedChat ? () => setSelectedChat(null) : null));

  useEffect(() => onValue(ref(db, 'adminMirror'), s => setMirrors(s.val() || {})), []);
  useEffect(() => {
    if (!selectedChat) { setLogs([]); return undefined; }
    return onValue(ref(db, `adminMirror/${selectedChat}/messages`), s => {
      const d = s.val() || {};
      setLogs(Object.entries(d).map(([id, m]) => ({ id, ...m })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
    });
  }, [selectedChat]);
  // Re-render every 30s so "active right now" and last-seen labels stay fresh
  // without needing a page reload.
  useEffect(() => { const t = setInterval(() => forceTick(x => x + 1), 30000); return () => clearInterval(t); }, []);

  function confirmRemove(u) { setRemoving(u); }
  async function doRemove() {
    if (!removing) return;
    await removeUser(removing.uid).catch(() => {});
    setRemoving(null);
  }

  const ACTIVE_WINDOW = 3 * 60 * 1000; // "chatting right now" = a message in the last 3 minutes
  const now = Date.now();
  const mirroredChats = Object.keys(mirrors).sort((a, b) => (mirrors[b]?.lastMessageAt || 0) - (mirrors[a]?.lastMessageAt || 0));
  const activeChatsNow = mirroredChats.filter(id => now - (mirrors[id]?.lastMessageAt || 0) < ACTIVE_WINDOW).length;
  const onlineNow = users.filter(u => u.online).length;

  const q = query.trim().toLowerCase();
  const chatLabel = (chatId) => chatId.split('_').map(uid => uid === me.uid ? t('you') : users.find(u => u.uid === uid)?.name || t('user')).join(' ↔ ');
  const filteredUsers = q ? users.filter(u => (u.name || '').toLowerCase().includes(q) || (u.phone || '').includes(q) || (u.email || '').toLowerCase().includes(q)) : users;
  const filteredChats = q ? mirroredChats.filter(id => chatLabel(id).toLowerCase().includes(q) || (mirrors[id]?.lastMessage || '').toLowerCase().includes(q)) : mirroredChats;

  if (selectedChat) {
    return (
      <div className="screen slide-screen">
        <header className="topbar">
          <button className="icon" onClick={() => setSelectedChat(null)}><ArrowLeft /></button>
          <b className="grow">{chatLabel(selectedChat)}</b>
        </header>
        <div className="content admin-transcript">
          {logs.length
            ? logs.map(m => <div className="log" key={m.id}><b>{m.senderId === me.uid ? t('you') : users.find(u => u.uid === m.senderId)?.name || t('user')}</b>: {m.text || (m.type === 'video' ? '🎥 Video' : m.type === 'file' ? `📎 ${m.fileName || 'File'}` : (m.imageUrl || m.fileUrl ? '📷 Image' : ''))}</div>)
            : <small>{t('noMessagesYet')}</small>}
        </div>
      </div>
    );
  }

  return <div className="admin">
    <div className="admin-title"><ShieldCheck size={18} /><h3>{t('adminControls')}</h3></div>

    <div className="admin-stats">
      <div><b>{users.length}</b><small>{t('totalMembers')}</small></div>
      <div><b className="on">{onlineNow}</b><small>{t('onlineNowLabel')}</small></div>
      <div><b>{mirroredChats.length}</b><small>{t('totalChats')}</small></div>
      <div><b className={activeChatsNow ? 'on' : ''}>{activeChatsNow}</b><small>{t('activeNowLabel')}</small></div>
    </div>

    <div className="search monitor-search"><Search size={17} /><input placeholder={t('monitorSearchPlaceholder')} value={query} onChange={e => setQuery(e.target.value)} /></div>

    <h4>{t('allMembers')}</h4>
    {filteredUsers.map(u => (
      <div className="monitor-row static" key={u.uid}>
        <Avatar user={u} size="sm" />
        <span className="grow"><b>{u.name}{u.role === 'admin' ? ' 👑' : ''}</b><small>{u.phone || u.email}</small></span>
        <span className={`presence-label ${u.online ? 'on' : ''}`}>{u.online ? t('online2') : formatLastSeen(u.lastSeen, t, lang)}</span>
        {u.role !== 'admin' && <button className="remove-btn" onClick={() => confirmRemove(u)}>{t('remove2')}</button>}
      </div>
    ))}
    {!filteredUsers.length && <small>{t('noMembersFound')}</small>}
    {removing && <div className="msg-actions" onClick={() => setRemoving(null)}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <p style={{ padding: '4px 20px 10px' }}>{removing.name}{t('removeConfirmPart1')}</p>
        <button className="danger" onClick={doRemove}>{t('yesRemove')}</button>
        <button className="cancel" onClick={() => setRemoving(null)}>{t('cancel')}</button>
      </div>
    </div>}

    <h4>{t('allRecordedChats')}</h4>
    {filteredChats.map(chatId => {
      const parts = chatId.split('_');
      const chatUsers = parts.map(uid => uid === me.uid ? { uid, name: t('you') } : users.find(u => u.uid === uid) || { uid, name: t('user') });
      const isActive = now - (mirrors[chatId]?.lastMessageAt || 0) < ACTIVE_WINDOW;
      return <button className="monitor-row" key={chatId} onClick={() => setSelectedChat(chatId)}>
        <Avatar user={chatUsers[0]} size="sm" />
        <span className="grow"><b>{chatUsers.map(u => u.name).join(' ↔ ')}{isActive && <span className="live-dot" title={t('activeRightNow')} />}</b><small>{mirrors[chatId]?.lastMessage || t('noMessage')}</small></span>
        <small className="mono-time">{mirrors[chatId]?.lastMessageAt ? formatLastSeen(mirrors[chatId].lastMessageAt, t, lang) : ''}</small>
      </button>;
    })}
    {!filteredChats.length && <small>{q ? t('noChatsFoundSearch') : t('noChatsRecorded')}</small>}
  </div>;
}

export default function App() {
  const { t } = usePrefs();
  const [slowHint, setSlowHint] = useState(false);
  const [me, setMe] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bannedMsg, setBannedMsg] = useState('');
  const [exitToast, setExitToast] = useState(false);
  const isWaiting = loading || (me && !profileLoaded);

  useEffect(() => {
    if (!isWaiting) { setSlowHint(false); return undefined; }
    const timer = setTimeout(() => setSlowHint(true), 3500);
    return () => clearTimeout(timer);
  }, [isWaiting]);

  useEffect(() => {
    initNativeBack();
    setExitWarningHandler(() => {
      setExitToast(true);
      setTimeout(() => setExitToast(false), 2000);
    });
  }, []);

  useEffect(() => {
    if (!auth) { setLoading(false); return undefined; }
    let unsub;
    let settled = false;
    // Wait for Firebase Auth to finish restoring any persisted session
    // before rendering anything auth-dependent -- but only for a bounded
    // time. A previous version awaited authStateReady() with no timeout,
    // which is normally fast but could hang the splash screen indefinitely
    // if restoration was ever slow (poor network while it tries to refresh
    // the token). This caps the wait and falls back to attaching the
    // listener directly if it takes too long, so the app never appears
    // stuck open indefinitely.
    const likelyLoggedIn = localStorage.getItem('schoolChatVerified') === '1';
    const readyTimeout = setTimeout(attach, likelyLoggedIn ? 2000 : 200);

    function attach() {
      if (settled) return;
      settled = true;
      unsub = onAuthStateChanged(auth, user => {
        setMe(user);
        if (user) {
          setProfileLoaded(false);
          onValue(ref(db, `users/${user.uid}`), s => { setProfile(s.val()); setProfileLoaded(true); });
          // The ban check is a network round-trip (get(), not a cached
          // listener) -- awaiting it here used to block the very first
          // render on every cold start, and on a slow/still-connecting
          // network that could take many seconds. That was the real cause
          // of the app intermittently taking 10-20s to open. It now runs
          // in the background instead: the app renders immediately, and a
          // banned person is signed back out the moment this resolves,
          // rather than everyone waiting on it every single time.
          isBanned(user.uid).then(banned => {
            if (banned) {
              logout().catch(() => {});
              setBannedMsg(t('bannedMessage'));
              setMe(null); setProfile(null); setProfileLoaded(true);
            }
          }).catch(() => {});
        } else {
          setProfile(null);
          setProfileLoaded(true);
        }
        setLoading(false);
      });
    }

    auth.authStateReady().then(() => { clearTimeout(readyTimeout); attach(); });
    return () => { clearTimeout(readyTimeout); unsub && unsub(); };
  }, []);

  let content;
  if (firebaseInitError) {
    content = (
      <div className="splash config-error">
        <img src="/school-chat-icon.png" alt={t('appName')} />
        <span>{t('setupIncomplete')}</span>
        <p>{firebaseInitError}</p>
      </div>
    );
  } else if (loading) {
    content = <div className="splash"><img src="/school-chat-icon.png" alt={t('appName')} /><span>{t('appName')}</span>{slowHint && <small className="slow-hint">{t('slowConnection')}</small>}</div>;
  } else if (!me) {
    content = <AuthScreen bannedMsg={bannedMsg} />;
  } else if (!profileLoaded) {
    // We know who's signed in but haven't heard back from the database yet
    // -- keep showing the splash rather than guessing "no profile" and
    // flashing the phone-number step of registration at an already fully
    // registered person (that flash was the "asking for a number, then
    // auto-continuing" glitch).
    content = <div className="splash"><img src="/school-chat-icon.png" alt={t('appName')} /><span>{t('appName')}</span>{slowHint && <small className="slow-hint">{t('slowConnection')}</small>}</div>;
  } else if (!profile) {
    content = <CompleteProfileScreen me={me} />;
  } else {
    content = <LockGate><AppShell me={me} profile={profile} /></LockGate>;
  }

  return (
    <>
      {content}
      {exitToast && <div className="toast-exit">{t('pressAgainExit')}</div>}
    </>
  );
}

function LockGate({ children }) {
  const [unlocked, setUnlocked] = useState(!isPinSet());
  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;
  return children;
}
