import { AppError } from "./errors.js";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
]);

const MIME_ALIASES = new Map([
  ["image/jpg", "image/jpeg"],
  ["image/jpeg", "image/jpeg"],
  ["image/png", "image/png"],
  ["image/webp", "image/webp"]
]);

function readPng(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;

  return {
    mime: "image/png",
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function readJpeg(buffer) {
  if (buffer.length < 10 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 3 < buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;

    if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= buffer.length) break;

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 7) break;
      return {
        mime: "image/jpeg",
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5)
      };
    }

    offset += segmentLength;
  }
  return null;
}

function readWebp(buffer) {
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }

  const chunkType = buffer.toString("ascii", 12, 16);
  if (chunkType === "VP8X") {
    return {
      mime: "image/webp",
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }

  if (chunkType === "VP8 ") {
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null;
    return {
      mime: "image/webp",
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    };
  }

  if (chunkType === "VP8L") {
    if (buffer[20] !== 0x2f || buffer.length < 25) return null;
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    return {
      mime: "image/webp",
      width: 1 + (b0 | ((b1 & 0x3f) << 8)),
      height: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10))
    };
  }

  return null;
}

function inspectImage(buffer) {
  return readPng(buffer) || readJpeg(buffer) || readWebp(buffer);
}

/**
 * Validates actual image bytes, not merely a client-provided MIME type.
 * The dimensions cap also prevents expensive, very large images from reaching
 * Cloudinary or the vision model.
 */
export function validatePalmImage(file, { maxUploadBytes }) {
  if (!file) {
    throw new AppError(400, "IMAGE_REQUIRED", "Please add a clear palm photo.");
  }
  if (!Buffer.isBuffer(file.buffer)) {
    throw new AppError(400, "INVALID_IMAGE", "The palm photo could not be read.");
  }
  if (file.buffer.length < 5 * 1024) {
    throw new AppError(400, "INVALID_IMAGE", "Please upload a complete palm photo.");
  }
  if (file.buffer.length > maxUploadBytes) {
    throw new AppError(413, "IMAGE_TOO_LARGE", "The palm photo is too large. Choose an image under 8 MB.");
  }

  const image = inspectImage(file.buffer);
  if (!image) {
    throw new AppError(415, "INVALID_IMAGE", "Use a valid JPEG, PNG, or WebP palm photo.");
  }

  const claimedMime = MIME_ALIASES.get(file.mimetype?.toLowerCase());
  if (!claimedMime || claimedMime !== image.mime) {
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "The file type does not match the selected palm photo.");
  }

  const maxDimension = 6000;
  const maxPixels = 20_000_000;
  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width < 160 ||
    image.height < 160 ||
    image.width > maxDimension ||
    image.height > maxDimension ||
    image.width * image.height > maxPixels
  ) {
    throw new AppError(
      400,
      "INVALID_IMAGE_DIMENSIONS",
      "Use a clear palm photo between 160 px and 6000 px per side."
    );
  }

  return Object.freeze({
    buffer: file.buffer,
    mime: image.mime,
    width: image.width,
    height: image.height,
    bytes: file.buffer.length
  });
}
