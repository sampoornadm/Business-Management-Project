import { createHash } from "node:crypto";

import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

export function hashPassword(plainText: string): Promise<string> {
  return bcrypt.hash(plainText, SALT_ROUNDS);
}

export function comparePassword(plainText: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainText, hash);
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
