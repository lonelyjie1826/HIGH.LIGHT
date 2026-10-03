(function () {
  const works = Array.isArray(window.HIGHLIGHT_WORKS) ? window.HIGHLIGHT_WORKS : [];
  const page = document.body.dataset.page;

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const formatIndex = (index) => String(index + 1).padStart(2, "0");

  function renderHeader() {
    document.querySelectorAll("[data-site-header]").forEach((slot) => {
      slot.innerHTML = `
        <div class="site-header">
          <a class="brand" href="index.html" aria-label="HIGH·LIGHT 首页">
            <span>HIGH</span><i aria-hidden="true"></i><span>LIGHT</span>
          </a>
          <a class="publish-link" href="publish.html">
            <span>发布时刻</span>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>
          </a>
        </div>
      `;
    });
  }

  function cardMarkup(work, index) {
    const type = work.type === "funny" ? "funny" : "epic";
    const typeLabel = type === "epic" ? "EPIC" : "FUNNY";
    const detailUrl = `detail.html?id=${encodeURIComponent(work.id)}`;

    return `
      <article class="art-card" data-type="${type}" data-game="${escapeHtml(work.gameKey)}">
        <a class="artwork-link" href="${detailUrl}" aria-label="查看作品：${escapeHtml(work.title)}">
          <div class="artwork">
            <img src="${escapeHtml(work.cover)}" alt="${escapeHtml(work.title)}封面">
            <span class="play-indicator" aria-hidden="true">
              <svg viewBox="0 0 20 20"><path d="m7 4 8 6-8 6V4Z"/></svg>
            </span>
            <span class="duration">${escapeHtml(work.duration || "00:00")}</span>
          </div>
          <div class="label-row">
            <div class="label-copy">
              <span class="work-index">${formatIndex(index)}</span>
              <h3>${escapeHtml(work.title)}</h3>
              <p>${escapeHtml(work.game)} <i>·</i> ${typeLabel}</p>
            </div>
            <span class="type-tag">${typeLabel}</span>
          </div>
        </a>
      </article>
    `;
  }

  function initHome() {
    renderHeader();

    const grid = document.querySelector("#galleryGrid");
    const resultCount = document.querySelector("#resultCount");
    const emptyState = document.querySelector("#emptyState");
    const archiveIndex = document.querySelector("#archiveIndex");

    if (!grid) return;

    grid.innerHTML = works.map(cardMarkup).join("");

    if (archiveIndex) {
      archiveIndex.textContent = works.length ? `NO. 001—${String(works.length).padStart(3, "0")}` : "NO. 000";
    }

    const cards = [...document.querySelectorAll(".art-card")];
    const activeType = new URLSearchParams(window.location.search).get("filter");

    function updateGallery() {
      let visible = 0;

      cards.forEach((card) => {
        const typeMatches = activeType === "all" || card.dataset.type === activeType;
        const show = !activeType || typeMatches;

        card.classList.toggle("is-hidden", !show);

        if (show) {
          visible += 1;
          card.style.animation = "none";
          requestAnimationFrame(() => {
            card.style.animation = "";
          });
        }
      });

      resultCount.textContent = String(visible).padStart(2, "0");
      emptyState.classList.toggle("is-visible", visible === 0);
    }

    updateGallery();
  }

  function reactionStateKey(id) {
    return `highlight-reactions-${id}`;
  }

  function initDetail() {
    renderHeader();

    const id = new URLSearchParams(window.location.search).get("id") || works[0]?.id;
    const work = works.find((item) => item.id === id);
    const root = document.querySelector("#detailRoot");

    if (!work) {
      document.title = "作品不存在 — HIGH·LIGHT";
      root.innerHTML = `
        <section class="detail-missing">
          <p class="eyebrow">NOT FOUND</p>
          <h1>这件作品不存在。</h1>
          <a class="text-link" href="index.html">返回画廊</a>
        </section>
      `;
      return;
    }

    document.title = `${work.title} — HIGH·LIGHT`;

    const type = work.type === "funny" ? "funny" : "epic";
    const typeLabel = type === "epic" ? "EPIC / 精彩时刻" : "FUNNY / 搞笑时刻";

    root.innerHTML = `
      <section class="detail-head">
        <a class="back-link" href="index.html#gallery">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8H3M7 4 3 8l4 4"/></svg>
          <span>返回画廊</span>
        </a>
        <p class="detail-number">${formatIndex(works.indexOf(work))}</p>
      </section>

      <section class="detail-player" id="detailPlayer"></section>

      <section class="detail-info">
        <div class="detail-copy">
          <p class="eyebrow">${typeLabel}</p>
          <h1>${escapeHtml(work.title)}</h1>
          <p class="detail-description">${escapeHtml(work.description || "这个瞬间还没有描述。")}</p>
        </div>
        <dl class="detail-meta">
          <div><dt>发布时间</dt><dd>${escapeHtml(work.date)}</dd></div>
          <div><dt>游戏</dt><dd>${escapeHtml(work.game)}</dd></div>
          <div><dt>片长</dt><dd>${escapeHtml(work.duration || "00:00")}</dd></div>
        </dl>
      </section>

      <section class="reaction-section" aria-label="作品反应">
        <div class="reaction-heading">
          <p class="eyebrow">REACTIONS</p>
          <h2>留下反应</h2>
        </div>
        <div class="reaction-bar" id="reactionBar"></div>
      </section>

      <section class="comments-section" aria-labelledby="commentsTitle">
        <div class="comments-heading">
          <div>
            <p class="eyebrow">COMMENTS</p>
            <h2 id="commentsTitle">评论</h2>
          </div>
          <span id="commentCount"></span>
        </div>
        <div class="comments-list" id="commentsList"></div>
        <form class="comment-form" id="commentForm">
          <label>
            <span>称呼</span>
            <input id="commentName" maxlength="18" placeholder="你的名字">
          </label>
          <label class="comment-content-field">
            <span>评论</span>
            <input id="commentText" maxlength="120" placeholder="说点什么" required>
          </label>
          <button class="button-primary" type="submit">发送评论</button>
        </form>
      </section>
    `;

    const player = document.querySelector("#detailPlayer");
    if (work.video) {
      player.innerHTML = `
        <video controls playsinline preload="metadata" poster="${escapeHtml(work.cover)}">
          <source src="${escapeHtml(work.video)}">
          你的浏览器不支持视频播放。
        </video>
      `;
    } else {
      player.innerHTML = `
        <div class="video-placeholder">
          <img src="${escapeHtml(work.cover)}" alt="${escapeHtml(work.title)}封面">
          <div class="video-placeholder-label">
            <span>PREVIEW FRAME</span>
            <strong>上传视频后即可在这里播放</strong>
          </div>
        </div>
      `;
    }

    const reactions = [
      ["fire", "🔥", "太秀了"],
      ["laugh", "😂", "笑死"],
      ["eyes", "👀", "离谱"],
      ["like", "👍", "牛"]
    ];
    const reactionBar = document.querySelector("#reactionBar");
    const baseReactions = work.reactions || {};
    let localReactions = {};

    try {
      localReactions = JSON.parse(localStorage.getItem(reactionStateKey(work.id)) || "{}");
    } catch {
      localReactions = {};
    }

    function renderReactions() {
      reactionBar.innerHTML = reactions
        .map(([key, emoji, label]) => {
          const selected = Boolean(localReactions[key]);
          const count = Number(baseReactions[key] || 0) + (selected ? 1 : 0);
          return `
            <button class="reaction-button${selected ? " is-selected" : ""}" type="button" data-reaction="${key}">
              <span>${emoji}</span>
              <span>${label}</span>
              <strong>${count}</strong>
            </button>
          `;
        })
        .join("");
    }

    reactionBar.addEventListener("click", (event) => {
      const button = event.target.closest("[data-reaction]");
      if (!button) return;

      const key = button.dataset.reaction;
      localReactions[key] = !localReactions[key];
      localStorage.setItem(reactionStateKey(work.id), JSON.stringify(localReactions));
      renderReactions();
    });

    renderReactions();

    const commentsList = document.querySelector("#commentsList");
    const commentCount = document.querySelector("#commentCount");
    const commentForm = document.querySelector("#commentForm");
    const commentName = document.querySelector("#commentName");
    const commentText = document.querySelector("#commentText");
    const commentsKey = `highlight-comments-${work.id}`;
    let localComments = [];

    try {
      localComments = JSON.parse(localStorage.getItem(commentsKey) || "[]");
    } catch {
      localComments = [];
    }

    function renderComments() {
      const comments = [...(work.comments || []), ...localComments];
      commentCount.textContent = `${String(comments.length).padStart(2, "0")} 条`;

      commentsList.innerHTML = comments.length
        ? comments
            .map(
              (comment) => `
                <article class="comment">
                  <div class="comment-meta">
                    <strong>${escapeHtml(comment.name || "匿名")}</strong>
                    <time>${escapeHtml(comment.date || "")}</time>
                  </div>
                  <p>${escapeHtml(comment.text)}</p>
                </article>
              `
            )
            .join("")
        : '<p class="comments-empty">还没有评论。</p>';
    }

    commentForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = commentText.value.trim();
      if (!text) return;

      localComments.push({
        name: commentName.value.trim() || "匿名",
        text,
        date: new Date().toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }).replace("/", ".")
      });
      localStorage.setItem(commentsKey, JSON.stringify(localComments));
      commentText.value = "";
      renderComments();
    });

    renderComments();
  }

  if (page === "home") initHome();
  if (page === "detail") initDetail();
  if (page === "about" || page === "publish") renderHeader();
})();
