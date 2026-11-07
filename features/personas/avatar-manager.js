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
    showBatchProgressOverlay,
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
    if (!store.personas || typeof store.personas !== "object")
      store.personas = {};
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

  // 多选图片选择器：返回 File 数组（用户取消返回空数组），支持按住 Ctrl/Shift 多选
  function pickImageFiles() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = true;
      input.style.display = "none";
      const cleanup = () => input.remove();
      input.addEventListener(
        "change",
        () => {
          const files = Array.from(input.files || []);
          cleanup();
          resolve(files);
        },
        { once: true },
      );
      input.addEventListener(
        "cancel",
        () => {
          cleanup();
          resolve([]);
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
    const filePath = await uploadAvatarFile(
      kind === "chars" ? "char-fav" : "persona-fav",
      dataUrl,
    );
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

  // 批量导入（个人库）：过滤图片类型 → 逐个上传 → 汇总成功/失败，返回 { success, failed }
  async function importAvatarBatch(kind, targetId, files) {
    const imageFiles = Array.from(files || []).filter(
      (f) => f && typeof f.type === "string" && f.type.startsWith("image/"),
    );
    if (imageFiles.length === 0) {
      cfmToastr.warning("没有可导入的有效图片文件");
      return { success: 0, failed: [] };
    }
    let success = 0;
    const failed = [];
    for (const file of imageFiles) {
      const filePath = await importAvatar(kind, targetId, file);
      if (filePath) {
        success++;
      } else {
        failed.push(file.name);
      }
    }
    return { success, failed };
  }

  // 批量导入（共享收藏库）：同上但进入收藏库
  async function importFavoriteAvatarBatch(kind, files) {
    const imageFiles = Array.from(files || []).filter(
      (f) => f && typeof f.type === "string" && f.type.startsWith("image/"),
    );
    if (imageFiles.length === 0) {
      cfmToastr.warning("没有可导入的有效图片文件");
      return { success: 0, failed: [] };
    }
    let success = 0;
    const failed = [];
    for (const file of imageFiles) {
      const filePath = await importFavoriteAvatar(kind, file);
      if (filePath) {
        success++;
      } else {
        failed.push(file.name);
      }
    }
    return { success, failed };
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

  /**
   * 绑定「一次轻点 = 一次动作」的点击处理。
   *
   * 移动端（Android WebView / Termux 部署）对同一次轻点会先后派发 touchend 和一次合成 click，
   * 部分环境即使对 touchend 调用 preventDefault 也仍会派发合成 click。这里有两类后果：
   *  1) 动作被执行两次（例如「应用头像」被连点两次，发出两次上传请求）；
   *  2) 更隐蔽：合成 click 的事件目标是在 touchend 之后才按触点位置重新解析的。
   *     「应用头像」在 touchend 阶段已经 await 打开裁剪弹窗（ST 原生 dialog 以 showModal
   *     进入顶层），于是这次幽灵 click 会落到刚弹出的 dialog 默认按钮上，
   *     使裁剪弹窗「刚打开就被确认」→ 表现为「点击应用头像直接生效、不弹裁剪窗」。
   * 因此这里同时做两件事：
   *  - 时间窗去重 + 执行中标记，保证一次轻点只触发一次动作；
   *  - touchend 触发后在极短时间窗内拦截 document 上的下一次 click（幽灵 click），
   *    阻止它落到新出现的弹窗按钮上。命中或超时即自行解绑，不做长期全局拦截。
   *
   * @param {JQuery<HTMLElement>} $el 目标按钮
   * @param {(e: JQuery.Event) => Promise<void>|void} handler 实际动作
   */
  function bindTapOnce($el, handler) {
    if (!$el || !$el.length) return;
    let lastAt = 0;
    let inFlight = false;
    const el = $el[0];

    // 拦截 touchend 之后紧跟的幽灵 click（捕获阶段，只拦一次，超时自动解除）
    const swallowGhostClick = () => {
      if (typeof document === "undefined") return;
      let timer = null;
      const cleanup = () => {
        document.removeEventListener("click", guard, true);
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };
      const guard = (ev) => {
        const target = ev.target;
        // 落到原按钮自身、或在放大预览容器内的 click 一律放行：
        //  - 原按钮的合成 click 交给时间窗去重（避免影响「连点收藏/取消收藏」）；
        //  - 预览遮罩的关闭逻辑自身有 applying 保护，不需要吞掉事件。
        const inOverlay =
          target?.closest?.(".cfm-theme-gallery-zoom-overlay") ||
          target?.closest?.("#cfm_avatar_gallery, .cfm-avatar-gallery");
        if (target === el || inOverlay) {
          return;
        }
        // 只有落到 ST 弹窗上的 click 才是需要吞掉的幽灵 click
        // （原生 dialog.popup，或 dialog-polyfill 降级出的 .poly_dialog）。
        // 其它位置的 click 一律放行并立即解除守卫，避免在 350ms 窗口内
        // 误吞用户紧接着的真实点击（例如连点另一个缩略图）。
        const inStDialog = target?.closest?.(
          "dialog, .popup, .poly_dialog, ._poly_dialog_overlay",
        );
        cleanup();
        if (!inStDialog) {
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof ev.stopImmediatePropagation === "function") {
          ev.stopImmediatePropagation();
        }
      };
      document.addEventListener("click", guard, true);
      // 幽灵 click 在 touchend 后数十毫秒内派发，350ms 足够覆盖，
      // 又不会明显影响用户后续的真实点击
      timer = setTimeout(cleanup, 350);
    };

    const run = async (e) => {
      const now = Date.now();
      // 同一轻点的 touchend + 合成 click 间隔极短，落在此窗口内的直接丢弃
      if (now - lastAt < 600) return;
      // 上一次动作仍在执行（例如裁剪弹窗尚未结束）时不重复触发
      if (inFlight) return;
      lastAt = now;
      e.preventDefault();
      if (typeof e.stopImmediatePropagation === "function") {
        e.stopImmediatePropagation();
      }
      e.stopPropagation();
      if (e.type === "touchend") {
        swallowGhostClick();
      }
      inFlight = true;
      try {
        await handler(e);
      } finally {
        inFlight = false;
      }
    };
    $el.on("touchend", run);
    $el.on("click", run);
  }

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

    // 应用头像进行中：禁止遮罩点击关闭。
    // 原因：移动端合成 click 可能在 fetch/裁剪弹窗就绪之前落到遮罩上，
    // 若此时允许关闭，会出现「预览闪一下消失、裁剪窗随后弹出」的怪异表现。
    let applying = false;

    overlay.on("click", (e) => {
      if (applying) return;
      if (
        $(e.target).hasClass("cfm-theme-gallery-zoom-overlay") ||
        $(e.target).closest(".cfm-theme-gallery-zoom-close").length > 0 ||
        $(e.target).hasClass("cfm-theme-gallery-zoom-img")
      ) {
        close();
      }
    });

    bindTapOnce(overlay.find(".cfm-avatar-gallery-btn-apply"), async () => {
      applying = true;
      // 裁剪弹窗（ST 原生 .popup，z-index 9999）在不支持 <dialog>.showModal 的
      // 环境里会走 dialog-polyfill，此时它不是 top layer，会被本预览遮罩(100020) 盖住。
      // 申请期间把遮罩降到 9998，保证任何环境下裁剪窗都能显示在最上层。
      overlay.addClass("cfm-zoom-overlay-behind");
      try {
        const ok = await applyAvatarToTarget(kind, targetId, path);
        if (ok) {
          close();
        }
      } catch (err) {
        console?.warn?.("[CFM] 应用头像失败", err);
      } finally {
        applying = false;
        overlay.removeClass("cfm-zoom-overlay-behind");
      }
    });

    bindTapOnce(overlay.find(".cfm-avatar-gallery-btn-fav"), () => {
      if (addFavorite(kind, path)) {
        cfmToastr.success("已加入共享收藏库");
      } else {
        cfmToastr.info("该头像已在共享收藏库中");
      }
    });

    bindTapOnce(overlay.find(".cfm-avatar-gallery-btn-unfav"), () => {
      unfavorite(kind, targetId, path);
      cfmToastr.success("已取消收藏，头像保留在当前个人库");
      close();
      if (typeof refreshGrid === "function") refreshGrid();
    });

    bindTapOnce(overlay.find(".cfm-avatar-gallery-btn-del"), async () => {
      const confirmed = await cfmConfirm(
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

    // 导入：mine tab → 个人库；fav tab → 共享收藏库（支持多选）
    overlay.on("click touchend", ".cfm-avatar-gallery-import", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const files = await pickImageFiles();
      if (!files || files.length === 0) return;
      const imageFiles = files.filter(
        (f) => f && typeof f.type === "string" && f.type.startsWith("image/"),
      );
      if (imageFiles.length === 0) {
        cfmToastr.warning("没有可导入的有效图片文件");
        return;
      }
      const isMine = currentTab === "mine";
      const batchProgress = showBatchProgressOverlay(
        isMine ? "正在导入绑定头像" : "正在导入收藏头像",
        imageFiles.length,
      );
      let success = 0;
      const failed = [];
      let processed = 0;
      for (const file of imageFiles) {
        const filePath = isMine
          ? await importAvatar(kind, targetId, file)
          : await importFavoriteAvatar(kind, file);
        if (filePath) {
          success++;
        } else {
          failed.push(file.name);
        }
        processed++;
        batchProgress.update(processed);
      }
      if (success > 0) {
        const msg =
          (isMine ? "已导入绑定头像" : "已加入共享收藏库") + `：${success} 个`;
        if (failed.length > 0) {
          batchProgress.done(`${msg}，${failed.length} 个失败`);
          cfmToastr.warning(
            `${msg}，${failed.length} 个失败：${failed.join("、")}`,
          );
        } else {
          batchProgress.done(msg);
          cfmToastr.success(msg);
        }
        renderGrid();
      } else if (failed.length > 0) {
        batchProgress.done(`导入失败：${failed.length} 个`);
        cfmToastr.error(
          `导入失败：${failed.length} 个（${failed.join("、")}）`,
        );
      } else {
        batchProgress.remove();
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
    importAvatarBatch,
    importFavoriteAvatarBatch,
    deleteAvatar,
    addFavorite,
    unfavorite,
    deleteFavorite,
    getAvatarList,
    getFavList,
  };
}
