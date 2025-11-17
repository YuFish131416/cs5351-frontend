# 技术债务前端重写方案（文件级模型）

## 目标
将现有“项目面板 + 项目级别缓存”模式重构为“文件为中心”的体验：
- 在代码文件内直接可视化技术债务（行内装饰、CodeLens、Hover、诊断）。
- 通过右键菜单 / 行内按钮快速执行：扫描当前文件、标记债务状态、查看文件债务详情、聚合整个工作区的债务。
- 避免显式“项目”概念给用户；后台仍需要 `/projects` 用于定位与分析，但前端将自动创建 / 复用一个隐式项目（按 workspace root 路径）。
- 聚合工作区技术债务时，遍历已索引文件债务并在 QuickPick 展示；若需要可触发后台的项目分析来补充静态分析产生的新条目。

## 架构概览
新核心服务：`FileDebtIndex`
负责：
1. 确保单例“workspace project”存在（调用后端 /projects 去重）。
2. 基于文件路径调用后端 `GET /debts/project/{id}?file_path=...` 获取债务并标准化为内部模型。
3. 缓存每个文件的债务（TTL 可配置，默认 2 分钟）并提供失效与批量刷新。
4. 提供聚合方法 `aggregateWorkspaceDebts()` 返回所有已加载文件的合并列表。

UI 提供者：
1. `InlineDebtDecorator`: 在有债务的行添加 gutter 图标与背景色（可开关）。
2. `DebtCodeLensProvider`: 在文件顶部及债务行位置插入 CodeLens：
   - 顶部：概览统计 + 打开 QuickPick。
   - 行内：更新状态（进行中 / 已解决 / 忽略）、查看详情。
3. Hover：显示 debt 描述 + 状态 + 快速操作命令提示。
4. Diagnostics：将债务转为 VS Code `Diagnostic`（可选 severity 映射 low→Hint, medium→Information, high→Warning, critical→Error）。

命令集合：
- `technicalDebt.scanFile`: 扫描当前文件（保证 project 存在 -> 获取文件债务 -> 更新展示）。
- `technicalDebt.scanWorkspaceAggregate`: 可选触发后端项目分析（/projects/{id}/analysis）并随后刷新全部缓存。
- `technicalDebt.showFileDebts`: QuickPick 列出当前文件债务并支持状态更新。
- `technicalDebt.openDebtQuickPanel`: 聚合工作区文件债务 QuickPick（支持按 severity 过滤，输入搜索）。
- `technicalDebt.toggleInlineDebts`: 启用 / 禁用行内装饰 & 诊断。
- `technicalDebt.markDebt.*` （inProgress / resolved / ignored）：作用于当前选定的 debt（来自 code lens, hover 或 QuickPick）。

## 类型与标准化
后端债务字段（`debts.py`）: `id, file_path, line, severity, message, status`。
前端内部统一：
```
interface FileDebt {
  id: string;
  filePath: string;
  line: number;
  severity: 'low'|'medium'|'high'|'critical';
  description: string; // source: message
  status: 'open'|'in_progress'|'resolved'|'ignored'; // 与后端一致；旧枚举 wont_fix -> ignored
  createdAt?: string;
  updatedAt?: string;
}
```

## 流程示意
1. 用户打开文件 -> 激活事件 `onDidOpenTextDocument` 调用 `scanFileIfAutoEnabled`。
2. `FileDebtIndex.ensureProject()` -> 调用 `/projects` 去重创建/复用。
3. 请求 `/debts/project/{projectId}?file_path=<normalized>` -> 缓存 -> 触发装饰 & lenses & diagnostics。
4. 用户通过 CodeLens 或右键更新状态 -> 调用 `PUT /debts/{id}` -> 更新缓存 -> 重绘。
5. 用户执行聚合命令 -> 读取索引中所有文件的缓存 -> 展示 QuickPick；可选择导航 / 更新状态。

## 批量与聚合
工作区聚合不重新向后端逐文件请求（除非用户执行全量分析命令），节约网络；展示仅限已扫描过的文件。全量分析命令可在完成后列出后端新增的 debts（需另一个接口或结果轮询；初版可不实现）。

## 配置选项（后续可加入 settings）
- `technicalDebt.autoScanOnOpen`: boolean (default true)
- `technicalDebt.decoration.enabled`: boolean (default true)
- `technicalDebt.cache.ttlSeconds`: number (default 120)
- `technicalDebt.showDiagnostics`: boolean (default true)

## 迁移策略
阶段 1（当前）：并存旧代码，新增服务与命令，不移除旧面板但面板提示建议使用新命令。
阶段 2：移除旧面板/相关 Webview 文件、删除项目级别冗余服务函数。

## 后端改进建议（可选）
1. 提供 `/debts/project/{id}/all` 返回项目全部债务，减少前端多请求。
2. 在 `PUT /debts/{id}` 响应中返回 `project_id`（目前缺失）。
3. 支持多文件路径批量过滤（`file_path` 数组）。

## 立即开发的文件与增量
新增：`src/extension/services/fileDebtIndex.ts`，`src/extension/providers/debtCodeLensProvider.ts`, `src/extension/decorators/inlineDebtDecorator.ts`。
修改：`src/extension/extension.ts` 注册命令、事件监听、移除面板强制依赖。
保持：原有 `debtService` 和 `apiClient`；利用其 `getFileDebts`、`updateDebtStatus`、`createProject`。

## 初版完成判定
- 打开文件自动出现 debts 装饰（若存在）。
- 运行 `技术债务: 扫描当前文件` 命令刷新行内显示。
- CodeLens 展示文件总债务数；行上 CodeLens 可更新状态并即时变色 / 消失（若 resolved ）。
- QuickPick 聚合显示所有已扫描文件的债务，并可导航定位行。

---
后续将按上述顺序实现。若需调整请在实现前反馈。
