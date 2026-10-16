import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastState {
  text: string;
  ok: boolean;
}

// A message that shows briefly and clears itself.
export function useToast(durationMs = 4500) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((text: string, ok = true) => {
    setToast({ text, ok });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), durationMs);
  }, [durationMs]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { toast, show };
}
