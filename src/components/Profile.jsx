import React, { useRef, useState, useEffect } from 'react';
import { usePrefs } from '../context/Prefs';

// Same emoji set style as the AI-Studio version the user liked.
export const AVATAR_GROUPS = [
  { name: '🎓 स्टूडेंट', items: ['🧑‍🎓','👩‍🎓','🧑‍💻','👩‍💻','🧑‍🏫','👩‍🏫','🧑‍🚀','👩‍🚀','🎒','📚'] },
  { name: '⚔️ एनीमे-स्टाइल', items: ['🥷','🗡️','⚔️','🏯','🐉','🦊','🐺','👺','👹','🌸','🌙','🔥','⚡','❄️','🌊','🍥','🌀','🎴','🧿','🦋'] },
  { name: '🦸 हीरो-स्टाइल', items: ['🦸‍♂️','🦸‍♀️','🕷️','🛡️','🤖','🏹','🪖','💥','🦾','🦿','🦸','🦹‍♂️','🦹‍♀️','🧙‍♂️','🧙‍♀️'] },
  { name: '🐾 जानवर', items: ['🐱','🐶','🦁','🐯','🐼','🐨','🐵','🐸','🐰','🦄','🐲','🦅','🦉','🐧','🦈'] },
  { name: '🌌 कल्पना', items: ['👽','👾','🎃','🤡','💀','☠️','👻','👽','🧛','🧟','🧚','🧜','🪄','🔮','🌟'] },
  { name: '🚀 गेम/कूल', items: ['🚀','🎮','🎯','🏆','🎧','🎸','🎤','🥇','⚽','🏎️','🛹','🔥','💎','👑','⭐'] },
];

export const AVATARS = [...new Set(AVATAR_GROUPS.flatMap(group => group.items))];

// Shows a real uploaded photo if the user set one, otherwise the chosen
// emoji avatar, otherwise falls back to the first letter of their name.
export function Avatar({ user, size = 'md' }) {
  const cls = `avatar-shell ${size}`;
  if (user?.photoUrl) return <div className={cls}><img src={user.photoUrl} alt="" /></div>;
  if (user?.avatar) return <div className={cls}><span>{user.avatar}</span></div>;
  return <div className={cls}><span>{(user?.name || '?').slice(0, 1).toUpperCase()}</span></div>;
}

export function AvatarPicker({ selected, onSelect }) {
  return (
    <div className="avatar-picker-groups">
      {AVATAR_GROUPS.map(group => (
        <div className="avatar-group" key={group.name}>
          <b className="avatar-group-title">{group.name}</b>
          <div className="avatar-grid">
            {group.items.map(a => (
              <button type="button" key={`${group.name}-${a}`} title={group.name} className={`avatar-choice ${selected === a ? 'chosen' : ''}`} onClick={() => onSelect(a)}>{a}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const CROP_BOX = 260;   // on-screen crop viewport, px
const OUTPUT = 480;     // exported photo size, px

// A real drag-to-reposition + pinch/scroll-to-zoom circular crop tool.
function CropModal({ src, onCancel, onSave }) {
  const { t } = usePrefs();
  const imgRef = useRef(null);
  const [natural, setNatural] = useState({ w: 1, h: 1 });
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // offset of image centre from box centre, px
  const dragRef = useRef(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = src;
  }, [src]);

  // Base scale so the shorter image side exactly fills the crop box at zoom=1.
  const baseScale = natural.w && natural.h ? CROP_BOX / Math.min(natural.w, natural.h) : 1;
  const drawW = natural.w * baseScale * scale;
  const drawH = natural.h * baseScale * scale;

  function clamp(p, drawWv, drawHv) {
    const maxX = Math.max(0, (drawWv - CROP_BOX) / 2);
    const maxY = Math.max(0, (drawHv - CROP_BOX) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, p.x)), y: Math.min(maxY, Math.max(-maxY, p.y)) };
  }

  function onPointerDown(e) {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origin: pos };
    e.target.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos(clamp({ x: dragRef.current.origin.x + dx, y: dragRef.current.origin.y + dy }, drawW, drawH));
  }
  function onPointerUp() { dragRef.current = null; }

  function handleZoom(e) {
    const next = Number(e.target.value);
    setScale(next);
    const nd = { w: natural.w * baseScale * next, h: natural.h * baseScale * next };
    setPos(p => clamp(p, nd.w, nd.h));
  }

  function save() {
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT; canvas.height = OUTPUT;
    const ctx = canvas.getContext('2d');
    const factor = OUTPUT / CROP_BOX;
    // Position of the image's top-left corner relative to the crop box's
    // top-left, in crop-box pixels, then scaled up to output resolution.
    const dxBox = (CROP_BOX - drawW) / 2 + pos.x;
    const dyBox = (CROP_BOX - drawH) / 2 + pos.y;
    ctx.save();
    ctx.beginPath();
    ctx.arc(OUTPUT / 2, OUTPUT / 2, OUTPUT / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(imgRef.current, dxBox * factor, dyBox * factor, drawW * factor, drawH * factor);
    ctx.restore();
    onSave(canvas.toDataURL('image/jpeg', 0.85));
  }

  return (
    <div className="crop-overlay">
      <div className="crop-card">
        <b>{t('adjustPhoto')}</b>
        <div className="crop-box" style={{ width: CROP_BOX, height: CROP_BOX }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
          <img
            ref={imgRef} src={src} alt="" draggable={false}
            style={{ width: drawW, height: drawH, transform: `translate(${pos.x}px, ${pos.y}px)` }}
          />
          <div className="crop-mask" />
        </div>
        <input type="range" min="1" max="3" step="0.01" value={scale} onChange={handleZoom} className="crop-zoom" />
        <div className="step-actions">
          <button type="button" className="secondary" onClick={onCancel}>{t('cancel')}</button>
          <button type="button" className="primary" onClick={save}>{t('save')}</button>
        </div>
      </div>
    </div>
  );
}

export function PhotoPicker({ photoUrl, onChange }) {
  const { t } = usePrefs();
  const fileRef = useRef(null);
  const [rawSrc, setRawSrc] = useState(null);

  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setRawSrc(ev.target.result);
    reader.readAsDataURL(file);
  }

  return (
    <div className="photo-picker">
      <button type="button" className="photo-preview" onClick={() => fileRef.current?.click()}>
        {photoUrl ? <img src={photoUrl} alt="" /> : <span>{t('addPhoto')}</span>}
      </button>
      {/* capture="user" nudges mobile browsers to offer the front camera alongside gallery */}
      <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={handleFile} />
      {photoUrl && <button type="button" className="link small" onClick={() => onChange('')}>{t('removePhoto')}</button>}
      {rawSrc && <CropModal src={rawSrc} onCancel={() => setRawSrc(null)} onSave={(dataUrl) => { onChange(dataUrl); setRawSrc(null); }} />}
    </div>
  );
}
