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

    const form = new FormData();
    form.append("key", signed.upload.cosFileId);
    form.append("Signature", signed.upload.authorization);
    if (signed.upload.token) {
      form.append("x-cos-security-token", signed.upload.token);
    }
    form.append("file", new Blob([fileBuffer], { type: contentType }), "video");

    const uploadResponse = await fetch(signed.upload.url, {
      method: "POST",
      body: form
    });

    if (!uploadResponse.ok) {
      sendJson(response, 200, {
        ok: false,
        code: `STORAGE_UPLOAD_FAILED_${uploadResponse.status}`
      });
      return;
    }

    sendJson(response, 200, {
      ok: true,
      videoUrl: signed.videoUrl,
      videoFileId: signed.videoFileId
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
