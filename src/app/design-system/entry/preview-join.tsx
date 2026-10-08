'use client';

import { JoinWorkspaceForm } from '@/design-system/entry/invite-views';

/** Review-only wrapper: the real accept command is a function and cannot cross from a server page. */
export function PreviewJoin({
  organisationName,
  email,
}: {
  organisationName: string;
  email: string;
}) {
  return (
    <JoinWorkspaceForm
      organisationName={organisationName}
      email={email}
      accept={async () => ({ ok: true })}
    />
  );
}
