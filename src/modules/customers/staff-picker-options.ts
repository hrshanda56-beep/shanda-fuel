/**
 * Staff who can still be given a fuel benefit, as the benefit page's picker lists them. People are
 * added in Settings > Staff; here they are only chosen, so every benefit points at one staff record.
 */
export type StaffPickerOption = Readonly<{
  membershipId: string;
  name: string;
  email: string;
}>;

/** Case-insensitive match on name or email; an empty query lists everyone. Display only. */
export function filterStaffOptions(
  options: readonly StaffPickerOption[],
  query: string,
): StaffPickerOption[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...options];
  return options.filter((option) => {
    const haystack = `${option.name} ${option.email}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
