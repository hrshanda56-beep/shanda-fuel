'use client';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ContextResolution } from './contracts';
import { createContextReader } from './context-reader';

const ContextRead = createContext<typeof fetch | null>(null);
export function WorkContextProvider({
  resolution,
  children,
}: {
  resolution?: ContextResolution;
  children: ReactNode;
}) {
  const read = useMemo(() => createContextReader(resolution), [resolution]);
  return <ContextRead.Provider value={read}>{children}</ContextRead.Provider>;
}
export function useContextFetch(): typeof fetch {
  return useContext(ContextRead) ?? fetch;
}
