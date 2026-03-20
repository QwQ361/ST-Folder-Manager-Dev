# 正则标签页 — 详细架构设计

## 一、总体设计

正则标签页采用**三区域**左侧树结构，与其他标签页的「收藏/文件夹/未归类」模式完全不同：

```
📁 全局正则 (Global)
│   ├── 📁 用户创建的子文件夹...
│   └── 未归类的全局脚本
📁 预设正则 (Preset)
│   ├── 📁 同步自预设页的文件夹结构（裁剪后）
│   │   └── 📂 预设A（含正则脚本的预设作为容器）
│   └── 📂 未归类的含正则预设
📁 角色正则 (Scoped)
    ├── 📁 同步自角色页的文件夹结构（裁剪后）
    │   └── 📂 角色B（含正则脚本的角色作为容器）
    └── 📂 未归类的含正则角色
```

---

## 二、左侧树结构详解

### 2.1 全局正则区域

**数据源**: `extension_settings.regex[]`

**文件夹系统**: 独立的虚拟文件夹，存储在 `extension_settings[extensionName].regexFolderTree` 和 `regexGlobalGroups`

**行为规则**:

- 点击「全局正则」顶层节点 → 右栏显示所有全局脚本
- 点击子文件夹 → 右栏显示该文件夹内的全局脚本（递归）
- 点击「未归类」→ 右栏显示未分组的全局脚本
- 设置按钮创建的文件夹都在全局正则区域下
- 支持拖拽排序和移动脚本到文件夹

**数据存储**:

```javascript
extension_settings[extensionName].regexFolderTree = {
  'folder-uuid-1': { parentId: null, displayName: '文本处理', sortOrder: 0 },
  'folder-uuid-2': { parentId: 'folder-uuid-1', displayName: '格式化', sortOrder: 0 },
};
extension_settings[extensionName].regexGlobalGroups = {
  'script-uuid-1': 'folder-uuid-1',  // scriptId → folderId
};
```

### 2.2 预设正则区域

**数据源**: 通过 `pm.readPresetExtensionField({ name, path: 'regex_scripts' })` 遍历所有预设

**文件夹系统**: 单向镜像自预设标签页的 `resourceFolderTree.presets`，经过**裁剪**

**裁剪规则**: 只显示包含至少一个有正则脚本的预设的分支。自底向上遍历：

1. 标记每个预设是否含正则脚本
2. 标记含正则预设所在的文件夹及其所有祖先
3. 只渲染被标记的文件夹节点

**裁剪示例**:

```
预设页:                     正则页（裁剪后）:
📁 常用                     📁 常用
├── PresetA ✅有正则          ├── 📂 PresetA
├── PresetB ❌无正则
📁 测试                     📁 测试
├── 📁 子分类               ├── 📁 子分类
│   ├── PresetC ✅有正则      │   └── 📂 PresetC
│   └── PresetD ❌无正则
📁 归档                     （整个归档隐藏）
└── PresetE ❌无正则
```

**行为**: 文件夹结构只读，不可在正则页修改。预设 📂 作为容器显示其绑定的脚本。

### 2.3 角色正则区域

**数据源**: 遍历 `characters[]`，检查 `char.data?.extensions?.regex_scripts`

**文件夹系统**: 单向镜像自角色标签页的 Tag 文件夹树，经过**裁剪**

**裁剪规则**: 与预设正则完全一致，替换数据源为角色 + Tag 文件夹树

**差异**: 角色文件夹基于 Tag 系统（`getTopLevelFolders`, `getChildFolders`, `getTagName`），预设文件夹基于 `resourceFolderTree`

### 2.4 视觉区分

| 节点类型                    | 图标                       | 颜色/样式   |
| --------------------------- | -------------------------- | ----------- |
| 区域标题（全局/预设/角色）  | 无箭头，粗体               | 强调色背景  |
| 用户文件夹（全局区域）      | `fa-folder`                | 标准色      |
| 同步文件夹（预设/角色区域） | `fa-folder` + 🔗            | 灰色/半透明 |
| 预设容器                    | `fa-file-code`             | 预设主题色  |
| 角色容器                    | `fa-user` 或角色头像缩略图 | 角色主题色  |
| 未归类                      | `fa-inbox`                 | 标准色      |

---

## 三、右侧列表渲染

### 3.1 脚本列表项显示

```
┌─────────────────────────────────────────────────────┐
│ [☐] [✓/✗] 脚本名称          [Global|Scoped|Preset] [⭐] │
│     查找: /pattern/gi  →  替换: replacement          │
│     位置: 用户输入, AI输出   深度: 0-∞               │
└─────────────────────────────────────────────────────┘
```

### 3.2 不同选中节点的右栏内容

| 左侧选中节点   | 右栏显示                           |
| -------------- | ---------------------------------- |
| 全局正则 顶层  | 所有全局脚本                       |
| 全局子文件夹   | 该文件夹内脚本（递归）             |
| 全局-未归类    | 未分组的全局脚本                   |
| 预设正则 顶层  | 所有含正则的预设概览               |
| 预设同步文件夹 | 该文件夹下所有含正则预设的脚本汇总 |
| 预设容器 📂     | 该预设绑定的正则脚本列表           |
| 角色正则 顶层  | 所有含正则的角色概览               |
| 角色同步文件夹 | 汇总                               |
| 角色容器 📂     | 该角色绑定的正则脚本列表           |

---

## 四、操作系统

### 4.1 操作矩阵

| 操作          | 全局         | 预设         | 角色         |
| ------------- | ------------ | ------------ | ------------ |
| 创建脚本      | ✅            | ✅            | ✅            |
| 编辑脚本      | ✅            | ✅            | ✅            |
| 删除脚本      | ✅ 需确认     | ✅ 需确认     | ✅ 需确认     |
| 启用/禁用     | ✅            | ✅            | ✅            |
| 导出/批量导出 | ✅            | ✅            | ✅            |
| 导入          | ✅            | ✅            | ✅            |
| 移动/复制     | ✅ 跨区需确认 | ✅ 跨区需确认 | ✅ 跨区需确认 |
| 文件夹管理    | ✅ 可创建删除 | ❌ 只读镜像   | ❌ 只读镜像   |

### 4.2 跨区域移动/复制确认

所有跨区域操作都需要确认弹窗，因为涉及绑定变更：

**移动**: 从源解除绑定 + 绑定到目标

- 示例: 「将脚本从全局移至预设A，将取消全局生效并绑定到预设A，是否确认？」

**复制**: 保留源绑定 + 同时绑定到目标

- 示例: 「将脚本复制到预设A并自动绑定，是否确认？」

**删除**: 从对应列表中移除

- 示例: 「确定删除脚本「文本清理」？此操作不可撤销。」

### 4.3 原生编辑器弹窗集成

编辑脚本调用 `onRegexEditorOpenClick(scriptId, scriptType)`，该函数内部使用 `callGenericPopup` 打开编辑器模态窗口。由于插件本身也是 `callGenericPopup` 打开的，原生编辑器会叠加在插件之上，关闭后插件窗口仍然存在。

---

## 五、数据流与技术实现

### 5.1 扫描函数

```javascript
// 扫描所有预设的正则脚本（同步，从内存读取）
function scanAllPresetsForRegex() {
  const pm = getContext().getPresetManager();
  const presets = getCurrentPresets();
  const result = new Map(); // presetName -> scripts[]
  for (const preset of presets) {
    const scripts = pm.readPresetExtensionField({ name: preset.name, path: 'regex_scripts' });
    if (Array.isArray(scripts) && scripts.length > 0)
      result.set(preset.name, scripts);
  }
  return result;
}

// 扫描所有角色的正则脚本（同步，从内存读取）
function scanAllCharsForRegex() {
  const chars = getContext().characters;
  const result = new Map(); // avatar -> { name, chid, scripts[] }
  for (let i = 0; i < chars.length; i++) {
    const scripts = chars[i]?.data?.extensions?.regex_scripts;
    if (Array.isArray(scripts) && scripts.length > 0)
      result.set(chars[i].avatar, { name: chars[i].name, chid: i, scripts });
  }
  return result;
}
```

### 5.2 裁剪树构建

```javascript
function buildPrunedTree(sourceType, itemsWithRegex) {
  const adapter = getFolderAdapter(sourceType);
  // 1. 标记含正则项目的文件夹及其祖先
  const markedFolders = new Set();
  for (const itemId of itemsWithRegex) {
    let folderId = adapter.getItemFolder(itemId);
    while (folderId) {
      markedFolders.add(folderId);
      folderId = adapter.getParent(folderId);
    }
  }
  // 2. 只渲染被标记的文件夹
  return markedFolders;
}
```

### 5.3 统一文件夹适配器

```javascript
function getFolderAdapter(sourceType) {
  if (sourceType === 'chars') {
    return {
      getTopLevel: () => sortFolders(getTopLevelFolders()),
      getChildren: id => getChildFolders(id),
      getName: id => getTagName(id),
      getParent: id => /* tag parent lookup */,
      getItemFolder: avatar => /* tag lookup for char */,
    };
  } else {
    return {
      getTopLevel: () => sortResFolders('presets', getResTopLevelFolders('presets')),
      getChildren: id => getResChildFolders('presets', id),
      getName: id => getResFolderDisplayName('presets', id),
      getParent: id => getResFolderTree('presets')[id]?.parentId || null,
      getItemFolder: name => getResourceGroups('presets')[name] || null,
    };
  }
}
```

### 5.4 保存操作

| 脚本类型 | 保存方式                                                                        |
| -------- | ------------------------------------------------------------------------------- |
| Global   | `extension_settings.regex = scripts; saveSettings()`                            |
| Scoped   | `writeExtensionField(chid, 'regex_scripts', scripts)`                           |
| Preset   | `pm.writePresetExtensionField({ name, path: 'regex_scripts', value: scripts })` |

### 5.5 缓存策略

扫描结果使用 `regexScanCache`，在以下时机失效：

- 切换到正则标签页
- 执行移动/复制/删除操作后
- 预设/角色变更事件

---

## 六、状态管理

```javascript
let selectedRegexSection = null;    // 'global' | 'preset' | 'scoped'
let selectedRegexNode = null;       // 当前选中节点ID
let regexExpandedNodes = new Set();  // 展开的节点ID

// 节点ID命名:
// 'global' / 'global-folder-uuid' / 'global-uncategorized'
// 'preset' / 'preset-folder-xxx' / 'preset-item-presetName'
// 'scoped' / 'scoped-folder-xxx' / 'scoped-item-avatar'
```

---

## 七、脚本执行顺序管理

### 7.1 背景

酒馆原生正则系统中，脚本数组的索引顺序就是执行顺序。插件的文件夹分组是**纯视觉组织**，不影响实际执行顺序。

### 7.2 预设/角色正则的排序

右栏脚本列表中，每个脚本卡片旁边显示**上下箭头按钮**（方便移动端操作）+ 支持**拖拽排序**：

```
┌───────────────────────────────────────────────┐
│ [↑] [↓]  [✓] 脚本名称     [Preset] [⭐]     │
│           查找: /pattern/  →  替换: text     │
└───────────────────────────────────────────────┘
```

排序变更直接调用 `saveScriptsByType` 保存新顺序。

### 7.3 全局正则的执行顺序弹窗

由于全局正则有子文件夹，文件夹视图无法反映真实执行顺序。因此增加一个**「执行顺序」按钮**（仅在全局正则区域时显示），点击弹出独立弹窗：

```
┌─────────────────────────────────────────────┐
│  📋 全局正则执行顺序                          │
│                                             │
│  显示方式：忽略文件夹分组，按原始数组顺序排列   │
│                                             │
│  [↑][↓] 1. 文本清理脚本                      │
│  [↑][↓] 2. 格式化输出                        │
│  [↑][↓] 3. HTML标签过滤                      │
│  [↑][↓] 4. 特殊符号处理                      │
│  ...                                        │
│                                             │
│  支持拖拽重排 + 上下箭头                      │
│                                             │
│          [取消]    [保存顺序]                 │
└─────────────────────────────────────────────┘
```

弹窗数据源：`extension_settings.regex[]`（即酒馆原生全局正则列表的原始顺序）。

保存时调用 `saveScriptsByType(reorderedScripts, SCRIPT_TYPES.GLOBAL)` 更新顺序。

---

## 八、已确认的设计决策

1. **预设范围**: ✅ 只显示当前 API 的预设（与预设标签页一致）
2. **角色容器显示**: ✅ 显示角色头像缩略图（而非纯图标）
3. **搜索**: ✅ 搜索脚本名和文件夹名，支持模糊搜索（与其他标签页搜索逻辑一致）
4. **批量操作**: ✅ 支持跨区域的批量移动/复制（需确认弹窗）
5. **全局正则文件夹**: ✅ 支持用户创建子文件夹分组，设置中创建的文件夹都在全局区域下
6. **跨区域移动/复制**: ✅ 所有移动/复制/删除操作都需确认弹窗（因涉及绑定变更）
7. **编辑器集成**: ✅ 弹出原生正则编辑器作为覆盖层，不关闭插件页面
