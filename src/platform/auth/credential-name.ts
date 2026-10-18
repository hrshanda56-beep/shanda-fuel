/** The staff form currently collects a full name in one field. */
export function clerkCredentialName(firstName?: string, lastName?: string) {
  const parts = firstName?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (lastName?.trim()) return { firstName: parts.join(' '), lastName: lastName.trim() };
  if (parts.length > 1) return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1)! };
  return parts.length ? { firstName: parts[0]! } : {};
}
