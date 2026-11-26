import React, { useEffect, useState } from 'react';
import { useT } from './i18n.jsx';

// A stable hue per robot, so two photo-less robots facing off still look different.
export function robotHue(seed = '') {
  let hash = 0;
  for (const char of String(seed)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash % 360;
}

// Stand-in for robots without a photo: a line-art mech in the Hangar HUD style, tinted per robot.
export function MechAvatar({ seed }) {
  const hue = robotHue(seed);
  const line = `hsl(${hue} 85% 72%)`;
  const glow = `hsl(${hue} 90% 60%)`;
  return <svg className="mech-avatar" viewBox="0 0 120 120" aria-hidden="true" style={{ '--mech-line': line, '--mech-glow': glow }}>
    <defs>
      <radialGradient id={'mech-bg-' + hue} cx="50%" cy="38%" r="70%">
        <stop offset="0" stopColor={`hsl(${hue} 45% 22%)`} />
        <stop offset="1" stopColor="#0c1117" />
      </radialGradient>
    </defs>
    <rect width="120" height="120" fill={`url(#mech-bg-${hue})`} />
    <g className="mech-grid">
      {[24, 48, 72, 96].map(value => <React.Fragment key={value}>
        <line x1={value} y1="0" x2={value} y2="120" /><line x1="0" y1={value} x2="120" y2={value} />
      </React.Fragment>)}
    </g>
    <ellipse className="mech-shadow" cx="60" cy="106" rx="34" ry="5" />
    <g className="mech-body">
      {/* Head and visor */}
      <path d="M50 18h20l5 6v10l-5 5H50l-5-5V24z" />
      <path className="mech-visor" d="M50 26h20v6H50z" />
      <path d="M60 18v-6M56 12h8" />
      {/* Shoulders and torso */}
      <path d="M38 44h44l6 8-4 20H36l-4-20z" />
      <path d="M44 44l4-5h24l4 5" />
      <circle className="mech-core" cx="60" cy="57" r="6" />
      <path d="M48 72l4 10h16l4-10" />
      {/* Arms */}
      <path d="M32 48l-10 6v22l6 6 6-4V58" />
      <path d="M88 48l10 6v22l-6 6-6-4V58" />
      <path d="M22 76h-4v10h10" />
      <path d="M98 76h4v10H92" />
      {/* Legs */}
      <path d="M50 82l-4 12-8 8h14l4-10" />
      <path d="M70 82l4 12 8 8H68l-4-10" />
    </g>
  </svg>;
}

// A photo that fails to load is tried again after these delays before the mech stays. A brand-new photo can be
// refused for a moment by a server that hasn't seen the change yet.
const PHOTO_RETRIES = [5000, 60000];

// A robot's photo, or the mech stand-in when it has none or the image fails to load.
// `size` is 'xs' (rows), 'sm' (cards), 'md' (arena panels) or 'lg' (the in-battle screen).
export function RobotPhoto({ robot, size = 'sm', className = '' }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { setFailed(false); setAttempt(0); }, [robot?.photo]);
  useEffect(() => {
    if (!failed || attempt >= PHOTO_RETRIES.length) return;
    const retry = setTimeout(() => { setAttempt(attempt + 1); setFailed(false); }, PHOTO_RETRIES[attempt]);
    return () => clearTimeout(retry);
  }, [failed, attempt]);
  const label = robot?.name ? t('photoOf', { name: robot.name }) : '';
  return <span className={'robot-photo robot-photo-' + size + (className ? ' ' + className : '')}>
    {robot?.photo && !failed
      ? <img key={attempt} src={robot.photo} alt={label} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      : <MechAvatar seed={robot?.id ?? robot?.name} />}
  </span>;
}

// A robot's weapon type as a small label; nothing when it has none.
export function Weapon({ robot }) {
  return robot?.weapon ? <span className="robot-weapon"><bdi>{robot.weapon}</bdi></span> : null;
}

// Venue screens show photos the moment a battle is called, so fetch the upcoming robots' photos ahead of time.
export function usePreload(urls) {
  const key = urls.filter(Boolean).join('|');
  useEffect(() => {
    for (const url of key ? key.split('|') : []) {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
    }
  }, [key]);
}
