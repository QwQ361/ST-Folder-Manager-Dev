// 世界书自动应用功能文件：负责根据当前角色、聊天和预设的匹配结果，自动计算应启用或关闭的世界书分组，并处理自动应用状态追踪与提示反馈逻辑。

import {
  getGroupMatchState,
  getGroupMatchTitle,
} from "../shared/group-match.js";

export function getAutoApplyPresetIndicesCore(deps) {
  const presets = deps.getWiActivePresets();
  const currentChar = deps.getCurrentCharAvatar();
  const currentPreset = deps.getCurrentPresetName();
  const currentChatKey = deps.getCurrentChatBindKey();
  const indices = [];
  const details = {};
  for (let i = 0; i < presets.length; i++) {
    const p = presets[i];
    if (!p || !Array.isArray(p.books) || p.books.length === 0) continue;
    if (p.scope === "global") continue;
    const hasBindings =
      (p.bindChars && p.bindChars.length > 0) ||
      (p.bindPresets && p.bindPresets.length > 0) ||
      (p.bindChats && p.bindChats.length > 0);
    if (!hasBindings) continue;
    const chatMatch = !!(
      currentChatKey &&
      p.bindChats &&
      p.bindChats.includes(currentChatKey)
    );
    const charMatch = !!(
      !chatMatch &&
      currentChar &&
      p.bindChars &&
      p.bindChars.includes(currentChar)
    );
    const presetMatch = !!(
      currentPreset &&
      p.bindPresets &&
      p.bindPresets.includes(currentPreset)
    );
    if (chatMatch || charMatch || presetMatch) {
      indices.push(i);
      details[i] = { chatMatch, charMatch, presetMatch };
    }
  }
  return { indices, details };
}

export async function autoApplyWiPresetsCore(silent = false, deps) {
  try {
    const settings = deps.extensionSettings[deps.extensionName];
    const presets = deps.getWiActivePresets();
    const charBound = await deps.getCharBoundWorldBooks();
    const { indices: shouldApply, details } = deps.getAutoApplyPresetIndices();
    const prevApplied = settings._wiAppliedPresetIndices || [];

    const currentCharName = deps.getCurrentCharName();
    const currentPresetName = deps.getCurrentPresetName();

    const toDeactivate = prevApplied.filter((i) => {
      if (shouldApply.includes(i)) return false;
      const p = presets[i];
      if (!p || p.scope === "global") return false;
      const hasBindings =
        (p.bindChars && p.bindChars.length > 0) ||
        (p.bindPresets && p.bindPresets.length > 0) ||
        (p.bindChats && p.bindChats.length > 0);
      return hasBindings;
    });
    const toActivate = shouldApply.filter((i) => !prevApplied.includes(i));
    const stillApplied = shouldApply.filter((i) => prevApplied.includes(i));

    if (
      toDeactivate.length === 0 &&
      toActivate.length === 0 &&
      stillApplied.length === 0
    )
      return;

    const booksToDeactivate = new Set();
    for (const idx of toDeactivate) {
      if (presets[idx]) {
        for (const b of presets[idx].books) {
          if (!charBound.has(b)) booksToDeactivate.add(b);
        }
      }
    }

    const booksToActivate = new Set();
    for (const idx of shouldApply) {
      if (presets[idx]) {
        for (const b of presets[idx].books) {
          if (!charBound.has(b)) booksToActivate.add(b);
        }
      }
    }

    for (const b of booksToActivate) {
      booksToDeactivate.delete(b);
    }

    for (const b of booksToDeactivate) {
      await deps.toggleWorldInfoActivation(b, false);
    }
    for (const b of booksToActivate) {
      await deps.toggleWorldInfoActivation(b, true);
    }

    settings._wiAppliedPresetIndices = [...shouldApply];

    const msgParts = [];

    function describeMatchReason(idx) {
      const d = details[idx];
      if (!d) return "";
      const reasons = [];
      if (d.chatMatch) {
        const currentChatName = deps.getCurrentChatFileName();
        if (currentChatName) reasons.push(`聊天「${currentChatName}」`);
      }
      if (d.charMatch && currentCharName)
        reasons.push(`角色「${currentCharName}」`);
      if (d.presetMatch && currentPresetName)
        reasons.push(`预设「${currentPresetName}」`);
      return reasons.length > 0 ? `（匹配${reasons.join("和")}）` : "";
    }

    for (const idx of toActivate) {
      const name = presets[idx]?.name;
      if (name) {
        msgParts.push(`✅ 已开启「${name}」${describeMatchReason(idx)}`);
      }
    }

    for (const idx of toDeactivate) {
      const name = presets[idx]?.name;
      if (name) {
        const p = presets[idx];
        const reasons = [];
        if (p.bindChats && p.bindChats.length > 0) reasons.push("聊天不匹配");
        if (p.bindChars && p.bindChars.length > 0) reasons.push("角色不匹配");
        if (p.bindPresets && p.bindPresets.length > 0)
          reasons.push("预设不匹配");
        msgParts.push(`❌ 已关闭「${name}」（${reasons.join("且")}）`);
      }
    }

    if (
      (toActivate.length > 0 || toDeactivate.length > 0) &&
      stillApplied.length > 0
    ) {
      for (const idx of stillApplied) {
        const name = presets[idx]?.name;
        if (name) {
          msgParts.push(`🔄 「${name}」保持开启${describeMatchReason(idx)}`);
        }
      }
    }

    if (!silent && msgParts.length > 0) {
      deps.cfmToastr.info(msgParts.join("<br>"), "世界书分组", {
        timeOut: 4000,
        escapeHtml: false,
      });
    }
  } catch (e) {
    deps.console.error("[CFM] 自动应用世界书分组失败", e);
  }
}

export async function unapplyWiPresetIndexCore(presetIdx, deps) {
  const allPresets = deps.getWiActivePresets();
  const preset = allPresets[presetIdx];
  if (!preset) return 0;
  const settings = deps.extensionSettings[deps.extensionName];
  const applied = settings._wiAppliedPresetIndices || [];
  const otherApplied = applied.filter((i) => i !== presetIdx && allPresets[i]);
  const otherBooks = new Set();
  for (const oi of otherApplied) {
    for (const b of allPresets[oi].books) otherBooks.add(b);
  }
  const wiCharBoundLocal = await deps.getCharBoundWorldBooks();
  let removedCount = 0;
  for (const b of preset.books) {
    if (!wiCharBoundLocal.has(b) && !otherBooks.has(b)) {
      await deps.toggleWorldInfoActivation(b, false);
      removedCount++;
    }
  }
  settings._wiAppliedPresetIndices = otherApplied;
  deps.saveSettingsDebounced();
  return removedCount;
}

function updateWiPresetPanelApplyButtons(deps, presets, activeSet) {
  const overlay = deps.$("#cfm-wi-preset-panel-overlay");
  if (overlay.length) {
    overlay.find(".cfm-wi-preset-item").each(function () {
      const idx = parseInt(deps.$(this).attr("data-preset-idx"), 10);
      const preset = presets[idx];
      if (!preset) return;
      // 与面板首次渲染使用同一套三态口径，避免"打开时黄色、手动切换后变绿"。
      const matchState = getGroupMatchState(preset.books, activeSet);
      const btn = deps.$(this).find(".cfm-wi-preset-apply");
      btn.removeClass("cfm-wi-preset-apply-active cfm-wi-preset-apply-partial");
      if (matchState === "full") {
        btn.addClass("cfm-wi-preset-apply-active");
      } else if (matchState === "partial") {
        btn.addClass("cfm-wi-preset-apply-partial");
      }
      btn.attr(
        "title",
        getGroupMatchTitle(matchState, {
          full: "完全符合：当前激活的世界书与该分组完全一致",
          partial:
            "不完全符合：该分组的世界书已全部激活，但当前还激活了分组之外的世界书",
          none: "分组内仍有世界书未激活",
        }),
      );
      // 颜色统一交给 CSS 三态规则，这里清掉历史内联样式，避免盖住状态类。
      btn.attr("style", "");
      deps.$(this).attr("data-match-state", matchState);
    });
  }
}

export function syncWiPresetTrackingForManualToggleCore(
  bookName,
  isActive,
  deps,
) {
  const presets = deps.getWiActivePresets();
  const settings = deps.extensionSettings[deps.extensionName];
  const applied = settings._wiAppliedPresetIndices || [];
  const activeWorldNames = deps.getActiveWorldNamesFromLegacyWorldNames();
  const activeSet = new Set(activeWorldNames);

  let nextApplied = isActive
    ? [...applied]
    : applied.filter(
        (idx) => !(presets[idx] && presets[idx].books.includes(bookName)),
      );

  if (isActive) {
    presets.forEach((preset, idx) => {
      const hasBindings =
        preset &&
        ((preset.bindChars && preset.bindChars.length > 0) ||
          (preset.bindPresets && preset.bindPresets.length > 0) ||
          (preset.bindChats && preset.bindChats.length > 0));
      if (
        preset &&
        preset.scope !== "global" &&
        hasBindings &&
        preset.books.includes(bookName) &&
        preset.books.every((b) => activeSet.has(b)) &&
        !nextApplied.includes(idx)
      ) {
        nextApplied.push(idx);
      }
    });
  }

  const changed =
    nextApplied.length !== applied.length ||
    nextApplied.some((idx, i) => idx !== applied[i]);

  if (changed) {
    settings._wiAppliedPresetIndices = nextApplied;
    deps.saveSettingsDebounced();
  }

  updateWiPresetPanelApplyButtons(deps, presets, activeSet);
}

export function refreshAllWiPresetTrackingStateCore(deps) {
  const presets = deps.getWiActivePresets();
  const activeSet = deps.getActiveWorldInfoSet();
  const settings = deps.extensionSettings[deps.extensionName];
  const applied = settings._wiAppliedPresetIndices || [];

  const nextApplied = applied.filter((idx) => {
    const preset = presets[idx];
    return preset && preset.books.every((b) => activeSet.has(b));
  });

  presets.forEach((preset, idx) => {
    if (!preset || nextApplied.includes(idx)) return;
    const hasBindings =
      (preset.bindChars && preset.bindChars.length > 0) ||
      (preset.bindPresets && preset.bindPresets.length > 0) ||
      (preset.bindChats && preset.bindChats.length > 0);
    if (
      preset.scope !== "global" &&
      hasBindings &&
      preset.books.every((b) => activeSet.has(b))
    ) {
      nextApplied.push(idx);
    }
  });

  const changed =
    nextApplied.length !== applied.length ||
    nextApplied.some((idx, i) => idx !== applied[i]);

  if (changed) {
    settings._wiAppliedPresetIndices = nextApplied;
    deps.saveSettingsDebounced();
  }

  updateWiPresetPanelApplyButtons(deps, presets, activeSet);
}
