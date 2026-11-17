import type { ContextResolution } from '../modules/context/contracts';
import type { AppShellProps } from './app-shell';

/**
 * What the sidebar and header showed on the last page, kept in the browser for the rest of the
 * visit. The loading screen draws the same shell from it, so moving between pages leaves the
 * sidebar where it is and only the page area changes. It holds what the shell already received
 * from the server for this session, never page data, and starts empty on every full page load.
 */
export type RememberedShell = Readonly<
  Pick<
    AppShellProps,
    'navigationProjection' | 'navigationContext' | 'role' | 'userName' | 'authProvider'
  > & { resolution?: ContextResolution }
>;

let remembered: RememberedShell | null = null;

export function rememberShell(update: Partial<RememberedShell>) {
  remembered = { ...(remembered ?? { navigationProjection: [] }), ...update };
}

/** The last shell shown, or null before any page has been shown in this visit. */
export function recallShell(): RememberedShell | null {
  return remembered && remembered.navigationProjection.length > 0 ? remembered : null;
}
