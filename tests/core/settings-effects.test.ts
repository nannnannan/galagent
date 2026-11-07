import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../../runtime/core/settings';
import { settingsEffects } from '../../runtime/core/settings-effects';

test('pet size does not interrupt work, permission changes do, and lockdown clears even an already paused profile', () => {
 const base = structuredClone(defaults);
 const cosmetic = settingsEffects(base, {...base, petScale:2});
 assert.ok(Object.values(cosmetic).every(value => !value));
 const narrowed = settingsEffects(base, {...base, forbiddenPaths:['fixture-vault']});
 assert.equal(narrowed.policyChanged, true);
 const paused = {...base, observationEnabled:false, clipboardEnabled:false};
 const lockdown = settingsEffects(paused, paused, true);
 assert.ok(lockdown.forgetObservation && lockdown.clearBrowser && lockdown.clearClipboard && lockdown.resetSampler);
 const resting = settingsEffects(base, {...base, companionMode:'rest'});
 assert.ok(resting.invalidateAttention && resting.invalidateLocal);
});
