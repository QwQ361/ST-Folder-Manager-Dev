// 头像管理器：承接 char/user 头像管理器弹窗（复用主题缩略图画廊 UI）的存储层读写与弹窗渲染/事件绑定。
// 存储结构：extension_settings[extensionName].avatarManager = {
//   chars:      { [char.avatar]: [文件相对路径, ...] },   // 各 char 的「我的头像」列表（有序）
//   personas:   { [persona.avatarId]: [文件相对路径, ...] }, // 各 user 的「我的头像」列表（有序）
//   charFavorites:     [文件相对路径, ...],  // 所有 char 共享收藏库
//   personaFavorites:  [文件相对路径, ...],  // 所有 user 共享收藏库
// }
// 个人库与共享收藏库互相独立：删除任一侧引用不影响另一侧；仅当文件路径不再被任何域引用时才真正删除文件本体。

export function createAvatarManagerApiCore(deps) {
  const {
    $,
    document,
    escapeHtml,
    cfmToastr,
    cfmConfirm,
    uploadAvatarFile,
    deleteAvatarFile,
    applyAvatarToTarget,
    saveSettingsDebounced,
    settings,
    extensionName,
    avatarPathToDisplayUrl,
    console,
  } = deps;

  // ==================== 存储层 ====================

  function getStore() {
    const root = settings[extensionName] || {};
    if (!root.avatarManager || typeof root.avatarManager !== "object") {
      root.avatarManager = {};
    }
    const store = root.avatarManager;
    if (!store.chars || typeof store.chars !== "object") store.chars = {};
    if (!store.personas || typeof store.personas !== "object") store.personas = {};
    if (!Array.isArray(store.charFavorites)) store.charFavorites = [];
    if (!Array.isArray(store.personaFavorites)) store.personaFavorites = [];
    return store;
  }

  // kind: "chars" | "personas"
  function getKindKey(kind) {
    return kind === "chars" ? "chars" : "personas";
  }

  // 个人库数组（目标 key：char.avatar / persona.avatarId）
  function getAvatarList(kind, targetId) {
    if (!targetId) return [];
    const store = getStore();
    const list = store[getKindKey(kind)][targetId];
    return Array.isArray(list) ? list : [];
  }

  // 共享收藏库数组（char→charFavorites，user→personaFavorites）
  function getFavList(kind) {
    const store = getStore();
    return kind === "chars" ? store.charFavorites : store.personaFavorites;
  }

  // 所有域中是否仍引用某文件路径（决定删除时是否保留文件本体）
  function isPathReferencedAnywhere(filePath) {
    const store = getStore();
    const domains = [store.chars, store.personas];
    for (const domain of domains) {
      for (const list of Object.values(domain)) {
        if (Array.isArray(list) && list.includes(filePath)) return true;
      }
    }
    if (store.charFavorites.includes(filePath)) return true;
    if (store.personaFavorites.includes(filePath)) return true;
    return false;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    });
  }

  function pickImageFile() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.style.display = "none";
      const cleanup = () => input.remove();
      input.addEventListener(
        "change",
        () => {
          const file = input.files?.[0] || null;
          cleanup();
          resolve(file);
        },
        { once: true },
      );
      input.addEventListener(
        "cancel",
        () => {
          cleanup();
          resolve(null);
        },
        { once: true },
      );
      document.body.appendChild(input);
      input.click();
    });
  }

  // 导入（个人库）：选图 → 上传文件库（不裁剪）→ push 到个人库 → 保存
  async function importAvatar(kind, targetId, file) {
    if (!file) return "";
    const dataUrl = await readFileAsDataUrl(file);
    if (!dataUrl) {
      cfmToastr.error("读取图片失败");
      return "";
    }
    const filePath = await uploadAvatarFile(targetId, dataUrl);
    if (!filePath) {
      cfmToastr.error("上传头像失败，请重试");
      return "";
    }
    const store = getStore();
    if (!Array.isArray(store[getKindKey(kind)][targetId])) {
      store[getKindKey(kind)][targetId] = [];
    }
    store[getKindKey(kind)][targetId].push(filePath);
    saveSettingsDebounced();
    return filePath;
  }

  // 导入（共享收藏库）：选图 → 上传文件库（不裁剪）→ push 到共享收藏库 → 保存
  async function importFavoriteAvatar(kind, file) {
    if (!file) return "";
    const dataUrl = await readFileAsDataUrl(file);
    if (!dataUrl) {
      cfmToastr.error("读取图片失败");
      return "";
    }
    const filePath = await uploadAvatarFile(kind === "chars" ? "char-fav" : "persona-fav", dataUrl);
    if (!filePath) {
      cfmToastr.error("上传头像失败，请重试");
      return "";
    }
    const favs = getFavList(kind);
    if (!favs.includes(filePath)) {
      favs.push(filePath);
    }
    saveSettingsDebounced();
    return filePath;
  }

  // 删除我的头像：从个人库移除；若文件不再被任何域引用则删除文件本体
  async function deleteAvatar(kind, targetId, filePath) {
    const store = getStore();
    const list = store[getKindKey(kind)][targetId];
    if (!Array.isArray(list)) return false;
    const idx = list.indexOf(filePath);
    if (idx === -1) return false;
    list.splice(idx, 1);
    saveSettingsDebounced();
    if (!isPathReferencedAnywhere(filePath)) {
      await deleteAvatarFile(filePath);
    }
    return true;
  }

  // 收藏：仅加入共享收藏库（个人库不动），去重
  function addFavorite(kind, filePath) {
    const favs = getFavList(kind);
    if (!favs.includes(filePath)) {
      favs.push(filePath);
      saveSettingsDebounced();
      return true;
    }
    return false;
  }

  // 取消收藏：从共享库移出，并移入当前个人库（个人库已含则仅移除共享引用），不删文件
  function unfavorite(kind, targetId, filePath) {
    const favs = getFavList(kind);
    const idx = favs.indexOf(filePath);
    if (idx >= 0) favs.splice(idx, 1);
    const store = getStore();
    if (!Array.isArray(store[getKindKey(kind)][targetId])) {
      store[getKindKey(kind)][targetId] = [];
    }
    if (!store[getKindKey(kind)][targetId].includes(filePath)) {
      store[getKindKey(kind)][targetId].push(filePath);
    }
    saveSettingsDebounced();
  }

  // 删除共享收藏：从共享库移出；若文件仍被任何个人库引用则保留文件，否则删除文件本体
  async function deleteFavorite(kind, filePath) {
    const favs = getFavList(kind);
    const idx = favs.indexOf(filePath);
    if (idx >= 0) favs.splice(idx, 1);
    saveSettingsDebounced();
    if (!isPathReferencedAnywhere(filePath)) {
      await deleteAvatarFile(filePath);
    }
  }

  // 统一的头像加载失败占位回退（文件缺失时显示灰色占位，不破图）
  function bindThumbnailErrorFallback(img) {
    img.onerror = function () {
      this.classList.add("cfm-theme-gallery-img-broken");
      this.src =
        "data:image/svg+xml;charset=UTF-8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="#2a2e3a"/><text x="50%" y="50%" fill="#6c7086" font-size="14" text-anchor="middle" dominant-baseline="middle">头像缺失</text></svg>',
        );
    };
    return img;
  }

  // ==================== 放大预览 + 操作按钮 ====================

  // tab: "mine" | "fav"
  function openZoomPreview(path, kind, targetId, tab, refreshGrid) {
    const displayUrl = avatarPathToDisplayUrl(path);
    const overlay = $(`
      <div class="cfm-theme-gallery-zoom-overlay">
        <div class="cfm-theme-gallery-zoom-box">
          <button class="cfm-theme-gallery-zoom-close" title="关闭"><i class="fa-solid fa-xmark"></i></button>
          <img class="cfm-theme-gallery-zoom-img" src="${displayUrl}" alt="头像预览">
          <div class="cfm-theme-gallery-zoom-actions">
            <button class="cfm-btn cfm-avatar-gallery-btn-apply"><i class="fa-solid fa-check"></i> 应用头像</button>
            ${
              tab === "mine"
                ? `<button class="cfm-btn cfm-avatar-gallery-btn-fav"><i class="fa-solid fa-star"></i> 收藏</button>`
                : `<button class="cfm-btn cfm-avatar-gallery-btn-unfav"><i class="fa-solid fa-star-half-stroke"></i> 取消收藏</button>`
            }
            <button class="cfm-btn cfm-avatar-gallery-btn-del"><i class="fa-solid fa-trash-can"></i> 删除头像</button>
          </div>
        </div>
      </div>
    `);
    bindThumbnailErrorFallback(overlay.find(".cfm-theme-gallery-zoom-img")[0]);
    document.body.appendChild(overlay[0]);

    const close = () => overlay.remove();

    overlay.on("click", (e) => {
      if (
        $(e.target).hasClass("cfm-theme-gallery-zoom-overlay") ||
        $(e.target).closest(".cfm-theme-gallery-zoom-close").length > 0 ||
        $(e.target).hasClass("cfm-theme-gallery-zoom-img")
      ) {
        close();
      }
    });

    overlay
      .find(".cfm-avatar-gallery-btn-apply")
      .on("click touchend", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          const ok = await applyAvatarToTarget(kind, targetId, path);
          if (ok) {
            close();
          }
        } catch (err) {
          console?.warn?.("[CFM] 应用头像失败", err);
        }
      });

    overlay.find(".cfm-avatar-gallery-btn-fav").on("click touchend", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (addFavorite(kind, path)) {
        cfmToastr.success("已加入共享收藏库");
      } else {
        cfmToastr.info("该头像已在共享收藏库中");
      }
    });

    overlay.find(".cfm-avatar-gallery-btn-unfav").on("click touchend", (e) => {
      e.preventDefault();
      e.stopPropagation();
      unfavorite(kind, targetId, path);
      cfmToastr.success("已取消收藏，头像保留在当前个人库");
      close();
      if (typeof refreshGrid === "function") refreshGrid();
    });

    overlay
      .find(".cfm-avatar-gallery-btn-del")
      .on("click touchend", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const confirmed = cfmConfirm(
          tab === "mine"
            ? "确定从当前个人库删除该头像？\n（若仍被共享收藏库引用则保留文件）"
            : "确定从共享收藏库删除该头像？\n（若仍被个人库引用则保留文件）",
        );
        if (!confirmed) return;
        if (tab === "mine") {
          await deleteAvatar(kind, targetId, path);
        } else {
          await deleteFavorite(kind, path);
        }
        cfmToastr.success("已删除头像");
        close();
        if (typeof refreshGrid === "function") refreshGrid();
      });
  }

  // ==================== 主弹窗 ====================

  function openAvatarManager({ kind, targetId, targetName }) {
    const overlay = $(`
      <div class="cfm-theme-gallery-overlay">
        <div class="cfm-theme-gallery cfm-avatar-gallery">
          <div class="cfm-theme-gallery-header">
            <div class="cfm-avatar-gallery-title-group">
              <span>头像管理 — ${escapeHtml(targetName || "")}</span>
              <button class="cfm-avatar-gallery-import" title="导入头像"><i class="fa-solid fa-plus"></i></button>
            </div>
            <button class="cfm-theme-gallery-close" title="关闭"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="cfm-avatar-gallery-tabs">
            <button class="cfm-avatar-gallery-tab" data-tab="fav">收藏</button>
            <button class="cfm-avatar-gallery-tab cfm-avatar-gallery-tab-active" data-tab="mine">绑定头像</button>
          </div>
          <div class="cfm-theme-gallery-grid"></div>
        </div>
      </div>
    `);
    document.body.appendChild(overlay[0]);

    let currentTab = "mine";

    function renderGrid() {
      const grid = overlay.find(".cfm-theme-gallery-grid");

      let paths;
      if (currentTab === "mine") {
        paths = getAvatarList(kind, targetId);
      } else {
        paths = getFavList(kind);
      }

      if (!paths || paths.length === 0) {
        grid.html(
          `<div class="cfm-theme-gallery-empty">${
            currentTab === "mine"
              ? "暂无绑定头像，点击标题右侧 + 导入头像"
              : "共享收藏库为空，点击标题右侧 + 导入头像"
          }</div>`,
        );
        return;
      }

      const itemHtml = paths
        .map((path) => {
          const displayUrl = avatarPathToDisplayUrl(path);
          return `<div class="cfm-theme-gallery-item" data-path="${escapeHtml(path)}" title="点击放大">
            <img class="cfm-theme-gallery-thumb" src="${displayUrl}" alt="" loading="lazy">
          </div>`;
        })
        .join("");

      grid.html(`<div class="cfm-theme-gallery-section">${itemHtml}</div>`);
      grid.find(".cfm-theme-gallery-thumb").each(function () {
        bindThumbnailErrorFallback(this);
      });
    }

    // tab 切换
    overlay.on("click touchend", ".cfm-avatar-gallery-tab", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const tab = $(e.currentTarget).data("tab");
      if (tab === currentTab) return;
      currentTab = tab;
      overlay
        .find(".cfm-avatar-gallery-tab")
        .removeClass("cfm-avatar-gallery-tab-active");
      overlay
        .find(`.cfm-avatar-gallery-tab[data-tab="${tab}"]`)
        .addClass("cfm-avatar-gallery-tab-active");
      renderGrid();
    });

    // 导入：mine tab → 个人库；fav tab → 共享收藏库
    overlay.on("click touchend", ".cfm-avatar-gallery-import", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const file = await pickImageFile();
      if (!file) return;
      const filePath =
        currentTab === "mine"
          ? await importAvatar(kind, targetId, file)
          : await importFavoriteAvatar(kind, file);
      if (filePath) {
        cfmToastr.success(
          currentTab === "mine" ? "已导入绑定头像" : "已加入共享收藏库",
        );
        renderGrid();
      }
    });

    // 点击头像 → 放大预览
    overlay.on("click", ".cfm-theme-gallery-item", function () {
      const path = $(this).data("path");
      if (path) openZoomPreview(path, kind, targetId, currentTab, renderGrid);
    });

    // 关闭
    overlay.on("click", ".cfm-theme-gallery-close", (e) => {
      e.preventDefault();
      e.stopPropagation();
      overlay.remove();
    });
    overlay.on("click", (e) => {
      if ($(e.target).hasClass("cfm-theme-gallery-overlay")) overlay.remove();
    });

    renderGrid();
  }

  return {
    openAvatarManager,
    // 导出存储层方法供测试/复用
    importAvatar,
    importFavoriteAvatar,
    deleteAvatar,
    addFavorite,
    unfavorite,
    deleteFavorite,
    getAvatarList,
    getFavList,
  };
}
