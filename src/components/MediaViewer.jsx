import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Play } from 'lucide-react';
import { useBackHandler } from '../lib/backStack';
import { ensureMediaCached, getCachedMediaSource, rememberedCachedMediaSource, videoFirstFrameSrc } from '../lib/media';

function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function usePersistentMediaUrl(url, kind) {
  const initial = rememberedCachedMediaSource(url, kind) || url || '';
  const [src, setSrc] = useState(initial);

  useEffect(() => {
    let alive = true;
    const remembered = rememberedCachedMediaSource(url, kind);
    setSrc(remembered || url || '');
    (async () => {
      const cached = await getCachedMediaSource(url, kind);
      if (!alive) return;
      if (cached) { setSrc(cached); return; }
      const ready = await ensureMediaCached(url, kind);
      if (alive && ready) setSrc(ready);
    })();
    return () => { alive = false; };
  }, [url, kind]);

  return src;
}


// Gallery-style image: pinch to zoom, drag to pan when zoomed, double-tap to
// zoom in/out, and drag down (when not zoomed) to close.
function ZoomImage({ url, onClose }) {
  const source = usePersistentMediaUrl(url, 'image');
  const boxRef = useRef(null);
  const [tf, setTf] = useState({ s: 1, x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const g = useRef({ mode: null, tf: { s: 1, x: 0, y: 0 }, p0: null, dist0: 1, c0: null, lastTap: 0, lastTapPos: null, dy: 0 });

  const size = () => {
    const r = boxRef.current?.getBoundingClientRect();
    return { w: r?.width || window.innerWidth, h: r?.height || window.innerHeight, l: r?.left || 0, t: r?.top || 0 };
  };
  const limit = (s, x, y) => {
    const { w, h } = size();
    const mx = (w * (s - 1)) / 2; const my = (h * (s - 1)) / 2;
    return { s, x: clamp(x, -mx, mx), y: clamp(y, -my, my) };
  };
  const centerOf = (a, b) => {
    const { w, h, l, t } = size();
    return { x: (a.clientX + b.clientX) / 2 - l - w / 2, y: (a.clientY + b.clientY) / 2 - t - h / 2 };
  };
  const distOf = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;

  function onTouchStart(e) {
    const st = g.current;
    if (e.touches.length === 2) {
      st.mode = 'pinch';
      st.dist0 = distOf(e.touches[0], e.touches[1]);
      st.tf = tf;
      const c = centerOf(e.touches[0], e.touches[1]);
      st.c0 = { x: (c.x - tf.x) / tf.s, y: (c.y - tf.y) / tf.s };
    } else if (e.touches.length === 1) {
      const p = e.touches[0];
      st.mode = 'pan';
      st.p0 = { x: p.clientX, y: p.clientY };
      st.tf = tf;
      st.dy = 0;
      setDragging(true);
    }
  }
  function onTouchMove(e) {
    const st = g.current;
    if (st.mode === 'pinch' && e.touches.length === 2) {
      const s = clamp(st.tf.s * (distOf(e.touches[0], e.touches[1]) / st.dist0), 1, 6);
      const c = centerOf(e.touches[0], e.touches[1]);
      setTf(limit(s, c.x - st.c0.x * s, c.y - st.c0.y * s));
    } else if (st.mode === 'pan' && e.touches.length === 1) {
      const p = e.touches[0];
      const dx = p.clientX - st.p0.x; const dy = p.clientY - st.p0.y;
      if (st.tf.s > 1.02) setTf(limit(st.tf.s, st.tf.x + dx, st.tf.y + dy));
      else { st.dy = dy; setTf({ s: 1, x: 0, y: Math.max(0, dy) }); } // drag-down-to-close
    }
  }
  function onTouchEnd(e) {
    const st = g.current;
    if (e.touches.length > 0) {
      // one finger lifted from a pinch -> continue as pan from here
      if (st.mode === 'pinch' && e.touches.length === 1) {
        st.mode = 'pan'; st.p0 = { x: e.touches[0].clientX, y: e.touches[0].clientY }; st.tf = tfNow();
      }
      return;
    }
    setDragging(false);
    const now = Date.now();
    const cur = tfNow();
    if (st.mode === 'pan' && cur.s <= 1.02) {
      if (st.dy > 130) { onClose(); return; }
      setTf({ s: 1, x: 0, y: 0 });
      const moved = Math.abs(st.dy) > 8;
      const last = e.changedTouches[0];
      if (!moved) {
        if (now - st.lastTap < 300 && st.lastTapPos && Math.hypot(last.clientX - st.lastTapPos.x, last.clientY - st.lastTapPos.y) < 30) {
          zoomAt(last, 2.6); st.lastTap = 0;
        } else { st.lastTap = now; st.lastTapPos = { x: last.clientX, y: last.clientY }; }
      }
    } else if (cur.s > 1.02) {
      const last = e.changedTouches[0];
      if (st.mode === 'pan' && now - st.lastTap < 300 && st.lastTapPos && Math.hypot(last.clientX - st.lastTapPos.x, last.clientY - st.lastTapPos.y) < 30) {
        setTf({ s: 1, x: 0, y: 0 }); st.lastTap = 0;
      } else { st.lastTap = now; st.lastTapPos = { x: last.clientX, y: last.clientY }; }
    } else if (cur.s <= 1.02) {
      setTf({ s: 1, x: 0, y: 0 });
    }
    st.mode = null;
  }
  const tfRef = useRef(tf);
  tfRef.current = tf;
  function tfNow() { return tfRef.current; }
  function zoomAt(pt, s) {
    const { w, h, l, t } = size();
    const px = pt.clientX - l - w / 2; const py = pt.clientY - t - h / 2;
    setTf(limit(s, px - px * s, py - py * s));
  }

  return (
    <div ref={boxRef} className="zoom-box" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
      style={{ background: `rgba(0,0,0,${dragging && tf.s <= 1.02 ? Math.max(0.25, 1 - tf.y / 420) : 1})` }}>
      <img src={source} alt="" draggable={false} onLoad={() => setLoading(false)} onError={() => setLoading(false)}
        style={{ transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.s})`, transition: dragging ? 'none' : 'transform .2s ease' }} />
      {loading && <div className="media-spinner big" />}
    </div>
  );
}

function FullVideo({ url }) {
  const source = usePersistentMediaUrl(url, 'video');
  const [loading, setLoading] = useState(true);
  return (
    <div className="zoom-box">
      <video className="viewer-video" src={source} controls autoPlay playsInline preload="auto"
        onLoadedData={() => setLoading(false)} onWaiting={() => setLoading(true)} onPlaying={() => setLoading(false)} onCanPlay={() => setLoading(false)} />
      {loading && <div className="media-spinner big" />}
    </div>
  );
}

// Full-screen viewer for a chat photo or video (opens like the phone gallery).
export function MediaViewer({ kind, url, caption, onClose }) {
  useBackHandler(onClose);
  return (
    <div className="media-viewer">
      {kind === 'video' ? <FullVideo url={url} /> : <ZoomImage url={url} onClose={onClose} />}
      <button className="icon media-viewer-back" onClick={onClose}><ArrowLeft color="#fff" /></button>
      {caption ? <div className="media-viewer-caption">{caption}</div> : null}
    </div>
  );
}

// Chat photo: loads immediately (no lazy delay) with a spinner until it arrives.
export function ChatImage({ url, alt, onOpen }) {
  const source = usePersistentMediaUrl(url, 'image');
  const [loading, setLoading] = useState(!rememberedCachedMediaSource(url, 'image'));
  const [failed, setFailed] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (ref.current?.complete && ref.current.naturalWidth) setLoading(false); }, []);
  return (
    <div className={`msg-media ${loading ? 'is-loading' : ''}`} onClick={onOpen}>
      {!failed && <img ref={ref} className="message-image" src={source} alt={alt || ''} onLoad={() => setLoading(false)} onError={() => { setLoading(false); setFailed(true); }} />}
      {failed && <div className="msg-media-failed">📷</div>}
      {loading && <span className="media-spinner" />}
    </div>
  );
}

// Chat video: shows the video's own first frame (never the generic logo) and a
// play button; tapping opens the full-screen player.
export function VideoThumb({ url, onOpen }) {
  const source = usePersistentMediaUrl(url, 'video');
  const [ready, setReady] = useState(Boolean(rememberedCachedMediaSource(url, 'video')));
  const [failed, setFailed] = useState(false);
  const [dur, setDur] = useState(0);
  return (
    <div className={`msg-media video-thumb ${ready ? '' : 'is-loading'}`} onClick={onOpen}>
      {!failed && (
        <video className="message-video" src={videoFirstFrameSrc(source)} preload="auto" muted playsInline
          onLoadedData={() => setReady(true)} onLoadedMetadata={e => setDur(e.currentTarget.duration)} onError={() => setFailed(true)} />
      )}
      {!ready && !failed && <span className="media-spinner" />}
      {(ready || failed) && <span className="video-play"><Play size={26} fill="#fff" /></span>}
      {dur > 0 && <span className="video-dur">{fmtDuration(dur)}</span>}
    </div>
  );
}
