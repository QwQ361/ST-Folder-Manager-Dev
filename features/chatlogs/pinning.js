// 聊天记录置顶层：承接最近聊天置顶状态的读取、切换、顺序恢复与缺失项补抓，对应老代码中的 pinnedChats 持久化、welcome-screen 最近聊天列表重排、置顶项图钉交互，以及缺失置顶聊天的异步插入逻辑。

export function createChatlogPinningApiCore(deps) {
  const {
    CSS,
    Node,
    MutationObserver,
    cfmToastr,
    document,
    escapeHtml,
    fetch,
    getCharacters,
    getContext,
    getThumbnailUrl,
    openChatFile,
    requestAnimationFrame,
    cancelAnimationFrame,
    saveSettingsDebounced,
    settings,
  } = deps;

  let welcomeRecentChatRefreshToken = 0;
  let welcomeRecentChatRefreshFrameId = 0;
  const cfmPendingMissingPinnedFetches = new Set();
  let enhanceRecentChatsWithNotesCallback = null;

  function setEnhanceRecentChatsWithNotesCallback(callback) {
    enhanceRecentChatsWithNotesCallback =
      typeof callback === "function" ? callback : null;
  }

  function runEnhanceRecentChatsWithNotes() {
    if (enhanceRecentChatsWithNotesCallback) {
      enhanceRecentChatsWithNotesCallback();
    }
  }

  // ==================== 聊天置顶管理 ====================

  /**
   * 获取所有置顶聊天列表
   * @returns {{ avatar: string, chatFileName: string }[]}
   */
  function getPinnedChats() {
    return settings.pinnedChats || [];
  }

  /**
   * 检查某聊天是否已置顶
   */
  function isChatPinned(avatar, chatFileName) {
    return getPinnedChats().some(
      (p) => p.avatar === avatar && p.chatFileName === chatFileName,
    );
  }

  /**
   * 切换聊天的置顶状态
   * @param {string} avatar - 角色的 avatar 文件名
   * @param {string} chatFileName - 聊天文件名（不含扩展名）
   * @returns {boolean} true=已置顶, false=已取消置顶
   */
  function togglePinChat(avatar, chatFileName) {
    const pinned = getPinnedChats();
    const idx = pinned.findIndex(
      (p) => p.avatar === avatar && p.chatFileName === chatFileName,
    );
    if (idx >= 0) {
      // 取消置顶
      pinned.splice(idx, 1);
      settings.pinnedChats = pinned;
      saveSettingsDebounced();
      cfmToastr.info("已取消置顶");
      applyPinnedChatsToWelcomeScreen();
      return false;
    } else {
      // 添加置顶
      pinned.push({ avatar, chatFileName });
      settings.pinnedChats = pinned;
      saveSettingsDebounced();
      cfmToastr.success("已置顶到最近聊天");
      applyPinnedChatsToWelcomeScreen();
      return true;
    }
  }

  // 兼容旧调用名，避免历史残留逻辑调用 toggleChatPin 时失效
  function toggleChatPin(avatar, chatFileName) {
    return togglePinChat(avatar, chatFileName);
  }

  function scheduleWelcomeRecentChatRefresh() {
    const token = ++welcomeRecentChatRefreshToken;
    if (welcomeRecentChatRefreshFrameId) {
      cancelAnimationFrame(welcomeRecentChatRefreshFrameId);
    }
    welcomeRecentChatRefreshFrameId = requestAnimationFrame(() => {
      welcomeRecentChatRefreshFrameId = 0;
      if (token !== welcomeRecentChatRefreshToken) return;
      applyPinnedChatsToWelcomeScreen();
      requestAnimationFrame(() => runEnhanceRecentChatsWithNotes());
    });
  }

  /**
   * 将置顶聊天应用到酒馆的 welcome-screen "最近聊天" 列表
   * 通过操作 DOM 将置顶项移动/插入到列表最前面
   */
  function applyPinnedChatsToWelcomeScreen() {
    const chatEl = document.getElementById("chat");
    if (!chatEl) return;
    const welcomePanel = chatEl.querySelector(".welcomePanel");
    if (!welcomePanel) return;
    const recentList = welcomePanel.querySelector(".recentChatList");
    if (!recentList) return;

    const pinned = getPinnedChats();

    // 先移除重复聊天项，避免多次补抓/重试导致同一聊天重复显示
    const seenChatKeys = new Set();
    recentList.querySelectorAll(".recentChat").forEach((el) => {
      const key =
        (el.getAttribute("data-avatar") || "") +
        "::" +
        (el.getAttribute("data-file") || "");
      if (!key || key === "::") return;
      if (seenChatKeys.has(key)) {
        el.remove();
        return;
      }
      seenChatKeys.add(key);
    });

    // 先移除所有置顶标记
    recentList.querySelectorAll(".recentChat").forEach((el) => {
      el.classList.remove("cfm-pinned-chat");
      const pinIcon = el.querySelector(".cfm-pin-indicator");
      if (pinIcon) pinIcon.remove();
    });

    if (pinned.length === 0) return;

    // ---- 分组折叠模式兼容 ----
    // 另一个脚本（按角色卡分组折叠最近聊天）会把 .recentChat 收进 header+wrap 结构中，
    // 此时 recentList 的直接子元素里存在"非 .recentChat 但包含 .recentChat"的容器(wrap)。
    // 若仍按平铺模式把 wrap 内的 .recentChat 用 insertBefore 移出到顶层，
    // 会把分组结构拆散：wrap 被掏空、聊天全部平铺展开。
    const isGrouped = Array.from(recentList.children).some(
      (el) =>
        !el.classList?.contains("recentChat") &&
        Array.from(el.children || []).some((c) =>
          c.classList?.contains("recentChat"),
        ),
    );
    if (isGrouped) {
      applyPinnedChatsToGroupedList(recentList, pinned);
      requestAnimationFrame(() => runEnhanceRecentChatsWithNotes());
      return;
    }

    // 找到 "showMoreChats" 按钮之前的参考点（置顶项应在所有普通项之前）
    const allChatItems = Array.from(recentList.querySelectorAll(".recentChat"));

    // 将已存在的置顶项移到最前面，按置顶顺序排列
    const pinnedElements = [];
    const unpinnedElements = [];

    for (const item of allChatItems) {
      const itemAvatar = item.getAttribute("data-avatar") || "";
      const itemFile = item.getAttribute("data-file") || "";
      const isPinned = pinned.some(
        (p) => p.avatar === itemAvatar && p.chatFileName === itemFile,
      );
      if (isPinned) {
        pinnedElements.push(item);
      } else {
        unpinnedElements.push(item);
      }
    }

    // 按置顶列表顺序排序已置顶的元素
    pinnedElements.sort((a, b) => {
      const aAvatar = a.getAttribute("data-avatar") || "";
      const aFile = a.getAttribute("data-file") || "";
      const bAvatar = b.getAttribute("data-avatar") || "";
      const bFile = b.getAttribute("data-file") || "";
      const aIdx = pinned.findIndex(
        (p) => p.avatar === aAvatar && p.chatFileName === aFile,
      );
      const bIdx = pinned.findIndex(
        (p) => p.avatar === bAvatar && p.chatFileName === bFile,
      );
      return aIdx - bIdx;
    });

    // 为置顶项添加标记样式和图钉图标（可点击取消置顶）
    pinnedElements.forEach((el) => {
      el.classList.add("cfm-pinned-chat");
      el.classList.remove("hidden"); // 置顶项始终可见
      addPinIndicator(el);
    });

    // 获取 showMoreChats 按钮（如果有的话）
    const showMoreBtn = recentList.querySelector("button.showMoreChats");
    // 获取 noRecentChat 提示（如果有的话）
    const noRecentChat = recentList.querySelector(".noRecentChat");

    // 重新排列 DOM：先置顶项，再非置顶项
    // 在 recentList 的最前面插入（在 noRecentChat 之后如果有的话）
    const insertBefore = noRecentChat
      ? noRecentChat.nextSibling
      : recentList.firstChild;

    // 先插入置顶项（按顺序）
    for (const el of pinnedElements) {
      recentList.insertBefore(el, insertBefore);
    }
    // 再插入非置顶项（保持原有顺序）
    for (const el of unpinnedElements) {
      recentList.insertBefore(el, showMoreBtn);
    }

    // 如果有不在当前列表中的置顶聊天（可能未被后端返回），
    // 需要通过 API 获取其信息并创建 DOM 元素插入
    const existingKeys = new Set(
      allChatItems.map(
        (el) =>
          (el.getAttribute("data-avatar") || "") +
          "::" +
          (el.getAttribute("data-file") || ""),
      ),
    );
    const missingPinned = pinned.filter((p) => {
      const key = p.avatar + "::" + p.chatFileName;
      return !existingKeys.has(key) && !cfmPendingMissingPinnedFetches.has(key);
    });
    if (missingPinned.length > 0) {
      fetchAndInsertMissingPinnedChats(recentList, missingPinned, insertBefore);
    }

    // 在置顶操作完成后应用备注显示
    requestAnimationFrame(() => runEnhanceRecentChatsWithNotes());
  }

  /**
   * 为置顶聊天项添加图钉标记（幂等，避免重复注入图标）
   */
  function addPinIndicator(el) {
    if (el.querySelector(".cfm-pin-indicator")) return;
    const nameEl = el.querySelector(".characterName");
    if (!nameEl) return;
    const pinIcon = document.createElement("i");
    pinIcon.className = "fa-solid fa-thumbtack cfm-pin-indicator";
    pinIcon.title = "点击取消置顶";
    const elAvatar = el.getAttribute("data-avatar") || "";
    const elFile = el.getAttribute("data-file") || "";
    pinIcon.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      togglePinChat(elAvatar, elFile);
    });
    nameEl.parentNode.insertBefore(pinIcon, nameEl.nextSibling);
  }

  /**
   * 分组折叠模式下的置顶应用（兼容另一个按角色卡分组折叠最近聊天的脚本）
   * 原则：绝不把 wrap 内的 .recentChat 移到 recentList 顶层破坏折叠结构。
   * 行为：
   *  - 顶层游离的非置顶项（此前因置顶被移到顶层、现已取消置顶）回收进对应分组 wrap
   *  - 已有置顶项：标记 + 移到对应分组 header 之前（顶层，保持可见）
   *  - 非置顶项：一律保持原位不动
   *  - 缺失置顶项：补插到对应分组 header 之前
   */
  function applyPinnedChatsToGroupedList(recentList, pinned) {
    // 1) 收集分组结构：{ header, wrap, items }
    const groups = [];
    for (const el of Array.from(recentList.children)) {
      if (el.classList?.contains("recentChat")) continue;
      const wrapItems = Array.from(el.children || []).filter((c) =>
        c.classList?.contains("recentChat"),
      );
      if (wrapItems.length > 0) {
        groups.push({
          header: el.previousElementSibling,
          wrap: el,
          items: wrapItems,
        });
      }
    }

    // avatar -> 分组 映射（用组内已有项的 data-avatar 推断）
    const avatarToGroup = new Map();
    for (const g of groups) {
      for (const item of g.items) {
        const avatar = item.getAttribute("data-avatar") || "";
        if (avatar && !avatarToGroup.has(avatar)) {
          avatarToGroup.set(avatar, g);
        }
      }
    }

    const isPinned = (el) => {
      const avatar = el.getAttribute("data-avatar") || "";
      const file = el.getAttribute("data-file") || "";
      return pinned.some((p) => p.avatar === avatar && p.chatFileName === file);
    };

    // 2) 回收顶层游离的非置顶项（之前因置顶被移到顶层，现已取消置顶）回到对应组 wrap
    for (const el of Array.from(recentList.children)) {
      if (!el.classList?.contains("recentChat")) continue;
      if (isPinned(el)) continue;
      const avatar = el.getAttribute("data-avatar") || "";
      const group = avatarToGroup.get(avatar);
      if (group) {
        group.wrap.appendChild(el);
      }
    }

    // 3) 标记并上移置顶项到对应组 header 之前（顶层，保持可见）
    //    先收集所有置顶项，按置顶列表顺序排序，再逐个插到 header 前
    const pinnedItems = Array.from(recentList.querySelectorAll(".recentChat"))
      .filter(isPinned)
      .sort((a, b) => {
        const aAvatar = a.getAttribute("data-avatar") || "";
        const aFile = a.getAttribute("data-file") || "";
        const bAvatar = b.getAttribute("data-avatar") || "";
        const bFile = b.getAttribute("data-file") || "";
        const aIdx = pinned.findIndex(
          (p) => p.avatar === aAvatar && p.chatFileName === aFile,
        );
        const bIdx = pinned.findIndex(
          (p) => p.avatar === bAvatar && p.chatFileName === bFile,
        );
        return aIdx - bIdx;
      });
    for (const item of pinnedItems) {
      item.classList.add("cfm-pinned-chat");
      item.classList.remove("hidden");
      addPinIndicator(item);
      const avatar = item.getAttribute("data-avatar") || "";
      const ref = avatarToGroup.get(avatar)?.header || null;
      if (ref) {
        recentList.insertBefore(item, ref);
      }
    }

    // 4) 补插缺失的置顶项
    const existingKeys = new Set(
      Array.from(recentList.querySelectorAll(".recentChat")).map(
        (el) =>
          (el.getAttribute("data-avatar") || "") +
          "::" +
          (el.getAttribute("data-file") || ""),
      ),
    );
    const missingPinned = pinned.filter((p) => {
      const key = p.avatar + "::" + p.chatFileName;
      return !existingKeys.has(key) && !cfmPendingMissingPinnedFetches.has(key);
    });
    if (missingPinned.length > 0) {
      fetchAndInsertMissingPinnedChats(
        recentList,
        missingPinned,
        null,
        avatarToGroup,
      );
    }
  }

  /**
   * 获取不在当前列表中的置顶聊天的信息并插入到 DOM
   */
  async function fetchAndInsertMissingPinnedChats(
    recentList,
    missingPinned,
    insertBefore,
    avatarToGroup,
  ) {
    const characters = getCharacters();
    const headers = getContext().getRequestHeaders();

    for (const pin of missingPinned) {
      const pinKey = pin.avatar + "::" + pin.chatFileName;
      cfmPendingMissingPinnedFetches.add(pinKey);
      try {
        const existingItem = recentList.querySelector(
          `.recentChat[data-avatar="${CSS.escape(pin.avatar)}"][data-file="${CSS.escape(pin.chatFileName)}"]`,
        );
        if (existingItem) continue;

        const char = characters.find((c) => c.avatar === pin.avatar);
        if (!char) continue; // 角色不存在，跳过

        // 获取聊天文件信息
        const resp = await fetch("/api/chats/get", {
          method: "POST",
          headers,
          body: JSON.stringify({
            avatar_url: pin.avatar,
            file_name: pin.chatFileName,
          }),
        });
        if (!resp.ok) continue;
        const chatData = await resp.json();
        if (!Array.isArray(chatData) || chatData.length === 0) continue;

        const lastMsg = chatData[chatData.length - 1];
        const mes = lastMsg?.mes || "";
        const sendDate = lastMsg?.send_date || "";
        const thumbUrl = getThumbnailUrl("avatar", char.avatar);

        // 格式化日期
        let dateShort = "";
        let dateLong = "";
        try {
          const { timestampToMoment } = getContext();
          if (timestampToMoment && sendDate) {
            const m = timestampToMoment(sendDate);
            dateShort = m.format("l");
            dateLong = m.format("LL LT");
          }
        } catch (_) {}

        // 创建 DOM 元素（模仿 welcomePanel.html 的结构）
        const chatItem = document.createElement("div");
        chatItem.className = "recentChat cfm-pinned-chat";
        chatItem.setAttribute("data-file", pin.chatFileName);
        chatItem.setAttribute("data-avatar", pin.avatar);
        chatItem.setAttribute("data-group", "");
        const eName = escapeHtml(char.name);
        const eChatFile = escapeHtml(pin.chatFileName);
        const eAvatar = escapeHtml(pin.avatar);
        const eMes = escapeHtml(mes.substring(0, 200));
        const eDateShort = escapeHtml(dateShort);
        const eDateLong = escapeHtml(dateLong);
        chatItem.innerHTML = `
          <div class="avatar" title="[Character] ${eName}&#10;File: ${eAvatar}">
            <img src="${thumbUrl}" alt="${eName}">
          </div>
          <div class="recentChatInfo">
            <div class="chatNameContainer">
              <div class="chatName" title="${eChatFile}.jsonl">
                <strong class="characterName">${eName}</strong>
                <i class="fa-solid fa-thumbtack cfm-pin-indicator" title="点击取消置顶"></i>
                <span>&ndash;</span>
                <span>${eChatFile}</span>
              </div>
              <small class="chatDate" title="${eDateLong}">${eDateShort}</small>
              <div class="chatActions">
                <button class="menu_button menu_button_icon renameChat" title="Rename chat">
                  <i class="fa-solid fa-pen-to-square fa-fw"></i>
                </button>
                <button class="menu_button menu_button_icon deleteChat" title="Delete chat">
                  <i class="fa-solid fa-trash fa-fw"></i>
                </button>
              </div>
            </div>
            <div class="chatMessageContainer">
              <div class="chatMessage" title="${eMes}">
                ${eMes}
              </div>
              <div class="chatStats">
                <div class="counterBlock">
                  <i class="fa-solid fa-comment fa-xs"></i>
                  <small>${chatData.length}</small>
                </div>
              </div>
            </div>
          </div>
        `;

        // 绑定图钉图标的取消置顶事件
        const pinIndicator = chatItem.querySelector(".cfm-pin-indicator");
        if (pinIndicator) {
          pinIndicator.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            togglePinChat(pin.avatar, pin.chatFileName);
          });
        }

        // 绑定点击事件
        chatItem.addEventListener("click", () => {
          openChatFile(pin.avatar, pin.chatFileName);
        });

        // 二次检查，避免异步请求返回期间该聊天已被其它重试或原生列表插入
        const duplicateItem = recentList.querySelector(
          `.recentChat[data-avatar="${CSS.escape(pin.avatar)}"][data-file="${CSS.escape(pin.chatFileName)}"]`,
        );
        if (duplicateItem) continue;

        // 插入位置：
        //  - 分组模式（avatarToGroup 已提供）：插到对应分组 header 之前（顶层）
        //  - 平铺模式：在 insertBefore 之前插入（在其他置顶项之后）
        if (avatarToGroup && avatarToGroup.has(pin.avatar)) {
          const ref = avatarToGroup.get(pin.avatar).header;
          recentList.insertBefore(chatItem, ref || insertBefore);
        } else {
          const existingPinned =
            recentList.querySelectorAll(".cfm-pinned-chat");
          const lastPinned = existingPinned[existingPinned.length - 1];
          if (lastPinned && lastPinned.nextSibling) {
            recentList.insertBefore(chatItem, lastPinned.nextSibling);
          } else {
            recentList.insertBefore(chatItem, insertBefore);
          }
        }
      } catch (e) {
        console.warn("[CFM] 获取置顶聊天信息失败:", pin, e);
      } finally {
        cfmPendingMissingPinnedFetches.delete(pinKey);
      }
    }
    // 异步插入完成后应用备注显示
    requestAnimationFrame(() => runEnhanceRecentChatsWithNotes());
  }

  /**
   * 初始化 welcome-screen 置顶聊天 hook
   * 使用 MutationObserver 监听 #chat 容器，当 welcomePanel 被插入时自动应用置顶
   */
  function initPinnedChatHook() {
    const bindPinnedObserver = (chatEl) => {
      if (!chatEl || chatEl.dataset.cfmPinnedHookBound === "1") return;
      chatEl.dataset.cfmPinnedHookBound = "1";

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (
              node.nodeType === Node.ELEMENT_NODE &&
              (node.classList?.contains("welcomePanel") ||
                node.querySelector?.(".welcomePanel"))
            ) {
              // welcomePanel 被插入后，分阶段恢复置顶和备注
              scheduleWelcomeRecentChatRefresh();
              return;
            }
          }
        }
      });

      observer.observe(chatEl, { childList: true, subtree: false });
      // 如果当前已有 welcomePanel，立即开始分阶段恢复
      if (chatEl.querySelector(".welcomePanel")) {
        scheduleWelcomeRecentChatRefresh();
      }
    };

    const chatEl = document.getElementById("chat");
    if (chatEl) {
      bindPinnedObserver(chatEl);
      return;
    }

    const bindWhenChatReady = () => {
      const lateChatEl = document.getElementById("chat");
      if (!lateChatEl) return false;
      bindPinnedObserver(lateChatEl);
      return true;
    };

    if (bindWhenChatReady()) return;

    const rootObserver = new MutationObserver(() => {
      if (!bindWhenChatReady()) return;
      rootObserver.disconnect();
    });

    const startObserve = () => {
      if (!document.body) return;
      rootObserver.observe(document.body, { childList: true, subtree: true });
    };

    if (document.body) {
      startObserve();
    } else {
      document.addEventListener("DOMContentLoaded", startObserve, {
        once: true,
      });
    }
  }

  return {
    applyPinnedChatsToWelcomeScreen,
    fetchAndInsertMissingPinnedChats,
    getPinnedChats,
    initPinnedChatHook,
    isChatPinned,
    scheduleWelcomeRecentChatRefresh,
    setEnhanceRecentChatsWithNotesCallback,
    toggleChatPin,
    togglePinChat,
  };
}
