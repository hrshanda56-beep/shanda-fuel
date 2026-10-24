import { vi } from 'vitest';

process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-test-audit';
process.env.AUDIT_SIGNING_KEY ??= 'integration-test-audit-secret-not-production';

// Only the integration process interprets this header. Application code never does.
const clerkFixtures = vi.hoisted(() => ({
  sessions: new Map<
    string,
    {
      id: string;
      userId: string;
      internalUserId: string;
      expiresAt: Date;
      factorVerificationAge: [number, number];
      revoked: boolean;
      tenantId?: string;
      level?: 1 | 2;
    }
  >(),
}));

export { clerkFixtures };

vi.mock('@clerk/nextjs/server', () => ({
  reverificationErrorResponse: (level: string) =>
    Response.json({ error: 'CLERK_REVERIFICATION_REQUIRED', level }, { status: 403 }),
  getAuth: (request: Request) => {
    const key = request.headers.get('x-test-clerk-session');
    const session = key ? clerkFixtures.sessions.get(key) : undefined;
    const active = session && !session.revoked && session.expiresAt.getTime() > Date.now();
    return {
      isAuthenticated: Boolean(active),
      userId: active ? session.userId : null,
      sessionId: active ? session.id : null,
      sessionClaims: active ? { exp: Math.floor(session.expiresAt.getTime() / 1000) } : null,
      factorVerificationAge: active ? session.factorVerificationAge : null,
      has: () =>
        Boolean(active && session.factorVerificationAge.every((age) => age >= 0 && age <= 10)),
    };
  },
  clerkClient: async () => ({
    users: { getUser: async () => ({ twoFactorEnabled: true, totpEnabled: true }) },
    sessions: {
      getSessionList: async ({ userId }: { userId: string }) => ({
        data: [...clerkFixtures.sessions.values()]
          .filter((session) => session.userId === userId && !session.revoked)
          .map((session) => ({ id: session.id })),
      }),
      revokeSession: async (id: string) => {
        for (const session of clerkFixtures.sessions.values()) {
          if (session.id === id) session.revoked = true;
        }
      },
    },
  }),
}));
