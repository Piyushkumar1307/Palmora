import { v2 as cloudinary } from "cloudinary";
import { AppError } from "./errors.js";

function contextValue(value, maxLength) {
  return String(value ?? "")
    .replace(/[\\|=]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength) || "not_available";
}

function contextString(values) {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${contextValue(value, 700)}`)
    .join("|");
}

export function createCloudinaryService(config) {
  cloudinary.config({
    cloud_name: config.cloudinaryCloudName,
    api_key: config.cloudinaryApiKey,
    api_secret: config.cloudinaryApiSecret,
    secure: true
  });

  async function uploadPalm(image) {
    try {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: "image",
            type: "upload",
            folder: config.cloudinaryFolder,
            use_filename: false,
            unique_filename: true,
            overwrite: false,
            allowed_formats: ["jpg", "jpeg", "png", "webp"],
            tags: ["ai-palm-reader"],
            // Avoid storing the submitter's name in third-party asset metadata.
            context: contextString({ source: "ai_palm_reader", status: "processing" })
          },
          (error, uploadResult) => (error ? reject(error) : resolve(uploadResult))
        );
        stream.end(image.buffer);
      });

      if (!result?.public_id || !result.secure_url) {
        throw new Error("Cloudinary did not return a public image URL.");
      }

      return {
        publicId: result.public_id,
        secureUrl: result.secure_url,
        analysisUrl: cloudinary.url(result.public_id, {
          secure: true,
          resource_type: "image",
          transformation: [
            {
              width: 1600,
              height: 1600,
              crop: "limit",
              quality: "auto:good",
              fetch_format: "auto"
            }
          ]
        })
      };
    } catch (error) {
      console.error("Cloudinary upload failed", { name: error?.name, message: error?.message });
      throw new AppError(503, "UPLOAD_FAILED", "We could not securely store that palm photo. Please try again.");
    }
  }

  async function uploadReport(image, readingId) {
    try {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: "image",
            type: "upload",
            folder: `${config.cloudinaryFolder}/reports`,
            use_filename: false,
            unique_filename: true,
            overwrite: false,
            allowed_formats: ["jpg", "jpeg", "png", "webp"],
            tags: ["ai-palm-reader", "palm-reading-report"],
            context: contextString({ source: "ai_palm_reader_report", reading_id: readingId, status: "complete" })
          },
          (error, uploadResult) => (error ? reject(error) : resolve(uploadResult))
        );
        stream.end(image.buffer);
      });

      if (!result?.public_id || !result.secure_url) {
        throw new Error("Cloudinary did not return a public report URL.");
      }

      return { publicId: result.public_id, secureUrl: result.secure_url };
    } catch (error) {
      console.error("Cloudinary report upload failed", { name: error?.name, message: error?.message });
      throw new AppError(503, "REPORT_UPLOAD_FAILED", "We could not save your reading report. Please try again.");
    }
  }

  async function saveReadingContext(publicId, reading) {
    // Context is intentionally compact; it is an asset annotation, not a user database.
    const summary = `${reading.overview} ${reading.sections.map((section) => section.insight).join(" ")}`;
    await cloudinary.uploader.explicit(publicId, {
      resource_type: "image",
      type: "upload",
      context: contextString({
        source: "ai_palm_reader",
        status: "complete",
        reading_title: contextValue(reading.title, 100),
        reading_summary: contextValue(summary, 700)
      })
    });
  }

  async function removePalm(publicId) {
    if (!publicId) return;
    await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
      type: "upload",
      invalidate: true
    });
  }

  return Object.freeze({ uploadPalm, uploadReport, saveReadingContext, removePalm });
}
