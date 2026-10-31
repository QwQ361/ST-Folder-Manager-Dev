// 背景预览层：承接 backgrounds 资源域的背景图放大预览弹窗。
// 行为：点击背景行右侧的"预览背景图"按钮 → 打开放大预览弹窗（居中显示背景原图，点击遮罩/关闭按钮/图片关闭）。

export function createBgPreviewApi(deps) {
  const {
    $,
    document,
    escapeHtml,
    getBackgroundDisplayName,
    getBackgroundThumbnailUrl,
  } = deps;

  // 背景图加载失败占位回退：文件缺失（换设备/清 data 目录）时显示灰色占位
  function bindPreviewErrorFallback(img) {
    img.onerror = function () {
      this.classList.add("cfm-bg-preview-img-broken");
      this.src =
        "data:image/svg+xml;charset=UTF-8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="100%" height="100%" fill="#2a2e3a"/><text x="50%" y="50%" fill="#6c7086" font-size="20" text-anchor="middle" dominant-baseline="middle">背景图缺失</text></svg>',
        );
    };
    return img;
  }

  // 模块级：当前打开的预览弹窗（单例）
  let currentOverlay = null;

  /**
   * 打开单个背景的放大预览弹窗
   * @param {string} bgfile 背景文件名（含扩展名，如 bg1.jpg）
   */
  function openBgPreview(bgfile) {
    if (!bgfile) return;
    // 单例：若已有预览弹窗（未关闭时再次点击其他背景），先关闭旧的再打开，避免叠加
    if (currentOverlay) {
      currentOverlay.remove();
      currentOverlay = null;
    }
    const displayName = getBackgroundDisplayName(bgfile);
    const imgUrl = getBackgroundThumbnailUrl
      ? getBackgroundThumbnailUrl(bgfile)
      : `/backgrounds/${encodeURIComponent(bgfile)}`;
    const overlay = $(`
      <div class="cfm-bg-preview-overlay">
        <div class="cfm-bg-preview-box">
          <button class="cfm-bg-preview-close" title="关闭"><i class="fa-solid fa-xmark"></i></button>
          <img class="cfm-bg-preview-img" src="${imgUrl}" alt="${escapeHtml(displayName)}">
          <div class="cfm-bg-preview-name">${escapeHtml(displayName)}</div>
        </div>
      </div>
    `);
    bindPreviewErrorFallback(overlay.find(".cfm-bg-preview-img")[0]);
    document.body.appendChild(overlay[0]);

    const close = () => {
      overlay.remove();
    };

    overlay.on("click", (e) => {
      // 点击遮罩或关闭按钮或图片 → 关闭
      if (
        $(e.target).hasClass("cfm-bg-preview-overlay") ||
        $(e.target).closest(".cfm-bg-preview-close").length > 0 ||
        $(e.target).hasClass("cfm-bg-preview-img")
      ) {
        close();
      }
    });

    // ESC 键关闭
    const onKeydown = (e) => {
      if (e.key === "Escape") {
        close();
        $(document).off("keydown", onKeydown);
      }
    };
    $(document).on("keydown", onKeydown);
    // 弹窗移除后解绑键盘监听
    const originalRemove = overlay.remove.bind(overlay);
    overlay.remove = function () {
      $(document).off("keydown", onKeydown);
      if (currentOverlay === this) currentOverlay = null;
      return originalRemove();
    };
    currentOverlay = overlay;
  }

  return { openBgPreview };
}
