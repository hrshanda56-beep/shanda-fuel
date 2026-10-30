import { describe, expect, it } from 'vitest';
import { AppError } from '../../platform/errors';
import { readUploadForm } from './read-upload-form';

describe('readUploadForm', () => {
  it('returns the form of a real upload', async () => {
    const form = new FormData();
    form.set('note', 'hello');
    const request = new Request('http://localhost/api/documents', { method: 'POST', body: form });
    expect((await readUploadForm(request)).get('note')).toBe('hello');
  });

  it('says what is wrong, in plain words, when the request is not an upload (never a bare 500)', async () => {
    const request = new Request('http://localhost/api/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const error = await readUploadForm(request).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
    expect((error as AppError).message).toContain('Choose the file again');
  });

  it('passes on an error that already explains itself, such as a file that is too large', async () => {
    const tooLarge = new AppError(
      'VALIDATION_FAILED',
      'The file is too large. The limit is 10 MB.',
    );
    const request = {
      formData: () => Promise.reject(tooLarge),
    } as unknown as Request;
    await expect(readUploadForm(request)).rejects.toBe(tooLarge);
  });
});
