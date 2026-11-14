// The app's only S3 access: presigned POST for uploads (KTD7), HeadObject and
// copy/delete for confirm (KTD8), and presigned GET for playback (KTD9).
// Tests inject an S3Client with fake credentials and mock its commands.
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Config } from '../config.js'

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
export const UPLOAD_POLICY_SECONDS = 5 * 60
export const PLAYBACK_URL_SECONDS = 60 * 60

/** One client per app. Explicit keys if configured, else the default provider chain. */
export function createS3Client(config: Config): S3Client {
  const { region, accessKeyId, secretAccessKey } = config.aws
  return new S3Client({
    region,
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    // Keep the SDK from adding checksum parameters that presigned browser
    // requests cannot satisfy.
    requestChecksumCalculation: 'WHEN_REQUIRED',
  })
}

export interface ObjectInfo {
  size: number
  contentType: string
}

export interface Storage {
  presignUpload(input: { key: string; contentType: string }): Promise<{
    url: string
    fields: Record<string, string>
  }>
  /** Throws the SDK's NotFound when the object is missing (see isMissingObject). */
  headObject(key: string): Promise<ObjectInfo>
  promote(fromKey: string, toKey: string): Promise<void>
  deleteObject(key: string): Promise<void>
  presignPlayback(key: string): Promise<{ url: string; expiresAt: string }>
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

export function s3Storage(client: S3Client, bucket: string): Storage {
  return {
    async presignUpload({ key, contentType }) {
      return createPresignedPost(client, {
        Bucket: bucket,
        Key: key,
        Conditions: [
          ['content-length-range', 1, MAX_UPLOAD_BYTES],
          ['eq', '$Content-Type', contentType],
          { key },
        ],
        Fields: { 'Content-Type': contentType },
        Expires: UPLOAD_POLICY_SECONDS,
      })
    },

    async headObject(key) {
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      return { size: head.ContentLength ?? 0, contentType: head.ContentType ?? '' }
    },

    async promote(fromKey, toKey) {
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: toKey,
          CopySource: `${encodeURIComponent(bucket)}/${encodeKey(fromKey)}`,
        }),
      )
    },

    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },

    async presignPlayback(key) {
      const expiresAt = new Date(Date.now() + PLAYBACK_URL_SECONDS * 1000).toISOString()
      const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: PLAYBACK_URL_SECONDS,
      })
      return { url, expiresAt }
    },
  }
}

/** True for the SDK errors S3 returns when an object does not exist. */
export function isMissingObject(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const { name, $metadata } = err as { name?: unknown; $metadata?: { httpStatusCode?: number } }
  return name === 'NotFound' || name === 'NoSuchKey' || $metadata?.httpStatusCode === 404
}
