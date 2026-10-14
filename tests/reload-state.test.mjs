import test from 'node:test';
import assert from 'node:assert/strict';
import { beginReload, clearReload, isReloading, reloadDeadline } from '../shared/reload-state.js';

test('each weapon reloads independently and switching guns does not clear another timer', () => {
  const reloads = {};
  beginReload(reloads, 'rifle', 1800);
  beginReload(reloads, 'pistol', 900);
  assert.equal(isReloading(reloads, 'rifle', 800), true);
  assert.equal(isReloading(reloads, 'pistol', 800), true);
  clearReload(reloads, 'pistol');
  assert.equal(isReloading(reloads, 'pistol', 800), false);
  assert.equal(isReloading(reloads, 'rifle', 800), true);
  assert.equal(reloadDeadline(reloads, 'rifle'), 1800);
});

test('reload helper ignores malformed deadlines and unknown weapon IDs safely', () => {
  const reloads = { rifle: 'not-a-time' };
  assert.equal(reloadDeadline(reloads, 'rifle'), 0);
  assert.equal(isReloading(reloads, 'rifle', 20), false);
  assert.equal(isReloading(reloads, 'does-not-exist', 20), false);
  assert.equal(beginReload(reloads, '', 100), reloads);
  assert.equal(beginReload(reloads, 'pistol', NaN), reloads);
});
