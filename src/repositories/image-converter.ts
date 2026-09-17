import sharp from 'sharp'

export type ConvertedImage = {
  body: Buffer
  mimeType: string
  extension: string
}

/**
 * Slips are stored as WebP: a phone screenshot or photo shrinks several times
 * over and stays readable.
 *
 * `rotate()` bakes in the EXIF orientation before the metadata is dropped,
 * otherwise a portrait photo comes out sideways. Dropping metadata also drops
 * GPS and device details the slip does not need.
 */
export async function convertToWebp(input: Buffer): Promise<ConvertedImage> {
  const body = await sharp(input, { failOn: 'error' })
    .rotate()
    .webp({ quality: 80 })
    .toBuffer()

  return { body, mimeType: 'image/webp', extension: 'webp' }
}
