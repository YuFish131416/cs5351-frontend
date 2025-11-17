# Technical Debt Manager

智能技术债务管理工具，整合 VS Code 扩展与 FastAPI/Celery 后端，通过 Git 历史、代码复杂度与热点分析，为团队提供实时、可操作的技术债务洞察。

---

## 1. 系统总览

| 组件 | 技术栈 | 说明 |
| --- | --- | --- |
| VS Code 扩展 | TypeScript · webpack | 在编辑器内展示债务树视图、行内装饰、CodeLens、Hover 等交互，提供命令面板与状态管理能力。 |
| 后端服务 | FastAPI · SQLAlchemy · Celery | 负责项目登记、债务查询与状态更新，并调度分析任务到 Celery Worker。 |
| 分析引擎 | PyDriller · Radon | 结合 Git 热点、复杂度、维护性指标计算债务分值与风险标签。 |
| 数据存储 | PostgreSQL | 持久化项目、债务及分析元数据。 |
| 异步任务 | Celery · Redis | 处理项目/文件分析的异步队列，记录扫描日志。 |

架构要点：

1. VS Code 扩展通过自定义 Activity Bar 容器 `technicalDebtSidebar` 提供“当前文件”和“项目概览”双视图。
2. `FileDebtIndex` 维护行级债务缓存，支持自动刷新、手动扫描与跨文件聚合。
3. Hover、CodeLens、Inline Decorator 均以 TreeView 数据为单一数据源，确保展示一致性。
4. FastAPI `/api/v1/debts/project/{project}` 接口支持 `file_path` 参数进行精确查询，同时触发内联增量分析。
5. Celery 任务 `analyze_project_task` 会输出扫描日志，记录分析成功与失败的细节，便于追踪虚拟文档、缺失文件等情况。

---

## 2. VS Code 扩展功能详解

### 2.1 Activity Bar 容器与视图

- **技术债务概览 (`technicalDebtView`)**
   - *当前文件模式*：显示当前活动/可见文件的债务，按严重度聚合；支持右键上下文命令 `扫描/刷新/聚合视图`。
   - *项目概览模式*：聚合工作区所有文件债务，按严重度排序并提供 Markdown Tooltip 展示风险标记、估算工时、得分等。
   - `ViewSwitcherTreeItem` 允许在两个模式间切换，工具栏还提供刷新、聚合 Quick Panel、全局扫描等命令。

### 2.2 行内装饰与 Hover

- **Inline Decorator (`InlineDebtDecorator`)**
   - 按严重度以不同透明度的背景高亮代码行。
   - Hover Markdown 展示风险标记、代码气味、估算工时、债务得分等。
   - 支持动态开启/关闭（命令：`technicalDebt.toggleInlineDebts`）。

- **Hover Provider (`DebtHoverProvider`)**
   - Hover 中嵌入命令链接：查看详情、标记处理中、标记已解决。
   - 自动过滤虚拟文档与非文件方案 URI，减少无效请求。

- **CodeLens Provider (`DebtCodeLensProvider`)**
   - 在存在债务的行上方显示“技术债务: N 个问题 (xh)”提示。
   - 默认传递代表性债务对象到 `technicalDebt.showDebtDetails` 命令。

### 2.3 命令体系

| 命令 ID | 说明 |
| --- | --- |
| `technicalDebt.scanFile` | 强制对当前/目标文件执行一次分析，并刷新缓存。
| `technicalDebt.showFileDebts` | 使用 QuickPick 展示缓存中的文件债务，支持跳转至代码位置。
| `technicalDebt.openDebtQuickPanel` | 聚合所有已缓存债务，支持严重度筛选与关键字过滤。
| `technicalDebt.refreshAllDebts` | 清空/刷新所有缓存，触发树视图更新与行内装饰重新绘制。
| `technicalDebt.switchViewMode` | 切换 TreeView 的文件/项目视图模式。
| `technicalDebt.refresh` | 刷新树视图与 CodeLens、装饰器。
| `technicalDebt.markDebt.*` | 针对树视图/聚合项的状态更新（上下文菜单）。
| `technicalDebt.markAs*` | 针对 Hover、Webview 的状态更新命令。
| `technicalDebt.showDebtDetails` | 打开 Webview 面板展示债务详情，支持再次导航、状态修改。

### 2.4 Webview 面板

- **Debt Detail Panel**
   - 从树视图、Hover、CodeLens 均可打开。
   - 展示债务元数据、建议、状态变更按钮，并支持跳转至具体行。
   - 状态变更成功后，会自动刷新树视图并关闭面板。

### 2.5 缓存与自动刷新

- `FileDebtIndex`
   - 缓存 TTL 默认 120 秒，可通过配置 `technicalDebt.analysis.refreshInterval` 控制自动刷新。
   - `onDidChange` 事件用于通知树视图、装饰器更新。
   - 自动识别虚拟文档（如 `extension-output-`）及缺失文件，避免向后端发出无效请求。

---

## 3. 后端分析核心

### 3.1 数据流

1. **项目登记**：`ProjectRepository` 先查询项目路径，找不到时由扩展触发 `POST /projects` 创建。
2. **内联分析**：`GET /debts/project/{project}?file_path=` 会调用 `_run_inline_analysis`；若文件存在，交由 `AnalysisOrchestrator` 执行增量分析。
3. **分析管线**：
    - `GitHistoryAnalyzer`
       - 使用 PyDriller 统计变更次数、作者数量、最近提交时间。
    - `CodeAnalyzer`
       - 使用 Radon 计算圈复杂度（Cyclomatic Complexity）、维护性指数（MI）、代码行数。
    - `DebtCalculator`
       - 归一化各项指标，结合权重生成 Debt Score（0-1），并映射到 `low/medium/high/critical`。
       - 生成 `risk_flags`, `smell_flags`, `estimated_effort`（小时）等元数据。
4. **持久化**：`TechnicalDebt` 模型记录债务，`project_metadata` 存 JSON，包含分析详情。
5. **日志追踪**：`analysis_tasks.py` 将所有结果写入 `logs/analysis_scan.log`，特别标注缺失文件、虚拟路径等情况。

### 3.2 API 端点

| Method | Endpoint | 常用场景 |
| --- | --- | --- |
| `GET` | `/api/v1/projects/` | 列出所有项目（含本地路径、仓库信息）。 |
| `POST` | `/api/v1/projects/` | 创建项目；支持幂等键 `Idempotency-Key`。 |
| `GET` | `/api/v1/projects/{id}/debt-summary` | 按严重度统计债务。 |
| `POST` | `/api/v1/projects/{id}/analysis` | 触发项目/文件级分析；`file_path` 参数可选。 |
| `GET` | `/api/v1/projects/{id}/analysis/{analysis_id}` | 查询分析状态。 |
| `GET` | `/api/v1/debts/project/{project}` | 获取债务列表；支持 `file_path` 过滤；自动触发增量分析。 |
| `PUT` | `/api/v1/debts/{debt_id}` | 更新债务状态（`open/in_progress/resolved/ignored`）。 |
| `GET` | `/api/v1/projects/{id}/current` | 遍历项目目录，对支持的文件后缀批量执行分析并写回数据库。 |
| `GET` | `/api/v1/projects/{id}/heatmap` | 返回热力图指标（供前端后续可视化使用）。 |

更多参数与响应示例请参考 `http://localhost:8000/docs`。

所有错误都会返回结构化 JSON，包含 `error`、`message`、`service` 等字段，前端 `DebtService` 会解析后转为用户友好提示，并记录到输出通道。

---

## 4. 部署与运行

### 4.1 后端部署

1. **环境准备**
    ```powershell
    cd backend/CS5351-technical-debt-backend
    python -m venv .venv
    .\\.venv\\Scripts\\activate
    pip install -r requirements.txt
    ```
2. **配置 `.env`**
    ```ini
    DATABASE_URL=postgresql+psycopg2://user:password@localhost:5432/technical_debt
    REDIS_URL=redis://localhost:6379/0
    LOG_LEVEL=INFO
    ```
3. **数据库迁移**
    - 初始化数据库（Alembic 或 scripts 下迁移脚本）。
4. **启动服务**
    ```powershell
    uvicorn main:app --reload
    celery -A app.tasks.celery_app worker --loglevel=info
    ```
5. **验证接口**
    - 打开 `http://localhost:8000/docs`
    - 执行 `GET /health`、`GET /projects` 等基础测试。

### 4.2 前端部署

1. `npm install`
2. `npm run compile`
3. VS Code 中按 `F5` 启动 Extension Development Host。
4. 首次运行时在设置中配置：`technicalDebt.api.baseUrl = http://localhost:8000/api/v1`。
5. 在目标工作区打开一个工程，执行命令 “技术债务: 扫描当前文件”。

> **生产部署建议**：
> - 将 FastAPI 部署于容器或云服务，开启 HTTPS。
> - 使用 Supervisor/PM2 管理 Celery 与 Uvicorn。
> - PostgreSQL 建议配置自动备份与性能监控。

---

## 5. 开发与调试指南

### 5.1 扩展开发流程

1. 修改 `src/extension` 下的 TypeScript 源文件。
2. 运行 `npm run watch` 启动 webpack watch，或 `npm run compile` 进行一次性构建。
3. 在 VS Code 中使用“运行与调试”面板启动扩展。
4. 通过 Output 面板 `Technical Debt Manager` 查看日志。
5. 使用 `npm run lint` 保持代码规范。

### 5.2 后端开发流程

1. 激活虚拟环境，运行 `uvicorn main:app --reload` 与 `celery worker`。
2. 使用 `test_main.http` 或 VS Code REST Client 调试 API。
3. 查看 `logs/analysis_scan.log` 了解分析任务执行情况。
4. 使用 `scripts/inspect_project.py` 排查数据库记录。

### 5.3 集成测试

- `npm run test:api`：调用 `scripts/api_integration_test.js`，验证编译产物与主要 API。
- 该脚本会创建项目并触发分析，必要时先清理后端数据。

### 5.4 常见问题排查

| 症状 | 处理建议 |
| --- | --- |
| 扫描结果始终为空 | 检查后端日志是否提示 `file_not_found`；确认工作区路径与后端项目记录一致。|
| 输出出现 `extension-output-*` 请求 | 说明有虚拟文档触发扫描，扩展现已忽略，可安全无视；若仍持续出现，请检查其他插件是否创建临时文件。|
| 命令提示“无效的债务项” | 更新至最新扩展，确保 Hover/CodeLens 触发时参数传递正确。|
| Celery 无响应 | 确认 Redis 连接、队列状态以及 Worker 是否启动。|

---

## 6. 开放配置项

| 设置项 | 默认值 | 描述 |
| --- | --- | --- |
| `technicalDebt.api.baseUrl` | `http://localhost:8000/api/v1` | FastAPI 服务根地址。 |
| `technicalDebt.api.timeout` | `1500000 ms` | API 请求超时时间。 |
| `technicalDebt.analysis.autoAnalyzeOnSave` | `false` | 保存文件时自动触发分析。 |
| `technicalDebt.analysis.excludedPatterns` | `**/node_modules/**` 等 | 扫描排除模式。 |
| `technicalDebt.analysis.maxFileSize` | `1 MB` | 超出后跳过分析。 |
| `technicalDebt.analysis.refreshInterval` | `0` | 自动刷新间隔（秒），0 表示关闭。 |
| `technicalDebt.ui.showStatusBar` | `true` | 是否显示状态栏入口。 |
| `technicalDebt.ui.decorationSeverity` | `medium` | 最低显示装饰的严重度。 |
| `technicalDebt.ui.heatmapEnabled` | `true` | 是否启用热力图装饰（预留）。 |

---

## 7. 路线图与规划

- [ ] 引入债务历史趋势图，展示修复/新增曲线。
- [ ] 支持多工作区项目绑定与切换。
- [ ] Webview 设置面板重构，允许配置自动刷新与筛选条件。
- [ ] 后端接入更多语言的复杂度分析（如 Go、Rust）。

---

## 8. 开发团队

| 成员 | 职责 | 说明 |
| --- | --- | --- |
| 翁梓严 | **首席架构师 & 后端负责人** | 主导 FastAPI 设计、数据库建模、Celery 分析管线。 |
| 吴渊 | **扩展负责人 & 前端交互设计** | 负责 VS Code 视图体系、命令架构、装饰器与 Webview 实现。 |
| 余沛翰 | **算法负责人** | 设计技术债务评分公式、风险标签与估算模型。 |
| 赵海超 | 集成测试与自动化工程师 | 维护 `api_integration_test.js`、CI 流程与脚本编排。 |
| 胡薛林 | DevOps 工程师 | 负责部署脚本、环境配置、Redis/Postgres 运维。 |
| 张尚泽 | 产品经理 | 需求分析、交互流程设计、文档维护。 |
| 龚瑞丰 | 数据分析支持 | 汇总分析结果、提出改进权重建议。 |
| 冯冠宁 | 生态与插件兼容性 | 关注与其他 VS Code 插件的协同，处理兼容性问题。 |

> 吴渊、翁梓严为核心负责人，占项目工作量最大；余沛翰在算法层面贡献次之，其余成员提供专项支持。

---

## 9. 许可证

本项目采用 **MIT License**。详情见仓库中的 `LICENSE` 文件。

---

## 10. 联系方式

- 技术支持：`YuFishYPH@gmail.com`
- 反馈与需求：GitHub Issues 或团队邮箱

**Technical Debt Manager** —— 让技术债务的发现、追踪与治理变得可视、可控、可行动。

## 主要特性
- **文件级工作流**：`技术债务: 扫描当前文件`、`技术债务: 显示当前文件债务`、`技术债务: 聚合查看已扫描债务`、`技术债务: 手动刷新所有债务`
- **可视化反馈**：按严重度高亮代码行、显示 CodeLens 操作、提供悬浮提示
- **诊断面板集成**：扫描结果同步到 VS Code Problems 面板，可直接从错误列表跳转
- **聚合筛选**：聚合视图支持按严重度多选 + 关键字组合过滤
- **债务状态管理**：支持 `处理中 / 已解决 / 忽略` 等状态同步回后端
- **缓存与刷新**：本地缓存每个文件的债务结果，支持手动刷新、关键字过滤，以及可配置的定时自动刷新
- **后端评分模型**：综合 Git 热点（PyDriller）与圈复杂度/维护性指标（Radon）生成债务分数和预计修复工时

## 快速开始

### 后端（FastAPI + Celery）
1. 进入 `backend/CS5351-technical-debt-backend`
2. 创建并激活虚拟环境，安装依赖：`pip install -r requirements.txt`
3. 配置 `.env`（数据库、Redis 等）
4. 初始化数据库并启动服务：
   - `uvicorn main:app --reload`
   - `celery -A app.tasks.celery_app worker --loglevel=info`
5. 打开 `http://localhost:8000/docs` 校验接口

### 前端（VS Code 插件）
1. 安装依赖：`npm install`
2. 编译扩展：`npm run compile`
3. VS Code 中运行 F5 进入扩展开发主机
4. 在设置中配置 API 地址：`technicalDebt.api.baseUrl = http://localhost:8000/api/v1`

## VS Code 常用命令
- `技术债务: 扫描当前文件` (`technicalDebt.scanFile`)
- `技术债务: 显示当前文件债务` (`technicalDebt.showFileDebts`)
- `技术债务: 聚合查看已扫描债务` (`technicalDebt.openDebtQuickPanel`)
- `技术债务: 手动刷新所有债务` (`technicalDebt.refreshAllDebts`)
- `技术债务: 切换行内债务标记` (`technicalDebt.toggleInlineDebts`)
- 传统命令（工作区分析、刷新树视图等）仍可用，但已逐步转向文件级体验

## 分析流程
1. **触发分析**：插件调用后端分析接口或触发 Celery 任务
2. **代码复杂度评估**：`CodeComplexityAnalyzer` 使用 Radon 计算圈复杂度、维护性指数、行数等
3. **Git 热点分析**：`GitHistoryAnalyzer` 使用 PyDriller 统计变更频率与作者多样性
4. **债务评分**：`TechnicalDebtCalculator` 以 0~1 归一化分数融合热度与复杂度，得出 `low/medium/high/critical`
5. **结果存储**：分析结果写入 `technical_debts` 表，插件按需获取并缓存
6. **编辑器呈现**：Inline Decoration、CodeLens、QuickPick 等组件提供即时可视反馈

## 目录速览
- `src/extension/`：VS Code 插件核心逻辑（服务、提供者、装饰器）
- `src/webview/`：仍保留的面板代码（目前主要用于详情展示）
- `backend/CS5351-technical-debt-backend/`：FastAPI 服务、分析器、Celery 任务
- `media/`：VS Code 视图图标资源

## 开发与调试提示
- 插件日志：`输出 > Technical Debt Manager`
- 后端日志：`uvicorn` 与 `celery` 控制台输出
- 常用脚本：`backend/scripts/inspect_project.py` 等用于数据库排查
- 清理缓存：使用插件命令 `技术债务: 手动刷新所有债务` 或删除后端 `technical_debts` 记录后重新分析
- 自动刷新：在 VS Code 设置中调整 `technicalDebt.analysis.refreshInterval`（秒），控制后台定时刷新缓存

## 致谢
- PyDriller、Radon 为分析算法提供支持
- VS Code 扩展 API 与 FastAPI/Celery 构成整体架构

-------------------

**Technical Debt Manager** - 让技术债务管理变得简单高效！ 🚀

如有任何问题，请查阅文档或联系开发团队。
