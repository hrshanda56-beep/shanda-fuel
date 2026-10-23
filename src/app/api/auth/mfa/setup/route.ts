// Authentication and MFA enrollment are managed by Clerk.
export const runtime = 'nodejs';

function retiredEndpoint(): Response {
  return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

export const GET = retiredEndpoint;
export const POST = retiredEndpoint;
