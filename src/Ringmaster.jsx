import React from 'react';
import { isArenaActive } from '../server/bracket.js';
import { SpectatorLadders } from './SpectatorLadders.jsx';
import { Pair } from './Tournament.jsx';
import { Countdown, findMatch, matchup, watchLink } from './ui.jsx';
import { calledMatch, LastCall } from './LastCall.jsx';
import { useT } from './i18n.jsx';

function ArenaLabel({ division, href }) {
  return <div className="ringmaster-arena">
    <h3>{href ? <a href={href}>{division.arena}</a> : division.arena}</h3><span>{division.name}</span>
  </div>;
}

export default function Ringmaster({ meetup }) {
  const t = useT();
  const activeBattles = meetup.divisions.filter(isArenaActive)
    .map(division => ({ division, match: findMatch(division, division.current) }))
    .filter(({ match }) => match);
  const lastCalls = meetup.divisions.filter(isArenaActive)
    .map(division => ({ division, match: calledMatch(division) }))
    .filter(({ match }) => match);
  const hasActiveBattles = activeBattles.length + lastCalls.length > 0;

  return <div className="ringmaster">
    <section className="ringmaster-active" data-active={hasActiveBattles} aria-labelledby="ringmaster-live">
      <h2 id="ringmaster-live" className="ringmaster-heading">{t('activeBattles')}</h2>
      {hasActiveBattles ? <div className="ringmaster-live">
        {activeBattles.map(({ division, match }) => <article className="ringmaster-card" key={division.id}>
          <ArenaLabel division={division} />
          <div className="ringmaster-faceoff">
            <Pair division={division} match={match} />
            <Countdown timer={match.timer} dial />
          </div>
        </article>)}
        {lastCalls.map(({ division, match }) => <article className="ringmaster-card ringmaster-call" key={'call-' + division.id}>
          <LastCall division={division} match={match} variant="card" />
        </article>)}
      </div> : <p className="ringmaster-card ringmaster-empty">{t('noBattlesInProgress')}</p>}
    </section>
    <section aria-labelledby="ringmaster-ladders">
      <h2 id="ringmaster-ladders" className="ringmaster-heading">{t('allLadders')}</h2>
      <SpectatorLadders meetup={meetup} headingLevel={3} />
    </section>
    <section aria-labelledby="ringmaster-next">
      <h2 id="ringmaster-next" className="ringmaster-heading">{t('nextBattles')}</h2>
      {meetup.divisions.length ? <div className="ringmaster-grid">
        {meetup.divisions.map(division => {
          const active = isArenaActive(division);
          const pairing = active ? matchup(division, findMatch(division, division.next), t) : null;
          return <article className="ringmaster-card" key={division.id}>
            <ArenaLabel division={division} href={watchLink(meetup.id, 'arena', division.id)} />
            {pairing ? <p className="ringmaster-next-pair">{pairing}</p>
              : <p className="ringmaster-empty">{t(active ? 'noBattleReady' : 'arenaInactive')}</p>}
          </article>;
        })}
      </div> : <p className="ringmaster-card ringmaster-empty">{t('noArenas')}</p>}
    </section>
  </div>;
}
