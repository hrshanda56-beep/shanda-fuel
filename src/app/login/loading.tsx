/**
 * Sign-in is not a signed-in page: it has no shell to draw around a skeleton, so it shows nothing
 * while it loads rather than the app's page skeleton (which the root `loading.tsx` would give it).
 */
export default function Loading() {
  return null;
}
