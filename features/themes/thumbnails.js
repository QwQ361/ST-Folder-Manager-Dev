// 主题缩略图层：承接 themes 资源域缩略图（dataURL 图片）的读取、保存、删除与主题重命名后的缩略图键迁移；数据存储于 extension_settings[extensionName].themeThumbnails。
// 存储结构：{ [themeName]: "data:image/png;base64,..." }，图片由用户通过美化页当前主题行的“+”按钮导入。

export function getThemeThumbnailCore(name, deps) {
  if (!name) return "";
  const thumbs = deps.settings[deps.extensionName]?.themeThumbnails;
  if (!thumbs || typeof thumbs !== "object") return "";
  const value = thumbs[name];
  return typeof value === "string" ? value : "";
}

export function setThemeThumbnailCore(name, dataUrl, deps) {
  if (!name) return false;
  const settings = deps.settings[deps.extensionName] || {};
  if (!settings.themeThumbnails) {
    settings.themeThumbnails = {};
  }
  if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
    settings.themeThumbnails[name] = dataUrl;
  } else {
    delete settings.themeThumbnails[name];
  }
  deps.saveSettingsDebounced();
  return true;
}

export function deleteThemeThumbnailCore(name, deps) {
  if (!name) return false;
  const settings = deps.settings[deps.extensionName] || {};
  if (settings.themeThumbnails && settings.themeThumbnails[name]) {
    delete settings.themeThumbnails[name];
    deps.saveSettingsDebounced();
    return true;
  }
  return false;
}
