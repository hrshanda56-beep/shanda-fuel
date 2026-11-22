'use client';

import { Button } from '@/design-system/primitives';
import { ZERA_DEADLINE_WORDING } from '../zera-wizard-checks';
import { ZERA_SECTIONS, shortLabel } from '../zera-pdf';
import styles from './zera-document.module.css';

/** The saved return as a finished document, grouped as the ZERA form groups it, with copy buttons. */
export function ZeraDocument({
  answers,
  periodLabel,
  stationName,
  version,
  savedOn,
  copied,
  onCopy,
}: {
  answers: readonly { label: string; value: string }[];
  periodLabel: string;
  stationName: string;
  version: number | null;
  savedOn: string;
  copied: string | null;
  onCopy: (label: string, value: string) => void;
}) {
  return (
    <article className={styles.paper} aria-label={`ZERA return for ${periodLabel}`}>
      <header className={styles.band}>
        <p className={styles.kicker}>ZERA monthly return</p>
        <h2 className={styles.period}>{periodLabel}</h2>
        <p className={styles.station}>{stationName}</p>
      </header>
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Station</dt>
          <dd className={styles.factValue}>{stationName}</dd>
        </div>
        {version ? (
          <div className={styles.fact}>
            <dt className={styles.factLabel}>Version</dt>
            <dd className={styles.factValue}>{version}</dd>
          </div>
        ) : null}
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Saved</dt>
          <dd className={styles.factValue}>{savedOn}</dd>
        </div>
      </dl>
      <p className={styles.note}>
        <span className={styles.noteLabel}>From ZERA</span>
        {ZERA_DEADLINE_WORDING}
      </p>
      {ZERA_SECTIONS.map((section) => {
        const rows = answers.slice(section.from, section.to);
        if (rows.length === 0) return null;
        return (
          <section key={section.title} className={styles.section}>
            <h3 className={styles.sectionTitle}>{section.title}</h3>
            {rows.map((answer) => (
              <div key={answer.label} className={styles.row}>
                <span className={styles.label}>{shortLabel(answer.label)}</span>
                <span
                  className={answer.value.trim() ? styles.value : `${styles.value} ${styles.empty}`}
                >
                  {answer.value.trim() || 'Not given'}
                </span>
                <Button
                  type="button"
                  variant="quiet"
                  size="sm"
                  className={styles.copy}
                  aria-label={`Copy ${answer.label}`}
                  onClick={() => onCopy(answer.label, answer.value)}
                >
                  {copied === answer.label ? 'Copied' : 'Copy'}
                </Button>
              </div>
            ))}
          </section>
        );
      })}
    </article>
  );
}
