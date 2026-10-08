import "dotenv/config";

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function positiveInteger(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function optionalOrigins(env) {
  const raw = env.CLIENT_ORIGINS?.trim();
  if (!raw) return [];

  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        const parsed = new URL(origin);
        if (!/^https?:$/.test(parsed.protocol)) throw new Error("unsupported protocol");
        return parsed.origin;
      } catch {
        throw new Error(`CLIENT_ORIGINS contains an invalid HTTP(S) origin: ${origin}`);
      }
    });
}

function safeFolder(value) {
  if (!/^[A-Za-z0-9_/-]{1,120}$/.test(value) || value.includes("..") || value.startsWith("/")) {
    throw new Error("CLOUDINARY_FOLDER may only contain letters, numbers, _, -, and /.");
  }
  return value.replace(/\/+$/, "");
}

function safeModel(value) {
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(value)) {
    throw new Error("OPENAI_MODEL contains unsupported characters.");
  }
  return value;
}

export function loadConfig(env = process.env) {
  const cloudinaryFolder = safeFolder(env.CLOUDINARY_FOLDER?.trim() || "ai-palm-reader");

  return Object.freeze({
    port: positiveInteger(env, "PORT", 8787, 1, 65535),
    clientOrigins: optionalOrigins(env),
    openaiApiKey: required(env, "OPENAI_API_KEY"),
    openaiModel: safeModel(env.OPENAI_MODEL?.trim() || "gpt-4o-mini"),
    cloudinaryCloudName: required(env, "CLOUDINARY_CLOUD_NAME"),
    cloudinaryApiKey: required(env, "CLOUDINARY_API_KEY"),
    cloudinaryApiSecret: required(env, "CLOUDINARY_API_SECRET"),
    cloudinaryFolder,
    maxUploadBytes: positiveInteger(env, "MAX_UPLOAD_BYTES", 8 * 1024 * 1024, 256 * 1024, 10 * 1024 * 1024),
    rateLimitWindowMs: positiveInteger(env, "RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000, 10_000, 24 * 60 * 60 * 1000),
    rateLimitMax: positiveInteger(env, "RATE_LIMIT_MAX", 20, 1, 500)
  });
}
