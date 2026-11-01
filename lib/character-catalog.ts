// Only the original player roster is offered automatically. New characters stay private by default.
export const INITIAL_CHARACTER_NAMES = [
  'Aldrich Ironhart',
  'Corvin Dorian',
  'Toren Hearthlight',
  'Arlen Greyfang',
  'Timo Vhalder',
];
export function characterIsSelectable(title: string, data: Record<string, unknown>) {
  if (Object.hasOwn(data, 'selfSelectable')) return data.selfSelectable === true;
  return INITIAL_CHARACTER_NAMES.includes(title) && typeof data.playerLabel === 'string';
}
