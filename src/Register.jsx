import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, LogOut, Plus, Radio, Trash2 } from 'lucide-react';
import { direction, isLanguage, LANGUAGES } from '../shared/i18n.js';
import { LanguageProvider, useT } from './i18n.jsx';
import { PhotoField } from './PhotoField.jsx';
import { RobotPhoto, Weapon } from './RobotPhoto.jsx';
import { Brand } from './Spectator.jsx';
import { api, Credit, Field, watchLink } from './ui.jsx';

// Team self-registration at /register/<meetupId>/<token>: phone-first, in the meetup's display language with a toggle.
// The language toggle is remembered per meetup, so choosing English on one meetup's page doesn't override another
// meetup's Hebrew default.
const languageKey = meetupId => 'battlescene-register-language:' + meetupId;
const WEAPONS = ['weaponVertical', 'weaponHorizontal', 'weaponDrum', 'weaponFlipper', 'weaponHammer', 'weaponLifter',
  'weaponWedge', 'weaponCrusher', 'weaponShell'];

function storedLanguage(meetupId) {
  try {
    const value = localStorage.getItem(languageKey(meetupId));
    return isLanguage(value) ? value : '';
  } catch {
    return '';
  }
}

const formatDay = (date, language) => new Intl.DateTimeFormat(language === 'he' ? 'he-IL' : 'en', {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
}).format(new Date(date + 'T12:00:00Z'));

function LanguageToggle({ language, choose }) {
  return <div className="language-toggle" role="group" aria-label="Language / שפה">
    {Object.entries(LANGUAGES).map(([key, label]) => <button key={key} type="button" lang={key}
      className={language === key ? 'selected' : ''} aria-pressed={language === key} onClick={() => choose(key)}
      data-tip={key === 'he' ? 'הצגת העמוד בעברית' : 'Show this page in English'}>{key === 'he' ? 'עב' : 'EN'}
      <span className="sr-only">{label}</span></button>)}
  </div>;
}

function Profile({ state, act, back }) {
  const t = useT();
  const [issue, setIssue] = useState('');
  const [busy, setBusy] = useState(false);
  return <form className="register-card stack" onSubmit={async event => {
    event.preventDefault();
    setIssue('');
    setBusy(true);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try { await act({ type: 'profile', phone: data.phone, team: data.team }); back?.(); }
    catch (error) { setIssue(error.message); }
    finally { setBusy(false); }
  }}>
    <div><h2>{t('regProfileTitle')}</h2><p className="register-muted">{t('regProfileHint')}</p></div>
    <Field label={t('regPhone')}><input name="phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" required minLength="6"
      maxLength="24" defaultValue={state.profile?.phone ?? ''} placeholder="050-123-4567" /></Field>
    <Field label={t('regTeamDefault')} hint={t('regTeamDefaultHint')}><input name="team" maxLength="80" autoComplete="organization"
      defaultValue={state.profile?.team ?? ''} /></Field>
    {issue && <div className="issue" role="alert">{issue}</div>}
    <div className="actions">
      <button className="button primary" disabled={busy} data-tip={t('regContinueTip')}>{t('regContinue')}</button>
      {back && <button type="button" className="button quiet" onClick={back} data-tip={t('regBackTip')}>{t('regCancel')}</button>}
    </div>
  </form>;
}

function RobotForm({ state, robot, saved, act, back }) {
  const t = useT();
  const editing = Boolean(robot);
  const start = robot ?? saved ?? {};
  const [team, setTeam] = useState(start.team || state.profile?.team || '');
  const [name, setName] = useState(start.name ?? '');
  const [weapon, setWeapon] = useState(start.weapon ?? '');
  const [photo, setPhoto] = useState(start.photo ?? '');
  const [division, setDivision] = useState(robot?.division ?? '');
  const [issue, setIssue] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const classes = state.meetup.divisions;
  const choosable = item => item.id === robot?.division || (item.open && !robot?.locked);
  async function submit(event) {
    event.preventDefault();
    setIssue('');
    if (!division) return setIssue(t('regChooseClass'));
    setBusy(true);
    try {
      await act(editing
        ? { type: 'edit', robot: robot.id, to: division, team, name, weapon, photo }
        : { type: 'register', division, team, name, weapon, photo, savedId: saved?.id });
      back(t(editing ? 'regSaved' : 'regRegistered', { name }));
    } catch (error) {
      setIssue(error.message);
    } finally {
      setBusy(false);
    }
  }
  const upload = async payload => (await api('garage', payload)).url;
  return <form className="register-card stack" onSubmit={submit}>
    <div className="register-card-head">
      <button type="button" className="icon-button" onClick={() => back()} aria-label={t('regCancel')} data-tip={t('regBackTip')}>
        <ArrowLeft size={19} className="flip-rtl" /></button>
      <h2>{t(editing ? 'regEditTitle' : 'regNewTitle')}</h2>
    </div>
    <Field label={t('regTeam')}><input value={team} onChange={event => setTeam(event.target.value)} maxLength="80" required /></Field>
    <Field label={t('regRobotName')}><input value={name} onChange={event => setName(event.target.value)} maxLength="80" required /></Field>
    <fieldset className="field register-classes">
      <legend>{t('regClass')}</legend>
      <div className="weight-tabs">
        {classes.map(item => <button type="button" key={item.id} className={division === item.id ? 'selected' : ''}
          aria-pressed={division === item.id} disabled={!choosable(item)} onClick={() => setDivision(item.id)}
          data-tip={choosable(item) ? t('regClassTip', { name: item.name }) : t('regClassClosedTip')}>
          <bdi>{item.name}</bdi>{!choosable(item) && <small className="weight-tab-arena">{t('regClosedShort')}</small>}</button>)}
      </div>
      {robot?.locked && <small>{t('regLockedHint')}</small>}
    </fieldset>
    <Field label={t('regWeapon')} hint={t('regWeaponHint')}>
      <input value={weapon} onChange={event => setWeapon(event.target.value)} maxLength="40" list="weapon-examples" />
    </Field>
    <div className="weapon-examples" aria-label={t('regWeaponHint')}>
      {WEAPONS.map(key => <button type="button" key={key} className="chip" onClick={() => setWeapon(t(key))}
        data-tip={t('regWeaponChipTip')}>{t(key)}</button>)}
    </div>
    <datalist id="weapon-examples">{WEAPONS.map(key => <option key={key} value={t(key)} />)}</datalist>
    <div className="field"><span className="field-label">{t('regPhoto')}</span>
      <PhotoField robot={{ id: robot?.id ?? saved?.id ?? name, name }} value={photo} onChange={setPhoto} upload={upload} disabled={busy} /></div>
    {issue && <div className="issue" role="alert">{issue}</div>}
    <div className="actions">
      <button className="button primary" disabled={busy} data-tip={t('regSaveTip')}><Check size={16} />{t('regSave')}</button>
      {editing && !robot.locked && !cancelling && <button type="button" className="button quiet" onClick={() => setCancelling(true)}
        data-tip={t('regCancelEntryTip')}><Trash2 size={15} />{t('regCancelEntry')}</button>}
    </div>
    {cancelling && <div className="register-confirm" role="alertdialog" aria-label={t('regCancelEntry')}>
      <p>{t('regCancelConfirm', { name: robot.name })}</p>
      <div className="actions">
        <button type="button" className="button danger" disabled={busy} data-tip={t('regCancelEntryTip')} onClick={async () => {
          setBusy(true);
          try { await act({ type: 'cancel', robot: robot.id }); back(t('regCancelled', { name: robot.name })); }
          catch (error) { setIssue(error.message); setBusy(false); }
        }}>{t('regCancelYes')}</button>
        <button type="button" className="button quiet" onClick={() => setCancelling(false)} data-tip={t('regKeepTip')}>{t('regKeep')}</button>
      </div>
    </div>}
  </form>;
}

function AddRobot({ state, act, choose, back }) {
  const t = useT();
  const [issue, setIssue] = useState('');
  const available = state.garage.filter(item => !item.entered);
  return <div className="register-card stack">
    <div className="register-card-head">
      <button type="button" className="icon-button" onClick={() => back()} aria-label={t('regCancel')} data-tip={t('regBackTip')}>
        <ArrowLeft size={19} className="flip-rtl" /></button>
      <h2>{t('regAddRobot')}</h2>
    </div>
    {available.length > 0 && <section className="stack">
      <h3 className="overline">{t('regFromGarage')}</h3>
      <div className="register-list">{available.map(saved => <div className="register-robot" key={saved.id}>
        <RobotPhoto robot={saved} size="sm" />
        <div className="register-robot-text"><strong><bdi>{saved.name}</bdi></strong><small><bdi>{saved.team}</bdi></small><Weapon robot={saved} /></div>
        <div className="actions">
          <button className="button primary compact" onClick={() => choose({ saved })} data-tip={t('regGarageAddTip')}>{t('regGarageAdd')}</button>
          <button className="icon-button" aria-label={t('regGarageForget')} data-tip={t('regGarageForget')} onClick={async () => {
            setIssue('');
            try { await act({ type: 'forget', saved: saved.id }); } catch (error) { setIssue(error.message); }
          }}><Trash2 size={16} /></button>
        </div>
      </div>)}</div>
      <p className="register-or"><span>{t('regOr')}</span></p>
    </section>}
    {issue && <div className="issue" role="alert">{issue}</div>}
    <button className="button primary" onClick={() => choose({})} data-tip={t('regNewRobotTip')}><Plus size={17} />{t('regNewRobot')}</button>
  </div>;
}

function Home({ state, open, notice }) {
  const t = useT();
  const { meetup, registration } = state;
  const className = id => meetup.divisions.find(item => item.id === id)?.name ?? '';
  const editOnly = state.entries.length > 0;
  const closedHint = meetup.complete ? 'regComplete' : registration.tokenValid
    ? (editOnly ? 'regClosedHint' : 'regClosedEmpty') : (editOnly ? 'regOldLinkHint' : 'regOldLinkEmpty');
  return <div className="register-card stack">
    {notice && <div className="notice register-notice" role="status"><Check size={16} />{notice}</div>}
    <div><h2>{t('regMyRobots')}</h2>
      {!state.entries.length && <p className="register-muted">{t('regNoRobots')}</p>}</div>
    {state.entries.length > 0 && <div className="register-list">{state.entries.map(entry => <div className="register-robot" key={entry.id}>
      <RobotPhoto robot={entry} size="sm" />
      <div className="register-robot-text"><strong><bdi>{entry.name}</bdi></strong>
        <small><bdi>{entry.team}</bdi> · <bdi>{className(entry.division)}</bdi></small><Weapon robot={entry} /></div>
      <span className={'status ' + (entry.withdrawn ? 'warn' : entry.checkedIn ? 'ready' : '')}>
        {t(entry.withdrawn ? 'withdrawn' : entry.checkedIn ? 'regStatusCheckedIn' : 'regStatusRegistered')}</span>
      <button className="button secondary compact" onClick={() => open({ robot: entry })} data-tip={t('regEditTip', { name: entry.name })}>{t('regEdit')}</button>
    </div>)}</div>}
    {registration.open && registration.tokenValid
      ? <button className="button primary" onClick={() => open({ add: true })} data-tip={t('regAddRobotTip')}><Plus size={17} />{t('regAddRobot')}</button>
      : <p className="register-muted">{t(closedHint)}</p>}
    <div className="register-footer-actions">
      {meetup.published && <a className="button secondary" href={watchLink(meetup.id)} data-tip={t('regLiveViewTip')}><Radio size={16} />{t('regLiveView')}</a>}
      <button className="button quiet compact" onClick={() => open({ profile: true })} data-tip={t('regEditProfileTip')}>{t('regEditProfile')}</button>
    </div>
  </div>;
}

function Closed({ state }) {
  const t = useT();
  const { meetup, registration } = state;
  return <div className="register-card stack">
    <h2>{t('regClosed')}</h2>
    <p className="register-muted">{t(meetup.complete ? 'regComplete' : registration.tokenValid ? 'regClosedEmpty' : 'regOldLinkEmpty')}</p>
    {meetup.published && <div className="register-footer-actions">
      <a className="button secondary" href={watchLink(meetup.id)} data-tip={t('regLiveViewTip')}><Radio size={16} />{t('regLiveView')}</a>
    </div>}
  </div>;
}

function Landing({ state }) {
  const t = useT();
  const { registration } = state;
  const login = '/api/auth/login?as=team&returnTo=' + encodeURIComponent(location.pathname);
  return <div className="register-card stack register-landing">
    <h2>{t(registration.open ? 'regTitle' : 'regClosed')}</h2>
    <p className="register-muted">{t(registration.open ? 'regSignInHint' : 'regClosedSignInHint')}</p>
    <a className="button primary google-button" href={login} data-tip={t('regSignInTip')}>
      <svg viewBox="0 0 48 48" aria-hidden="true" width="20" height="20"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
      {t('regSignIn')}</a>
  </div>;
}

function RegisterPage({ id, token, language, choose, state, setState, error }) {
  const t = useT();
  const [view, setView] = useState({});
  const [notice, setNotice] = useState('');
  const failedLogin = new URLSearchParams(location.search).has('login');
  async function act(data) {
    const next = await api('register/' + id, { token, ...data });
    setState(next);
    return next;
  }
  function open(next) {
    setNotice('');
    setView(next);
    window.scrollTo(0, 0);
  }
  const back = message => { setView({}); setNotice(message ?? ''); window.scrollTo(0, 0); };
  const meetup = state?.meetup;
  let body;
  if (error) body = <div className="register-card stack"><h2>{t(error.status === 404 ? 'regInvalid' : 'regUnavailable')}</h2>
    <p className="register-muted">{error.status === 404 ? t('regInvalidHint') : error.message}</p></div>;
  else if (!state) body = <div className="register-card"><p className="register-muted">{t('regLoading')}</p></div>;
  else if (!state.user) body = <Landing state={state} />;
  // Don't ask for a phone number when there is nothing to register: no open link and no robots here to edit.
  else if (!state.profile?.phone && !view.profile && !state.entries.length
    && !(state.registration.open && state.registration.tokenValid && !state.meetup.complete)) body = <Closed state={state} />;
  else if (!state.profile?.phone || view.profile) body = <Profile state={state} act={act} back={state.profile?.phone ? () => back() : null} />;
  else if (view.add) body = <AddRobot state={state} act={act} back={back} choose={choice => open({ form: true, ...choice })} />;
  else if (view.form || view.robot) body = <RobotForm key={view.robot?.id ?? view.saved?.id ?? 'new'} state={state} robot={view.robot}
    saved={view.saved} act={act} back={back} />;
  else body = <Home state={state} open={open} notice={notice} />;
  return <div className="register" lang={language} dir={direction(language)} style={meetup?.accent ? { '--theme-accent': meetup.accent } : undefined}>
    <header className="register-header">
      <Brand href={meetup?.published ? watchLink(meetup.id) : '#'} />
      <LanguageToggle language={language} choose={choose} />
    </header>
    <main className="register-main">
      {meetup && <div className="register-event">
        {meetup.logo && <img className="register-logo" src={meetup.logo} alt="" />}
        <span className="overline">{t('regEventLabel')}</span>
        <h1><bdi>{meetup.name}</bdi></h1>
        <p className="register-muted">{formatDay(meetup.date, language)}</p>
      </div>}
      {failedLogin && !state?.user && <div className="issue" role="alert">{t('regLoginFailed')}</div>}
      {body}
      {state?.user && <p className="register-account">{t('regSignedInAs', { name: state.user.name || state.user.email })}
        <button className="button quiet compact" data-tip={t('regSignOutTip')} onClick={() => {
          fetch('/api/auth/logout', { method: 'POST' }).finally(() => location.reload());
        }}><LogOut size={15} className="flip-rtl" />{t('regSignOut')}</button></p>}
    </main>
    <Credit />
  </div>;
}

export default function Register({ id, token = '' }) {
  const [choice, setChoice] = useState(() => storedLanguage(id));
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api('register/' + id + '?token=' + encodeURIComponent(token)).then(setState, setError);
  }, [id, token]);
  // Until the meetup loads (or if the link is bad), follow the browser's language.
  const fallback = navigator.language?.startsWith('he') ? 'he' : 'en';
  const meetupLanguage = isLanguage(state?.meetup.language) ? state.meetup.language : '';
  const language = choice || meetupLanguage || fallback;
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  function choose(value) {
    setChoice(value);
    try { localStorage.setItem(languageKey(id), value); } catch { /* Private mode: keep it for this visit only. */ }
  }
  return <LanguageProvider language={language}>
    <RegisterPage id={id} token={token} language={language} choose={choose} state={state} setState={setState} error={error} />
  </LanguageProvider>;
}
