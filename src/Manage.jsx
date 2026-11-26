import React, { useEffect, useRef, useState } from 'react';
import {
  CalendarDays, ChevronRight, CircleDot, Clipboard, ClipboardCheck, Clock3, GitFork, Layers, LayoutDashboard, LogOut, Monitor, Plus, Printer,
  Radio, RefreshCw, Settings as SettingsIcon, ShieldCheck, SlidersHorizontal, Sparkles, Trash2,
} from 'lucide-react';
import QRCode from 'qrcode';
import banner from '../docs/assets/banner.png';
import { MAX_WEIGHT_CLASSES } from '../server/demo.js';
import { describeActivity } from '../shared/activity.js';
import { LANGUAGES } from '../shared/i18n.js';
import Displays from './Displays.jsx';
import { GearBackdrop } from './Gear.jsx';
import { Brand } from './Spectator.jsx';
import { ArenaDetails, Brackets, CheckIn, Overview, Roster, WeightTabs } from './Tournament.jsx';
import { api, Credit, Dialog, Empty, Field, formatDate, formatName, Issue } from './ui.jsx';

// Sidebar groups: [label, sections]. Every section except Meetups and General settings needs an open meetup.
const sectionGroups = [
  ['', [
    ['meetups', 'Meetups', CalendarDays, 'List your meetups and create a new one'],
  ]],
  ['Run the event', [
    ['overview', 'Overview', LayoutDashboard, 'See every arena at a glance and publish the meetup'],
    ['checkin', 'Check-in', ClipboardCheck, 'Check robots in as they arrive, or withdraw them from the event'],
    ['arenas', 'Arenas', CircleDot, 'Run each arena: timer, last call, results, and the battle queue'],
    ['brackets', 'Brackets', GitFork, 'Generate brackets, swap slots, correct results, and see standings'],
  ]],
  ['Set up', [
    ['setup', 'Robots & classes', Layers, 'Add weight classes and arenas, register robots, and set seeds'],
    ['displays', 'Displays', Monitor, 'Set up venue screens, spectator links, and branding'],
    ['settings', 'Meetup settings', SlidersHorizontal, 'Edit this meetup’s details and managers, see its activity, or delete it'],
  ]],
  ['General', [
    ['general', 'General settings', SettingsIcon, 'Staff access and the activity history across all your meetups'],
  ]],
];
const sections = sectionGroups.flatMap(([, items]) => items);
const needsMeetup = key => key !== 'meetups' && key !== 'general';
// Common UK combat-robot weight classes, offered as one-click names when adding a class.
const commonClasses = [['Antweight', '150 g'], ['Beetleweight', '1.5 kg'], ['Featherweight', '13.6 kg'], ['Heavyweight', '110 kg']];
const take = event => Object.fromEntries(new FormData(event.currentTarget));
const currentDate = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function MeetupFields({ meetup }) {
  return <>
    <Field label="Meetup name"><input name="name" maxLength="80" required defaultValue={meetup?.name} placeholder="Foundry Fight Night" /></Field>
    <div className="form-columns">
      <Field label="Date"><input name="date" type="date" required defaultValue={meetup?.date ?? currentDate()} /></Field>
      <Field label="Timezone"><input name="timezone" maxLength="64" required defaultValue={meetup?.timezone ?? timezone()} /></Field>
    </div>
    <div className="form-columns">
      <Field label="Default battle duration in seconds"><input name="duration" type="number" min="1" max="3600" required defaultValue={meetup?.duration ?? 180} /></Field>
      <Field label="Last call in seconds" hint="How long robots have to reach the arena after a last call.">
        <input name="lastCall" type="number" min="10" max="900" required defaultValue={meetup?.lastCall ?? 120} /></Field>
    </div>
    <Field label="Display language" hint="The language of spectator pages and venue displays. Hebrew reads right to left. Staff screens stay in English.">
      <select name="language" defaultValue={meetup?.language ?? 'en'}>
        {Object.entries(LANGUAGES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </select></Field>
  </>;
}

function CreateMeetup({ save, close }) {
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  return <Dialog title="Create meetup" close={close}>
    <form className="dialog-form" onSubmit={async event => {
      event.preventDefault();
      setBusy(true);
      setIssue('');
      try { await save(take(event)); close(); }
      catch (error) { setIssue(error.message); }
      finally { setBusy(false); }
    }}>
      <MeetupFields />
      <Issue>{issue}</Issue>
      <button className="button primary" disabled={busy} data-tip="Create the meetup and open it">Create meetup</button>
    </form>
  </Dialog>;
}

function MeetupList({ meetups, selected, select, create, retry }) {
  const ordered = meetups && [...meetups].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
  return <>
    <header className="workspace-heading">
      <h1>Meetups</h1>
      <button className="button primary" onClick={create} data-tip="Create a meetup with its name, date, and battle timings"><Plus size={18} />New meetup</button>
    </header>
    {!ordered ? <button className="button secondary" onClick={retry} data-tip="Try loading your meetups again">Retry loading meetups</button>
      : !ordered.length ? <section className="panel"><Empty title="No meetups yet">Create a meetup to get started.</Empty></section>
        : <ul className="meetup-list">
          {ordered.map(item => <li key={item.id}>
            <button className="meetup-row" aria-current={item.id === selected ? 'true' : undefined} onClick={() => select(item.id)}
              data-tip={'Open ' + item.name}>
              <strong>{item.name}</strong>
              <time className="meetup-date" dateTime={item.date}>{formatDate(item.date)}</time>
              <span className={'status' + (item.published && !item.complete ? ' ready' : '')}><i />
                {item.complete ? 'Complete' : item.published ? 'Published' : 'Draft'}
              </span>
              <ChevronRight size={19} aria-hidden="true" />
            </button>
          </li>)}
        </ul>}
  </>;
}

function MeetupHeading({ meetup, overview, refresh, publish, busy }) {
  return <header className={'workspace-heading' + (overview ? '' : ' meetup-context')}>
    <div className="meetup-identity">
      {overview ? <h1>{meetup.name}</h1> : <strong>{meetup.name}</strong>}
      <time className="meetup-date" dateTime={meetup.date}><CalendarDays size={16} aria-hidden="true" />{formatDate(meetup.date)}</time>
    </div>
    {overview && <div className="actions" role="group" aria-label="Meetup actions">
      <button className="icon-button" aria-label="Refresh meetup" data-tip="Reload the latest changes from other staff" onClick={refresh}>
        <RefreshCw size={18} />
      </button>
      <button className={'button ' + (meetup.published ? 'secondary' : 'primary')} disabled={busy} onClick={publish}
        data-tip={meetup.published ? 'Make the spectator pages and venue displays private again'
          : 'Make the spectator pages and venue displays public so anyone with the link can watch'}>
        <Radio size={16} />{meetup.published ? 'Unpublish' : 'Publish meetup'}
      </button>
    </div>}
  </header>;
}

function nextArena(meetup) {
  const used = new Set(meetup.divisions.map(item => item.arena.toLowerCase()));
  let number = 1;
  while (used.has('arena ' + number)) number++;
  return 'Arena ' + number;
}

function ClassDialog({ meetup, division, act, close, onAdded }) {
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  const [name, setName] = useState(division?.name ?? '');
  const [arena, setArena] = useState(division?.arena ?? '');
  const taken = new Set(meetup.divisions.map(item => item.name.toLowerCase()));
  const suggestions = division ? [] : commonClasses.filter(([label]) => !taken.has(label.toLowerCase()));
  return <Dialog title={division ? 'Edit weight class' : 'Add weight class'} close={close}>
    <form className="dialog-form" onSubmit={async event => {
      event.preventDefault();
      const data = take(event);
      setBusy(true);
      setIssue('');
      try {
        const updated = await act({ type: division ? 'editDivision' : 'addDivision', division: division?.id, ...data },
          division ? 'Weight class updated' : 'Weight class added');
        if (!division) onAdded(updated.divisions.at(-1).id);
        close();
      } catch (error) { setIssue(error.message); }
      finally { setBusy(false); }
    }}>
      {suggestions.length > 0 && <div className="field"><span className="field-label">Common classes</span>
        <div className="weight-tabs class-presets">{suggestions.map(([label, weight]) => <button type="button" key={label}
          className={name === label ? 'selected' : ''} aria-pressed={name === label}
          onClick={() => { setName(label); if (!arena.trim()) setArena(nextArena(meetup)); }}
          data-tip={'Use ' + label + ' (' + weight + ') as the class name'}>{label}<small className="weight-tab-arena">{weight}</small></button>)}</div>
      </div>}
      <Field label="Weight class name"><input name="name" required maxLength="80" placeholder="Antweight" value={name} onChange={event => setName(event.target.value)} /></Field>
      <Field label="Dedicated arena name"><input name="arena" required maxLength="80" placeholder={division ? division.arena : nextArena(meetup)} value={arena} onChange={event => setArena(event.target.value)} /></Field>
      {!division && <Field label="Bracket format" hint="Rounds: everyone left fights once per round and 2 losses is out, so finalists have fought the same number of battles, give or take one."><select name="format">
        <option value="single">Single elimination</option><option value="double">Double elimination</option>
        <option value="rounds">Rounds (2 losses out)</option></select></Field>}
      <Issue>{issue}</Issue>
      <button className="button primary" disabled={busy} data-tip={division ? 'Save the new names' : 'Add this weight class and its arena'}>Save weight class</button>
    </form>
  </Dialog>;
}

function RemoveClassDialog({ meetup, division, act, close, busy }) {
  const [issue, setIssue] = useState('');
  const hasDisplay = meetup.screens.some(screen => screen.division === division.id);
  const dismiss = () => { if (!busy) close(); };
  return <Dialog title="Remove weight class" close={dismiss}>
    <form className="dialog-form" onSubmit={async event => {
      event.preventDefault();
      setIssue('');
      try {
        await act({ type: 'removeDivision', division: division.id }, 'Weight class removed');
        close();
      } catch (error) { setIssue(error.message); }
    }}>
      <p>Remove <strong>{division.name}</strong> and its dedicated arena, <strong>{division.arena}</strong>?</p>
      <p className="dialog-description">This deletes the class roster, bracket, queue, and results.</p>
      {division.current && <p className="dialog-description">This also ends the current battle and removes its timer.</p>}
      {hasDisplay && <p className="dialog-description">Venue displays assigned to this class will switch to Ringmaster view.</p>}
      <Issue>{issue}</Issue>
      <div className="actions">
        <button className="button secondary" type="button" disabled={busy} onClick={dismiss} data-tip="Keep this weight class">Cancel</button>
        <button className="button danger" disabled={busy || meetup.complete}
          data-tip={meetup.complete ? 'Reopen the meetup before removing classes' : 'Permanently delete this class with its roster, bracket, and results'}>Remove weight class</button>
      </div>
    </form>
  </Dialog>;
}

// The secret team registration link: open or close it, share it (copy, QR, print), or replace it if it leaks.
function TeamRegistration({ meetup, act, busy }) {
  const [issue, setIssue] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [picture, setPicture] = useState('');
  const registration = meetup.registration ?? { open: false, token: null };
  const link = registration.token ? location.origin + '/register/' + meetup.id + '/' + registration.token : '';
  const teamRobots = meetup.divisions.flatMap(division => division.robots).filter(robot => robot.owner).length;
  useEffect(() => {
    let current = true;
    setPicture('');
    if (link) QRCode.toDataURL(link, { width: 360, margin: 2, errorCorrectionLevel: 'M' })
      .then(data => { if (current) setPicture(data); }).catch(() => {});
    return () => { current = false; };
  }, [link]);
  const send = async (data, note) => {
    setIssue('');
    try { await act({ type: 'registration', ...data }, note); return true; }
    catch (error) { setIssue(error.message); return false; }
  };
  function print() {
    const page = window.open('', '_blank', 'width=640,height=760');
    if (!page) return setIssue('Allow pop-ups to print the QR code.');
    const doc = page.document;
    doc.title = meetup.name + ' registration';
    const style = doc.createElement('style');
    style.textContent = 'body{font:600 20px system-ui,sans-serif;text-align:center;padding:40px;color:#111}'
      + 'h1{font-size:34px;margin:0 0 6px}p{margin:6px 0}img{width:360px;height:360px;margin:24px auto;display:block}small{font:14px monospace;word-break:break-all}';
    doc.head.append(style);
    const heading = doc.createElement('h1');
    heading.textContent = meetup.name;
    const lead = doc.createElement('p');
    lead.textContent = 'Register your robot · רישום רובוטים';
    const image = doc.createElement('img');
    image.src = picture;
    image.alt = '';
    const address = doc.createElement('small');
    address.textContent = link;
    doc.body.append(heading, lead, image, address);
    image.onload = () => page.print();
  }
  return <section className="panel team-registration">
    <div className="section-head"><div><h3>Team registration</h3>
      <p>Teams open this link, sign in with Google, and register their robots with a photo. Their robots go straight onto the roster, not checked in.</p></div>
      <span className={'status ' + (registration.open ? 'ready' : '')}><i />{registration.open ? 'Open' : 'Closed'}</span></div>
    <div className="team-registration-body">
      <div className="stack">
        <div className="actions">
          <button className={'button ' + (registration.open ? 'secondary' : 'primary')} disabled={busy || meetup.complete}
            data-tip={meetup.complete ? 'Reopen the meetup to take registrations'
              : registration.open ? 'Stop new registrations. Teams can still edit robots they already registered.'
                : 'Let teams with the link register robots. Each class still closes at its first battle.'}
            onClick={() => send({ open: !registration.open }, registration.open ? 'Team registration closed' : 'Team registration opened')}>
            {registration.open ? 'Close registration' : 'Open registration'}</button>
        </div>
        {link && <>
          <Field label="Registration link"><input value={link} readOnly onFocus={event => event.target.select()} dir="ltr" /></Field>
          <div className="actions">
            <button className="button secondary" data-tip="Copy the link to paste into a group chat or email" onClick={async () => {
              try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); }
              catch { setIssue('Copy the link from the box above.'); }
            }}><Clipboard size={16} />{copied ? 'Copied' : 'Copy link'}</button>
            <button className="button secondary" disabled={!picture} onClick={print}
              data-tip="Print a sheet with the QR code for the venue door"><Printer size={16} />Print QR</button>
            <button className="button quiet" disabled={busy} onClick={() => setConfirming(true)}
              data-tip="Replace the link if it was shared too widely (asks first)"><RefreshCw size={15} />Regenerate link</button>
          </div>
        </>}
        <p className="dialog-description">{teamRobots
          ? teamRobots + (teamRobots === 1 ? ' robot was' : ' robots were') + ' registered by teams. They have a Team tag in Robots & classes.'
          : 'No team has registered yet.'} Contact phones are visible to staff only.</p>
        <Issue>{issue}</Issue>
      </div>
      {picture && <img className="team-registration-qr" src={picture} alt="QR code for the registration link" />}
    </div>
    {confirming && <Dialog title="Regenerate registration link" close={() => setConfirming(false)}>
      <div className="dialog-form">
        <p>Replace the registration link? The current link stops accepting new robots right away.</p>
        <p className="dialog-description">Teams who already registered can still edit their robots from either link. Share the new link with anyone who still needs to register.</p>
        <div className="actions">
          <button className="button secondary" type="button" onClick={() => setConfirming(false)} data-tip="Keep the current link">Cancel</button>
          <button className="button primary" disabled={busy} data-tip="Make a new link and retire the current one" onClick={async () => {
            if (await send({ regenerate: true }, 'New registration link created')) setConfirming(false);
          }}>Regenerate link</button>
        </div>
      </div>
    </Dialog>}
  </section>;
}

function MeetupAccess({ meetup, user, act, busy }) {
  const [error, setError] = useState('');
  const canRemove = user.role === 'admin' || user.email === meetup.owner;
  return <section className="panel">
    <div className="section-head"><div><h3>Meetup access</h3><p>Owner: {meetup.owner}</p></div><ShieldCheck size={21} /></div>
    <form className="settings-form" onSubmit={async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = take(event);
      setError('');
      try { await act({ type: data.action || 'assign', email: data.email }, 'Meetup access updated'); form.reset(); }
      catch (failure) { setError(failure.message); }
    }}>
      <div className="form-columns">
        <Field label="Authorized manager email"><input name="email" type="email" required /></Field>
        {user.role === 'admin' && <Field label="Access action"><select name="action"><option value="assign">Assign to meetup</option><option value="transfer">Transfer ownership</option></select></Field>}
      </div>
      <button className="button primary" disabled={busy}
        data-tip="Let this manager run this meetup, or make them its owner. They need global manager access first.">Apply access</button>
    </form>
    {meetup.managers.map(address => <div className="access-row" key={address}><span>{address}</span>
      {canRemove && <button className="button quiet compact" disabled={busy} data-tip={'Stop ' + address + ' from managing this meetup'}
        onClick={() => act({ type: 'unassign', email: address }, 'Manager removed').catch(() => {})}>Remove</button>}</div>)}
    <Issue>{error}</Issue>
  </section>;
}

function ActivityRow({ title, detail, by, at, timezone }) {
  return <div className="history-row">
    <strong>{title}</strong>
    <span>{detail}</span>
    <small>{by} · {new Date(at).toLocaleString(undefined, timezone ? { timeZone: timezone } : undefined)}</small>
  </div>;
}

function CompleteDialog({ act, close, busy }) {
  const [issue, setIssue] = useState('');
  return <Dialog title="Mark meetup complete" close={() => { if (!busy) close(); }}>
    <div className="dialog-form">
      <p>Lock rosters, brackets, and results? Spectator pages stay up with the final results.</p>
      <p className="dialog-description">This also clears the meetup’s activity log to save space. Reopening the meetup does not bring it back.</p>
      <Issue>{issue}</Issue>
      <div className="actions">
        <button className="button secondary" type="button" disabled={busy} onClick={close} data-tip="Keep the meetup open">Cancel</button>
        <button className="button primary" disabled={busy} data-tip="Lock the meetup and clear its activity log" onClick={async () => {
          setIssue('');
          try { await act({ type: 'complete', complete: true }, 'Meetup completed'); close(); }
          catch (error) { setIssue(error.message); }
        }}>Mark meetup complete</button>
      </div>
    </div>
  </Dialog>;
}

function DeleteMeetup({ meetup, refresh, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [issue, setIssue] = useState('');
  const [busy, setBusy] = useState(false);
  const matches = typed.trim() === meetup.name;
  const dismiss = () => { if (!busy) { setOpen(false); setTyped(''); setIssue(''); } };
  return <section className="panel danger-zone">
    <div className="section-head"><div><h3>Delete meetup</h3>
      <p>Permanently removes this meetup, its robots, brackets, results, displays, uploaded images, and activity log. Spectator links stop working.</p></div>
      <button className="button danger" onClick={() => setOpen(true)} data-tip="Permanently delete this meetup (asks you to type its name first)">
        <Trash2 size={16} />Delete meetup</button>
    </div>
    {open && <Dialog title="Delete meetup" close={dismiss}>
      <form className="dialog-form" onSubmit={async event => {
        event.preventDefault();
        if (!matches) return;
        setBusy(true);
        setIssue('');
        try {
          await api('meetups/' + meetup.id + '/delete', { revision: meetup.revision, name: typed });
          onDeleted(meetup.id);
        } catch (error) {
          setIssue(error.message);
          if (error.status === 409) refresh(undefined, true).catch(() => {});
          setBusy(false);
        }
      }}>
        <p>This permanently deletes <strong>{meetup.name}</strong>. It can’t be undone.</p>
        <Field label="Type the meetup name to confirm"><input value={typed} onChange={event => setTyped(event.target.value)}
          placeholder={meetup.name} autoComplete="off" required /></Field>
        <Issue>{issue}</Issue>
        <div className="actions">
          <button className="button secondary" type="button" disabled={busy} onClick={dismiss} data-tip="Keep this meetup">Cancel</button>
          <button className="button danger" disabled={busy || !matches}
            data-tip={matches ? 'Delete this meetup and everything in it' : 'Type the meetup name exactly to enable this'}>Delete meetup</button>
        </div>
      </form>
    </Dialog>}
  </section>;
}

// Robots per class offered when filling with demo data: the first two classes default to 18 and 6, any others to 8.
const demoDefaults = [18, 6];
const demoDefault = index => demoDefaults[index] ?? 8;

function DemoDataDialog({ meetup, act, close, onAdded }) {
  const room = MAX_WEIGHT_CLASSES - meetup.divisions.length;
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  const [counts, setCounts] = useState(() => Array.from({ length: Math.min(2, room) }, (_, index) => String(demoDefault(index))));
  function resize(value) {
    const length = Math.max(1, Math.min(room, Math.trunc(Number(value)) || 1));
    setCounts(previous => Array.from({ length }, (_, index) => previous[index] ?? String(demoDefault(index))));
  }
  return <Dialog title="Fill with demo data" close={() => { if (!busy) close(); }}>
    <form className="dialog-form" onSubmit={async event => {
      event.preventDefault();
      setBusy(true);
      setIssue('');
      try {
        const before = meetup.divisions.length;
        const updated = await act({ type: 'demoData', classes: counts.map(Number) }, 'Demo data added');
        onAdded(updated.divisions[before]?.id);
        close();
      } catch (error) { setIssue(error.message); }
      finally { setBusy(false); }
    }}>
      <p className="dialog-description">Adds weight classes, each with its own arena and checked-in robots, alongside any classes already here. Generate the brackets afterwards.</p>
      <Field label="Number of classes" hint={'Up to ' + room + ' more in this meetup.'}>
        <input type="number" min="1" max={room} required value={counts.length} onChange={event => resize(event.target.value)} /></Field>
      <div className="form-columns">
        {counts.map((count, index) => <Field key={index} label={'Robots in class ' + (index + 1)}>
          <input type="number" min="2" max="64" required value={count}
            onChange={event => setCounts(previous => previous.map((item, position) => position === index ? event.target.value : item))} />
        </Field>)}
      </div>
      <Issue>{issue}</Issue>
      <button className="button primary" disabled={busy} data-tip="Add these demo classes and robots to the meetup">Add demo data</button>
    </form>
  </Dialog>;
}

function ClassesSetup({ meetup, user, act, busy, addClass, editClass, removeClass, choose, selected }) {
  const [filling, setFilling] = useState(false);
  const full = meetup.divisions.length >= MAX_WEIGHT_CLASSES;
  return <section className="panel">
    <div className="section-head"><div><h3>Weight classes and arenas</h3><p>Each weight class has its own arena and bracket.</p></div>
      <div className="actions">
        {user.role === 'admin' && <button className="button secondary" disabled={busy || meetup.complete || full} onClick={() => setFilling(true)}
          data-tip={meetup.complete ? 'Reopen the meetup before adding demo data' : full ? 'This meetup has reached the weight-class limit'
            : 'Add demo weight classes with checked-in robots (asks how many)'}><Sparkles size={16} />Fill with demo data</button>}
        <button className="button primary" disabled={meetup.complete} onClick={addClass}
          data-tip={meetup.complete ? 'Reopen the meetup before adding classes' : 'Add a weight class with its own arena and bracket'}><Plus size={16} />Add weight class</button>
      </div>
    </div>
    {filling && <DemoDataDialog meetup={meetup} act={act} close={() => setFilling(false)} onAdded={id => { if (id) choose(id); }} />}
    {!meetup.divisions.length ? <Empty title="No weight classes yet">Add a class, or pick a common one such as Antweight or Beetleweight.</Empty>
      : meetup.divisions.map(division => <div className="access-row class-row" key={division.id} aria-current={division.id === selected ? 'true' : undefined}>
        <button className="class-row-name" onClick={() => choose(division.id)} data-tip={'Show the ' + division.name + ' roster below'}>
          <strong>{division.name}</strong><small>{division.arena} · {formatName(division.format)} · {division.robots.length} robots</small></button>
        <div className="actions">
          <button className="button secondary compact" disabled={meetup.complete} onClick={() => editClass(division)}
            data-tip={meetup.complete ? 'Reopen the meetup before editing classes' : 'Rename ' + division.name + ' or its arena'}>Edit</button>
          <button className="button quiet compact" disabled={busy || meetup.complete}
            aria-label={'Remove ' + division.name + ' weight class'} onClick={() => removeClass(division.id)}
            data-tip={meetup.complete ? 'Reopen the meetup before removing classes' : 'Delete ' + division.name + ' with its arena, roster, bracket, and results (asks first)'}>Remove</button>
        </div>
      </div>)}
  </section>;
}

function MeetupSettings({ meetup, user, act, busy, refresh, onDeleted }) {
  const [issue, setIssue] = useState('');
  const [completing, setCompleting] = useState(false);
  const canDelete = user.role === 'admin' || user.email === meetup.owner;
  return <div className="stack">
    <section className="panel">
      <div className="section-head"><h3>Meetup details</h3><Clock3 size={21} /></div>
      <form className="settings-form" onSubmit={async event => {
        event.preventDefault();
        setIssue('');
        try { await act({ type: 'settings', ...take(event) }, 'Meetup details saved'); }
        catch (error) { setIssue(error.message); }
      }}>
        <MeetupFields meetup={meetup} />
        <Issue>{issue}</Issue>
        <button className="button primary" disabled={busy} data-tip="Save the name, date, timezone, timings, and display language above">Save meetup details</button>
      </form>
      <div className="settings-footer">
        <button className="button secondary" disabled={busy} onClick={() => meetup.complete
          ? act({ type: 'complete', complete: false }, 'Meetup reopened').catch(() => {}) : setCompleting(true)}
          data-tip={meetup.complete ? 'Allow changes to rosters, brackets, and results again'
            : 'Lock rosters, brackets, and results, and clear the activity log (asks first). Spectator pages stay up with the final results.'}>
          {meetup.complete ? 'Reopen meetup' : 'Mark meetup complete'}</button>
      </div>
    </section>
    <TeamRegistration meetup={meetup} act={act} busy={busy} />
    <MeetupAccess meetup={meetup} user={user} act={act} busy={busy} />
    {meetup.audit.length > 0 && <section className="panel">
      <div className="section-head"><div><h3>Activity</h3><p>Changes to this meetup. Marking the meetup complete clears this log. General settings has the history across all meetups.</p></div></div>
      <div className="history">{meetup.audit.slice(-50).reverse().map((entry, index) =>
        <ActivityRow key={entry.at + '-' + index} {...entry} {...describeActivity(entry, meetup)} timezone={meetup.timezone} />)}</div>
    </section>}
    {canDelete && <DeleteMeetup meetup={meetup} refresh={refresh} onDeleted={onDeleted} />}
    {completing && <CompleteDialog act={act} busy={busy} close={() => setCompleting(false)} />}
  </div>;
}

function GeneralSettings({ user, notify }) {
  const [roles, setRoles] = useState(null);
  const [activity, setActivity] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const admin = user.role === 'admin';
  async function loadActivity() {
    try { setActivity(await api('activity')); }
    catch (failure) { setError(failure.message); }
  }
  useEffect(() => {
    if (admin) api('roles').then(setRoles).catch(failure => setError(failure.message));
    loadActivity();
  }, [admin]);
  async function grant(email, authorize) {
    setSaving(true);
    setError('');
    try {
      setRoles(await api('roles', { email, authorize }));
      notify(authorize ? 'Manager authorized' : 'Manager access revoked');
      loadActivity();
      return true;
    } catch (failure) {
      setError(failure.message);
      return false;
    } finally { setSaving(false); }
  }
  return <div className="stack">
    <Issue>{error}</Issue>
    {admin && <section className="panel">
      <div className="section-head"><div><h3>Global manager access</h3><p>Authorized Google accounts can create meetups.</p></div><ShieldCheck size={21} /></div>
      <form className="settings-form" onSubmit={async event => {
        event.preventDefault();
        const form = event.currentTarget;
        if (await grant(take(event).email, true)) form.reset();
      }}>
        <Field label="Google account email"><input type="email" name="email" required /></Field>
        <button className="button primary" disabled={saving}
          data-tip="Let this Google account sign in as a manager and create meetups">Authorize manager</button>
      </form>
      {roles?.managers.map(address => <div className="access-row" key={address}><span>{address}</span>
        <button className="button quiet compact" disabled={saving} onClick={() => grant(address, false)}
          data-tip={'Stop ' + address + ' from signing in as a manager'}>Revoke</button></div>)}
    </section>}
    <section className="panel">
      <div className="section-head">
        <div><h3>Activity</h3><p>{admin ? 'Changes across every meetup, plus staff access changes.' : 'Changes across the meetups you manage.'}</p></div>
        <button className="icon-button" aria-label="Refresh activity" data-tip="Load the latest activity" onClick={loadActivity}><RefreshCw size={18} /></button>
      </div>
      {!activity ? <Empty title="Loading activity" />
        : !activity.length ? <Empty title="No activity yet">Changes to your meetups will appear here.</Empty>
          : <div className="history">{activity.map((entry, index) => <ActivityRow key={entry.at + '-' + index} {...entry}
            detail={[entry.meetupName, entry.detail].filter(Boolean).join(' · ')} />)}</div>}
    </section>
  </div>;
}

function Login({ session, error, retry }) {
  const denied = session?.user && !session.user.role;
  // The banner says what the app is; the header carries the one action (sign in, or sign out to switch accounts).
  return <div className="signin">
    <GearBackdrop />
    <header className="signin-bar">
      <Brand />
      <div className="signin-actions">
        {session?.configured && !denied && <a className="button primary" href="/api/auth/login" data-tip="Sign in with your staff Google account">Sign in with Google</a>}
        {denied && <button className="button secondary" data-tip="Sign out so you can use a different Google account" onClick={() => {
          fetch('/api/auth/logout', { method: 'POST' }).then(() => location.assign('/'));
        }}>Sign out</button>}
        {!session && error && <button className="button secondary" onClick={retry} data-tip="Try connecting again">Retry</button>}
      </div>
    </header>
    <main className="signin-main">
      <h1 className="sr-only">BattleScene meetup control</h1>
      <Issue>{error || (denied ? 'Your Google account needs staff access. Contact the super admin.' : '')}</Issue>
      {session && !session.configured && <p className="signin-note">Google sign-in is awaiting deployment configuration.</p>}
      <img className="signin-banner" src={banner} width="1280" height="640"
        alt="BattleScene: run your robot combat event, free. Brackets, arenas, live venue screens and team sign-up." />
    </main>
    <Credit />
  </div>;
}

// How often the open meetup reloads (milliseconds), and how long "untouched" and "unchanged" have to last to slow it.
const IDLE = { normally: 30_000, slowly: 300_000, rarely: 1_800_000, short: 600_000, quiet: 1_800_000, long: 7_200_000 };

export default function Manage() {
  const [session, setSession] = useState(null);
  const [meetups, setMeetups] = useState(null);
  const [meetup, setMeetup] = useState(null);
  const [selected, setSelected] = useState(() => location.pathname.match(/^\/manage\/([a-z0-9-]+)\/?$/)?.[1] ?? '');
  const [section, setSection] = useState(() => selected ? 'overview' : 'meetups');
  const [chosen, setChosen] = useState('');
  const [issue, setIssue] = useState('');
  const [toast, setToast] = useState('');
  const [creating, setCreating] = useState(false);
  const [classEditor, setClassEditor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const selectedRef = useRef(selected);
  const meetupRef = useRef(null);
  meetupRef.current = meetup;
  const toastTimer = useRef();
  const user = session?.user;
  const division = meetup?.divisions.find(item => item.id === chosen) ?? meetup?.divisions[0];
  const classToRemove = classEditor?.remove && meetup?.divisions.find(item => item.id === classEditor.remove);
  const pageName = section === 'overview' ? meetup?.name : sections.find(([key]) => key === section)?.[1];

  function notify(message) {
    if (!message) return;
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }
  async function load() {
    setLoading(true);
    try {
      setIssue('');
      const state = await api('session');
      setSession(state);
      if (state.user?.role) {
        setMeetups(await api('meetups'));
      }
    } catch (error) {
      setIssue(error.message);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); return () => clearTimeout(toastTimer.current); }, []);

  function showSection(key) {
    setSection(key);
    setIssue('');
    const path = key === 'meetups' || (key === 'general' && !selectedRef.current) ? '/' : '/manage/' + selectedRef.current;
    if (location.pathname !== path) history.replaceState(null, '', path);
  }
  function select(key) {
    if (key !== selectedRef.current) {
      selectedRef.current = key;
      setSelected(key);
      setMeetup(null);
      setChosen('');
    }
    showSection('overview');
  }
  function forget(key) {
    setMeetups(list => list && list.filter(item => item.id !== key));
    if (selectedRef.current === key) {
      selectedRef.current = '';
      setSelected('');
      setMeetup(null);
      setChosen('');
    }
    showSection('meetups');
    notify('Meetup deleted');
  }
  function accept(data) {
    if (selectedRef.current === data.id) {
      setMeetup(old => old?.id === data.id && old.revision > data.revision ? old : data);
    }
    const { id, name, date, published, complete, updatedAt, revision } = data;
    setMeetups(list => list && list.map(item => item.id === id && (item.revision ?? -1) <= revision
      ? { id, name, date, published, complete, updatedAt, revision } : item));
  }
  // `fresh` asks the server for an exact read. The regular reload accepts a copy up to 30 seconds old.
  async function refresh(key = selectedRef.current, fresh = false) {
    if (key) accept(await api('meetups/' + key + (fresh ? '?fresh=1' : '')));
  }
  // Reload the open meetup every 30 seconds to pick up other people's changes. Every reload reads storage, so a
  // dashboard that is both untouched and showing a meetup nobody is changing slows down: to every 5 minutes after
  // 10 minutes untouched and 30 minutes unchanged, and to every 30 minutes after 2 hours of both. A meetup that is
  // being run keeps the 30 seconds, and touching the page catches up at once.
  useEffect(() => {
    if (!selected || !user?.role) return;
    let touched = Date.now();
    let loaded = 0;
    function update(showError = false) {
      if (document.hidden) return;
      loaded = Date.now();
      refresh(selected).catch(error => {
        if (showError && selectedRef.current === selected) setIssue(error.message);
      });
    }
    function tick() {
      const now = Date.now();
      const untouched = now - touched;
      const unchanged = now - (meetupRef.current?.updatedAt ?? 0);
      const every = untouched > IDLE.long && unchanged > IDLE.long ? IDLE.rarely
        : untouched > IDLE.short && unchanged > IDLE.quiet ? IDLE.slowly : IDLE.normally;
      if (now - loaded >= every - 1000) update();
    }
    function touch() {
      const away = Date.now() - touched > IDLE.short;
      touched = Date.now();
      if (away) update();
    }
    function shown() {
      touched = Date.now();
      update(true);
    }
    update(true);
    const interval = setInterval(tick, IDLE.normally);
    const signs = ['pointerdown', 'pointermove', 'keydown'];
    for (const sign of signs) window.addEventListener(sign, touch, { passive: true });
    document.addEventListener('visibilitychange', shown);
    return () => {
      clearInterval(interval);
      for (const sign of signs) window.removeEventListener(sign, touch);
      document.removeEventListener('visibilitychange', shown);
    };
  }, [selected, user?.role]);

  async function act(data, notice) {
    if (inFlight.current) throw new Error('A change is already saving.');
    inFlight.current = true;
    setBusy(true);
    setIssue('');
    try {
      const update = await api('meetups/' + meetup.id, { ...data, revision: meetup.revision });
      accept(update);
      notify(notice || 'Saved');
      return update;
    } catch (error) {
      if (!error.details?.affected) setIssue(error.message);
      if (error.status === 409 && !error.details?.affected) await refresh(meetup.id, true).catch(() => {});
      throw error;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function openSection(key, classId) {
    if (classId) setChosen(classId);
    showSection(key);
  }
  function removeClass(classId) {
    setClassEditor({ remove: classId });
  }
  async function create(values) {
    const data = await api('meetups', values);
    setMeetups(list => [data, ...(list ?? [])]);
    select(data.id);
    accept(data);
    notify('Meetup created');
  }
  if (loading) return <div className="standalone"><Brand /><Empty title="Loading meetup control" /><Credit /></div>;
  if (!user?.role) return <Login session={session} error={issue || (new URLSearchParams(location.search).has('login') ? 'Sign-in could not be completed. Try again.' : '')} retry={load} />;

  return <div className="shell">
    <GearBackdrop />
    <aside className="sidebar">
      <Brand />
      <nav className="navigation" aria-label="Meetup management">
        {sectionGroups.map(([group, items]) => <React.Fragment key={group || 'top'}>
          {group && <span className="nav-label nav-group">{group}</span>}
          {items.map(([key, label, Icon, tip]) => <button key={key} aria-current={section === key ? 'page' : undefined}
            disabled={needsMeetup(key) && !selected} onClick={() => showSection(key)}
            data-tip={needsMeetup(key) && !selected ? 'Open a meetup first' : tip}>
            <Icon size={19} /><span>{label}</span>
          </button>)}
        </React.Fragment>)}
      </nav>
      <div className="account">
        <div className="avatar">{user.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</div>
        <div><strong>{user.name}</strong><small>{session.demo ? 'Local demo' : user.role === 'admin' ? 'Super admin' : 'Meetup manager'}</small></div>
        {!session.demo && <button className="icon-button" data-tip="Sign out of BattleScene" aria-label="Sign out" onClick={() => {
          fetch('/api/auth/logout', { method: 'POST' }).then(() => location.assign('/')).catch(() => setIssue('Sign-out failed. Try again.'));
        }}><LogOut size={17} /></button>}
      </div>
    </aside>
    <div className="workspace">
      <main className="main" aria-label={pageName}>
        <Issue>{issue}</Issue>
        {section === 'meetups' ? <MeetupList meetups={meetups} selected={selected} select={select} create={() => setCreating(true)} retry={load} />
          : section === 'general' ? <>
            <header className="workspace-heading"><h1>General settings</h1></header>
            <GeneralSettings user={user} notify={notify} />
          </>
          : !meetup ? <section className="panel"><Empty title={issue ? 'Meetup unavailable' : 'Loading meetup'} /></section>
          : <>
            <MeetupHeading meetup={meetup} overview={section === 'overview'} busy={busy}
              refresh={() => refresh(undefined, true).then(() => notify('Meetup refreshed')).catch(error => setIssue(error.message))}
              publish={() => act({ type: 'publish', published: !meetup.published }, meetup.published ? 'Meetup is private' : 'Spectator pages published').catch(() => {})} />
            {section === 'overview' && <Overview meetup={meetup} choose={id => openSection('arenas', id)}
              addClass={() => setClassEditor({})} act={act} busy={busy} />}
            {section === 'checkin' && <CheckIn meetup={meetup} act={act} busy={busy} openSetup={() => showSection('setup')} />}
            {['arenas', 'brackets'].includes(section) && (!division
              ? <section className="panel"><Empty title="No weight classes yet"
                action={<button className="button primary" onClick={() => showSection('setup')} data-tip="Add weight classes and register robots">Open Robots &amp; classes</button>}>
                Add a weight class and its arena first.</Empty></section>
              : <>
                <div className="class-tool"><WeightTabs divisions={meetup.divisions} selected={division.id} choose={setChosen} arenas={section === 'arenas'} /></div>
                {section === 'arenas' && <ArenaDetails key={division.id} meetup={meetup} division={division} act={act} busy={busy} />}
                {section === 'brackets' && <Brackets key={division.id} meetup={meetup} division={division} act={act} busy={busy} />}
              </>)}
            {section === 'setup' && <div className="stack">
              <ClassesSetup meetup={meetup} user={user} act={act} busy={busy} addClass={() => setClassEditor({})} editClass={setClassEditor}
                removeClass={removeClass} choose={setChosen} selected={division?.id} />
              {division && <Roster key={division.id} meetup={meetup} division={division} act={act} busy={busy} />}
            </div>}
            {section === 'displays' && <Displays key={meetup.id} meetup={meetup} act={act} busy={busy} notify={notify} />}
            {section === 'settings' && <MeetupSettings key={meetup.id} meetup={meetup} user={user} act={act} busy={busy}
              refresh={refresh} onDeleted={forget} />}
          </>}
      </main>
      <Credit />
    </div>
    {toast && <div className="toast" role="status">{toast}</div>}
    {creating && <CreateMeetup close={() => setCreating(false)} save={create} />}
    {classEditor?.remove
      ? classToRemove && <RemoveClassDialog meetup={meetup} division={classToRemove} act={act} busy={busy}
        close={() => setClassEditor(null)} />
      : classEditor && meetup && <ClassDialog meetup={meetup} division={classEditor.id ? classEditor : null} act={act}
        onAdded={id => openSection('setup', id)} close={() => setClassEditor(null)} />}
  </div>;
}
