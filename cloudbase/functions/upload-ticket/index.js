/**
 * upload-ticket —— CloudBase（PostgreSQL 模式）视频上传鉴权云函数
 *
 * 作用：
 *   1. 校验网页传来的上传口令（UPLOAD_TOKEN）；
 *   2. 用只保存在云函数环境变量里的 service_role API Key，
 *      向 CloudBase Storage API 换取一张「预签名上传链接」；
 *   3. 把这张链接交回本机 server.js，由本机把视频直传到云存储。
 *
 * 为什么要这样绕：
 *   PG 模式下云存储不再支持「客户端直传 COS」，所有读写都必须经过 Storage API。
 *   service_role API Key 拥有环境管理员权限，绝对不能出现在网页代码或仓库里，
 *   所以它只存在于本云函数的「环境变量」中。
 */

const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 9000);

const ALLOWED_ORIGINS = new Set([
  "https://lonelyjie1826.github.io",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
]);

/* ------------------------------- 基础工具 ------------------------------- */

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

/* ----------------------------- 云存储配置读取 ----------------------------- */

function gatewayBase() {
  // 环境 ID：优先用自己配置的 ENV_ID，否则用云函数运行时自带的 TCB_ENV
  const envId = String(process.env.ENV_ID || process.env.TCB_ENV || "").trim();
  if (!envId) throw new Error("MISSING_ENV_ID");
  return `https://${envId}.api.tcloudbasegateway.com/v1/storages`;
}

function bucketId() {
  const bucket = String(process.env.BUCKET_ID || "").trim();
  if (!bucket) throw new Error("MISSING_BUCKET_ID");
  return bucket;
}

function serviceRoleKey() {
  const key = String(process.env.SERVICE_ROLE_KEY || "").trim();
  if (!key) throw new Error("MISSING_SERVICE_ROLE_KEY");
  return key;
}

/** 对象名逐段编码，保留 / 分隔符。 */
function encodeObjectName(objectName) {
  return String(objectName)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** 接口返回的 url 可能是 /v1/... 相对路径，这里补上网关域名。 */
function toAbsoluteUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const envId = String(process.env.ENV_ID || process.env.TCB_ENV || "").trim();
  const base = `https://${envId}.api.tcloudbasegateway.com`;
  return value.startsWith("/") ? `${base}${value}` : `${base}/${value}`;
}

/** PG 模式下的公开播放地址。 */
function publicUrl(objectName) {
  return `${gatewayBase()}/object/public/${bucketId()}/${encodeObjectName(objectName)}`;
}

// 只允许两类对象：videos/ 下的视频、covers/ 下的封面图
const VIDEO_OBJECT = /^videos\/[a-zA-Z0-9._-]+\.(mp4|webm|mov)$/;
const COVER_OBJECT = /^covers\/[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp)$/;

function isAllowedObject(name) {
  return VIDEO_OBJECT.test(name) || COVER_OBJECT.test(name);
}

function normalizeCloudPath(input) {
  const cloudPath = String(input || "").trim().replace(/^\/+/, "");
  if (!isAllowedObject(cloudPath)) {
    throw new Error("INVALID_CLOUD_PATH");
  }
  return cloudPath;
}

/** 删除时校验对象名（与上传使用同一套规则）。 */
function normalizeObjectName(input) {
  const objectName = String(input || "").trim().replace(/^\/+/, "");
  return isAllowedObject(objectName) ? objectName : "";
}

/**
 * 极简 HTTPS 请求（不依赖全局 fetch，Node 12 以上都能跑）。
 * 返回 { status, text }。
 */
function httpsRequest(targetUrl, options) {
  return new Promise((resolve, reject) => {
    const target = new URL(targetUrl);
    const request = https.request(
      {
        method: options.method,
        hostname: target.hostname,
        path: `${target.pathname}${target.search}`,
        headers: options.headers || {}
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode || 0, text });
        });
      }
    );

    request.on("error", reject);

    if (options.body) {
      request.write(options.body);
    }

    request.end();
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return null;
  }
}

/** 从错误响应里挑一个能看懂的错误码。 */
function errorCode(data, text, fallback) {
  if (data && (data.code || data.error)) return String(data.code || data.error);
  const message = String(text || "").trim();
  return message ? `${fallback}: ${message.slice(0, 120)}` : fallback;
}

/* -------------------------------- 业务逻辑 -------------------------------- */

async function signUpload(cloudPath) {
  const signUrl = `${gatewayBase()}/object/upload/sign/${bucketId()}/${encodeObjectName(cloudPath)}`;

  const response = await httpsRequest(signUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey()}`,
      "x-upsert": "true"
    }
  });

  const data = parseJson(response.text);

  if (response.status < 200 || response.status >= 300) {
    return {
      ok: false,
      code: errorCode(data, response.text, `SIGN_FAILED_${response.status}`),
      detail: String(response.text).slice(0, 300)
    };
  }

  if (!data || !data.token) {
    return {
      ok: false,
      code: "SIGN_NO_TOKEN",
      detail: String(response.text).slice(0, 300)
    };
  }

  return {
    ok: true,
    upload: {
      // fullURL 是服务端拼好的完整地址；没有时把相对路径补成绝对地址
      url: toAbsoluteUrl(data.fullURL || data.url) || signUrl,
      token: data.token,
      objectName: cloudPath
    },
    videoUrl: publicUrl(cloudPath),
    videoFileId: cloudPath
  };
}

async function deleteObject(objectName) {
  const body = JSON.stringify({ prefixes: [objectName] });

  const response = await httpsRequest(`${gatewayBase()}/object/${bucketId()}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${serviceRoleKey()}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body)
    },
    body
  });

  const data = parseJson(response.text);

  if (response.status < 200 || response.status >= 300) {
    return {
      ok: false,
      code: errorCode(data, response.text, `DELETE_FAILED_${response.status}`),
      detail: String(response.text).slice(0, 300)
    };
  }

  return { ok: true };
}

async function handle(payload) {
  if (!checkToken(payload.token)) {
    return { ok: false, code: "UNAUTHORIZED" };
  }

  if (payload.action === "sign-upload") {
    return await signUpload(normalizeCloudPath(payload.cloudPath));
  }

  if (payload.action === "delete") {
    const objectName = normalizeObjectName(payload.fileId);
    if (!objectName) {
      return { ok: false, code: "INVALID_FILE_ID" };
    }
    return await deleteObject(objectName);
  }

  return { ok: false, code: "UNKNOWN_ACTION" };
}

/* --------------------------------- 入口 --------------------------------- */

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    setCors(req, res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET") {
    sendJson(req, res, 200, { ok: true, service: "upload-ticket", mode: "postgres" });
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
