'use client';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { loadBrand } from '@/design-system/brand-memory';
import { rememberShell } from '@/design-system/shell-memory';
import type { ContextResolution } from './contracts';
import { PageDraftKeeper } from '../../platform/drafts/page-draft-keeper';
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
    // ... and wears the company's own logo, asked for once per company.
    const company = resolution?.current?.organisationId;
    if (company) void loadBrand(company);
  }, [resolution]);
  return (
    <ContextSnapshot.Provider value={resolution}>
      <ContextRead.Provider value={read}>
        <PageDraftKeeper />
        {children}
      </ContextRead.Provider>
    </ContextSnapshot.Provider>
  );
}
export function useContextFetch(): typeof fetch {
  return useContext(ContextRead) ?? fetch;
}
