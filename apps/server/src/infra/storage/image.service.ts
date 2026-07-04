import sharp from "sharp";

export interface ProcessedImage {
  buffer: Buffer;
  contentType: "image/webp";
}

async function processTo(buffer: Buffer, maxDimension: number, quality: number): Promise<ProcessedImage> {
  const output = await sharp(buffer)
    .rotate()
    .resize({ width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();
  return { buffer: output, contentType: "image/webp" };
}

export const imageService = {
  async processOriginal(buffer: Buffer, maxDimension: number): Promise<ProcessedImage> {
    return processTo(buffer, maxDimension, 80);
  },

  async processThumbnail(buffer: Buffer, dimension: number): Promise<ProcessedImage> {
    return processTo(buffer, dimension, 70);
  },
};
