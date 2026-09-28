import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
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
const recoveryFormatVersion = 'shanda-fuel.r2-recovery.v1';
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
      | 'backup_unavailable'
      | 'checksum_mismatch'
      | 'configuration'
      | 'destination_already_present'
      | 'invalid_key'
      | 'invalid_content_type'
      | 'invalid_expiry'
      | 'missing_recovery_copy'
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

export type RecoveryArtifact = {
  backupId: string;
  createdAt: string;
  sha256: string;
  byteLength: number;
  contentType: string;
};

export interface PrivateStorage {
  put(input: {
    key: PrivateObjectKey;
    body: Uint8Array;
    contentType: string;
  }): Promise<void | RecoveryArtifact>;
  get(key: PrivateObjectKey): Promise<StoredObject>;
  createReadUrl(key: PrivateObjectKey, expiresInSeconds?: number): Promise<string>;
  delete(key: PrivateObjectKey): Promise<void>;
}

export interface RecoverablePrivateStorage extends PrivateStorage {
  put(input: {
    key: PrivateObjectKey;
    body: Uint8Array;
    contentType: string;
  }): Promise<RecoveryArtifact>;
  restore(input: { key: PrivateObjectKey; backupId: string }): Promise<RecoveryArtifact>;
}

type Client = { send(command: unknown): Promise<unknown> };
type SignUrl = (
  client: S3Client,
  command: GetObjectCommand,
  options: { expiresIn: number },
) => Promise<string>;

type PrimaryConfiguration = {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

type RecoveryConfiguration = {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

type R2Dependencies = {
  client?: Client;
  primaryClient?: Client;
  recoveryClient?: Client;
  signUrl?: SignUrl;
  backupId?: () => string;
  now?: () => Date;
};

type RecoveryManifest = RecoveryArtifact & {
  formatVersion: typeof recoveryFormatVersion;
  sourceBucket: string;
  sourceKey: string;
  recoveryObjectKey: string;
  manifestKey: string;
};

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

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isNoSuchKey(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'name' in error && error.name === 'NoSuchKey',
  );
}

function isPreconditionFailure(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'name' in error &&
    (error.name === 'PreconditionFailed' || error.name === 'ConditionalRequestConflict'),
  );
}

function primaryConfiguration(env: ServerEnv): PrimaryConfiguration {
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
  return { accountId, bucket, accessKeyId, secretAccessKey };
}

function recoveryConfiguration(env: ServerEnv, primaryBucket: string): RecoveryConfiguration {
  const {
    R2_RECOVERY_BUCKET: bucket,
    R2_RECOVERY_ACCESS_KEY_ID: accessKeyId,
    R2_RECOVERY_SECRET_ACCESS_KEY: secretAccessKey,
  } = env;
  if (
    !bucket ||
    !accessKeyId ||
    !secretAccessKey ||
    !isValidR2BucketName(bucket) ||
    bucket === primaryBucket
  ) {
    throw new StorageError('configuration', 'Private recovery storage is not configured');
  }
  return { bucket, accessKeyId, secretAccessKey };
}

function createClient(configuration: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
}): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${configuration.accountId.toLowerCase()}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: configuration.accessKeyId,
      secretAccessKey: configuration.secretAccessKey,
    },
  });
}

async function getObject(client: Client, bucket: string, key: string): Promise<StoredObject> {
  try {
    const result = (await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))) as {
      Body?: { transformToByteArray?: () => Promise<Uint8Array> };
      ContentType?: string;
      ContentLength?: number;
    };
    if (!result.Body?.transformToByteArray || !result.ContentType) {
      throw new StorageError('provider', 'Private storage returned an invalid object');
    }
    const contentType = checkedContentType(result.ContentType);
    const body = await result.Body.transformToByteArray();
    return {
      body,
      contentType,
      ...(result.ContentLength === undefined ? {} : { contentLength: result.ContentLength }),
    };
  } catch (error) {
    if (error instanceof StorageError) throw error;
    if (isNoSuchKey(error)) throw new StorageError('not_found', 'Private object was not found');
    logProviderFailure();
    throw new StorageError('provider', 'Private storage operation failed');
  }
}

function createRawStorage(
  configuration: PrimaryConfiguration,
  dependencies: { client?: Client; signUrl?: SignUrl },
): PrivateStorage {
  const awsClient = createClient(configuration);
  const client = dependencies.client ?? (awsClient as unknown as Client);
  const signUrl = dependencies.signUrl ?? getSignedUrl;

  return {
    async put({ key, body, contentType }) {
      const safeKey = checkedKey(key);
      const safeContentType = checkedContentType(contentType);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: configuration.bucket,
            Key: safeKey,
            Body: body,
            ContentType: safeContentType,
          }),
        );
      } catch {
        logProviderFailure();
        throw new StorageError('provider', 'Private storage operation failed');
      }
    },
    get(key) {
      return getObject(client, configuration.bucket, checkedKey(key));
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
      const safeKey = checkedKey(key);
      try {
        return await signUrl(
          awsClient,
          new GetObjectCommand({ Bucket: configuration.bucket, Key: safeKey }),
          { expiresIn: expiresInSeconds },
        );
      } catch {
        logProviderFailure();
        throw new StorageError('provider', 'Private storage operation failed');
      }
    },
    async delete(key) {
      const safeKey = checkedKey(key);
      try {
        await client.send(new DeleteObjectCommand({ Bucket: configuration.bucket, Key: safeKey }));
      } catch {
        logProviderFailure();
        throw new StorageError('provider', 'Private storage operation failed');
      }
    },
  };
}

function recoveryObjectKey(sourceKeyDigest: string, backupId: string): string {
  return `recovery/v1/objects/${sourceKeyDigest}/${backupId}`;
}

function recoveryManifestKey(sourceKeyDigest: string, backupId: string): string {
  return `recovery/v1/manifests/${sourceKeyDigest}/${backupId}.json`;
}

function recoveryManifestPrefix(sourceKeyDigest: string): string {
  return `recovery/v1/manifests/${sourceKeyDigest}/`;
}

function manifestFromBytes(
  body: Uint8Array,
  contentType: string,
  sourceBucket: string,
  sourceKey: string,
  backupId: string,
  createdAt: string,
): RecoveryManifest {
  const sourceKeyDigest = sha256(sourceKey);
  return {
    backupId,
    createdAt,
    sha256: sha256(body),
    byteLength: body.byteLength,
    contentType,
    formatVersion: recoveryFormatVersion,
    sourceBucket,
    sourceKey,
    recoveryObjectKey: recoveryObjectKey(sourceKeyDigest, backupId),
    manifestKey: recoveryManifestKey(sourceKeyDigest, backupId),
  };
}

function artifactFromManifest(manifest: RecoveryManifest): RecoveryArtifact {
  return {
    backupId: manifest.backupId,
    createdAt: manifest.createdAt,
    sha256: manifest.sha256,
    byteLength: manifest.byteLength,
    contentType: manifest.contentType,
  };
}

function parseManifest(
  body: Uint8Array,
  sourceBucket: string,
  sourceKey: string,
  backupId: string,
): RecoveryManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new StorageError('missing_recovery_copy', 'Retained recovery metadata is invalid');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as RecoveryManifest).formatVersion !== recoveryFormatVersion ||
    (parsed as RecoveryManifest).sourceBucket !== sourceBucket ||
    (parsed as RecoveryManifest).sourceKey !== sourceKey ||
    (parsed as RecoveryManifest).backupId !== backupId ||
    typeof (parsed as RecoveryManifest).createdAt !== 'string' ||
    typeof (parsed as RecoveryManifest).sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test((parsed as RecoveryManifest).sha256) ||
    !Number.isSafeInteger((parsed as RecoveryManifest).byteLength) ||
    (parsed as RecoveryManifest).byteLength < 0 ||
    typeof (parsed as RecoveryManifest).contentType !== 'string' ||
    typeof (parsed as RecoveryManifest).recoveryObjectKey !== 'string' ||
    typeof (parsed as RecoveryManifest).manifestKey !== 'string'
  ) {
    throw new StorageError('missing_recovery_copy', 'Retained recovery metadata is invalid');
  }
  const manifest = parsed as RecoveryManifest;
  const sourceKeyDigest = sha256(sourceKey);
  if (
    manifest.recoveryObjectKey !== recoveryObjectKey(sourceKeyDigest, backupId) ||
    manifest.manifestKey !== recoveryManifestKey(sourceKeyDigest, backupId)
  ) {
    throw new StorageError('missing_recovery_copy', 'Retained recovery metadata is invalid');
  }
  return manifest;
}

async function listManifestKeys(
  client: Client,
  bucket: string,
  sourceKeyDigest: string,
): Promise<string[]> {
  const prefix = recoveryManifestPrefix(sourceKeyDigest);
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    let result: {
      Contents?: { Key?: string }[];
      IsTruncated?: boolean;
      NextContinuationToken?: string;
    };
    try {
      result = (await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      )) as typeof result;
    } catch {
      logProviderFailure();
      throw new StorageError('backup_unavailable', 'Retained recovery storage is unavailable');
    }
    for (const item of result.Contents ?? []) {
      if (item.Key?.startsWith(prefix) && item.Key.endsWith('.json')) keys.push(item.Key);
    }
    if (result.IsTruncated && !result.NextContinuationToken) {
      throw new StorageError('backup_unavailable', 'Retained recovery storage is unavailable');
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

export function createR2SmokeStorage(
  env: ServerEnv = getServerEnv(),
  dependencies: { client?: Client; signUrl?: SignUrl } = {},
): PrivateStorage {
  return createRawStorage(primaryConfiguration(env), dependencies);
}

export function createR2Storage(
  env: ServerEnv = getServerEnv(),
  dependencies: R2Dependencies = {},
): RecoverablePrivateStorage {
  const primary = primaryConfiguration(env);
  const recovery = recoveryConfiguration(env, primary.bucket);
  const awsPrimaryClient = createClient(primary);
  const awsRecoveryClient = createClient({ ...primary, ...recovery });
  const primaryClient =
    dependencies.primaryClient ?? dependencies.client ?? (awsPrimaryClient as unknown as Client);
  const recoveryClient = dependencies.recoveryClient ?? (awsRecoveryClient as unknown as Client);
  const signUrl = dependencies.signUrl ?? getSignedUrl;
  const backupId = dependencies.backupId ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());

  async function verifiedRecoveryArtifact(
    safeKey: string,
    requestedBackupId: string,
  ): Promise<{ artifact: RecoveryArtifact; body: Uint8Array }> {
    if (!identifierPattern.test(requestedBackupId)) {
      throw new StorageError('missing_recovery_copy', 'Retained recovery metadata is invalid');
    }
    const sourceKeyDigest = sha256(safeKey);
    const manifestKey = recoveryManifestKey(sourceKeyDigest, requestedBackupId);
    try {
      const manifestObject = await getObject(recoveryClient, recovery.bucket, manifestKey);
      const manifest = parseManifest(
        manifestObject.body,
        primary.bucket,
        safeKey,
        requestedBackupId,
      );
      const recoveryObject = await getObject(
        recoveryClient,
        recovery.bucket,
        manifest.recoveryObjectKey,
      );
      if (
        recoveryObject.body.byteLength !== manifest.byteLength ||
        recoveryObject.contentType !== manifest.contentType ||
        sha256(recoveryObject.body) !== manifest.sha256
      ) {
        throw new StorageError(
          'checksum_mismatch',
          'Retained recovery object integrity verification failed',
        );
      }
      return { artifact: artifactFromManifest(manifest), body: recoveryObject.body };
    } catch (error) {
      if (error instanceof StorageError && error.code === 'checksum_mismatch') throw error;
      if (error instanceof StorageError && error.code === 'not_found') {
        throw new StorageError('missing_recovery_copy', 'No retained recovery copy is available');
      }
      if (error instanceof StorageError && error.code === 'missing_recovery_copy') throw error;
      logProviderFailure();
      throw new StorageError('backup_unavailable', 'Retained recovery storage is unavailable');
    }
  }

  return {
    async put({ key, body, contentType }) {
      const safeKey = checkedKey(key);
      const safeContentType = checkedContentType(contentType);
      const immutableBody = new Uint8Array(body);
      const generatedBackupId = backupId();
      if (!identifierPattern.test(generatedBackupId)) {
        throw new StorageError('backup_unavailable', 'Retained recovery storage is unavailable');
      }
      const manifest = manifestFromBytes(
        immutableBody,
        safeContentType,
        primary.bucket,
        safeKey,
        generatedBackupId,
        now().toISOString(),
      );
      try {
        await recoveryClient.send(
          new PutObjectCommand({
            Bucket: recovery.bucket,
            Key: manifest.recoveryObjectKey,
            Body: immutableBody,
            ContentType: safeContentType,
            IfNoneMatch: '*',
            Metadata: {
              'sf-backup-id': manifest.backupId,
              'sf-format-version': manifest.formatVersion,
              'sf-sha256': manifest.sha256,
              'sf-source-key-sha256': sha256(safeKey),
            },
          }),
        );
        await recoveryClient.send(
          new PutObjectCommand({
            Bucket: recovery.bucket,
            Key: manifest.manifestKey,
            Body: new TextEncoder().encode(JSON.stringify(manifest)),
            ContentType: 'application/json',
            IfNoneMatch: '*',
            Metadata: {
              'sf-backup-id': manifest.backupId,
              'sf-format-version': manifest.formatVersion,
              'sf-sha256': manifest.sha256,
            },
          }),
        );
      } catch {
        logProviderFailure();
        throw new StorageError('backup_unavailable', 'Retained recovery storage is unavailable');
      }
      try {
        await primaryClient.send(
          new PutObjectCommand({
            Bucket: primary.bucket,
            Key: safeKey,
            Body: immutableBody,
            ContentType: safeContentType,
          }),
        );
      } catch {
        logProviderFailure();
        throw new StorageError('provider', 'Private storage operation failed');
      }
      return artifactFromManifest(manifest);
    },
    get(key) {
      return getObject(primaryClient, primary.bucket, checkedKey(key));
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
      const safeKey = checkedKey(key);
      try {
        return await signUrl(
          awsPrimaryClient,
          new GetObjectCommand({ Bucket: primary.bucket, Key: safeKey }),
          { expiresIn: expiresInSeconds },
        );
      } catch {
        logProviderFailure();
        throw new StorageError('provider', 'Private storage operation failed');
      }
    },
    async delete(key) {
      const safeKey = checkedKey(key);
      const primaryObject = await getObject(primaryClient, primary.bucket, safeKey);
      const sourceKeyDigest = sha256(safeKey);
      const manifestKeys = await listManifestKeys(recoveryClient, recovery.bucket, sourceKeyDigest);
      let retained = false;
      for (const manifestKey of manifestKeys) {
        const requestedBackupId = manifestKey.slice(
          recoveryManifestPrefix(sourceKeyDigest).length,
          -'.json'.length,
        );
        const recovered = await verifiedRecoveryArtifact(safeKey, requestedBackupId);
        if (
          recovered.artifact.sha256 === sha256(primaryObject.body) &&
          recovered.artifact.byteLength === primaryObject.body.byteLength &&
          recovered.artifact.contentType === primaryObject.contentType
        ) {
          retained = true;
          break;
        }
      }
      if (!retained) {
        throw new StorageError(
          'missing_recovery_copy',
          'No verified retained recovery copy is available',
        );
      }
      try {
        await primaryClient.send(new DeleteObjectCommand({ Bucket: primary.bucket, Key: safeKey }));
      } catch {
        logProviderFailure();
        throw new StorageError('provider', 'Private storage operation failed');
      }
    },
    async restore({ key, backupId: requestedBackupId }) {
      const safeKey = checkedKey(key);
      const recovered = await verifiedRecoveryArtifact(safeKey, requestedBackupId);
      try {
        await getObject(primaryClient, primary.bucket, safeKey);
        throw new StorageError(
          'destination_already_present',
          'Restore destination already contains an object',
        );
      } catch (error) {
        if (error instanceof StorageError && error.code === 'destination_already_present')
          throw error;
        if (!(error instanceof StorageError) || error.code !== 'not_found') throw error;
      }
      try {
        await primaryClient.send(
          new PutObjectCommand({
            Bucket: primary.bucket,
            Key: safeKey,
            Body: recovered.body,
            ContentType: recovered.artifact.contentType,
            IfNoneMatch: '*',
          }),
        );
      } catch (error) {
        if (isPreconditionFailure(error)) {
          throw new StorageError(
            'destination_already_present',
            'Restore destination already contains an object',
          );
        }
        logProviderFailure();
        throw new StorageError('provider', 'Private storage operation failed');
      }
      const restored = await getObject(primaryClient, primary.bucket, safeKey);
      if (
        restored.body.byteLength !== recovered.artifact.byteLength ||
        restored.contentType !== recovered.artifact.contentType ||
        sha256(restored.body) !== recovered.artifact.sha256
      ) {
        throw new StorageError(
          'checksum_mismatch',
          'Restored private object integrity verification failed',
        );
      }
      return recovered.artifact;
    },
  };
}
