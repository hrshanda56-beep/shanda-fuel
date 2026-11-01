'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Select } from '@/design-system/forms';
import { Button, ErrorState, Field, LoadingState } from '@/design-system/primitives';

import {
  DOCUMENT_KINDS,
  MAX_DOCUMENT_BYTES,
  documentKindLabel,
  formatFileSize,
  type DocumentKind,
  type DocumentSubjectType,
} from '../catalog';

type Item = {
  documentId: string;
  kind: string;
  fileName: string;
  byteSize: number;
  uploadedAt: string;
  uploadedByName: string | null;
};

const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,application/pdf,.docx';

/**
 * Files kept against one record: add a photo or PDF, see what is already there, open a file.
 * Files are private; opening one asks for a short-lived link first.
 */
export function DocumentAttachments({
  tenantId,
  stationId,
  subjectType,
  subjectId,
  defaultKind = 'OTHER',
  title = 'Documents',
}: Readonly<{
  tenantId: string;
  stationId: string;
  subjectType: DocumentSubjectType;
  subjectId: string;
  defaultKind?: DocumentKind;
  title?: string;
}>) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [canUpload, setCanUpload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<DocumentKind>(defaultKind);
  const [fileError, setFileError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ tenantId, stationId, subjectType, subjectId });
      const response = await fetch(`/api/documents?${params}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const result = (await response.json()) as {
        items?: Item[];
        canUpload?: boolean;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(
          response.status === 403
            ? 'You do not have permission to see these documents.'
            : (result.message ?? 'The documents could not be loaded.'),
        );
      }
      setItems(result.items ?? []);
      setCanUpload(Boolean(result.canUpload));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The documents could not be loaded.');
    }
  }, [tenantId, stationId, subjectType, subjectId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = (form.elements.namedItem('file') as HTMLInputElement | null)?.files?.[0];
    if (!file) return setFileError('Choose a file first.');
    if (file.size > MAX_DOCUMENT_BYTES) return setFileError('That file is over 10 MB.');
    setFileError(null);
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set('tenantId', tenantId);
      body.set('stationId', stationId);
      body.set('subjectType', subjectType);
      body.set('subjectId', subjectId);
      body.set('kind', kind);
      body.set('file', file);
      const response = await fetch('/api/documents', {
        method: 'POST',
        credentials: 'same-origin',
        body,
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        throw new Error(result.message ?? 'The file could not be added. Nothing was saved.');
      }
      form.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The file could not be added.');
    } finally {
      setBusy(false);
    }
  }

  async function open(documentId: string) {
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}?tenantId=${tenantId}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const result = (await response.json()) as { downloadUrl?: string; message?: string };
      if (!response.ok || !result.downloadUrl) {
        throw new Error(result.message ?? 'The file could not be opened.');
      }
      window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The file could not be opened.');
    }
  }

  return (
    <section aria-label={title} className="doc-attach">
      <div className="doc-attach-head">
        <h4>{title}</h4>
        {items && items.length === 0 ? (
          <span className="field-hint">No documents added yet.</span>
        ) : null}
      </div>
      {error ? <ErrorState message={error} /> : null}
      {items === null && !error ? <LoadingState label="Loading documents" /> : null}
      {items && items.length > 0 ? (
        <ul className="stack" aria-label={`${title} added`}>
          {items.map((item) => (
            <li key={item.documentId}>
              <Button variant="quiet" onClick={() => void open(item.documentId)}>
                {documentKindLabel(item.kind)}: {item.fileName}
              </Button>{' '}
              <span className="field-hint">
                {formatFileSize(item.byteSize)}
                {item.uploadedByName ? ` · added by ${item.uploadedByName}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {canUpload ? (
        <form onSubmit={upload} className="doc-attach-form">
          <Field id={`doc-kind-${subjectId}`} label="What is it?">
            <Select
              id={`doc-kind-${subjectId}`}
              value={kind}
              onChange={(event) => setKind(event.target.value as DocumentKind)}
              options={DOCUMENT_KINDS.map((entry) => ({ value: entry.value, label: entry.label }))}
            />
          </Field>
          <Field id={`doc-file-${subjectId}`} label="File">
            <input
              id={`doc-file-${subjectId}`}
              name="file"
              type="file"
              accept={ACCEPT}
              className="doc-attach-file"
            />
          </Field>
          <Button type="submit" variant="secondary" loading={busy} className="doc-attach-add">
            Add file
          </Button>
          {fileError ? (
            <p className="field-error doc-attach-error" role="alert">
              {fileError}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
