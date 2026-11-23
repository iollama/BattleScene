export const MAX_VENUE_DISPLAYS = 10;
export const DEFAULT_DISPLAY_LAYOUT = 'ringmaster';

export const DISPLAY_LAYOUTS = {
  ringmaster: 'Ringmaster view',
  ladders: 'All ladders',
  arena: 'Single arena',
  bracket: 'Bracket',
  battle: 'In battle',
};

export const CLASS_DISPLAY_LAYOUTS = ['arena', 'bracket', 'battle'];

export function normalizeDisplayLayout(layout) {
  return layout === 'arenas' ? DEFAULT_DISPLAY_LAYOUT : layout;
}
