import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize, Radio, Swords } from 'lucide-react';
import { GearMark } from './Gear.jsx';
import { calledMatch, LastCall } from './LastCall.jsx';
import { isArenaActive } from '../server/bracket.js';
import { DEFAULT_DISPLAY_LAYOUT, normalizeDisplayLayout } from '../shared/displays.js';
import { DEFAULT_LANGUAGE, direction, isLanguage } from '../shared/i18n.js';
import { LanguageProvider, useT } from './i18n.jsx';
import { ArenaDetails, WeightTabs } from './Tournament.jsx';
import Ringmaster from './Ringmaster.jsx';
import { SpectatorLadders } from './SpectatorLadders.jsx';
import { RobotPhoto, usePreload, Weapon } from './RobotPhoto.jsx';
import { api, BracketBoard, Countdown, Credit, Empty, findMatch, findRobot, matchup, Placements, QRAction, Standings, watchLink, wordFit } from './ui.jsx';

export function Brand({ href = '/' }) {
  return <a className="brand" href={href}><span className="brand-icon"><GearMark /></span>
    <span>Battle<span>Scene</span></span></a>;
}

function Battle({ division }) {
  const t = useT();
  const current = findMatch(division, division.current);
  const next = findMatch(division, division.next);
  const called = calledMatch(division);
  if (!current && called) return <div className="battle-idle battle-call"><LastCall division={division} match={called} variant="venue" /></div>;
  if (!current) return <div className="battle-idle">
    <Swords size={48} /><span className="overline">{t('nextBattle')}</span>
    <h2>{next ? matchup(division, next, t) : t('waitingForMatchup')}</h2>
  </div>;
  const [first, second] = current.entrants.map(id => findRobot(division, id));
  const side = (robot, key) => <div className={'battle-team ' + key}>
    <RobotPhoto robot={robot} size="lg" />
    <span><bdi>{robot.team}</bdi></span><h2 style={wordFit(robot.name)}><bdi>{robot.name}</bdi></h2><Weapon robot={robot} />
  </div>;
  return <div className="battle">
    <div className="battle-live"><span className="status active"><i />{t('statusInBattle')}</span></div>
    <div className="battle-faceoff">
      {side(first, 'side-one')}
      <div className="battle-center"><div className="battle-versus">{t('versus')}</div><Countdown timer={current.timer} className="battle-clock" dial /></div>
      {side(second, 'side-two')}
    </div>
  </div>;
}

function SpectatorStage({ children, preview }) {
  const frame = useRef(null);
  const content = useRef(null);
  useLayoutEffect(() => {
    if (preview) return;
    const stage = frame.current;
    const page = content.current;
    function measure() {
      const width = page.scrollWidth;
      const height = page.scrollHeight;
      if (!width || !height || !stage.clientHeight) return;
      const scale = Math.min(1, stage.clientWidth / width, stage.clientHeight / height);
      // Right to left, the content scales from its right edge (styles.css), so it centres by moving left.
      const offset = (stage.clientWidth - width * scale) / 2 * (getComputedStyle(page).direction === 'rtl' ? -1 : 1);
      page.style.setProperty('--screen-fit', 'translateX(' + offset + 'px) scale(' + scale + ')');
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    observer.observe(page);
    return () => observer.disconnect();
  }, [preview, children]);
  const Content = preview ? 'div' : 'main';
  return <div className="spectator-stage" ref={frame}>
    <Content className="spectator-content" ref={content}>{children}</Content>
  </div>;
}

export function SpectatorContent({ meetup, ...props }) {
  const language = isLanguage(meetup.language) ? meetup.language : DEFAULT_LANGUAGE;
  return <LanguageProvider language={language}><SpectatorPage meetup={meetup} language={language} {...props} /></LanguageProvider>;
}

function SpectatorPage({ meetup, language, view = '', item = '', preview = false, stale = false }) {
  const t = useT();
  const { theme } = meetup;
  const screenId = view === 'screen' ? item : !view ? meetup.spectatorScreenId : null;
  const screen = meetup.screens.find(entry => entry.id === screenId);
  const layout = normalizeDisplayLayout(screen?.layout ?? (view || DEFAULT_DISPLAY_LAYOUT));
  const requested = screen?.division || item;
  const [tab, setTab] = useState('');
  const division = meetup.divisions.find(entry => entry.id === (tab || requested)) ?? meetup.divisions[0];
  const currentClass = meetup.divisions.find(entry => entry.id === requested) ?? (preview ? division : null);
  const selected = layout === 'bracket' ? division : currentClass;
  const isVenue = Boolean(screen) || layout === 'battle';
  const qr = screen?.qr ?? ((layout === 'arena' || layout === 'battle') ? selected?.qr : null) ?? meetup.qr;
  const EventName = preview ? 'strong' : 'h1';
  const style = { '--theme-accent': theme.accent, '--theme-background': theme.background,
    '--theme-text': theme.tone === 'dark' ? '#15181a' : '#f5f6f7',
    '--theme-panel': theme.tone === 'dark' ? 'rgb(255 255 255 / 87%)' : 'rgb(24 32 42 / 92%)' };
  const missing = (view === 'screen' && !screen) || (['arena', 'battle'].includes(layout) && !selected);
  const inactiveArena = ['arena', 'battle'].includes(layout) && selected && !isArenaActive(selected);
  // Fetch the photos of the robots in each arena's current and next battle before they are needed on screen.
  usePreload(meetup.divisions.flatMap(entry => [entry.current, entry.next].flatMap(key => findMatch(entry, key)?.entrants ?? []))
    .map(robotId => meetup.divisions.flatMap(entry => entry.robots).find(robot => robot.id === robotId)?.photo));
  return <div className={'spectator ' + (isVenue ? 'venue ' : '') + (preview ? 'spectator-preview ' : '') + 'tone-' + theme.tone}
    style={style} data-layout={layout} lang={language} dir={direction(language)}>
    <div className="spectator-wrap">
      <header className="spectator-header">
        <div className="spectator-identity">
          <Brand href={watchLink(meetup.id)} />
          <EventName className="spectator-event">{meetup.name}</EventName>
          {theme.logo && <img className="spectator-logo" src={theme.logo} alt="" />}
        </div>
        <div className="actions spectator-actions">
          {stale && <span className="status warn" role="status"><Radio size={15} />{t('connectionLost')}</span>}
          {meetup.complete && <span className="status ready">{t('eventComplete')}</span>}
          {!preview && <button className="icon-button fullscreen" aria-label={t('toggleFullscreen')} data-tip={t('fullscreenTip')} onClick={() => {
            if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
            else document.documentElement.requestFullscreen?.().catch(() => {});
          }}><Maximize size={20} /></button>}
          {!missing && <QRAction action={qr} />}
        </div>
      </header>
      <SpectatorStage preview={preview}>
        {missing ? <Empty title={t('displayUnavailable')}>{t('displayUnavailableHint')}</Empty> : <>
          {layout === 'ladders' && <SpectatorLadders meetup={meetup} />}
          {layout === 'ringmaster' && <Ringmaster meetup={meetup} />}
          {inactiveArena && <section className="panel"><Empty title={t('arenaInactive')}>{t('arenaInactiveHint')}</Empty></section>}
          {layout === 'arena' && !inactiveArena && <ArenaDetails meetup={meetup} division={selected} publicView />}
          {layout === 'battle' && !inactiveArena && <Battle division={selected} />}
          {layout === 'bracket' && <>
            {!screen && <WeightTabs divisions={meetup.divisions} selected={division?.id} choose={setTab} />}
            <section className="panel spectator-bracket"><BracketBoard division={division} focus={screen?.rounds} /></section>
            <Standings division={division} />
            <Placements division={division} />
          </>}
        </>}
      </SpectatorStage>
      {!preview && <Credit />}
    </div>
  </div>;
}

export default function Spectator({ id, view, item }) {
  const [meetup, setMeetup] = useState(null);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  // Venue screens open display and in-battle links, so they refresh fast. Phones use the public link
  // and other spectator views, which refresh slower to keep CDN traffic down.
  const interval = view === 'screen' || view === 'battle' ? 2000 : 5000;
  useEffect(() => {
    let active = true;
    let reading = false;
    let refresh;
    async function poll() {
      if (reading || document.hidden) return;
      reading = true;
      try {
        const update = await api('watch/' + id);
        if (!active) return;
        setMeetup(prior => prior && prior.revision > update.revision ? prior : update);
        setError('');
        setStale(false);
      } catch (failure) {
        if (!active) return;
        if (failure.status === 404) setMeetup(null);
        setError(failure.message);
        setStale(true);
      } finally {
        reading = false;
      }
    }
    function offline() { setStale(true); }
    function begin() {
      clearInterval(refresh);
      if (!document.hidden) {
        poll();
        refresh = setInterval(poll, interval);
      }
    }
    begin();
    window.addEventListener('online', begin);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', begin);
    return () => {
      active = false;
      clearInterval(refresh);
      window.removeEventListener('online', begin);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', begin);
    };
  }, [id, interval]);
  if (meetup) return <SpectatorContent meetup={meetup} view={view} item={item} stale={stale} />;
  return <div className="standalone"><Brand /><Empty title={error ? 'Meetup unavailable' : 'Loading meetup'}>{error}</Empty><Credit /></div>;
}
