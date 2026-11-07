import type { AppSnapshot, Observation, Settings } from '../shared/contracts';
import { localDay } from './daily';
import { inQuietHours } from './settings';

export function initiativeBlock(
  state: AppSnapshot,
  now: number,
  closed: boolean,
  reachable: boolean,
  userReminder = false,
) {
  const s = state.settings,
    observation = state.observation;
  if (closed) return 'closed';
  if (s.companionMode === 'rest') return 'rest';
  if (!state.provider.configured) return 'not-configured';
  if (state.identity.onboarding !== 'ready') return 'onboarding';
  if (s.quietUntil > now) return 'quiet';
  if (inQuietHours(s, now)) return 'quiet-hours';
  if (s.observationEnabled && (observation.locked || observation.suspended) && !reachable) return 'locked';
  if (!userReminder && s.companionMode === 'focus') return 'focus';
  if (!userReminder && !s.initiativeEnabled) return 'initiative-disabled';
  return undefined;
}

export function idleObservationReady(s: Settings, obs: Observation, now: number) {
  const age = now - Date.parse(obs.observedAt);
  return (
    s.observationEnabled &&
    obs.available &&
    !obs.fullscreen &&
    !obs.locked &&
    !obs.suspended &&
    (obs.idleSeconds || 0) >= 300 &&
    age >= -5000 &&
    age <= 15000
  );
}

export function pacingBlock(s: Settings, attempts: number[], now: number, factor: number) {
  if (now - (attempts.at(-1) || 0) < s.proactiveIntervalMinutes * 60000 * factor) return 'interval';
  if (attempts.filter((t) => now - t < 3600_000).length >= s.proactiveHourlyLimit) return 'hourly-limit';
  const today = localDay(now);
  if (attempts.filter((t) => localDay(t) === today).length >= s.proactiveDailyLimit) return 'daily-limit';
  return undefined;
}
