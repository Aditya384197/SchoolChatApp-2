import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Pause, Play, RotateCcw, Scissors, Trash2, Undo2 } from 'lucide-react';
import { usePrefs } from '../context/Prefs';
import { useBackHandler } from '../lib/backStack';

const COLORS = ['#ffffff', '#facc15', '#22c55e', '#38bdf8', '#f472b6', '#ef4444', '#000000'];
const MIN_PART = 0.4; // seconds -- a part shorter than this can't be created

const fmt = sec => {
  const s = Math.max(0, sec || 0);
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;
};

// Status video editor: cut away any part of the video (start, end or middle)
// and write text on it. Nothing is re-encoded -- the chosen "kept" parts and
// the text are saved with the status and applied when it is played.
export function VideoEditor({ src, initial, onDone, onCancel }) {
  const { t } = usePrefs();
  useBackHandler(onCancel);
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const barRef = useRef(null);
  const [duration, setDuration] = useState(0);
  const [segs, setSegs] = useState([]); // [{s,e,removed}]
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [overlay, setOverlay] = useState(initial?.overlay || { text: '', x: 50, y: 70, color: '#ffffff', size: 6 });
  const segsRef = useRef(segs);
  segsRef.current = segs;
  const playingRef = useRef(false);
  playingRef.current = playing;

  function onMeta(e) {
    const D = e.currentTarget.duration || 0;
    setDuration(D);
    if (initial?.segments?.length) {
      // rebuild cut list from previously kept parts
      const kept = initial.segments;
      const list = []; let cursor = 0;
      kept.forEach(k => {
        if (k.s > cursor + 0.01) list.push({ s: cursor, e: k.s, removed: true });
        list.push({ s: k.s, e: k.e, removed: false });
        cursor = k.e;
      });
      if (cursor < D - 0.01) list.push({ s: cursor, e: D, removed: true });
      setSegs(list);
    } else setSegs([{ s: 0, e: D, removed: false }]);
  }

  // Playback loop: shows the time, and skips over removed parts while playing.
  useEffect(() => {
    let raf;
    const loop = () => {
      const v = videoRef.current;
      if (v) {
        const cur = v.currentTime;
        setTime(cur);
        if (playingRef.current) {
          const list = segsRef.current;
          const idx = list.findIndex(x => cur >= x.s - 0.02 && cur < x.e);
          if (idx !== -1 && list[idx].removed) {
            const next = list.slice(idx + 1).find(x => !x.removed);
            if (next) v.currentTime = next.s; else { v.pause(); setPlaying(false); }
          } else if (idx === -1 && cur >= (v.duration || 0) - 0.05) { v.pause(); setPlaying(false); }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  function togglePlay() {
    const v = videoRef.current; if (!v) return;
    if (v.paused) {
      const list = segsRef.current;
      const idx = list.findIndex(x => v.currentTime >= x.s - 0.02 && v.currentTime < x.e);
      if (idx === -1 || list[idx].removed) {
        const next = list.slice(Math.max(0, idx)).find(x => !x.removed) || list.find(x => !x.removed);
        if (next) v.currentTime = next.s;
      }
      v.play().catch(() => {}); setPlaying(true);
    } else { v.pause(); setPlaying(false); }
  }

  function seekFromEvent(e) {
    const rect = barRef.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const v = videoRef.current; if (!v || !duration) return;
    v.currentTime = Math.min(duration - 0.01, frac * duration);
    setTime(v.currentTime);
  }
  function barDown(e) { e.currentTarget.setPointerCapture?.(e.pointerId); videoRef.current?.pause(); setPlaying(false); seekFromEvent(e); }
  function barMove(e) { if (e.buttons || e.pointerType === 'touch') { if (e.currentTarget.hasPointerCapture?.(e.pointerId)) seekFromEvent(e); } }

  const currentIdx = segs.findIndex(x => time >= x.s - 0.001 && time < x.e + 0.001);
  const keptCount = segs.filter(x => !x.removed).length;

  function split() {
    const i = segs.findIndex(x => time > x.s + MIN_PART && time < x.e - MIN_PART);
    if (i === -1) return;
    const seg = segs[i];
    setSegs([...segs.slice(0, i), { ...seg, e: time }, { ...seg, s: time }, ...segs.slice(i + 1)]);
  }
  function toggleRemove() {
    if (currentIdx === -1) return;
    const seg = segs[currentIdx];
    if (!seg.removed && keptCount <= 1) return; // at least one part must stay
    setSegs(segs.map((x, i) => (i === currentIdx ? { ...x, removed: !x.removed } : x)));
  }
  function reset() { setSegs([{ s: 0, e: duration, removed: false }]); }

  const keptTotal = useMemo(() => segs.filter(x => !x.removed).reduce((a, x) => a + (x.e - x.s), 0), [segs]);
  const canSplit = segs.some(x => time > x.s + MIN_PART && time < x.e - MIN_PART);
  const canToggle = currentIdx !== -1 && (segs[currentIdx].removed || keptCount > 1);

  function finish() {
    const kept = [];
    segs.filter(x => !x.removed).forEach(x => {
      const last = kept[kept.length - 1];
      if (last && Math.abs(last.e - x.s) < 0.02) last.e = x.e; else kept.push({ s: x.s, e: x.e });
    });
    const whole = kept.length === 1 && kept[0].s < 0.05 && kept[0].e > duration - 0.05;
    const r2 = n => Math.round(n * 100) / 100;
    onDone({
      segments: whole ? [] : kept.map(k => ({ s: r2(k.s), e: r2(k.e) })),
      duration: r2(whole ? duration : keptTotal),
      overlay: overlay.text.trim() ? { ...overlay, text: overlay.text.trim() } : null,
    });
  }

  // drag the text around on the preview
  function textDown(e) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.dataset.drag = '1';
  }
  function textMove(e) {
    if (e.currentTarget.dataset.drag !== '1') return;
    const rect = stageRef.current.getBoundingClientRect();
    const x = Math.min(92, Math.max(8, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(94, Math.max(6, ((e.clientY - rect.top) / rect.height) * 100));
    setOverlay(o => ({ ...o, x, y }));
  }
  function textUp(e) { e.currentTarget.dataset.drag = '0'; }

  return (
    <div className="video-editor">
      <div className="ve-top">
        <button className="icon" onClick={onCancel}><ArrowLeft color="#fff" /></button>
        <b className="grow">{t('editVideo')}</b>
        <button className="ve-done" onClick={finish} disabled={!duration}>{t('done')}</button>
      </div>

      <div className="ve-stage" ref={stageRef} onClick={togglePlay}>
        <video ref={videoRef} src={src} playsInline preload="auto" onLoadedMetadata={onMeta} onEnded={() => setPlaying(false)} />
        {overlay.text.trim() && (
          <div className="status-overlay-text editable" style={{ left: `${overlay.x}%`, top: `${overlay.y}%`, color: overlay.color, fontSize: `${overlay.size}vw` }}
            onClick={e => e.stopPropagation()} onPointerDown={textDown} onPointerMove={textMove} onPointerUp={textUp} onPointerCancel={textUp}>
            {overlay.text}
          </div>
        )}
        {!playing && <span className="ve-play"><Play size={30} fill="#fff" /></span>}
      </div>

      <div className="ve-panel">
        <div className="ve-times"><span>{fmt(time)}</span><span>{t('keptTime')}: {fmt(keptTotal)}</span><span>{fmt(duration)}</span></div>
        <div className="ve-bar" ref={barRef} onPointerDown={barDown} onPointerMove={barMove}>
          {segs.map((x, i) => (
            <div key={i} className={`ve-seg ${x.removed ? 'removed' : ''} ${i === currentIdx ? 'current' : ''}`} style={{ flexGrow: Math.max(0.0001, x.e - x.s) }} />
          ))}
          <div className="ve-head" style={{ left: `${duration ? (time / duration) * 100 : 0}%` }} />
        </div>
        <div className="ve-actions">
          <button onClick={togglePlay}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
          <button onClick={split} disabled={!canSplit}><Scissors size={18} /> {t('splitHere')}</button>
          <button onClick={toggleRemove} disabled={!canToggle} className={currentIdx !== -1 && segs[currentIdx]?.removed ? '' : 'warn'}>
            {currentIdx !== -1 && segs[currentIdx]?.removed ? <><Undo2 size={18} /> {t('restorePart')}</> : <><Trash2 size={18} /> {t('removePart')}</>}
          </button>
          <button onClick={reset}><RotateCcw size={18} /></button>
        </div>
        <p className="ve-hint">{t('editHint')}</p>

        <div className="ve-text">
          <input value={overlay.text} onChange={e => setOverlay(o => ({ ...o, text: e.target.value }))} placeholder={t('addText')} maxLength={80} />
          <div className="ve-colors">
            {COLORS.map(c => <button key={c} className={overlay.color === c ? 'active' : ''} style={{ background: c }} onClick={() => setOverlay(o => ({ ...o, color: c }))} />)}
          </div>
          <input type="range" min="3" max="11" step="0.5" value={overlay.size} onChange={e => setOverlay(o => ({ ...o, size: Number(e.target.value) }))} />
        </div>
      </div>
    </div>
  );
}
