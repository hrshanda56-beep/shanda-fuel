/**
 * Which tab an arrow key moves to: left and right step (and wrap round the ends), Home and End jump
 * to the first and last. Tabs a screen hides at some widths are skipped (`isVisible`). Any other key
 * is not ours, so it returns null.
 */
export function nextTabIndex(
  key: string,
  current: number,
  count: number,
  isVisible: (index: number) => boolean = () => true,
): number | null {
  if (count <= 0) return null;
  const find = (from: number, step: 1 | -1): number | null => {
    for (let taken = 0; taken < count; taken += 1) {
      const index = (((from + step * taken) % count) + count) % count;
      if (isVisible(index)) return index;
    }
    return null;
  };
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return find(current + 1, 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return find(current - 1, -1);
    case 'Home':
      return find(0, 1);
    case 'End':
      return find(count - 1, -1);
    default:
      return null;
  }
}
