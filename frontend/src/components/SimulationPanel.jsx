import { useRef, useState } from 'react';
import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import { Card } from './ui.jsx';

const DIRS = ['NORTH', 'SOUTH', 'EAST', 'WEST'];
const sel = 'rounded bg-slate-700 p-1 text-sm';
const btn = 'rounded px-2 py-1 text-xs';

/** Lets the evaluator drive the system without hardware (sensors + controller). */
export default function SimulationPanel({ status }) {
  const id = status.junction_id;
  const seq = useRef(Math.floor(Date.now() / 1000)); // increasing sequence_no
  const counter = useRef(1);
  const lastPayload = useRef(null);
  const [form, setForm] = useState({ direction: 'NORTH', event_type: 'VEHICLE_ARRIVED', vehicle_type: 'TRUCK', vehicle_id: '' });
  const [dev, setDev] = useState({ device_type: 'SIGNAL_CONTROLLER', direction: '', status: 'OFFLINE' });
  const [msg, setMsg] = useState(null);
  const { data: sim } = usePolling(() => api.get('/simulator'), [], 2000);

  const report = (ok, text) => setMsg({ ok, text });
  const post = async (path, body, label) => {
    try { const r = await api.post(path, body); report(true, `${label}: ${r.status ?? 'ok'}`); }
    catch (e) { report(false, `${label}: ${e.message}`); }
  };

  const buildSensor = (f) => ({
    event_id: `evt-${Date.now()}-${counter.current++}`,
    junction_id: id,
    direction: f.direction,
    event_type: f.event_type,
    vehicle_id: f.vehicle_id || `VH-${Date.now() % 100000}`,
    ...(f.event_type === 'VEHICLE_ARRIVED' ? { vehicle_type: f.vehicle_type } : {}),
    sequence_no: seq.current++,
    timestamp: new Date().toISOString(),
  });
  const sendSensor = (f) => { const p = buildSensor(f); lastPayload.current = p; return post('/sensor-events', p, 'Sensor event'); };
  const patchSim = (patch) => api.put('/simulator', patch).catch((e) => report(false, e.message));

  const pending = status.pending_commands;
  const knownVehicles = Object.values(status.queue_vehicles).flat().map((v) => v.vehicle_id);

  return (
    <Card title="Simulation">
      <p className="mb-1 text-xs font-bold text-slate-400">Vehicle sensor</p>
      <div className="mb-2 flex flex-wrap gap-2">
        <select className={sel} value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>{DIRS.map((d) => <option key={d}>{d}</option>)}</select>
        <select className={sel} value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })}><option>VEHICLE_ARRIVED</option><option>VEHICLE_CLEARED</option></select>
        <select className={sel} value={form.vehicle_type} onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })}>{['TRUCK', 'FORKLIFT', 'EMPLOYEE_VEHICLE', 'EMERGENCY'].map((t) => <option key={t}>{t}</option>)}</select>
        <input className={`${sel} w-28`} list="vehicles" placeholder="vehicle id (auto)" value={form.vehicle_id} onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })} />
        <datalist id="vehicles">{knownVehicles.map((v) => <option key={v} value={v} />)}</datalist>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <button className={`${btn} bg-blue-600`} onClick={() => sendSensor(form)}>Send event</button>
        <button className={`${btn} bg-slate-600`} onClick={() => lastPayload.current && post('/sensor-events', lastPayload.current, 'Duplicate')}>Resend last (duplicate)</button>
        <button className={`${btn} bg-orange-600`} onClick={() => sendSensor({ direction: 'EAST', event_type: 'VEHICLE_ARRIVED', vehicle_type: 'EMERGENCY', vehicle_id: '' })}>🚨 Emergency @ EAST</button>
      </div>

      <p className="mb-1 text-xs font-bold text-slate-400">Controller simulator</p>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
        <label><input type="checkbox" checked={sim?.auto_ack ?? true} onChange={(e) => patchSim({ auto_ack: e.target.checked })} /> auto-ACK</label>
        <label><input type="checkbox" checked={sim?.drop_acks ?? false} onChange={(e) => patchSim({ drop_acks: e.target.checked })} /> drop ACKs (dead controller)</label>
      </div>
      <div className="mb-2 flex flex-wrap gap-2">
        <select className={sel} value={dev.device_type} onChange={(e) => setDev({ ...dev, device_type: e.target.value })}><option>SIGNAL_CONTROLLER</option><option>SENSOR</option></select>
        <select className={sel} value={dev.direction} onChange={(e) => setDev({ ...dev, direction: e.target.value })}><option value="">(whole controller)</option>{DIRS.map((d) => <option key={d}>{d}</option>)}</select>
        <select className={sel} value={dev.status} onChange={(e) => setDev({ ...dev, status: e.target.value })}>{['ONLINE', 'OFFLINE', 'DEGRADED', 'WARNING', 'UNKNOWN'].map((s) => <option key={s}>{s}</option>)}</select>
        <button className={`${btn} bg-slate-600`} onClick={() => post('/controller-events', { event_id: `status-${Date.now()}`, junction_id: id, device_type: dev.device_type, ...(dev.direction ? { direction: dev.direction } : {}), status: dev.status }, 'Device status')}>Send status</button>
      </div>
      {pending.map((c) => (
        <div key={c.command_id} className="mb-1 flex items-center gap-2 text-xs">
          <span>{c.command_id} {c.direction}→{c.requested_state}</span>
          <button className={`${btn} bg-emerald-700`} onClick={() => post('/controller-events', { command_id: c.command_id, junction_id: id, status: 'ACK', actual_state: c.requested_state }, 'ACK')}>ACK</button>
          <button className={`${btn} bg-red-700`} onClick={() => post('/controller-events', { command_id: c.command_id, junction_id: id, status: 'NACK' }, 'NACK')}>NACK</button>
        </div>
      ))}
      {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>}
    </Card>
  );
}