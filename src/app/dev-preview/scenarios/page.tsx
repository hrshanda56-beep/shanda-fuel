import { notFound } from 'next/navigation';
import { isDevOnlySurfaceAvailable } from '@/design-system/reference/availability';
import { SCENARIOS } from '../my-shift-scenarios';

export const metadata = { title: 'My Shift scenarios' };

/** Preview-only index: each link switches the data My Shift shows. */
export default function ScenariosPage() {
  if (!isDevOnlySurfaceAvailable()) notFound();
  return (
    <main
      style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px', fontFamily: 'system-ui' }}
    >
      <h1>My Shift scenarios</h1>
      <p>Pick one, then use /as/attendant to see it as an attendant.</p>
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
        {SCENARIOS.map((s) => (
          <li key={s.id}>
            <a
              href={`/dev-preview/scenario/${s.id}`}
              style={{ display: 'block', padding: 12, border: '1px solid #8886', borderRadius: 8 }}
            >
              <strong>{s.title}</strong>
              <br />
              <small>{s.note}</small>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
