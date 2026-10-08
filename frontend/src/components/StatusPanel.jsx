import { Badge, Card, ModeBadge, StatusBadge } from './ui.jsx';

const LEVEL = { CRITICAL: 'bg-red-900 text-red-100', WARNING: 'bg-yellow-900 text-yellow-100', INFO: 'bg-slate-700 text-slate-200' };

export default function StatusPanel({ status }) {
  return (
    <Card title="Status">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ModeBadge mode={status.mode} />
        <Badge text={`${status.stage} / ${status.phase ?? '-'}`} />
        <span className="text-xs text-slate-400">controller</span> <StatusBadge status={status.controller_status} />
        {status.emergency.active && <Badge text="🚨 EMERGENCY" style="bg-orange-600" />}
        {status.failure && <Badge text={`⛔ ${status.failure.reason}`} style="bg-red-700" />}
        {status.manual && <Badge text={`MANUAL: ${status.manual.direction}`} style="bg-blue-700" />}
      </div>

      <table className="mb-3 w-full text-sm">
        <thead className="text-left text-slate-400"><tr><th>Dir</th><th>Desired</th><th>Confirmed</th><th>Queue</th></tr></thead>
        <tbody>
          {Object.keys(status.desired_signals).map((d) => (
            <tr key={d} className={status.desired_signals[d] !== status.actual_signals[d] ? 'text-yellow-300' : ''}>
              <td>{d}</td><td>{status.desired_signals[d]}</td><td>{status.actual_signals[d]}</td><td>{status.queues[d]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {status.pending_commands.length > 0 && (
        <p className="mb-2 text-xs text-slate-300">
          Pending: {status.pending_commands.map((c) => `${c.command_id} ${c.direction}→${c.requested_state} (try ${c.attempts})`).join(', ')}
        </p>
      )}

      <div className="space-y-1">
        {status.alerts.length === 0 && <p className="text-xs text-slate-500">No active alerts</p>}
        {status.alerts.map((a, i) => (
          <div key={i} className={`rounded px-2 py-1 text-xs ${LEVEL[a.level]}`}>{a.code}: {a.message}</div>
        ))}
      </div>
    </Card>
  );
}