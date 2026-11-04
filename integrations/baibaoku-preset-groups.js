// 柏宝箱（ST-BaiBai-Tools）预设条目分组「供电（激活）」状态的快照与恢复。
//
// 背景：
// 柏宝箱把预设条目折叠成"分组"，每个分组有一个供电开关（`enabled`）。
// 当 `enabled === false` 时，该分组内的条目在生成时被整体过滤——
// 无论条目自身是否为激活状态都不会发送。
//
// 数据落点（预设 extensions，跨插件共享命名空间）：
//
//   extensions.baibaiToolkit.presetPromptGroups = {
//     version: 1,
//     groups: [ { id, name, order, collapsed, enabled } ],
//     prompts: { <identifier>: { groupId } }
//   }
//
// CFM 的「预设条目激活分组」只记录条目级 `enabled`（`prompts.<identifier>`），
// 无法表达"分组供电"这一层开关。因此这里提供两个能力：
//
//   1. createBaibaiPresetGroupSnapshot(extensions)
//      保存 CFM 激活分组时，顺带把柏宝箱各分组的供电状态快照下来，
//      形如 { "<groupId>": { name, enabled } }。
//   2. applyBaibaiPresetGroupSnapshot(snapshot, deps)
//      应用 CFM 激活分组时，把快照里的供电状态写回柏宝箱。
//
// 写入策略（按可靠性排序）：
//   a. 优先点击柏宝箱自己渲染的供电开关（`.bai-bai-preset-group-enable-toggle`）。
//      这是它唯一的官方写入口：内部会同步运行时分组状态、Vue 列表、extensions
//      与防抖持久化队列，避免出现"界面已关但生成仍在发"的错位。
//   b. 开关不可见时（列表未挂载 / 分组被搜索隐藏），退化为直接改运行时：
//      `__baiBaiToolkitExtensionInstalled.presetPromptGroupRuntimeState`、
//      Vue 列表项，以及预设 `extensions`。此时 CFM 随后的保存会把
//      extensions 一并落盘（见 index.js 的 saveNormalizedPresetData）。
//
// 注意：本模块**不**处理条目与分组的归属映射（`prompts[].groupId`），
// 那是条目缝合流程的职责（features/transfer/entries.js），不要在这里重复。

/** 柏宝箱在预设 extensions 下的根键。 */
export const BAIBAI_TOOLKIT_EXTENSION_KEY = "baibaiToolkit";

/** 柏宝箱预设分组在 extensions 内的路径（点号分隔）。 */
export const BAIBAI_PRESET_GROUP_PATH = "baibaiToolkit.presetPromptGroups";

/** 柏宝箱挂在 globalThis 上的扩展状态对象键。 */
const BAIBAI_EXTENSION_STATE_KEY = "__baiBaiToolkitExtensionInstalled";

/** 柏宝箱 Vue 预设列表管理器（挂在扩展状态对象上）。 */
const BAIBAI_VUE_MANAGER_KEY = "__baiBaiToolkitPresetVueListManager";

/** 分组供电开关的类名。 */
const GROUP_ENABLE_TOGGLE_CLASS = "bai-bai-preset-group-enable-toggle";

/** 分组容器（`<li data-preset-group-id="…">`）的属性名。 */
const GROUP_ID_ATTRIBUTE = "data-preset-group-id";

/**
 * 读取路径上的值。
 * @param {*} source
 * @param {string} path
 * @returns {*}
 */
function getObjectPath(source, path) {
  if (!source || typeof source !== "object") return null;
  const value = String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce(
      (cursor, key) =>
        cursor && typeof cursor === "object" ? cursor[key] : undefined,
      source,
    );
  return typeof value === "undefined" ? null : value;
}

/**
 * 按路径写入值，沿途补齐普通对象。
 * @param {*} target
 * @param {string} path
 * @param {*} value
 */
function setObjectPath(target, path, value) {
  if (!target || typeof target !== "object") return;
  const parts = String(path || "")
    .split(".")
    .filter(Boolean);
  if (!parts.length) return;
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index++) {
    const key = parts[index];
    if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

/**
 * 取柏宝箱扩展状态对象（未安装时返回 null）。
 * @returns {object|null}
 */
function getBaibaiExtensionState() {
  try {
    const state = globalThis[BAIBAI_EXTENSION_STATE_KEY];
    return state && typeof state === "object" ? state : null;
  } catch (_) {
    return null;
  }
}

/**
 * 取柏宝箱 Vue 列表管理器（未挂载时返回 null）。
 * @returns {object|null}
 */
function getBaibaiVueManager() {
  const state = getBaibaiExtensionState();
  const manager = state?.[BAIBAI_VUE_MANAGER_KEY];
  return manager && typeof manager === "object" ? manager : null;
}

/**
 * 从 extensions 中取出柏宝箱预设分组状态。
 * @param {*} extensions
 * @returns {{ groups: object[], prompts: object }|null}
 */
export function getBaibaiPresetGroupState(extensions) {
  const value = getObjectPath(extensions, BAIBAI_PRESET_GROUP_PATH);
  if (!value || typeof value !== "object") return null;
  const groups = Array.isArray(value.groups) ? value.groups : [];
  const prompts =
    value.prompts && typeof value.prompts === "object" ? value.prompts : {};
  if (!groups.length) return null;
  return { groups, prompts };
}

/**
 * 判断柏宝箱是否至少装好了运行时（用于界面提示与降级判断）。
 * @returns {boolean}
 */
export function isBaibaiPresetGroupRuntimeAvailable() {
  const state = getBaibaiExtensionState();
  if (!state) return false;
  return Boolean(
    state.presetPromptGroupRuntimeState &&
    Array.isArray(state.presetPromptGroupRuntimeState.groups),
  );
}

/**
 * 生成柏宝箱分组供电状态快照。
 *
 * 只记录"分组供电"这一层开关；分组改名不影响快照命中（以 id 为键）。
 *
 * @param {*} extensions 预设的 extensions 对象（当前运行时优先）
 * @returns {{ [groupId: string]: { name: string, enabled: boolean } }|null}
 */
export function createBaibaiPresetGroupSnapshot(extensions) {
  const state = getBaibaiPresetGroupState(extensions);
  if (!state) return null;
  /** @type {{ [groupId: string]: { name: string, enabled: boolean } }} */
  const snapshot = {};
  let count = 0;
  for (const group of state.groups) {
    const id = String(group?.id || "").trim();
    if (!id) continue;
    snapshot[id] = {
      name: String(group?.name || ""),
      enabled: group?.enabled !== false,
    };
    count++;
  }
  return count > 0 ? snapshot : null;
}

/**
 * 把快照压缩成列表徽标用的极简标记，例如 `柏宝箱1/2`。
 *
 * 分子是快照里"仍供电"的分组数，分母是快照记录的分组总数，
 * 这样全部分组通电时显示 `柏宝箱2/2`，一眼可读。
 *
 * @param {{ [groupId: string]: { name: string, enabled: boolean } }|null} snapshot
 * @returns {string} 无快照或空快照时返回空字符串
 */
export function formatBaibaiPresetGroupCompact(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return "";
  const entries = Object.entries(snapshot);
  if (!entries.length) return "";
  const poweredCount = entries.filter(
    ([, meta]) => meta?.enabled !== false,
  ).length;
  return `柏宝箱${poweredCount}/${entries.length}`;
}

/**
 * 把快照格式化成完整提示文案（用于悬浮说明、弹窗与 toast）。
 *
 * @param {{ [groupId: string]: { name: string, enabled: boolean } }|null} snapshot
 * @param {object[]} [currentGroups] 当前柏宝箱分组（用于标注失效 id）
 * @returns {string}
 */
export function formatBaibaiPresetGroupSnapshot(
  snapshot,
  currentGroups = null,
) {
  if (!snapshot || typeof snapshot !== "object") return "";
  const entries = Object.entries(snapshot);
  if (!entries.length) return "";

  const currentIds = Array.isArray(currentGroups)
    ? new Set(
        currentGroups.map((group) => String(group?.id || "")).filter(Boolean),
      )
    : null;

  const poweredOff = entries.filter(
    ([, meta]) => meta?.enabled === false,
  ).length;
  const missingCount = currentIds
    ? entries.filter(([groupId]) => !currentIds.has(groupId)).length
    : 0;

  const parts = [`柏宝箱分组 ${entries.length} 个`];
  if (poweredOff > 0) parts.push(`${poweredOff} 个断供`);
  if (missingCount > 0) parts.push(`${missingCount} 个已不存在`);
  return parts.join("，");
}

/**
 * 判断柏宝箱分组供电快照是否与当前状态**完全一致**。
 *
 * 用于"预设条目激活分组"列表里的符合度着色：只有快照记录到的每个分组
 * 都仍存在、且供电状态与快照相同，才算一致。
 *
 * - 快照为空 / 不存在 → 返回 true（没有可比较的柏宝箱状态，不参与判定）；
 * - 当前分组列表不可用 → 返回 false（无法确认一致，按不一致处理更保守）；
 * - 快照里有分组 id 在当前分组中已不存在 → 返回 false（该快照已失效）。
 *
 * @param {{ [groupId: string]: { name: string, enabled: boolean } }|null} snapshot
 * @param {object[]|null} currentGroups 当前预设里的柏宝箱分组数组
 * @returns {boolean}
 */
export function isBaibaiPresetGroupSnapshotMatched(snapshot, currentGroups) {
  const entries =
    snapshot && typeof snapshot === "object" ? Object.entries(snapshot) : [];
  if (!entries.length) return true;
  if (!Array.isArray(currentGroups) || currentGroups.length === 0) return false;
  const currentEnabled = new Map();
  for (const group of currentGroups) {
    const id = String(group?.id || "");
    if (id) currentEnabled.set(id, group?.enabled !== false);
  }
  for (const [groupIdRaw, meta] of entries) {
    const groupId = String(groupIdRaw || "");
    if (!currentEnabled.has(groupId)) return false;
    if (currentEnabled.get(groupId) !== (meta?.enabled !== false)) return false;
  }
  return true;
}

/**
 * 读取运行时状态里某个分组的供电状态。
 * @param {string} groupId
 * @returns {boolean|null} null 表示运行时没有该分组
 */
function readRuntimeGroupEnabled(groupId) {
  const state = getBaibaiExtensionState();
  const groups = state?.presetPromptGroupRuntimeState?.groups;
  if (!Array.isArray(groups)) return null;
  const group = groups.find((item) => String(item?.id || "") === groupId);
  if (!group) return null;
  return group.enabled !== false;
}

/**
 * 从开关按钮的类名/标题推断当前供电状态。
 * @param {Element} toggle
 * @returns {boolean|null}
 */
function readDomGroupEnabled(toggle) {
  if (!toggle || typeof toggle.classList?.contains !== "function") return null;
  if (toggle.classList.contains("fa-toggle-on")) return true;
  if (toggle.classList.contains("fa-toggle-off")) return false;
  const title = String(toggle.getAttribute?.("title") || "");
  if (title.includes("关闭分组供电")) return true;
  if (title.includes("开启分组供电")) return false;
  return null;
}

/**
 * 在页面上查找某个分组的供电开关。
 *
 * **必须**先精确命中 `[data-preset-group-id="<id>"]` 容器，再在其内部找开关。
 * 绝对不能退化成"全文档找第一个开关"——那会在分组不存在（如快照里的旧 id）
 * 时误点到另一个分组的开关，把用户没打算动的分组断供，属于数据破坏级 bug。
 *
 * @param {Document|null} doc
 * @param {string} groupId
 * @returns {Element|null}
 */
function findGroupEnableToggle(doc, groupId) {
  if (!doc || typeof doc.querySelector !== "function") return null;
  const escaped =
    typeof globalThis.CSS?.escape === "function"
      ? globalThis.CSS.escape(groupId)
      : groupId.replace(/["\\]/g, "\\$&");
  const container = doc.querySelector(`[${GROUP_ID_ATTRIBUTE}="${escaped}"]`);
  if (!container) return null;
  return container.querySelector(`.${GROUP_ENABLE_TOGGLE_CLASS}`) || null;
}

/**
 * 点击开关：柏宝箱的开关是 `<span>`，绑的是 `onClick`，
 * 这里补一整套指针事件，兼容它对触摸/鼠标的额外处理。
 * @param {Element} toggle
 */
function clickGroupEnableToggle(toggle) {
  const options = { bubbles: true, cancelable: true, composed: true };
  if (typeof PointerEvent === "function") {
    toggle.dispatchEvent(new PointerEvent("pointerdown", options));
  }
  toggle.dispatchEvent(new MouseEvent("mousedown", options));
  if (typeof PointerEvent === "function") {
    toggle.dispatchEvent(new PointerEvent("pointerup", options));
  }
  toggle.dispatchEvent(new MouseEvent("mouseup", options));
  toggle.dispatchEvent(new MouseEvent("click", options));
}

/**
 * 直接改运行时（开关不可见时的降级路径）。
 *
 * 同时更新三处，缺一不可：
 *   1. `presetPromptGroupRuntimeState.groups[].enabled` —— 生成门禁与界面签名的来源；
 *   2. Vue 列表项 —— 让界面立即反映新状态，不必等下一轮 sync；
 *   3. 预设 extensions —— 供 CFM 随后的保存一并落盘。
 *
 * @param {object} deps
 * @param {string} groupId
 * @param {boolean} enabled
 * @returns {boolean} 是否成功写入
 */
function setRuntimeGroupEnabled(deps, groupId, enabled) {
  let changed = false;
  const state = getBaibaiExtensionState();

  const runtimeGroups = state?.presetPromptGroupRuntimeState?.groups;
  if (Array.isArray(runtimeGroups)) {
    const group = runtimeGroups.find(
      (item) => String(item?.id || "") === groupId,
    );
    if (group && (group.enabled !== false) !== enabled) {
      group.enabled = enabled;
      changed = true;
    }
  }

  const manager = getBaibaiVueManager();
  const items = manager?.state?.items;
  if (Array.isArray(items)) {
    for (const item of items) {
      if (item?.type !== "group" || String(item.groupId || "") !== groupId) {
        continue;
      }
      if ((item.enabled !== false) !== enabled) {
        item.enabled = enabled;
        changed = true;
      }
      if (item.group && (item.group.enabled !== false) !== enabled) {
        item.group.enabled = enabled;
        changed = true;
      }
    }
  }

  const extensions =
    typeof deps.getRuntimeExtensions === "function"
      ? deps.getRuntimeExtensions()
      : null;
  if (extensions && typeof extensions === "object") {
    const value = getObjectPath(extensions, BAIBAI_PRESET_GROUP_PATH);
    if (value && Array.isArray(value.groups)) {
      const group = value.groups.find(
        (item) => String(item?.id || "") === groupId,
      );
      if (group && (group.enabled !== false) !== enabled) {
        group.enabled = enabled;
        changed = true;
      }
    } else {
      // extensions 尚未出现分组：没有可写的目标，交给调用方决定是否补建。
      // 这里不伪造分组定义，避免覆盖柏宝箱的权威数据。
    }
  }

  return changed;
}

/**
 * 把柏宝箱分组供电状态快照写回当前预设。
 *
 * @param {{ [groupId: string]: { name: string, enabled: boolean } }|null} snapshot
 * @param {object} [deps]
 * @param {Document} [deps.document] 页面 Document（默认全局 document）
 * @param {() => object|null} [deps.getRuntimeExtensions] 返回当前预设运行时 extensions
 * @param {number} [deps.settleMs] 点击开关后等待柏宝箱同步的时长（默认 80ms）
 * @returns {Promise<{ total: number, changed: number, viaDom: number, viaRuntime: number, skipped: number }>}
 */
export async function applyBaibaiPresetGroupSnapshot(snapshot, deps = {}) {
  const result = {
    total: 0,
    changed: 0,
    viaDom: 0,
    viaRuntime: 0,
    skipped: 0,
  };
  if (!snapshot || typeof snapshot !== "object") return result;

  // 显式传 deps.document === null 表示"禁用 DOM 路径"（测试或需要强制走运行时降级）；
  // 只有完全没提供该鍵时才回退到全局 document。
  const doc =
    "document" in deps
      ? deps.document
      : typeof document !== "undefined"
        ? document
        : null;
  const entries = Object.entries(snapshot);
  if (!entries.length) return result;

  for (const [groupIdRaw, meta] of entries) {
    const groupId = String(groupIdRaw || "").trim();
    if (!groupId) continue;
    result.total++;

    const target = meta?.enabled !== false;
    const runtimeEnabled = readRuntimeGroupEnabled(groupId);
    // 运行时已一致：不重复点击（点击是"翻转"语义，多点一次会翻回去）。
    if (runtimeEnabled === target) continue;

    const toggle = findGroupEnableToggle(doc, groupId);
    const domEnabled = readDomGroupEnabled(toggle);
    if (toggle && domEnabled !== target) {
      clickGroupEnableToggle(toggle);
      result.viaDom++;
      result.changed++;
      continue;
    }

    // 运行时找不到该分组：说明柏宝箱里这个分组已被删除或重建，
    // 快照对它是失效的，不要凭空造出状态。
    if (runtimeEnabled === null) {
      result.skipped++;
      continue;
    }

    if (setRuntimeGroupEnabled(deps, groupId, target)) {
      result.viaRuntime++;
      result.changed++;
    } else {
      result.skipped++;
    }
  }

  // 点击路径是柏宝箱的异步链路（Vue 更新 + 防抖落盘），给一个极短的让出窗口，
  // 避免紧随其后的 CFM 保存读到尚未更新的运行时数据。
  const settleMs = Number.isFinite(Number(deps.settleMs))
    ? Number(deps.settleMs)
    : 80;
  if (result.viaDom > 0 && settleMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  }

  return result;
}

/**
 * 读取酒馆当前预设运行时 extensions 里的柏宝箱分组定义（供界面展示用）。
 * @param {object} presetManager
 * @returns {object[]} 分组数组；不可用时返回空数组
 */
export function getCurrentBaibaiPresetGroups(presetManager) {
  try {
    const list =
      typeof presetManager?.getPresetList === "function"
        ? presetManager.getPresetList()
        : null;
    const state = getBaibaiPresetGroupState(list?.settings?.extensions);
    return state?.groups || [];
  } catch (_) {
    return [];
  }
}
