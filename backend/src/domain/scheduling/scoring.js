import { VEHICLE_WEIGHT } from '../constants.js';

// A direction whose sensor is offline has unknown demand: give it a small baseline
// so its phase still gets served occasionally (limited fallback, see ASSUMPTIONS.md).
const SENSOR_OFFLINE_BASELINE = 3;

/**
 * Score of a phase = sum over waiting vehicles of (type weight + waiting seconds * aging).
 * Queue size counts naturally (more vehicles => bigger sum), vehicle type via weight,
 * waiting time via aging.
 */
export function phaseScore(dirs, queues, now, sensors, timing) {
  let score = 0;
  for (const dir of dirs) {
    for (const v of queues[dir]) {
      score += (VEHICLE_WEIGHT[v.type] ?? 1) + ((now - v.arrivedAt) / 1000) * timing.agingPerSecond;
    }
    if (sensors[dir] === 'OFFLINE') score += SENSOR_OFFLINE_BASELINE;
  }
  return score;
}

/** Longest time (ms) any vehicle in these directions has waited. Used for starvation protection. */
export function oldestWaitMs(dirs, queues, now) {
  let max = 0;
  for (const dir of dirs) for (const v of queues[dir]) max = Math.max(max, now - v.arrivedAt);
  return max;
}