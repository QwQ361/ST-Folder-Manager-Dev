// Backup Bridge 摘要层：承接稳定序列化、字符串哈希与资源内容摘要（digest）生成，用于判断桥接资源内容是否变化。
// 注意：本文件原名为 fingerprint.js，因 AdGuard 等广告拦截器会按文件名拦截 fingerprint（指纹追踪），
// 导致该模块被 net::ERR_BLOCKED_BY_CLIENT 拦截、整个扩展激活失败，故更名为 digest.js。

export function getBackupBridgeStableString(value) {
  if (value == null) return "null";

  const valueType = typeof value;
  if (valueType === "string") return JSON.stringify(value);
  if (valueType === "number" || valueType === "boolean") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => getBackupBridgeStableString(item)).join(",")}]`;
  }

  if (valueType === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${getBackupBridgeStableString(value[key])}`,
      )
      .join(",")}}`;
  }

  return JSON.stringify(String(value));
}

export function hashBackupBridgeString(value) {
  const text = String(value || "");
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createBackupBridgeFingerprint(value, mode = "json") {
  const stableString = getBackupBridgeStableString(value);
  return `fnv1a32:${mode}:${hashBackupBridgeString(stableString)}:${stableString.length}`;
}
