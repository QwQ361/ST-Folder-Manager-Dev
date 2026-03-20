async function renderRegexView() {
  const treeEl = $("#cfm-regex-left-tree");
  const rightList = $("#cfm-regex-right-list");
  const rhPath = $("#cfm-regex-rh-path");
  const rhCount = $("#cfm-regex-rh-count");
  if (!treeEl.length) return;

  // --- 收集数据 ---
  ensureResourceSettings();
  const globalScripts = getRegexGlobalScripts();
  const folderTree = extension_settings[extensionName].regexFolderTree;
  const globalGroups = extension_settings[extensionName].regexGlobalGroups;
  const presetsWithRegex = scanAllPresetsForRegex();
  const charsWithRegex = scanAllCharsForRegex();

  // --- 辅助：设置右栏内容 ---
  function setRightPane(title, count, contentHtml) {
    rhPath.text(title);
    rhCount.text(count > 0 ? `(${count})` : "");
    rightList.html(
      contentHtml || '<div class="cfm-right-empty">暂无正则脚本</div>',
    );
  }

  // --- 构建左侧统一树 ---
  let html = "";
  regexAllNodeIds = [];

  // ===== 1. 全局正则顶层节点 =====
  const globalTotal = globalScripts.length;
  regexAllNodeIds.push("rx-global");
  const isGlobalExp = regexExpandedNodes.has("rx-global");
  html += buildRegexTreeNodeHtml(
    "rx-global",
    "全局正则",
    "fa-globe",
    globalTotal,
    0,
    true,
    isGlobalExp,
    selectedRegexNode === "rx-global",
    "cfm-regex-top-node",
  );

  if (isGlobalExp) {
    // 全局文件夹辅助函数
    function sortGlobalFolders(folderIds) {
      return [...folderIds].sort((a, b) => {
        const oa = folderTree[a]?.sortOrder ?? 0;
        const ob = folderTree[b]?.sortOrder ?? 0;
        if (oa !== ob) return oa - ob;
        return (folderTree[a]?.displayName || a).localeCompare(
          folderTree[b]?.displayName || b,
          "zh-CN",
        );
      });
    }
    function getGlobalChildFolders(parentId) {
      return Object.keys(folderTree).filter(
        (id) => folderTree[id].parentId === parentId,
      );
    }
    function countScriptsInFolder(folderId) {
      let c = globalScripts.filter(
        (s) => globalGroups[s.id] === folderId,
      ).length;
      for (const childId of getGlobalChildFolders(folderId))
        c += countScriptsInFolder(childId);
      return c;
    }
    function renderGlobalFolderNodes(parentId, level) {
      const childIds = sortGlobalFolders(getGlobalChildFolders(parentId));
      for (const fid of childIds) {
        const displayName = folderTree[fid]?.displayName || fid;
        const subChildren = getGlobalChildFolders(fid);
        const count = countScriptsInFolder(fid);
        const nodeId = "rx-gf-" + fid;
        const isExpanded = regexExpandedNodes.has(nodeId);
        const hasChildren = subChildren.length > 0;
        regexAllNodeIds.push(nodeId);
        html += buildRegexTreeNodeHtml(
          nodeId,
          displayName,
          "fa-folder",
          count,
          level,
          hasChildren,
          isExpanded,
          selectedRegexNode === nodeId,
          "",
        );
        if (hasChildren && isExpanded) renderGlobalFolderNodes(fid, level + 1);
      }
    }
    renderGlobalFolderNodes(null, 1);

    // 全局未归类
    const topFolders = Object.keys(folderTree).filter(
      (id) => !folderTree[id].parentId,
    );
    if (topFolders.length > 0) {
      const uncatGlobal = globalScripts.filter(
        (s) => !globalGroups[s.id] || !folderTree[globalGroups[s.id]],
      );
      html += buildRegexTreeNodeHtml(
        "rx-global-uncat",
        "未归类",
        "fa-inbox",
        uncatGlobal.length,
        1,
        false,
        false,
        selectedRegexNode === "rx-global-uncat",
        "",
      );
    }
  }

  // ===== 2. 预设正则顶层节点 =====
  const presetTotalScripts = Array.from(presetsWithRegex.values()).reduce(
    (sum, s) => sum + s.length,
    0,
  );
  regexAllNodeIds.push("rx-preset");
  const isPresetExp = regexExpandedNodes.has("rx-preset");
  html += buildRegexTreeNodeHtml(
    "rx-preset",
    "预设正则",
    "fa-sliders",
    presetTotalScripts,
    0,
    true,
    isPresetExp,
    selectedRegexNode === "rx-preset",
    "cfm-regex-top-node",
  );

  if (isPresetExp && presetsWithRegex.size > 0) {
    const markedPresetFolders = buildPrunedFolderSet(
      "presets",
      new Set(presetsWithRegex.keys()),
    );
    const presetGroups = getResourceGroups("presets");
    const presetTree = getResFolderTree("presets");

    function renderPresetFolderNodes(parentId, level) {
      let childIds;
      if (parentId === null) {
        childIds = Object.keys(presetTree).filter(
          (id) => !presetTree[id].parentId,
        );
      } else {
        childIds = Object.keys(presetTree).filter(
          (id) => presetTree[id].parentId === parentId,
        );
      }
      childIds = childIds.filter((id) => markedPresetFolders.has(id));
      childIds = sortResFolders("presets", childIds);

      for (const fid of childIds) {
        const displayName = getResFolderDisplayName("presets", fid);
        const subChildIds = Object.keys(presetTree)
          .filter((id) => presetTree[id].parentId === fid)
          .filter((id) => markedPresetFolders.has(id));
        const nodeId = "rx-pf-" + fid;
        const isExpanded = regexExpandedNodes.has(nodeId);
        const presetsInFolder = [];
        for (const [pName] of presetsWithRegex) {
          if (presetGroups[pName] === fid) presetsInFolder.push(pName);
        }
        const hasChildren =
          subChildIds.length > 0 || presetsInFolder.length > 0;
        regexAllNodeIds.push(nodeId);
        html += buildRegexTreeNodeHtml(
          nodeId,
          displayName,
          "fa-folder",
          null,
          level,
          hasChildren,
          isExpanded,
          selectedRegexNode === nodeId,
          "cfm-regex-synced-folder",
        );

        if (isExpanded) {
          renderPresetFolderNodes(fid, level + 1);
          for (const pName of presetsInFolder) {
            const sc = presetsWithRegex.get(pName);
            const piNodeId = "rx-pi-" + pName;
            html += buildRegexTreeNodeHtml(
              piNodeId,
              pName,
              "fa-file-code",
              sc.length,
              level + 1,
              false,
              false,
              selectedRegexNode === piNodeId,
              "cfm-regex-item-node",
            );
          }
        }
      }
    }
    renderPresetFolderNodes(null, 1);

    // 预设未归类
    const uncatPresets = [];
    for (const [pName] of presetsWithRegex) {
      const fid = presetGroups[pName];
      if (!fid || !presetTree[fid]) uncatPresets.push(pName);
    }
    if (uncatPresets.length > 0) {
      const isUncatExp = regexExpandedNodes.has("rx-preset-uncat");
      regexAllNodeIds.push("rx-preset-uncat");
      html += buildRegexTreeNodeHtml(
        "rx-preset-uncat",
        "未归类",
        "fa-inbox",
        uncatPresets.length,
        1,
        true,
        isUncatExp,
        selectedRegexNode === "rx-preset-uncat",
        "",
      );
      if (isUncatExp) {
        for (const pName of uncatPresets) {
          const sc = presetsWithRegex.get(pName);
          const piNodeId = "rx-pi-" + pName;
          html += buildRegexTreeNodeHtml(
            piNodeId,
            pName,
            "fa-file-code",
            sc.length,
            2,
            false,
            false,
            selectedRegexNode === piNodeId,
            "cfm-regex-item-node",
          );
        }
      }
    }
  }

  // ===== 3. 角色正则顶层节点 =====
  const scopedTotalScripts = Array.from(charsWithRegex.values()).reduce(
    (sum, info) => sum + info.scripts.length,
    0,
  );
  regexAllNodeIds.push("rx-scoped");
  const isScopedExp = regexExpandedNodes.has("rx-scoped");
  html += buildRegexTreeNodeHtml(
    "rx-scoped",
    "角色正则",
    "fa-user",
    scopedTotalScripts,
    0,
    true,
    isScopedExp,
    selectedRegexNode === "rx-scoped",
    "cfm-regex-top-node",
  );

  if (isScopedExp && charsWithRegex.size > 0) {
    const markedCharFolders = buildPrunedFolderSet(
      "chars",
      new Set(charsWithRegex.keys()),
    );

    function renderCharFolderNodes(parentId, level) {
      let childFolderIds;
      if (parentId === null) {
        childFolderIds = getTopLevelFolders();
      } else {
        childFolderIds = getChildFolders(parentId);
      }
      childFolderIds = childFolderIds.filter((id) => markedCharFolders.has(id));
      childFolderIds = sortFolders(childFolderIds);

      for (const fid of childFolderIds) {
        const displayName = getTagName(fid);
        const subChildren = getChildFolders(fid).filter((id) =>
          markedCharFolders.has(id),
        );
        const nodeId = "rx-sf-" + fid;
        const isExpanded = regexExpandedNodes.has(nodeId);
        const charsInFolder = getCharactersInFolder(fid).filter((c) =>
          charsWithRegex.has(c.avatar),
        );
        const hasChildren = subChildren.length > 0 || charsInFolder.length > 0;
        regexAllNodeIds.push(nodeId);
        html += buildRegexTreeNodeHtml(
          nodeId,
          displayName,
          "fa-folder",
          null,
          level,
          hasChildren,
          isExpanded,
          selectedRegexNode === nodeId,
          "cfm-regex-synced-folder",
        );

        if (isExpanded) {
          renderCharFolderNodes(fid, level + 1);
          for (const char of charsInFolder) {
            const info = charsWithRegex.get(char.avatar);
            const siNodeId = "rx-si-" + char.avatar;
            html += buildRegexTreeNodeHtml(
              siNodeId,
              info.name,
              "fa-user",
              info.scripts.length,
              level + 1,
              false,
              false,
              selectedRegexNode === siNodeId,
              "cfm-regex-item-node",
            );
          }
        }
      }
    }
    renderCharFolderNodes(null, 1);

    // 角色未归类
    const uncatChars = getUncategorizedCharacters().filter((c) =>
      charsWithRegex.has(c.avatar),
    );
    if (uncatChars.length > 0) {
      const isUncatExp = regexExpandedNodes.has("rx-scoped-uncat");
      regexAllNodeIds.push("rx-scoped-uncat");
      html += buildRegexTreeNodeHtml(
        "rx-scoped-uncat",
        "未归类",
        "fa-inbox",
        uncatChars.length,
        1,
        true,
        isUncatExp,
        selectedRegexNode === "rx-scoped-uncat",
        "",
      );
      if (isUncatExp) {
        for (const char of uncatChars) {
          const info = charsWithRegex.get(char.avatar);
          const siNodeId = "rx-si-" + char.avatar;
          html += buildRegexTreeNodeHtml(
            siNodeId,
            info.name,
            "fa-user",
            info.scripts.length,
            2,
            false,
            false,
            selectedRegexNode === siNodeId,
            "cfm-regex-item-node",
          );
        }
      }
    }
  }

  treeEl.html(html);

  // --- 绑定树节点点击事件 ---
  treeEl.find(".cfm-regex-tree-node").on("click", function (e) {
    const nodeId = $(this).data("node-id");

    // 箭头点击：展开/折叠
    if ($(e.target).hasClass("cfm-regex-tree-arrow")) {
      if (regexExpandedNodes.has(nodeId)) regexExpandedNodes.delete(nodeId);
      else regexExpandedNodes.add(nodeId);
      renderRegexView();
      return;
    }

    // 选中节点
    selectedRegexNode = nodeId;
    treeEl
      .find(".cfm-regex-tree-selected")
      .removeClass("cfm-regex-tree-selected");
    $(this).addClass("cfm-regex-tree-selected");

    // --- 根据节点ID决定右栏内容 ---

    // == 全局正则相关节点 ==
    if (nodeId === "rx-global") {
      let cardsHtml = "";
      globalScripts.forEach((s) => {
        cardsHtml += buildRegexScriptCardHtml(s, 0, "");
      });
      setRightPane("全局正则 — 全部", globalScripts.length, cardsHtml);
    } else if (nodeId === "rx-global-uncat") {
      const uncat = globalScripts.filter(
        (s) => !globalGroups[s.id] || !folderTree[globalGroups[s.id]],
      );
      let cardsHtml = "";
      uncat.forEach((s) => {
        cardsHtml += buildRegexScriptCardHtml(s, 0, "");
      });
      setRightPane("全局正则 — 未归类", uncat.length, cardsHtml);
    } else if (nodeId.startsWith("rx-gf-")) {
      const fid = nodeId.slice(6);
      function getGlobalChildFoldersClick(parentId) {
        return Object.keys(folderTree).filter(
          (id) => folderTree[id].parentId === parentId,
        );
      }
      function getScriptsRecursive(folderId) {
        let res = globalScripts.filter((s) => globalGroups[s.id] === folderId);
        for (const childId of getGlobalChildFoldersClick(folderId))
          res = res.concat(getScriptsRecursive(childId));
        return res;
      }
      const filtered = getScriptsRecursive(fid);
      let cardsHtml = "";
      filtered.forEach((s) => {
        cardsHtml += buildRegexScriptCardHtml(s, 0, "");
      });
      setRightPane(
        "全局正则 — " + (folderTree[fid]?.displayName || fid),
        filtered.length,
        cardsHtml,
      );
    }

    // == 预设正则相关节点 ==
    else if (nodeId === "rx-preset") {
      let groupedHtml = "";
      let total = 0;
      for (const [pName, scripts] of presetsWithRegex) {
        total += scripts.length;
        groupedHtml += `<div class="cfm-regex-group-header"><i class="fa-solid fa-file-code"></i> ${escapeHtml(pName)} (${scripts.length})</div>`;
        scripts.forEach((s) => {
          groupedHtml += buildRegexScriptCardHtml(s, 2, pName);
        });
      }
      setRightPane("预设正则 — 全部", total, groupedHtml);
    } else if (nodeId.startsWith("rx-pi-")) {
      const pName = nodeId.slice(6);
      const scripts = presetsWithRegex.get(pName) || [];
      let cardsHtml = "";
      scripts.forEach((s) => {
        cardsHtml += buildRegexScriptCardHtml(s, 2, pName);
      });
      setRightPane("预设正则 — " + pName, scripts.length, cardsHtml);
    } else if (nodeId.startsWith("rx-pf-") || nodeId === "rx-preset-uncat") {
      const fid = nodeId === "rx-preset-uncat" ? null : nodeId.slice(6);
      const presetGroups2 = getResourceGroups("presets");
      const presetTree2 = getResFolderTree("presets");
      const title =
        fid === null ? "未归类" : getResFolderDisplayName("presets", fid);
      function collectPresetsInFolder(parentFid) {
        const names = [];
        for (const [pName] of presetsWithRegex) {
          if (parentFid === null) {
            const g = presetGroups2[pName];
            if (!g || !presetTree2[g]) names.push(pName);
          } else {
            if (presetGroups2[pName] === parentFid) names.push(pName);
          }
        }
        if (parentFid !== null) {
          const childFids = Object.keys(presetTree2).filter(
            (id) => presetTree2[id].parentId === parentFid,
          );
          for (const cfid of childFids)
            names.push(...collectPresetsInFolder(cfid));
        }
        return names;
      }
      const presetNames = collectPresetsInFolder(fid);
      let groupedHtml = "";
      let total = 0;
      for (const pName of presetNames) {
        const sc = presetsWithRegex.get(pName);
        if (!sc) continue;
        total += sc.length;
        groupedHtml += `<div class="cfm-regex-group-header"><i class="fa-solid fa-file-code"></i> ${escapeHtml(pName)} (${sc.length})</div>`;
        sc.forEach((s) => {
          groupedHtml += buildRegexScriptCardHtml(s, 2, pName);
        });
      }
      setRightPane("预设正则 — " + title, total, groupedHtml);
    }

    // == 角色正则相关节点 ==
    else if (nodeId === "rx-scoped") {
      let groupedHtml = "";
      let total = 0;
      for (const [avatar, info] of charsWithRegex) {
        total += info.scripts.length;
        groupedHtml += `<div class="cfm-regex-group-header"><i class="fa-solid fa-user"></i> ${escapeHtml(info.name)} (${info.scripts.length})</div>`;
        info.scripts.forEach((s) => {
          groupedHtml += buildRegexScriptCardHtml(s, 1, info.name);
        });
      }
      setRightPane("角色正则 — 全部", total, groupedHtml);
    } else if (nodeId.startsWith("rx-si-")) {
      const avatar = nodeId.slice(6);
      const info = charsWithRegex.get(avatar);
      if (info) {
        let cardsHtml = "";
        info.scripts.forEach((s) => {
          cardsHtml += buildRegexScriptCardHtml(s, 1, info.name);
        });
        setRightPane("角色正则 — " + info.name, info.scripts.length, cardsHtml);
      } else {
        setRightPane("", 0, "");
      }
    } else if (nodeId.startsWith("rx-sf-") || nodeId === "rx-scoped-uncat") {
      const fid = nodeId === "rx-scoped-uncat" ? null : nodeId.slice(6);
      const title = fid === null ? "未归类" : getTagName(fid);
      function collectCharsInFolder(folderTagId) {
        const avatars = [];
        if (folderTagId === null) {
          const uc = getUncategorizedCharacters().filter((c) =>
            charsWithRegex.has(c.avatar),
          );
          uc.forEach((c) => avatars.push(c.avatar));
        } else {
          const charsHere = getCharactersInFolder(folderTagId).filter((c) =>
            charsWithRegex.has(c.avatar),
          );
          charsHere.forEach((c) => avatars.push(c.avatar));
          for (const childId of getChildFolders(folderTagId))
            avatars.push(...collectCharsInFolder(childId));
        }
        return avatars;
      }
      const avatars = collectCharsInFolder(fid);
      let groupedHtml = "";
      let total = 0;
      for (const avatar of avatars) {
        const info = charsWithRegex.get(avatar);
        if (!info) continue;
        total += info.scripts.length;
        groupedHtml += `<div class="cfm-regex-group-header"><i class="fa-solid fa-user"></i> ${escapeHtml(info.name)} (${info.scripts.length})</div>`;
        info.scripts.forEach((s) => {
          groupedHtml += buildRegexScriptCardHtml(s, 1, info.name);
        });
      }
      setRightPane("角色正则 — " + title, total, groupedHtml);
    }
  });

  // --- 自动选中之前选中的节点 ---
  const targetNode = treeEl.find(`[data-node-id="${selectedRegexNode}"]`);
  if (targetNode.length) {
    targetNode.trigger("click");
  } else {
    // 回退到第一个节点
    selectedRegexNode = "rx-global";
    treeEl.find(".cfm-regex-tree-node").first().trigger("click");
  }
}
