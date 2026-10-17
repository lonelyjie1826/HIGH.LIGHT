(function () {
  const isLocalEditing =
    window.location.protocol === "file:" ||
    ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

  if (!isLocalEditing) {
    window.location.replace("index.html");
    return;
  }

  const works = Array.isArray(window.HIGHLIGHT_WORKS) ? [...window.HIGHLIGHT_WORKS] : [];

  const elements = {
    form: document.querySelector("#publishForm"),
    videoFile: document.querySelector("#videoFile"),
    coverFile: document.querySelector("#coverFile"),
    videoFileName: document.querySelector("#videoFileName"),
    coverFileName: document.querySelector("#coverFileName"),
    title: document.querySelector("#workTitle"),
    game: document.querySelector("#workGame"),
    duration: document.querySelector("#workDuration"),
    description: document.querySelector("#workDescription"),
    gameOptions: document.querySelector("#gameOptions"),
    saveToFolder: document.querySelector("#saveToFolder"),
    downloadWorks: document.querySelector("#downloadWorks"),
    status: document.querySelector("#formStatus"),
    browserNote: document.querySelector("#browserNote"),
    cloudToken: document.querySelector("#cloudToken"),
    uploadCloudVideo: document.querySelector("#uploadCloudVideo"),
    cloudStatus: document.querySelector("#cloudStatus"),
    manageList: document.querySelector("#manageList"),
    manageStatus: document.querySelector("#manageStatus"),
    previewCover: document.querySelector("#previewCover"),
    previewTitle: document.querySelector("#previewTitle"),
    previewGame: document.querySelector("#previewGame"),
    previewType: document.querySelector("#previewType"),
    previewTypeTag: document.querySelector("#previewTypeTag"),
    previewDuration: document.querySelector("#previewDuration")
  };

  let coverObjectUrl = "";
  let pendingDeleteId = "";
  let uploadedVideo = null;

  const games = [...new Map(works.map((work) => [work.gameKey, work.game])).entries()];
  elements.gameOptions.innerHTML = games
    .map(([, game]) => `<option value="${game}"></option>`)
    .join("");

  /* ------------------------------ 小工具 ------------------------------ */

  function slugify(value) {
    const slug = String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return slug || `work-${Date.now()}`;
  }

  function gameKeyFor(game) {
    const existing = works.find((work) => work.game === game);
    if (existing) return existing.gameKey;

    let hash = 0;
    for (const character of game) {
      hash = (hash * 31 + character.codePointAt(0)) >>> 0;
    }
    return `game-${hash.toString(36)}`;
  }

  function getSelectedType() {
    return elements.form.elements.type.value === "funny" ? "funny" : "epic";
  }

  function getToken() {
    return elements.cloudToken.value.trim();
  }

  function extensionOf(file, fallback) {
    const match = String((file && file.name) || "").match(/\.[a-zA-Z0-9]+$/);
    return (match ? match[0] : fallback).toLowerCase();
  }

  function todayString() {
    return new Date()
      .toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" })
      .replaceAll("/", ".");
  }

  function setStatus(message, isError = false) {
    elements.status.textContent = message;
    elements.status.classList.toggle("is-error", isError);
  }

  function setManageStatus(message, isError = false) {
    elements.manageStatus.textContent = message;
    elements.manageStatus.classList.toggle("is-error", isError);
  }

  function setCloudStatus(message, isError = false) {
    elements.cloudStatus.textContent = message;
    elements.cloudStatus.classList.toggle("is-error", isError);
  }

  function worksSource(list) {
    return `/*
 * HIGH·LIGHT 作品数据
 * 此文件由网站发布页更新。普通使用无需手动编辑。
 */
window.HIGHLIGHT_WORKS = ${JSON.stringify(list, null, 2)};
`;
  }

  /* --------------------------- 与云端 / 本机通信 --------------------------- */

  async function callLocal(pathname, payload) {
    const response = await fetch(pathname, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Upload-Token": getToken()
      },
      body: JSON.stringify(payload)
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      throw new Error("本机服务返回格式错误。");
    }
    return data;
  }

  /** 把一个文件传到云存储，成功返回 { url, fileId }。 */
  function uploadToCloud(file, cloudPath, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/cloud-upload", true);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.setRequestHeader("X-Upload-Token", getToken());
      xhr.setRequestHeader("X-Cloud-Path", cloudPath);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };

      xhr.onload = () => {
        let payload = {};
        try {
          payload = JSON.parse(xhr.responseText || "{}");
        } catch {
          reject(new Error("云端返回格式错误。"));
          return;
        }

        if (!payload.ok) {
          reject(
            new Error(
              [payload.code || "云端上传失败。", payload.detail].filter(Boolean).join("：")
            )
          );
          return;
        }

        resolve({ url: payload.videoUrl, fileId: payload.videoFileId });
      };

      xhr.onerror = () => reject(new Error("本机上传代理连接失败，请重启“启动网站.bat”。"));
      xhr.send(file);
    });
  }

  /* ------------------------------ 上传 / 保存 ------------------------------ */

  async function uploadVideoToCloud() {
    try {
      const file = elements.videoFile.files[0];
      if (!file) throw new Error("请先选择视频。");
      if (!getToken()) throw new Error("请先填写云端上传口令。");

      const title = elements.title.value.trim() || "work";
      const id = `${slugify(title)}-${Date.now().toString().slice(-6)}`;
      const cloudPath = `videos/${id}${extensionOf(file, ".mp4")}`;

      setCloudStatus("正在上传视频到云端…");
      uploadedVideo = await uploadToCloud(file, cloudPath, (percent) => {
        setCloudStatus(
          percent >= 100
            ? "本机已接收，正在上传到云端，请勿关闭窗口…"
            : `正在上传到云端：${percent}%`
        );
      });

      setCloudStatus("视频已上传到云端。现在可以直接点「保存并发布」。");
    } catch (error) {
      setCloudStatus(error.message || "云端上传失败。", true);
    }
  }

  async function saveWork() {
    try {
      const title = elements.title.value.trim();
      const game = elements.game.value.trim();
      const videoFile = elements.videoFile.files[0];
      const coverFile = elements.coverFile.files[0];

      if (!title || !game || !videoFile || !coverFile) {
        throw new Error("请填写标题、游戏，并选择视频和封面。");
      }
      if (!getToken()) {
        throw new Error("请先填写云端上传口令。");
      }

      const id = `${slugify(title)}-${Date.now().toString().slice(-6)}`;
      const type = getSelectedType();

      let video = uploadedVideo;
      if (!video) {
        setStatus("正在上传视频到云端…");
        video = await uploadToCloud(
          videoFile,
          `videos/${id}${extensionOf(videoFile, ".mp4")}`,
          (percent) => {
            setStatus(
              percent >= 100 ? "视频已传完，正在写入云端…" : `正在上传视频：${percent}%`
            );
          }
        );
      }

      setStatus("正在上传封面到云端…");
      const cover = await uploadToCloud(
        coverFile,
        `covers/${id}${extensionOf(coverFile, ".png")}`
      );

      const work = {
        id,
        title,
        game,
        gameKey: gameKeyFor(game),
        type,
        typeLabel: type === "epic" ? "EPIC" : "FUNNY",
        date: todayString(),
        duration: elements.duration.value.trim() || "00:00",
        cover: cover.url,
        coverFileId: cover.fileId,
        coverStorage: "cloudbase",
        video: video.url,
        videoFileId: video.fileId,
        videoStorage: "cloudbase",
        description: elements.description.value.trim()
      };

      setStatus("正在保存作品数据并推送到 GitHub…");
      const result = await callLocal("/api/save-work", { work });

      if (!result.ok) {
        throw new Error([result.code || "保存失败。", result.detail].filter(Boolean).join("："));
      }

      works.length = 0;
      (result.works || []).forEach((item) => works.push(item));
      renderManageList();

      if (result.pushed) {
        setStatus("已发布。公开网址 1～3 分钟后更新，记得 Ctrl+F5 强刷。");
      } else {
        setStatus(`作品已存到本机，但推送到 GitHub 失败：${result.publishError}`, true);
      }

      resetForm();
    } catch (error) {
      setStatus(error.message || "保存失败。", true);
    }
  }

  function resetForm() {
    const token = getToken();

    elements.form.reset();
    elements.cloudToken.value = token;

    elements.videoFileName.textContent = "点击选择视频";
    elements.coverFileName.textContent = "点击选择封面";
    elements.previewCover.src = "./assets/covers/elden-ring.svg";

    uploadedVideo = null;
    pendingDeleteId = "";
    setCloudStatus("");
    updatePreview();
  }

  function downloadWorks() {
    try {
      const blob = new Blob([worksSource(works)], {
        type: "text/javascript;charset=utf-8"
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "works.js";
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus("已下载当前的 data/works.js（仅作备份用）。");
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  /* ------------------------------ 作品管理 ------------------------------ */

  function renderManageList() {
    if (!works.length) {
      elements.manageList.innerHTML = '<p class="manage-empty">目前没有可以管理的作品。</p>';
      return;
    }

    elements.manageList.innerHTML = works
      .map((work) => {
        const isPending = pendingDeleteId === work.id;
        return `
          <article class="manage-item">
            <span class="manage-index">${String(works.indexOf(work) + 1).padStart(2, "0")}</span>
            <div class="manage-copy">
              <h3>${work.title}</h3>
              <p>${work.game} · ${work.typeLabel || (work.type === "funny" ? "FUNNY" : "EPIC")}</p>
            </div>
            <span class="manage-file">${work.video ? "含视频" : "无视频"}</span>
            <button class="delete-button${isPending ? " is-pending" : ""}" type="button" data-delete-id="${work.id}">
              ${isPending ? "确认删除" : "删除"}
            </button>
          </article>
        `;
      })
      .join("");
  }

  async function deleteWork(id) {
    const work = works.find((item) => item.id === id);
    if (!work) return;

    if (!getToken()) {
      pendingDeleteId = "";
      renderManageList();
      setManageStatus("删除前请先填写云端上传口令。", true);
      return;
    }

    try {
      setManageStatus(`正在删除「${work.title}」…`);
      const result = await callLocal("/api/delete-work", { id, token: getToken() });

      if (!result.ok) {
        throw new Error([result.code || "删除失败。", result.detail].filter(Boolean).join("："));
      }

      works.length = 0;
      (result.works || []).forEach((item) => works.push(item));
      pendingDeleteId = "";
      renderManageList();

      if (result.pushed) {
        setManageStatus(`已删除「${work.title}」并发布。`);
      } else {
        setManageStatus(
          `已删除「${work.title}」，但推送到 GitHub 失败：${result.publishError}`,
          true
        );
      }
    } catch (error) {
      pendingDeleteId = "";
      renderManageList();
      setManageStatus(error.message || "删除失败。", true);
    }
  }

  /* ------------------------------- 预览 ------------------------------- */

  function updatePreview() {
    const type = getSelectedType();
    const typeLabel = type === "epic" ? "EPIC" : "FUNNY";

    elements.previewTitle.textContent = elements.title.value.trim() || "作品标题";
    elements.previewGame.textContent = elements.game.value.trim() || "游戏名称";
    elements.previewType.textContent = typeLabel;
    elements.previewTypeTag.textContent = typeLabel;
    elements.previewDuration.textContent = elements.duration.value.trim() || "00:00";
  }

  /* ------------------------------ 事件绑定 ------------------------------ */

  elements.form.addEventListener("input", updatePreview);
  elements.form.addEventListener("change", updatePreview);

  elements.videoFile.addEventListener("change", () => {
    const file = elements.videoFile.files[0];
    elements.videoFileName.textContent = file ? file.name : "点击选择视频";
    uploadedVideo = null;
    setCloudStatus("");

    if (!file) return;

    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const total = Math.max(0, Math.round(video.duration || 0));
      const minutes = String(Math.floor(total / 60)).padStart(2, "0");
      const seconds = String(total % 60).padStart(2, "0");
      elements.duration.value = `${minutes}:${seconds}`;
      updatePreview();
      URL.revokeObjectURL(video.src);
    };
    video.src = URL.createObjectURL(file);
  });

  elements.coverFile.addEventListener("change", () => {
    const file = elements.coverFile.files[0];
    elements.coverFileName.textContent = file ? file.name : "点击选择封面";

    if (!file) return;
    if (coverObjectUrl) URL.revokeObjectURL(coverObjectUrl);
    coverObjectUrl = URL.createObjectURL(file);
    elements.previewCover.src = coverObjectUrl;
  });

  elements.uploadCloudVideo.addEventListener("click", uploadVideoToCloud);
  elements.saveToFolder.addEventListener("click", saveWork);
  elements.downloadWorks.addEventListener("click", downloadWorks);

  elements.manageList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-id]");
    if (!button) return;

    const id = button.dataset.deleteId;
    if (pendingDeleteId !== id) {
      pendingDeleteId = id;
      renderManageList();
      setManageStatus("再点一次「确认删除」才会真正删除，删掉后会自动发布。");
      return;
    }

    deleteWork(id);
  });

  elements.browserNote.textContent =
    "点「保存并发布」后：视频和封面会上传到云存储，作品数据写入 data/works.js 并自动推送到 GitHub。不用再双击任何脚本。";

  renderManageList();
  updatePreview();
})();
