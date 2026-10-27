'use client';

import { useEffect, useState } from 'react';

import { useLocationSearch } from './location-search';
import { Button } from './primitives';

/**
 * Right after signing in, says which station the person is working at and offers to change it.
 * The sign-in steps add `?welcome=1`; it is removed from the address at once so a refresh or a
 * bookmark never shows the reminder again.
 */
export function SignInReminder({
  station,
  onChange,
}: Readonly<{ station: string | undefined; onChange: () => void }>) {
  const search = useLocationSearch();
  const [announced, setAnnounced] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('welcome') !== '1') return;
    url.searchParams.delete('welcome');
    window.history.replaceState(window.history.state, '', url);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- latch once; the address no longer holds the flag
    setAnnounced(true);
  }, [search]);

  if (!announced || !station) return null;
  return (
    <div className="sign-in-reminder" role="status">
      <p>
        You are working at <strong>{station}</strong>.
      </p>
      <Button type="button" variant="quiet" size="sm" onClick={onChange}>
        Change station
      </Button>
      <Button type="button" variant="quiet" size="sm" onClick={() => setAnnounced(false)}>
        Dismiss
      </Button>
    </div>
  );
}
