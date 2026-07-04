import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "../../config/env.js";

import { s3Client } from "./s3.client.js";

const PRESIGNED_URL_TTL_SECONDS = 15 * 60;

export interface PutObjectParams {
  key: string;
  body: Buffer;
  contentType: string;
}

export const s3Service = {
  bucket: env.S3_BUCKET,

  async putObject({ key, body, contentType }: PutObjectParams): Promise<void> {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  },

  async getPresignedUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key });
    return getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_TTL_SECONDS });
  },

  async deleteObject(key: string): Promise<void> {
    await s3Client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  },
};
