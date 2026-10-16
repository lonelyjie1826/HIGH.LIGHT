const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const cloudbaseConfig = require("./cloudbase/config.json");
const maxUploadBytes = 150 * 1024 * 1024;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime"
};

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}

function readBody(request, maxBytes = maxUploadBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        request.destroy();
        reject(new Error("FILE_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function callCloud(payload) {
  let lastError = null;

  for (const endpoint of cloudbaseConfig.endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (response.ok) return data;
      lastError = new Error(data.code || `HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("CLOUD_UNREACHABLE");
}

const gatewayBase = String(cloudbaseConfig.gatewayBase || "").replace(/\/+$/, "");
const gatewayBucket = String(cloudbaseConfig.bucketId || "high-light-media");

function encodeObjectName(objectName) {
  return String(objectName)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * 把云函数返回的上传地址整理成绝对 URL：
 * - 已经是 http(s) 开头：直接用
 * - 是 /v1/... 这样的相对路径：拼上网关域名（腾讯云返回的就是这种）
 * - 什么都没给：按对象名自己拼（预签名 token 本来就绑在这个路径上，等价）
 * 最后补上 ?token=xxx。
 */
function resolveUploadUrl(upload, fallbackObjectName) {
  const raw = String((upload && upload.url) || "").trim();
  const objectName = String((upload && upload.objectName) || fallbackObjectName || "").trim();
  let url = "";

  if (/^https?:\/\//i.test(raw)) {
    url = raw;
  } else if (raw && gatewayBase) {
    url = `${gatewayBase}${raw.startsWith("/") ? "" : "/"}${raw}`;
  } else if (objectName && gatewayBase) {
    url = `${gatewayBase}/v1/storages/object/upload/sign/${gatewayBucket}/${encodeObjectName(objectName)}`;
  }

  if (!url) return "";

  const token = String((upload && upload.token) || "");
  if (token && !/[?&]token=/.test(url)) {
    url += `${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  }

  return url;
}

async function handleCloudUpload(request, response) {
  try {
    const token = String(request.headers["x-upload-token"] || "");
    const cloudPath = String(request.headers["x-cloud-path"] || "");
    const contentType = String(request.headers["content-type"] || "video/mp4");

    if (!token) {
      sendJson(response, 400, { ok: false, code: "MISSING_TOKEN" });
      return;
    }

    const fileBuffer = await readBody(request);
    if (!fileBuffer.length) {
      sendJson(response, 400, { ok: false, code: "EMPTY_FILE" });
      return;
    }

    const signed = await callCloud({
      action: "sign-upload",
      token,
      cloudPath
    });

    if (!signed.ok) {
      sendJson(response, 200, signed);
      return;
    }

    // 云函数签发的是 PG 模式 Storage API 的「预签名上传链接」：
    //   PUT <链接>?token=xxx ，body 直接是视频二进制，不需要任何 Authorization 头。
    // 兼容云函数的两种返回结构：字段可能在 data 里，也可能已拍平。
    const rawUpload = signed.upload || {};
    const upload = rawUpload.data || rawUpload;
    const targetUrl = resolveUploadUrl(upload, cloudPath);

    if (!targetUrl) {
      sendJson(response, 200, {
        ok: false,
        code: "INVALID_UPLOAD_URL",
        detail: `url=${JSON.stringify(upload.url)} objectName=${JSON.stringify(upload.objectName)} token=${upload.token ? "有" : "无"}`
      });
      return;
    }

    const uploadResponse = await fetch(targetUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: fileBuffer
    });

    if (!uploadResponse.ok) {
      const detail = await uploadResponse.text().catch(() => "");
      sendJson(response, 200, {
        ok: false,
        code: `STORAGE_UPLOAD_FAILED_${uploadResponse.status}`,
        detail: String(detail).slice(0, 300)
      });
      return;
    }

    sendJson(response, 200, {
      ok: true,
      videoUrl: signed.videoUrl,
      videoFileId: signed.videoFileId || upload.objectName || ""
    });
  } catch (error) {
    sendJson(response, 200, {
      ok: false,
      code: error.message || "CLOUD_UPLOAD_FAILED"
    });
  }
}

async function handleCloudDelete(request, response) {
  try {
    const body = await readBody(request, 1024 * 1024);
    const payload = JSON.parse(body.toString("utf8") || "{}");
    const result = await callCloud({
      action: "delete",
      token: payload.token,
      fileId: payload.fileId
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 200, {
      ok: false,
      code: error.message || "CLOUD_DELETE_FAILED"
    });
  }
}

const server = http.createServer(async (request, response) => {
  const parsedUrl = new URL(request.url || "/", `http://127.0.0.1:${port}`);
  const requestPath = decodeURIComponent(parsedUrl.pathname);

  if (request.method === "POST" && requestPath === "/api/cloud-upload") {
    await handleCloudUpload(request, response);
    return;
  }

  if (request.method === "POST" && requestPath === "/api/cloud-delete") {
    await handleCloudDelete(request, response);
    return;
  }

  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = path.resolve(root, relativePath);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("File not found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": types[extension] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    fs.createReadStream(filePath).pipe(response);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`HIGH·LIGHT 已启动：http://127.0.0.1:${port}/`);
  console.log("关闭这个窗口即可停止网站。");
});
