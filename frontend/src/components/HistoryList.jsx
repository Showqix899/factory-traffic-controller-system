import { Card } from './ui.jsx';

export default function HistoryList({ events = [] }) {
  return (
    <Card title="Recent activity">
      <div className="max-h-80 overflow-auto text-xs">
        {events.length === 0 && <p className="text-slate-500">No history yet</p>}
        {events.map((e, i) => (
          <div key={i} className="flex gap-2 border-b border-slate-700 py-1">
            <span className="w-16 shrink-0 text-slate-500">{new Date(e.timestamp).toLocaleTimeString()}</span>
            <span className="w-44 shrink-0 font-semibold">{e.event_type}</span>
            <span className="text-slate-300">
              {e.direction ?? ''} {e.previous_state || e.new_state ? `${e.previous_state ?? '?'} → ${e.new_state ?? '?'}` : ''} {e.command_id ?? ''}{' '}
              {e.details && Object.keys(e.details).length ? JSON.stringify(e.details) : ''}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}