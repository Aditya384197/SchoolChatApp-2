import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { onValue, ref, set } from 'firebase/database';
import {
  ArrowLeft, Bell, MessageCircle, Phone, Search, Send,
  ShieldCheck, Timer, Users, Wifi, X, LayoutGrid, MessagesSquare
} from 'lucide-react';
import { auth, db, firebaseInitError } from './firebase';
import { beginRegistration, completeRegistration, login, logout } from './lib/auth';
import {
  chatIdFor, clearUnread, listenMessages, markDelivered, markSeen, sendMessage
} from './lib/chat';
import { getPhoneContacts } from './lib/contacts';
import { listenTyping, setTyping, startPresence } from './lib/presence';
import { prepareNotifications, showMessageNotification } from './lib/notifications';
import { Avatar, AvatarPicker, PhotoPicker, AVATARS } from './components/Profile';

function generateCode(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
}

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
  const [invite, setInvite] = useState('');
  const [adminCode, setAdminCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (identity) return <ProfileSteps identity={identity} />;

  async function submit(e) {
    e.preventDefault();
    if (!invite.trim() && !adminCode.trim()) { setError('जोड़ने वाला कोड या एडमिन कोड — कम से कम एक भरें।'); return; }
    setError(''); setBusy(true);
    try {
      const result = await beginRegistration(email, password, invite, adminCode);
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
        <label>जोड़ने वाला यूनिक कोड <span className="optional">(सामान्य यूज़र के लिए ज़रूरी — एडमिन कोड दे रहे हों तो खाली छोड़ सकते हैं)</span><input value={invite} onChange={e => setInvite(e.target.value)} /></label>
        <label>एडमिन कोड <span className="optional">(केवल पहली बार एडमिन बनाने के लिए — दिया तो इनवाइट कोड की ज़रूरत नहीं)</span><input value={adminCode} onChange={e => setAdminCode(e.target.value)} /></label>
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

function AuthScreen() {
  const [mode, setMode] = useState('login');
  return (
    <main className="auth">
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

function MessageBubble({ me, message, onSeen }) {
  const mine = message.senderId === me.uid;
  return (
    <div className={`bubble ${mine ? 'mine' : 'theirs'}`} onClick={() => !mine && onSeen(message.id)}>
      <div>{message.text}</div>
      <div className="message-meta">
        <span>{message.createdAt ? new Date(message.createdAt).toLocaleTimeString('hi-IN', { hour: '2-digit', minute: '2-digit' }) : '…'}</span>
        {mine && <span className={`ticks ${message.seen ? 'seen' : ''}`}>{message.delivered ? '✓✓' : '✓'}</span>}
      </div>
    </div>
  );
}

function Chat({ me, user, onBack }) {
  const chatId = chatIdFor(me.uid, user.uid);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [typingUsers, setTypingUsers] = useState({});
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const typingTimer = useRef(null);
  const typingActive = useRef(false);

  useEffect(() => listenMessages(chatId, setMessages), [chatId]);
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
        {messages.map(m => <MessageBubble key={m.id} me={me} message={m} onSeen={id => markSeen(chatId, id).catch(() => {})} />)}
        {otherTyping && <div className="typing-bubble"><span></span><span></span><span></span></div>}
      </div>
      <form className="composer" onSubmit={submit}>
        <input value={text} onChange={e => handleTyping(e.target.value)} placeholder="संदेश लिखें…" />
        <button className="send" disabled={sending}><Send size={20} /></button>
      </form>
    </div>
  );
}

function AppShell({ me, profile }) {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const [chatUser, setChatUser] = useState(null);
  const [settings, setSettings] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [unread, setUnread] = useState({});
  const [previews, setPreviews] = useState({});
  const [notificationsReady, setNotificationsReady] = useState(false);
  const [view, setView] = useState('chats'); // 'chats' | 'admin' — admin gets its own tab, not just a settings sub-panel

  useEffect(() => onValue(ref(db, 'users'), s => {
    const all = s.val() || {};
    setUsers(Object.entries(all).map(([uid, u]) => ({ uid, ...u })).filter(u => u.uid !== me.uid));
  }), [me.uid]);

  useEffect(() => onValue(ref(db, `users/${me.uid}/unread`), s => setUnread(s.val() || {})), [me.uid]);
  useEffect(() => {
    startPresence(me.uid);
    prepareNotifications().then(setNotificationsReady);
  }, [me.uid]);

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
        <button className="icon notification-icon" onClick={() => setSettings(true)}>
          <Bell />{totalUnread > 0 && <span className="badge">{totalUnread > 99 ? '99+' : totalUnread}</span>}
        </button>
      </header>
      <main className="content">
        <div className="search"><Search size={19} /><input placeholder="नाम, ईमेल या नंबर खोजें" value={query} onChange={e => setQuery(e.target.value)} /></div>
        <div className="section-title"><h3>आपके संपर्क</h3><span><Wifi size={14} /> {users.filter(u => u.online).length} ऑनलाइन</span></div>
        {filtered.map(u => {
          const preview = previews[chatIdFor(me.uid, u.uid)];
          const subtitle = preview ? `${preview.mine ? 'आप: ' : ''}${preview.text}` : (u.online ? 'ऑनलाइन' : formatLastSeen(u.lastSeen));
          return (
            <button className="user-row" key={u.uid} onClick={() => setChatUser(u)}>
              <div className="avatar-wrap"><Avatar user={u} /> {u.online && <span className="presence-dot" />}</div>
              <div className="grow"><b>{u.name}</b><small className="truncate">{subtitle}</small></div>
              {unread[chatIdFor(me.uid, u.uid)] > 0 && <span className="row-unread">{unread[chatIdFor(me.uid, u.uid)]}</span>}
              <MessageCircle size={20} />
            </button>
          );
        })}
        {!filtered.length && <div className="empty"><Users size={38} /><p>कोई उपयोगकर्ता नहीं मिला।</p></div>}
      </main>
      {settings && <SettingsDrawer
        me={me} profile={profile} adminUser={adminUser} users={users} unread={unread}
        contacts={contacts} setContacts={setContacts} onClose={() => setSettings(false)} onOpenChat={setChatUser}
        onOpenAdmin={() => { setSettings(false); setView('admin'); }}
      />}
      {isAdmin && <AdminTabBar view={view} setView={setView} />}
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

function SettingsDrawer({ me, profile, adminUser, users, unread, contacts, setContacts, onClose, onOpenChat, onOpenAdmin }) {
  const [notificationState, setNotificationState] = useState('जाँच हो रही है…');
  useEffect(() => { prepareNotifications().then(ok => setNotificationState(ok ? 'चालू' : 'उपलब्ध नहीं')); }, []);

  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-head"><b>सेटिंग</b><button className="icon" onClick={onClose}><X /></button></div>
        <div className="setting-user"><Avatar user={profile} size="lg" /><b>{profile.name}</b><small>{profile.email}</small></div>
        <p className="disclosure small">यह ऐप एडमिन-मॉनिटर्ड है — सभी चैट एडमिन को दिख सकती हैं।</p>
        {adminUser && <button className="setting-row" onClick={() => { onOpenChat(adminUser); onClose(); }}><ShieldCheck /> Private Chat to Admin <span className="row-end">›</span></button>}
        <button className="setting-row" onClick={async () => setContacts(await getPhoneContacts())}><Phone /> फोन संपर्क मिलाएँ <span className="row-end">›</span></button>
        <div className="setting-row static"><Bell /> सूचनाएँ <span className="row-end status-text">{notificationState}</span></div>
        <div className="setting-row static"><Timer /> अनपढ़ संदेश <span className="row-end status-text">{Object.values(unread).reduce((s, v) => s + Number(v || 0), 0)}</span></div>
        {contacts.length > 0 && <div className="contact-note">{contacts.length} फोन संपर्क उपलब्ध हैं।</div>}
        {profile.role === 'admin' && <button className="setting-row" onClick={onOpenAdmin}><LayoutGrid /> Admin Dashboard खोलें <span className="row-end">›</span></button>}
        <button className="setting-row danger" onClick={logout}><X /> बाहर निकलें</button>
      </aside>
    </div>
  );
}

function AdminPanel({ users, me }) {
  const [invite, setInvite] = useState('');
  const [adminCode, setAdminCode] = useState('');
  const [selectedChat, setSelectedChat] = useState(null);
  const [logs, setLogs] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [mirrors, setMirrors] = useState({});
  const [query, setQuery] = useState('');
  const [, forceTick] = useState(0);

  useEffect(() => onValue(ref(db, 'config/inviteCode'), s => setInvite(s.val() || '')), []);
  useEffect(() => onValue(ref(db, 'config/adminCode'), s => setAdminCode(s.val() || '')), []);
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

  async function save() {
    setSaving(true);
    setMsg('');
    try {
      await set(ref(db, 'config/inviteCode'), invite.trim());
      setMsg('नया जोड़ने वाला कोड सेव हो गया।');
    } catch (e) {
      setMsg(e.message || 'कोड सेव नहीं हुआ।');
    } finally {
      setSaving(false);
    }
  }

  async function regenerateInvite() {
    const code = generateCode('JOIN');
    setInvite(code);
    await set(ref(db, 'config/inviteCode'), code).catch(() => {});
    setMsg('नया जोड़ने वाला कोड बन गया।');
  }

  async function regenerateAdminCode() {
    // Note: this only changes the *code*. Since config/adminUid can only ever
    // be written once (see database.rules.json), regenerating this code does
    // NOT create a way for a second person to become admin — it's only
    // useful if you want to invalidate a leaked code before anyone has used
    // it to claim admin.
    const code = generateCode('ADMIN');
    setAdminCode(code);
    await set(ref(db, 'config/adminCode'), code).catch(() => {});
    setMsg('नया एडमिन कोड बन गया।');
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

    <label>जोड़ने वाला कोड (दोस्तों के लिए)<input value={invite} onChange={e => setInvite(e.target.value)} /></label>
    <div className="admin-actions">
      <button className="primary" onClick={save} disabled={saving}>{saving ? 'सेव हो रहा है…' : 'कोड सेव करें'}</button>
      <button className="secondary" onClick={regenerateInvite} disabled={saving}>नया बनाएं</button>
    </div>
    <label>एडमिन कोड<input value={adminCode} readOnly /></label>
    <div className="admin-actions">
      <button className="secondary" onClick={regenerateAdminCode} disabled={saving}>एडमिन कोड बदलें</button>
    </div>
    {msg && <small className="success-text">{msg}</small>}

    <div className="search monitor-search"><Search size={17} /><input placeholder="नाम या नंबर से मॉनिटर करें…" value={query} onChange={e => setQuery(e.target.value)} /></div>

    <h4>सभी सदस्य</h4>
    {filteredUsers.map(u => (
      <div className="monitor-row static" key={u.uid}>
        <Avatar user={u} size="sm" />
        <span className="grow"><b>{u.name}{u.role === 'admin' ? ' 👑' : ''}</b><small>{u.phone || u.email}</small></span>
        <span className={`presence-label ${u.online ? 'on' : ''}`}>{u.online ? 'ऑनलाइन' : formatLastSeen(u.lastSeen)}</span>
      </div>
    ))}
    {!filteredUsers.length && <small>कोई सदस्य नहीं मिला।</small>}

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

  useEffect(() => {
    if (!auth) { setLoading(false); return undefined; }
    return onAuthStateChanged(auth, async user => {
      setMe(user);
      if (user) {
        onValue(ref(db, `users/${user.uid}`), s => setProfile(s.val()));
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
  }, []);

  if (firebaseInitError) {
    return (
      <div className="splash config-error">
        <img src="/school-chat-icon.png" alt="School Chat" />
        <span>Setup अधूरा है</span>
        <p>{firebaseInitError}</p>
      </div>
    );
  }
  if (loading) return <div className="splash"><img src="/school-chat-icon.png" alt="School Chat" /><span>School Chat</span></div>;
  if (!me) return <AuthScreen />;
  if (!profile) return <CompleteProfileScreen me={me} />;
  return <AppShell me={me} profile={profile} />;
}
