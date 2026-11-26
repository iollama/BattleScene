import React, { useState } from 'react';
import { Check, CircleDot, ClipboardPaste, Download, GitFork, ListOrdered, Lock, Megaphone, Pause, Phone, Play, Plus, Power, RotateCcw, Search, Swords, Trophy, Users, UserX } from 'lucide-react';
import { canSwapSlots, isArenaActive, resolveBracket } from '../server/bracket.js';
import {
  api, BracketBoard, Countdown, Dialog, Empty, External, Field, Issue, Placements, Standings,
  downloadCsv, findMatch, findRobot, formatName, matchup, matchSlots, matchStatus, matchStatusHint, readCsv, roundName, slotLabel, watchLink, wordFit,
} from './ui.jsx';
import { calledMatch, LastCall } from './LastCall.jsx';
import { useT } from './i18n.jsx';
import { RobotPhoto, Weapon } from './RobotPhoto.jsx';
import { PhotoField } from './PhotoField.jsx';

const ignore = promise => promise.catch(() => {});
const values = event => Object.fromEntries(new FormData(event.currentTarget));

export function WeightTabs({ divisions, selected, choose, arenas = false }) {
  const t = useT();
  return <div className="weight-tabs" aria-label={arenas ? 'Arenas' : t('weightClasses')}>
    {divisions.map(division => <button key={division.id} className={selected === division.id ? 'selected' : ''}
      onClick={() => choose(division.id)} aria-pressed={selected === division.id}
      data-tip={arenas ? 'Show the ' + division.arena + ' controls for ' + division.name : t('showClass', { name: division.name })}>
      {division.name}{arenas && <small className="weight-tab-arena">{division.arena}</small>}</button>)}
  </div>;
}

function ArenaCaption({ division }) {
  return <><span className="overline">{division.name}</span><h3>{division.arena}</h3></>;
}

// Two robots facing off. `photos` is the photo size ('xs', 'sm', 'md'), or false for names only.
export function Pair({ division, match, photos = 'sm' }) {
  const t = useT();
  if (!match) return <div className="pair-placeholder">{t('waitingForMatchup')}</div>;
  const robots = match.entrants.map(id => findRobot(division, id));
  const side = robot => <div>
    {photos && <RobotPhoto robot={robot} size={photos} />}
    <span className="pair-text"><strong style={wordFit(robot?.name ?? t('tbd'))}><bdi>{robot?.name ?? t('tbd')}</bdi></strong><small><bdi>{robot?.team}</bdi></small>
      <Weapon robot={robot} /></span>
  </div>;
  return <div className="pair">{side(robots[0])}<span>{t('versus')}</span>{side(robots[1])}</div>;
}

function ArenaMatchup({ division, current, next, photos }) {
  const t = useT();
  if (!isArenaActive(division) && !current) {
    return <div className="pair-placeholder">Activate this arena to call matches.</div>;
  }
  let heading = 'nextBattle';
  if (current) heading = current.timer.startedAt == null ? 'pausedBattle' : 'nowFighting';
  return <><span className="overline">{t(heading)}</span><Pair division={division} match={current ?? next} photos={photos} /></>;
}

function ArenaToggle({ division, act, busy, compact = false }) {
  const active = isArenaActive(division);
  const running = findMatch(division, division.current)?.timer?.startedAt != null;
  const verb = active ? running ? 'Pause and deactivate' : 'Deactivate' : 'Activate';
  const message = active
    ? running ? 'Arena deactivated and timer paused' : 'Arena deactivated'
    : 'Arena activated';
  const tip = active
    ? (running ? 'Pause the running battle and stop calling battles here' : 'Stop calling battles in ' + division.arena)
      + '. Spectators see it as inactive.'
    : 'Start calling battles in ' + division.arena + ' and show it as live to spectators';
  return <button type="button" className={'button ' + (active ? 'secondary' : 'primary') + (compact ? ' compact' : '')}
    aria-label={verb + ' ' + division.arena} disabled={busy} data-tip={tip}
    onClick={() => ignore(act({ type: 'arenaStatus', division: division.id, active: !active }, message))}>
    <Power size={16} />{verb}{compact ? '' : ' arena'}
  </button>;
}

function ArenaCards({ meetup, choose, act, busy }) {
  return <div className="arena-grid">
    {meetup.divisions.map(division => {
      const active = isArenaActive(division);
      const current = findMatch(division, division.current);
      const next = findMatch(division, division.next);
      return <article className={'arena-card' + (!active ? ' arena-inactive' : current ? ' arena-live' : '')} key={division.id}>
        <div className="arena-heading">
          <div><h3>{division.name}</h3><span className="overline">{division.arena}</span></div>
          <span className={'status ' + (active && current ? 'active' : active && calledMatch(division) ? 'warn' : active && next ? 'ready' : '')}
            tabIndex={0} data-tip={!active ? 'This arena is not calling battles. Activate it to run battles here.'
              : current ? matchStatusHint(current) : calledMatch(division) ? matchStatusHint(calledMatch(division))
                : next ? 'The next battle has both robots checked in and can start now.' : 'No battle is ready yet. Robots may still need to check in.'}><i />
            {!active ? 'Inactive' : current ? matchStatus(current) : calledMatch(division) ? 'Last call' : next ? 'Ready' : 'Waiting'}
          </span>
        </div>
        <div className="arena-pair">
          <ArenaMatchup division={division} current={current} next={next} photos="xs" />
          {current && <Countdown timer={current.timer} dial />}
        </div>
        {calledMatch(division) && <LastCall division={division} match={calledMatch(division)} variant="line" />}
        {active && current && <div className="arena-next"><span className="overline">Next battle</span><span>{matchup(division, next) || 'Waiting for matchup'}</span></div>}
        <div className="arena-footer">
          <div className="actions">
            <button className="button secondary compact" onClick={() => choose(division.id)}
              data-tip={'Open the ' + division.arena + ' controls: timer, results, and battle queue'}>Run arena</button>
            <ArenaToggle division={division} act={act} busy={busy} compact />
          </div>
        </div>
      </article>;
    })}
  </div>;
}

export function ArenaDetails({ meetup, division, act, busy, publicView = false }) {
  const t = useT();
  const [inspect, setInspect] = useState(null);
  const active = isArenaActive(division);
  const current = findMatch(division, division.current);
  const next = findMatch(division, division.next);
  const selected = findMatch(division, inspect);
  const queue = (division.queue ?? []).map(id => findMatch(division, id)).filter(match => match && !['bye', 'void', 'inactive'].includes(match.state));
  const upcoming = queue.filter(match => ['waiting', 'pending', 'ready'].includes(match.state));
  const called = calledMatch(division);
  const send = (type, match, data = {}, note) => act({ type, division: division.id, match: match.id, ...data }, note);
  return <div className="stack">
    <section className="panel arena-control">
      <div className="section-head">
        <div>{publicView ? <ArenaCaption division={division} /> : <h3>{division.arena}</h3>}</div>
        {!publicView && <div className="actions">
          <ArenaToggle division={division} act={act} busy={busy} />
          <External href={watchLink(meetup.id, 'battle', division.id)}
            tip={'Open the full-screen battle view for ' + division.arena + ' in a new tab'}>In-battle screen</External>
        </div>}
      </div>
      {!active && <span className="status"><i />{t('arenaInactive')}</span>}
      {called && <LastCall division={division} match={called} act={publicView ? undefined : act} busy={busy} />}
      <div className="arena-focus">
        <div><ArenaMatchup division={division} current={current} next={next} photos="md" /></div>
        {current && <Countdown timer={current.timer} dial />}
      </div>
      {!publicView && current && <div className="actions">
        {current.timer.startedAt == null
          ? <button className="button secondary" disabled={!active || busy || !current.timer.remaining} onClick={() => ignore(send('resume', current))}
            data-tip={!active ? 'Activate the arena to resume' : !current.timer.remaining ? 'Time is up. Record the result or reset the timer.' : 'Restart the battle timer from where it paused'}><Play size={16} />Resume</button>
          : <button className="button secondary" disabled={busy} onClick={() => ignore(send('pause', current))}
            data-tip="Stop the battle timer. You can resume it later."><Pause size={16} />Pause</button>}
        <button className="button secondary" disabled={busy} onClick={() => ignore(send('reset', current))}
          data-tip="Set the timer back to the full battle time and pause it"><RotateCcw size={16} />Reset timer</button>
        <button className="button primary" onClick={() => setInspect(current.id)}
          data-tip="Choose the winner of this battle and end it"><Trophy size={16} />Record result</button>
      </div>}
      {!publicView && !current && next && <button className="button primary" onClick={() => setInspect(next.id)}
        data-tip="Set the battle time and start the timer for the next battle"><Play size={17} />Start battle</button>}
      {active && current && <div className="arena-next"><span className="overline">{t('nextBattle')}</span><Pair division={division} match={next} /></div>}
    </section>
    {!publicView && <section className="panel">
      <div className="section-head"><h3>Battle queue</h3><ListOrdered size={22} /></div>
      {queue.length === 0 ? <Empty title="No matches queued">Generate the bracket for this weight class in Brackets to fill the queue.</Empty>
        : <div className="queue">{queue.map(match => {
          const index = upcoming.indexOf(match);
          const move = target => ignore(send('moveMatch', match, { before: target.id }, 'Queue updated'));
          const editable = index >= 0;
          const label = [0, 1].map(slot => slotLabel(division, match, slot)).join(' vs ');
          return <div className="queue-row" key={match.id}>
            <span className="match-code">{match.id}</span>
            <div className="queue-match"><strong style={wordFit(label)}>{label}</strong><small>{roundName(match)}</small></div>
            <span className={'status ' + (match.call ? 'warn' : match.ready ? 'ready' : match.state === 'running' ? 'active' : '')}
              tabIndex={0} data-tip={matchStatusHint(match)}>{matchStatus(match)}</span>
            <div className="queue-actions">
              {editable && <><button className="button quiet compact" disabled={busy || index === 0} onClick={() => move(upcoming[index - 1])}
                data-tip={index === 0 ? 'Already first in the queue' : 'Move this battle up one place in the arena queue'}>Earlier</button>
                <button className="button quiet compact" disabled={busy || index === upcoming.length - 1} onClick={() => move(upcoming[index + 1])}
                  data-tip={index === upcoming.length - 1 ? 'Already last in the queue' : 'Move this battle down one place in the arena queue'}>Later</button>
                <button className="button secondary compact" disabled={busy} onClick={() => ignore(send('hold', match, { held: !match.held }))}
                  data-tip={match.held ? 'Put this battle back in line so it can be called' : 'Skip this battle when choosing the next one, until you release it'}>{match.held ? 'Release' : 'Hold'}</button></>}
              {match.state === 'ready' && !match.held && !called && active && <button className="button secondary compact" disabled={busy}
                data-tip={'Call both robots to the arena and start a ' + meetup.lastCall + '-second countdown. If one misses it, you can advance the other by forfeit.'}
                onClick={() => ignore(send('lastCall', match, { call: true }, 'Last call started'))}><Megaphone size={15} />Last call</button>}
              {['ready', 'running', 'done'].includes(match.state) && <button className="button secondary compact" onClick={() => setInspect(match.id)}
                data-tip={match.state === 'ready' ? 'Open this battle to start it or record a forfeit'
                  : match.state === 'running' ? 'Open this battle to record its result' : 'Open this battle to review or correct its result'}>Details</button>}
            </div>
          </div>;
        })}</div>}
    </section>}
    {selected && <MatchDialog key={selected.id} meetup={meetup} division={division} match={selected} act={act} close={() => setInspect(null)} />}
  </div>;
}

function MatchDialog({ meetup, division, match, close, act }) {
  const [error, setError] = useState(null);
  const [busy, saving] = useState(false);
  const [rollback, setRollback] = useState(null);
  async function submit(data) {
    saving(true);
    setError(null);
    try {
      await act({ ...data, division: division.id, match: match.id }, data.type === 'result' ? 'Result saved' : 'Battle started');
      close();
    } catch (failure) {
      setError(failure.message);
      if (failure.details?.affected) setRollback({ data, ...failure.details });
    } finally {
      saving(false);
    }
  }
  const active = findMatch(division, division.current);
  return <Dialog title={roundName(match) + ' · ' + match.id} close={close}>
    <Pair division={division} match={match} />
    <Issue>{error}</Issue>
    {rollback && <div className="stack rollback">
      <p>Affected matches: {rollback.affected.join(', ')}.</p>
      {rollback.canConfirm && <button className="button danger" disabled={busy}
        data-tip="Save this result and reset the later battles listed above"
        onClick={() => submit({ ...rollback.data, confirm: true })}>Confirm rollback and save</button>}
    </div>}
    {isArenaActive(division) && match.ready && !active && <form className="dialog-form" onSubmit={event => {
      event.preventDefault();
      submit({ type: 'start', duration: values(event).duration });
    }}>
      <Field label="Battle duration in seconds"><input name="duration" type="number" min="1" max="3600" defaultValue={meetup.duration} required /></Field>
      <button className="button primary" disabled={busy} data-tip="Start the battle timer with this duration"><Play size={16} />Start battle</button>
    </form>}
    <form className="dialog-form" onSubmit={event => {
      event.preventDefault();
      setRollback(null);
      submit({ type: 'result', ...values(event) });
    }}>
      <Field label="Winner"><select name="winner" defaultValue={match.winner ?? ''} required>
        <option value="" disabled>Choose robot</option>
        {match.entrants.map(id => <option value={id} key={id}>{findRobot(division, id)?.name}</option>)}
      </select></Field>
      <Field label="Outcome" hint={match.state === 'ready'
        ? 'Use Forfeit when the other robot concedes or cannot start.'
        : 'Choose Win for a played battle or Forfeit if the other robot concedes or cannot compete.'}>
        <select name="method" defaultValue={match.result?.method ?? (match.state === 'ready' ? 'forfeit' : 'winner')}>
          {match.state !== 'ready' && <option value="winner">Win</option>}<option value="forfeit">Forfeit</option>
        </select>
      </Field>
      <button className="button secondary" disabled={busy}
        data-tip={match.result ? 'Replace the recorded result. Later battles may need to be reset.' : 'Record the winner and move them on in the bracket'}>{match.result ? 'Correct result' : 'Save result'}</button>
    </form>
  </Dialog>;
}

function ArrivalStatus({ robot }) {
  const [label, tone, tip] = robot.withdrawn ? ['Withdrawn', 'warn', robot.name + ' has withdrawn from the event']
    : robot.checkedIn ? ['Checked in', 'ready', robot.name + ' has arrived. Change this in Check-in.']
      : ['Not here yet', '', robot.name + ' has not checked in. Check robots in from Check-in.'];
  return <span className={'status ' + tone} tabIndex={0} data-tip={tip}><i />{label}</span>;
}

function WithdrawDialog({ division, robot, act, busy, close }) {
  const [issue, setIssue] = useState('');
  return <Dialog title="Withdraw robot" close={close}>
    <Issue>{issue}</Issue>
    <div className="dialog-form"><p>Withdraw <strong>{robot.name}</strong> ({robot.team}) from {division.name}?</p>
      <p className="dialog-description">Every remaining battle for this robot is forfeited to its opponent, including any losers-bracket battle it would have reached. In the rounds format it is not paired again. Results it already has stay, and the ladders show it as withdrawn.</p>
      <button className="button danger" disabled={busy} data-tip="Forfeit every remaining battle for this robot" onClick={async () => {
        try { await act({ type: 'withdraw', robot: robot.id, division: division.id }, robot.name + ' withdrawn'); close(); }
        catch (error) { setIssue(error.message); }
      }}>Withdraw robot</button>
    </div>
  </Dialog>;
}

// The event-day check-in desk: every robot in every class in one searchable list.
export function CheckIn({ meetup, act, busy, openSetup }) {
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(null);
  const term = query.trim().toLowerCase();
  const rows = meetup.divisions.filter(division => !only || division.id === only).flatMap(division => {
    const locked = division.matches.some(match => match.result || match.timer);
    const inBracket = new Set(division.matches.flatMap(match => match.slots).filter(slot => slot.kind === 'robot').map(slot => slot.id));
    const fighting = findMatch(division, division.current)?.entrants ?? [];
    return division.robots.map(robot => ({ robot, division, locked, inBracket: inBracket.has(robot.id), fighting: fighting.includes(robot.id) }));
  }).filter(({ robot }) => (!term || (robot.name + ' ' + robot.team).toLowerCase().includes(term))
    && (!waiting || (!robot.checkedIn && !robot.withdrawn)))
    .sort((a, b) => a.robot.name.localeCompare(b.robot.name));
  const everyone = meetup.divisions.flatMap(division => division.robots);
  const count = robots => robots.filter(robot => robot.checkedIn).length + ' / ' + robots.filter(robot => !robot.withdrawn).length;
  const withdrawal = withdrawing && meetup.divisions.find(division => division.id === withdrawing.division);
  const withdrawRobot = withdrawal && findRobot(withdrawal, withdrawing.robot);
  if (!everyone.length) {
    return <section className="panel"><Empty title={meetup.divisions.length ? 'No robots registered' : 'No weight classes yet'}
      action={<button className="button primary" onClick={openSetup} data-tip="Add weight classes and register robots">Open Robots &amp; classes</button>}>
      Register robots before the event, then check them in here as they arrive.</Empty></section>;
  }
  return <section className="panel checkin">
    <div className="section-head">
      <div><h3>Check-in desk</h3><p>{count(everyone)} robots checked in</p></div>
    </div>
    <div className="checkin-tools">
      <label className="search-field"><Search size={17} aria-hidden="true" />
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search robot or team"
          aria-label="Search robot or team" /></label>
      <div className="weight-tabs" aria-label="Filter by weight class">
        <button className={!only ? 'selected' : ''} aria-pressed={!only} onClick={() => setOnly('')}
          data-tip="Show robots from every weight class">All classes<small className="weight-tab-arena">{count(everyone)}</small></button>
        {meetup.divisions.map(division => <button key={division.id} className={only === division.id ? 'selected' : ''}
          aria-pressed={only === division.id} onClick={() => setOnly(only === division.id ? '' : division.id)}
          data-tip={'Show only ' + division.name + ' robots'}>{division.name}<small className="weight-tab-arena">{count(division.robots)}</small></button>)}
      </div>
      <label className="checkbox"><input type="checkbox" checked={waiting} onChange={event => setWaiting(event.target.checked)} /> Only robots not here yet</label>
    </div>
    {!rows.length ? <Empty title="No matching robots">{waiting ? 'Everyone shown here has checked in.' : 'Try a different name or class.'}</Empty>
      : <div className="checkin-list">{rows.map(({ robot, division, locked, inBracket, fighting }) => <div className="checkin-row" key={robot.id}>
        <div className="robot-row-name"><RobotPhoto robot={robot} size="xs" />
          <div className="queue-match"><strong style={wordFit(robot.name)}>{robot.name}</strong><small>{robot.team}</small>
            {robot.contact?.phone && <a className="robot-phone" href={'tel:' + robot.contact.phone.replace(/[^\d+]/g, '')}
              data-tip={'Call ' + robot.contact.name + ' about ' + robot.name}><Phone size={13} />{robot.contact.phone}</a>}</div></div>
        <span className="roster-tag">{division.name}</span>
        {robot.withdrawn ? <span className="status warn">Withdrawn</span>
          : <button className={'button ' + (robot.checkedIn ? 'checked' : 'primary')} disabled={busy || (robot.checkedIn && fighting)}
            data-tip={fighting ? robot.name + ' is fighting right now'
              : robot.checkedIn ? 'Mark ' + robot.name + ' as not here' + (locked ? '' : '. Until the first battle, the bracket updates automatically.')
                : 'Mark ' + robot.name + ' as arrived so it can be put in battles'}
            onClick={() => ignore(act({ type: 'checkIn', robot: robot.id, division: division.id, checkedIn: !robot.checkedIn },
              robot.name + (robot.checkedIn ? ' checked out' : ' checked in')))}>
            {robot.checkedIn && <Check size={16} />}{robot.checkedIn ? 'Checked in' : 'Check in'}
          </button>}
        <div className="actions">{locked && inBracket && !robot.withdrawn && <button className="button quiet compact"
          disabled={busy || fighting}
          data-tip={fighting ? 'Record the current result first' : 'Take ' + robot.name + ' out of the event and forfeit its remaining battles (asks first)'}
          onClick={() => setWithdrawing({ robot: robot.id, division: division.id })}><UserX size={15} />Withdraw</button>}</div>
      </div>)}</div>}
    {withdrawRobot && <WithdrawDialog division={withdrawal} robot={withdrawRobot} act={act} busy={busy}
      close={() => setWithdrawing(null)} />}
  </section>;
}

export function Roster({ meetup, division, act, busy }) {
  const [dialog, setDialog] = useState(null);
  const [issue, setIssue] = useState('');
  const [photo, setPhoto] = useState('');
  const upload = async payload => (await api('meetups/' + meetup.id + '/image', payload)).url;
  const locked = division.matches.some(match => match.result || match.timer);
  const bracketIds = new Set(division.matches.flatMap(match => match.slots).filter(slot => slot.kind === 'robot').map(slot => slot.id));
  function exportRoster() {
    downloadCsv('battlescene-roster.csv', [['Weight class', 'Seed', 'Team', 'Robot', 'Weapon', 'Checked in', 'Owner', 'Phone'],
      ...meetup.divisions.flatMap(item => item.robots.map((robot, index) =>
        [item.name, index + 1, robot.team, robot.name, robot.weapon ?? '', robot.checkedIn ? 'Yes' : 'No',
          robot.owner ?? '', robot.contact?.phone ?? '']))]);
  }
  async function submit(event) {
    event.preventDefault();
    setIssue('');
    try {
      const { roster, team, name, checkedIn, weapon, owner } = values(event);
      const data = dialog === 'paste' ? { type: 'addRobots', robots: readCsv(roster) }
        : dialog === 'add' ? { type: 'addRobots', robots: [{ team, name, checkedIn: checkedIn === 'on', weapon, photo }] }
          : { type: 'renameRobot', robot: dialog.id, team, name, weapon, photo, owner };
      await act({ ...data, division: division.id }, 'Roster updated');
      setDialog(null);
    } catch (error) {
      setIssue(error.message);
    }
  }
  function open(value) {
    setIssue('');
    setPhoto(value?.photo ?? '');
    setDialog(value);
  }
  const action = (type, robot, extra = {}) => ignore(act({ type, robot: robot.id, division: division.id, ...extra }));
  return <section className="panel">
    <div className="section-head">
      <div><h3>{division.name} roster</h3><p>{division.robots.filter(robot => robot.checkedIn).length} of {division.robots.length} checked in</p>
        {locked && <p className="roster-lock"><Lock size={15} aria-hidden="true" />Entries closed when the first battle started, so robots can't be added, removed, or reseeded. To take a robot out of the event, use Withdraw in Check-in.</p>}</div>
      <div className="actions">
        <button className="button secondary" onClick={exportRoster} data-tip="Download every class roster as a CSV file"><Download size={16} />Export roster</button>
        <button className="button secondary" onClick={() => open('paste')} disabled={locked}
          data-tip={locked ? 'Entries closed when the first battle started' : 'Add many robots at once from a list of teams and robot names'}><ClipboardPaste size={16} />Paste roster</button>
        <button className="button primary" onClick={() => open('add')} disabled={locked}
          data-tip={locked ? 'Entries closed when the first battle started' : 'Add one robot and its team to this class'}><Plus size={17} />Register robot</button>
      </div>
    </div>
    {!division.robots.length ? <Empty title="No robots registered">Add a robot or paste a list of teams for this weight class.</Empty>
      : <div className="roster"><div className="roster-labels"><span>Seed</span><span>Robot / Team</span><span>Arrival</span><span>Actions</span></div>
        {division.robots.map((robot, index) => <div className="roster-row" key={robot.id}>
          <select aria-label={'Seed for ' + robot.name} value={index + 1} disabled={locked || busy}
            onChange={event => action('moveSeed', robot, { seed: event.target.value })}>
            {division.robots.map((entry, seed) => <option value={seed + 1} key={entry.id}>{seed + 1}</option>)}
          </select>
          <div className="robot-row-name"><RobotPhoto robot={robot} size="xs" />
            <div className="queue-match"><strong style={wordFit(robot.name)}>{robot.name}</strong><small>{robot.team}{robot.weapon ? ' · ' + robot.weapon : ''}</small>
              {robot.owner && <span className="roster-tag team-tag" tabIndex={0}
                data-tip={'Registered to ' + robot.owner + (robot.contact?.phone ? ' · ' + robot.contact.phone : '') + '. The team can edit it from its registration page.'}>Team</span>}
              {division.matches.length > 0 && !robot.withdrawn && !bracketIds.has(robot.id) && <span className="roster-tag">Not in bracket</span>}</div></div>
          <ArrivalStatus robot={robot} />
          <div className="actions"><button className="button quiet compact" onClick={() => open(robot)}
            data-tip={'Change ' + robot.name + ': name, team, weapon, photo, or owner'}>Edit</button>
            {!locked && <button className="button quiet compact" disabled={busy} data-tip={'Take ' + robot.name + ' off the roster (asks first)'}
              onClick={() => open({ remove: robot })}>Remove</button>}</div>
        </div>)}
      </div>}
    {dialog && <Dialog title={dialog.remove ? 'Remove robot' : dialog === 'paste' ? 'Paste roster' : dialog === 'add' ? 'Register robot' : 'Edit robot'} close={() => setDialog(null)}>
      <Issue>{issue}</Issue>
      {dialog.remove ? <div className="dialog-form"><p>Remove {dialog.remove.name} from {division.name}?</p>
        <button className="button danger" disabled={busy} data-tip="Delete this robot from the roster" onClick={async () => {
          try { await act({ type: 'removeRobot', robot: dialog.remove.id, division: division.id }); setDialog(null); }
          catch (error) { setIssue(error.message); }
        }}>Remove robot</button></div>
        : <form className="dialog-form" onSubmit={submit}>
          {dialog === 'paste' ? <Field label="Team and robot names" hint="One team and robot per line. Use commas or paste two spreadsheet columns.">
            <textarea name="roster" rows="7" placeholder={'Team Ironclad, Scrapjaw\nMako Works, Riptide'} required /></Field>
            : <>
              <Field label="Team name"><input name="team" defaultValue={dialog.team ?? ''} maxLength="80" required /></Field>
              <Field label="Robot name"><input name="name" defaultValue={dialog.name ?? ''} maxLength="80" required /></Field>
              <Field label="Weapon type" hint="Optional. Shown next to the photo on the screens.">
                <input name="weapon" defaultValue={dialog.weapon ?? ''} maxLength="40" placeholder="Vertical spinner" /></Field>
              <div className="field"><span className="field-label">Photo</span>
                <PhotoField robot={dialog === 'add' ? {} : dialog} value={photo} onChange={setPhoto} upload={upload} disabled={busy} /></div>
              {dialog !== 'add' && <Field label="Owner email" hint="The team's Google account. When they open the registration link they can edit this robot, and it joins their garage.">
                <input name="owner" type="email" defaultValue={dialog.owner ?? ''} maxLength="254" placeholder="team@gmail.com" /></Field>}
              {dialog !== 'add' && dialog.contact?.phone && <p className="dialog-description">Contact: {dialog.contact.name} · {dialog.contact.phone}</p>}
              {dialog === 'add' && <label className="checkbox"><input type="checkbox" name="checkedIn" /> Check in now</label>}
            </>}
          <button className="button primary" disabled={busy}
            data-tip={dialog === 'paste' ? 'Add every robot in the list to this class' : 'Save this robot'}>{dialog === 'paste' ? 'Import robots' : 'Save robot'}</button>
        </form>}
    </Dialog>}
  </section>;
}

function SwapDialog({ division, close, act }) {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const options = division.matches.filter(match => match.side !== 'F' && !match.result && !match.timer)
    .flatMap(match => [0, 1].map(index => ({ match, index, id: match.id + ':' + index })));
  const source = options.find(option => option.id === first);
  const target = options.find(option => option.id === second);
  const destinations = source ? options.filter(option => option !== source
    && canSwapSlots(source.match, source.index, option.match, option.index)) : [];
  let changes = [];
  if (source && target) {
    const preview = structuredClone(division);
    const original = findMatch(preview, source.match.id);
    const replacement = findMatch(preview, target.match.id);
    [original.slots[source.index], replacement.slots[target.index]] = [replacement.slots[target.index], original.slots[source.index]];
    changes = [...resolveBracket(preview).values()].filter(match => {
      const before = findMatch(division, match.id);
      return match.slots.some((slot, index) => slot.id !== before.slots[index].id || slot.kind !== before.slots[index].kind
        || (match.entrants[index] ?? null) !== (before.entrants[index] ?? null));
    });
  }
  const option = item => <option value={item.id} key={item.id}>
    {item.match.id} · Slot {item.index + 1} · {slotLabel(division, item.match, item.index)}
  </option>;
  return <Dialog title="Edit bracket" close={close}>
    <p className="dialog-description">Swap two unstarted slots in the same round and bracket. Robots seeded into a later winners round can also trade places with any other seeded robot.</p>
    <Issue>{error}</Issue>
    <form className="dialog-form" onSubmit={async event => {
      event.preventDefault();
      setBusy(true);
      setError('');
      try {
        await act({ type: 'swapSlots', division: division.id, first: source.match.id, firstSlot: source.index,
          second: target.match.id, secondSlot: target.index }, 'Bracket updated');
        close();
      } catch (failure) {
        setError(failure.message);
      } finally {
        setBusy(false);
      }
    }}>
      <Field label="First slot"><select value={first} onChange={event => { setFirst(event.target.value); setSecond(''); }} required>
        <option value="" disabled>Choose slot</option>{options.map(option)}
      </select></Field>
      <Field label="Swap with"><select value={second} onChange={event => setSecond(event.target.value)} required disabled={!source}>
        <option value="" disabled>Choose slot</option>{destinations.map(option)}
      </select></Field>
      {changes.length > 0 && <div className="preview-list"><strong>Updated matchups</strong>
        {changes.map(match => {
          const names = matchSlots(match).map(index => slotLabel(division, match, index)).join(' vs ');
          return <div key={match.id}>{match.id} · {match.state === 'bye' ? names + ' advances automatically' : names || 'No match'}</div>;
        })}
      </div>}
      <button className="button primary" disabled={!source || !target || busy}
        data-tip={!source || !target ? 'Choose both slots first' : 'Swap the two slots and update the matchups listed above'}>Save slot swap</button>
    </form>
  </Dialog>;
}

export function Brackets({ meetup, division, act, busy }) {
  const [dialog, setDialog] = useState('');
  const match = findMatch(division, dialog);
  const locked = division.matches.some(item => item.result || item.timer);
  function exportResults() {
    downloadCsv('battlescene-results.csv', [['Weight class', 'Match', 'Robot 1', 'Robot 2', 'Winner', 'Outcome'],
      ...meetup.divisions.flatMap(item => item.matches.filter(entry => entry.result).map(entry =>
        [item.name, entry.id, ...entry.entrants.map(id => findRobot(item, id)?.name),
          findRobot(item, entry.winner)?.name, entry.result.method]))]);
  }
  return <div className="stack">
    <section className="panel bracket-panel">
      <div className="section-head">
        <span>{formatName(division.format)} · {division.robots.length} robots</span>
        <div className="actions">
          <button className="button secondary" onClick={exportResults} data-tip="Download every recorded result as a CSV file"><Download size={16} />Export results</button>
          <button className="button secondary" onClick={() => setDialog('swap')} disabled={!division.matches.length}
            data-tip={division.matches.length ? 'Swap two robots between unstarted battles in the same round' : 'Generate the bracket first'}><GitFork size={17} />Edit bracket</button>
          <button className="button primary" onClick={() => setDialog('generate')} disabled={locked || division.robots.filter(robot => robot.checkedIn).length < 2}
            data-tip={locked ? 'The bracket is fixed once the first battle starts'
              : division.robots.filter(robot => robot.checkedIn).length < 2 ? 'Check in at least two robots first'
                : 'Build the bracket from checked-in robots in seed order'}>Generate bracket</button>
        </div>
      </div>
      <BracketBoard division={division} onMatch={selected => setDialog(selected.id)} showSingleHeading={false} />
    </section>
    <Standings division={division} />
    <Placements division={division} />
    {dialog === 'generate' && <GenerateDialog division={division} act={act} busy={busy} close={() => setDialog('')} />}
    {dialog === 'swap' && <SwapDialog division={division} act={act} close={() => setDialog('')} />}
    {match && <MatchDialog match={match} division={division} meetup={meetup} act={act} close={() => setDialog('')} />}
  </div>;
}

function GenerateDialog({ division, act, close, busy }) {
  const [issue, setIssue] = useState('');
  const entrants = division.robots.filter(robot => robot.checkedIn && !robot.withdrawn);
  const leftOut = division.robots.filter(robot => !entrants.includes(robot));
  return <Dialog title="Generate bracket" close={close}>
    <form className="dialog-form" onSubmit={async event => {
      event.preventDefault();
      try {
        await act({ type: 'generate', division: division.id, format: values(event).format }, 'Bracket generated');
        close();
      } catch (error) {
        setIssue(error.message);
      }
    }}>
      <Field label="Format" hint="Rounds: everyone left fights once per round and 2 losses is out, so finalists have fought the same number of battles, give or take one."><select name="format" defaultValue={division.format}>
        <option value="single">Single elimination</option><option value="double">Double elimination</option>
        <option value="rounds">Rounds (2 losses out)</option></select></Field>
      <p className="dialog-description">{entrants.length} checked-in robots enter the bracket in roster seed order. Generating replaces the current unstarted pairings. Until the first battle starts, checking a robot in or out updates the bracket automatically.</p>
      {leftOut.length > 0 && <div className="preview-list"><strong>Not checked in, so left out</strong>
        {leftOut.map(robot => <div key={robot.id}>{robot.name} · {robot.team}</div>)}</div>}
      <Issue>{issue}</Issue>
      <button className="button primary" disabled={busy} data-tip="Replace the current unstarted pairings with a new bracket">Generate bracket</button>
    </form>
  </Dialog>;
}

export function Overview({ meetup, choose, addClass, act, busy }) {
  const totals = [
    { label: 'Active arenas', count: meetup.divisions.filter(isArenaActive).length, icon: CircleDot },
    { label: 'Registered robots', count: meetup.divisions.reduce((sum, item) => sum + item.robots.length, 0), icon: Users },
    { label: 'Finished battles', count: meetup.divisions.flatMap(item => item.matches).filter(match => match.state === 'done').length, icon: Swords },
  ];
  return <>
    <div className="metrics">{totals.map(({ label, count, icon: Icon }) => <div className="metric" key={label}>
      <span className="metric-icon"><Icon size={19} /></span><div><b>{count}</b><span>{label}</span></div>
    </div>)}</div>
    {meetup.divisions.length ? <>
      <div className="section-head"><h2>Weight classes</h2>
        <button className="button secondary" disabled={meetup.complete} onClick={addClass}
          data-tip={meetup.complete ? 'Reopen the meetup before adding classes' : 'Add a weight class with its own arena and bracket'}><Plus size={17} />Add weight class</button></div>
      <ArenaCards meetup={meetup} choose={choose} act={act} busy={busy} />
    </> : <section className="panel"><Empty title="Set up your first weight class"
      action={<button className="button primary" onClick={addClass} data-tip="Add a weight class with its own arena and bracket">Add weight class</button>}>
      Choose its arena name and bracket format.</Empty></section>}
  </>;
}
