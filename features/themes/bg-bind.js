// 主题批量绑定背景层：承接 themes 资源域的批量绑定背景模式与执行，含背景选择器（文件夹过滤 + 缩略图）。
// 行为仿主题备注/重命名模式：点击按钮进入选择模式 → 逐行勾选 → 再次点击按钮弹出批量绑定弹窗 → 确认执行。

export function createThemeBgBindModeApi(deps) {
  const {
    $,
    cfmConfirm,
    cfmToastr,
    clearAllExclusiveModes,
    collectCurrentSelection,
    escapeHtml,
    getBackgroundDisplayName,
    getBackgroundNames,
    getBackgroundThumbnailUrl,
    getResChildFolders,
    getResFolderDisplayName,
    getResFolderPath,
    getResFolderTree,
    getResTopLevelFolders,
    getResourceGroups,
    getThemeBgBinding,
    getVisibleResourceIds,
    removeThemeBgBinding,
    renderThemesView,
    setThemeBgBinding,
    showPresetEditFolderFilterPanel,
    sortResFolders,
  } = deps;
  const state = deps.state;

  // ==================== 选择模式 ====================

  function enterThemeBgBindMode() {
    const prev = collectCurrentSelection();
    clearAllExclusiveModes();
    state.cfmThemeBgBindMode = true;
    state.cfmThemeBgBindSelected = prev || new Set();
    state.cfmThemeBgBindRangeMode = false;
    state.cfmThemeBgBindLastClicked = null;
    $("#cfm-theme-bg-bind-btn").addClass("cfm-edit-active");
    $("#cfm-theme-bg-bind-btn")
      .find("i")
      .removeClass("fa-link")
      .addClass("fa-check");
    $("#cfm-theme-bg-bind-btn").attr("title", "确认绑定背景");
    $(".cfm-popup").addClass("cfm-theme-bg-bind-mode");
    renderThemesView();
  }

  function exitThemeBgBindMode() {
    state.cfmThemeBgBindMode = false;
    state.cfmThemeBgBindSelected.clear();
    state.cfmThemeBgBindRangeMode = false;
    state.cfmThemeBgBindLastClicked = null;
    $("#cfm-theme-bg-bind-btn").removeClass("cfm-edit-active");
    $("#cfm-theme-bg-bind-btn")
      .find("i")
      .removeClass("fa-check")
      .addClass("fa-link");
    $("#cfm-theme-bg-bind-btn").attr("title", "批量绑定背景");
    $(".cfm-popup").removeClass("cfm-theme-bg-bind-mode");
    renderThemesView();
  }

  function toggleThemeBgBindItem(id, shiftKey) {
    if (
      (shiftKey || state.cfmThemeBgBindRangeMode) &&
      state.cfmThemeBgBindLastClicked
    ) {
      const visible = getVisibleResourceIds();
      const lastIdx = visible.indexOf(state.cfmThemeBgBindLastClicked);
      const curIdx = visible.indexOf(id);
      if (lastIdx !== -1 && curIdx !== -1) {
        const [start, end] =
          lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
        for (let i = start; i <= end; i++)
          state.cfmThemeBgBindSelected.add(visible[i]);
      }
    } else {
      if (state.cfmThemeBgBindSelected.has(id))
        state.cfmThemeBgBindSelected.delete(id);
      else state.cfmThemeBgBindSelected.add(id);
    }
    state.cfmThemeBgBindLastClicked = id;
  }

  function prependThemeBgBindToolbar(listContainer, renderFn) {
    if (!state.cfmThemeBgBindMode) return;
    const visible = getVisibleResourceIds();
    const allSel =
      visible.length > 0 &&
      visible.every((id) => state.cfmThemeBgBindSelected.has(id));
    const toolbar = $(
      `<div class="cfm-edit-toolbar"><button class="cfm-btn cfm-btn-sm cfm-edit-selectall"><i class="fa-solid fa-${allSel ? "square-minus" : "square-check"}"></i> ${allSel ? "全不选" : "全选"}</button><button class="cfm-btn cfm-btn-sm cfm-edit-range ${state.cfmThemeBgBindRangeMode ? "cfm-range-active" : ""}"><i class="fa-solid fa-arrow-down-short-wide"></i> 框选${state.cfmThemeBgBindRangeMode ? "(开)" : ""}</button><span class="cfm-edit-count">${state.cfmThemeBgBindSelected.size > 0 ? `已选 ${state.cfmThemeBgBindSelected.size} 项` : ""}</span><button class="cfm-btn cfm-btn-sm cfm-edit-cancel"><i class="fa-solid fa-xmark"></i> 取消</button></div>`,
    );
    toolbar.find(".cfm-edit-selectall").on("click touchend", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (allSel)
        visible.forEach((id) => state.cfmThemeBgBindSelected.delete(id));
      else visible.forEach((id) => state.cfmThemeBgBindSelected.add(id));
      renderFn();
    });
    toolbar.find(".cfm-edit-range").on("click touchend", (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.cfmThemeBgBindRangeMode = !state.cfmThemeBgBindRangeMode;
      if (state.cfmThemeBgBindRangeMode) state.cfmThemeBgBindLastClicked = null;
      renderFn();
    });
    toolbar.find(".cfm-edit-cancel").on("click touchend", (e) => {
      e.preventDefault();
      e.stopPropagation();
      exitThemeBgBindMode();
    });
    listContainer.prepend(toolbar);
  }

  // ==================== 背景选择器（文件夹过滤 + 缩略图网格单选） ====================

  // 背景文件夹树（供 showPresetEditFolderFilterPanel 使用，结构与 getResFolderTree 一致）
  function getBgFolderTree() {
    return getResFolderTree("backgrounds") || {};
  }

  // 某文件夹直接包含的背景数量（面板行尾计数）
  function getBgFolderCount(folderId) {
    if (folderId === "__ungrouped__") {
      const groups = getResourceGroups("backgrounds") || {};
      const tree = getBgFolderTree();
      let count = 0;
      for (const name of getBackgroundNames()) {
        const g = groups[name];
        if (!g || !tree[g]) count++;
      }
      return count;
    }
    const groups = getResourceGroups("backgrounds") || {};
    let count = 0;
    for (const [, fid] of Object.entries(groups)) {
      if (fid === folderId) count++;
    }
    return count;
  }

  // 返回背景 → 文件夹id 的映射（不含 __all__ / __ungrouped__）
  function getBgToFolderMap() {
    const groups = getResourceGroups("backgrounds") || {};
    const tree = getResFolderTree("backgrounds") || {};
    const map = {};
    for (const [bgfile, folderId] of Object.entries(groups)) {
      if (tree[folderId]) map[bgfile] = folderId;
    }
    return map;
  }

  /**
   * 打开背景选择器（弹窗内嵌，Promise 返回选中的 bgfile，取消返回 null）
   * 顶部过滤复用官方 showPresetEditFolderFilterPanel（含展开全部/收起全部/显示全部/箭头折叠树/计数/未归类，
   * UI 与酒馆原生文件夹过滤完全一致），但只作用于本选择器内的过滤，不触碰全局原生过滤状态。
   * @param {string|null} currentBg 当前已选背景（用于高亮）
   * @param {Function} onPick 选中某个背景时回调（可即时回填，uniform/individual 行复用）
   */
  function openBackgroundPicker(currentBg, onPick) {
    const bgFiles = getBackgroundNames();
    const folderMap = getBgToFolderMap();

    const overlay = $(`
      <div class="cfm-bg-picker-overlay">
        <div class="cfm-bg-picker">
          <div class="cfm-bg-picker-header">
            <span>选择背景</span>
            <button class="cfm-bg-picker-close" title="关闭"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="cfm-bg-picker-filter">
            <div class="cfm-nf-btn cfm-bg-picker-filter-btn menu_button menu_button_icon fa-solid fa-folder-tree" title="文件夹过滤"></div>
            <span class="cfm-bg-picker-filter-label">全部文件夹</span>
          </div>
          <div class="cfm-bg-picker-grid"></div>
          <div class="cfm-bg-picker-actions">
            <button class="cfm-btn cfm-edit-popup-cancel">取消</button>
            <button class="cfm-btn cfm-edit-popup-confirm">确认</button>
          </div>
        </div>
      </div>
    `);
    $("body").append(overlay);

    let selectedBg = currentBg || null;
    let currentFilter = "__all__";
    const filterBtn = overlay.find(".cfm-bg-picker-filter-btn");
    const filterLabel = overlay.find(".cfm-bg-picker-filter-label");

    function renderGrid() {
      const grid = overlay.find(".cfm-bg-picker-grid");
      const filtered = bgFiles.filter((bg) => {
        if (currentFilter === "__all__") return true;
        const f = folderMap[bg];
        if (currentFilter === "__ungrouped__") return !f;
        return f === currentFilter;
      });
      if (filtered.length === 0) {
        grid.html('<div class="cfm-bg-picker-empty">该文件夹下没有背景</div>');
        return;
      }
      grid.html(
        filtered
          .map((bg) => {
            const display = getBackgroundDisplayName(bg);
            const isSel = bg === selectedBg;
            return `<div class="cfm-bg-picker-item ${isSel ? "cfm-bg-picker-selected" : ""}" data-bg="${escapeHtml(bg)}" title="${escapeHtml(display)}">
              <div class="cfm-bg-picker-thumb" style="background-image:url('${getBackgroundThumbnailUrl(bg)}');"></div>
              <div class="cfm-bg-picker-name">${escapeHtml(display)}</div>
            </div>`;
          })
          .join(""),
      );
    }

    function updateFilterUi() {
      let label = "全部文件夹";
      if (currentFilter === "__ungrouped__") label = "未归类背景";
      else if (currentFilter !== "__all__")
        label = getResFolderDisplayName("backgrounds", currentFilter);
      filterLabel.text(label);
      filterBtn.toggleClass("cfm-nf-btn-active", currentFilter !== "__all__");
    }

    // 文件夹过滤面板：复用官方 showPresetEditFolderFilterPanel（含展开全部/收起全部/显示全部/箭头折叠树/计数/未归类，
    // UI 与酒馆原生文件夹过滤完全一致）。面板只影响本选择器内的过滤，不触碰全局原生过滤状态。
    // zIndex 100011 高于背景选择器 overlay(100010)，确保面板显示在最上层。
    filterBtn.on("click touchend", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showPresetEditFolderFilterPanel(filterBtn, {
        panelKey: "theme_bg_bind_picker",
        folderTree: getBgFolderTree(),
        getDisplayName: (fid) => getResFolderDisplayName("backgrounds", fid),
        getItemCount: getBgFolderCount,
        ungroupedLabel: "未归类背景",
        currentFilter: currentFilter === "__all__" ? "__all__" : currentFilter,
        onSelect: (fid) => {
          currentFilter = fid || "__all__";
          selectedBg = null;
          updateFilterUi();
          renderGrid();
        },
        zIndex: 100011,
      });
    });

    overlay.on("click", ".cfm-bg-picker-item", function () {
      selectedBg = $(this).data("bg");
      overlay.find(".cfm-bg-picker-item").removeClass("cfm-bg-picker-selected");
      $(this).addClass("cfm-bg-picker-selected");
      if (typeof onPick === "function") onPick(selectedBg);
    });

    function closeOverlay(result) {
      overlay.remove();
      resolvePromise(result);
    }

    let resolvePromise;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    overlay.find(".cfm-bg-picker-close").on("click touchend", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeOverlay(null);
    });
    overlay.find(".cfm-edit-popup-cancel").on("click touchend", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeOverlay(null);
    });
    overlay.find(".cfm-edit-popup-confirm").on("click touchend", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selectedBg) {
        cfmToastr.warning("请先选择一个背景");
        return;
      }
      closeOverlay(selectedBg);
    });
    overlay.find(".cfm-bg-picker-overlay").on("click", (e) => {
      if ($(e.target).hasClass("cfm-bg-picker-overlay")) closeOverlay(null);
    });

    renderGrid();
    return promise;
  }

  // ==================== 批量绑定弹窗 ====================

  async function showThemeBgBindPopup(themeNames) {
    if (!themeNames || themeNames.length === 0) return;
    const isBatch = themeNames.length > 1;
    const nameListHtml =
      themeNames.length <= 5
        ? themeNames
            .map(
              (n) => `<div class="cfm-edit-name-item">${escapeHtml(n)}</div>`,
            )
            .join("")
        : themeNames
            .slice(0, 5)
            .map(
              (n) => `<div class="cfm-edit-name-item">${escapeHtml(n)}</div>`,
            )
            .join("") +
          `<div class="cfm-edit-name-item cfm-edit-name-more">...等共 ${themeNames.length} 个主题</div>`;

    const popupHtml = `
      <div class="cfm-edit-popup-overlay">
        <div class="cfm-edit-popup">
          <div class="cfm-edit-popup-title">批量绑定背景</div>
          <div class="cfm-edit-popup-names">${nameListHtml}</div>
          <div class="cfm-edit-popup-field">
            <label>操作类型</label>
            <select class="cfm-edit-input" id="cfm-theme-bgbind-action">
              <option value="uniform">绑定同一背景</option>
              <option value="individual">逐个绑定背景</option>
              <option value="unbind">取消绑定背景</option>
            </select>
          </div>
          <div class="cfm-edit-popup-field" id="cfm-theme-bgbind-uniform-field">
            <label>选择背景</label>
            <div class="cfm-theme-bgbind-uniform-row">
              <div class="cfm-theme-bgbind-uniform-thumb" id="cfm-theme-bgbind-uniform-thumb" style="display:none;"></div>
              <span class="cfm-theme-bgbind-uniform-name" id="cfm-theme-bgbind-uniform-name" style="display:none;"></span>
              <button class="cfm-btn cfm-btn-sm cfm-theme-bgbind-pick-btn" id="cfm-theme-bgbind-uniform-pick">选择背景…</button>
            </div>
          </div>
          ${
            isBatch
              ? `<div class="cfm-rename-individual-field" id="cfm-theme-bgbind-individual-field">
            <label>逐个指定背景（点击选择背景）</label>
            <div class="cfm-rename-individual-list" id="cfm-theme-bgbind-individual-list">${themeNames
              .map((n) => {
                const cur = getThemeBgBinding(n);
                return `<div class="cfm-rename-individual-row" data-theme-name="${escapeHtml(n)}">
                  <span class="cfm-rename-old-name" title="${escapeHtml(n)}">${escapeHtml(n)}</span>
                  <span class="cfm-theme-bgbind-ind-thumb" style="display:none;"></span>
                  <span class="cfm-theme-bgbind-ind-name">${cur ? escapeHtml(getBackgroundDisplayName(cur)) : "未绑定"}</span>
                  <button class="cfm-btn cfm-btn-sm cfm-theme-bgbind-ind-pick">选择背景</button>
                </div>`;
              })
              .join("")}</div>
          </div>`
              : ""
          }
          <div class="cfm-edit-popup-field" id="cfm-theme-bgbind-unbind-field">
            <label>取消绑定背景</label>
            <div class="cfm-theme-bgbind-unbind-tip">将取消 ${themeNames.length} 个主题的背景绑定</div>
          </div>
          <div class="cfm-edit-popup-actions">
            <button class="cfm-btn cfm-edit-popup-cancel">取消</button>
            <button class="cfm-btn cfm-edit-popup-confirm">确认</button>
          </div>
        </div>
      </div>
    `;
    const overlay = $(popupHtml);
    $("body").append(overlay);

    // uniform 行：记录选择的 bgfile
    let uniformBg = null;
    const indBgs = {}; // themeName -> bgfile

    // individual 行回填：显示缩略图与背景名
    function setIndDisplay(row, bgfile) {
      const thumb = row.find(".cfm-theme-bgbind-ind-thumb");
      const name = row.find(".cfm-theme-bgbind-ind-name");
      if (bgfile) {
        thumb
          .show()
          .css(
            "background-image",
            `url('${getBackgroundThumbnailUrl(bgfile)}')`,
          );
        name.text(getBackgroundDisplayName(bgfile));
      } else {
        thumb.hide().css("background-image", "");
        name.text("未绑定");
      }
    }

    overlay
      .find("#cfm-theme-bgbind-uniform-pick")
      .on("click touchend", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const picked = await openBackgroundPicker(uniformBg, (bg) => {
          uniformBg = bg;
          const thumb = overlay.find("#cfm-theme-bgbind-uniform-thumb");
          const name = overlay.find("#cfm-theme-bgbind-uniform-name");
          thumb
            .show()
            .css("background-image", `url('${getBackgroundThumbnailUrl(bg)}')`);
          name.show().text(getBackgroundDisplayName(bg));
        });
        if (picked) {
          uniformBg = picked;
          const thumb = overlay.find("#cfm-theme-bgbind-uniform-thumb");
          const name = overlay.find("#cfm-theme-bgbind-uniform-name");
          thumb
            .show()
            .css(
              "background-image",
              `url('${getBackgroundThumbnailUrl(picked)}')`,
            );
          name.show().text(getBackgroundDisplayName(picked));
        }
      });

    // individual 行：点击"选择背景"按钮 → 打开背景选择器并回填
    overlay
      .find("#cfm-theme-bgbind-individual-list")
      .on("click touchend", ".cfm-theme-bgbind-ind-pick", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const row = $(e.currentTarget).closest(".cfm-rename-individual-row");
        const themeName = row.data("theme-name");
        const picked = await openBackgroundPicker(
          indBgs[themeName] || null,
          (bg) => {
            indBgs[themeName] = bg;
            setIndDisplay(row, bg);
          },
        );
        if (picked) {
          indBgs[themeName] = picked;
          setIndDisplay(row, picked);
        }
      });

    // 操作类型切换：互斥显示三类字段
    const actionSelect = overlay.find("#cfm-theme-bgbind-action");
    const uniformField = overlay.find("#cfm-theme-bgbind-uniform-field");
    const individualField = overlay.find("#cfm-theme-bgbind-individual-field");
    const unbindField = overlay.find("#cfm-theme-bgbind-unbind-field");
    function updateActionVisibility() {
      const v = actionSelect.val();
      uniformField.toggle(v === "uniform");
      individualField.toggle(v === "individual");
      unbindField.toggle(v === "unbind");
    }
    actionSelect.on("change", updateActionVisibility);
    updateActionVisibility();

    // 确认/取消：收集结果并 resolve
    return new Promise((resolve) => {
      overlay.find(".cfm-edit-popup-confirm").on("click touchend", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const mode = actionSelect.val();
        if (mode === "uniform") {
          if (!uniformBg) {
            cfmToastr.warning("请先选择一个背景");
            return;
          }
          overlay.remove();
          resolve({ mode, bgfile: uniformBg });
        } else if (mode === "individual") {
          const bindMap = {};
          let hasAny = false;
          for (const [t, bg] of Object.entries(indBgs)) {
            if (bg) {
              bindMap[t] = bg;
              hasAny = true;
            }
          }
          if (!hasAny) {
            cfmToastr.warning("请至少为一个主题选择背景");
            return;
          }
          overlay.remove();
          resolve({ mode, bindMap });
        } else {
          overlay.remove();
          resolve({ mode: "unbind" });
        }
      });
      overlay.find(".cfm-edit-popup-cancel").on("click touchend", (e) => {
        e.preventDefault();
        e.stopPropagation();
        overlay.remove();
        resolve(null);
      });
      overlay.find(".cfm-edit-popup-overlay").on("click", (e) => {
        if ($(e.target).hasClass("cfm-edit-popup-overlay")) {
          overlay.remove();
          resolve(null);
        }
      });
    });
  }

  // ==================== 执行 ====================

  async function executeThemeBgBind(names) {
    if (!names || names.length === 0) return;
    const result = await showThemeBgBindPopup(names);
    if (!result) return;
    let applied = 0;
    if (result.mode === "uniform") {
      for (const name of names) {
        setThemeBgBinding(name, result.bgfile);
        applied++;
      }
      cfmToastr.success(
        `已为 ${applied} 个主题绑定同一背景「${getBackgroundDisplayName(result.bgfile)}」`,
      );
    } else if (result.mode === "individual") {
      for (const [name, bg] of Object.entries(result.bindMap)) {
        setThemeBgBinding(name, bg);
        applied++;
      }
      cfmToastr.success(`已为 ${applied} 个主题逐个绑定背景`);
    } else if (result.mode === "unbind") {
      for (const name of names) {
        removeThemeBgBinding(name);
        applied++;
      }
      cfmToastr.info(`已取消 ${applied} 个主题的背景绑定`);
    }
    renderThemesView();
  }

  return {
    enterThemeBgBindMode,
    exitThemeBgBindMode,
    toggleThemeBgBindItem,
    prependThemeBgBindToolbar,
    showThemeBgBindPopup,
    executeThemeBgBind,
  };
}
