// 主题缩略图层：承接 themes 资源域缩略图的读取、保存、删除与主题重命名后的缩略图键迁移。
// 存储结构：{ [themeName]: "files/xxx.png" }（相对 data root 的路径）或兼容旧版的 "data:image/..." dataURL。
// 图片文件本体通过 thumbnail-files.js 上传到用户 data 目录 files/ 子目录；本层负责把返回路径存入 extension_settings，
// 并在替换/删除时清理旧的孤儿文件。setThemeThumbnailCore / deleteThemeThumbnailCore 为异步（需网络上传/删除）。

// 判断缩略图存储值是否为文件路径，旧版 dataURL 不是文件无需清理。
// 原生 /api/files/upload 返回 clientRelativePath(root, files/...)，root=path.join(DATA_ROOT, handle, '')
// 在 Windows 下无尾部斜杠，slice 后残留前导分隔符 → 实际返回 /user/files/xxx.png（前导斜杠）；
// 兼容 user/files/、/user/files/ 与早期可能存的 files/ 三种形态。
export function isThemeThumbnailFilePathCore(value) {
  return (
    typeof value === "string" &&
    (value.startsWith("user/files/") ||
      value.startsWith("/user/files/") ||
      value.startsWith("files/"))
  );
}

export function getThemeThumbnailCore(name, deps) {
  if (!name) return "";
  const thumbs = deps.settings[deps.extensionName]?.themeThumbnails;
  if (!thumbs || typeof thumbs !== "object") return "";
  const value = thumbs[name];
  return typeof value === "string" ? value : "";
}

// 保存缩略图：dataURL → 上传文件 → 存储相对路径 → 清理旧文件。非 dataURL 则视为清除。
// 成功返回存储值（相对路径），失败返回 false。
export async function setThemeThumbnailCore(name, dataUrl, deps) {
  if (!name) return false;
  const settings = deps.settings[deps.extensionName] || {};
  if (!settings.themeThumbnails) {
    settings.themeThumbnails = {};
  }
  const prev = settings.themeThumbnails[name];

  if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
    // 上传图片文件
    const filePath = await deps.uploadThemeThumbnailFile(name, dataUrl);
    if (!filePath) {
      deps.toastr?.error?.("上传缩略图失败，请重试");
      return false;
    }
    settings.themeThumbnails[name] = filePath;
    deps.saveSettingsDebounced();
    // 替换场景：清理旧文件（仅当旧值是文件路径且不同于新文件）
    if (isThemeThumbnailFilePathCore(prev) && prev !== filePath) {
      deps.deleteThemeThumbnailFile?.(prev);
    }
    return filePath;
  }

  // 清除缩略图
  delete settings.themeThumbnails[name];
  deps.saveSettingsDebounced();
  if (isThemeThumbnailFilePathCore(prev)) {
    deps.deleteThemeThumbnailFile?.(prev);
  }
  return true;
}

// 删除缩略图：清除设置项并清理对应文件（若为文件路径）
export async function deleteThemeThumbnailCore(name, deps) {
  if (!name) return false;
  const settings = deps.settings[deps.extensionName] || {};
  if (settings.themeThumbnails && settings.themeThumbnails[name]) {
    const prev = settings.themeThumbnails[name];
    delete settings.themeThumbnails[name];
    deps.saveSettingsDebounced();
    if (isThemeThumbnailFilePathCore(prev)) {
      deps.deleteThemeThumbnailFile?.(prev);
    }
    return true;
  }
  return false;
}

// 统计待迁移的旧版 dataURL 缩略图数量（供设置页按钮显示"待迁移 N 个"）
export function countPendingThemeThumbnailMigrationsCore(deps) {
  const thumbs = deps.settings[deps.extensionName]?.themeThumbnails;
  if (!thumbs || typeof thumbs !== "object") return 0;
  let count = 0;
  for (const value of Object.values(thumbs)) {
    if (typeof value === "string" && value.startsWith("data:image/")) count++;
  }
  return count;
}

// 一次性迁移旧版 dataURL 缩略图到文件化存储：
// 逐个 dataURL 上传为文件 → 替换存储值为相对路径 → 清理旧 dataURL（替换时自动删除旧文件，dataURL 无文件无需删）。
// 幂等：已被替换成路径的项自动跳过；单个失败仅保留原 dataURL，下次重试。
// 返回 { migrated, failed, skipped }。
export async function migrateThemeThumbnailsToFilesCore(deps) {
  const settings = deps.settings[deps.extensionName] || {};
  const thumbs = settings.themeThumbnails;
  if (!thumbs || typeof thumbs !== "object") {
    return { migrated: 0, failed: 0, skipped: 0 };
  }
  const entries = Object.entries(thumbs).filter(
    ([, value]) => typeof value === "string" && value.startsWith("data:image/"),
  );
  let migrated = 0;
  let failed = 0;
  for (const [name, dataUrl] of entries) {
    try {
      // 复用 setThemeThumbnailCore：上传 → 存路径 → 清理旧值（dataURL 无文件，跳过删除）
      const result = await setThemeThumbnailCore(name, dataUrl, deps);
      if (result === false) failed++;
      else migrated++;
    } catch (e) {
      failed++;
      deps.console?.warn?.("[CFM] 迁移缩略图失败", name, e);
    }
  }
  const skipped = entries.length - migrated - failed;
  return { migrated, failed, skipped };
}
