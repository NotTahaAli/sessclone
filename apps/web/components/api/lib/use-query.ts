'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Ours: `fn` receives an `AbortSignal` first. A new `start`, `reset` and
 * unmount abort the request in flight, and an aborted run sets no state.
 */
export function useQuery<I extends unknown[], T>(
  fn: (signal: AbortSignal, ...input: I) => Promise<T>,
): {
  start: (...input: I) => Promise<T | void>;
  reset: () => void;
  data?: T;
  error?: unknown;
  isLoading: boolean;
} {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return useMemo(
    () => ({
      isLoading: loading,
      data,
      error,
      start(...input) {
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        const { signal } = controller;
        setLoading(true);

        return fnRef
          .current(signal, ...input)
          .then((res) => {
            if (signal.aborted) return;
            setData(res);
            setError(undefined);
            return res;
          })
          .catch((err) => {
            if (signal.aborted) return;
            setData(undefined);
            setError(err);
          })
          .finally(() => {
            if (!signal.aborted) setLoading(false);
          });
      },
      reset() {
        controllerRef.current?.abort();
        setData(undefined);
        setError(undefined);
        setLoading(false);
      },
    }),
    [error, data, loading],
  );
}
