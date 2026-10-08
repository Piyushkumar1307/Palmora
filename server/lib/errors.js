export class AppError extends Error {
  constructor(status, code, message, options = {}) {
    super(message, options);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.expose = options.expose ?? status < 500;
  }
}

export function isAppError(error) {
  return error instanceof AppError;
}
