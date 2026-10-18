const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const { execFile } = require("node:child_process");

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

/** Node 的 fetch 失败时只给一句 "fetch failed"，真正的原因藏在 cause 里。 */
function describeFetchError(error, endpoint) {
  const cause = error && error.cause;
  const head = error && error.message ? String(error.message) : "fetch failed";
  const bits = [];

  if (cause) {
    if (cause.code || cause.name) bits.push(String(cause.code || cause.name));
    if (cause.message) bits.push(String(cause.message));
  }

  const detail = bits.filter(Boolean).join(" ");
  return `${head}${detail ? ` [${detail}]` : ""} @ ${endpoint}`;
}

async function callCloud(payload) {
  let lastError = null;

  // 网络抖动很常见：整轮失败后隔 500ms 再试一轮（两个入口各试一次）
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let transportFailed = false;

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
        transportFailed = true;
        lastError = new Error(describeFetchError(error, endpoint));
      }
    }

    if (!transportFailed) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
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
 * 云函数早期版本把 https://{envId} 当成了完整域名（漏了 .api.tcloudbasegateway.com），
 * 这里按网关域名纠正回来，避免部署新云函数之前的空窗期。
 */
function normalizeGatewayUrl(value) {
  if (!gatewayBase) return value;

  try {
    const target = new URL(value);
    const gateway = new URL(gatewayBase);
    const envId = gateway.hostname.split(".")[0];

    if (target.hostname === envId && gateway.hostname !== envId) {
      return `${gateway.protocol}//${gateway.hostname}${target.pathname}${target.search}`;
    }
  } catch {
    return value;
  }

  return value;
}

/**
 * 把云函数返回的上传地址整理成绝对 URL：
 * - 已经是 http(s) 开头：直接用（但要纠正被截断的网关域名）
 * - 是 /v1/... 这样的相对路径：拼上网关域名（腾讯云返回的就是这种）
 * - 什么都没给：按对象名自己拼（预签名 token 本来就绑在这个路径上，等价）
 * 最后补上 ?token=xxx。
 */
function resolveUploadUrl(upload, fallbackObjectName) {
  const raw = String((upload && upload.url) || "").trim();
  const objectName = String((upload && upload.objectName) || fallbackObjectName || "").trim();
  let url = "";

  if (/^https?:\/\//i.test(raw)) {
    url = normalizeGatewayUrl(raw);
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

/* ---------------------- 作品数据读写 / 自动提交推送 ---------------------- */

const worksFile = path.join(root, "data", "works.js");
const worksHeader = `/*
 * HIGH·LIGHT 作品数据
 * 此文件由网站发布页更新。普通使用无需手动编辑。
 */
window.HIGHLIGHT_WORKS = `;

function readWorks() {
  const source = fs.readFileSync(worksFile, "utf8");
  const start = source.indexOf("[");
  const end = source.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("WORKS_PARSE_FAILED");
  const list = JSON.parse(source.slice(start, end + 1));
  if (!Array.isArray(list)) throw new Error("WORKS_PARSE_FAILED");
  return list;
}

function writeWorks(list) {
  fs.writeFileSync(worksFile, `${worksHeader}${JSON.stringify(list, null, 2)};\n`, "utf8");
}

const gitCandidates = [
  "git",
  "C:\\Program Files\\Git\\cmd\\git.exe",
  "C:\\Program Files (x86)\\Git\\cmd\\git.exe"
];

let gitCommand = "";

/** 跑一条 git 命令，不弹出任何交互式提示（否则后台进程会闷死）。 */
function execGit(command, args) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: root,
        windowsHide: true,
        timeout: 180000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          output: `${stdout || ""}${stderr || ""}`.trim(),
          notFound: Boolean(error && error.code === "ENOENT")
        });
      }
    );
  });
}

/** 首次调用时自动找准可用的 git：PATH 里没有就试 Windows 默认安装路径。 */
async function runGit(args) {
  if (!gitCommand) {
    for (const candidate of gitCandidates) {
      const probe = await execGit(candidate, ["--version"]);
      if (probe.ok) {
        gitCommand = candidate;
        break;
      }
      if (!probe.notFound) break;
    }

    if (!gitCommand) {
      return { ok: false, output: "找不到 git，请确认这台电脑装了 Git for Windows。" };
    }
  }

  return await execGit(gitCommand, args);
}

/**
 * 提交并推送 data/works.js（以及被删掉的本地素材）。
 * 关键：push 之后回头比较 HEAD 和 origin/main，确认远端真的收到了，
 * 避免出现"看着成功其实没推上去"的假成功。
 */
async function publishWorks(extraPaths) {
  const paths = ["data/works.js", ...(extraPaths || [])];

  const add = await runGit(["add", "-A", "--", ...paths]);
  if (!add.ok) {
    return { ok: false, code: "GIT_ADD_FAILED", detail: add.output };
  }

  const message = `Update works ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  const commit = await runGit(["commit", "-m", message]);
  const nothingToCommit = /nothing to commit|no changes added|无文件要提交/i.test(commit.output);
  if (!commit.ok && !nothingToCommit) {
    return { ok: false, code: "GIT_COMMIT_FAILED", detail: commit.output };
  }

  const push = await runGit(["push", "origin", "main"]);
  if (!push.ok) {
    return { ok: false, code: "GIT_PUSH_FAILED", detail: push.output };
  }

  const local = await runGit(["rev-parse", "HEAD"]);
  const remote = await runGit(["rev-parse", "origin/main"]);
  if (!local.ok || !remote.ok || local.output !== remote.output) {
    return { ok: false, code: "GIT_PUSH_NOT_APPLIED", detail: push.output };
  }

  return { ok: true, detail: push.output };
}

/** 本机接口很轻量地校验一下口令（真正的鉴权发生在云函数）。 */
function hasUploadToken(request) {
  return Boolean(String(request.headers["x-upload-token"] || "").trim());
}

function readJsonBody(request) {
  return readBody(request, 1024 * 1024).then((buffer) => {
    return JSON.parse(buffer.toString("utf8") || "{}");
  });
}

/** 自检：分别探测云函数入口和 Storage 网关，把真实错误原因暴露出来。 */
async function handleDiag(request, response) {
  const result = {
    node: process.version,
    time: new Date().toISOString(),
    endpoints: [],
    gateway: null
  };

  for (const endpoint of cloudbaseConfig.endpoints) {
    const started = Date.now();
    try {
      const res = await fetch(endpoint, { method: "GET" });
      const text = await res.text();
      result.endpoints.push({
        endpoint,
        status: res.status,
        ms: Date.now() - started,
        body: String(text).slice(0, 200)
      });
    } catch (error) {
      result.endpoints.push({
        endpoint,
        ms: Date.now() - started,
        error: describeFetchError(error, endpoint)
      });
    }
  }

  if (gatewayBase) {
    const probe = `${gatewayBase}/v1/storages/object/public/${gatewayBucket}/probe.mp4`;
    const started = Date.now();
    try {
      const res = await fetch(probe, { method: "GET" });
      const text = await res.text();
      result.gateway = {
        url: probe,
        status: res.status,
        ms: Date.now() - started,
        body: String(text).slice(0, 200)
      };
    } catch (error) {
      result.gateway = {
        url: probe,
        ms: Date.now() - started,
        error: describeFetchError(error, probe)
      };
    }
  }

  sendJson(response, 200, result);
}

async function handleSaveWork(request, response) {
  try {
    if (!hasUploadToken(request)) {
      sendJson(response, 400, { ok: false, code: "MISSING_TOKEN" });
      return;
    }

    const payload = await readJsonBody(request);
    const work = payload.work;

    if (!work || !work.id) {
      sendJson(response, 200, { ok: false, code: "INVALID_WORK" });
      return;
    }

    const list = readWorks();
    if (list.some((item) => item.id === work.id)) {
      sendJson(response, 200, { ok: false, code: "WORK_EXISTS" });
      return;
    }

    list.push(work);
    writeWorks(list);

    const published = await publishWorks([]);
    sendJson(response, 200, {
      ok: true,
      works: list,
      pushed: published.ok,
      publishError: published.ok ? "" : `${published.code}：${published.detail}`
    });
  } catch (error) {
    sendJson(response, 200, { ok: false, code: error.message || "SAVE_WORK_FAILED" });
  }
}

async function handleDeleteWork(request, response) {
  try {
    if (!hasUploadToken(request)) {
      sendJson(response, 400, { ok: false, code: "MISSING_TOKEN" });
      return;
    }

    const payload = await readJsonBody(request);
    const id = String(payload.id || "");
    const token = String(payload.token || "");

    const list = readWorks();
    const index = list.findIndex((item) => item.id === id);
    if (index < 0) {
      sendJson(response, 200, { ok: false, code: "WORK_NOT_FOUND" });
      return;
    }

    const work = list[index];
    const removedPaths = [];

    // 云端对象：视频 + 封面
    if (work.videoStorage === "cloudbase" && work.videoFileId) {
      const result = await callCloud({ action: "delete", token, fileId: work.videoFileId });
      if (!result.ok) {
        sendJson(response, 200, result);
        return;
      }
    }

    if (work.coverStorage === "cloudbase" && work.coverFileId) {
      const result = await callCloud({ action: "delete", token, fileId: work.coverFileId });
      if (!result.ok) {
        sendJson(response, 200, result);
        return;
      }
    }

    // 本地文件（早期作品）：封面
    const cover = String(work.cover || "");
    if (cover.startsWith("assets/covers/")) {
      const coverPath = path.resolve(root, cover);
      if (coverPath.startsWith(root)) {
        fs.rmSync(coverPath, { force: true });
        removedPaths.push("assets/covers");
      }
    }

    // 本地文件（早期作品）：视频
    const video = String(work.video || "");
    if (work.videoStorage !== "cloudbase" && video.startsWith("media/videos/")) {
      const videoPath = path.resolve(root, video);
      if (videoPath.startsWith(root)) {
        fs.rmSync(videoPath, { force: true });
        removedPaths.push("media/videos");
      }
    }

    list.splice(index, 1);
    writeWorks(list);

    const published = await publishWorks(removedPaths);
    sendJson(response, 200, {
      ok: true,
      works: list,
      pushed: published.ok,
      publishError: published.ok ? "" : `${published.code}：${published.detail}`
    });
  } catch (error) {
    sendJson(response, 200, { ok: false, code: error.message || "DELETE_WORK_FAILED" });
  }
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

    let uploadResponse;
    try {
      uploadResponse = await fetch(targetUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: fileBuffer
      });
    } catch (error) {
      sendJson(response, 200, {
        ok: false,
        code: "STORAGE_PUT_FAILED",
        detail: describeFetchError(error, targetUrl.split("?")[0])
      });
      return;
    }

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

  if (request.method === "GET" && requestPath === "/api/diag") {
    await handleDiag(request, response);
    return;
  }

  if (request.method === "POST" && requestPath === "/api/save-work") {
    await handleSaveWork(request, response);
    return;
  }

  if (request.method === "POST" && requestPath === "/api/delete-work") {
    await handleDeleteWork(request, response);
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
