// 主题缩略图预览层：承接美化页"预览"按钮打开的集中预览弹窗（文件夹过滤 + 竖版缩略图网格 + 放大预览 + 缩略图导入/替换）。
// 行为：有缩略图的美化显示竖版缩略图（可点击放大，放大弹窗底部含「应用美化」「替换缩略图」），无缩略图的美化排最底部仅显示名字 + 右侧小"+"按钮。

export function createThemePreviewApi(deps) {
  const {
    $,
    cfmToastr,
    document,
    escapeHtml,
    getResFolderDisplayName,
    getResFolderTree,
    getResourceGroups,
    getThemeNames,
    getThemeThumbnail,
    setThemeThumbnail,
    showPresetEditFolderFilterPanel,
    applyTheme,
  } = deps;

  // ==================== 主题文件夹映射 ====================

  // 主题文件夹树（供 showPresetEditFolderFilterPanel 使用，结构与 getResFolderTree 一致）
  function getThemeFolderTree() {
    return getResFolderTree("themes") || {};
  }

  // 某文件夹直接包含的主题数量（面板行尾计数）
  function getThemeFolderCount(folderId) {
    if (folderId === "__ungrouped__") {
      const groups = getResourceGroups("themes") || {};
      const tree = getThemeFolderTree();
      let count = 0;
      for (const name of getThemeNames()) {
        const g = groups[name];
        if (!g || !tree[g]) count++;
      }
      return count;
    }
    const groups = getResourceGroups("themes") || {};
    let count = 0;
    for (const [, fid] of Object.entries(groups)) {
      if (fid === folderId) count++;
    }
    return count;
  }

  // 返回主题名 → 文件夹id 的映射（不含 __all__ / __ungrouped__）
  function getThemeToFolderMap() {
    const groups = getResourceGroups("themes") || {};
    const tree = getThemeFolderTree();
    const map = {};
    for (const [name, folderId] of Object.entries(groups)) {
      if (tree[folderId]) map[name] = folderId;
    }
    return map;
  }

  // ==================== 缩略图导入 ====================

  // 打开文件选择器导入缩略图（FileReader → dataURL），成功后回调
  function importThumbnailImage(name, onDone) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    document.body.appendChild(input);
    const cleanup = () => {
      input.remove();
    };
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) {
        cleanup();
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        if (dataUrl) {
          setThemeThumbnail(name, dataUrl);
          cfmToastr.success(`已设置主题「${name}」的缩略图`);
        }
        cleanup();
        if (typeof onDone === "function") onDone(dataUrl);
      };
      reader.onerror = () => {
        cfmToastr.error("读取图片失败");
        cleanup();
      };
      reader.readAsDataURL(file);
    });
    input.click();
  }

  // ==================== 放大预览弹窗 ====================

  // 点击有缩略图的美化 → 放大预览：右上角关闭、点击遮罩/图片关闭、底部「应用美化」「替换缩略图」
  function openZoomPreview(name, dataUrl, refreshGrid) {
    const overlay = $(`
      <div class="cfm-theme-gallery-zoom-overlay">
        <div class="cfm-theme-gallery-zoom-box">
          <button class="cfm-theme-gallery-zoom-close" title="关闭"><i class="fa-solid fa-xmark"></i></button>
          <img class="cfm-theme-gallery-zoom-img" src="${dataUrl}" alt="主题缩略图预览">
          <div class="cfm-theme-gallery-zoom-actions">
            <button class="cfm-btn cfm-theme-gallery-zoom-apply"><i class="fa-solid fa-check"></i> 应用美化</button>
            <button class="cfm-btn cfm-theme-gallery-zoom-replace"><i class="fa-solid fa-image"></i> 替换缩略图</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(overlay[0]);

    const close = () => {
      overlay.remove();
    };

    overlay.on("click", (e) => {
      // 点击遮罩或关闭按钮或图片 → 关闭
      if (
        $(e.target).hasClass("cfm-theme-gallery-zoom-overlay") ||
        $(e.target).closest(".cfm-theme-gallery-zoom-close").length > 0 ||
        $(e.target).hasClass("cfm-theme-gallery-zoom-img")
      ) {
        close();
      }
    });

    overlay.find(".cfm-theme-gallery-zoom-apply").on("click touchend", (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyTheme(name);
      cfmToastr.success(`已应用美化「${name}」`);
    });

    overlay
      .find(".cfm-theme-gallery-zoom-replace")
      .on("click touchend", (e) => {
        e.preventDefault();
        e.stopPropagation();
        importThumbnailImage(name, (newDataUrl) => {
          if (!newDataUrl) return;
          overlay.find(".cfm-theme-gallery-zoom-img").attr("src", newDataUrl);
          if (typeof refreshGrid === "function") refreshGrid();
        });
      });
  }

  // ==================== 集中预览弹窗 ====================

  function openThemePreview() {
    const themeNames = getThemeNames();
    const folderMap = getThemeToFolderMap();

    const overlay = $(`
        <div class="cfm-theme-gallery-overlay">
        <div class="cfm-theme-gallery">
          <div class="cfm-theme-gallery-header">
            <span>美化缩略图预览</span>
            <button class="cfm-theme-gallery-close" title="关闭"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="cfm-theme-gallery-filter">
            <div class="cfm-nf-btn cfm-theme-gallery-filter-btn menu_button menu_button_icon fa-solid fa-folder-tree" title="文件夹过滤"></div>
            <span class="cfm-theme-gallery-filter-label">全部文件夹</span>
          </div>
          <div class="cfm-theme-gallery-grid"></div>
        </div>
      </div>
    `);
    document.body.appendChild(overlay[0]);

    let currentFilter = "__all__";
    const filterBtn = overlay.find(".cfm-theme-gallery-filter-btn");
    const filterLabel = overlay.find(".cfm-theme-gallery-filter-label");

    function renderGrid() {
      const grid = overlay.find(".cfm-theme-gallery-grid");
      const filtered = themeNames.filter((name) => {
        if (currentFilter === "__all__") return true;
        const f = folderMap[name];
        if (currentFilter === "__ungrouped__") return !f;
        return f === currentFilter;
      });

      const withThumb = [];
      const withoutThumb = [];
      for (const name of filtered) {
        const dataUrl = getThemeThumbnail(name);
        if (dataUrl) withThumb.push({ name, dataUrl });
        else withoutThumb.push(name);
      }

      if (filtered.length === 0) {
        grid.html(
          '<div class="cfm-theme-gallery-empty">该文件夹下没有主题</div>',
        );
        return;
      }

      const thumbHtml = withThumb
        .map(
          ({
            name,
            dataUrl,
          }) => `<div class="cfm-theme-gallery-item" data-name="${escapeHtml(name)}" title="${escapeHtml(name)}">
            <div class="cfm-theme-gallery-thumb" style="background-image:url('${dataUrl}');"></div>
            <div class="cfm-theme-gallery-name">${escapeHtml(name)}</div>
          </div>`,
        )
        .join("");

      const plainHtml = withoutThumb
        .map(
          (
            name,
          ) => `<div class="cfm-theme-gallery-plain" data-name="${escapeHtml(name)}" title="${escapeHtml(name)}">
            <span class="cfm-theme-gallery-plain-name">${escapeHtml(name)}</span>
            <button class="cfm-theme-gallery-plain-add" title="添加缩略图"><i class="fa-solid fa-plus"></i></button>
          </div>`,
        )
        .join("");

      const sectionHtml =
        (withThumb.length > 0
          ? `<div class="cfm-theme-gallery-section">${thumbHtml}</div>`
          : "") +
        (withoutThumb.length > 0
          ? `<div class="cfm-theme-gallery-section">${plainHtml}</div>`
          : "");

      grid.html(sectionHtml);
    }

    function updateFilterUi() {
      let label = "全部文件夹";
      if (currentFilter === "__ungrouped__") label = "未归类主题";
      else if (currentFilter !== "__all__")
        label = getResFolderDisplayName("themes", currentFilter);
      filterLabel.text(label);
      filterBtn.toggleClass("cfm-nf-btn-active", currentFilter !== "__all__");
    }

    // 文件夹过滤面板：复用官方 showPresetEditFolderFilterPanel（UI 与酒馆原生文件夹过滤完全一致）
    // zIndex 100011 高于预览弹窗 overlay(100010)，确保面板显示在最上层。
    filterBtn.on("click touchend", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showPresetEditFolderFilterPanel(filterBtn, {
        panelKey: "theme_preview_picker",
        folderTree: getThemeFolderTree(),
        getDisplayName: (fid) => getResFolderDisplayName("themes", fid),
        getItemCount: getThemeFolderCount,
        ungroupedLabel: "未归类主题",
        currentFilter: currentFilter === "__all__" ? "__all__" : currentFilter,
        onSelect: (fid) => {
          currentFilter = fid || "__all__";
          updateFilterUi();
          renderGrid();
        },
        zIndex: 100011,
      });
    });

    // 点击有缩略图的美化 → 放大预览
    overlay.on("click", ".cfm-theme-gallery-item", function () {
      const name = $(this).data("name");
      const dataUrl = getThemeThumbnail(name);
      if (dataUrl) openZoomPreview(name, dataUrl, renderGrid);
    });

    // 无缩略图行的"+"按钮 → 导入缩略图（首次添加入口）
    overlay.on("click touchend", ".cfm-theme-gallery-plain-add", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const name = $(e.currentTarget)
        .closest(".cfm-theme-gallery-plain")
        .data("name");
      importThumbnailImage(name, renderGrid);
    });

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
    openThemePreview,
  };
}
