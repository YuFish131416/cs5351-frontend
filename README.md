# Technical Debt Manager - 技术债务管理工具

## 📖 项目简介

**Technical Debt Manager** 是一个智能的技术债务管理与代码热点分析工具，专为软件开发团队设计。通过分析代码仓库的历史变更和代码复杂度，帮助团队识别、跟踪和管理技术债务，提升代码质量和维护效率。

> 🎓 **CS5351 软件工程课程项目** - 城市大学计算机科学系

## ✨ 核心功能

### 🔍 智能代码热点分析
- **Git历史挖掘**：基于 PyDriller 分析代码库的变更历史，识别频繁修改的文件
- **复杂度计算**：使用 Radon 进行静态代码分析，计算圈复杂度、维护性指数等指标
- **热点识别**：结合变更频率和代码复杂度，识别高风险代码模块
- **可视化热力图**：在编辑器中直观展示代码债务风险等级

### 📊 技术债务量化管理
- **多维度指标**：支持 TODO/FIXME 注释、函数长度、循环依赖、测试覆盖率等指标
- **债务评分系统**：综合计算技术债务严重程度和修复优先级
- **工时估算**：自动估算修复债务所需的工作量，量化"债务本息"
- **趋势追踪**：记录技术债务指标随时间的变化趋势

### 🎯 智能工作流集成
- **上下文感知**：在 VS Code 编辑器中实时显示债务信息
- **状态管理**：支持标记债务状态（待处理/处理中/已解决/忽略）
- **快速导航**：一键定位到问题代码位置
- **团队协作**：支持债务项的备注和状态更新

### 🖥️ 丰富的可视化界面
- **树形视图**：在 VS Code 资源管理器中展示项目和债务结构
- **编辑器装饰**：在代码编辑器中高亮显示技术债务位置
- **CodeLens 支持**：在函数上方显示债务统计信息
- **悬浮提示**：鼠标悬停时显示详细的债务信息
- **Webview 面板**：提供详细的数据可视化和管理界面

## 🏗️ 技术架构

### 后端架构 (Python FastAPI)

#### 核心技术栈
- **Web框架**：FastAPI + Uvicorn
- **代码分析**：PyDriller (Git历史分析) + Radon (代码复杂度分析)
- **数据存储**：PostgreSQL + Redis (缓存)
- **任务队列**：Celery (异步任务处理)
- **API文档**：自动生成 OpenAPI 文档

#### 系统架构
```text
┌─────────────────────────────────────────────────────────────┐
│                    VS Code 插件层                            │
│   ┌─────────────────────┐ ┌─────────────────────────────┐   │
│   │   扩展激活入口        │ │   命令注册系统              │   │
│   │   • 服务初始化       │ │   • 命令处理               │   │
│   │   • 生命周期管理     │ │   • 参数验证               │   │
│   └─────────────────────┘ └─────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────┐
│                   提供者层                                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │ 树视图提供者 │ │ CodeLens    │ │ 悬浮提示     │            │
│  │ • 项目展示  │ │ 提供者       │ │ 提供者       │            │
│  │ • 债务展示  │ │ • 行内提示  │ │ • 详细说明   │            │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────┐
│                   服务层                                    │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │ 分析服务     │ │ 债务服务    │ │ API客户端   │            │
│  │ • 工作区分析 │ │ • 债务管理  │ │ • HTTP请求  │            │
│  │ • 文件分析   │ │ • 状态更新  │ │ • 错误处理  │            │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────┐
│                   可视化层                                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │ 编辑器装饰器 │ │ Webview面板 │ │ 状态栏集成  │            │
│  │ • 代码高亮  │ │ • 数据可视化│ │ • 实时状态  │            │
│  │ • 热点图     │ │ • 交互管理  │ │ • 快速访问  │            │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
└─────────────────────────────────────────────────────────────┘
```


#### 核心模块
1. **扩展主入口** (`src/extension/extension.ts`)
   - 插件激活和初始化
   - 命令注册和管理
   - 服务依赖注入

2. **数据提供者** (`src/extension/providers/`)
   - 树视图提供者 (`technicalDebtProvider.ts`)
   - CodeLens 提供者 (`codeLensProvider.ts`)
   - 悬浮提示提供者 (`hoverProvider.ts`)

3. **业务服务** (`src/extension/services/`)
   - 分析服务 (`analysisService.ts`)
   - 债务服务 (`debtService.ts`)

4. **可视化组件** (`src/extension/decorators/` 和 `src/webview/`)
   - 编辑器装饰器 (`debtDecorator.ts`)
   - Webview 面板 (`debtAnalysisPanel.ts`, `debtDetailPanel.ts`)

## 🚀 部署指南

### 环境要求

#### 后端环境
- Python 3.8+
- PostgreSQL 13+
- Redis 6+
- Git 2.20+

#### 前端环境
- Node.js 16+
- VS Code 1.74+
- npm 8+

### 后端部署步骤

#### 1. 克隆项目
```bash
git clone <repository-url>
cd technical-debt-backend
```

#### 2. 安装依赖
```bash
pip install -r requirements.txt
```

#### 3. 环境配置
创建 `.env` 文件：
```.env
# 数据库配置 - 使用 SQLite 作为开发环境（无需安装 PostgreSQL）
DATABASE_URL=postgresql://postgres:123456@localhost:5432/technical_debt_db

# Redis 配置
REDIS_URL=redis://localhost:6379/0

# 安全配置 - 生成一个随机密钥
SECRET_KEY=your-super-secret-key-change-in-production-2024

# 应用配置
APP_NAME=Technical Debt Manager
VERSION=1.0.0
```

#### 4. 数据库初始化
```bash
# 创建数据库
createdb technical_debt_db

# 初始化表结构
psql -U postgres -d technical_debt_db << EOF
CREATE TABLE projects (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    repo_url VARCHAR(500),
    local_path VARCHAR(500),
    language VARCHAR(50)
);

CREATE TABLE code_analyses (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    project_id INTEGER NOT NULL,
    analysis_type VARCHAR(50),
    status VARCHAR(20),
    metrics JSONB,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE technical_debts (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    project_id INTEGER NOT NULL,
    file_path VARCHAR(500),
    debt_type VARCHAR(50),
    severity VARCHAR(20),
    description TEXT,
    estimated_effort INTEGER,
    status VARCHAR(20) DEFAULT 'open',
    metadata JSONB,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- 创建触发器函数用于自动更新 updated_at 字段
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS \$\$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
\$\$ language 'plpgsql';

-- 为每个表创建更新触发器
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_code_analyses_updated_at BEFORE UPDATE ON code_analyses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_technical_debts_updated_at BEFORE UPDATE ON technical_debts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EOF

```

#### 5. 启动服务
```bash
# 开发模式
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 生产模式
gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app

# 启动 Celery worker（另一个终端）
celery -A app.tasks.celery_app worker --loglevel=info
```

#### 6. 验证部署

访问 http://localhost:8000/docs 查看 API 文档
访问 http://localhost:8000/health 检查服务状态

###  前端部署步骤
#### 1. 克隆项目
```bash
git clone <repository-url>
cd technical-debt-frontend
```
#### 2. 安装依赖
```bash
npm install
```
#### 3. 编译插件
```bash
# 开发编译
npm run compile

# 生产打包
npm run package
```
#### 4. 安装插件
```bash
# 方法1：通过VSIX文件安装
code --install-extension technical-debt-manager-1.0.0.vsix

# 方法2：开发模式调试
# 按 F5 启动调试窗口
```
#### 5. 配置插件
在 VS Code 设置中配置：
```json
{
    "technicalDebt.api.baseUrl": "http://localhost:8000/api/v1",
    "technicalDebt.analysis.autoAnalyzeOnSave": false,
    "technicalDebt.ui.heatmapEnabled": true
}
```

## 🔧 使用指南

### 基本工作流

#### 1. 初始化项目
```bash
# 在 VS Code 中打开项目文件夹
# 插件会自动检测项目结构
```
#### 2. 分析技术债务
```bash
# 方法1：通过命令面板
Ctrl+Shift+P -> "Technical Debt: 分析工作区技术债务"

# 方法2：通过树视图
在 Technical Debt 视图中点击刷新按钮

# 方法3：分析单个文件
在编辑器中右键 -> "分析当前文件技术债务"
```
#### 3. 查看分析结果
- 树视图：在资源管理器中查看项目和技术债务结构

- 编辑器装饰：代码中高亮显示技术债务位置

- CodeLens：函数上方显示债务统计

- 悬浮提示：鼠标悬停查看详细债务信息

#### 4. 管理技术债务
- 查看详情：点击债务项查看详细信息

- 更新状态：标记为处理中/已解决/忽略

- 定位代码：一键跳转到问题代码位置

- 跟踪进度：查看债务状态变化历史

### 高级功能
#### 自动分析配置
```json
{
    "technicalDebt.analysis.autoAnalyzeOnSave": true,
    "technicalDebt.analysis.excludedPatterns": [
        "**/node_modules/**",
        "**/dist/**",
        "**/test/**"
    ]
}
```
#### 自定义债务阈值
```json
{
    "technicalDebt.ui.decorationSeverity": "medium",
    "technicalDebt.ui.heatmapEnabled": true
}
```

## 🛠️ 开发指南
### 后端开发
#### 项目结构
```text
technical-debt-backend/
├── app/
│   ├── api/              # API路由
│   ├── core/             # 核心配置
│   ├── services/         # 业务服务
│   ├── models/           # 数据模型
│   ├── repositories/     # 数据访问
│   ├── analysis/         # 分析引擎
│   ├── tasks/            # 异步任务
│   └── schemas/          # 数据模式
├── migrations/           # 数据库迁移
├── tests/               # 测试文件
└── requirements.txt     # 依赖管理
```
#### 添加新的分析指标
1. 在 `app/analysis/` 创建新的分析器

2. 在 `app/services/analysis_orchestrator.py` 中集成

3. 更新数据模型和 API 接口

4. 添加相应的测试用例

### 前端开发
#### 项目结构
```text
technical-debt-frontend/
├── src/
│   ├── extension/        # 插件核心
│   │   ├── providers/    # 数据提供者
│   │   ├── services/     # 业务服务
│   │   ├── utils/        # 工具类
│   │   └── decorators/   # 编辑器装饰
│   ├── webview/          # Webview界面
│   │   ├── panels/       # 面板组件
│   │   └── utils/        # Webview工具
│   └── types/            # 类型定义
├── resources/            # 静态资源
└── package.json          # 扩展配置
```
#### 添加新的命令
1. 在 package.json 的 commands 部分声明

2. 在 src/extension/extension.ts 中注册

3. 实现命令处理逻辑

4. 更新类型定义

### 测试
#### 后端测试
```bash
# 运行所有测试
pytest

# 运行特定测试
pytest tests/test_analysis.py

# 生成测试覆盖率报告
pytest --cov=app tests/
```
#### 前端测试
```bash
# 运行扩展测试
npm test

# 编译检查
npm run lint

# 类型检查
npx tsc --noEmit
```

## 📊 API 文档
启动后端服务后访问 http://localhost:8000/docs 查看完整的 API 文档。

### 主要 API 端点
| 方法   | 端点                                 | 描述             |
|--------|--------------------------------------|------------------|
| GET    | /api/v1/projects/                    | 获取项目列表     |
| POST   | /api/v1/projects/                    | 创建新项目       |
| GET    | /api/v1/projects/{id}/debt-summary   | 获取项目债务摘要 |
| POST   | /api/v1/projects/{id}/analysis       | 触发代码分析     |
| GET    | /api/v1/debts/project/{project_id}   | 获取项目债务列表 |
| PUT    | /api/v1/debts/{id}                   | 更新债务状态     |
## 🤝 贡献指南
 
## 自动化 API 与构建集成测试

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
