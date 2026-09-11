// 主题缩略图文件层：承接缩略图图片文件通过 SillyTavern 原生 /api/files/upload 上传到用户 data 目录 files/ 子目录，
// 以及删除时通过 /api/files/delete 清理孤儿文件；返回/接收的相对路径（如 files/xxx.png）由缩略图层存入 extension_settings。
// 与 features/themes/thumbnails.js（存储层）解耦：本文件只负责"文件本体"的上传与删除，不含 settings 读写。

// 生成安全文件名：白名单 [a-zA-Z0-9_-.]+（validateAssetFileName 约束），不用主题名（可能含中文/空格会被拒）。
// 通过主题名哈希 + 固定前缀 + 时间戳保证唯一且稳定。
export function buildThemeThumbnailFileNameCore(name, deps = {}) {
  const hashFn = deps.hashString || defaultHashString;
  const hash = hashFn(String(name || ""));
  const timestamp = Date.now().toString(36);
  return `cfm-theme-${hash}-${timestamp}.png`;
}

// 简单确定性字符串哈希（djb2），避免依赖 crypto.subtle 的异步性与兼容性差异
export function defaultHashString(input) {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

// 从 dataURL 提取纯 base64（去掉 "data:image/...;base64," 前缀），/api/files/upload 的 data 需要裸 base64
export function extractRawBase64Core(dataUrl) {
  if (typeof dataUrl !== "string") return "";
  const idx = dataUrl.indexOf(",");
  if (idx === -1) return "";
  const meta = dataUrl.slice(0, idx);
  if (!/^data:image\/[a-zA-Z0-9.+-]+;base64$/i.test(meta)) return "";
  return dataUrl.slice(idx + 1);
}

// 上传缩略图文件：dataUrl → 纯 base64 → POST /api/files/upload → 返回相对路径（如 files/xxx.png），失败返回空串
export async function uploadThemeThumbnailFileCore(name, dataUrl, deps) {
  if (!name || !dataUrl) return "";
  const rawBase64 = extractRawBase64Core(dataUrl);
  if (!rawBase64) return "";
  const fileName = buildThemeThumbnailFileNameCore(name, deps);
  try {
    const resp = await deps.fetch("/api/files/upload", {
      method: "POST",
      headers: deps.getRequestHeaders(),
      body: JSON.stringify({ name: fileName, data: rawBase64 }),
    });
    if (!resp.ok) {
      deps.console?.warn?.(
        "[CFM] 上传主题缩略图失败",
        resp.status,
        resp.statusText,
      );
      return "";
    }
    const result = await resp.json();
    const filePath =
      result && typeof result.path === "string" ? result.path : "";
    return filePath;
  } catch (e) {
    deps.console?.warn?.("[CFM] 上传主题缩略图异常", e);
    return "";
  }
}

// 判断是否为缩略图文件路径（兼容原生返回的 /user/files/xxx.png 与早期 files/xxx.png）
export function isThemeThumbnailFilePathCore(value) {
  return (
    typeof value === "string" &&
    (value.startsWith("user/files/") ||
      value.startsWith("/user/files/") ||
      value.startsWith("files/"))
  );
}

// 规范化路径：原生 /api/files/delete|verify 要求 path 相对 data root 且以 directories.files（user/files）开头，
// 统一去掉前导斜杠；已是 user/files/ 的保持不变，早期存储的 files/xxx.png 需补 user/ 前缀。
export function normalizeThemeThumbnailFilePathCore(filePath) {
  if (typeof filePath !== "string") return "";
  let value = filePath;
  if (value.startsWith("/user/files/")) value = value.slice(1);
  if (value.startsWith("user/files/")) return value;
  if (value.startsWith("files/")) return `user/${value}`;
  return "";
}

// 删除缩略图文件：path 为 upload 返回的相对路径（user/files/xxx.png），POST /api/files/delete 清理孤儿文件
export async function deleteThemeThumbnailFileCore(filePath, deps) {
  const normalized = normalizeThemeThumbnailFilePathCore(filePath);
  if (!normalized) return false;
  try {
    const resp = await deps.fetch("/api/files/delete", {
      method: "POST",
      headers: deps.getRequestHeaders(),
      body: JSON.stringify({ path: normalized }),
    });
    return resp.ok || resp.status === 404; // 404=文件已不存在，视为成功（幂等）
  } catch (e) {
    deps.console?.warn?.("[CFM] 删除主题缩略图文件异常", e);
    return false;
  }
}

// 批量校验缩略图文件是否存在：urls 为相对路径数组 → { [path]: boolean }（缺失的键返回 false）
export async function verifyThemeThumbnailFilesCore(urls, deps) {
  const list = Array.isArray(urls)
    ? urls.map(normalizeThemeThumbnailFilePathCore).filter(Boolean)
    : [];
  if (list.length === 0) return {};
  try {
    const resp = await deps.fetch("/api/files/verify", {
      method: "POST",
      headers: deps.getRequestHeaders(),
      body: JSON.stringify({ urls: list }),
    });
    if (!resp.ok) return {};
    return await resp.json();
  } catch (e) {
    deps.console?.warn?.("[CFM] 校验主题缩略图文件异常", e);
    return {};
  }
}
