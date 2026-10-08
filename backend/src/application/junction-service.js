import { JunctionEngine } from '../domain/engine/junction-engine.js';
import { notFound, conflict } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import { toStatusDto } from './status-mapper.js';
import { validateSensorEvent, validateControllerEvent, validateCommand, validateJunctionInput } from './validators.js';

/**
 * Application service: glue between HTTP / controller adapters, the pure engine and persistence.
 *
 * CONSISTENCY STRATEGY: serialized per-junction processing. Every operation that can change a
 * junction goes through #mutate(), which chains it behind the previous one for that junction
 * (an in-process actor / mailbox). Two concurrent requests can therefore never interleave
 * and produce conflicting decisions. Different junctions run in parallel.
 *
 * WRITE-AHEAD: state + history are persisted BEFORE commands are sent to the controller, so
 * a crash can never leave a command in flight that the database does not know about.
 */
export class JunctionService {
  #engines = new Map();
  #chains = new Map();

  constructor({ junctionRepo, historyRepo, eventRepo, controller, defaultTiming = {}, newId, clock = () => Date.now() }) {
    Object.assign(this, { junctionRepo, historyRepo, eventRepo, controller, defaultTiming, newId, clock });
  }

  /** Load persisted junctions and re-synchronise them; seed Junction A on first run. */
  async init() {
    for (const doc of await this.junctionRepo.findAll()) {
      this.#engines.set(doc._id, new JunctionEngine(doc.state, doc.config, { newId: this.newId }));
      // After a restart the persisted desired/actual signals may be stale: never trust them.
      await this.#mutate(doc._id, (engine, now) => engine.resynchronise(now, 'SERVER_RESTART'));
      logger.info('Junction restored', { id: doc._id });
    }
    if (this.#engines.size === 0) await this.createJunction({ id: 'A', name: 'Junction A' });
  }

  // ------------------------------------------------------------------ queries (no locking needed)

  getStatus(id) {
    const engine = this.#engine(id);
    return toStatusDto(engine.snapshot(), engine.config, this.clock());
  }
  getJunction(id) {
    return { config: this.#engine(id).config, status: this.getStatus(id) };
  }
  listStatuses() {
    return [...this.#engines.keys()].map((id) => this.getStatus(id));
  }
  async getHistory(id, query) {
    this.#engine(id);
    const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 50, 1), 200);
    return { junction_id: id, events: await this.historyRepo.list(id, { limit, type: query.type }) };
  }

  // ------------------------------------------------------------------ commands

  async createJunction(raw) {
    const input = validateJunctionInput(raw);
    return this.#run(input.id, async () => {
      if (this.#engines.has(input.id)) throw conflict(`Junction '${input.id}' already exists`);
      const now = this.clock();
      const engine = JunctionEngine.create(
        { ...input, timing: { ...this.defaultTiming, ...input.timing } },
        now,
        { newId: this.newId },
      );
      engine.start(now);
      await this.junctionRepo.upsert(input.id, engine.config, engine.snapshot());
      this.#engines.set(input.id, engine);
      await this.#flush(input.id, engine);
      return this.getStatus(input.id);
    });
  }

  async ingestSensorEvent(raw) {
    let ev;
    try {
      ev = validateSensorEvent(raw);
    } catch (err) {
      // Audit rejected events for known junctions, then report the validation error.
      if (typeof raw?.junction_id === 'string' && this.#engines.has(raw.junction_id)) {
        await this.#mutate(raw.junction_id, (e, now) => e.note('EVENT_REJECTED', { reason: 'VALIDATION', problems: err.details, event_id: raw.event_id }, now));
      }
      throw err;
    }

    return this.#mutate(
      ev.junctionId,
      async (engine, now) => {
        // IDEMPOTENCY: event_id is authoritative. A repeated id never touches the queues again.
        if (await this.eventRepo.exists(ev.junctionId, ev.eventId)) {
          engine.note('DUPLICATE_EVENT', { event_id: ev.eventId }, now);
          return { status: 'DUPLICATE', event_id: ev.eventId };
        }
        const status = ev.eventType === 'VEHICLE_ARRIVED' ? engine.handleVehicleArrived(ev, now) : engine.handleVehicleCleared(ev, now);
        return { status, event_id: ev.eventId };
      },
      // Mark as processed only AFTER state is persisted: a crash in between means a harmless
      // re-processing (the engine also ignores an already queued vehicle_id).
      { afterPersist: (res) => (res.status === 'DUPLICATE' ? null : this.eventRepo.markProcessed(ev.junctionId, ev.eventId, res.status)) },
    );
  }

  async ingestControllerEvent(raw) {
    const ev = validateControllerEvent(raw);
    return this.#mutate(ev.junctionId, (engine, now) => {
      if (ev.kind === 'STATUS') {
        engine.handleDeviceStatus(ev, now);
        return { status: 'APPLIED' };
      }
      return { status: engine.handleAck(ev, now), command_id: ev.commandId };
    });
  }

  async sendCommand(id, raw) {
    const cmd = validateCommand(raw);
    await this.#mutate(id, (engine, now) => {
      if (cmd.command === 'MANUAL_GREEN_REQUEST') engine.requestManualGreen(cmd, now);
      else engine.returnToAutomatic(now);
    });
    // 202: the request is accepted; the physical transition completes asynchronously.
    return { accepted: true, status: this.getStatus(id) };
  }

  /** Driven by the interval in server.js. Handles timers, ACK timeouts, retries, expiries. */
  async tickAll() {
    const results = await Promise.allSettled([...this.#engines.keys()].map((id) => this.#mutate(id, (e, now) => e.tick(now))));
    for (const r of results) if (r.status === 'rejected') logger.error('Tick failed', { message: r.reason?.message });
  }

  // ------------------------------------------------------------------ internals

  #engine(id) {
    const engine = this.#engines.get(id);
    if (!engine) throw notFound(`Junction '${id}' not found`);
    return engine;
  }

  /** Serialize work per junction id (mailbox). A failure never blocks the chain. */
  #run(id, work) {
    const previous = this.#chains.get(id) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(work);
    this.#chains.set(id, result.catch(() => {}));
    return result;
  }

  #mutate(id, work, { afterPersist } = {}) {
    return this.#run(id, async () => {
      const engine = this.#engine(id);
      const result = await work(engine, this.clock()); // domain validates BEFORE mutating
      await this.#flush(id, engine);
      if (afterPersist) await afterPersist(result);
      return result;
    });
  }

  /** Persist state + audit trail first, then dispatch controller commands. */
  async #flush(id, engine) {
    const { events, commands } = engine.drain();
    if (events.length === 0 && commands.length === 0) return; // nothing changed (idle tick)
    await this.junctionRepo.saveState(id, engine.snapshot());
    if (events.length) await this.historyRepo.addMany(id, events);
    for (const c of commands) {
      this.controller
        .send({ command_id: c.commandId, junction_id: c.junctionId, direction: c.direction, requested_state: c.requestedState, attempt: c.attempts })
        .catch((err) => logger.warn('Controller send failed', { command_id: c.commandId, message: err.message }));
    }
  }
}