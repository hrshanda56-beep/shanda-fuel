'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type ToastItem = Readonly<{ id: number; message: string }>;
type ToastApi = Readonly<{ show: (message: string) => void }>;

const ToastContext = createContext<ToastApi | null>(null);

const TOAST_MS = 4000;

/**
 * Success feedback: a short toast that clears itself after 4 seconds. It sits bottom-centre above the
 * bottom nav on phones and top-right on larger screens. Errors never use it; they stay inline next to
 * the button that caused them.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<readonly ToastItem[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const show = useCallback(
    (message: string) => {
      counter.current += 1;
      const id = counter.current;
      setItems((current) => [...current.slice(-2), { id, message }]);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), TOAST_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const active = timers.current;
    return () => {
      for (const timer of active.values()) window.clearTimeout(timer);
      active.clear();
    };
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="status" aria-live="polite" aria-atomic="false">
        {items.map((item) => (
          <p className="toast" key={item.id}>
            <span className="toast-mark" aria-hidden="true">
              ✓
            </span>
            {item.message}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const NOOP: ToastApi = { show: () => undefined };

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP;
}
