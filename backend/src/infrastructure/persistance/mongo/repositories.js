import { JunctionModel, ProcessedEventModel, HistoryModel } from './models.js';

export class JunctionRepository {
  findAll() { return JunctionModel.find().lean(); }
  upsert(id, config, state) {
    return JunctionModel.findByIdAndUpdate(id, { $set: { config, state } }, { upsert: true });
  }
  saveState(id, state) { return JunctionModel.findByIdAndUpdate(id, { $set: { state } }); }
}

export class ProcessedEventRepository {
  async exists(junctionId, eventId) {
    return Boolean(await ProcessedEventModel.exists({ junction_id: junctionId, event_id: eventId }));
  }
  async markProcessed(junctionId, eventId, outcome) {
    try {
      await ProcessedEventModel.create({ junction_id: junctionId, event_id: eventId, outcome });
    } catch (err) {
      if (err.code !== 11000) throw err; // 11000 = duplicate key: already recorded, fine
    }
  }
}

export class HistoryRepository {
  addMany(junctionId, events) {
    return HistoryModel.insertMany(events.map((e) => ({ ...e, junction_id: junctionId, timestamp: new Date(e.timestamp) })));
  }
  async list(junctionId, { limit = 50, type } = {}) {
    const filter = { junction_id: junctionId, ...(type ? { event_type: type } : {}) };
    const docs = await HistoryModel.find(filter).sort({ timestamp: -1, _id: -1 }).limit(limit).lean();
    return docs.map(({ _id, ...rest }) => ({ ...rest, timestamp: rest.timestamp.toISOString() }));
  }
}