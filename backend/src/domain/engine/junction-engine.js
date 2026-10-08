import { SIGNAL, STAGE, MODE, DEFAULT_PHASES, DEFAULT_TIMING } from '../constants.js';
import { DomainError } from '../errors.js';
import { computeDesired, assertSafeDesired, canGrantGreen } from '../signals/safety.js';
import { phaseScore, oldestWaitMs } from '../scheduling/scoring.js';

const MAX_TRACKED_COMMANDS = 60;

/**
 * Deterministic, I/O-free state machine for ONE junction.
 *
 * - Time is always passed in (`now`, epoch ms) so tests are fully deterministic.
 * - The engine never talks to the network or database. It records *effects*:
 *     events  -> audit history entries
 *     outbox  -> commands that must be sent to the physical controller
 *   The application layer calls drain() after every operation, persists, then dispatches.
 * - The state is a plain JSON object so it can be persisted and restored as-is.
 *
 * Stage cycle (never skipped, even for manual/emergency):
 *    GREEN(phase) -> YELLOW(phase) -> ALL_RED -> GREEN(next phase)
 */
export class JunctionEngine {
  #s;
  #cfg;
  #newId;
  #dirs;
  #clock = 0;
  #events = [];
  #outbox = [];

  constructor(state, config, { newId }) {
    this.#s = state;
    this.#cfg = config;
    this.#newId = newId;
    this.#dirs = Object.values(config.phases).flat();
  }

  /** Build a brand-new engine. Call start() afterwards to push the initial all-RED state. */
  static create(config, now, deps) {
    const phases = config.phases ?? DEFAULT_PHASES;
    const cfg = {
      id: config.id,
      name: config.name ?? config.id,
      phases,
      timing: { ...DEFAULT_TIMING, ...config.timing },
    };
    const dirs = Object.values(phases).flat();
    const all = (v) => Object.fromEntries(dirs.map((d) => [d, v]));
    const state = {
      junctionId: cfg.id,
      mode: MODE.AUTOMATIC,
      stage: STAGE.ALL_RED,
      phase: null,                 // phase that holds / last held the right of way
      stageStartedAt: now,
      desired: all(SIGNAL.RED),    // what the backend wants
      actual: all(SIGNAL.UNKNOWN), // what the controller has CONFIRMED
      queues: Object.fromEntries(dirs.map((d) => [d, []])), // [{vehicleId,type,arrivedAt}]
      lastSeq: {},                 // last sensor sequence_no seen per direction
      earlyClears: {},             // vehicleId -> time: CLEARED seen before ARRIVED
      manual: null,                // {direction, phase, requestedBy, requestedAt, expiresAt}
      failure: null,               // {reason, since}
      devices: { controller: SIGNAL.UNKNOWN, signals: all('UNKNOWN'), sensors: all('UNKNOWN') },
      commands: {},                // commandId -> command (PENDING/ACKED/FAILED/TIMED_OUT/SUPERSEDED)
      updatedAt: now,
    };
    return new JunctionEngine(state, cfg, deps);
  }

  get config() { return this.#cfg; }
  snapshot() { return structuredClone(this.#s); }

  /** Hand over (and clear) the effects produced since the last call. */
  drain() {
    const out = { events: this.#events, commands: this.#outbox };
    this.#events = [];
    this.#outbox = [];
    return out;
  }

  /** Record an audit note produced by the application layer (duplicates, rejections...). */
  note(type, data, now) {
    this.#clock = now;
    this.#rec(type, data);
  }

  // ---------------------------------------------------------------- lifecycle

  /** First start: push an all-RED plan to the controller. */
  start(now) {
    this.#clock = now;
    this.#rec('JUNCTION_STARTED');
    this.#enterStage(STAGE.ALL_RED, this.#s.phase, true);
    this.#refreshMode();
  }

  /**
   * Recovery after a server restart (or controller reconnect).
   * We NEVER trust persisted physical state: forget what is confirmed, drop pending
   * commands, go to ALL_RED and re-request it. Normal gating (all RED confirmed) then
   * decides when GREEN may be granted again.
   */
  resynchronise(now, reason) {
    this.#clock = now;
    const s = this.#s;
    for (const c of Object.values(s.commands)) if (c.status === 'PENDING') c.status = 'SUPERSEDED';
    for (const d of this.#dirs) s.actual[d] = SIGNAL.UNKNOWN;
    this.#rec('RECOVERY', { reason });
    this.#enterStage(STAGE.ALL_RED, s.phase, true);
    this.#refreshMode();
  }

  /** Called periodically by the scheduler: timers, retries, expiries. Never blocks. */
  tick(now) {
    this.#clock = now;
    this.#expire();
    this.#checkTimeouts();
    this.#advance();
  }

  // ---------------------------------------------------------------- sensor events

  handleVehicleArrived(ev, now) {
    this.#clock = now;
    const s = this.#s;
    const t = this.#cfg.timing;
    this.#assertDirection(ev.direction);
    this.#trackSequence(ev);

    // Sensor time = when the vehicle really arrived. Server time = when we learned of it.
    const sensorMs = ev.sensorTimeMs ?? now;
    const limit = ev.vehicleType === 'EMERGENCY' ? t.emergencyTimeoutMs : t.staleEventMs;
    if (now - sensorMs > limit) {
      this.#rec('EVENT_REJECTED', { event_id: ev.eventId, reason: 'STALE_EVENT', vehicle_id: ev.vehicleId });
      return 'STALE';
    }
    // Out-of-order: the CLEARED for this vehicle already arrived -> the arrival is obsolete.
    if (s.earlyClears[ev.vehicleId]) {
      delete s.earlyClears[ev.vehicleId];
      this.#rec('EVENT_IGNORED', { event_id: ev.eventId, reason: 'ARRIVAL_AFTER_CLEAR', vehicle_id: ev.vehicleId });
      return 'IGNORED';
    }
    // Same vehicle announced twice with different event ids: never count it twice.
    if (this.#find(ev.vehicleId)) {
      this.#rec('EVENT_IGNORED', { event_id: ev.eventId, reason: 'VEHICLE_ALREADY_QUEUED', vehicle_id: ev.vehicleId });
      return 'IGNORED';
    }

    // Waiting time starts at the sensor time, but never in the future (clock skew protection).
    s.queues[ev.direction].push({ vehicleId: ev.vehicleId, type: ev.vehicleType, arrivedAt: Math.min(now, sensorMs) });
    this.#rec('VEHICLE_DETECTED', { event_id: ev.eventId, direction: ev.direction, vehicle_id: ev.vehicleId, vehicle_type: ev.vehicleType });
    if (ev.vehicleType === 'EMERGENCY') {
      this.#rec('EMERGENCY_DETECTED', { direction: ev.direction, vehicle_id: ev.vehicleId });
    }
    this.#advance(); // react immediately (e.g. begin emergency preemption)
    return 'ACCEPTED';
  }

  handleVehicleCleared(ev, now) {
    this.#clock = now;
    const s = this.#s;
    this.#assertDirection(ev.direction);
    this.#trackSequence(ev);

    const found = this.#find(ev.vehicleId);
    if (!found) {
      // Cleared without a known arrival: remember it so a late ARRIVED is ignored.
      s.earlyClears[ev.vehicleId] = now;
      this.#rec('EVENT_IGNORED', { event_id: ev.eventId, reason: 'CLEARED_WITHOUT_ARRIVAL', vehicle_id: ev.vehicleId });
      return 'IGNORED';
    }
    s.queues[found.direction].splice(found.index, 1); // queue length can never go below 0
    this.#rec('VEHICLE_CLEARED', { event_id: ev.eventId, direction: found.direction, vehicle_id: ev.vehicleId });
    if (found.vehicle.type === 'EMERGENCY') {
      this.#rec('EMERGENCY_CLEARED', { direction: found.direction, vehicle_id: ev.vehicleId });
    }
    this.#advance();
    return 'ACCEPTED';
  }

  // ---------------------------------------------------------------- operator commands

  requestManualGreen({ direction, requestedBy }, now) {
    this.#clock = now;
    const s = this.#s;
    this.#assertDirection(direction);
    if (s.failure) throw new DomainError('CONFLICT', 'JUNCTION_IN_FAILURE', 'Manual control is unavailable while the junction is in FAILURE mode');
    if (this.#emergencies().length) throw new DomainError('CONFLICT', 'EMERGENCY_ACTIVE', 'Emergency has priority over manual control');

    const replaced = s.manual?.direction; // two admins: last accepted command wins (serialized)
    s.manual = {
      direction,
      phase: this.#phaseOf(direction),
      requestedBy: requestedBy ?? 'unknown',
      requestedAt: now,
      expiresAt: now + this.#cfg.timing.manualTimeoutMs,
    };
    this.#rec('MANUAL_OVERRIDE', { direction, requested_by: s.manual.requestedBy, replaced_direction: replaced });
    this.#advance(); // still goes GREEN -> YELLOW -> ALL_RED -> GREEN
  }

  returnToAutomatic(now) {
    this.#clock = now;
    const s = this.#s;
    if (s.failure) {
      if (s.devices.controller === 'OFFLINE') {
        throw new DomainError('CONFLICT', 'CONTROLLER_OFFLINE', 'Cannot recover while the controller is OFFLINE');
      }
      this.#recover();
    }
    s.manual = null;
    this.#rec('RETURN_TO_AUTOMATIC');
    this.#advance();
  }

  // ---------------------------------------------------------------- controller events

  /** ACK / NACK from the controller. Returns APPLIED | DUPLICATE | UNKNOWN_COMMAND. */
  handleAck({ commandId, status, actualState }, now) {
    this.#clock = now;
    const s = this.#s;
    const cmd = s.commands[commandId];
    if (!cmd) {
      this.#rec('ACK_UNKNOWN_COMMAND', { command_id: commandId });
      return 'UNKNOWN_COMMAND';
    }
    if (cmd.status === 'ACKED' || cmd.status === 'FAILED') {
      this.#rec('ACK_DUPLICATE', { command_id: commandId }); // idempotent: no state change
      return 'DUPLICATE';
    }

    const wasPending = cmd.status === 'PENDING'; // else: late ACK (timed out / superseded)
    const previous = s.actual[cmd.direction];
    if (s.devices.controller === SIGNAL.UNKNOWN) s.devices.controller = 'ONLINE';

    if (status === 'ACK') {
      s.actual[cmd.direction] = actualState; // whatever the controller reports is the truth
      if (actualState === cmd.requestedState) {
        cmd.status = 'ACKED';
        this.#rec('CONTROLLER_ACK', { command_id: commandId, direction: cmd.direction, late: !wasPending });
        if (wasPending) {
          this.#rec('SIGNAL_CHANGED', { direction: cmd.direction, previous_state: previous, new_state: actualState, command_id: commandId });
        }
      } else {
        cmd.status = 'FAILED';
        this.#rec('COMMAND_FAILED', { command_id: commandId, direction: cmd.direction, reason: `requested ${cmd.requestedState}, controller reports ${actualState}` });
        if (wasPending) this.#enterFailure('SIGNAL_MISMATCH');
      }
    } else {
      cmd.status = 'FAILED';
      this.#rec('COMMAND_FAILED', { command_id: commandId, direction: cmd.direction, reason: 'NACK' });
      if (wasPending) this.#enterFailure('COMMAND_NACK');
    }
    this.#advance();
    return 'APPLIED';
  }

  /** Device status (controller / signal / sensor ONLINE, OFFLINE...). */
  handleDeviceStatus({ deviceType, direction, status }, now) {
    this.#clock = now;
    const s = this.#s;
    if (direction) this.#assertDirection(direction);

    if (deviceType === 'SENSOR') {
      s.devices.sensors[direction] = status;
      this.#rec(status === 'OFFLINE' ? 'DEVICE_FAILURE' : 'DEVICE_STATUS_CHANGED', { direction, device_type: 'SENSOR', new_state: status });
    } else {
      if (direction) s.devices.signals[direction] = status;
      else s.devices.controller = status;
      this.#rec(status === 'OFFLINE' ? 'DEVICE_FAILURE' : 'DEVICE_STATUS_CHANGED', { direction, device_type: deviceType, new_state: status });

      if (status === 'OFFLINE') this.#enterFailure(direction ? 'SIGNAL_OFFLINE' : 'CONTROLLER_OFFLINE');
      else if (status === 'ONLINE' && s.failure && !this.#anySignalDeviceOffline()) this.#recover(); // reconnect
    }
    this.#advance();
  }

  // ================================================================ internals

  /** Move the state machine at most one step. Safe to call at any time. */
  #advance() {
    const s = this.#s;
    const t = this.#cfg.timing;
    if (!s.failure) {
      const elapsed = this.#clock - s.stageStartedAt;
      if (s.stage === STAGE.GREEN && this.#shouldLeaveGreen(elapsed)) {
        this.#enterStage(STAGE.YELLOW, s.phase);
      } else if (s.stage === STAGE.YELLOW && elapsed >= t.yellowMs) {
        this.#enterStage(STAGE.ALL_RED, s.phase);
      } else if (s.stage === STAGE.ALL_RED && elapsed >= t.allRedMs && this.#allRedConfirmed()) {
        // Only now is the next phase chosen, so emergency/manual decisions made during
        // YELLOW / ALL_RED are honoured without ever skipping the clearance.
        this.#enterStage(STAGE.GREEN, this.#chooseNextPhase());
      }
    }
    this.#refreshMode();
    s.updatedAt = this.#clock;
  }

  /** Decide whether the running GREEN should end. Priority: emergency > manual > automatic. */
  #shouldLeaveGreen(elapsed) {
    const s = this.#s;
    const t = this.#cfg.timing;

    const em = this.#emergencies()[0]; // earliest emergency first (FIFO between competing ones)
    if (em) return em.phase !== s.phase; // preempt immediately (yellow still takes full time)
    if (s.manual) return s.manual.phase !== s.phase; // manual holds its phase until released/expired

    if (elapsed < t.minGreenMs) return false;
    const rivals = Object.keys(this.#cfg.phases)
      .filter((k) => k !== s.phase)
      .map((k) => ({ score: this.#score(k), starving: this.#starving(k) }))
      .filter((r) => r.score > 0);
    if (rivals.length === 0) return false; // nobody else waiting -> avoid unnecessary switching

    if (rivals.some((r) => r.starving)) return true;     // starvation protection
    const current = this.#score(s.phase);
    if (current === 0) return true;                      // nobody waiting on the green phase
    if (elapsed >= t.greenMs) return true;               // maximum green reached
    return Math.max(...rivals.map((r) => r.score)) > current * t.switchRatio; // clear winner only
  }

  /** Pick the phase that gets GREEN after a clearance. */
  #chooseNextPhase() {
    const s = this.#s;
    const keys = Object.keys(this.#cfg.phases);
    const em = this.#emergencies()[0];
    if (em) return em.phase;
    if (s.manual) return s.manual.phase;

    // After a switch, never re-green the phase just served while another phase is waiting.
    const waiting = keys.filter((k) => k !== s.phase && this.#score(k) > 0);
    const pool = waiting.length ? waiting : keys;
    const rank = (k) => [this.#starving(k) ? 0 : 1, -this.#score(k), k === s.phase ? 0 : 1];
    return pool.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return ra[i] - rb[i];
      return 0;
    })[0];
  }

  /** Enter a stage, compute the desired signals, assert safety, request changes. */
  #enterStage(stage, phase, force = false) {
    const s = this.#s;
    let targetStage = stage;
    let targetPhase = phase;

    // Defence in depth: GREEN is only ever granted if conflicting signals are CONFIRMED RED.
    if (stage === STAGE.GREEN && !canGrantGreen(this.#cfg.phases, phase, s.actual)) {
      this.#rec('SAFETY_GUARD', { reason: 'GREEN refused: conflicting signals not confirmed RED', phase });
      targetStage = STAGE.ALL_RED;
      targetPhase = s.phase;
    }

    const previousDesired = s.desired;
    const desired = computeDesired(this.#cfg.phases, targetStage, targetPhase);
    assertSafeDesired(desired, this.#cfg.phases); // throws rather than ever emitting an unsafe plan

    s.stage = targetStage;
    s.phase = targetPhase;
    s.stageStartedAt = this.#clock;
    s.desired = desired;
    this.#rec('TRANSITION_STARTED', { stage: targetStage, phase: targetPhase });

    for (const dir of this.#dirs) {
      if (force || previousDesired[dir] !== desired[dir]) this.#issue(dir, desired[dir]);
    }
  }

  /** Create a controller command with a unique id. It is only a REQUEST, not a state change. */
  #issue(direction, requestedState) {
    const s = this.#s;
    for (const c of Object.values(s.commands)) {
      if (c.direction === direction && c.status === 'PENDING') c.status = 'SUPERSEDED';
    }
    const cmd = {
      commandId: this.#newId(),
      junctionId: s.junctionId,
      direction,
      requestedState,
      status: 'PENDING',
      attempts: 1,
      sentAt: this.#clock,
    };
    s.commands[cmd.commandId] = cmd;
    this.#pruneCommands();
    this.#rec('SIGNAL_REQUESTED', { direction, previous_state: s.actual[direction], new_state: requestedState, command_id: cmd.commandId });
    this.#outbox.push({ ...cmd });
  }

  /** ACK timeout handling: retry the SAME command id, then fail safe. */
  #checkTimeouts() {
    const s = this.#s;
    const t = this.#cfg.timing;
    const due = Object.values(s.commands).filter((c) => c.status === 'PENDING' && this.#clock - c.sentAt >= t.ackTimeoutMs);
    for (const cmd of due) {
      if (cmd.status !== 'PENDING') continue; // may have been superseded by a failure below
      if (s.failure) { // already failing safe: log only, do not escalate again
        cmd.status = 'TIMED_OUT';
        this.#rec('CONTROLLER_TIMEOUT', { command_id: cmd.commandId, direction: cmd.direction });
      } else if (cmd.attempts <= t.maxRetries) {
        cmd.attempts += 1;
        cmd.sentAt = this.#clock;
        this.#rec('COMMAND_RETRY', { command_id: cmd.commandId, direction: cmd.direction, attempt: cmd.attempts });
        this.#outbox.push({ ...cmd });
      } else {
        cmd.status = 'TIMED_OUT';
        s.actual[cmd.direction] = SIGNAL.UNKNOWN; // an unconfirmed state is an unknown state
        s.devices.controller = SIGNAL.UNKNOWN;
        this.#rec('CONTROLLER_TIMEOUT', { command_id: cmd.commandId, direction: cmd.direction });
        this.#enterFailure('COMMAND_TIMEOUT');
      }
    }
  }

  /** FAILURE mode: scheduling stops, desired = all RED (best effort), operator/reconnect recovers. */
  #enterFailure(reason) {
    const s = this.#s;
    if (s.failure) return;
    s.failure = { reason, since: this.#clock };
    this.#rec('FAILURE_ENTERED', { reason });
    this.#enterStage(STAGE.ALL_RED, s.phase, true);
  }

  #recover() {
    const s = this.#s;
    s.failure = null;
    for (const d of this.#dirs) s.actual[d] = SIGNAL.UNKNOWN; // re-learn the physical state
    this.#rec('FAILURE_CLEARED');
    this.#enterStage(STAGE.ALL_RED, s.phase, true);
  }

  /** Housekeeping: stale emergencies, manual expiry, old early-clear markers. */
  #expire() {
    const s = this.#s;
    const t = this.#cfg.timing;
    for (const dir of this.#dirs) {
      s.queues[dir] = s.queues[dir].filter((v) => {
        const stale = v.type === 'EMERGENCY' && this.#clock - v.arrivedAt > t.emergencyTimeoutMs;
        if (stale) this.#rec('EMERGENCY_TIMEOUT', { direction: dir, vehicle_id: v.vehicleId });
        return !stale;
      });
    }
    if (s.manual && this.#clock >= s.manual.expiresAt) {
      s.manual = null;
      this.#rec('MANUAL_EXPIRED');
    }
    for (const [id, at] of Object.entries(s.earlyClears)) {
      if (this.#clock - at > t.staleEventMs) delete s.earlyClears[id];
    }
  }

  /** Mode is derived, never set directly: FAILURE > EMERGENCY > MANUAL > AUTOMATIC. */
  #refreshMode() {
    const s = this.#s;
    const next = s.failure ? MODE.FAILURE : this.#emergencies().length ? MODE.EMERGENCY : s.manual ? MODE.MANUAL : MODE.AUTOMATIC;
    if (next !== s.mode) {
      this.#rec('MODE_CHANGED', { previous_state: s.mode, new_state: next });
      s.mode = next;
    }
  }

  // ---- small helpers
  #emergencies() {
    const list = [];
    for (const [direction, queue] of Object.entries(this.#s.queues)) {
      for (const v of queue) if (v.type === 'EMERGENCY') list.push({ ...v, direction, phase: this.#phaseOf(direction) });
    }
    return list.sort((a, b) => a.arrivedAt - b.arrivedAt);
  }
  #phaseOf(direction) { return Object.keys(this.#cfg.phases).find((k) => this.#cfg.phases[k].includes(direction)); }
  #score(phase) { return phaseScore(this.#cfg.phases[phase], this.#s.queues, this.#clock, this.#s.devices.sensors, this.#cfg.timing); }
  #starving(phase) { return oldestWaitMs(this.#cfg.phases[phase], this.#s.queues, this.#clock) > this.#cfg.timing.maxWaitMs; }
  #allRedConfirmed() { return this.#dirs.every((d) => this.#s.actual[d] === SIGNAL.RED); }
  #anySignalDeviceOffline() { return this.#s.devices.controller === 'OFFLINE' || Object.values(this.#s.devices.signals).includes('OFFLINE'); }

  #find(vehicleId) {
    for (const [direction, list] of Object.entries(this.#s.queues)) {
      const index = list.findIndex((v) => v.vehicleId === vehicleId);
      if (index >= 0) return { direction, index, vehicle: list[index] };
    }
    return null;
  }

  #assertDirection(direction) {
    if (!this.#dirs.includes(direction)) throw new DomainError('INVALID', 'UNKNOWN_DIRECTION', `Direction '${direction}' does not exist on junction ${this.#cfg.id}`);
  }

  /** Sequence numbers are per sensor (junction+direction). Regressions are audited but still processed. */
  #trackSequence(ev) {
    const last = this.#s.lastSeq[ev.direction];
    if (last !== undefined && ev.sequenceNo <= last) {
      this.#rec('OUT_OF_ORDER_EVENT', { event_id: ev.eventId, direction: ev.direction, sequence_no: ev.sequenceNo, last_sequence_no: last });
    } else {
      this.#s.lastSeq[ev.direction] = ev.sequenceNo;
    }
  }

  #pruneCommands() {
    const ids = Object.keys(this.#s.commands);
    if (ids.length <= MAX_TRACKED_COMMANDS) return;
    ids
      .filter((id) => this.#s.commands[id].status !== 'PENDING')
      .sort((a, b) => this.#s.commands[a].sentAt - this.#s.commands[b].sentAt)
      .slice(0, ids.length - MAX_TRACKED_COMMANDS)
      .forEach((id) => delete this.#s.commands[id]);
  }

  /** Append an audit event. Well-known fields are lifted to the top level, the rest go to details. */
  #rec(type, data = {}) {
    const { direction, previous_state, new_state, command_id, ...details } = data;
    this.#events.push({
      event_type: type,
      direction,
      previous_state,
      new_state,
      command_id,
      details,
      timestamp: new Date(this.#clock).toISOString(),
    });
  }
}