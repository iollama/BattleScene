import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { gearPath } from './Gear.jsx';
import { useT } from './i18n.jsx';
import { Empty, findRobot, formatName, groupRounds, matchStatus, pendingRound, slotLabel, watchLink } from './ui.jsx';

// Rounds with more battles than this wrap into extra columns (and lose their wires) so big brackets stay on screen.
const MATCHES_PER_COLUMN = 8;

function ladderRoundName(division, round, t) {
  if (round.key.startsWith('L')) return t('losersRound', { round: round.key.slice(1) });
  if (division.format === 'double' && round.key.startsWith('W')) return t('winnersRound', { round: round.key.slice(1) });
  return round.name;
}

function LadderSlot({ division, match, index }) {
  const t = useT();
  const entrant = match.entrants[index];
  const source = match.slots[index];
  const robot = findRobot(division, entrant);
  const name = slotLabel(division, match, index, t);
  if (!robot) {
    const feeder = ['winner', 'loser'].includes(source?.kind) && entrant == null;
    return <span className="ladder-slot ladder-tbd" title={name}>{feeder ? t(source.kind === 'winner' ? 'feederWinner' : 'feederLoser', { match: source.id })
      : match.state === 'bye' && match.side !== 'R' ? t('bye') : name}</span>;
  }
  const won = Boolean(match.winner && entrant === match.winner);
  const lost = Boolean(match.winner && !won && match.state === 'done');
  const title = match.state === 'bye' ? 'nameAdvances' : won ? 'nameWinner' : robot.withdrawn ? 'nameWithdrawn' : '';
  const className = won ? 'ladder-winner' : robot.withdrawn ? 'ladder-withdrawn' : lost ? 'ladder-loser' : '';
  return <bdi className={'ladder-slot ' + className} title={title ? t(title, { name }) : name}>{name}</bdi>;
}

function LadderMatch({ division, match }) {
  const t = useT();
  return <div className="ladder-match" data-match={match.id} data-state={match.state} title={match.id + ' · ' + matchStatus(match, t)}>
    <span className="ladder-match-id">{match.id}</span>
    {match.state === 'void'
      ? <span className="ladder-slot ladder-tbd">{t('statusNoMatch')}</span>
      : [0, 1].map(index => <LadderSlot key={index} division={division} match={match} index={index} />)}
  </div>;
}

// Wires join a battle to the battles its winners came from, when those sit in the column just before it.
// Losers-bracket drops and the winners final feeding the grand final are not wired; their slots name the source.
function ladderLinks(rounds) {
  const links = [];
  rounds.forEach((round, position) => {
    const previous = rounds[position - 1];
    if (!previous || round.columns > 1 || previous.columns > 1) return;
    const sources = new Map(previous.matches.map(match => [match.id, match]));
    for (const match of round.matches) {
      for (const slot of match.slots) {
        const source = slot.kind === 'winner' && sources.get(slot.id);
        if (!source || source.state === 'void') continue;
        const state = source.state === 'running' ? 'hot' : ['done', 'bye'].includes(source.state) ? 'done' : '';
        links.push({ from: source.id, to: match.id, state });
      }
    }
  });
  return links;
}

function useWires(board, links) {
  const [wiring, setWiring] = useState(null);
  useLayoutEffect(() => {
    const element = board.current;
    if (!element || !links.length) {
      setWiring(null);
      return;
    }
    function measure() {
      const boxes = new Map([...element.querySelectorAll('[data-match]')].map(node => [node.dataset.match, node]));
      // Right to left, earlier rounds sit to the right, and a scrolling ladder overflows to the left of its box.
      // The wire layer is pinned to the start (right) edge, so x is measured from its left edge, `origin`.
      const rtl = getComputedStyle(element).direction === 'rtl';
      const origin = rtl ? element.clientWidth - element.scrollWidth : 0;
      const wires = [];
      const joints = new Map();
      for (const link of links) {
        const source = boxes.get(link.from);
        const target = boxes.get(link.to);
        if (!source || !target) continue;
        const startX = (rtl ? source.offsetLeft : source.offsetLeft + source.offsetWidth) - origin;
        const startY = source.offsetTop + source.offsetHeight / 2;
        const endX = (rtl ? target.offsetLeft + target.offsetWidth : target.offsetLeft) - origin;
        const endY = target.offsetTop + target.offsetHeight / 2;
        const middle = Math.round((startX + endX) / 2);
        wires.push({ key: link.from + '-' + link.to, state: link.state, path: `M${startX} ${startY}H${middle}V${endY}H${endX}` });
        const joint = joints.get(link.to) ?? { key: link.to, x: middle, y: endY, hot: false, feeds: 0 };
        joint.hot ||= link.state === 'hot';
        joint.feeds++;
        joints.set(link.to, joint);
      }
      // A gear sits where two wires merge; a single feed stays a plain line.
      const merges = [...joints.values()].filter(joint => joint.feeds > 1);
      const next = { width: element.scrollWidth, height: element.scrollHeight, wires, joints: merges };
      setWiring(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    let live = true;
    document.fonts?.ready.then(() => live && measure());
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [board, links]);
  return wiring;
}

function LadderRounds({ division, rounds, columns, RoundHeading }) {
  const t = useT();
  const board = useRef(null);
  const links = useMemo(() => ladderLinks(rounds), [rounds]);
  const wiring = useWires(board, links);
  return <div className="ladder-rounds" ref={board} style={{ '--round-columns': columns }}>
    {wiring && <svg className="ladder-wires" width={wiring.width} height={wiring.height} aria-hidden="true">
      {wiring.wires.map(wire => <path key={wire.key} className={'ladder-wire ' + wire.state} d={wire.path} />)}
      {wiring.joints.map(joint => <path key={joint.key} className={'ladder-joint' + (joint.hot ? ' hot' : '')} fillRule="evenodd"
        d={gearPath(joint.x, joint.y, 8, 5.8, 8, 2.4)} />)}
    </svg>}
    {rounds.map(round => <div className="ladder-round" key={round.key} style={{ gridColumn: 'span ' + round.columns }}>
      <RoundHeading>{ladderRoundName(division, round, t)}</RoundHeading>
      <div className="ladder-round-matches"
        style={{ '--match-columns': round.columns, '--match-rows': Math.ceil(round.matches.length / round.columns) }}>
        {round.matches.map(match => <LadderMatch key={match.id} division={division} match={match} />)}
      </div>
      {round.pending && <p className="ladder-pending ladder-round-note">
        {t(round.matches.length ? 'morePairings' : 'pairsLater', { round: round.pending - 1 })}</p>}
    </div>)}
  </div>;
}

function LadderLane({ meetup, division, rounds, columns, headingLevel }) {
  const t = useT();
  const ClassHeading = 'h' + headingLevel;
  const RoundHeading = 'h' + (headingLevel + 1);
  const champion = findRobot(division, division.placements[0]?.ids[0]);
  return <section className="ladder-lane" aria-label={t('ladderLabel', { name: division.name })} data-wide={columns > 4 ? '' : undefined}>
    <div className="ladder-heading">
      <ClassHeading><a href={watchLink(meetup.id, 'bracket', division.id)}>{division.name}</a></ClassHeading>
      <span>{formatName(division.format, t)}</span>
      {champion && <span className="ladder-champion">{t('champion', { name: '⁨' + champion.name + '⁩' })}</span>}
    </div>
    {rounds.length
      ? <LadderRounds division={division} rounds={rounds} columns={columns} RoundHeading={RoundHeading} />
      : <p className="ladder-pending">{t('bracketPending')}</p>}
  </section>;
}

export function SpectatorLadders({ meetup, headingLevel = 2 }) {
  const t = useT();
  const ladders = useMemo(() => meetup.divisions.map(division => {
    const rounds = groupRounds(division, t).map(round => ({ ...round, columns: Math.ceil(round.matches.length / MATCHES_PER_COLUMN) }));
    // Rounds format: the next round is only paired once the current one ends, so show where it will appear.
    const pending = pendingRound(division);
    const partial = pending?.partial && rounds.find(round => round.key === 'R' + pending.round);
    if (partial) partial.pending = pending.round;
    else if (pending) rounds.push({ key: 'R' + pending.round, name: t('roundNumber', { round: pending.round }), matches: [], columns: 1, pending: pending.round });
    return { division, rounds, columns: rounds.reduce((total, round) => total + round.columns, 0) };
  }), [meetup.divisions, t]);
  if (!ladders.length) {
    return <Empty title={t('laddersSoon')}>{t('laddersSoonHint')}</Empty>;
  }
  const widest = Math.max(...ladders.map(ladder => ladder.columns));
  return <div className="spectator-ladders" style={{ '--ladder-columns': widest }}>
    {ladders.map(ladder => <LadderLane key={ladder.division.id} meetup={meetup} headingLevel={headingLevel} {...ladder} />)}
  </div>;
}
