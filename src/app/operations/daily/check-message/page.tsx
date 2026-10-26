import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ShiftMessageCheck } from '@/modules/forecourt/ui/shift-message-check';

export const metadata = {
  title: 'Check a shift message',
};

export default async function CheckShiftMessagePage({
  searchParams,
}: {
  searchParams: Promise<PageSearch>;
}) {
  return (
    <ServerDataPage
      pathname="/operations/daily/check-message"
      search={await searchParams}
      fallback={<ShiftMessageCheck />}
      load={async () => null}
      render={() => <ShiftMessageCheck />}
    />
  );
}
