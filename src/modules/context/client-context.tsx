'use client';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { rememberShell } from '@/design-system/shell-memory';
import type { ContextResolution } from './contracts';
import { createContextReader } from './context-reader';

const ContextSnapshot = createContext<ContextResolution | undefined>(undefined);
export function useWorkContextSnapshot() {
  return useContext(ContextSnapshot);
}
const ContextRead = createContext<typeof fetch | null>(null);
export function WorkContextProvider({
  resolution,
  children,
}: {
  resolution?: ContextResolution;
  children: ReactNode;
}) {
  const read = useMemo(() => createContextReader(resolution), [resolution]);
  // The loading screen draws the shell again from this while the next page loads.
  useEffect(() => {
    if (resolution) rememberShell({ resolution });
  }, [resolution]);
  return (
    <ContextSnapshot.Provider value={resolution}>
      <ContextRead.Provider value={read}>{children}</ContextRead.Provider>
    </ContextSnapshot.Provider>
  );
}
export function useContextFetch(): typeof fetch {
  return useContext(ContextRead) ?? fetch;
}
