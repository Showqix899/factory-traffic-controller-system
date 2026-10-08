import { logger } from '../../shared/logger.js';

/**
 * CONTROLLER PORT (contract used by the application layer):
 *     send(command): Promise<void>
 *       command = { command_id, junction_id, direction, requested_state, attempt }
 * Sending NEVER means "executed". The result only arrives later as an ACK event.
 *
 * This adapter simulates a physical controller over REST. A future MqttController
 * would implement the same send() (publish to a topic) and feed ACKs into the same
 * service.ingestControllerEvent(), without touching the domain or application logic.
 */
export class RestSimulatorController {
  #ackHandler = null;
  #sent = []; // last commands, for the simulator UI

  constructor({ autoAck, ackDelayMs }) {
    this.settings = { auto_ack: autoAck, ack_delay_ms: ackDelayMs, drop_acks: false };
  }

  /** Wired in server.js: where simulated ACKs are delivered. */
  onAck(handler) { this.#ackHandler = handler; }

  async send(command) {
    this.#sent.unshift({ ...command, sent_at: new Date().toISOString() });
    this.#sent.length = Math.min(this.#sent.length, 20);

    // drop_acks simulates a dead/unresponsive controller: commands vanish, no ACK ever arrives.
    if (!this.settings.auto_ack || this.settings.drop_acks) return;

    setTimeout(() => {
      this.#ackHandler?.({
        command_id: command.command_id,
        junction_id: command.junction_id,
        status: 'ACK',
        actual_state: command.requested_state,
      }).catch((err) => logger.warn('Simulated ACK failed', { message: err.message }));
    }, this.settings.ack_delay_ms);
  }

  getState() { return { ...this.settings, recent_commands: this.#sent }; }

  configure({ auto_ack, ack_delay_ms, drop_acks }) {
    if (typeof auto_ack === 'boolean') this.settings.auto_ack = auto_ack;
    if (Number.isInteger(ack_delay_ms) && ack_delay_ms >= 0) this.settings.ack_delay_ms = ack_delay_ms;
    if (typeof drop_acks === 'boolean') this.settings.drop_acks = drop_acks;
    return this.getState();
  }
}