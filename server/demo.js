// Names for the "Fill with demo data" action. Pure and deterministic, so tests can predict the output.
// Kept free of Node-only imports because the staff dashboard imports MAX_WEIGHT_CLASSES from here.

export const MAX_WEIGHT_CLASSES = 12;

// Local demo mode's team account ("Continue with Google" on /register/foundry/demo).
export const DEMO_TEAM = { email: 'team@battlescene.test', name: 'Sam Rivera', role: null };

const classNames = ['Antweight', 'Beetleweight', 'Featherweight', 'Heavyweight', 'Fleaweight', 'Hobbyweight',
  'Lightweight', 'Middleweight', 'Cruiserweight', 'Nanoweight', 'Plastic Ant', 'Super Heavyweight'];

// 32 × 28 = 896 team names, more than a full meetup (12 classes × 64 robots) can hold.
const teamWords = ['Ironclad', 'Faultline', 'Mako', 'Ember', 'Gearbox', 'Northstar', 'Bench Test', 'Voltage', 'Night Shift',
  'Arc', 'Hammer', 'Horizon', 'Ratchet', 'Rogue', 'Atlas', 'Carbon', 'Redline', 'Block Party', 'Torque', 'Piston',
  'Sprocket', 'Flux', 'Rivet', 'Circuit', 'Cobalt', 'Tungsten', 'Magnet', 'Servo', 'Dynamo', 'Static', 'Titan', 'Copperhead'];
const teamSuffixes = ['Robotics', 'Works', 'Garage', 'Lab', 'Engineering', 'Team', 'Club', 'Collective', 'Machines',
  'Fabrication', 'Mechanics', 'Racing', 'Systems', 'Foundry', 'Workshop', 'Crew', 'Squad', 'Industries', 'Forge',
  'Motors', 'Dynamics', 'Armory', 'Union', 'Guild', 'Bots', 'Makers', 'Outfit', 'Society'];
// 28 × 28 = 784 robot names.
const robotWords = ['Scrap', 'Iron', 'Hot', 'Dead', 'Black', 'Rip', 'Arc', 'Wreck', 'Over', 'Night', 'Steel', 'Rust',
  'Turbo', 'Thunder', 'Razor', 'Blitz', 'Chaos', 'Grim', 'Atomic', 'Mega', 'Hyper', 'Venom', 'Shock', 'Side',
  'Jack', 'Cinder', 'Static', 'Rev'];
const robotNouns = ['Jaw', 'Wire', 'Bolt', 'Lock', 'Tide', 'Flash', 'Ball', 'Drive', 'Crawler', 'Winder', 'Knife', 'Block',
  'Limit', 'Shock', 'Hammer', 'Spinner', 'Fang', 'Wedge', 'Claw', 'Crusher', 'Saw', 'Storm', 'Blade', 'Ram',
  'Breaker', 'Grinder', 'Fury', 'Clamp'];

// Bundled demo renders: public/demo-robots/<n>.svg, drawn by scripts/demo-robots.mjs.
// The weapon each render shows, in file order (1.svg is a wedge, 2.svg a drum spinner, and so on).
const demoWeapons = ['Wedge', 'Drum spinner', 'Vertical spinner', 'Horizontal spinner', 'Flipper', 'Axe',
  'Full-body spinner', 'Lifter', 'Crusher', 'Pusher', 'Invertible wedge', 'Rammer'];
export const DEMO_PHOTO_COUNT = demoWeapons.length;

// A deterministic photo and matching weapon for the index-th demo robot. Every fourth robot has no photo, so the
// mech placeholder shows too.
export function demoLook(index) {
  const render = (index * 5) % DEMO_PHOTO_COUNT;
  const look = { weapon: demoWeapons[render] };
  if (index % 4 !== 3) look.photo = '/demo-robots/' + (render + 1) + '.svg';
  return look;
}

// The index-th pair from two lists, cycling the second list one step further each pass through the first, so
// neighbouring indexes differ in both words. This visits every pair once while gcd(first.length + 1, second.length) is 1.
function pair(first, second, index) {
  const pass = Math.floor(index / first.length);
  return first[index % first.length] + ' ' + second[(index + pass) % second.length];
}

// The next `count` weight-class names that the meetup doesn't use yet.
export function demoClassNames(takenNames, count) {
  const taken = new Set(takenNames.map(name => name.toLowerCase()));
  const names = [];
  for (let index = 0; names.length < count; index++) {
    const name = classNames[index] ?? 'Demo class ' + (index - classNames.length + 1);
    if (!taken.has(name.toLowerCase())) {
      taken.add(name.toLowerCase());
      names.push(name);
    }
  }
  return names;
}

// The first "Arena N" that no class uses yet.
export function nextArenaName(takenArenas) {
  const taken = new Set(takenArenas.map(name => name.toLowerCase()));
  let number = 1;
  while (taken.has('arena ' + number)) number++;
  return 'Arena ' + number;
}

// `count` checked-in robots whose team names don't clash with `takenTeams` or with each other.
export function demoRobots(count, takenTeams) {
  const taken = new Set(takenTeams.map(team => team.toLowerCase()));
  const robots = [];
  const capacity = teamWords.length * teamSuffixes.length;
  for (let index = 0; robots.length < count; index++) {
    const team = index < capacity ? pair(teamWords, teamSuffixes, index) : 'Demo Team ' + (index - capacity + 1);
    if (taken.has(team.toLowerCase())) continue;
    taken.add(team.toLowerCase());
    robots.push({ team, name: pair(robotWords, robotNouns, index), checkedIn: true, ...demoLook(index) });
  }
  return robots;
}
