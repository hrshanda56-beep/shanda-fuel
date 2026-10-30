import { notFound } from 'next/navigation';

import { devBypassUsers } from '@/platform/auth/dev-bypass';

export const dynamic = 'force-dynamic';

export default function DevLoginPage() {
  const users = devBypassUsers();
  if (users.length === 0) notFound();
  return (
    <main style={{ maxWidth: 420, margin: '10vh auto', padding: 16 }}>
      <h1>Local sign-in</h1>
      <p>Development only. No password; Clerk is not contacted.</p>
      <form action="/api/dev-login" method="post" style={{ display: 'grid', gap: 8 }}>
        {users.map((user) => (
          <button key={user.providerUserId} name="user" value={user.providerUserId} type="submit">
            Continue as {user.label}
          </button>
        ))}
        <button name="user" value="__signout" type="submit">
          Sign out
        </button>
      </form>
    </main>
  );
}
