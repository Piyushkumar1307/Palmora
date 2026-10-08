import crypto from "node:crypto";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import { AppError, isAppError } from "./lib/errors.js";
import { validatePalmImage } from "./lib/image.js";
import { READING_DISCLAIMER } from "./lib/reading.js";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

function validateName(value) {
  if (typeof value !== "string") {
    throw new AppError(400, "INVALID_NAME", "Please enter your name.");
  }

  const name = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (
    Array.from(name).length < 1 ||
    Array.from(name).length > 60 ||
    !/^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]*$/u.test(name)
  ) {
    throw new AppError(400, "INVALID_NAME", "Enter a name using letters, spaces, apostrophes, periods, or hyphens.");
  }
  return name;
}

function createCorsOptions(config) {
  return (req, callback) => {
    const origin = req.get("origin");
    let sameOrigin = false;
    try {
      sameOrigin = Boolean(origin && new URL(origin).host === req.get("host"));
    } catch {
      sameOrigin = false;
    }

    // Native clients commonly omit Origin. A deployed website is allowed to call
    // its own API without a separately configured CORS origin.
    if (!origin || sameOrigin || config.clientOrigins.includes(origin)) {
      return callback(null, {
        origin: true,
        methods: ["GET", "POST"],
        allowedHeaders: ["Content-Type", "X-Request-Id"],
        maxAge: 600
      });
    }
    return callback(new AppError(403, "ORIGIN_NOT_ALLOWED", "This browser origin is not allowed."));
  };
}

function multerMiddleware(config, fieldName = "palm") {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.maxUploadBytes,
      files: 1,
      fields: 3,
      fieldSize: 1024,
      parts: 5
    },
    fileFilter(req, file, callback) {
      if (file.fieldname !== fieldName) {
        return callback(new AppError(400, "INVALID_MULTIPART", `Use the form field named ${fieldName} for the image.`));
      }
      if (!ALLOWED_MIME_TYPES.has(file.mimetype?.toLowerCase())) {
        return callback(new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Use a JPEG, PNG, or WebP palm photo."));
      }
      return callback(null, true);
    }
  });
}

function multipartError(error) {
  if (isAppError(error)) return error;
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return new AppError(413, "IMAGE_TOO_LARGE", "The palm photo is too large. Choose an image under 8 MB.");
    }
    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return new AppError(400, "INVALID_MULTIPART", "Send one photo in the palm form field.");
    }
    return new AppError(400, "INVALID_MULTIPART", "The photo upload could not be processed.");
  }
  if (error?.type === "entity.parse.failed") {
    return new AppError(400, "INVALID_REQUEST", "The request body is invalid.");
  }
  return error;
}

function sendError(error, req, res) {
  const appError = multipartError(error);
  const known = isAppError(appError);
  const status = known ? appError.status : 500;
  const code = known ? appError.code : "INTERNAL_ERROR";
  const message = known && appError.expose ? appError.message : "Something went wrong. Please try again.";

  if (!known || status >= 500) {
    console.error("Request failed", {
      requestId: req.id,
      status,
      name: appError?.name,
      message: appError?.message
    });
  }

  return res.status(status).json({
    ok: false,
    error: { code, message, requestId: req.id }
  });
}

export function createApp({ config, cloudinaryService, readingService, staticDirectory }) {
  const app = express();
  const upload = multerMiddleware(config);
  const reportUpload = multerMiddleware(config, "report");

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    res.setHeader("X-Request-Id", req.id);
    next();
  });
  app.use(helmet());
  app.use(cors(createCorsOptions(config)));
  if (staticDirectory) {
    app.use(express.static(staticDirectory));
  }
  app.use(express.json({ limit: "32kb" }));

  const readingLimiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit: config.rateLimitMax,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler(req, res) {
      return res.status(429).json({
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many reading requests. Please wait a few minutes and try again.",
          requestId: req.id
        }
      });
    }
  });

  app.get("/health", (req, res) => {
    res.json({ ok: true, service: "ai-palm-reader" });
  });

  app.post("/api/readings", readingLimiter, upload.single("palm"), async (req, res, next) => {
    let uploadedPalm;
    try {
      const name = validateName(req.body?.name);
      const image = validatePalmImage(req.file, { maxUploadBytes: config.maxUploadBytes });

      uploadedPalm = await cloudinaryService.uploadPalm(image);
      const analysis = await readingService.analyzePalm({ name, imageUrl: uploadedPalm.analysisUrl });
      const reading = {
        id: crypto.randomUUID(),
        name,
        createdAt: new Date().toISOString(),
        imageUrl: uploadedPalm.secureUrl,
        imagePublicId: uploadedPalm.publicId,
        ...analysis,
        disclaimer: READING_DISCLAIMER
      };

      // The image persists even if metadata annotation is unavailable on a given Cloudinary plan.
      try {
        await cloudinaryService.saveReadingContext(uploadedPalm.publicId, reading);
      } catch (error) {
        console.warn("Cloudinary reading context was not saved", {
          requestId: req.id,
          name: error?.name,
          message: error?.message
        });
      }

      return res.status(201).json({ ok: true, reading });
    } catch (error) {
      if (uploadedPalm?.publicId) {
        try {
          await cloudinaryService.removePalm(uploadedPalm.publicId);
        } catch (cleanupError) {
          console.warn("Could not remove failed reading upload", {
            requestId: req.id,
            name: cleanupError?.name,
            message: cleanupError?.message
          });
        }
      }
      return next(error);
    }
  });

  app.post("/api/readings/:readingId/report", readingLimiter, reportUpload.single("report"), async (req, res, next) => {
    try {
      const readingId = String(req.params.readingId || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(readingId)) {
        throw new AppError(400, "INVALID_READING", "This reading could not be identified.");
      }
      const report = validatePalmImage(req.file, { maxUploadBytes: config.maxUploadBytes });
      const uploadedReport = await cloudinaryService.uploadReport(report, readingId);
      return res.status(201).json({
        ok: true,
        report: { imageUrl: uploadedReport.secureUrl, imagePublicId: uploadedReport.publicId }
      });
    } catch (error) {
      return next(error);
    }
  });

  app.use((req, res) => {
    sendError(new AppError(404, "NOT_FOUND", "This endpoint does not exist."), req, res);
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    return sendError(error, req, res);
  });

  return app;
}
