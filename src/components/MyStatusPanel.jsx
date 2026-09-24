import React, { useEffect, useState } from 'react';
import { Eye, Plus, Trash2 } from 'lucide-react';
import { deleteOwnStatus, listenStatus, listenStatusViewCount, MAX_ACTIVE_STATUS } from '../lib/status';
import { videoFirstFrameSrc } from '../lib/media';
import { usePrefs } from '../context/Prefs';

function Thumb({ item }) {
  if (item.type === 'image') return <img src={item.content} alt="" />;
  if (item.type === 'video') return <video src={videoFirstFrameSrc(item.content)} preload="metadata" muted playsInline />;
  let bg = '#0f6fe8'; let text = '';
  try { const p = JSON.parse(item.content); bg = p.bg || bg; text = p.text || ''; } catch { text = String(item.content || ''); }
  return <div className="my-status-textthumb" style={{ background: bg }}>{text.slice(0, 24)}</div>;
}

function Row({ me, item, index, onView, onDelete, hoursLabel }) {
  const [views, setViews] = useState(0);
  useEffect(() => listenStatusViewCount(me.uid, item.id, setViews), [me.uid, item.id]);
  const hoursLeft = Math.max(1, Math.ceil((item.expiresAt - Date.now()) / 3600000));
  return (
    <div className="my-status-row">
      <button className="my-status-thumb" onClick={() => onView(index)}><Thumb item={item} /></button>
      <button className="my-status-info grow" onClick={() => onView(index)}>
        <b>{item.type === 'video' ? '🎥' : item.type === 'image' ? '📷' : '✏️'} {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b>
        <small><Eye size={12} /> {views} · {hoursLeft} {hoursLabel}</small>
      </button>
      <button className="icon" onClick={() => onDelete(item)}><Trash2 size={19} color="#dc2626" /></button>
    </div>
  );
}

// Settings -> Status: the user's own live statuses (max 3, 24h each) with
// view / delete, and an Add button.
export function MyStatusPanel({ me, onView, onAdd }) {
  const { t } = usePrefs();
  const [items, setItems] = useState(null);
  const [confirm, setConfirm] = useState(null);
  useEffect(() => listenStatus(me.uid, setItems), [me.uid]);

  const full = (items?.length || 0) >= MAX_ACTIVE_STATUS;
  async function doDelete() {
    const it = confirm; setConfirm(null);
    if (it) await deleteOwnStatus(me.uid, it.id).catch(() => {});
  }

  return (
    <div className="my-status-panel">
      <p className="muted small">{t('statusLimitHint')} ({items?.length || 0}/{MAX_ACTIVE_STATUS})</p>
      {items === null && <div className="media-spinner inline" />}
      {items && items.length === 0 && <div className="empty small">{t('noStatusOwn')}</div>}
      {items && items.map((it, i) => (
        <Row key={it.id} me={me} item={it} index={i} onView={onView} onDelete={setConfirm} hoursLabel={t('hoursLeft')} />
      ))}
      <button className="primary my-status-add" onClick={onAdd} disabled={full}><Plus size={18} /> {t('statusComposerTitle')}</button>
      {full && <p className="muted small" style={{ textAlign: 'center' }}>{t('statusLimit')}</p>}
      {confirm && (
        <div className="msg-actions" onClick={() => setConfirm(null)}>
          <div className="sheet slide-up" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <p style={{ padding: '0 20px 8px', fontWeight: 700 }}>{t('deleteStatusConfirm')}</p>
            <button className="danger" onClick={doDelete}><Trash2 size={18} /> {t('delete')}</button>
            <button className="cancel" onClick={() => setConfirm(null)}>{t('back')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
