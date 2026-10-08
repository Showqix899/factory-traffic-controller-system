import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import Intersection from '../components/Intersection.jsx';
import StatusPanel from '../components/StatusPanel.jsx';
import ManualControl from '../components/ManualControl.jsx';
import SimulationPanel from '../components/SimulationPanel.jsx';
import HistoryList from '../components/HistoryList.jsx';
import { Card, ErrorBanner } from '../components/ui.jsx';

export default function JunctionDetail({ id, onBack }) {
  const { data: status, error } = usePolling(() => api.get(`/junctions/${id}/status`), [id]);
  const { data: history } = usePolling(() => api.get(`/junctions/${id}/history?limit=40`), [id]);

  return (
    <div>
      <button className="mb-3 text-sm text-blue-400" onClick={onBack}>← All junctions</button>
      <ErrorBanner error={error} /> {/* invalid junction (404), backend down, etc. */}
      {!status ? (
        <p className="text-slate-400">{error ? 'Cannot load junction.' : 'Loading…'}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4">
            <Card title={status.name}><Intersection status={status} /></Card>
            <ManualControl status={status} />
          </div>
          <StatusPanel status={status} />
          <SimulationPanel status={status} />
          <div className="lg:col-span-3"><HistoryList events={history?.events} /></div>
        </div>
      )}
    </div>
  );
}