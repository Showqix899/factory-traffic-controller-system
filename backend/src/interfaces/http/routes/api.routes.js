import { Router } from 'express';

// Wraps async handlers so rejected promises reach the error middleware.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// HTTP status per sensor-event outcome.
const SENSOR_HTTP = { ACCEPTED: 201, DUPLICATE: 200, IGNORED: 200, STALE: 422 };

export function createApiRouter({ service, simulator }) {
  const r = Router();

  // --- junctions
  r.get('/junctions', h(async (_req, res) => res.json(service.listStatuses())));
  r.post('/junctions', h(async (req, res) => res.status(201).json(await service.createJunction(req.body))));
  r.get('/junctions/:id', h(async (req, res) => res.json(service.getJunction(req.params.id))));
  r.get('/junctions/:id/status', h(async (req, res) => res.json(service.getStatus(req.params.id))));
  r.get('/junctions/:id/history', h(async (req, res) => res.json(await service.getHistory(req.params.id, req.query))));
  r.post('/junctions/:id/commands', h(async (req, res) => res.status(202).json(await service.sendCommand(req.params.id, req.body))));

  // --- sensors
  r.post('/sensor-events', h(async (req, res) => {
    const result = await service.ingestSensorEvent(req.body);
    res.status(SENSOR_HTTP[result.status] ?? 200).json(result);
  }));

  // --- controller (ACKs and device status) and its simulator
  r.post('/controller-events', h(async (req, res) => {
    const result = await service.ingestControllerEvent(req.body);
    res.status(result.status === 'UNKNOWN_COMMAND' ? 404 : 200).json(result);
  }));
  r.get('/simulator', h(async (_req, res) => res.json(simulator.getState())));
  r.put('/simulator', h(async (req, res) => res.json(simulator.configure(req.body ?? {}))));

  return r;
}