// Persona 副本层：承接 User 具体设定副本的增删改查、置顶排序与应用记录，纯数据操作无副作用。

/**
 * 初始化当前 User 的副本存储结构。
 *
 * @param {object} settings extension_settings[extensionName] 插件设置命名空间
 * @param {string} avatarId User avatarId
 * @returns {{ order: string[], items: object }} 副本存储结构
 */
function ensurePersonaSnapshotStore(settings, avatarId) {
  if (!settings || !avatarId) return { order: [], items: {} };
  if (
    !settings.personaSnapshots ||
    typeof settings.personaSnapshots !== "object"
  ) {
    settings.personaSnapshots = {};
  }
  const store = settings.personaSnapshots;
  if (!store[avatarId] || typeof store[avatarId] !== "object") {
    store[avatarId] = { order: [], items: {} };
  }
  const entry = store[avatarId];
  if (!Array.isArray(entry.order)) entry.order = [];
  if (!entry.items || typeof entry.items !== "object") entry.items = {};
  // 清理 order 中指向已不存在副本的残留 id
  const validOrder = entry.order.filter((id) => entry.items[id]);
  if (validOrder.length !== entry.order.length) entry.order = validOrder;
  // 将 items 中未列入 order 的副本追加到末尾（防异常数据丢失可见性）
  const known = new Set(validOrder);
  for (const id of Object.keys(entry.items)) {
    if (!known.has(id)) {
      entry.order.push(id);
      known.add(id);
    }
  }
  return entry;
}

/**
 * 读取某 User 的副本列表（含内容）。
 *
 * @param {object} settings extension_settings[extensionName]
 * @param {string} avatarId User avatarId
 * @returns {{ order: string[], items: object }}
 */
export function getPersonaSnapshots(settings, avatarId) {
  return ensurePersonaSnapshotStore(settings, avatarId);
}

/**
 * 生成唯一副本 id。
 *
 * @returns {string}
 */
export function createPersonaSnapshotId() {
  return (
    "snap_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}

/**
 * 新增或覆盖副本。
 *
 * @param {object} settings extension_settings[extensionName]
 * @param {string} avatarId User avatarId
 * @param {string} snapId 副本 id（已存在则覆盖内容与备注）
 * @param {string} note 备注名
 * @param {string} content 具体设定全文
 * @returns {object} 更新后的副本结构
 */
export function savePersonaSnapshot(settings, avatarId, snapId, note, content) {
  const entry = ensurePersonaSnapshotStore(settings, avatarId);
  if (!snapId) return entry;
  if (!entry.items[snapId]) {
    entry.items[snapId] = { id: snapId, note: "", content: "" };
    entry.order.push(snapId);
  }
  entry.items[snapId].note = String(note || "");
  entry.items[snapId].content = String(content || "");
  return entry;
}

/**
 * 删除副本并同步 order。
 *
 * @param {object} settings extension_settings[extensionName]
 * @param {string} avatarId User avatarId
 * @param {string} snapId 副本 id
 * @returns {object} 更新后的副本结构
 */
export function deletePersonaSnapshot(settings, avatarId, snapId) {
  const entry = ensurePersonaSnapshotStore(settings, avatarId);
  if (!entry.items[snapId]) return entry;
  delete entry.items[snapId];
  entry.order = entry.order.filter((id) => id !== snapId);
  return entry;
}

/**
 * 置顶副本（移动到 order 头部）。
 *
 * @param {object} settings extension_settings[extensionName]
 * @param {string} avatarId User avatarId
 * @param {string} snapId 副本 id
 * @returns {object} 更新后的副本结构
 */
export function pinPersonaSnapshot(settings, avatarId, snapId) {
  const entry = ensurePersonaSnapshotStore(settings, avatarId);
  if (!entry.items[snapId]) return entry;
  const filtered = entry.order.filter((id) => id !== snapId);
  filtered.unshift(snapId);
  entry.order = filtered;
  return entry;
}

/**
 * 应用副本（只读取出内容，不修改副本数据）。
 *
 * @param {object} settings extension_settings[extensionName]
 * @param {string} avatarId User avatarId
 * @param {string} snapId 副本 id
 * @returns {string|null} 副本内容；副本不存在返回 null
 */
export function applyPersonaSnapshot(settings, avatarId, snapId) {
  const entry = ensurePersonaSnapshotStore(settings, avatarId);
  const item = entry.items[snapId];
  return item ? String(item.content || "") : null;
}
