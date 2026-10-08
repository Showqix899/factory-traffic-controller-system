import { SIGNAL, STAGE } from '../constants.js';

/** Signals the backend WANTS for a given stage. Everything outside the active phase is RED. */
export function computeDesired(phases, stage, activePhase) {
  const desired = {};
  for (const [key, dirs] of Object.entries(phases)) {
    for (const dir of dirs) {
      const active = stage !== STAGE.ALL_RED && key === activePhase;
      desired[dir] = active ? SIGNAL[stage] : SIGNAL.RED; // SIGNAL.GREEN or SIGNAL.YELLOW
    }
  }
  return desired;
}

/** Invariant: at most one phase may show anything other than RED. Throws if violated. */
export function assertSafeDesired(desired, phases) {
  const live = Object.entries(phases).filter(([, dirs]) => dirs.some((d) => desired[d] !== SIGNAL.RED));
  if (live.length > 1) {
    throw new Error(`UNSAFE signal plan: phases ${live.map(([k]) => k).join(' & ')} are active together`);
  }
}

/**
 * A phase may only be given GREEN when every conflicting direction is CONFIRMED RED
 * by the controller (actual state, not desired state). UNKNOWN is not good enough.
 */
export function canGrantGreen(phases, phase, actual) {
  return Object.entries(phases).every(
    ([key, dirs]) => key === phase || dirs.every((d) => actual[d] === SIGNAL.RED),
  );
}