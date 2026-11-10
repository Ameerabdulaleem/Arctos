import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, isAbort } from '../services/api';

interface PollingState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: number | null;
}

/**
 * Loads data now and then on an interval. Pauses while the tab is hidden, cancels in flight
 * requests on unmount, and keeps the last good data visible when a refresh fails.
 */
export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  intervalMs: number | null,
  deps: ReadonlyArray<unknown> = [],
) {
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const [state, setState] = useState<PollingState<T>>({ data: null, error: null, loading: true, updatedAt: null });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const run = async () => {
      if (document.hidden) {
        schedule();
        return;
      }
      try {
        const data = await fetcherRef.current(controller.signal);
        if (!cancelled) setState({ data, error: null, loading: false, updatedAt: Date.now() });
      } catch (error) {
        if (cancelled || isAbort(error)) return;
        setState((prev) => ({ ...prev, error: errorMessage(error), loading: false }));
      }
      schedule();
    };

    const schedule = () => {
      if (!cancelled && intervalMs) timer = setTimeout(run, intervalMs);
    };

    setState((prev) => (prev.data === null ? { ...prev, loading: true } : prev));
    void run();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, tick, ...deps]);

  return { ...state, refresh };
}
