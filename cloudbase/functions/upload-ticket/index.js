const cloudbase = require("@cloudbase/node-sdk");
const crypto = require("node:crypto");

const app = cloudbase.init({
  env: cloudbase.SYMBOL_CURRENT_ENV
});

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function checkToken(token) {
  const expected = String(process.env.UPLOAD_TOKEN || "");
  return expected.length >= 24 && safeEqual(token, expected);
}

function normalizeCloudPath(input) {
  const cloudPath = String(input || "").trim().replace(/^\/+/, "");
  if (!/^videos\/[a-zA-Z0-9._-]+\.(mp4|webm|mov)$/.test(cloudPath)) {
    throw new Error("INVALID_CLOUD_PATH");
  }
  return cloudPath;
}

function publicUrl(cloudPath) {
  const base = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!base) throw new Error("MISSING_PUBLIC_BASE_URL");
  return `${base}/${cloudPath}`;
}

exports.main = async (event) => {
  try {
    if (!checkToken(event && event.token)) {
      return { ok: false, code: "UNAUTHORIZED" };
    }

    if (event.action === "sign-upload") {
      const cloudPath = normalizeCloudPath(event.cloudPath);
      const metadata = await app.getUploadMetadata({ cloudPath });
      const upload = metadata.data || metadata;

      return {
        ok: true,
        upload,
        videoUrl: publicUrl(cloudPath),
        videoFileId: upload.fileId || ""
      };
    }

    if (event.action === "delete") {
      const fileId = String(event.fileId || "");
      if (!fileId.startsWith("cloud://")) {
        return { ok: false, code: "INVALID_FILE_ID" };
      }
      await app.deleteFile({ fileList: [fileId] });
      return { ok: true };
    }

    return { ok: false, code: "UNKNOWN_ACTION" };
  } catch (error) {
    return { ok: false, code: error.message || "UPLOAD_TICKET_FAILED" };
  }
};
