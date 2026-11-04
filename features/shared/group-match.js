// 激活分组「符合度」三态判定：世界书 / 正则 / 快速回复 / 预设条目共用同一套口径，
// 避免各面板各写一份判定导致颜色语义漂移。

/**
 * 计算一个已保存的激活分组与当前激活状态的符合度。
 *
 * 判定只依据「条目激活情况」，不看历史「已应用」记录：
 *
 * - `none`（无色）：分组内**存在未激活**的条目。
 *   例：分组含 b、c，当前只激活 b → c 未激活，整组视为不成立，显示无色。
 * - `partial`（黄色）：分组条目**全部**激活，但当前激活的条目比分组多（不完全一致）。
 *   例：分组含 a，当前激活 a、b → 分组条目都激活却多出 b，显示黄色。
 * - `full`（绿色）：分组条目与当前激活条目「双向相等」——数量相同且全部命中。
 *   例：分组含 a、b，当前正好激活 a、b → 绿色。
 *
 * @param {string[]} groupItems 分组内条目键（世界书名 / 正则 id / 快速回复集名 / 预设字段键）
 * @param {Iterable<string>|Set<string>} activeItems 当前激活条目集合
 * @returns {"full"|"partial"|"none"}
 */
export function getGroupMatchState(groupItems, activeItems) {
  const items = Array.isArray(groupItems)
    ? groupItems.filter(
        (item) => item !== undefined && item !== null && item !== "",
      )
    : [];
  if (items.length === 0) return "none";
  const activeSet =
    activeItems instanceof Set ? activeItems : new Set(activeItems || []);
  // 分组数据可能含重复项（历史数据或手工导入），去重后再比数量，避免误判为 full。
  const uniqueItems = Array.from(new Set(items));
  // 只要有一条未激活，整组就不成立（无色优先于黄色）。
  if (!uniqueItems.every((item) => activeSet.has(item))) return "none";
  // 分组条目全激活：数量也相同才是完全符合，否则当前激活多出了额外条目。
  if (uniqueItems.length === activeSet.size) return "full";
  return "partial";
}

/**
 * 三态对应的 CSS 类（`cfm-wi-preset-apply` 为主类，`cfm-wi-preset-apply-active`
 * 与 `cfm-wi-preset-apply-partial` 为状态类，颜色统一由 style.css 控制）。
 *
 * @param {"full"|"partial"|"none"} matchState
 * @param {string} [baseClass] 主类名，快速回复面板使用 `cfm-qr-preset-apply`
 * @returns {string}
 */
export function getGroupMatchClassName(
  matchState,
  baseClass = "cfm-wi-preset-apply",
) {
  if (matchState === "full") return `${baseClass} cfm-wi-preset-apply-active`;
  if (matchState === "partial")
    return `${baseClass} cfm-wi-preset-apply-partial`;
  return baseClass;
}

/**
 * 三态对应的悬浮提示文案（说明「为什么不是完全符合」）。
 *
 * @param {"full"|"partial"|"none"} matchState
 * @param {{ full?: string, partial?: string, none?: string }} [labels]
 * @returns {string}
 */
export function getGroupMatchTitle(matchState, labels = {}) {
  if (matchState === "full") {
    return labels.full || "完全符合：条目与当前激活状态一致";
  }
  if (matchState === "partial") {
    return (
      labels.partial ||
      "不完全符合：分组条目已全部激活，但当前还激活了额外条目"
    );
  }
  return labels.none || "分组内仍有条目未激活";
}
