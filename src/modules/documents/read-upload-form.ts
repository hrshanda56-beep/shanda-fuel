import { AppError } from '../../platform/errors';

/**
 * Reads the form of an upload. A request that is not a form upload (the wrong content type, a
 * broken body) is the sender's mistake, so it gets a plain 400 saying what to do rather than an
 * unexplained server error. An error that already explains itself, such as a file over the size
 * limit, is passed on unchanged.
 */
export async function readUploadForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      'VALIDATION_FAILED',
      'The upload could not be read. Choose the file again and send it as an upload. Nothing was saved.',
    );
  }
}
