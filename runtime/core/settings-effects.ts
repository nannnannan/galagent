import type { Settings } from '../shared/contracts';

/** Work to do once a validated patch is applied; unrelated changes cause no cancellations. */
export function settingsEffects(before: Settings, after: Settings, lockdown = false, now = Date.now()) {
  const modeChanged = before.companionMode !== after.companionMode;
  const enteringRest = modeChanged && after.companionMode === 'rest';
  const observationStopped = before.observationEnabled && !after.observationEnabled;
  const clipboardStopped = before.clipboardEnabled && !after.clipboardEnabled;
  const screenStopped = before.screenCaptureEnabled && !after.screenCaptureEnabled;
  const titlesStopped = before.windowTitlesEnabled && !after.windowTitlesEnabled;
  const connections = (settings: Settings) => (settings.mcpServers || []).map(({ researchTools: _tools, ...server }) => server);
  const policyChanged =
    JSON.stringify(before.forbiddenPaths || []) !== JSON.stringify(after.forbiddenPaths || []) ||
    JSON.stringify(before.sandbox) !== JSON.stringify(after.sandbox) ||
    JSON.stringify(connections(before)) !== JSON.stringify(connections(after));
  const quietStarted = after.quietUntil > now && after.quietUntil !== before.quietUntil;
  const quietHoursChanged = JSON.stringify(before.quietHours) !== JSON.stringify(after.quietHours);
  const blocklistChanged = JSON.stringify(before.captureBlocklist) !== JSON.stringify(after.captureBlocklist);
  const initiativeStopped = before.initiativeEnabled && !after.initiativeEnabled;
  const forgetObservation = enteringRest || observationStopped || lockdown;
  return {
    modeChanged,
    policyChanged,
    observationStopped,
    initiativeStopped,
    quietStarted,
    forgetObservation,
    clearBrowser: forgetObservation || titlesStopped || blocklistChanged,
    clearClipboard: forgetObservation || clipboardStopped,
    resetSampler:
      forgetObservation ||
      screenStopped ||
      modeChanged ||
      initiativeStopped ||
      blocklistChanged,
    invalidateLocal:
      forgetObservation ||
      policyChanged ||
      before.researchDeepAccess !== after.researchDeepAccess ||
      blocklistChanged,
    invalidateAttention:
      modeChanged ||
      observationStopped ||
      initiativeStopped ||
      quietStarted ||
      quietHoursChanged ||
      lockdown ||
      clipboardStopped ||
      screenStopped ||
      titlesStopped ||
      blocklistChanged,
    resumeAttention:
      after.companionMode === 'daily' &&
      after.initiativeEnabled &&
      (modeChanged ||
        !before.initiativeEnabled ||
        (!before.observationEnabled && after.observationEnabled) ||
        (before.quietUntil > now && after.quietUntil <= now)),
  };
}
