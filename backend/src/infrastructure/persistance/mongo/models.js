import mongoose from 'mongoose';

const { Schema } = mongoose;

// One document per junction: static config + the full engine state (queues, desired/actual
// signals, pending commands, manual/emergency/failure state, timestamps).
// minimize:false keeps empty objects ({}), which the engine relies on.
export const JunctionModel = mongoose.model(
  'Junction',
  new Schema({ _id: String, config: Schema.Types.Mixed, state: Schema.Types.Mixed }, { timestamps: true, minimize: false }),
);

// Idempotency ledger. The unique index is the final guard against double-processing.
const processed = new Schema({
  junction_id: { type: String, required: true },
  event_id: { type: String, required: true },
  outcome: String,
  processedAt: { type: Date, default: Date.now },
});
processed.index({ junction_id: 1, event_id: 1 }, { unique: true });
export const ProcessedEventModel = mongoose.model('ProcessedEvent', processed);

// Audit trail.
const history = new Schema(
  {
    junction_id: { type: String, required: true },
    event_type: { type: String, required: true },
    direction: String,
    previous_state: String,
    new_state: String,
    command_id: String,
    details: Schema.Types.Mixed,
    timestamp: { type: Date, required: true },
  },
  { versionKey: false },
);
history.index({ junction_id: 1, timestamp: -1 });
export const HistoryModel = mongoose.model('History', history);