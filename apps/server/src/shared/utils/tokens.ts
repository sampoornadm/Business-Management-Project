import { randomBytes, randomUUID } from "node:crypto";

export function generateOpaqueToken(): string {
  return randomBytes(64).toString("hex");
}

export function generateTokenFamily(): string {
  return randomUUID();
}
