import { SETTING_KEYS } from "@bmp/types";
import { z } from "zod";

export const settingKeyParamSchema = z.object({
  key: z.enum(SETTING_KEYS),
});
export type SettingKeyParam = z.infer<typeof settingKeyParamSchema>;

export const updateSettingBodySchema = z.object({
  value: z.union([z.string().max(20_000), z.number(), z.boolean()]),
});
export type UpdateSettingBody = z.infer<typeof updateSettingBodySchema>;
