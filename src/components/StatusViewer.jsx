import React, { useEffect, useRef, useState } from 'react';
import { X, Send } from 'lucide-react';
import {
  listenStatus, markStatusViewed, reactToStatus, listenStatusReactions,
  commentOnStatus, listenStatusComments, listenStatusViewCount
} from '../lib/status';
import { Avatar } from './Profile';

const REACT_EMOJIS = ['❤️', '😂', '😮', '😢', '👍', '🔥'];
const SLIDE_MS = 5000;

export function StatusViewer({ owner, me, onClose }) {
  const [items, setItems] = useState([]);
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [reactions, setReactions] = useState({});
  const [comments, setComments] = useState([]);
  const [viewCount, setViewCount] = useState(0);
  const [comment, setComment] = useState('');
  const timerRef = useRef(null);
  const isOwn = owner.uid === me.uid;

  useEffect(() => listenStatus(owner.uid, list => { setItems(list); setIndex(i => Math.min(i, Math.max(0, list.length - 1))); }), [owner.uid]);

  const current = items[index];

  useEffect(() => {
    if (!current) return undefined;
    setProgress(0);
    if (!isOwn) markStatusViewed(owner.uid, current.id, me.uid).catch(() => {});
    if (current.type === 'video') return undefined; // advances on its own via onEnded below
    const start = Date.now();
    timerRef.current = setInterval(() => {
      const pct = Math.min(100, ((Date.now() - start) / SLIDE_MS) * 100);
      setProgress(pct);
      if (pct >= 100) {
        clearInterval(timerRef.current);
        setIndex(i => (i + 1 < items.length ? i + 1 : i));
        if (index + 1 >= items.length) onClose();
      }
    }, 80);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  useEffect(() => {
    if (!current) return undefined;
    return listenStatusReactions(owner.uid, current.id, setReactions);
  }, [owner.uid, current?.id]);
  useEffect(() => {
    if (!current) return undefined;
    return listenStatusComments(owner.uid, current.id, setComments);
  }, [owner.uid, current?.id]);
  useEffect(() => {
    if (!current || !isOwn) return undefined;
    return listenStatusViewCount(owner.uid, current.id, setViewCount);
  }, [owner.uid, current?.id, isOwn]);

  if (!current) {
    return (
      <div className="status-viewer">
        <div className="status-top"><button className="icon" onClick={onClose}><X color="#fff" /></button></div>
        <div className="status-empty"><Avatar user={owner} size="lg" /><p>{isOwn ? 'आपका कोई स्टेटस नहीं है' : 'कोई स्टेटस उपलब्ध नहीं'}</p></div>
      </div>
    );
  }

  const myReaction = reactions[me.uid];

  async function sendComment(e) {
    e.preventDefault();
    if (!comment.trim()) return;
    await commentOnStatus(owner.uid, current.id, me.uid, comment);
    setComment('');
  }

  return (
    <div className="status-viewer" onClick={() => setIndex(i => (i + 1 < items.length ? i + 1 : (onClose(), i)))}>
      <div className="status-bars">
        {items.map((it, i) => <div key={it.id} className="status-bar"><span style={{ width: i < index ? '100%' : i === index ? `${progress}%` : '0%' }} /></div>)}
      </div>
      <div className="status-top" onClick={e => e.stopPropagation()}>
        <Avatar user={owner} size="sm" />
        <b className="grow">{owner.name}</b>
        {isOwn && <small className="status-views">{viewCount} देखा</small>}
        <button className="icon" onClick={onClose}><X color="#fff" /></button>
      </div>
      <div className="status-slide">
        {current.type === 'image' && <img src={current.content} alt="" />}
        {current.type === 'video' && <video src={current.content} autoPlay playsInline controls={false} muted={false} onEnded={() => setIndex(i => (i + 1 < items.length ? i + 1 : (onClose(), i)))} />}
        {current.type === 'text' && (() => {
          let parsed = { text: current.content, bg: '#0f6fe8' };
          try { parsed = JSON.parse(current.content); } catch { /* plain string fallback above */ }
          return <div className="status-text-slide" style={{ background: parsed.bg }}>{parsed.text}</div>;
        })()}
      </div>
      {!isOwn && (
        <div className="status-footer" onClick={e => e.stopPropagation()}>
          <div className="status-emojis">
            {REACT_EMOJIS.map(em => (
              <button key={em} className={myReaction === em ? 'active' : ''} onClick={() => reactToStatus(owner.uid, current.id, me.uid, em)}>{em}</button>
            ))}
          </div>
          <form onSubmit={sendComment} className="status-comment-form">
            <input value={comment} onChange={e => setComment(e.target.value)} placeholder="कमेंट लिखें…" />
            <button type="submit"><Send size={16} /></button>
          </form>
        </div>
      )}
      {isOwn && comments.length > 0 && (
        <div className="status-footer status-comments-list" onClick={e => e.stopPropagation()}>
          {comments.slice(-4).map(c => <small key={c.id}>{c.text}</small>)}
        </div>
      )}
    </div>
  );
}
