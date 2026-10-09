import { EntryShell } from '@/design-system/entry/entry-shell';

/** Session resolving: brand frame and a quiet status, never dashboard chrome. */
export default function WorkplaceLoading() {
  return (
    <EntryShell>
      <section aria-labelledby="entry-title" aria-busy="true">
        <header className="entry-heading">
          <h1 id="entry-title">Getting things ready</h1>
          <p role="status">Checking your account…</p>
        </header>
        <div className="entry-skeleton" aria-hidden="true">
          <span />
          <span />
        </div>
      </section>
    </EntryShell>
  );
}
