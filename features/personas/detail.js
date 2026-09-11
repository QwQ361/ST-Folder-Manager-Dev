// Persona 详情层：承接 User/Persona 详情字段编辑、头像替换、绑定操作入口与详情子面板渲染。

export function createPersonaDetailApiCore(deps) {
  async function showPersonaDetailFieldPopup(persona, field, options = {}) {
    const map = {
      name: {
        title: "编辑User名称",
        label: "名称",
        placeholder: "输入User名称",
        rows: 1,
      },
      title: {
        title: "编辑User标题",
        label: "标题",
        placeholder: "输入标题，留空则清空",
        rows: 1,
      },
      description: {
        title: "编辑User具体设定",
        label: "具体设定",
        placeholder: "输入具体设定，留空则清空",
        rows: 8,
      },
    };
    const meta = map[field];
    if (!meta || !persona) return null;

    const entry = deps.ensurePersonaDescriptionEntry(persona.avatarId);
    const currentValue = String(
      field === "name" ? persona?.name || "" : entry?.[field] || "",
    );
    const inputHtml =
      meta.rows > 1
        ? `<textarea class="cfm-edit-input" id="cfm-persona-detail-input" rows="${meta.rows}" placeholder="${deps.escapeHtml(meta.placeholder)}">${deps.escapeHtml(currentValue)}</textarea>`
        : `<input type="text" class="cfm-edit-input" id="cfm-persona-detail-input" value="${deps.escapeHtml(currentValue)}" placeholder="${deps.escapeHtml(meta.placeholder)}">`;

    const canMaximize = meta.rows > 1;
    const overlay = deps.$(`
      <div class="cfm-edit-popup-overlay">
        <div class="cfm-edit-popup ${canMaximize ? "cfm-edit-popup-expandable" : ""}">
          <div class="cfm-edit-popup-title">${meta.title}</div>
          <div class="cfm-edit-popup-names"><div class="cfm-edit-name-item">${deps.escapeHtml(persona.name || persona.avatarId)}</div></div>
          <div class="cfm-edit-popup-field">
            ${
              canMaximize
                ? `<div class="cfm-edit-popup-field-header">
            <label for="cfm-persona-detail-input">${meta.label}</label>
            <button type="button" class="cfm-edit-popup-maximize" title="最大化编辑窗口" aria-pressed="false">
              <i class="fa-solid fa-expand"></i>
            </button>
            <button type="button" class="cfm-edit-popup-snapshot" title="打开副本列表">
              <i class="fa-solid fa-copy"></i>
            </button>
          </div>`
                : `<label for="cfm-persona-detail-input">${meta.label}</label>`
            }
            ${inputHtml}
          </div>
          <div class="cfm-edit-popup-actions">
            <button class="cfm-btn cfm-edit-popup-cancel">取消</button>
            ${currentValue ? '<button class="cfm-btn cfm-edit-popup-clear">清空</button>' : ""}
            ${
              canMaximize
                ? `<button class="cfm-btn cfm-edit-popup-save-snapshot">设为副本</button>
            <button class="cfm-btn cfm-edit-popup-update-snapshot" style="display:none;">更新</button>`
                : ""
            }
            <button class="cfm-btn cfm-edit-popup-confirm">确认</button>
          </div>
        </div>
      </div>
    `);
    deps.$("body").append(overlay);
    const popup = overlay.find(".cfm-edit-popup");
    const input = overlay.find("#cfm-persona-detail-input");
    const maximizeBtn = overlay.find(".cfm-edit-popup-maximize");
    const mobileMaximizedLock = {
      cleanup: null,
      rect: null,
    };
    const clearMobileMaximizedLock = () => {
      if (typeof mobileMaximizedLock.cleanup === "function") {
        mobileMaximizedLock.cleanup();
      }
      mobileMaximizedLock.cleanup = null;
      mobileMaximizedLock.rect = null;
      popup.css({
        position: "",
        top: "",
        left: "",
        right: "",
        bottom: "",
        width: "",
        height: "",
        minHeight: "",
        maxHeight: "",
        transform: "",
        margin: "",
        zIndex: "",
      });
    };
    const updateMaximizeButton = () => {
      if (!maximizeBtn.length) return;
      const isMaximized = popup.hasClass("cfm-edit-popup-maximized");
      maximizeBtn.attr(
        "title",
        isMaximized ? "还原编辑窗口" : "最大化编辑窗口",
      );
      maximizeBtn.attr("aria-pressed", isMaximized ? "true" : "false");
      maximizeBtn
        .find("i")
        .toggleClass("fa-expand", !isMaximized)
        .toggleClass("fa-compress", isMaximized);
    };
    const isMobileViewport = () =>
      deps.window.matchMedia?.("(max-width: 768px)")?.matches ||
      deps.window.innerWidth <= 768;
    const settleMobileViewport = (callback) => {
      const visualViewport = deps.window.visualViewport;
      let settled = false;
      let settleTimer = null;
      let fallbackTimer = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (settleTimer) deps.clearTimeout(settleTimer);
        if (fallbackTimer) deps.clearTimeout(fallbackTimer);
        visualViewport?.removeEventListener("resize", handleViewportChange);
        visualViewport?.removeEventListener("scroll", handleViewportChange);
        callback();
      };
      const scheduleFinish = () => {
        if (settleTimer) deps.clearTimeout(settleTimer);
        settleTimer = deps.setTimeout(finish, 120);
      };
      const handleViewportChange = () => {
        scheduleFinish();
      };
      scheduleFinish();
      fallbackTimer = deps.setTimeout(finish, 420);
      visualViewport?.addEventListener("resize", handleViewportChange);
      visualViewport?.addEventListener("scroll", handleViewportChange);
    };
    const syncMobileMaximizedLock = () => {
      clearMobileMaximizedLock();
      if (!canMaximize || !isMobileViewport()) return;
      const popupNode = popup[0];
      if (!popupNode) return;
      const visualViewport = deps.window.visualViewport;
      const applyLockedRect = () => {
        if (!popupNode.isConnected || !isMobileViewport()) {
          return;
        }
        const nextRect = popupNode.getBoundingClientRect();
        const isMaximized = popup.hasClass("cfm-edit-popup-maximized");
        const viewportWidth = Math.max(
          deps.document.documentElement?.clientWidth || 0,
          deps.window.innerWidth || 0,
          visualViewport?.width || 0,
          nextRect.width,
        );
        const physicalViewportHeight = Math.round(
          (deps.window.screen?.availHeight || deps.window.screen?.height || 0) /
            Math.max(deps.window.devicePixelRatio || 1, 1),
        );
        const viewportHeight = Math.max(
          deps.document.documentElement?.clientHeight || 0,
          deps.window.innerHeight || 0,
          physicalViewportHeight || 0,
          visualViewport?.height || 0,
          nextRect.height,
        );
        const safeWidth = Math.min(
          Math.max(nextRect.width, 280),
          Math.max(0, viewportWidth - 24),
        );
        const safeHeight = isMaximized
          ? Math.max(
              mobileMaximizedLock.rect?.height || 0,
              nextRect.height,
              Math.max(0, viewportHeight - 80),
            )
          : Math.max(mobileMaximizedLock.rect?.height || 0, nextRect.height);
        mobileMaximizedLock.rect = {
          top: Math.max(12, mobileMaximizedLock.rect?.top ?? nextRect.top),
          width: safeWidth,
          height: safeHeight,
        };
        popup.css({
          position: "fixed",
          top: `${mobileMaximizedLock.rect.top}px`,
          left: "50%",
          right: "auto",
          bottom: "auto",
          width: `${mobileMaximizedLock.rect.width}px`,
          height: `${mobileMaximizedLock.rect.height}px`,
          minHeight: `${mobileMaximizedLock.rect.height}px`,
          maxHeight: `${mobileMaximizedLock.rect.height}px`,
          transform: "translateX(-50%)",
          margin: "0",
          zIndex: "100001",
        });
      };
      applyLockedRect();
      deps.requestAnimationFrame(applyLockedRect);
      const handleViewportChange = () => {
        deps.requestAnimationFrame(applyLockedRect);
      };
      const handleOrientationChange = () => {
        mobileMaximizedLock.rect = null;
        clearMobileMaximizedLock();
        deps.requestAnimationFrame(() => {
          if (!popupNode.isConnected) return;
          syncMobileMaximizedLock();
        });
      };
      visualViewport?.addEventListener("resize", handleViewportChange);
      visualViewport?.addEventListener("scroll", handleViewportChange);
      deps.window.addEventListener(
        "orientationchange",
        handleOrientationChange,
      );
      mobileMaximizedLock.cleanup = () => {
        visualViewport?.removeEventListener("resize", handleViewportChange);
        visualViewport?.removeEventListener("scroll", handleViewportChange);
        deps.window.removeEventListener(
          "orientationchange",
          handleOrientationChange,
        );
      };
    };
    const caretIndex = Number.isFinite(options?.caretIndex)
      ? Math.max(0, Math.trunc(options.caretIndex))
      : null;
    const node = input[0];
    updateMaximizeButton();
    if (canMaximize) {
      syncMobileMaximizedLock();
    }
    input.trigger("focus");
    if (node && typeof node.selectionStart === "number") {
      const nextCaret = Math.min(
        caretIndex === null ? node.value.length : caretIndex,
        node.value.length,
      );
      node.selectionStart = node.selectionEnd = nextCaret;
      if (input.is("textarea") && caretIndex !== null) {
        deps.setTimeout(() => {
          if (!node.isConnected) return;
          deps.revealTextareaCaret(node, nextCaret);
          deps.flashTextareaCaretSelection(node, nextCaret);
        }, 0);
      }
    }

    return new Promise((resolve) => {
      let overlayPressStarted = false;
      const openedAt = Date.now();
      const overlayCloseGuardMs = 650;
      const close = (result) => {
        clearMobileMaximizedLock();
        overlay.remove();
        resolve(result);
      };

      // ===== 副本功能（仅 description 多行字段启用） =====
      const snapshotBtn = overlay.find(".cfm-edit-popup-snapshot");
      const saveSnapshotBtn = overlay.find(".cfm-edit-popup-save-snapshot");
      const updateSnapshotBtn = overlay.find(".cfm-edit-popup-update-snapshot");
      let appliedSnapId = null; // 本次弹窗内「应用」的副本 id
      let snapshotPanelOverlay = null;

      const getSnapshotApi = () => deps.personaSnapshotApi || null;
      const getCurrentText = () => String(input.val() || "");

      const readSnapshotContent = (snapId) => {
        const api = getSnapshotApi();
        if (!api || !snapId) return null;
        return api.applyPersonaSnapshot(persona.avatarId, snapId);
      };

      const getAppliedSnapshotNote = () => {
        const api = getSnapshotApi();
        if (!api || !appliedSnapId) return null;
        const list = api.getPersonaSnapshots(persona.avatarId);
        const item = list?.items?.[appliedSnapId];
        return item?.note || null;
      };

      const updateSnapshotBtnState = () => {
        if (!updateSnapshotBtn.length) return;
        if (!appliedSnapId) {
          updateSnapshotBtn.hide();
          return;
        }
        const appliedContent = readSnapshotContent(appliedSnapId);
        const current = getCurrentText();
        if (appliedContent !== null && current !== appliedContent) {
          const note = getAppliedSnapshotNote();
          updateSnapshotBtn
            .attr("title", note ? `更新副本「${note}」` : "更新副本")
            .show();
        } else {
          updateSnapshotBtn.hide();
        }
      };

      const openSnapshotNotePopup = (defaultNote) =>
        new Promise((noteResolve) => {
          const noteOverlay = deps.$(`
            <div class="cfm-edit-popup-overlay" id="cfm-persona-snapshot-note-overlay">
              <div class="cfm-edit-popup">
                <div class="cfm-edit-popup-title">副本备注</div>
                <div class="cfm-edit-popup-field">
                  <label for="cfm-persona-snapshot-note-input">备注名</label>
                  <input type="text" class="cfm-edit-input" id="cfm-persona-snapshot-note-input" value="${deps.escapeHtml(defaultNote || "")}" placeholder="为这个副本起一个备注名">
                </div>
                <div class="cfm-edit-popup-actions">
                  <button class="cfm-btn cfm-edit-popup-cancel">取消</button>
                  <button class="cfm-btn cfm-edit-popup-confirm">确认</button>
                </div>
              </div>
            </div>
          `);
          deps.$("body").append(noteOverlay);
          const noteInput = noteOverlay.find(
            "#cfm-persona-snapshot-note-input",
          );
          const finish = (value) => {
            noteOverlay.remove();
            noteResolve(value);
          };
          noteInput.trigger("focus");
          noteOverlay
            .find(".cfm-edit-popup-cancel")
            .on("click", () => finish(null));
          noteOverlay.find(".cfm-edit-popup-confirm").on("click", () => {
            finish(String(noteInput.val() || "").trim());
          });
          noteOverlay.on("click", (e) => {
            if (deps.$(e.target).hasClass("cfm-edit-popup-overlay"))
              finish(null);
          });
          noteInput.on("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              noteOverlay.find(".cfm-edit-popup-confirm").trigger("click");
            }
            if (e.key === "Escape") {
              e.preventDefault();
              finish(null);
            }
          });
        });

      const doSaveSnapshot = async (snapId, note, content) => {
        const api = getSnapshotApi();
        if (!api) {
          deps.cfmToastr.error("副本功能不可用");
          return false;
        }
        api.savePersonaSnapshot(persona.avatarId, snapId, note, content);
        deps.saveSettingsDebounced();
        return true;
      };

      const renderSnapshotPanel = () => {
        const api = getSnapshotApi();
        if (!snapshotPanelOverlay || !snapshotPanelOverlay[0]?.isConnected)
          return;
        const list = api ? api.getPersonaSnapshots(persona.avatarId) : null;
        const order = list?.order || [];
        const items = list?.items || {};
        const rowsHtml = order.length
          ? order
              .map((id) => {
                const item = items[id] || {};
                const note = item.note || "未命名副本";
                const active = id === appliedSnapId;
                const pinned = order[0] === id;
                return `
              <div class="cfm-snapshot-row ${active ? "cfm-snapshot-row-active" : ""}" data-snap-id="${deps.escapeHtml(id)}">
                <span class="cfm-snapshot-note" title="${deps.escapeHtml(note)}">${deps.escapeHtml(note)}</span>
                ${active ? '<span class="cfm-snapshot-active-mark">已应用</span>' : ""}
                <div class="cfm-snapshot-actions">
                  <button type="button" class="cfm-snapshot-pin ${pinned ? "cfm-snapshot-pin-active" : ""}" title="置顶"><i class="fa-solid fa-thumbtack"></i></button>
                  <button type="button" class="cfm-snapshot-apply" title="应用"><i class="fa-solid fa-play"></i></button>
                  <button type="button" class="cfm-snapshot-del" title="删除"><i class="fa-solid fa-trash"></i></button>
                </div>
              </div>
            `;
              })
              .join("")
          : '<div class="cfm-snapshot-empty">暂无副本</div>';
        const listEl = snapshotPanelOverlay.find(".cfm-snapshot-list");
        listEl.html(rowsHtml);
      };

      const openSnapshotPanel = () => {
        if (snapshotPanelOverlay && snapshotPanelOverlay[0]?.isConnected) {
          renderSnapshotPanel();
          return;
        }
        snapshotPanelOverlay = deps.$(`
          <div class="cfm-edit-popup-overlay" id="cfm-persona-snapshot-panel-overlay">
            <div class="cfm-edit-popup cfm-snapshot-panel">
              <div class="cfm-edit-popup-title"><i class="fa-solid fa-copy" style="margin-right:6px;"></i>具体设定副本</div>
              <div class="cfm-snapshot-list"></div>
              <div class="cfm-edit-popup-actions">
                <button class="cfm-btn cfm-edit-popup-cancel">关闭</button>
              </div>
            </div>
          </div>
        `);
        deps.$("body").append(snapshotPanelOverlay);
        snapshotPanelOverlay.find(".cfm-edit-popup-cancel").on("click", () => {
          snapshotPanelOverlay.remove();
          snapshotPanelOverlay = null;
        });
        snapshotPanelOverlay.on("click", (e) => {
          if (deps.$(e.target).hasClass("cfm-edit-popup-overlay")) {
            snapshotPanelOverlay.remove();
            snapshotPanelOverlay = null;
          }
        });

        snapshotPanelOverlay.on("click", ".cfm-snapshot-pin", function (e) {
          e.preventDefault();
          e.stopPropagation();
          const api = getSnapshotApi();
          const id = deps.$(this).closest(".cfm-snapshot-row").data("snapId");
          if (!api || !id) return;
          api.pinPersonaSnapshot(persona.avatarId, id);
          deps.saveSettingsDebounced();
          renderSnapshotPanel();
        });

        snapshotPanelOverlay.on("click", ".cfm-snapshot-apply", function (e) {
          e.preventDefault();
          e.stopPropagation();
          const api = getSnapshotApi();
          const id = deps.$(this).closest(".cfm-snapshot-row").data("snapId");
          if (!api || !id) return;
          const content = api.applyPersonaSnapshot(persona.avatarId, id);
          if (content === null) return;
          input.val(content);
          appliedSnapId = id;
          updateSnapshotBtnState();
          const note = api.getPersonaSnapshots(persona.avatarId)?.items?.[id]
            ?.note;
          deps.cfmToastr.success(note ? `已应用副本「${note}」` : "已应用副本");
          snapshotPanelOverlay.remove();
          snapshotPanelOverlay = null;
          input.trigger("focus");
        });

        snapshotPanelOverlay.on("click", ".cfm-snapshot-del", function (e) {
          e.preventDefault();
          e.stopPropagation();
          const api = getSnapshotApi();
          const id = deps.$(this).closest(".cfm-snapshot-row").data("snapId");
          if (!api || !id) return;
          const note =
            api.getPersonaSnapshots(persona.avatarId)?.items?.[id]?.note ||
            "未命名副本";
          if (!deps.cfmConfirm(`确认删除副本「${note}」吗？`)) return;
          api.deletePersonaSnapshot(persona.avatarId, id);
          deps.saveSettingsDebounced();
          if (appliedSnapId === id) appliedSnapId = null;
          updateSnapshotBtnState();
          renderSnapshotPanel();
        });

        renderSnapshotPanel();
      };

      if (snapshotBtn.length) {
        snapshotBtn.on("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          openSnapshotPanel();
        });
      }
      if (saveSnapshotBtn.length) {
        saveSnapshotBtn.on("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const content = getCurrentText().trim();
          if (!content) {
            deps.cfmToastr.warning("内容为空，无法设为副本");
            return;
          }
          const note = await openSnapshotNotePopup("");
          if (note === null) return;
          if (!note) {
            deps.cfmToastr.warning("请输入副本备注名");
            return;
          }
          const api = getSnapshotApi();
          if (!api) return;
          const snapId = api.createPersonaSnapshotId
            ? api.createPersonaSnapshotId()
            : "snap_" + Date.now().toString(36);
          const ok = await doSaveSnapshot(snapId, note, content);
          if (!ok) return;
          deps.cfmToastr.success(`已设为副本「${note}」`);
        });
      }
      if (updateSnapshotBtn.length) {
        updateSnapshotBtn.on("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!appliedSnapId) return;
          const content = getCurrentText().trim();
          if (!content) {
            deps.cfmToastr.warning("内容为空，无法更新副本");
            return;
          }
          const note = getAppliedSnapshotNote() || "未命名副本";
          if (!deps.cfmConfirm(`确认更新副本「${note}」吗？`)) return;
          const ok = await doSaveSnapshot(appliedSnapId, note, content);
          if (!ok) return;
          deps.cfmToastr.success(`已更新副本「${note}」`);
          updateSnapshotBtnState();
        });
      }
      input.on("input", () => {
        updateSnapshotBtnState();
      });
      maximizeBtn.on("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const willMaximize = !popup.hasClass("cfm-edit-popup-maximized");
        const shouldResetKeyboardViewport =
          willMaximize &&
          isMobileViewport() &&
          deps.document.activeElement === node &&
          !!deps.window.visualViewport &&
          deps.window.visualViewport.height < deps.window.innerHeight - 80;
        const restoreCaret = (deferForMobileLock = false) => {
          const runRestore = () => {
            if (!overlay[0]?.isConnected) return;
            input.trigger("focus");
            if (
              node &&
              input.is("textarea") &&
              typeof node.selectionStart === "number"
            ) {
              const nextCaret = node.selectionStart;
              deps.setTimeout(() => {
                if (!node.isConnected) return;
                deps.revealTextareaCaret(node, nextCaret);
              }, 0);
            }
          };
          if (!deferForMobileLock) {
            runRestore();
            return;
          }
          deps.requestAnimationFrame(() => {
            deps.requestAnimationFrame(() => {
              runRestore();
            });
          });
        };
        const applyToggle = () => {
          popup.toggleClass("cfm-edit-popup-maximized");
          updateMaximizeButton();
          const shouldDeferFocusRestore =
            popup.hasClass("cfm-edit-popup-maximized") &&
            canMaximize &&
            isMobileViewport();
          if (canMaximize && isMobileViewport()) {
            deps.requestAnimationFrame(() => syncMobileMaximizedLock());
          } else {
            clearMobileMaximizedLock();
          }
          restoreCaret(shouldDeferFocusRestore);
        };
        if (!shouldResetKeyboardViewport) {
          applyToggle();
          return;
        }
        if (node && typeof node.selectionStart === "number") {
          try {
            node.setSelectionRange(node.selectionStart, node.selectionEnd);
          } catch {}
        }
        input.trigger("blur");
        settleMobileViewport(() => {
          if (!overlay[0]?.isConnected) return;
          applyToggle();
        });
      });
      overlay.find(".cfm-edit-popup-cancel").on("click", () => close(null));
      overlay.on("mousedown touchstart", (e) => {
        const isOverlayTarget = deps
          .$(e.target)
          .hasClass("cfm-edit-popup-overlay");
        const elapsed = Date.now() - openedAt;
        const isPrimaryPress =
          e.type === "touchstart" ||
          typeof e.button !== "number" ||
          e.button === 0;
        overlayPressStarted =
          isOverlayTarget && elapsed >= overlayCloseGuardMs && isPrimaryPress;
      });
      overlay.on("click", (e) => {
        const clickedOverlay = deps
          .$(e.target)
          .hasClass("cfm-edit-popup-overlay");
        const elapsed = Date.now() - openedAt;
        if (
          clickedOverlay &&
          overlayPressStarted &&
          elapsed >= overlayCloseGuardMs
        )
          close(null);
        overlayPressStarted = false;
      });
      overlay.find(".cfm-edit-popup-clear").on("click", () => {
        if (!deps.cfmConfirm(`确认清空${meta.label}吗？`)) return;
        close("");
      });
      overlay.find(".cfm-edit-popup-confirm").on("click", () => {
        close(String(input.val() || "").trim());
      });
      input.on("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close(null);
        }
        if (e.key === "Enter" && !input.is("textarea")) {
          e.preventDefault();
          overlay.find(".cfm-edit-popup-confirm").trigger("click");
        }
      });
    });
  }

  async function editPersonaDetailField(persona, field, options = {}) {
    const value = await showPersonaDetailFieldPopup(persona, field, options);
    if (value === null) return;

    const ctx = deps.getContext();
    const pu = ctx.powerUserSettings;
    if (!pu) {
      deps.cfmToastr.error("无法获取User设定数据");
      return;
    }

    if (field === "name") {
      if (!pu.personas) pu.personas = {};
      pu.personas[persona.avatarId] = value || "[未命名User]";
      deps.saveSettingsDebounced();
      deps.cfmToastr.success("已更新User名称");
      deps.refreshPersonaPanelView();
      deps.syncNativePersonaUI(persona.avatarId);
      return;
    }

    const entry = deps.ensurePersonaDescriptionEntry(persona.avatarId);
    if (!entry) {
      deps.cfmToastr.error("无法获取User设定数据");
      return;
    }
    entry[field] = value;
    deps.saveSettingsDebounced();
    deps.cfmToastr.success(
      field === "title" ? "已更新User标题" : "已更新User具体设定",
    );
    deps.refreshPersonaPanelView();
    deps.syncNativePersonaUI(persona.avatarId);
  }

  // 「修改图像」→ 打开头像管理器弹窗；「应用头像」内部走 applyAvatarToTarget（含裁剪 + 上传替换）
  function replacePersonaDetailAvatar(persona) {
    if (!persona?.avatarId) {
      deps.cfmToastr.error("无法获取User头像信息");
      return;
    }
    deps.openAvatarManager({
      kind: "personas",
      targetId: persona.avatarId,
      targetName: persona?.name || "User",
    });
  }

  // 应用头像：文件路径 → fetch blob → File → 复用现有 prepareDetailAvatarUpload（含裁剪）→ /api/avatars/upload
  async function applyPersonaAvatarFromPath(avatarId, filePath) {
    if (!avatarId || !filePath) return false;
    const displayUrl = deps.avatarPathToDisplayUrl(filePath);
    if (!displayUrl) {
      deps.cfmToastr.error("头像路径无效");
      return false;
    }
    let blob;
    try {
      const resp = await deps.fetch(displayUrl, { cache: "no-cache" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      blob = await resp.blob();
    } catch (e) {
      deps.console.error("[CFM] 读取头像文件失败:", e);
      deps.cfmToastr.error("读取头像文件失败");
      return false;
    }
    const fileName = String(filePath).split("/").pop() || "avatar.png";
    const file = new deps.File([blob], fileName, {
      type: blob.type || "image/png",
    });

    const prepared = await deps.prepareDetailAvatarUpload(file);
    if (!prepared?.file) return false;

    const ctx = deps.getContext();
    const formData = new deps.FormData();
    formData.append("avatar", prepared.file);
    formData.append("overwrite_name", avatarId);

    let url = "/api/avatars/upload";
    if (prepared.cropData !== undefined) {
      url += `?crop=${encodeURIComponent(JSON.stringify(prepared.cropData))}`;
    }

    try {
      const response = await deps.fetch(url, {
        method: "POST",
        headers: ctx.getRequestHeaders({ omitContentType: true }),
        body: formData,
      });
      if (!response.ok) {
        throw new Error((await response.text()) || `HTTP ${response.status}`);
      }

      await deps.bustDetailThumbnailCache("persona", avatarId);
      deps.cfmToastr.success("已更新User头像");
      deps.refreshPersonaPanelView();
      deps.syncNativePersonaUI(avatarId);
      return true;
    } catch (e) {
      deps.console.error("[CFM] 更新User头像失败:", e);
      deps.cfmToastr.error("User头像更新失败");
      return false;
    }
  }

  function renderPersonaDetailSubList(personaRow, persona) {
    personaRow.next(".cfm-chat-sublist").remove();

    const desc = persona?.description || "";
    const personaName = persona?.name || "User";
    const note = deps.getPersonaNote(persona.avatarId) || "";
    const bindStates = deps.getPersonaBindStates(persona);
    const characterBindHtml = deps.buildPersonaConnHtml(
      persona?.connections || [],
    );
    const chatBindHtml = deps.buildPersonaChatBindHtml(persona.avatarId);
    const bindDetailHtml = [
      characterBindHtml ? `<div>${characterBindHtml}</div>` : "",
      chatBindHtml
        ? `<div style="margin-top:6px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;">${chatBindHtml}</div>`
        : "",
    ]
      .filter(Boolean)
      .join("");

    const subList = deps.$(
      '<div class="cfm-chat-sublist cfm-persona-sublist"></div>',
    );
    const detailCard = deps.$(
      '<div class="cfm-chat-toolbar cfm-persona-detail-card"></div>',
    );

    detailCard.append(`
      <div class="cfm-detail-avatar-action" style="display:flex;justify-content:flex-start;padding:0 0 8px 0;">
        <button type="button" class="cfm-btn cfm-persona-detail-avatar-btn">
          <i class="fa-solid fa-image"></i> 修改图像
        </button>
      </div>
    `);

    detailCard.append(`
      <div class="cfm-persona-detail-section">
        <div class="cfm-persona-detail-label">名称
          <div class="cfm-chat-actions">
            <div class="cfm-chat-action-btn cfm-persona-detail-edit" data-field="name" title="编辑名称"><i class="fa-solid fa-pen-to-square"></i></div>
          </div>
        </div>
        <div class="cfm-persona-detail-value">${deps.escapeHtml(personaName)}</div>
      </div>
    `);

    if (note) {
      detailCard.append(`
        <div class="cfm-persona-detail-section">
          <div class="cfm-persona-detail-label">备注</div>
          <div class="cfm-persona-detail-value">${deps.escapeHtml(note)}</div>
        </div>
      `);
    }

    detailCard.append(`
      <div class="cfm-persona-detail-section">
        <div class="cfm-persona-detail-label">绑定</div>
        <div class="cfm-persona-detail-tags cfm-persona-bind-links">
          <div class="menu_button menu_button_icon cfm-persona-bind-btn ${bindStates.default ? "locked" : ""}" data-bind-type="default" title="点击设为新聊天的默认 User；再次点击可取消默认绑定">
            <i class="icon fa-solid fa-crown fa-fw"></i>
            <span class="cfm-persona-bind-text">默认</span>
          </div>
          <div class="menu_button menu_button_icon cfm-persona-bind-btn ${bindStates.character ? "locked" : ""}" data-bind-type="character" title="点击将当前 User 绑定到当前角色；再次点击可取消角色绑定">
            <i class="icon fa-solid fa-${bindStates.character ? "lock" : "unlock"} fa-fw"></i>
            <span class="cfm-persona-bind-text">角色</span>
          </div>
          <div class="menu_button menu_button_icon cfm-persona-bind-btn ${bindStates.chat ? "locked" : ""}" data-bind-type="chat" title="点击将当前 User 绑定到当前聊天；再次点击可取消聊天绑定">
            <i class="icon fa-solid fa-${bindStates.chat ? "lock" : "unlock"} fa-fw"></i>
            <span class="cfm-persona-bind-text">聊天</span>
          </div>
        </div>
        <div class="cfm-persona-detail-value">${bindDetailHtml || '<span class="cfm-persona-detail-empty">无</span>'}</div>
      </div>
    `);

    const personaToolActionHtml = deps.hasNativePersonaToolEntry()
      ? '<div class="cfm-chat-action-btn cfm-persona-detail-tool" title="打开设定生成器"><i class="fa-solid fa-wand-magic-sparkles"></i></div>'
      : "";
    detailCard.append(`
      <div class="cfm-persona-detail-section">
        <div class="cfm-persona-detail-label">具体设定
          <div class="cfm-chat-actions">
            <div class="cfm-chat-action-btn cfm-persona-detail-edit" data-field="description" title="编辑具体设定"><i class="fa-solid fa-pen-to-square"></i></div>
            ${personaToolActionHtml}
          </div>
        </div>
        <div class="cfm-persona-detail-value cfm-persona-detail-description">${desc ? deps.escapeHtml(desc).replace(/\n/g, "<br>") : '<span class="cfm-persona-detail-empty">无</span>'}</div>
      </div>
    `);

    subList.append(detailCard);
    personaRow.after(subList);

    subList.on("touchstart", ".cfm-persona-detail-avatar-btn", function (e) {
      const touch = e.originalEvent?.touches?.[0];
      if (touch) {
        deps.$(this).data("cfmTouchStartX", touch.clientX);
        deps.$(this).data("cfmTouchStartY", touch.clientY);
      }
    });
    subList.on(
      "click touchend",
      ".cfm-persona-detail-avatar-btn",
      async function (e) {
        e.preventDefault();
        e.stopPropagation();
        const target = deps.$(this);
        const now = Date.now();
        const lastTouchAt = Number(target.data("cfmPersonaAvatarTouchAt") || 0);
        if (e.type === "touchend") {
          target.data("cfmPersonaAvatarTouchAt", now);
          const touch = e.originalEvent?.changedTouches?.[0];
          if (touch) {
            const startX = Number(target.data("cfmTouchStartX") || 0);
            const startY = Number(target.data("cfmTouchStartY") || 0);
            const deltaX = Math.abs(touch.clientX - startX);
            const deltaY = Math.abs(touch.clientY - startY);
            if (deltaX > 10 || deltaY > 10) {
              return;
            }
          }
        } else if (lastTouchAt && now - lastTouchAt < 500) {
          return;
        }
        if (target.prop("disabled")) return;
        target.prop("disabled", true);
        try {
          await replacePersonaDetailAvatar(persona);
        } finally {
          target.prop("disabled", false);
        }
      },
    );

    subList.find(".cfm-persona-detail-edit").on("click touchend", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const field = deps.$(e.currentTarget).data("field");
      await editPersonaDetailField(persona, field);
    });

    subList.find(".cfm-persona-detail-tool").on("click touchend", (e) => {
      e.preventDefault();
      e.stopPropagation();
      deps.triggerNativePersonaTool(persona);
    });

    subList
      .find(".cfm-persona-detail-description")
      .on("touchstart", function (e) {
        const touch = e.originalEvent?.touches?.[0];
        if (touch) {
          deps.$(this).data("cfmTouchStartX", touch.clientX);
          deps.$(this).data("cfmTouchStartY", touch.clientY);
        }
      })
      .on("click touchend", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const target = deps.$(e.currentTarget);
        const now = Date.now();
        const lastTouchAt = Number(target.data("cfmPersonaDescTouchAt") || 0);
        if (e.type === "touchend") {
          target.data("cfmPersonaDescTouchAt", now);
          const touch = e.originalEvent?.changedTouches?.[0];
          if (touch) {
            const startX = Number(target.data("cfmTouchStartX") || 0);
            const startY = Number(target.data("cfmTouchStartY") || 0);
            const deltaX = Math.abs(touch.clientX - startX);
            const deltaY = Math.abs(touch.clientY - startY);
            if (deltaX > 10 || deltaY > 10) {
              return;
            }
          }
        } else if (lastTouchAt && now - lastTouchAt < 500) {
          return;
        }

        if (!deps.cfmConfirm("确认编辑Uesr设定吗？")) {
          return;
        }

        const descText = String(persona?.description || "");
        const clickedOffset = deps.getTextOffsetFromPoint(e.currentTarget, e);
        await editPersonaDetailField(persona, "description", {
          caretIndex: Number.isFinite(clickedOffset)
            ? clickedOffset
            : descText.length,
        });
      });

    subList.find(".cfm-persona-bind-btn").on("click touchend", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const bindType = deps.$(e.currentTarget).data("bindType");
      deps.triggerNativePersonaBind(persona, bindType);
    });
  }

  return {
    showPersonaDetailFieldPopup,
    editPersonaDetailField,
    replacePersonaDetailAvatar,
    applyPersonaAvatarFromPath,
    renderPersonaDetailSubList,
  };
}
