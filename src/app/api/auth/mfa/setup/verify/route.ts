// Authentication and MFA enrollment are managed by Clerk.
export const runtime = 'nodejs';

function retiredEndpoint(_request?: Request): Response {
  return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

export const POST = retiredEndpoint;
