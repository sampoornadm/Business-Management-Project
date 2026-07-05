import { AppError, type FieldError } from "./AppError.js";

export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: FieldError[]) {
    super({ statusCode: 400, code: "BAD_REQUEST", message, details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super({ statusCode: 401, code: "UNAUTHORIZED", message });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super({ statusCode: 403, code: "FORBIDDEN", message });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super({ statusCode: 404, code: "NOT_FOUND", message });
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super({ statusCode: 409, code: "CONFLICT", message });
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message = "Validation failed", details?: FieldError[]) {
    super({ statusCode: 422, code: "UNPROCESSABLE_ENTITY", message, details });
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests") {
    super({ statusCode: 429, code: "TOO_MANY_REQUESTS", message });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "Service unavailable") {
    super({ statusCode: 503, code: "SERVICE_UNAVAILABLE", message });
  }
}
