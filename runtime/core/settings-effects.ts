import type { Settings } from '../shared/contracts';

/** Work to do once a validated patch is applied; unrelated changes cause no cancellations. */
export function settingsEffects(before: Settings, after: Settings, lockdown = false, now = Date.now()) {
  const modeChanged = before.companionMode !== after.companionMode;
  const enteringRest = modeChanged && after.companionMode === 'rest';
  const observationStopped = before.observationEnabled && !after.observationEnabled;
  const clipboardStopped = before.clipboardEnabled && !after.clipboardEnabled;
  const screenStopped = before.screenCaptureEnabled && !after.screenCaptureEnabled;
  const titlesStopped = before.windowTitlesEnabled && !after.windowTitlesEnabled;
  const policyChanged =
    JSON.stringify(before.forbiddenPaths || []) !== JSON.stringify(after.forbiddenPaths || []) ||
    JSON.stringify(before.sandbox) !== JSON.stringify(after.sandbox);
  const quietStarted = after.quietUntil > now && after.quietUntil !== before.quietUntil;
  const initiativeStopped = before.initiativeEnabled && !after.initiativeEnabled;
  const forgetObservation = enteringRest || observationStopped || lockdown;
  return {
    modeChanged,
    policyChanged,
    observationStopped,
    initiativeStopped,
    quietStarted,
    forgetObservation,
    clearBrowser: forgetObservation || titlesStopped,
    clearClipboard: forgetObservation || clipboardStopped,
    resetSampler:
      forgetObservation ||
      screenStopped ||
      modeChanged ||
      initiativeStopped ||
      JSON.stringify(before.captureBlocklist) !== JSON.stringify(after.captureBlocklist),
    invalidateLocal:
      forgetObservation ||
      policyChanged ||
      before.researchDeepAccess !== after.researchDeepAccess ||
      JSON.stringify(before.captureBlocklist) !== JSON.stringify(after.captureBlocklist),
    invalidateAttention:
      modeChanged ||
      observationStopped ||
      initiativeStopped ||
      quietStarted ||
      lockdown ||
      clipboardStopped ||
      screenStopped ||
      titlesStopped ||
      JSON.stringify(before.captureBlocklist) !== JSON.stringify(after.captureBlocklist),
    resumeAttention:
      after.companionMode === 'daily' &&
      after.initiativeEnabled &&
      (modeChanged ||
        !before.initiativeEnabled ||
        (!before.observationEnabled && after.observationEnabled) ||
        (before.quietUntil > now && after.quietUntil <= now)),
  };
}
