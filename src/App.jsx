import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';
import {
  ArrowLeft, MessageCircle, Search, Send,
  ShieldCheck, Users, Wifi, X, LayoutGrid, MessagesSquare,
  Settings as SettingsIcon, Copy, Share2, Video, Image as ImageIcon, Type as TypeIcon
} from 'lucide-react';
import { auth, db, firebaseInitError } from './firebase';
import { beginRegistration, completeRegistration, login, logout, isBanned, updateOwnProfile } from './lib/auth';
import {
  chatIdFor, clearUnread, listenMessages, markDelivered, markSeen, sendMessage,
  deleteMessageForMe, deleteMessageForEveryone, listenHidden, DELETE_WINDOW_MS
} from './lib/chat';
import { getPhoneContacts } from './lib/contacts';
import { removeUser } from './lib/admin';
import { listenTyping, setTyping, startPresence } from './lib/presence';
import { prepareNotifications, showMessageNotification } from './lib/notifications';
import { Avatar, AvatarPicker, PhotoPicker, AVATARS } from './components/Profile';
import { isPinSet, LockScreen, PinPad, clearPin } from './components/AppLock';
import { usePrefs } from './context/Prefs';
import { StatusViewer } from './components/StatusViewer';
import { postStatus, cleanupExpiredStatus } from './lib/status';
import { uploadStatusMedia } from './lib/media';
import { useBackHandler } from './lib/backStack';
import { initNativeBack, setExitWarningHandler } from './lib/nativeBack';

function formatLastSeen(ts) {
  if (!ts) return 'अंतिम बार उपलब्ध नहीं';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return 'अंतिम बार उपलब्ध नहीं';
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'अभी-अभी ऑनलाइन था';
  return `अंतिम बार ${date.toLocaleString('hi-IN', { dateStyle: 'short', timeStyle: 'short' })}`;
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
function ProfileSteps({ identity, onDone }) {
  const [step, setStep] = useState(2);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [photoUrl, setPhotoUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function finish(e) {
    e.preventDefault();
    if (!name.trim()) { setError('अपना वास्तविक नाम भरें।'); return; }
    setError(''); setBusy(true);
    try {
      await completeRegistration({ uid: identity.uid, email: identity.email, name, phone, avatar, photoUrl });
      // Ask for the contacts permission right away and match quietly in the
      // background — nothing about this is shown; it just means friends who
      // are already in the app show up naturally once matched.
      getPhoneContacts().catch(() => {});
      onDone?.();
    } catch (e) {
      setError(e.message || 'प्रोफ़ाइल सेव नहीं हुई।');
    } finally {
      setBusy(false);
    }
  }

  if (step === 2) {
    return (
      <section className="card auth-card">
        <StepDots step={2} />
        <h1>मोबाइल नंबर</h1>
        <p className="muted">दोस्तों के फ़ोन कॉन्टैक्ट से आपको जल्दी ढूंढने में मदद करता है — चाहें तो छोड़ सकते हैं।</p>
        <label>मोबाइल नंबर <span className="optional">(वैकल्पिक)</span><input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" autoFocus /></label>
        <button className="primary" onClick={() => setStep(3)}>आगे बढ़ें</button>
      </section>
    );
  }

  return (
    <section className="card auth-card">
      <StepDots step={3} />
      <h1>अपनी प्रोफ़ाइल बनाएं</h1>
      <form onSubmit={finish}>
        <label>वास्तविक नाम<input value={name} onChange={e => setName(e.target.value)} required autoFocus /></label>
        <p className="muted small">प्रोफ़ाइल फ़ोटो <span className="optional">(वैकल्पिक)</span></p>
        <PhotoPicker photoUrl={photoUrl} onChange={setPhotoUrl} />
        <p className="muted small">या एक अवतार चुनें</p>
        <AvatarPicker selected={avatar} onSelect={setAvatar} />
        {error && <div className="error">{error}</div>}
        <div className="step-actions">
          <button type="button" className="secondary" onClick={() => setStep(2)}>वापस</button>
          <button className="primary" disabled={busy}>{busy ? 'सेव हो रहा है…' : 'शुरू करें'}</button>
        </div>
      </form>
    </section>
  );
}

// Step 1: code + credentials. Resolves invite/admin code and creates the
// Firebase Auth account, then hands off to ProfileSteps.
function RegisterWizard() {
  const [identity, setIdentity] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (identity) return <ProfileSteps identity={identity} />;

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const result = await beginRegistration(email, password);
      setIdentity(result);
    } catch (e) {
      setError(e.message || 'प्रक्रिया पूरी नहीं हुई।');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card auth-card">
      <img className="brand-image" src="/school-chat-icon.png" alt="School Chat" />
      <h1>School Chat</h1>
      <StepDots step={1} />
      <p className="disclosure">
        यह ऐप एडमिन-मॉनिटर्ड है: इस ऐप में होने वाली सभी चैट — आपकी एडमिन से बातचीत और आपस में दो दोस्तों की चैट भी — एडमिन को दिखती हैं। खाता बनाकर आप इससे सहमत हैं।
      </p>
      <form onSubmit={submit}>
        <label>ईमेल<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>पासवर्ड<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength="6" required /></label>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? 'कृपया प्रतीक्षा करें…' : 'आगे बढ़ें'}</button>
      </form>
    </section>
  );
}

function LoginForm({ onSwitch }) {
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
      setError(e.message || 'प्रक्रिया पूरी नहीं हुई।');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card auth-card">
      <img className="brand-image" src="/school-chat-icon.png" alt="School Chat" />
      <h1>School Chat</h1>
      <p className="muted">अपने समूह से जुड़े रहें</p>
      <form onSubmit={submit}>
        <label>ईमेल<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>पासवर्ड<input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? 'कृपया प्रतीक्षा करें…' : 'प्रवेश करें'}</button>
      </form>
      <button className="link" onClick={onSwitch}>नया खाता बनाएँ</button>
    </section>
  );
}

function AuthScreen({ bannedMsg }) {
  const [mode, setMode] = useState('login');
  return (
    <main className="auth">
      {bannedMsg && <div className="error banned-banner">{bannedMsg}</div>}
      {mode === 'register'
        ? <RegisterWizard />
        : <LoginForm onSwitch={() => setMode('register')} />}
      {mode === 'login' && <button className="link outside" onClick={() => setMode('register')}>पहले से खाता नहीं है? नया खाता बनाएँ</button>}
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

function MessageBubble({ me, message, onSeen, onLongPress }) {
  const mine = message.senderId === me.uid;
  const pressTimer = useRef(null);
  function start() { pressTimer.current = setTimeout(() => onLongPress(message), 550); }
  function stop() { clearTimeout(pressTimer.current); }
  return (
    <div
      className={`bubble ${mine ? 'mine' : 'theirs'}`}
      onClick={() => !mine && onSeen(message.id)}
      onPointerDown={start} onPointerUp={stop} onPointerLeave={stop}
      onContextMenu={e => { e.preventDefault(); onLongPress(message); }}
    >
      <div>{message.text}</div>
      <div className="message-meta">
        <span>{message.createdAt ? new Date(message.createdAt).toLocaleTimeString('hi-IN', { hour: '2-digit', minute: '2-digit' }) : '…'}</span>
        {mine && <span className={`ticks ${message.seen ? 'seen' : ''}`}>{message.delivered ? '✓✓' : '✓'}</span>}
      </div>
    </div>
  );
}

function MessageActionSheet({ message, me, chatId, onClose }) {
  useBackHandler(onClose);
  const mine = message.senderId === me.uid;
  const withinWindow = mine && message.createdAt && (Date.now() - message.createdAt < DELETE_WINDOW_MS);
  const [copied, setCopied] = useState(false);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      setTimeout(onClose, 500);
    } catch {
      setCopied(false);
    }
  }

  async function shareText() {
    if (navigator.share) {
      try { await navigator.share({ text: message.text }); } catch { /* user cancelled */ }
      onClose();
    } else {
      copyText();
    }
  }

  return (
    <div className="msg-actions" onClick={onClose}>
      <div className="sheet slide-up" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <button onClick={copyText}><Copy size={18} /> {copied ? 'कॉपी हो गया' : 'कॉपी करें'}</button>
        <button onClick={shareText}><Share2 size={18} /> शेयर करें</button>
        <button onClick={async () => { await deleteMessageForMe(me.uid, chatId, message.id); onClose(); }}><X size={18} /> मेरे लिए हटाएं</button>
        {withinWindow && <button className="danger" onClick={async () => { await deleteMessageForEveryone(chatId, message.id); onClose(); }}><X size={18} /> सबके लिए हटाएं</button>}
        <button className="cancel" onClick={onClose}>रद्द करें</button>
      </div>
    </div>
  );
}

function Chat({ me, user, onBack }) {
  useBackHandler(onBack);
  const chatId = chatIdFor(me.uid, user.uid);
  const [messages, setMessages] = useState([]);
  const [hidden, setHidden] = useState({});
  const [text, setText] = useState('');
  const [typingUsers, setTypingUsers] = useState({});
  const [sending, setSending] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimer = useRef(null);
  const typingActive = useRef(false);

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

  async function submit(e) {
    e.preventDefault();
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setText('');
    clearTimeout(typingTimer.current);
    typingActive.current = false;
    await setTyping(chatId, me.uid, false).catch(() => {});
    try {
      await sendMessage(chatId, me.uid, user.uid, value);
    } finally {
      setSending(false);
      // Keep the keyboard open for the next message instead of it dropping
      // away after every send.
      inputRef.current?.focus();
    }
  }

  const otherTyping = Boolean(typingUsers[user.uid]);
  return (
    <div className="screen chat-screen">
      <header className="topbar">
        <button className="icon" onClick={onBack}><ArrowLeft /></button>
        <Avatar user={user} size="sm" />
        <div className="chat-title">
          <b>{user.name}</b>
          <small>{user.online ? 'ऑनलाइन' : formatLastSeen(user.lastSeen)}</small>
          {otherTyping && <span className="typing-label">टाइप कर रहा है…</span>}
        </div>
        <div className="online-dot" title={user.online ? 'ऑनलाइन' : 'ऑफलाइन'} />
      </header>
      <div className="messages" ref={listRef}>
        {messages.filter(m => !hidden[m.id]).map(m => <MessageBubble key={m.id} me={me} message={m} onSeen={id => markSeen(chatId, id).catch(() => {})} onLongPress={setActionMsg} />)}
        {otherTyping && <div className="typing-bubble"><span></span><span></span><span></span></div>}
      </div>
      <form className="composer" onSubmit={submit}>
        <input ref={inputRef} value={text} onChange={e => handleTyping(e.target.value)} placeholder="संदेश लिखें…" />
        <button className="send" disabled={sending} onMouseDown={e => e.preventDefault()}><Send size={20} /></button>
      </form>
      {actionMsg && <MessageActionSheet message={actionMsg} me={me} chatId={chatId} onClose={() => setActionMsg(null)} />}
    </div>
  );
}

function AppShell({ me, profile }) {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const [chatUser, setChatUser] = useState(null);
  const [settings, setSettings] = useState(false);
  const [unread, setUnread] = useState({});
  const [previews, setPreviews] = useState({});
  const [notificationsReady, setNotificationsReady] = useState(false);
  const [view, setView] = useState('chats'); // 'chats' | 'admin' — admin gets its own tab, not just a settings sub-panel
  useBackHandler(view === 'admin' ? () => setView('chats') : null);
  const [statusUids, setStatusUids] = useState(new Set());
  const [statusOwner, setStatusOwner] = useState(null); // whose status is being viewed
  const [composing, setComposing] = useState(false);

  useEffect(() => onValue(ref(db, 'users'), s => {
    const all = s.val() || {};
    setUsers(Object.entries(all).map(([uid, u]) => ({ uid, ...u })).filter(u => u.uid !== me.uid));
  }), [me.uid]);

  useEffect(() => onValue(ref(db, `users/${me.uid}/unread`), s => setUnread(s.val() || {})), [me.uid]);
  useEffect(() => {
    startPresence(me.uid);
    prepareNotifications().then(setNotificationsReady);
    cleanupExpiredStatus(me.uid).catch(() => {});
  }, [me.uid]);

  useEffect(() => onValue(ref(db, 'statuses'), snap => {
    const all = snap.val() || {};
    const now = Date.now();
    const withActive = new Set();
    Object.entries(all).forEach(([uid, list]) => {
      if (Object.values(list || {}).some(s => s.expiresAt > now)) withActive.add(uid);
    });
    setStatusUids(withActive);
  }), []);

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
        if (latest) {
          setPreviews(prev => ({ ...prev, [chatId]: { text: latest.text, mine: latest.senderId === me.uid, at: latest.createdAt || 0 } }));
        }
        if (!first && latest?.receiverId === me.uid && !latest.seen && notificationsReady && chatUser?.uid !== user.uid) {
          showMessageNotification({ title: user.name, body: latest.text, id: Number(Date.now() % 2147483647) });
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
  const adminUser = users.find(u => u.role === 'admin');
  const isAdmin = profile.role === 'admin';

  if (chatUser) return <Chat me={me} user={chatUser} onBack={() => setChatUser(null)} />;

  if (isAdmin && view === 'admin') {
    return (
      <div className="screen">
        <header className="topbar">
          <div className="brand-line"><ShieldCheck /><div><b>Admin Dashboard</b><small>{profile.name}</small></div></div>
        </header>
        <main className="content"><AdminPanel users={users} me={me} /></main>
        <AdminTabBar view={view} setView={setView} />
      </div>
    );
  }

  return (
    <div className="screen">
      <header className="topbar">
        <div className="brand-line">
          <img src="/school-chat-icon.png" alt="" />
          <div><b>School Chat</b><small>नमस्ते, {profile.name}</small></div>
        </div>
        <button className="icon settings-icon" onClick={() => setSettings(true)}>
          <SettingsIcon />{totalUnread > 0 && <span className="badge">{totalUnread > 99 ? '99+' : totalUnread}</span>}
        </button>
      </header>
      <main className="content">
        <div className="search"><Search size={19} /><input placeholder="नाम, ईमेल या नंबर खोजें" value={query} onChange={e => setQuery(e.target.value)} /></div>

        <div className="status-row">
          <button
            className={`status-avatar-btn ${statusUids.has(me.uid) ? 'has-status' : ''}`}
            onClick={() => statusUids.has(me.uid) ? setStatusOwner(profile) : setComposing(true)}
          >
            <Avatar user={profile} size="md" />
            {!statusUids.has(me.uid) && <span className="status-plus">+</span>}
          </button>
          <button className="grow status-row-text" onClick={() => statusUids.has(me.uid) ? setStatusOwner(profile) : setComposing(true)}>
            <b>आपका स्टेटस</b><small>{statusUids.has(me.uid) ? 'देखने के लिए टैप करें' : 'स्टेटस जोड़ने के लिए टैप करें'}</small>
          </button>
        </div>

        <div className="section-title"><h3>आपके संपर्क</h3><span><Wifi size={14} /> {users.filter(u => u.online).length} ऑनलाइन</span></div>
        {filtered.map(u => {
          const preview = previews[chatIdFor(me.uid, u.uid)];
          const subtitle = preview ? `${preview.mine ? 'आप: ' : ''}${preview.text}` : (u.online ? 'ऑनलाइन' : formatLastSeen(u.lastSeen));
          return (
            <div className="user-row" key={u.uid}>
              <button className={`avatar-wrap ${statusUids.has(u.uid) ? 'has-status' : ''}`} onClick={() => setStatusOwner(u)}>
                <Avatar user={u} /> {u.online && <span className="presence-dot" />}
              </button>
              <button className="grow user-row-text" onClick={() => setChatUser(u)}>
                <b>{u.name}</b><small className="truncate">{subtitle}</small>
              </button>
              {unread[chatIdFor(me.uid, u.uid)] > 0 && <span className="row-unread">{unread[chatIdFor(me.uid, u.uid)]}</span>}
              <button className="icon" onClick={() => setChatUser(u)}><MessageCircle size={20} /></button>
            </div>
          );
        })}
        {!filtered.length && <div className="empty"><Users size={38} /><p>कोई उपयोगकर्ता नहीं मिला।</p></div>}
      </main>
      {settings && <SettingsDrawer
        me={me} profile={profile} adminUser={adminUser}
        onClose={() => setSettings(false)} onOpenChat={setChatUser}
        onOpenAdmin={() => { setSettings(false); setView('admin'); }}
      />}
      {statusOwner && <StatusViewer owner={statusOwner} me={me} onClose={() => setStatusOwner(null)} />}
      {composing && <StatusComposer me={me} onClose={() => setComposing(false)} />}
      {isAdmin && <AdminTabBar view={view} setView={setView} />}
    </div>
  );
}

function StatusComposer({ me, onClose }) {
  useBackHandler(onClose);
  const [tab, setTab] = useState('text');
  const [text, setText] = useState('');
  const [bg, setBg] = useState('#0f6fe8');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const BG_CHOICES = ['#0f6fe8', '#16a34a', '#dc2626', '#7c3aed', '#0f172a', '#ea580c'];

  function pickFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function publish() {
    setError(''); setBusy(true);
    try {
      if (tab === 'text') {
        if (!text.trim()) { setError('कुछ लिखें।'); setBusy(false); return; }
        await postStatus(me.uid, { type: 'text', content: JSON.stringify({ text: text.trim(), bg }) });
      } else {
        if (!file) { setError(tab === 'photo' ? 'एक फ़ोटो चुनें।' : 'एक वीडियो चुनें।'); setBusy(false); return; }
        const statusId = `${Date.now()}`;
        const url = await uploadStatusMedia(me.uid, statusId, file);
        await postStatus(me.uid, { type: tab === 'photo' ? 'image' : 'video', content: url });
      }
      onClose();
    } catch (e) {
      setError(e.message || 'स्टेटस पोस्ट नहीं हो सका।');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="status-composer-overlay" onClick={onClose}>
      <div className="status-composer" onClick={e => e.stopPropagation()}>
        <div className="drawer-head"><b>स्टेटस लगाएं</b><button className="icon" onClick={onClose}><X /></button></div>
        <div className="composer-tabs">
          <button className={tab === 'text' ? 'active' : ''} onClick={() => { setTab('text'); setFile(null); setPreview(''); }}><TypeIcon size={16} /> टेक्स्ट</button>
          <button className={tab === 'photo' ? 'active' : ''} onClick={() => setTab('photo')}><ImageIcon size={16} /> फ़ोटो</button>
          <button className={tab === 'video' ? 'active' : ''} onClick={() => setTab('video')}><Video size={16} /> वीडियो</button>
        </div>

        {tab === 'text' && (
          <div className="status-text-preview" style={{ background: bg }}>
            <textarea value={text} onChange={e => setText(e.target.value)} placeholder="कुछ लिखें…" maxLength={200} />
          </div>
        )}
        {tab === 'text' && (
          <div className="bg-choices">
            {BG_CHOICES.map(c => <button key={c} className={bg === c ? 'active' : ''} style={{ background: c }} onClick={() => setBg(c)} />)}
          </div>
        )}

        {tab !== 'text' && (
          <button type="button" className="media-pick-box" onClick={() => fileRef.current?.click()}>
            {preview
              ? (tab === 'photo' ? <img src={preview} alt="" /> : <video src={preview} muted playsInline />)
              : <span>{tab === 'photo' ? 'फ़ोटो चुनें' : 'वीडियो चुनें (अधिकतम 15MB)'}</span>}
          </button>
        )}
        <input ref={fileRef} type="file" hidden accept={tab === 'photo' ? 'image/*' : 'video/*'} onChange={pickFile} />

        {error && <div className="error">{error}</div>}
        <button className="primary status-publish" onClick={publish} disabled={busy}>{busy ? 'पोस्ट हो रहा है…' : 'स्टेटस पोस्ट करें'}</button>
      </div>
    </div>
  );
}

function AdminTabBar({ view, setView }) {
  return (
    <nav className="tab-bar">
      <button className={view === 'chats' ? 'active' : ''} onClick={() => setView('chats')}><MessagesSquare size={20} /><span>चैट</span></button>
      <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}><LayoutGrid size={20} /><span>एडमिन</span></button>
    </nav>
  );
}

function ProfileEditPanel({ me, profile, onClose }) {
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone || '');
  const [avatar, setAvatar] = useState(profile.avatar || AVATARS[0]);
  const [photoUrl, setPhotoUrl] = useState(profile.photoUrl || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await updateOwnProfile(me.uid, { name, phone, avatar, photoUrl });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-panel">
      <PhotoPicker photoUrl={photoUrl} onChange={setPhotoUrl} />
      <p className="muted small">या एक अवतार चुनें</p>
      <AvatarPicker selected={avatar} onSelect={a => { setAvatar(a); setPhotoUrl(''); }} />
      <label>नाम<input value={name} onChange={e => setName(e.target.value)} /></label>
      <label>मोबाइल नंबर<input value={phone} onChange={e => setPhone(e.target.value)} /></label>
      <label>ईमेल <span className="optional">(लॉगिन आईडी, बदला नहीं जा सकता)</span><input value={profile.email} readOnly /></label>
      <div className="step-actions">
        <button className="secondary" onClick={onClose}>वापस</button>
        <button className="primary" onClick={save} disabled={saving}>{saving ? 'सेव हो रहा है…' : 'सेव करें'}</button>
      </div>
    </div>
  );
}

function SettingsDrawer({ me, profile, adminUser, onClose, onOpenChat, onOpenAdmin }) {
  const { t, lang, setLang, theme, setTheme } = usePrefs();
  const [panel, setPanel] = useState('main');
  const panelRef = useRef(panel);
  useEffect(() => { panelRef.current = panel; }, [panel]);
  const backHandler = useRef(() => {
    if (panelRef.current !== 'main') setPanel('main');
    else onClose();
  }).current;
  useBackHandler(backHandler);

  if (panel === 'editProfile') return <div className="overlay" onClick={onClose}><aside className="drawer" onClick={e => e.stopPropagation()}>
    <div className="drawer-head"><b>प्रोफ़ाइल एडिट करें</b><button className="icon" onClick={() => setPanel('main')}><ArrowLeft /></button></div>
    <ProfileEditPanel me={me} profile={profile} onClose={() => setPanel('main')} />
  </aside></div>;

  if (panel === 'language') return <div className="overlay" onClick={onClose}><aside className="drawer" onClick={e => e.stopPropagation()}>
    <div className="drawer-head"><b>{t('language')}</b><button className="icon" onClick={() => setPanel('main')}><ArrowLeft /></button></div>
    <div className="lang-options">
      <button className={lang === 'hi' ? 'active' : ''} onClick={() => { setLang('hi'); setPanel('main'); }}>{t('langHindi')}</button>
      <button className={lang === 'en' ? 'active' : ''} onClick={() => { setLang('en'); setPanel('main'); }}>{t('langEnglish')}</button>
    </div>
  </aside></div>;

  if (panel === 'theme') return <div className="overlay" onClick={onClose}><aside className="drawer" onClick={e => e.stopPropagation()}>
    <div className="drawer-head"><b>{t('theme')}</b><button className="icon" onClick={() => setPanel('main')}><ArrowLeft /></button></div>
    <div className="theme-options">
      <button className={theme === 'light' ? 'active' : ''} onClick={() => { setTheme('light'); setPanel('main'); }}>{t('themeLight')}</button>
      <button className={theme === 'dark' ? 'active' : ''} onClick={() => { setTheme('dark'); setPanel('main'); }}>{t('themeDark')}</button>
      <button className={theme === 'system' ? 'active' : ''} onClick={() => { setTheme('system'); setPanel('main'); }}>{t('themeSystem')}</button>
    </div>
  </aside></div>;

  if (panel === 'applock') return <div className="overlay" onClick={onClose}><aside className="drawer" onClick={e => e.stopPropagation()}>
    <div className="drawer-head"><b>{t('appLock')}</b><button className="icon" onClick={() => setPanel('main')}><ArrowLeft /></button></div>
    <PinPad mode={isPinSet() ? 'change' : 'set'} onSuccess={() => setPanel('main')} onCancel={() => setPanel('main')} />
    {isPinSet() && <button className="link" style={{ margin: '10px auto' }} onClick={() => { clearPin(); setPanel('main'); }}>ऐप लॉक हटाएं</button>}
  </aside></div>;

  if (panel === 'logout') return <div className="overlay" onClick={onClose}><div className="logout-confirm" onClick={e => e.stopPropagation()}>
    <b>{t('logoutConfirmTitle')}</b>
    <div className="step-actions" style={{ width: '100%', maxWidth: 260 }}>
      <button className="secondary" onClick={() => setPanel('main')}>{t('cancel')}</button>
      <button className="primary" onClick={logout}>{t('logout')}</button>
    </div>
  </div></div>;

  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-head"><b>{t('settings')}</b><button className="icon" onClick={onClose}><X /></button></div>
        <button className="setting-user as-row" onClick={() => setPanel('editProfile')}>
          <Avatar user={profile} size="lg" /><b>{profile.name}</b>
          <span className="edit-pencil">✎</span>
        </button>
        <p className="disclosure small">यह ऐप एडमिन-मॉनिटर्ड है — सभी चैट एडमिन को दिख सकती हैं।</p>
        {adminUser && <button className="setting-row" onClick={() => { onOpenChat(adminUser); onClose(); }}><ShieldCheck /> {t('directChatAdmin')} <span className="row-end">›</span></button>}
        <button className="setting-row" onClick={() => setPanel('language')}><MessagesSquare /> {t('language')} <span className="row-end status-text">{lang === 'hi' ? t('langHindi') : t('langEnglish')}</span></button>
        <button className="setting-row" onClick={() => setPanel('theme')}><LayoutGrid /> {t('theme')} <span className="row-end status-text">{theme === 'light' ? t('themeLight') : theme === 'dark' ? t('themeDark') : t('themeSystem')}</span></button>
        <button className="setting-row" onClick={() => setPanel('applock')}><ShieldCheck /> {t('appLock')} <span className="row-end status-text">{isPinSet() ? 'चालू' : 'बंद'}</span></button>
        {profile.role === 'admin' && <button className="setting-row" onClick={onOpenAdmin}><LayoutGrid /> Admin Dashboard खोलें <span className="row-end">›</span></button>}
        <button className="setting-row danger" onClick={() => setPanel('logout')}><X /> {t('logout')}</button>
      </aside>
    </div>
  );
}

function AdminPanel({ users, me }) {
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
  const chatLabel = (chatId) => chatId.split('_').map(uid => uid === me.uid ? 'आप' : users.find(u => u.uid === uid)?.name || 'उपयोगकर्ता').join(' ↔ ');
  const filteredUsers = q ? users.filter(u => (u.name || '').toLowerCase().includes(q) || (u.phone || '').includes(q) || (u.email || '').toLowerCase().includes(q)) : users;
  const filteredChats = q ? mirroredChats.filter(id => chatLabel(id).toLowerCase().includes(q) || (mirrors[id]?.lastMessage || '').toLowerCase().includes(q)) : mirroredChats;

  return <div className="admin">
    <div className="admin-title"><ShieldCheck size={18} /><h3>एडमिन नियंत्रण</h3></div>

    <div className="admin-stats">
      <div><b>{users.length}</b><small>कुल सदस्य</small></div>
      <div><b className="on">{onlineNow}</b><small>अभी ऑनलाइन</small></div>
      <div><b>{mirroredChats.length}</b><small>कुल चैट</small></div>
      <div><b className={activeChatsNow ? 'on' : ''}>{activeChatsNow}</b><small>अभी सक्रिय (3 मिनट में)</small></div>
    </div>

    <div className="search monitor-search"><Search size={17} /><input placeholder="नाम या नंबर से मॉनिटर करें…" value={query} onChange={e => setQuery(e.target.value)} /></div>

    <h4>सभी सदस्य</h4>
    {filteredUsers.map(u => (
      <div className="monitor-row static" key={u.uid}>
        <Avatar user={u} size="sm" />
        <span className="grow"><b>{u.name}{u.role === 'admin' ? ' 👑' : ''}</b><small>{u.phone || u.email}</small></span>
        <span className={`presence-label ${u.online ? 'on' : ''}`}>{u.online ? 'ऑनलाइन' : formatLastSeen(u.lastSeen)}</span>
        {u.role !== 'admin' && <button className="remove-btn" onClick={() => confirmRemove(u)}>हटाएं</button>}
      </div>
    ))}
    {!filteredUsers.length && <small>कोई सदस्य नहीं मिला।</small>}
    {removing && <div className="msg-actions" onClick={() => setRemoving(null)}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <p style={{ padding: '4px 20px 10px' }}>{removing.name} को हटाएं? यह उनकी प्रोफ़ाइल और सभी चैट डेटाबेस से मिटा देगा, और वो अब लॉगिन नहीं कर पाएंगे — पर उनका ईमेल/पासवर्ड Firebase से पूरी तरह मिटाना client ऐप से संभव नहीं, सिर्फ़ एक्सेस बंद होगा।</p>
        <button className="danger" onClick={doRemove}>हाँ, हटाएं</button>
        <button className="cancel" onClick={() => setRemoving(null)}>रद्द करें</button>
      </div>
    </div>}

    <h4>सभी रिकॉर्ड की गई चैट (मॉनिटरिंग)</h4>
    {filteredChats.map(chatId => {
      const parts = chatId.split('_');
      const chatUsers = parts.map(uid => uid === me.uid ? { uid, name: 'आप' } : users.find(u => u.uid === uid) || { uid, name: 'उपयोगकर्ता' });
      const isActive = now - (mirrors[chatId]?.lastMessageAt || 0) < ACTIVE_WINDOW;
      return <button className="monitor-row" key={chatId} onClick={() => setSelectedChat(chatId)}>
        <Avatar user={chatUsers[0]} size="sm" />
        <span className="grow"><b>{chatUsers.map(u => u.name).join(' ↔ ')}{isActive && <span className="live-dot" title="अभी सक्रिय" />}</b><small>{mirrors[chatId]?.lastMessage || 'कोई संदेश नहीं'}</small></span>
        <small className="mono-time">{mirrors[chatId]?.lastMessageAt ? formatLastSeen(mirrors[chatId].lastMessageAt) : ''}</small>
      </button>;
    })}
    {!filteredChats.length && <small>{q ? 'खोज से कोई चैट नहीं मिली।' : 'अभी कोई चैट रिकॉर्ड नहीं हुई है।'}</small>}
    {selectedChat && <div className="monitor"><b>चयनित चैट</b>{logs.length ? logs.map(m => <div className="log" key={m.id}><b>{m.senderId === me.uid ? 'आप' : users.find(u => u.uid === m.senderId)?.name || 'उपयोगकर्ता'}</b>: {m.text}</div>) : <small>इस चैट में अभी कोई संदेश नहीं है।</small>}</div>}
  </div>;
}

export default function App() {
  const [me, setMe] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bannedMsg, setBannedMsg] = useState('');
  const [exitToast, setExitToast] = useState(false);

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
    let cancelled = false;
    // Wait for Firebase Auth to finish restoring any persisted session
    // before attaching the listener or rendering anything auth-dependent.
    // Skipping this caused a real bug: on some cold resumes the very first
    // onAuthStateChanged callback could fire with user=null for an instant
    // (before the persisted session had actually loaded from storage),
    // which briefly flashed the login screen even though the person was
    // already logged in, right before the real callback corrected it.
    // authStateReady() resolves only once that initial state is settled, so
    // by the time we attach the listener there's nothing left to flicker.
    auth.authStateReady().then(() => {
      if (cancelled) return;
      unsub = onAuthStateChanged(auth, async user => {
        if (user && await isBanned(user.uid)) {
          await logout().catch(() => {});
          setBannedMsg('आपकी एक्सेस हटा दी गई है।');
          setMe(null); setProfile(null); setLoading(false);
          return;
        }
        setMe(user);
        if (user) {
          onValue(ref(db, `users/${user.uid}`), s => setProfile(s.val()));
        } else {
          setProfile(null);
        }
        setLoading(false);
      });
    });
    return () => { cancelled = true; unsub && unsub(); };
  }, []);

  let content;
  if (firebaseInitError) {
    content = (
      <div className="splash config-error">
        <img src="/school-chat-icon.png" alt="School Chat" />
        <span>Setup अधूरा है</span>
        <p>{firebaseInitError}</p>
      </div>
    );
  } else if (loading) {
    content = <div className="splash"><img src="/school-chat-icon.png" alt="School Chat" /><span>School Chat</span></div>;
  } else if (!me) {
    content = <AuthScreen bannedMsg={bannedMsg} />;
  } else if (!profile) {
    content = <CompleteProfileScreen me={me} />;
  } else {
    content = <LockGate><AppShell me={me} profile={profile} /></LockGate>;
  }

  return (
    <>
      {content}
      {exitToast && <div className="toast-exit">फिर से दबाएं, ऐप से बाहर जाने के लिए</div>}
    </>
  );
}

function LockGate({ children }) {
  const [unlocked, setUnlocked] = useState(!isPinSet());
  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;
  return children;
}
