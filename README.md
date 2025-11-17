# Technical Debt Manager 技术债务管理工具

## 项目概览
- 课程项目：CS5351 软件工程
- 目标：结合 VS Code 插件与 FastAPI 服务，基于 Git 历史与代码复杂度识别技术债务热点，并在编辑器内直接处理

## 主要特性
- **文件级工作流**：`技术债务: 扫描当前文件`、`技术债务: 显示当前文件债务`、`技术债务: 聚合查看已扫描债务`、`技术债务: 手动刷新所有债务`
- **可视化反馈**：按严重度高亮代码行、显示 CodeLens 操作、提供悬浮提示
- **债务状态管理**：支持 `处理中 / 已解决 / 忽略` 等状态同步回后端
- **缓存与刷新**：本地缓存每个文件的债务结果，支持手动刷新和按需重新扫描
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

## 致谢
- PyDriller、Radon 为分析算法提供支持
- VS Code 扩展 API 与 FastAPI/Celery 构成整体架构

### 主要 API 端点
| 方法   | 端点                                 | 描述             |
|--------|--------------------------------------|------------------|
| GET    | /api/v1/projects/                    | 获取项目列表     |
| POST   | /api/v1/projects/                    | 创建新项目       |
| GET    | /api/v1/projects/{id}/debt-summary   | 获取项目债务摘要 |
| POST   | /api/v1/projects/{id}/analysis       | 触发代码分析     |
| GET    | /api/v1/debts/project/{project_id}   | 获取项目债务列表 |
| PUT    | /api/v1/debts/{id}                   | 更新债务状态     |

### 自动化 API 与构建集成测试

仓库内包含一个脚本 `scripts/api_integration_test.js`，用于自动化检查以下内容：

- 构建产物是否存在（`dist/extension.js`），以及 `package.json` 的 `main` 是否正确指向该产物。
- 后端关键 API 是否可达并返回预期字段（projects 列表、创建项目、触发分析、轮询分析状态、获取债务摘要与债务列表）。

运行测试：

```powershell
# 可选：覆盖默认后端地址
$env:TDM_API_BASE = 'http://localhost:8000/api/v1'

npm run test:api
```

测试会打印每一步的结果；若发生错误会以非零退出码结束。该脚本为集成测试，会对后端做写操作（创建项目、触发分析）。如需只做只读检查，请在脚本中注释相关步骤。


## 🤝 贡献指南
 
### 开发流程
1. Fork 项目仓库

2. 创建功能分支 (git checkout -b feature/amazing-feature)

3. 提交更改 (git commit -m 'Add some amazing feature')

4. 推送到分支 (git push origin feature/amazing-feature)

5. 创建 Pull Request

### 代码规范
- 使用 Black 进行 Python 代码格式化

- 使用 ESLint 进行 TypeScript 代码检查

- 遵循 Conventional Commits 提交规范

- 编写单元测试，保持测试覆盖率

## 📝 许可证
本项目采用 MIT 许可证 - 查看 LICENSE 文件了解详情。

## 👥 开发团队
CS5351 - Hinton团队

| 成员 | 角色 | 主要负责 |
|------|------|----------|
| 张三 | 后端开发 | 分析引擎、API 设计 |
| 李四 | 前端开发 | VS Code 插件、UI/UX |
| 王五 | 算法工程师 | 债务评分算法 |
| 赵六 | 全栈开发 | Web 管理端、集成测试 |
| 钱七 | DevOps | 部署运维、CI/CD |
| 孙八 | 产品经理 | 需求分析、文档编写 |
## 🙏 致谢
感谢以下开源项目的支持：

- FastAPI - 现代、快速的 Web 框架

- PyDriller - Python Git 仓库分析库

- Radon - Python 代码度量工具

- VS Code Extension API - 插件开发框架

- Vue.js - 渐进式 JavaScript 框架

-------------------

**Technical Debt Manager** - 让技术债务管理变得简单高效！ 🚀

如有任何问题，请查阅文档或联系开发团队。
