import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Send, Trash2 } from 'lucide-react';
import {
  listenStatus, markStatusViewed, reactToStatus, listenStatusReactions,
  commentOnStatus, listenStatusComments, listenStatusViewCount,
  deleteOwnStatus, normalizeSegments, statusSeconds, IMAGE_STATUS_SECONDS
} from '../lib/status';
import { videoFirstFrameSrc } from '../lib/media';
import { Avatar } from './Profile';
import { useBackHandler } from '../lib/backStack';
import { usePrefs } from '../context/Prefs';

const REACT_EMOJIS = ['❤️', '😂', '😮', '😢', '👍', '🔥'];
const FLIP_MS = 380;

// One status page: photo, text card, or video. Handles its own playback and
// reports progress (0..1) upward without re-rendering the whole viewer.
function StatusMedia({ item, active, paused, onProgress, onDone, onDuration }) {
  const [loading, setLoading] = useState(item.type !== 'text');
  const [fit, setFit] = useState('cover');
  const videoRef = useRef(null);
  const segsRef = useRef([]);
  const doneRef = useRef(false);
  const pausedRef = useRef(paused);
  const activeRef = useRef(active);
  pausedRef.current = paused;
  activeRef.current = active;
  const cb = useRef({});
  cb.current = { onProgress, onDone, onDuration };

  // Timer-driven pages (photo / text): 5 seconds, counted only while visible,
  // loaded and not held by the finger.
  useEffect(() => {
    if (item.type === 'video') return undefined;
    doneRef.current = false;
    let elapsed = 0; let last = performance.now(); let raf;
    const loop = now => {
      const dt = now - last; last = now;
      if (activeRef.current && !pausedRef.current && !loading) {
        elapsed += dt;
        const f = Math.min(1, elapsed / (IMAGE_STATUS_SECONDS * 1000));
        cb.current.onProgress?.(f);
        if (f >= 1 && !doneRef.current) { doneRef.current = true; cb.current.onDone?.(); return; }
      }
      raf = requestAnimationFrame(loop);
    };
    if (active) { cb.current.onProgress?.(0); raf = requestAnimationFrame(loop); }
    return () => cancelAnimationFrame(raf);
  }, [item.id, item.type, active, loading]);

  // Video: plays only the kept segments (cut parts are skipped) and maps the
  // position onto the status bar.
  useEffect(() => {
    if (item.type !== 'video') return undefined;
    const v = videoRef.current;
    if (!v) return undefined;
    if (!active) { v.pause(); return undefined; }
    doneRef.current = false;
    let raf;
    const segs = () => segsRef.current;
    const finish = () => { if (!doneRef.current) { doneRef.current = true; cb.current.onDone?.(); } };
    const loop = () => {
      const list = segs();
      if (list.length && v.readyState >= 2) {
        const t = v.currentTime;
        let idx = list.findIndex(x => t < x.e - 0.04);
        if (idx === -1) { finish(); return; }
        if (t < list[idx].s - 0.04) { v.currentTime = list[idx].s; }
        const before = list.slice(0, idx).reduce((a, x) => a + (x.e - x.s), 0);
        const total = list.reduce((a, x) => a + (x.e - x.s), 0) || 1;
        cb.current.onProgress?.(Math.min(1, (before + Math.max(0, t - list[idx].s)) / total));
        if (idx + 1 < list.length && t >= list[idx].e - 0.04) v.currentTime = list[idx + 1].s;
      }
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      const D = v.duration || 0;
      const declared = normalizeSegments(item).map(x => ({ s: Math.max(0, x.s), e: Math.min(D || x.e, x.e) })).filter(x => x.e > x.s);
      segsRef.current = declared.length ? declared : [{ s: 0, e: D || item.duration || 0 }];
      const total = segsRef.current.reduce((a, x) => a + (x.e - x.s), 0);
      if (total > 0) cb.current.onDuration?.(total);
      if (v.videoWidth && v.videoHeight) setFit(v.videoHeight > v.videoWidth ? 'cover' : 'contain');
      if (segsRef.current[0].s > 0.05) v.currentTime = segsRef.current[0].s;
      cb.current.onProgress?.(0);
    };
    if (v.readyState >= 1) start(); else v.addEventListener('loadedmetadata', start, { once: true });
    v.addEventListener('ended', finish);
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); v.removeEventListener('ended', finish); v.removeEventListener('loadedmetadata', start); };
  }, [item.id, item.type, active]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || item.type !== 'video') return;
    if (active && !paused) {
      const p = v.play();
      if (p?.catch) p.catch(() => { v.muted = true; v.play().catch(() => {}); });
    } else v.pause();
  }, [active, paused, item.id, item.type]);

  const overlay = item.overlay && item.overlay.text ? item.overlay : null;

  if (item.type === 'text') {
    let parsed = { text: item.content, bg: '#0f6fe8' };
    try { parsed = JSON.parse(item.content); } catch { /* plain string fallback above */ }
    return <div className="status-text-slide" style={{ background: parsed.bg }}>{parsed.text}</div>;
  }

  return (
    <>
      {item.type === 'image' && (
        <img className={`status-fill fit-${fit}`} src={item.content} alt="" draggable={false}
          onLoad={e => { setFit(e.currentTarget.naturalHeight > e.currentTarget.naturalWidth ? 'cover' : 'contain'); setLoading(false); }}
          onError={() => setLoading(false)} />
      )}
      {item.type === 'video' && (
        <video ref={videoRef} className={`status-fill fit-${fit}`} src={videoFirstFrameSrc(item.content)}
          preload="auto" playsInline
          onLoadedData={() => setLoading(false)}
          onWaiting={() => setLoading(true)}
          onPlaying={() => setLoading(false)}
          onCanPlay={() => setLoading(false)} />
      )}
      {overlay && (
        <div className="status-overlay-text" style={{ left: `${overlay.x ?? 50}%`, top: `${overlay.y ?? 70}%`, color: overlay.color || '#fff', fontSize: `${overlay.size || 6}vw` }}>
          {overlay.text}
        </div>
      )}
      {loading && <div className="media-spinner big" />}
    </>
  );
}

export function StatusViewer({ owner, me, onClose, startIndex = 0 }) {
  const { t } = usePrefs();
  useBackHandler(onClose);
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(startIndex);
  const [flip, setFlip] = useState(null); // { from, to, dir }
  const [restart, setRestart] = useState(0);
  const [held, setHeld] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [learned, setLearned] = useState({});
  const [reactions, setReactions] = useState({});
  const [comments, setComments] = useState([]);
  const [viewCount, setViewCount] = useState(0);
  const [comment, setComment] = useState('');
  const [inputFocus, setInputFocus] = useState(false);
  const barRef = useRef(null);
  const holdTimer = useRef(null);
  const heldByHold = useRef(false);
  const downAt = useRef({ x: 0, y: 0 });
  const flipTimer = useRef(null);
  const isOwn = owner.uid === me.uid;

  useEffect(() => listenStatus(owner.uid, list => {
    setItems(list); setLoaded(true);
    setIndex(i => Math.min(i, Math.max(0, list.length - 1)));
  }), [owner.uid]);
  useEffect(() => () => { clearTimeout(flipTimer.current); clearTimeout(holdTimer.current); }, []);

  const current = items[index];
  const paused = held || confirmDel || inputFocus;

  useEffect(() => {
    if (!current || isOwn) return;
    markStatusViewed(owner.uid, current.id, me.uid).catch(() => {});
  }, [current?.id, isOwn, owner.uid, me.uid]);
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

  const go = useCallback(target => {
    if (target >= items.length) { onClose(); return; }
    if (target < 0) target = 0;
    if (target === index) { setRestart(r => r + 1); return; } // back on the first page = replay it
    setFlip({ from: index, to: target, dir: target > index ? 'next' : 'prev' });
    setIndex(target);
    clearTimeout(flipTimer.current);
    flipTimer.current = setTimeout(() => setFlip(null), FLIP_MS);
  }, [items.length, index, onClose]);

  const handleDone = useCallback(() => go(index + 1), [go, index]);
  const handleProgress = useCallback(f => { if (barRef.current) barRef.current.style.width = `${f * 100}%`; }, []);

  function onPointerDown(e) {
    downAt.current = { x: e.clientX, y: e.clientY };
    heldByHold.current = false;
    clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => { heldByHold.current = true; setHeld(true); }, 220);
  }
  function onPointerUp(e) {
    clearTimeout(holdTimer.current);
    if (heldByHold.current) { heldByHold.current = false; setHeld(false); return; }
    if (Math.abs(e.clientX - downAt.current.x) > 14 || Math.abs(e.clientY - downAt.current.y) > 14) return;
    const width = e.currentTarget.getBoundingClientRect().width || window.innerWidth;
    // Left edge = previous page, everywhere else = next page (like turning a page).
    if (e.clientX - e.currentTarget.getBoundingClientRect().left < width * 0.3) go(index - 1); else go(index + 1);
  }
  function onPointerCancel() { clearTimeout(holdTimer.current); if (heldByHold.current) { heldByHold.current = false; setHeld(false); } }

  if (!loaded) {
    return <div className="status-viewer"><div className="media-spinner big" /></div>;
  }
  if (!current) {
    return (
      <div className="status-viewer">
        <div className="status-top"><button className="icon" onClick={onClose}><ArrowLeft color="#fff" /></button></div>
        <div className="status-empty"><Avatar user={owner} size="lg" /><p>{isOwn ? t('noStatusOwn') : t('noStatusOther')}</p></div>
      </div>
    );
  }

  const myReaction = reactions[me.uid];
  const layerIds = flip ? (flip.dir === 'next' ? [flip.to, flip.from] : [flip.from, flip.to]) : [index];

  async function sendComment(e) {
    e.preventDefault();
    if (!comment.trim()) return;
    await commentOnStatus(owner.uid, current.id, me.uid, comment);
    setComment('');
  }
  async function doDelete() {
    setConfirmDel(false);
    await deleteOwnStatus(owner.uid, current.id).catch(() => {});
  }

  return (
    <div className="status-viewer" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
      <div className="status-stage">
        {layerIds.map(i => {
          const it = items[i];
          if (!it) return null;
          const isActive = i === index;
          let cls = 'status-page';
          if (flip && flip.dir === 'next' && i === flip.from) cls += ' page-out';
          if (flip && flip.dir === 'prev' && i === flip.to) cls += ' page-in';
          return (
            <div key={`${it.id}-${restart}`} className={cls}>
              <StatusMedia item={it} active={isActive} paused={paused}
                onProgress={isActive ? handleProgress : undefined}
                onDone={isActive ? handleDone : undefined}
                onDuration={sec => setLearned(prev => (prev[it.id] === sec ? prev : { ...prev, [it.id]: sec }))} />
            </div>
          );
        })}
      </div>

      <div className="status-scrim-top" />
      <div className="status-bars">
        {items.map((it, i) => (
          <div key={it.id} className="status-bar" style={{ flexGrow: statusSeconds(it, learned[it.id]) }}>
            <span ref={i === index ? barRef : null} style={i < index ? { width: '100%' } : i > index ? { width: '0%' } : undefined} />
          </div>
        ))}
      </div>
      <div className="status-top" onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}>
        <button className="icon" onClick={onClose}><ArrowLeft color="#fff" /></button>
        <Avatar user={owner} size="sm" />
        <b className="grow">{owner.name}</b>
        {isOwn && <small className="status-views">{viewCount} {t('viewedSuffix')}</small>}
        {isOwn && <button className="icon" onClick={() => setConfirmDel(true)} title={t('deleteStatus')}><Trash2 color="#fff" size={20} /></button>}
      </div>

      {!isOwn && (
        <div className="status-footer" onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}>
          <div className="status-emojis">
            {REACT_EMOJIS.map(em => (
              <button key={em} className={myReaction === em ? 'active' : ''} onClick={() => reactToStatus(owner.uid, current.id, me.uid, em)}>{em}</button>
            ))}
          </div>
          <form onSubmit={sendComment} className="status-comment-form">
            <input value={comment} onChange={e => setComment(e.target.value)} placeholder={t('writeComment')}
              onFocus={() => setInputFocus(true)} onBlur={() => setInputFocus(false)} />
            <button type="submit"><Send size={16} /></button>
          </form>
        </div>
      )}
      {isOwn && comments.length > 0 && (
        <div className="status-footer status-comments-list" onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}>
          {comments.slice(-4).map(c => <small key={c.id}>{c.text}</small>)}
        </div>
      )}

      {confirmDel && (
        <div className="status-confirm" onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}>
          <div className="status-confirm-card">
            <b>{t('deleteStatusConfirm')}</b>
            <div className="step-actions">
              <button className="secondary" onClick={() => setConfirmDel(false)}>{t('back')}</button>
              <button className="primary danger-fill" onClick={doDelete}>{t('delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
