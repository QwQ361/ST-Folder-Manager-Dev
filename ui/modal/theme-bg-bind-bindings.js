// 主题批量绑定背景按钮事件绑定：承接主题页"批量绑定背景"按钮的模式切换。
//
// 统一行为模式（与备注/重命名按钮一致）：
//   1. 若模式未激活 → 调用 enterThemeBgBindMode() 进入模式（按钮变活跃色，等待用户点选主题）
//   2. 若模式已激活且未选中主题 → warning toast 提示先选择
//   3. 若模式已激活且有选中主题 → executeThemeBgBind(names).then(() => exitThemeBgBindMode())

export function bindThemeBgBindButtonEvent(popup, deps) {
  const {
    cfmToastr,
    getCfmThemeBgBindMode,
    getCfmThemeBgBindSelected,
    executeThemeBgBind,
    exitThemeBgBindMode,
    enterThemeBgBindMode,
  } = deps;

  popup.find("#cfm-theme-bg-bind-btn").on("click touchend", function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (getCfmThemeBgBindMode()) {
      if (getCfmThemeBgBindSelected().size === 0) {
        cfmToastr.warning("请先选择要绑定背景的主题");
        return;
      }
      const names = Array.from(getCfmThemeBgBindSelected());
      executeThemeBgBind(names).then(() => exitThemeBgBindMode());
    } else {
      enterThemeBgBindMode();
    }
  });
}
