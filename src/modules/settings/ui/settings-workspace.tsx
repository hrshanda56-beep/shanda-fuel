import {
  AccessDeniedState,
  Card,
  ContextRequiredState,
  StatusBadge,
} from '@/design-system/primitives';
import { PageContainer, Section } from '@/design-system/layout';

import type { SettingsView } from '../contracts';
import { SignOutButton } from './sign-out-button';
import styles from './settings-workspace.module.css';

export function SettingsWorkspace({ view }: { view: SettingsView }) {
  const hasContext = view.context.status === 'ready' && view.context.organisation;

  return (
    <PageContainer width="wide">
      <div className={styles.workspace}>
        {hasContext ? (
          <nav className={styles.sectionNav} aria-label="Settings sections">
            <a href="#organisation">Organisation</a>
            <a href="#legal-entities">Legal entities</a>
            <a href="#stations">Stations</a>
            <a href="#account">Account</a>
          </nav>
        ) : (
          <nav className={styles.sectionNav} aria-label="Settings sections">
            <a href="#account">Account</a>
          </nav>
        )}

        {hasContext ? (
          <>
            <Section
              headingId="organisation"
              title="Organisation"
              description="The organisation available in your authorised work area."
              action={<StatusBadge tone="neutral">Read-only</StatusBadge>}
            >
              <Card className={styles.detailCard}>
                <dl className={styles.detailList}>
                  <div>
                    <dt>Name</dt>
                    <dd>{view.context.organisation.name}</dd>
                  </div>
                </dl>
                <p className={styles.readOnlyNote}>
                  Organisation details are managed through the approved administration process.
                </p>
              </Card>
            </Section>

            <Section
              headingId="legal-entities"
              title="Legal entities"
              description="Legal entities you are authorised to view within this organisation."
              action={<StatusBadge tone="neutral">Read-only</StatusBadge>}
            >
              {view.context.legalEntities.length > 0 ? (
                <ul className={styles.entityList}>
                  {view.context.legalEntities.map((legalEntity) => (
                    <li key={legalEntity.id}>
                      <strong>{legalEntity.name}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <Card>
                  <p className={styles.readOnlyNote}>No authorised legal entities are available.</p>
                </Card>
              )}
            </Section>

            <Section
              headingId="stations"
              title="Stations"
              description="View the selected station’s supported details from the authorised work context."
              action={<StatusBadge tone="neutral">Read-only</StatusBadge>}
            >
              {view.context.selectedStation ? (
                <Card className={styles.detailCard}>
                  <dl className={styles.detailList}>
                    <div>
                      <dt>Name</dt>
                      <dd>{view.context.selectedStation.name}</dd>
                    </div>
                    <div>
                      <dt>Code</dt>
                      <dd>{view.context.selectedStation.code}</dd>
                    </div>
                    <div>
                      <dt>Time zone</dt>
                      <dd>{view.context.selectedStation.timezone}</dd>
                    </div>
                  </dl>
                  <p className={styles.readOnlyNote}>
                    Station details are shown for the selected authorised station.
                  </p>
                </Card>
              ) : (
                <ContextRequiredState
                  title="Choose a station to manage its settings."
                  message="Use Change in the work context bar above to select an authorised station."
                />
              )}
            </Section>
          </>
        ) : (
          <section aria-labelledby="organisation-unavailable">
            <h2 id="organisation-unavailable">Organisation</h2>
            <AccessDeniedState message="No authorised organisation is available for this account." />
          </section>
        )}

        <Section
          headingId="account"
          title="Account"
          description="Your authenticated Shanda Fuel account."
          action={<StatusBadge tone="neutral">Read-only</StatusBadge>}
        >
          <Card className={styles.detailCard}>
            <dl className={styles.detailList}>
              <div>
                <dt>Name</dt>
                <dd>{view.account.name}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{view.account.email}</dd>
              </div>
            </dl>
            <SignOutButton />
          </Card>
        </Section>

        <Section
          headingId="shortcuts"
          title="Keyboard shortcuts"
          description="Quick ways to move around the application."
          action={<StatusBadge tone="neutral">Available</StatusBadge>}
        >
          <Card className={styles.detailCard}>
            <dl className={styles.detailList}>
              <div>
                <dt>Search pages</dt>
                <dd>
                  <kbd>⌘ K</kbd> / <kbd>Ctrl K</kbd>
                </dd>
              </div>
              <div>
                <dt>Close a menu</dt>
                <dd>
                  <kbd>Esc</kbd>
                </dd>
              </div>
            </dl>
          </Card>
        </Section>
      </div>
    </PageContainer>
  );
}
