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

  async getObject(key: string): Promise<Buffer> {
    const response = await s3Client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    const bytes = await response.Body!.transformToByteArray();
    return Buffer.from(bytes);
  },

  async getPresignedUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key });
    const signed = await getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_TTL_SECONDS });
    // Relative on purpose, same reasoning as apps/web/src/lib/env.ts's API_URL: the
    // signature is computed against S3_ENDPOINT's host (SigV4 signs the Host header), so
    // this must be fetched through something that reaches MinIO as that exact host — never
    // handed to the browser as an absolute S3_ENDPOINT URL (a proxy that rewrites Host,
    // like a public tunnel, would invalidate the signature). The Next.js rewrite for this
    // bucket's path proxies it to S3_ENDPOINT server-side instead, so a relative path
    // resolves correctly from whatever origin the page itself was loaded from.
    const { pathname, search } = new URL(signed);
    return `${pathname}${search}`;
  },

  async deleteObject(key: string): Promise<void> {
    await s3Client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  },
};
