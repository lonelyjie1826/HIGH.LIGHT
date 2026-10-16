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
    chooseWebsiteFolder: document.querySelector("#chooseWebsiteFolder"),
    previewCover: document.querySelector("#previewCover"),
    previewTitle: document.querySelector("#previewTitle"),
    previewGame: document.querySelector("#previewGame"),
    previewType: document.querySelector("#previewType"),
    previewTypeTag: document.querySelector("#previewTypeTag"),
    previewDuration: document.querySelector("#previewDuration")
  };

  let coverObjectUrl = "";
  let rootDirectoryHandle = null;
  let pendingDeleteId = "";
  let uploadedVideo = null;

  const games = [...new Map(works.map((work) => [work.gameKey, work.game])).entries()];
  elements.gameOptions.innerHTML = games
    .map(([, game]) => `<option value="${game}"></option>`)
    .join("");

  function slugify(value) {
    const slug = String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return slug || `work-${Date.now()}`;
  }

  function safeFileName(file, fallback) {
    if (!file) return "";
    const lastDot = file.name.lastIndexOf(".");
    const extension = lastDot >= 0 ? file.name.slice(lastDot).toLowerCase() : "";
    return `${fallback}${extension}`;
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

  function makeWork() {
    const type = getSelectedType();
    const title = elements.title.value.trim();
    const game = elements.game.value.trim();
    const id = `${slugify(title)}-${Date.now().toString().slice(-6)}`;
    const videoFile = elements.videoFile.files[0];
    const coverFile = elements.coverFile.files[0];

    if (!title || !game || !videoFile || !coverFile) {
      throw new Error("请填写标题、游戏，并选择视频和封面。");
    }

    const videoName = safeFileName(videoFile, id);
    const coverName = safeFileName(coverFile, id);
    const cloud = uploadedVideo;

    return {
      id,
      title,
      game,
      gameKey: gameKeyFor(game),
      type,
      typeLabel: type === "epic" ? "EPIC" : "FUNNY",
      date: new Date().toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).replaceAll("/", "."),
      duration: elements.duration.value.trim() || "00:00",
      cover: `assets/covers/${coverName}`,
      video: cloud ? cloud.videoUrl : `media/videos/${videoName}`,
      videoFileId: cloud ? cloud.videoFileId : "",
      videoStorage: cloud ? "cloudbase" : "local",
      description: elements.description.value.trim(),
      files: {
        video: videoFile,
        cover: coverFile,
        videoName,
        coverName
      }
    };
  }

  function cleanWork(work) {
    const clean = { ...work };
    delete clean.files;
    return clean;
  }

  function worksSource(list) {
    return `/*
 * HIGH·LIGHT 作品数据
 * 此文件由网站发布页更新。普通使用无需手动编辑。
 */
window.HIGHLIGHT_WORKS = ${JSON.stringify(list, null, 2)};
`;
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

  async function callCloud(payload) {
    const config = window.HIGHLIGHT_CLOUDBASE || {};
    if (!config.endpoint) {
      throw new Error("CloudBase 尚未配置。");
    }

    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.code || `云端请求失败：${response.status}`);
    }
    return data;
  }

  async function uploadVideoToCloud() {
    try {
      const file = elements.videoFile.files[0];
      const token = elements.cloudToken.value.trim();
      if (!file) throw new Error("请先选择视频。");
      if (!token) throw new Error("请先填写云端上传口令。");

      const title = elements.title.value.trim() || "work";
      const id = `${slugify(title)}-${Date.now().toString().slice(-6)}`;
      const extension = (file.name.match(/\.[a-zA-Z0-9]+$/) || [".mp4"])[0].toLowerCase();
      const cloudPath = `videos/${id}${extension}`;

      setCloudStatus("正在获取云端上传授权…");
      const payload = await callCloud({
        action: "sign-upload",
        token,
        cloudPath
      });

      if (!payload.ok) {
        throw new Error(payload.code || "云端鉴权失败。");
      }

      const form = new FormData();
      form.append("key", payload.upload.cosFileId);
      form.append("Signature", payload.upload.authorization);
      if (payload.upload.token) {
        form.append("x-cos-security-token", payload.upload.token);
      }
      form.append("file", file);

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", payload.upload.url, true);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round(event.loaded / event.total * 100);
            setCloudStatus(`正在上传到云端：${percent}%`);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error("云端上传失败，请检查存储跨域配置。"));
        };
        xhr.onerror = () => reject(new Error("云端上传网络错误。"));
        xhr.send(form);
      });

      uploadedVideo = {
        videoUrl: payload.videoUrl,
        videoFileId: payload.videoFileId
      };
      setCloudStatus("视频已上传到云端。继续点击“保存到网站文件夹”即可写入作品数据。");
    } catch (error) {
      setCloudStatus(error.message || "云端上传失败。", true);
    }
  }

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

  function fileNameFromPath(filePath, folder) {
    if (!filePath || !filePath.startsWith(`${folder}/`)) return "";
    return filePath.slice(folder.length + 1).replaceAll("/", "");
  }

  async function chooseWebsiteFolder() {
    try {
      rootDirectoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      setManageStatus("网站文件夹已选择，现在可以删除作品。");
    } catch (error) {
      if (error?.name === "AbortError") return;
      setManageStatus("无法打开网站文件夹，请使用 Chrome 或 Edge 重试。", true);
    }
  }

  async function removeCloudVideo(work) {
    if (work.videoStorage !== "cloudbase" || !work.videoFileId) return;

    const token = elements.cloudToken.value.trim();
    if (!token) {
      throw new Error("删除云端视频前，请先填写云端上传口令。");
    }

    const result = await callCloud({
      action: "delete",
      token,
      fileId: work.videoFileId
    });
    if (!result.ok) {
      throw new Error(result.code || "云端视频删除失败。");
    }
  }

  async function removeFileIfUnused(work, remainingWorks) {
    if (!rootDirectoryHandle) {
      throw new Error("请先选择网站文件夹。");
    }

    const videoName = fileNameFromPath(work.video, "media/videos");
    const coverName = fileNameFromPath(work.cover, "assets/covers");
    const videoUsed = remainingWorks.some((item) => item.video === work.video);
    const coverUsed = remainingWorks.some((item) => item.cover === work.cover);

    if (work.videoStorage === "cloudbase") {
      await removeCloudVideo(work);
    } else if (videoName && !videoUsed) {
      const mediaHandle = await rootDirectoryHandle.getDirectoryHandle("media");
      const videoHandle = await mediaHandle.getDirectoryHandle("videos");
      await videoHandle.removeEntry(videoName).catch(() => {});
    }

    if (coverName && !coverUsed) {
      const assetsHandle = await rootDirectoryHandle.getDirectoryHandle("assets");
      const coversHandle = await assetsHandle.getDirectoryHandle("covers");
      await coversHandle.removeEntry(coverName).catch(() => {});
    }

    const dataHandle = await rootDirectoryHandle.getDirectoryHandle("data");
    await writeFile(dataHandle, "works.js", new Blob([worksSource(remainingWorks)], { type: "text/javascript" }));
  }

  async function deleteWork(id) {
    if (!rootDirectoryHandle) {
      try {
        await chooseWebsiteFolder();
      } catch {
        return;
      }
      if (!rootDirectoryHandle) return;
    }

    const work = works.find((item) => item.id === id);
    if (!work) return;
    const remainingWorks = works.filter((item) => item.id !== id);

    try {
      setManageStatus(`正在删除「${work.title}」…`);
      await removeFileIfUnused(work, remainingWorks);
      works.splice(works.findIndex((item) => item.id === id), 1);
      pendingDeleteId = "";
      renderManageList();
      setManageStatus(`已删除「${work.title}」。回到首页刷新即可。`);
    } catch (error) {
      setManageStatus(error.message || "删除失败，请检查网站文件夹。", true);
    }
  }

  function updatePreview() {
    const type = getSelectedType();
    const typeLabel = type === "epic" ? "EPIC" : "FUNNY";

    elements.previewTitle.textContent = elements.title.value.trim() || "作品标题";
    elements.previewGame.textContent = elements.game.value.trim() || "游戏名称";
    elements.previewType.textContent = typeLabel;
    elements.previewTypeTag.textContent = typeLabel;
    elements.previewDuration.textContent = elements.duration.value.trim() || "00:00";
  }

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

  async function writeFile(directoryHandle, name, file) {
    const fileHandle = await directoryHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file);
    await writable.close();
  }

  async function saveToFolder() {
    try {
      const work = makeWork();
      const rootHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      rootDirectoryHandle = rootHandle;
      const assetsHandle = await rootHandle.getDirectoryHandle("assets");
      const coversHandle = await assetsHandle.getDirectoryHandle("covers");
      const dataHandle = await rootHandle.getDirectoryHandle("data");

      setStatus("正在保存作品信息…");
      if (work.videoStorage !== "cloudbase") {
        const mediaHandle = await rootHandle.getDirectoryHandle("media");
        const videoHandle = await mediaHandle.getDirectoryHandle("videos");
        await writeFile(videoHandle, work.files.videoName, work.files.video);
      }
      await writeFile(coversHandle, work.files.coverName, work.files.cover);

      const updatedWorks = [...works, cleanWork(work)];
      await writeFile(dataHandle, "works.js", new Blob([worksSource(updatedWorks)], { type: "text/javascript" }));

      works.push(cleanWork(work));
      setStatus("保存成功。回到首页刷新，就能看到新作品。");
      elements.form.reset();
      elements.videoFileName.textContent = "点击选择视频";
      elements.coverFileName.textContent = "点击选择封面";
      elements.previewCover.src = "./assets/covers/elden-ring.svg";
      uploadedVideo = null;
      setCloudStatus("");
      updatePreview();
    } catch (error) {
      if (error?.name === "AbortError") return;
      setStatus(error.message || "保存失败，请改用下载数据的方式。", true);
    }
  }

  function downloadWorks() {
    try {
      const work = makeWork();
      const updatedWorks = [...works, cleanWork(work)];
      const blob = new Blob([worksSource(updatedWorks)], { type: "text/javascript;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "works.js";
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus("已下载 works.js。还需要把视频和封面复制到指定文件夹。");
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  if (typeof window.showDirectoryPicker === "function") {
    elements.browserNote.textContent = "当前浏览器支持自动保存。选择整个网站文件夹后，视频、封面和作品数据会一次写入。";
    elements.saveToFolder.addEventListener("click", saveToFolder);
    elements.chooseWebsiteFolder.addEventListener("click", chooseWebsiteFolder);
    elements.manageList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-delete-id]");
      if (!button) return;

      const id = button.dataset.deleteId;
      if (pendingDeleteId !== id) {
        pendingDeleteId = id;
        renderManageList();
        setManageStatus("再次点击「确认删除」才会真正删除。");
        return;
      }

      deleteWork(id);
    });
  } else {
    elements.saveToFolder.disabled = true;
    elements.saveToFolder.textContent = "当前浏览器不支持自动保存";
    elements.chooseWebsiteFolder.disabled = true;
    elements.chooseWebsiteFolder.textContent = "当前浏览器无法删除文件";
    setManageStatus("请使用 Chrome 或 Edge 打开本站，才能直接删除作品文件。");
    elements.browserNote.textContent = "请使用 Chrome 或 Edge 打开发布页，即可启用自动保存。也可以下载作品数据后手动替换 data/works.js。";
  }

  elements.uploadCloudVideo.addEventListener("click", uploadVideoToCloud);
  renderManageList();
  elements.downloadWorks.addEventListener("click", downloadWorks);
  updatePreview();
})();
