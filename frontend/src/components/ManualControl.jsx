import { useState } from 'react';
import { api } from '../api/client.js';
import { Card } from './ui.jsx';

/** Sends INTENTS to the backend. It never changes any signal state itself. */
export default function ManualControl({ status }) {
  const [direction, setDirection] = useState('WEST');
  const [error, setError] = useState(null);
  const id = status.junction_id;

  const send = async (body) => {
    try { setError(null); await api.post(`/junctions/${id}/commands`, { ...body, requested_by: 'dashboard-admin' }); }
    catch (e) { setError(e.message); } // e.g. 409 emergency active / failure mode
  };

  return (
    <Card title="Manual control">
      {status.manual && <p className="mb-2 rounded bg-blue-900 p-2 text-xs">Manual override active: {status.manual.direction} (expires {new Date(status.manual.expires_at).toLocaleTimeString()})</p>}
      <div className="flex gap-2">
        <select className="rounded bg-slate-700 p-1" value={direction} onChange={(e) => setDirection(e.target.value)}>
          {['NORTH', 'SOUTH', 'EAST', 'WEST'].map((d) => <option key={d}>{d}</option>)}
        </select>
        <button className="rounded bg-blue-600 px-3 py-1 text-sm" onClick={() => send({ command: 'MANUAL_GREEN_REQUEST', direction })}>Request GREEN</button>
        <button className="rounded bg-emerald-700 px-3 py-1 text-sm" onClick={() => send({ command: 'RETURN_TO_AUTOMATIC' })}>Return to automatic</button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </Card>
  );
}