import React, { useEffect, useId, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { ExternalLink, Swords, X } from 'lucide-react';
import { GearDial } from './Gear.jsx';
import { useT } from './i18n.jsx';
import { english } from '../shared/i18n.js';

export async function api(path, payload) {
  const response = await fetch('/api/' + path, payload === undefined ? {} : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status, details: data.details });
  return data;
}

export function formatDate(date) {
  return new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(date + 'T12:00:00Z'));
}

export function watchLink(id, view = '', item = '') {
  return '/watch/' + id + (view ? '/' + view : '') + (item ? '/' + item : '');
}

// The wording helpers below take an optional translator `t` (from useT on spectator pages); staff screens use the English default.
const FORMAT_KEYS = { single: 'formatSingle', double: 'formatDouble', rounds: 'formatRounds' };
export const formatName = (value, t = english) => t(FORMAT_KEYS[value] ?? FORMAT_KEYS.single);
export const findRobot = (division, id) => division?.robots.find(robot => robot.id === id);
export const findMatch = (division, id) => division?.matches.find(match => match.id === id);
// Face-off names shrink to fit their column instead of breaking mid-word; CSS reads this as --word (see styles.css).
export const wordFit = name => ({ '--word': Math.max(1, ...String(name ?? '').split(/\s+/).map(word => Array.from(word).length)) });
export const roundName = (match, t = english) => match.side === 'F'
  ? t(match.round === 1 ? 'grandFinal' : 'finalReset')
  : match.stage === 'final' ? t('final') : match.stage === 'decider' ? t('finalDecider') : t('roundNumber', { round: match.round });
// In the rounds format a bye means the robot sits this round out (odd number of robots left).
const sitsOut = match => match.side === 'R' && match.state === 'bye';
export const matchup = (division, match, t = english) => match?.entrants.map(id => findRobot(division, id)?.name || t('tbd')).join(' ' + t('vs') + ' ');

export function matchSlots(match) {
  if (match.state === 'void') return [];
  if (match.state === 'bye') return [match.entrants.indexOf(match.winner)];
  return [0, 1];
}

export function slotLabel(division, match, index, t = english) {
  const robot = findRobot(division, match.entrants[index]);
  if (robot) return robot.name;
  const slot = match.slots[index];
  if (slot?.kind === 'bye' || (match.entrants[index] == null && ['bye', 'void'].includes(match.state))) {
    return t(sitsOut(match) ? 'statusSitsOut' : 'noOpponent');
  }
  if (['winner', 'loser'].includes(slot?.kind)) return t(slot.kind === 'winner' ? 'winnerOf' : 'loserOf', { match: slot.id });
  return t('tbd');
}

export function matchStatus(match, t = english) {
  if (match.state === 'running') return t(match.timer.startedAt == null ? 'statusPaused' : 'statusInBattle');
  if (match.state === 'done') return t(match.result?.withdrawal ? 'statusWithdrawal' : match.result?.method === 'forfeit' ? 'statusForfeit' : 'statusFinal');
  if (match.state === 'bye') return t(sitsOut(match) ? 'statusSitsOut' : 'statusAutoAdvance');
  if (match.state === 'void') return t('statusNoMatch');
  if (match.held) return t('statusOnHold');
  if (match.call) return t('lastCall');
  if (match.ready) return t('statusReady');
  return t(match.state === 'ready' ? 'statusCheckIn' : 'statusWaiting');
}

// Tooltip text explaining what a battle's status means for staff.
export function matchStatusHint(match) {
  if (match.state === 'running') return match.timer.startedAt == null
    ? 'The battle has started and its timer is paused. Resume it from the arena controls.'
    : 'The battle is in progress and its timer is running.';
  if (match.state === 'done') return match.result?.withdrawal ? 'Decided because a robot withdrew from the event.'
    : match.result?.method === 'forfeit' ? 'Decided by forfeit.' : 'The result is recorded.';
  if (sitsOut(match)) return 'An odd number of robots are left, so this robot sits this round out and fights next round.';
  if (match.state === 'bye') return 'Only one robot reached this battle, so it advances without fighting.';
  if (match.state === 'void') return 'No robots reached this battle, so it will not be fought.';
  if (match.held) return 'On hold: this battle is skipped when choosing the next one until you release it.';
  if (match.call) return 'A last call is counting down for both robots to reach the arena.';
  if (match.ready) return 'Both robots are known and checked in, so this battle can start.';
  return match.state === 'ready' ? 'Both robots are known, but at least one has not checked in yet.'
    : 'Waiting for earlier battles to decide who fights here.';
}

// Developer credit shown at the bottom of every screen. The year follows the viewer's clock.
// The "get your own" link always points at the public project, even on someone else's copy.
// Venue screens (`venue`) leave it out: nobody can click a link on a TV.
const PUBLIC_REPO ='https://github.com/iollama/BattleScene';
export function Credit({ venue = false }) {
  const t = useT();
  return <footer className="credit">
    © {new Date().getFullYear()} {t('developedBy')} <a href="https://www.iollama.com/" target="_blank" rel="noopener noreferrer"
      data-tip="Open iollama.com in a new tab">Udi Tirosh</a>
    {!venue && <> · <a href={PUBLIC_REPO} target="_blank" rel="noopener noreferrer" data-tip={t('getYourOwnTip')}>{t('getYourOwn')}</a></>}
  </footer>;
}

export function Field({ label, hint, children }) {
  const generated = useId();
  const input = children.props.id ?? generated;
  const description = hint ? generated + '-description' : undefined;
  return <div className="field">
    <label htmlFor={input}>{label}</label>
    {React.cloneElement(children, { id: input, 'aria-describedby': description })}
    {hint && <small id={description}>{hint}</small>}
  </div>;
}

export function External({ href, children, className = 'button secondary', tip = 'Open in a new tab' }) {
  return <a className={className} href={href} target="_blank" rel="noreferrer" data-tip={tip}>{children}<ExternalLink size={15} /></a>;
}

export function Dialog({ title, close, children }) {
  const ref = useRef(null);
  const heading = useId();
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} aria-labelledby={heading} className="dialog" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="dialog-header"><h2 id={heading}>{title}</h2><button className="icon-button" aria-label="Close dialog" data-tip="Close without saving" type="button" onClick={close}><X size={19} /></button></div>
    {children}
  </dialog>;
}

export function Issue({ children }) {
  return children ? <div className="issue" role="alert">{children}</div> : null;
}

export function Empty({ title, children, action }) {
  return <div className="empty"><div className="empty-icon"><Swords size={25} /></div><h3>{title}</h3>
    {children && <p>{children}</p>}{action}</div>;
}

export function Countdown({ timer, className = '', dial = false }) {
  const t = useT();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (timer?.startedAt == null) return;
    const tick = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(tick);
  }, [timer?.startedAt]);
  if (!timer) return <div className={'countdown ' + className}>—:—</div>;
  const left = Math.max(0, timer.remaining - (timer.startedAt == null ? 0 : Math.max(0, now - timer.startedAt)));
  const remaining = Math.ceil(left / 1000);
  const clock = Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0');
  const face = <>
    <div className="countdown" role="timer" aria-label={clock}>{clock}</div>
    {remaining === 0 ? <span className="timer-state">{t('timeUp')}</span>
      : timer.startedAt == null ? <span className="timer-state">{t('statusPaused')}</span> : null}
  </>;
  if (!dial) return <div className={'timer ' + className}>{face}</div>;
  const running = timer.startedAt != null && remaining > 0;
  return <div className={'timer dial-timer ' + (running ? 'running ' : remaining ? 'paused ' : 'expired ') + className}>
    <GearDial progress={timer.duration ? left / timer.duration : 1} running={running}>{face}</GearDial>
  </div>;
}

export function QRAction({ action }) {
  const t = useT();
  const [picture, setPicture] = useState('');
  useEffect(() => {
    let current = true;
    setPicture('');
    if (action?.url) QRCode.toDataURL(action.url, { width: 180, margin: 2, errorCorrectionLevel: 'M' })
      .then(data => { if (current) setPicture(data); })
      .catch(() => {});
    return () => { current = false; };
  }, [action?.url]);
  if (!action) return null;
  return <a className="qr-action" href={action.url} target="_blank" rel="noreferrer">
    {picture && <img src={picture} alt={t('scanQr')} />}
    <span>{action.title}<ExternalLink size={15} /></span>
  </a>;
}

export function readCsv(text) {
  const separator = text.includes('\t') ? '\t' : ',';
  const table = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const letter = text[index];
    if (letter === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (letter === separator || letter === '\n')) {
      row.push(value.trim());
      value = '';
      if (letter === '\n') {
        if (row.some(Boolean)) table.push(row);
        row = [];
      }
    } else if (letter !== '\r' || quoted) {
      value += letter;
    }
  }
  if (quoted) throw new Error('Close the quoted field before importing.');
  if (value || row.length) table.push([...row, value.trim()]);
  if (/^team( name)?$/i.test(table[0]?.[0] ?? '') && /^robot( name)?$/i.test(table[0]?.[1] ?? '')) table.shift();
  if (!table.length || table.some(row => row.length !== 2 || row.some(field => !field))) {
    throw new Error('Enter one team name and one robot name per row.');
  }
  return table.map(([team, name]) => ({ team, name }));
}

export function downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(value => {
    let safe = String(value ?? '');
    if (/^[=+@-]/.test(safe.trimStart())) safe = "'" + safe;
    return '"' + safe.replaceAll('"', '""') + '"';
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = Object.assign(document.createElement('a'), { href: url, download: filename });
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function groupRounds(division, t = english) {
  const grouped = new Map();
  for (const match of division.matches.filter(item => item.state !== 'inactive')) {
    const key = match.side + match.round;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(match);
  }
  return [...grouped].map(([key, matches]) => ({ key, matches, name: roundName(matches[0], t) }));
}

export function BracketBoard({ division, focus = '', onMatch, showSingleHeading = true }) {
  const t = useT();
  if (!division?.matches.length) return <Empty title={t('bracketPending')}>{t('bracketPendingHint')}</Empty>;
  const sides = [['W', t(division.format === 'double' ? 'sideWinners' : 'sideBracket')], ['L', t('sideLosers')], ['F', t('sideFinals')],
    ['R', t('sideRounds')]];
  const groups = groupRounds(division, t).filter(round => !focus || focus === round.key);
  if (!groups.length) return <Empty title={t('roundPending')}>{t('roundPendingHint')}</Empty>;
  return <div className="bracket-board">
    {sides.map(([side, title]) => {
      const rounds = groups.filter(round => round.key.startsWith(side));
      if (!rounds.length) return null;
      return <section className="bracket-side" key={side}>
        {(showSingleHeading || division.format === 'double') && <h3>{title}</h3>}
        <div className="rounds">
          {rounds.map(round => <div className="round" key={round.key}>
            <div className="round-label">{round.name}</div>
            {round.matches.map(match => {
              const content = <>
                <div className="match-heading"><span>{match.id}</span><span className={match.state === 'running' ? 'live-text' : ''}>{matchStatus(match, t)}</span></div>
                {matchSlots(match).map(index => <div className={'slot ' + (match.winner && match.winner === match.entrants[index] ? 'winner' : '')} key={index}>
                  <bdi>{slotLabel(division, match, index, t)}</bdi>
                  {findRobot(division, match.entrants[index])?.withdrawn && <small className="withdrawn-tag">{t('withdrawn')}</small>}
                  {match.state === 'done' && match.winner === match.entrants[index] && <span>{t('winnerMark')}</span>}
                </div>)}
              </>;
              return onMatch && ['done', 'ready', 'running'].includes(match.state)
                ? <button type="button" className="bracket-match inspect" key={match.id} onClick={() => onMatch(match)}
                  data-tip={match.state === 'ready' ? 'Open this battle to start it or record a forfeit' : match.state === 'running' ? 'Open this battle to record its result' : 'Open this battle to review or correct its result'}>{content}</button>
                : <div className="bracket-match" key={match.id}>{content}</div>;
            })}
          </div>)}
        </div>
      </section>;
    })}
  </div>;
}

// Rounds format: the round that is still filling in (partial: some of it is already paired), or null once finished.
// Its pairings are added as the previous round's battles end.
export function pendingRound(division) {
  if (division?.format !== 'rounds' || !division.matches.length || division.placements?.length) return null;
  const latest = Math.max(...division.matches.map(match => match.round));
  const partial = division.matches.some(match => match.round === latest - 1 && !match.settled);
  return { round: partial ? latest : latest + 1, partial };
}

const standingStatus = (entry, division, t) => {
  if (entry.withdrawn) return t('withdrawn');
  if (!entry.alive) return t('outInRound', { round: entry.out });
  if (division.placements?.length) return t('championStatus');
  const latest = Math.max(...division.matches.map(match => match.round));
  const sitting = division.matches.some(match => match.round === latest && sitsOut(match) && match.winner === entry.id);
  return t(sitting ? 'sitsOutThisRound' : entry.losses ? 'oneLoss' : 'unbeaten');
};

export function Standings({ division }) {
  const t = useT();
  if (division?.format !== 'rounds' || !division.standings?.length) return null;
  const pending = pendingRound(division);
  const order = division.standings.toSorted((a, b) => Number(b.alive) - Number(a.alive) || (b.out ?? 0) - (a.out ?? 0)
    || a.losses - b.losses || b.wins - a.wins || a.seed - b.seed);
  return <section className="panel standings"><h3>{t('standings')}</h3>
    {pending && <p className="standings-note">{t('standingsNote', { round: pending.round, previous: pending.round - 1 })}</p>}
    <div className="standings-row standings-head"><span>{t('robot')}</span><span>{t('winLoss')}</span><span>{t('battles')}</span><span>{t('status')}</span></div>
    {order.map(entry => <div className={'standings-row' + (entry.alive ? '' : ' standings-out')} key={entry.id}>
      <span><bdi>{findRobot(division, entry.id)?.name}</bdi></span><span className="standings-score">{entry.wins}–{entry.losses}</span><span>{entry.battles}</span>
      <span>{standingStatus(entry, division, t)}</span>
    </div>)}
  </section>;
}

export function Placements({ division }) {
  const t = useT();
  if (!division?.placements?.length) return null;
  return <section className="panel placements"><h3>{t('finalPlacements')}</h3>
    {division.placements.map(({ place, ids }) => <div key={place}><b>{place}</b><span>{ids.map(id => findRobot(division, id)?.name).join(', ')}</span></div>)}
  </section>;
}
