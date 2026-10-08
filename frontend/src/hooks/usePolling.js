import { useEffect, useState } from 'react';

/**
 * Polls `fetcher` every `intervalMs`. Keeps the last good data when a request fails,
 * so the UI shows stale data plus an error banner instead of crashing or blanking.
 * Polling was chosen over SSE/WebSocket: simplest, robust behind Docker/proxies, and
 * 1s latency is plenty for a dashboard (SSE is listed as a next step).
 */
export function usePolling(fetcher, deps = [], intervalMs = 1000) {
  const [state, setState] = useState({ data: null, error: null });

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const data = await fetcher();
        if (alive) setState({ data, error: null });
      } catch (error) {
        if (alive) setState((prev) => ({ ...prev, error }));
      }
    };
    run();
    const timer = setInterval(run, intervalMs);
    return () => { alive = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}