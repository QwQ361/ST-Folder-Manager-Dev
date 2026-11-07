// SillyTavern 集成适配层：承接 getContext、原生 API、角色/预设/世界书/聊天等外部接口的薄封装，避免 feature 直接散落访问全局对象。

/**
 * 获取 SillyTavern 全局上下文句柄
 * 作为 ST 集成层唯一入口，供 index.js 及各已拆模块经 deps 注入使用
 */
export function getStContext() {
  return SillyTavern.getContext;
}

/**
 * 依次尝试多个导入路径，返回第一个成功的模块命名空间。
 * 之所以需要多候选：本扩展在 PC 与 Termux/移动端部署时，
 * third-party 下的实际目录层级可能不同（例如少一层 / 多一层、或换了目录名），
 * 若只写死一个相对层级，移动端会出现 import 失败 → 依赖静默降级。
 * 候选顺序：相对路径（与 ST 自身加载同一模块的 URL 一致，可复用模块缓存）
 *            → 站点根绝对路径（不受扩展目录深度影响，作为兜底）。
 * @param {string[]} candidates 候选 import 说明符
 * @param {string} label 日志标签
 * @returns {Promise<Object|null>} 模块命名空间，全部失败返回 null
 */
async function importFirstAvailable(candidates, label) {
  /** @type {string[]} */
  const errors = [];
  for (const spec of candidates) {
    try {
      const mod = await import(spec);
      if (mod) {
        console.log(`[CFM] 成功导入 ${label}: ${spec}`);
        return mod;
      }
    } catch (e) {
      errors.push(`${spec} -> ${e?.message || e}`);
    }
  }
  console.warn(
    `[CFM] 无法导入 ${label}，已尝试全部候选路径:`,
    errors.join(" | "),
  );
  return null;
}

/**
 * 动态导入酒馆核心模块，获取 entitiesFilter 和 printCharactersDebounced
 * 用于在分页前进行数据级过滤，而非 DOM 级 show/hide
 * 以及聊天记录管理相关 API
 * @returns {Promise<Object>} 包含各 ST 核心模块 API 的对象（失败项为 null，不影响其他项）
 */
export async function loadStCoreModules() {
  // 聊天记录管理相关 API
  let entitiesFilter = null;
  let printCharactersDebounced = null;
  let getPastCharacterChatsFunc = null;
  let deleteCharacterChatByNameFunc = null;
  let renameGroupOrCharacterChatFunc = null;
  let openCharacterChatFunc = null;
  let importCharacterChatFunc = null;
  let doNewChatFunc = null;
  let setUserNameFunc = null;
  {
    const scriptModule = await importFirstAvailable(
      [
        // 标准布局：public/scripts/extensions/third-party/<ext>/integrations/ 向上 5 级 = public/
        "../../../../../script.js",
        // 目录层级少一层 / 迁移到 extensions/<ext> 时的兜底
        "../../../../script.js",
        // 站点根绝对路径兜底（public 目录静态挂载在根）
        "/script.js",
      ],
      "script.js",
    );
    if (scriptModule) {
      entitiesFilter = scriptModule.entitiesFilter;
      printCharactersDebounced = scriptModule.printCharactersDebounced;
      getPastCharacterChatsFunc = scriptModule.getPastCharacterChats;
      deleteCharacterChatByNameFunc = scriptModule.deleteCharacterChatByName;
      renameGroupOrCharacterChatFunc = scriptModule.renameGroupOrCharacterChat;
      openCharacterChatFunc = scriptModule.openCharacterChat;
      importCharacterChatFunc = scriptModule.importCharacterChat;
      doNewChatFunc = scriptModule.doNewChat;
      setUserNameFunc = scriptModule.setUserName;
    } else {
      console.warn(
        "[CFM] 角色卡文件夹过滤将回退到 DOM 级过滤；聊天记录管理 API 不可用",
      );
    }
  }

  // 动态导入酒馆 personas 模块，获取 personasFilter 和 getUserAvatars
  // 用于在分页前进行数据级过滤，修复 Persona 文件夹过滤与分页不兼容的问题
  let personasFilter = null;
  let getUserAvatarsFunc = null;
  let setPersonaDescriptionFunc = null;
  let userAvatarVar = null;
  {
    const personasModule = await importFirstAvailable(
      [
        // 标准布局：.../extensions/third-party/<ext>/integrations/ 向上 4 级 = public/scripts/
        "../../../../personas.js",
        // 目录层级少一层时的兜底
        "../../../personas.js",
        // 站点根绝对路径兜底
        "/scripts/personas.js",
      ],
      "personas.js",
    );
    if (personasModule) {
      personasFilter = personasModule.personasFilter;
      getUserAvatarsFunc = personasModule.getUserAvatars;
      setPersonaDescriptionFunc = personasModule.setPersonaDescription;
      // ⚠️ 注意：user_avatar 是原生模块的 export let 活绑定（live binding），
      // 命名空间对象上的属性值会随原生模块内部赋值而更新，
      // 因此必须保留模块命名空间引用以在后续读取当前值，不能只取值快照。
      userAvatarVar = personasModule;
    } else {
      console.warn("[CFM] Persona 文件夹过滤将回退到 DOM 级过滤");
    }
  }

  let Popup = null;
  let POPUP_TYPE = null;
  {
    const popupModule = await importFirstAvailable(
      [
        // 标准布局：.../extensions/third-party/<ext>/integrations/ 向上 4 级 = public/scripts/
        "../../../../popup.js",
        // 目录层级少一层时的兜底
        "../../../popup.js",
        // 站点根绝对路径兜底
        "/scripts/popup.js",
      ],
      "popup.js（头像裁剪弹窗）",
    );
    if (popupModule) {
      Popup = popupModule.Popup;
      POPUP_TYPE = popupModule.POPUP_TYPE;
    }
  }

  let ensureImageFormatSupported = null;
  let getBase64Async = null;
  {
    const utilsModule = await importFirstAvailable(
      [
        // 标准布局：.../extensions/third-party/<ext>/integrations/ 向上 4 级 = public/scripts/
        "../../../../utils.js",
        // 目录层级少一层时的兜底
        "../../../utils.js",
        // 站点根绝对路径兜底
        "/scripts/utils.js",
      ],
      "utils.js（头像裁剪预处理）",
    );
    if (utilsModule) {
      ensureImageFormatSupported = utilsModule.ensureImageFormatSupported;
      getBase64Async = utilsModule.getBase64Async;
    }
  }

  return {
    entitiesFilter,
    printCharactersDebounced,
    getPastCharacterChatsFunc,
    deleteCharacterChatByNameFunc,
    renameGroupOrCharacterChatFunc,
    openCharacterChatFunc,
    importCharacterChatFunc,
    doNewChatFunc,
    setUserNameFunc,
    personasFilter,
    getUserAvatarsFunc,
    setPersonaDescriptionFunc,
    userAvatarVar,
    Popup,
    POPUP_TYPE,
    ensureImageFormatSupported,
    getBase64Async,
  };
}
