import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  getServerEnv,
  isValidR2AccountId,
  isValidR2BucketName,
  type ServerEnv,
} from '../config/env';
import { createLogger } from '../logging';

const keyPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/;
const identifierPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const namespacePattern = /^[a-zA-Z0-9_-]{1,100}(?:\/[a-zA-Z0-9_-]{1,100})*$/;
const mimeTypePattern =
  /^[A-Za-z0-9!#$%&'*+.^_`|~-]+\/[A-Za-z0-9!#$%&'*+.^_`|~-]+(?:[ \t]*;[ \t]*[A-Za-z0-9!#$%&'*+.^_`|~-]+=(?:[A-Za-z0-9!#$%&'*+.^_`|~-]+|"(?:[\x20-\x21\x23-\x5B\x5D-\x7E]|\\[\x20-\x7E])*"))*$/;
const maxContentTypeLength = 255;
const maxSignedUrlSeconds = 15 * 60;
const logger = createLogger({ component: 'platform.storage' });

function logProviderFailure() {
  logger.error('Platform provider operation failed', { service: 'r2', errorCode: 'provider' });
}

declare const objectKeyBrand: unique symbol;
export type PrivateObjectKey = string & { readonly [objectKeyBrand]: true };

export function createPrivateObjectKey(namespace: string, recordId: string): PrivateObjectKey {
  if (!namespacePattern.test(namespace) || !identifierPattern.test(recordId)) {
    throw new StorageError('invalid_key', 'The private object key is invalid');
  }
  return `private/${namespace}/${recordId}` as PrivateObjectKey;
}

export function createUniquePrivateObjectKey(namespace: string): PrivateObjectKey {
  return createPrivateObjectKey(namespace, randomUUID());
}

export class StorageError extends Error {
  constructor(
    readonly code:
      | 'configuration'
      | 'invalid_key'
      | 'invalid_content_type'
      | 'invalid_expiry'
      | 'not_found'
      | 'provider',
    message: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export type StoredObject = {
  body: Uint8Array;
  contentType: string;
  contentLength?: number;
};

export interface PrivateStorage {
  put(input: { key: PrivateObjectKey; body: Uint8Array; contentType: string }): Promise<void>;
  get(key: PrivateObjectKey): Promise<StoredObject>;
  createReadUrl(key: PrivateObjectKey, expiresInSeconds?: number): Promise<string>;
  delete(key: PrivateObjectKey): Promise<void>;
}

type Client = { send(command: unknown): Promise<unknown> };
type SignUrl = (
  client: S3Client,
  command: GetObjectCommand,
  options: { expiresIn: number },
) => Promise<string>;

function checkedKey(key: PrivateObjectKey): string {
  if (
    !key.startsWith('private/') ||
    !keyPattern.test(key) ||
    key.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new StorageError('invalid_key', 'The private object key is invalid');
  }
  return key;
}

function checkedContentType(contentType: string): string {
  if (
    contentType.length === 0 ||
    contentType.length > maxContentTypeLength ||
    /[\x00-\x08\x0A-\x1F\x7F]/.test(contentType) ||
    !mimeTypePattern.test(contentType)
  ) {
    throw new StorageError('invalid_content_type', 'The object content type is invalid');
  }
  return contentType;
}

export function createR2Storage(
  env: ServerEnv = getServerEnv(),
  dependencies: { client?: Client; signUrl?: SignUrl } = {},
): PrivateStorage {
  const {
    R2_ACCOUNT_ID: accountId,
    R2_BUCKET: bucket,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
  } = env;
  if (
    !accountId ||
    !bucket ||
    !accessKeyId ||
    !secretAccessKey ||
    !isValidR2AccountId(accountId) ||
    !isValidR2BucketName(bucket)
  ) {
    throw new StorageError('configuration', 'Private storage is not configured');
  }
  const awsClient = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId.toLowerCase()}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  const client = dependencies.client ?? (awsClient as unknown as Client);
  const signUrl = dependencies.signUrl ?? getSignedUrl;

  return {
    async put({ key, body, contentType }) {
      const safeContentType = checkedContentType(contentType);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: checkedKey(key),
            Body: body,
            ContentType: safeContentType,
          }),
        );
      } catch {
        logProviderFailure();
        throw new StorageError('provider', 'Private storage operation failed');
      }
    },
    async get(key) {
      try {
        const result = (await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: checkedKey(key) }),
        )) as {
          Body?: { transformToByteArray?: () => Promise<Uint8Array> };
          ContentType?: string;
          ContentLength?: number;
        };
        if (!result.Body?.transformToByteArray || !result.ContentType) {
          throw new StorageError('provider', 'Private storage returned an invalid object');
        }
        return {
          body: await result.Body.transformToByteArray(),
          contentType: result.ContentType,
          ...(result.ContentLength === undefined ? {} : { contentLength: result.ContentLength }),
        };
      } catch (error) {
        if (error instanceof StorageError) throw error;
        if (error && typeof error === 'object' && 'name' in error && error.name === 'NoSuchKey') {
          throw new StorageError('not_found', 'Private object was not found');
        }
        logProviderFailure();
        throw new StorageError('provider', 'Private storage operation failed');
      }
    },
    async createReadUrl(key, expiresInSeconds = 300) {
      if (
        !Number.isInteger(expiresInSeconds) ||
        expiresInSeconds < 1 ||
        expiresInSeconds > maxSignedUrlSeconds
      ) {
        throw new StorageError(
          'invalid_expiry',
          'Signed URL expiry must be between 1 and 900 seconds',
        );
      }
      try {
        return await signUrl(
          awsClient,
          new GetObjectCommand({ Bucket: bucket, Key: checkedKey(key) }),
          { expiresIn: expiresInSeconds },
        );
      } catch {
        logProviderFailure();
        throw new StorageError('provider', 'Private storage operation failed');
      }
    },
    async delete(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: checkedKey(key) }));
      } catch {
        logProviderFailure();
        throw new StorageError('provider', 'Private storage operation failed');
      }
    },
  };
}
