import React, { useRef, useState } from 'react';

// Same emoji set style as the AI-Studio version the user liked.
export const AVATARS = ['🧑‍🎓', '👩‍🎓', '🧑‍💻', '👩‍💻', '🚀', '⭐', '🦁', '🦊', '🦉', '🎯', '⚡', '🔥'];

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
    <div className="avatar-grid">
      {AVATARS.map(a => (
        <button type="button" key={a} className={`avatar-choice ${selected === a ? 'chosen' : ''}`} onClick={() => onSelect(a)}>{a}</button>
      ))}
    </div>
  );
}

// Deliberately simple photo picker: pick a file, we downscale + centre-crop
// it to a small square JPEG (fits comfortably in a Realtime Database field)
// and preview it. No interactive drag/zoom crop tool -- that's a much bigger
// component and not what was asked for; this covers "add a profile photo"
// without it.
export function PhotoPicker({ photoUrl, onChange }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const size = 240;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        onChange(canvas.toDataURL('image/jpeg', 0.75));
        setBusy(false);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="photo-picker">
      <button type="button" className="photo-preview" onClick={() => fileRef.current?.click()}>
        {photoUrl ? <img src={photoUrl} alt="" /> : <span>फ़ोटो जोड़ें</span>}
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFile} />
      {photoUrl && <button type="button" className="link small" onClick={() => onChange('')}>{busy ? '...' : 'हटाएं'}</button>}
    </div>
  );
}
