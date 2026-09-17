import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { Config } from '../config.ts'
import { randomUUID } from 'node:crypto'
import { convertToWebp, type ConvertedImage } from './image-converter.ts'

const EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

export type UploadImageInput = {
  body: string
  mimeType: string
}

export function createImageRepository(config: Config) {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccess,
    },
  })

  function isEnabled(): boolean {
    return Boolean(
      config.r2AccountId &&
      config.r2AccessKeyId &&
      config.r2SecretAccess &&
      config.r2BucketName,
    )
  }

  function ensureEnabled(): void {
    if (!isEnabled()) {
      throw new Error(
        'R2 is not configured. Check R2_ACCOUNT_ID, ' +
          'R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.',
      )
    }
  }

  async function upload(input: UploadImageInput): Promise<string> {
    ensureEnabled()

    const extension = EXTENSION_BY_MIME_TYPE[input.mimeType]

    if (!extension) {
      throw new Error(`Unsupported image MIME type: ${input.mimeType}`)
    }

    // input.body is base64 text; R2 must receive the decoded bytes, or the
    // object is stored as text and no viewer can open it.
    const original = Buffer.from(input.body, 'base64')

    if (original.byteLength === 0) {
      throw new Error('Cannot upload an empty image')
    }

    const image = await toStoredImage(original, input.mimeType, extension)

    const now = new Date()
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    const key = `slips/${year}/${month}/${randomUUID()}.${image.extension}`

    await client.send(
      new PutObjectCommand({
        Bucket: config.r2BucketName,
        Key: key,
        Body: image.body,
        ContentType: image.mimeType,
        CacheControl: 'private, max-age=3600',
        Metadata: {
          source: 'discord',
        },
      }),
    )
    return key
  }

  async function remove(key: string): Promise<void> {
    ensureEnabled()

    if (!key.startsWith("slips/")) {
      throw new Error(`Refusing to delete an invalid R2 key: ${key}`);
    }

    await client.send(
      new DeleteObjectCommand({
        Bucket: config.r2BucketName,
        Key: key
      })
    )
  }
  return {
    isEnabled,
    upload,
    remove,
  }
}

/**
 * The prebuilt sharp binary cannot decode HEIC (the HEVC codec is not bundled),
 * so an iPhone photo would fail to convert. Keep the original rather than lose
 * the slip.
 */
async function toStoredImage(
  original: Buffer,
  mimeType: string,
  extension: string,
): Promise<ConvertedImage> {
  try {
    return await convertToWebp(original)
  } catch (err: unknown) {
    console.warn(`Could not convert ${mimeType} to WebP, storing the original:`, err)
    return { body: original, mimeType, extension }
  }
}

export type ImageRepository = ReturnType<typeof createImageRepository>
