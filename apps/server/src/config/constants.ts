export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const;

export const AVATAR_UPLOAD_LIMITS = {
  MAX_SIZE_BYTES: 5 * 1024 * 1024,
  ALLOWED_MIME_TYPES: ["image/jpeg", "image/png", "image/webp"] as const,
  ORIGINAL_MAX_DIMENSION: 1024,
  THUMBNAIL_DIMENSION: 128,
};

export const GENERIC_UPLOAD_LIMITS = {
  MAX_SIZE_BYTES: 25 * 1024 * 1024,
  ALLOWED_MIME_TYPES: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/zip",
  ] as const,
};

export const BOQ_UPLOAD_LIMITS = {
  MAX_SIZE_BYTES: 25 * 1024 * 1024,
  ALLOWED_MIME_TYPES: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/pdf",
  ] as const,
};

export const TENDER_EXTRACTION_UPLOAD_LIMITS = {
  MAX_SIZE_BYTES: 25 * 1024 * 1024,
  ALLOWED_MIME_TYPES: [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ] as const,
};

export const RATE_LIMITS = {
  LOGIN: { windowMs: 15 * 60 * 1000, max: 10 },
  REFRESH: { windowMs: 15 * 60 * 1000, max: 30 },
  FORGOT_PASSWORD: { windowMs: 60 * 60 * 1000, max: 5 },
  GENERAL: { windowMs: 15 * 60 * 1000, max: 2000 },
} as const;

export const ROLE_PERMISSIONS_CACHE_TTL_SECONDS = 60 * 60;

export const REPORT_CACHE_TTL_SECONDS = 60;

export const REFRESH_TOKEN_COOKIE_PATH = "/api/v1/auth";
