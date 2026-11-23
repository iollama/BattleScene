import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Camera, Check, Trash2, X } from 'lucide-react';
import { dragCrop, MAX_ZOOM, zoomCrop } from '../shared/crop.js';
import { useT } from './i18n.jsx';
import { decodePhoto, drawCrop, exportPhoto, photoSize } from './photo.js';
import { RobotPhoto } from './RobotPhoto.jsx';

const START = { zoom: 1, x: .5, y: .5 };

// Square crop frame: drag to move the photo, pinch or use the slider (or the mouse wheel) to zoom.
function Cropper({ image, done, cancel }) {
  const t = useT();
  const canvas = useRef(null);
  const [crop, setCrop] = useState(START);
  const [busy, setBusy] = useState(false);
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const { width, height } = photoSize(image);

  useLayoutEffect(() => {
    const view = canvas.current.clientWidth || 320;
    drawCrop(canvas.current, image, crop, Math.round(view * (window.devicePixelRatio || 1)));
  }, [image, crop]);

  useEffect(() => {
    const element = canvas.current;
    function wheel(event) {
      event.preventDefault();
      setCrop(previous => zoomCrop(previous, previous.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    }
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);

  const distance = () => {
    const [first, second] = [...pointers.current.values()];
    return Math.hypot(first.x - second.x, first.y - second.y);
  };
  function down(event) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) pinch.current = { distance: distance(), zoom: crop.zoom };
  }
  function move(event) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 2 && pinch.current) {
      setCrop(current => zoomCrop(current, pinch.current.zoom * distance() / pinch.current.distance));
    } else if (pointers.current.size === 1) {
      const view = canvas.current.clientWidth;
      setCrop(current => dragCrop(width, height, current, point.x - previous.x, point.y - previous.y, view));
    }
  }
  function up(event) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }
  async function confirm() {
    setBusy(true);
    try { await done(crop); } finally { setBusy(false); }
  }
  return <div className="cropper">
    <canvas ref={canvas} className="cropper-frame" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      aria-label={t('photoCropHint')} role="img" />
    <p className="cropper-hint">{t('photoCropHint')}</p>
    <label className="cropper-zoom"><span>{t('photoZoom')}</span>
      <input type="range" min="1" max={MAX_ZOOM} step="0.01" value={crop.zoom}
        onChange={event => setCrop(current => zoomCrop(current, Number(event.target.value)))} /></label>
    <div className="actions">
      <button type="button" className="button primary" disabled={busy} onClick={confirm} data-tip={t('photoUseTip')}>
        <Check size={16} />{busy ? t('photoWorking') : t('photoUse')}</button>
      <button type="button" className="button quiet" disabled={busy} onClick={cancel} data-tip={t('photoCancelTip')}>
        <X size={16} />{t('photoCancel')}</button>
    </div>
  </div>;
}

// Photo picker for a robot. `upload({ extension, bytes })` stores the processed image and resolves to its URL;
// `onChange(url)` receives it ('' when the photo is removed). Works for teams (translated) and staff (English).
export function PhotoField({ robot, value, onChange, upload, disabled = false }) {
  const t = useT();
  const [image, setImage] = useState(null);
  const [issue, setIssue] = useState('');
  const input = useRef(null);
  async function pick(file) {
    setIssue('');
    if (!file) return;
    try { setImage(await decodePhoto(file)); }
    catch { setIssue(t('photoError')); }
  }
  async function done(crop) {
    try {
      onChange(await upload(await exportPhoto(image, crop)));
      setImage(null);
    } catch (error) {
      setIssue(error.message || t('photoError'));
    }
  }
  return <div className="photo-field">
    {image ? <Cropper image={image} done={done} cancel={() => setImage(null)} /> : <div className="photo-field-current">
      <RobotPhoto robot={{ ...robot, photo: value }} size="md" />
      <div className="photo-field-actions">
        <button type="button" className="button secondary" disabled={disabled} onClick={() => input.current.click()}
          data-tip={t('photoChooseTip')}><Camera size={16} />{t(value ? 'photoReplace' : 'photoChoose')}</button>
        {value && <button type="button" className="button quiet compact" disabled={disabled} onClick={() => onChange('')}
          data-tip={t('photoRemoveTip')}><Trash2 size={15} />{t('photoRemove')}</button>}
        {!value && <small>{t('photoNone')}</small>}
      </div>
    </div>}
    <input ref={input} type="file" accept="image/*" hidden onChange={event => { pick(event.target.files[0]); event.target.value = ''; }} />
    {issue && <div className="issue" role="alert">{issue}</div>}
  </div>;
}
