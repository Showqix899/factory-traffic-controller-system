// Shared vocabulary for the whole domain. No framework imports allowed in /domain.

export const ALL_DIRECTIONS = ['NORTH', 'SOUTH', 'EAST', 'WEST'];

// UNKNOWN = the backend has no confirmation of what the physical signal shows.
export const SIGNAL = Object.freeze({ RED: 'RED', YELLOW: 'YELLOW', GREEN: 'GREEN', UNKNOWN: 'UNKNOWN' });

// Internal junction stage. ALL_RED is the safe clearance between conflicting phases.
export const STAGE = Object.freeze({ GREEN: 'GREEN', YELLOW: 'YELLOW', ALL_RED: 'ALL_RED' });

export const MODE = Object.freeze({
  AUTOMATIC: 'AUTOMATIC',
  MANUAL: 'MANUAL',
  EMERGENCY: 'EMERGENCY',
  FAILURE: 'FAILURE',
});

export const VEHICLE_TYPES = ['FORKLIFT', 'TRUCK', 'EMPLOYEE_VEHICLE', 'EMERGENCY'];
export const DEVICE_TYPES = ['SIGNAL_CONTROLLER', 'SENSOR'];
export const DEVICE_STATUSES = ['ONLINE', 'OFFLINE', 'DEGRADED', 'WARNING', 'UNKNOWN'];

// EMERGENCY > TRUCK > FORKLIFT > EMPLOYEE_VEHICLE (weights feed the scheduling score).
export const VEHICLE_WEIGHT = Object.freeze({ EMERGENCY: 100, TRUCK: 5, FORKLIFT: 3, EMPLOYEE_VEHICLE: 1 });

// Phases are configuration, not hard-coded logic: a junction may define its own.
// Two different phases always conflict.
export const DEFAULT_PHASES = Object.freeze({
  NORTH_SOUTH: ['NORTH', 'SOUTH'],
  EAST_WEST: ['EAST', 'WEST'],
});

// All durations in milliseconds. Overridable per junction (and via env for demos).
export const DEFAULT_TIMING = Object.freeze({
  greenMs: 30000,            // maximum normal green
  minGreenMs: 8000,          // minimum green before the scheduler may switch (avoids flapping)
  yellowMs: 5000,
  allRedMs: 2000,            // clearance time with everything red
  ackTimeoutMs: 3000,        // wait for controller ACK before retrying
  maxRetries: 2,             // retries after the first send (3 attempts total)
  maxWaitMs: 90000,          // a vehicle waiting longer than this makes its phase "starving"
  switchRatio: 1.5,          // other phase must score 1.5x the current to preempt a running green
  agingPerSecond: 0.1,       // score added per vehicle per second of waiting
  emergencyTimeoutMs: 120000, // emergency older than this is considered stale and dropped
  manualTimeoutMs: 300000,   // manual override expires after 5 min
  staleEventMs: 300000,      // sensor events older than this are rejected
});