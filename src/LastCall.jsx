import React, { useEffect, useState } from 'react';
import { GearDial } from './Gear.jsx';
import { useT } from './i18n.jsx';
import { findRobot } from './ui.jsx';
import { RobotPhoto, Weapon } from './RobotPhoto.jsx';

export const calledMatch = division => division?.matches.find(match => match.call);

function useCallClock(call) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, [call.startedAt]);
  return Math.max(0, call.startedAt + call.duration - now);
}

const clockText = left => {
  const seconds = Math.ceil(left / 1000);
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
};

// A running last call for one battle. Staff views pass `act` to get the cancel and forfeit controls.
// `variant` is 'panel' (arena views), 'card' (Ringmaster), 'venue' (in-battle screen) or 'line' (Overview cards).
export function LastCall({ division, match, act, busy = false, variant = 'panel' }) {
  const t = useT();
  const left = useCallClock(match.call);
  const robots = match.entrants.map(id => findRobot(division, id));
  const names = robots.map(robot => robot?.name ?? t('tbd'));
  const clock = clockText(left);
  if (variant === 'line') {
    return <div className={'last-call-line' + (left ? '' : ' expired')} role="status">
      <span className="overline">{t('lastCall')}</span><strong>{names.join(' ' + t('vs') + ' ')}</strong>
      <span className="last-call-clock" role="timer" aria-label={clock}>{left ? clock : t('timeUp')}</span>
    </div>;
  }
  const send = (data, note) => act({ division: division.id, match: match.id, ...data }, note).catch(() => {});
  return <section className={'last-call last-call-' + variant + (left ? '' : ' expired')} aria-label={t('lastCallFor', { names: names.join(' ' + t('vs') + ' ') })}>
    <div className={'timer dial-timer ' + (left ? 'running' : 'expired')}>
      <GearDial progress={left / match.call.duration} running={left > 0}>
        <div className="countdown" role="timer" aria-label={clock}>{clock}</div>
        <span className="timer-state">{t(left ? 'lastCall' : 'timeUp')}</span>
      </GearDial>
    </div>
    <div className="last-call-body">
      <span className="overline">{t('lastCallAt', { arena: division.arena })}</span>
      <div className="last-call-robots">{robots.map((robot, index) => <figure key={robot?.id ?? index}>
        <RobotPhoto robot={robot} size={variant === 'venue' ? 'lg' : variant === 'card' ? 'sm' : 'md'} />
        <figcaption><Weapon robot={robot} /></figcaption>
      </figure>)}</div>
      <h3><bdi>{names[0]}</bdi> <span>{t('vs')}</span> <bdi>{names[1]}</bdi></h3>
      <p>{left ? t('bothRobotsTo', { arena: division.arena })
        : act ? 'Time is up. If a robot is missing, the robot that is here advances by forfeit.'
          : t('waitingForOrganizer')}</p>
      {act && <div className="actions">
        {!left && robots.map(robot => robot && <button key={robot.id} className="button primary compact" disabled={busy}
          data-tip={robot.name + ' is here, so it wins this battle by forfeit and moves on in the bracket'}
          onClick={() => send({ type: 'result', winner: robot.id, method: 'forfeit' }, robot.name + ' advances by forfeit')}>
          {robot.name} advances</button>)}
        <button className="button quiet compact" disabled={busy} data-tip="Stop the countdown and keep the battle in the queue"
          onClick={() => send({ type: 'lastCall', call: false }, 'Last call cancelled')}>Cancel last call</button>
      </div>}
    </div>
  </section>;
}
