const http = require("node:http");
const crypto = require("node:crypto");
const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({
  env: cloudbase.SYMBOL_CURRENT_ENV
});

const PORT = Number(process.env.PORT || 9000);

const ALLOWED_ORIGINS = new Set([
  "https://lonelyjie1826.github.io",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
]);

function setCors(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader(
    "Access-Control-Allow-Origin",
    ALLOWED_ORIGINS.has(origin) ? origin : "https://lonelyjie1826.github.io"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(req, res, statusCode, data) {
  setCors(req, res);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error("BODY_TOO_LARGE"));
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });

    req.on("error", reject);
  });
}

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

async function handle(payload) {
  if (!checkToken(payload.token)) {
    return { ok: false, code: "UNAUTHORIZED" };
  }

  if (payload.action === "sign-upload") {
    const cloudPath = normalizeCloudPath(payload.cloudPath);
    const upload = await app.getUploadMetadata({ cloudPath });

    return {
      ok: true,
      upload,
      videoUrl: publicUrl(cloudPath),
      videoFileId: upload.fileId || ""
    };
  }

  if (payload.action === "delete") {
    const fileId = String(payload.fileId || "");
    if (!fileId.startsWith("cloud://")) {
      return { ok: false, code: "INVALID_FILE_ID" };
    }

    await app.deleteFile({ fileList: [fileId] });
    return { ok: true };
  }

  return { ok: false, code: "UNKNOWN_ACTION" };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    setCors(req, res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET") {
    sendJson(req, res, 200, { ok: true, service: "upload-ticket" });
    return;
  }

  if (req.method !== "POST") {
    sendJson(req, res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
    return;
  }

  try {
    const payload = await readJson(req);
    const result = await handle(payload);
    sendJson(req, res, 200, result);
  } catch (error) {
    sendJson(req, res, 200, {
      ok: false,
      code: error.message || "UPLOAD_TICKET_FAILED"
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`upload-ticket listening on ${PORT}`);
});
