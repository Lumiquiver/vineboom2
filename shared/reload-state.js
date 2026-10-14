/** Per-weapon reload deadlines. Switching weapons never cancels or blocks another weapon's reload. */
export function reloadDeadline(reloads, weaponId) {
  const value = Number(reloads?.[weaponId] || 0);
  return Number.isFinite(value) ? value : 0;
}
export function beginReload(reloads, weaponId, endsAt) {
  if (!weaponId || !Number.isFinite(Number(endsAt))) return reloads;
  reloads[weaponId] = Number(endsAt);
  return reloads;
}
export function clearReload(reloads, weaponId) {
  if (reloads && weaponId) delete reloads[weaponId];
  return reloads;
}
export function isReloading(reloads, weaponId, now = Date.now()) {
  return reloadDeadline(reloads, weaponId) > now;
}
