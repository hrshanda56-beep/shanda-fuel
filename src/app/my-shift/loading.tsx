import { Skeleton } from '@/design-system/primitives';

export default function Loading() {
  return (
    <div className="my-shift" aria-busy="true">
      <Skeleton lines={3} label="Loading your shift" />
      <Skeleton lines={3} label="Loading meters" />
    </div>
  );
}
