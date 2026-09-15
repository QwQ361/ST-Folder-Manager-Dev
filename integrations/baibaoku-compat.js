// baibaoku 兼容层：解决 baibaoku 加速插件对 /api/settings/get 的缓存竞态问题。
//
// 背景：
// baibaoku 在页面加载早期通过 early bridge 保存了原始 fetch（rawFetch），随后代理
// window.fetch。对 /api/settings/get 的请求会被其"fast-get"端点接管并做两层缓存：
//   1. 前端缓存（settingsGetCache）—— 在检测到 mutation（/api/themes/save|delete 等）
//      时会立即清除；
//   2. 服务端 payload 缓存 —— 其失效依赖文件系统 watch 事件（异步）。
//
// 竞态：重命名主题时 CFM 先调用 /api/themes/save + /api/themes/delete（会清前端缓存），
// 紧接着立即 reload 主题列表（fetch /api/settings/get）。此时 baibaoku 的 fast-get
// 服务端 payload 缓存可能尚未被 watch 事件标记为 dirty，于是返回了【旧】主题列表，
// 导致重命名后的名称不刷新（需再次重命名或刷新页面才正确）。
//
// 方案：提供 bypassCacheFetch —— 对于"读取"类请求（/api/settings/get），优先使用
// baibaoku 保存的原始 fetch（rawFetch），它直达 SillyTavern 原生端点、不做任何缓存，
// 始终返回磁盘最新数据。若 baibaoku 未安装，则回退到 window.fetch（原生行为）。
//
// 注意：mutation 类请求（/api/themes/save、/api/themes/delete、/api/settings/save 等）
// 必须继续走 window.fetch，让 baibaoku 正常感知并失效其缓存，否则其缓存会越积越旧。

const BAIBAOKU_EARLY_BRIDGE_KEY = "__baibaokuEarlyBridge";

/**
 * 获取 baibaoku 早期桥接对象（若已安装）。
 * @returns {object|null}
 */
export function getBaibaokuBridge() {
  try {
    if (
      typeof window !== "undefined" &&
      window[BAIBAOKU_EARLY_BRIDGE_KEY] &&
      typeof window[BAIBAOKU_EARLY_BRIDGE_KEY].rawFetch === "function"
    ) {
      return window[BAIBAOKU_EARLY_BRIDGE_KEY];
    }
  } catch (_) {
    // 忽略任何访问异常
  }
  return null;
}

/**
 * 是否安装了 baibaoku 且可提供绕过缓存的原始 fetch。
 * @returns {boolean}
 */
export function isBaibaokuBypassAvailable() {
  return getBaibaokuBridge() !== null;
}

/**
 * 绕过 baibaoku 缓存的 fetch。
 *
 * 用于"读取"类请求（如 POST /api/settings/get），保证拿到磁盘/服务端最新数据，
 * 避免 baibaoku fast-get 服务端 payload 缓存竞态返回旧数据。
 *
 * 若 baibaoku 未安装或 rawFetch 不可用，回退到 window.fetch（等价原生行为）。
 *
 * @param {RequestInfo} input - 请求地址或 Request 对象
 * @param {RequestInit} [init] - 请求选项
 * @returns {Promise<Response>}
 */
export function bypassCacheFetch(input, init) {
  const bridge = getBaibaokuBridge();
  if (bridge) {
    return bridge.rawFetch(input, init);
  }
  // 无 baibaoku：原生 fetch 本身无此缓存，直接使用。
  // 注意：此处不能用 window.fetch.bind(window) 的引用（可能被代理），
  // 但 baibaoku 未安装时 window.fetch 即原生，直接调用即可。
  return window.fetch(input, init);
}

/**
 * 获取设置（/api/settings/get）并解析 JSON，绕过 baibaoku 缓存。
 *
 * 供各读取路径复用，避免各处重复 try/catch。
 *
 * @param {object} [deps] - 可选依赖
 * @param {Function} [deps.getRequestHeaders] - 获取请求头的函数（默认无）
 * @returns {Promise<object|null>} 解析后的 JSON 对象；失败返回 null
 */
export async function fetchSettingsBypassCache(deps = {}) {
  try {
    const headers =
      typeof deps.getRequestHeaders === "function"
        ? deps.getRequestHeaders()
        : { "content-type": "application/json" };
    const resp = await bypassCacheFetch("/api/settings/get", {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    if (!resp || !resp.ok) {
      return null;
    }
    return await resp.json();
  } catch (_) {
    return null;
  }
}
