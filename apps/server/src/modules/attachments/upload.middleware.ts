import multer from "multer";

import { BadRequestError } from "../../core/errors/HttpErrors.js";

const storage = multer.memoryStorage();

export function createUploadMiddleware(fieldName: string, maxSizeBytes: number, allowedMimeTypes: readonly string[]) {
  const upload = multer({
    storage,
    limits: { fileSize: maxSizeBytes },
    fileFilter: (_req, file, cb) => {
      if (!allowedMimeTypes.includes(file.mimetype)) {
        cb(new BadRequestError(`Unsupported file type: ${file.mimetype}`));
        return;
      }
      cb(null, true);
    },
  });
  return upload.single(fieldName);
}
