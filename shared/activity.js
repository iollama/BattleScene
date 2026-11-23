// Human-readable wording for audit entries, shared by the staff dashboard and the activity feed API.

const titles = {
  authorizeManager: 'Manager authorized',
  revokeManager: 'Manager access revoked',
  removeDivision: 'Weight class removed',
  deleteMeetup: 'Meetup deleted',
  demoData: 'Demo data added',
  teamRegister: 'Team registered a robot',
  teamEdit: 'Team updated a robot',
  teamCancel: 'Team cancelled a robot',
  teamContact: 'Team updated its phone number',
};

function entryTitle(entry) {
  if (entry.type === 'complete') return entry.complete === false ? 'Meetup reopened' : 'Meetup completed';
  if (entry.type === 'arenaStatus') return entry.active ? 'Arena activated' : 'Arena deactivated';
  if (entry.type === 'result') return entry.previous ? 'Result corrected' : 'Result saved';
  if (entry.type === 'registration') {
    return entry.regenerated ? 'Registration link regenerated' : entry.open ? 'Team registration opened' : 'Team registration closed';
  }
  return titles[entry.type] ?? entry.type.replace(/[A-Z]/g, char => ' ' + char.toLowerCase()).replace(/^./, char => char.toUpperCase());
}

// `meetup` is the meetup the entry belongs to, or null for staff-access entries.
export function describeActivity(entry, meetup) {
  if (!meetup) return { title: entryTitle(entry), detail: entry.email ?? entry.name ?? '' };
  const division = meetup.divisions.find(item => item.id === entry.division);
  const winner = value => division?.robots.find(item => item.id === value?.winner)?.name ?? 'Unknown robot';
  const result = entry.type === 'result'
    ? entry.previous ? winner(entry.previous) + ' to ' + winner(entry.result) : winner(entry.result)
    : null;
  const moved = entry.to && meetup.divisions.find(item => item.id === entry.to);
  const detail = [division?.name ?? entry.divisionName, moved && 'to ' + moved.name, entry.robotName, entry.classes?.join(', '),
    entry.classes && entry.robots + ' robots', entry.arena, entry.match, result, entry.email,
    entry.rollback?.length ? 'Rolled back ' + entry.rollback.map(item => item.id).join(', ') : null]
    .filter(Boolean).join(' · ');
  return { title: entryTitle(entry), detail };
}
