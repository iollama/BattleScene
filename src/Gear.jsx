import React from 'react';

// Outline of a spur gear centred on (cx, cy), with an optional round bore. Use with fill-rule="evenodd".
export function gearPath(cx, cy, outer, inner, teeth, bore = 0) {
  const pitch = 2 * Math.PI / teeth;
  const point = (radius, angle) => (cx + radius * Math.cos(angle)).toFixed(2) + ' ' + (cy + radius * Math.sin(angle)).toFixed(2);
  let path = '';
  for (let tooth = 0; tooth < teeth; tooth++) {
    const start = tooth * pitch;
    path += (tooth ? 'L' : 'M') + point(inner, start) + 'L' + point(outer, start + .16 * pitch)
      + 'L' + point(outer, start + .46 * pitch) + 'L' + point(inner, start + .62 * pitch);
  }
  path += 'Z';
  if (bore) path += `M${cx + bore} ${cy}A${bore} ${bore} 0 1 0 ${cx - bore} ${cy}A${bore} ${bore} 0 1 0 ${cx + bore} ${cy}Z`;
  return path;
}

const markGear = gearPath(20, 20, 19.5, 15.5, 12, 11.5);
const dialGear = gearPath(80, 80, 79, 71, 30, 65);
const backdropGear = gearPath(300, 300, 300, 262, 34, 170);
const dialTicks = Array.from({ length: 60 }, (_, index) => {
  const angle = index * Math.PI / 30;
  const from = index % 5 ? 59.5 : 57.5;
  return [from, 62].map(radius => [80 + radius * Math.cos(angle), 80 + radius * Math.sin(angle)].map(value => value.toFixed(2)));
});
const DIAL_RADIUS = 52;
const DIAL_LENGTH = 2 * Math.PI * DIAL_RADIUS;

export function GearMark() {
  return <svg className="gear-mark" viewBox="0 0 40 40" aria-hidden="true">
    <path className="gear-mark-gear" fillRule="evenodd" d={markGear} />
    <path className="gear-mark-bolt" d="M21.5 9 13 22h6l-1.5 9 9-13.5h-6z" />
  </svg>;
}

// A gear ring around a countdown. `progress` is the share of the battle time left (0–1).
export function GearDial({ progress, running, children }) {
  const share = Math.min(1, Math.max(0, progress));
  return <div className={'gear-dial' + (running ? ' running' : '')}>
    <svg viewBox="0 0 160 160" aria-hidden="true">
      <path className="gear-dial-gear" fillRule="evenodd" d={dialGear} />
      {dialTicks.map(([[x1, y1], [x2, y2]], index) => <line key={index} className="gear-dial-tick" x1={x1} y1={y1} x2={x2} y2={y2} />)}
      <circle className="gear-dial-track" cx="80" cy="80" r={DIAL_RADIUS} />
      <circle className="gear-dial-arc" cx="80" cy="80" r={DIAL_RADIUS} transform="rotate(-90 80 80)"
        strokeDasharray={(DIAL_LENGTH * share).toFixed(1) + ' ' + DIAL_LENGTH.toFixed(1)} />
    </svg>
    <div className="gear-dial-face">{children}</div>
  </div>;
}

export function GearBackdrop() {
  return <svg className="gear-backdrop" viewBox="0 0 600 600" aria-hidden="true">
    <path fillRule="evenodd" d={backdropGear} />
  </svg>;
}
