import { useState } from 'react';
import { api } from './api/client.js';
import { usePolling } from './hooks/usePolling.js';
import Dashboard from './pages/Dashboard.jsx';
import JunctionDetail from './pages/JunctionDetail.jsx';
import { ErrorBanner } from './components/ui.jsx';

export default function App() {
  const [selected, setSelected] = useState(null);
  const { data: junctions, error } = usePolling(() => api.get('/junctions'), []);

  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Factory Traffic Management</h1>
      {/* Shown whenever polling fails (backend unavailable / API failure) */}
      {!selected && <ErrorBanner error={error} />}
      {selected ? (
        <JunctionDetail id={selected} onBack={() => setSelected(null)} />
      ) : junctions ? (
        <Dashboard junctions={junctions} onOpen={setSelected} />
      ) : (
        <p className="text-slate-400">{error ? 'Backend unavailable. Retrying…' : 'Loading…'}</p>
      )}
    </main>
  );
}