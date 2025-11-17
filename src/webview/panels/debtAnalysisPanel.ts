import * as vscode from 'vscode';
import { DebtService } from '../../extension/services/debtService';
import { AnalysisService } from '../../extension/services/analysisService';
import { getNonce } from '../utils/getNonce';
import { Logger } from '../../extension/utils/logger';

export class DebtAnalysisPanel {
    public static currentPanel: DebtAnalysisPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _debtService: DebtService;
    private _analysisService: AnalysisService;

    public static createOrShow(extensionUri: vscode.Uri, debtService: DebtService, analysisService: AnalysisService) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (DebtAnalysisPanel.currentPanel) {
            DebtAnalysisPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'technicalDebtDashboard',
            '技术债务分析',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.joinPath(extensionUri, 'out'),
                    vscode.Uri.joinPath(extensionUri, 'dist')
                ]
            }
        );

        DebtAnalysisPanel.currentPanel = new DebtAnalysisPanel(panel, extensionUri, debtService, analysisService);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, debtService: DebtService, analysisService: AnalysisService) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._debtService = debtService;
        this._analysisService = analysisService;

        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // 处理来自 webview 的消息
        this._panel.webview.onDidReceiveMessage(
            async (data) => {
                switch (data.type) {
                    case 'getProjects':
                        await this.handleGetProjects();
                        break;
                    case 'getDebtSummary':
                        await this.handleGetDebtSummary(data.payload);
                        break;
                    case 'analyzeWorkspace':
                        await this.handleAnalyzeWorkspace();
                        break;
                    case 'analyzeProject':
                        await this.handleAnalyzeProject(data.payload);
                        break;
                    case 'getDebts':
                        await this.handleGetDebts(data.payload);
                        break;
                    case 'updateDebtStatus':
                        await this.handleUpdateDebtStatus(data.payload);
                        break;
                    case 'analyzeFile':
                        await this.handleAnalyzeFile(data.payload);
                        break;
                    case 'addDebt':
                        await this.handleAddDebt(data.payload);
                        break;
                    case 'executeCommand':
                        await this.handleExecuteCommand(data.payload);
                        break;
                    // 后端已改为自动在处理期间加锁并在完成时自动解锁，前端不再处理 lock/unlock 消息。
                    case 'getProjectCurrent':
                        await this.handleGetProjectCurrent(data.payload);
                        break;
                    case 'showError':
                        vscode.window.showErrorMessage(data.payload);
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    private async _update() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
    const nonce = getNonce();
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <title>技术债务分析</title>
            <style>
                body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background-color: var(--vscode-editor-background); padding: 12px; }
                #app { max-width: 1200px; margin: 0 auto; }
                .toolbar { margin-bottom: 12px; display:flex; align-items:center; justify-content:space-between }
                .toolbar-left { display:flex; align-items:center }
                .toolbar-right { display:flex; align-items:center }
                button { margin-right: 8px; }
                #projectsList { list-style: none; padding: 0; }
                .projectItem { padding: 8px; border-bottom: 1px solid rgba(128,128,128,0.08); display:flex; justify-content:space-between; align-items:center }
                .projectMeta { display:flex; flex-direction:column }
                .projectActions button { margin-left: 6px }
                #messages { margin-top: 12px; color: var(--vscode-foreground); }
                #debtsArea { margin-top: 12px; }
                table { width:100%; border-collapse: collapse }
                th, td { text-align:left; padding:6px; border-bottom:1px solid rgba(128,128,128,0.06) }
                /* command menu */
                #commandMenu { position: fixed; background: var(--vscode-editor-background); border: 1px solid rgba(128,128,128,0.12); box-shadow: 0 6px 18px rgba(0,0,0,0.2); z-index: 9999; min-width:200px; padding:6px; }
                #commandMenu.hidden { display:none }
                #commandMenu ul { list-style:none; margin:0; padding:4px }
                #commandMenu li { padding:6px 8px; cursor:pointer; border-radius:4px }
                #commandMenu li:hover { background: rgba(128,128,128,0.06) }
                #commandMenu li.sep { height:8px; }
                tr.selected { background: rgba(100,149,237,0.08) }
            </style>
        </head>
        <body>
            <div id="app">
                <h1>技术债务分析</h1>

                <div class="toolbar">
                    <div class="toolbar-left">
                        <button id="btnAnalyzeWorkspace">分析工作区</button>
                        <button id="btnRefreshProjects">刷新项目列表</button>
                    </div>
                    <div class="toolbar-right">
                        <button id="btnAnalyzeProject">分析项目</button>
                    </div>
                </div>

                <section>
                    <h2>项目</h2>
                    <ul id="projectsList"><li>正在加载项目…</li></ul>
                </section>

                <section id="debtsArea">
                    <h2>债务详情</h2>
                    <div id="debtsContainer">请选择一个项目以查看其债务</div>
                </section>

                <!-- 右键命令菜单（浮动） -->
                <div id="commandMenu" class="hidden" role="menu" aria-hidden="true">
                    <ul>
                        <li data-action="analyzeWorkspace">分析工作区</li>
                        <li data-action="analyzeProject">分析项目</li>
                        <li data-action="analyzeFile">分析当前文件</li>
                        <li class="sep"></li>
                        <li data-action="getDebts">查看债务</li>
                        <li data-action="refreshProjects">刷新项目列表</li>
                        <li data-action="addDebt">添加债务</li>
                        <li class="sep"></li>
                        <li data-action="markInProgress">标记为：进行中（选中债务）</li>
                        <li data-action="markResolved">标记为：已解决（选中债务）</li>
                        <li data-action="markWontFix">标记为：忽略（选中债务）</li>
                    </ul>
                </div>

                <div id="messages"></div>
            </div>

            <script nonce="${nonce}">
                (function(){
                    const vscode = acquireVsCodeApi();
                    // 全局错误捕获，避免脚本异常导致一直停留在“正在加载项目…”
                    window.addEventListener('error', (ev) => {
                        const msgEl = document.getElementById('messages');
                        if (msgEl) {
                            msgEl.innerHTML = '<div style="color:#f66">前端脚本错误: ' + (ev.error?.message || ev.message) + '</div>';
                        }
                        const projectsList = document.getElementById('projectsList');
                        if (projectsList && projectsList.innerHTML.includes('正在加载项目')) {
                            projectsList.innerHTML = '<li style="color:#f66">脚本异常，无法加载项目。请重载窗口。</li>';
                        }
                    });

                    const appRoot = document.getElementById('app');
                    const commandMenu = document.getElementById('commandMenu');
                    const projectsList = document.getElementById('projectsList');
                    const debtsContainer = document.getElementById('debtsContainer');
                    const messages = document.getElementById('messages');
                    let currentProjectId = null;
                    let selectedDebtId = null;

                    function showMessage(text, isError) {
                        messages.textContent = text;
                        messages.style.color = isError ? 'var(--vscode-errorForeground)' : 'var(--vscode-foreground)';
                        setTimeout(()=>{ if (messages.textContent === text) messages.textContent = ''; }, 5000);
                    }

                    function renderProjects(projects){
                        if(!projects || projects.length === 0){ projectsList.innerHTML = '<li>暂无项目</li>'; currentProjectId = null; return }
                        projectsList.innerHTML = '';
                        if (!currentProjectId && projects.length > 0) {
                            const first = projects[0];
                            currentProjectId = first.id || first.project_id || null;
                        }
                        projects.forEach(p => {
                            const li = document.createElement('li');
                            li.className = 'projectItem';
                            const meta = document.createElement('div'); meta.className = 'projectMeta';
                            const name = document.createElement('div'); name.textContent = p.name || p.project_name || 'Unnamed';
                            const path = document.createElement('div'); path.style.fontSize='small'; path.style.opacity='0.8'; path.textContent = p.localPath || p.local_path || '';
                            meta.appendChild(name); meta.appendChild(path);

                            const actions = document.createElement('div'); actions.className = 'projectActions';
                            const btnAnalyze = document.createElement('button'); btnAnalyze.textContent = '分析'; btnAnalyze.dataset.action='analyzeProject'; btnAnalyze.dataset.id = p.id || p.project_id || '';
                            const btnView = document.createElement('button'); btnView.textContent = '查看债务'; btnView.dataset.action='viewDebts'; btnView.dataset.id = p.id || p.project_id || '';
                            // 手动加锁/解锁按钮已移除：后端在处理期间会自动加锁并在完成时自动解锁。
                            actions.appendChild(btnAnalyze); actions.appendChild(btnView);

                            li.appendChild(meta); li.appendChild(actions);
                            projectsList.appendChild(li);
                        });
                    }

                    // 若 5 秒后仍旧是初始占位则提供重试按钮
                    setTimeout(() => {
                        if (projectsList && projectsList.children.length === 1 && /正在加载项目/.test(projectsList.textContent || '')) {
                            projectsList.innerHTML = '<li>加载超时。<button id="btnRetryLoadProjects">重试加载</button></li>';
                            const retry = document.getElementById('btnRetryLoadProjects');
                            if (retry) {
                                retry.addEventListener('click', () => {
                                    projectsList.innerHTML = '<li>正在加载项目…</li>';
                                    vscode.postMessage({ type: 'getProjects' });
                                });
                            }
                        }
                    }, 5000);

                    function renderDebts(debts){
                        selectedDebtId = null;
                        if(!debts || debts.length === 0){ debtsContainer.innerHTML = '<div>该项目暂无债务</div>'; return }
                        let html = '<table><thead><tr><th>文件</th><th>行</th><th>严重度</th><th>描述</th><th>操作</th></tr></thead><tbody>';
                                                debts.forEach(d => {
                                                        const file = d.filePath || d.file_path || (d.metadata && d.metadata.location && d.metadata.location.path) || '';
                                                        const line = (d.metadata && d.metadata.location && d.metadata.location.line) || d.line || d.lineNumber || '';
                                                        const id = (d.id !== undefined && d.id !== null) ? String(d.id) : (d.debtId || d.debt_id || '');
                                                        const desc = d.description || d.message || '';
                                                        html += '<tr data-debt-id="'+ escapeHtml(id) +'">' +
                                                                        '<td>' + escapeHtml(file) + '</td>' +
                                                                        '<td>' + line + '</td>' +
                                                                        '<td>' + (d.severity || '') + '</td>' +
                                                                        '<td>' + escapeHtml(desc) + '</td>' +
                                                                        '<td>' +
                                                                            '<button data-action="updateDebtStatus" data-debt-id="' + escapeHtml(id) + '" data-status="in_progress">进行中</button>' +
                                                                            '<button data-action="updateDebtStatus" data-debt-id="' + escapeHtml(id) + '" data-status="resolved">已解决</button>' +
                                                                            '<button data-action="updateDebtStatus" data-debt-id="' + escapeHtml(id) + '" data-status="ignored">忽略</button>' +
                                                                        '</td>' +
                                                                    '</tr>';
                                                });
                        html += '</tbody></table>';
                        debtsContainer.innerHTML = html;
                    }

                    function escapeHtml(s){ if(!s) return ''; return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }

                    function disableDebtButtons(disabled){
                        Array.from(debtsContainer.querySelectorAll('button')).forEach(b => b.disabled = disabled);
                    }

                    function requestDebtStatusUpdate(status, label){
                        if(!selectedDebtId){ showMessage('请先在债务表中选择一条记录', true); return }
                        disableDebtButtons(true);
                        vscode.postMessage({ type:'updateDebtStatus', payload:{ debtId: selectedDebtId, status } });
                        showMessage('正在将债务标记为' + label + '...');
                    }

                    function handleCommandAction(action){
                        switch(action){
                            case 'analyzeWorkspace':
                                vscode.postMessage({ type:'analyzeWorkspace' });
                                showMessage('正在触发工作区分析...');
                                break;
                            case 'analyzeProject':
                                if(!currentProjectId){ showMessage('请先在项目列表中选择一个项目', true); return }
                                vscode.postMessage({ type:'analyzeProject', payload:{ projectId: currentProjectId } });
                                showMessage('正在触发所选项目分析...');
                                break;
                            case 'analyzeFile':
                                vscode.postMessage({ type:'analyzeFile', payload:{} });
                                showMessage('正在分析当前文件...');
                                break;
                            case 'getDebts':
                                if(!currentProjectId){ showMessage('请先选择项目以查看债务', true); return }
                                vscode.postMessage({ type:'getDebts', payload:{ projectId: currentProjectId } });
                                showMessage('正在加载债务...');
                                break;
                            case 'refreshProjects':
                                vscode.postMessage({ type:'getProjects' });
                                showMessage('刷新项目列表...');
                                break;
                            case 'addDebt':
                                vscode.postMessage({ type:'executeCommand', payload:{ command:'technicalDebt.addDebt' } });
                                showMessage('已触发“添加债务”命令');
                                break;
                            case 'markInProgress':
                                requestDebtStatusUpdate('in_progress','“进行中”');
                                break;
                            case 'markResolved':
                                requestDebtStatusUpdate('resolved','“已解决”');
                                break;
                            case 'markWontFix':
                                requestDebtStatusUpdate('wont_fix','“忽略”');
                                break;
                            default:
                                showMessage('暂不支持的命令: ' + (action || ''), true);
                        }
                    }

                    // Delegated click handler for project actions
                    projectsList.addEventListener('click', (ev) => {
                        const btn = ev.target.closest && ev.target.closest('button');
                        if(!btn) return;
                        const action = btn.dataset.action;
                        const id = btn.dataset.id;
                        switch(action){
                            case 'analyzeProject':
                                currentProjectId = id;
                                vscode.postMessage({ type:'analyzeProject', payload:{ projectId: id } });
                                showMessage('正在触发项目分析...');
                                break;
                            case 'viewDebts':
                                currentProjectId = id;
                                vscode.postMessage({ type:'getDebts', payload:{ projectId: id } });
                                showMessage('正在加载债务...');
                                break;
                            default:
                                // 其它动作（例如早期版本的 lock/unlock）已移除，由后端自动管理锁
                                break;
                        }
                    });

                    function toggleCommandMenu(show, x, y){
                        if(!commandMenu) return;
                        if(show){
                            commandMenu.classList.remove('hidden');
                            commandMenu.style.left = (x || 0) + 'px';
                            commandMenu.style.top = (y || 0) + 'px';
                            commandMenu.setAttribute('aria-hidden','false');
                        } else {
                            commandMenu.classList.add('hidden');
                            commandMenu.setAttribute('aria-hidden','true');
                        }
                    }

                    // 右键（contextmenu）显示命令面板
                    if (appRoot) {
                        appRoot.addEventListener('contextmenu', (ev) => {
                            ev.preventDefault();
                            toggleCommandMenu(true, ev.pageX, ev.pageY);
                        });
                    }

                    // 点击空白处或 Escape 关闭命令面板
                    document.addEventListener('click', (ev) => {
                        if(!commandMenu) return;
                        if(!(ev.target && (commandMenu === ev.target || commandMenu.contains(ev.target)))){
                            toggleCommandMenu(false);
                        }
                    });
                    document.addEventListener('keydown', (ev) => {
                        if(ev.key === 'Escape'){
                            toggleCommandMenu(false);
                        }
                    });

                    // 命令面板点击
                    if (commandMenu) {
                        commandMenu.addEventListener('click', (ev) => {
                            const li = ev.target.closest && ev.target.closest('li');
                            if(!li) return;
                            const action = li.dataset.action;
                            toggleCommandMenu(false);
                            handleCommandAction(action);
                        });
                    }

                    // 分析项目（右侧工具栏按钮）
                    document.getElementById('btnAnalyzeProject').addEventListener('click', () => {
                        if(!currentProjectId){ showMessage('请先选择项目或在项目列表中点击“查看债务”以选择项目', true); return }
                        vscode.postMessage({ type:'analyzeProject', payload:{ projectId: currentProjectId } });
                        showMessage('正在触发所选项目分析...');
                    });

                    // Delegated click handler for debts actions (update status) and row selection
                    debtsContainer.addEventListener('click', (ev) => {
                        const row = ev.target.closest && ev.target.closest('tr');
                        if(row && row.dataset && row.dataset.debtId){
                            // 点击行时选择该债务（用于命令面板的“选中债务”命令）
                            // 切换选中样式
                            Array.from(debtsContainer.querySelectorAll('tr.selected')).forEach(r => r.classList.remove('selected'));
                            row.classList.add('selected');
                            selectedDebtId = row.dataset.debtId || null;
                        }

                        const btn = ev.target.closest && ev.target.closest('button');
                        if(!btn) return;
                        const action = btn.dataset.action;
                        if(action === 'updateDebtStatus'){
                            const debtId = btn.dataset.debtId;
                            const status = btn.dataset.status;
                            if(!debtId || !status) { showMessage('缺少债务 ID 或状态', true); return }
                            disableDebtButtons(true);
                            vscode.postMessage({ type:'updateDebtStatus', payload:{ debtId, status } });
                            showMessage('正在更新债务状态...');
                        }
                    });

                    // toolbar
                    document.getElementById('btnAnalyzeWorkspace').addEventListener('click', () => {
                        vscode.postMessage({ type:'analyzeWorkspace' });
                        showMessage('正在触发工作区分析...');
                    });
                    document.getElementById('btnRefreshProjects').addEventListener('click', () => {
                        vscode.postMessage({ type:'getProjects' });
                        showMessage('刷新项目列表...');
                    });

                    // handle incoming extension messages
                    window.addEventListener('message', event => {
                        const msg = event.data;
                        switch(msg.type){
                            case 'log': {
                                const mEl = document.getElementById('messages');
                                if (mEl) {
                                    const div = document.createElement('div');
                                    div.style.fontSize='smaller';
                                    div.style.opacity='0.7';
                                    div.textContent = '[log] ' + msg.payload;
                                    mEl.appendChild(div);
                                }
                                break;
                            }
                            case 'projectsData': {
                                const payload = msg.payload || {};
                                const projects = payload.projects || [];
                                const cp = payload.currentProjectId || null;
                                if (cp) {
                                    currentProjectId = cp;
                                    const match = projects.find(p => (p.id && String(p.id) === String(cp)) || (p.project_id && String(p.project_id) === String(cp)));
                                    if (match) {
                                        renderProjects([match]);
                                        // 自动加载当前项目的债务
                                        vscode.postMessage({ type:'getDebts', payload:{ projectId: currentProjectId } });
                                        showMessage('加载当前项目债务...');
                                        break;
                                    }
                                }
                                renderProjects(projects);
                                break;
                            }
                            case 'debtsData':
                                renderDebts(msg.payload);
                                break;
                            case 'actionResult':
                                // 恢复按钮并刷新当前项目的债务
                                Array.from(debtsContainer.querySelectorAll('button')).forEach(b => b.disabled = false);
                                showMessage(msg.payload, false);
                                if (currentProjectId) {
                                    vscode.postMessage({ type:'getDebts', payload:{ projectId: currentProjectId } });
                                }
                                break;
                            case 'error':
                                Array.from(debtsContainer.querySelectorAll('button')).forEach(b => b.disabled = false);
                                showMessage(msg.payload || '发生错误', true);
                                projectsList.innerHTML = '<li>加载项目失败，请重试</li>';
                                break;
                            case 'debtSummary':
                                showMessage('债务摘要已加载');
                                break;
                        }
                    });

                    // initial load
                    vscode.postMessage({ type: 'getProjects' });
                })();
            </script>
        </body>
        </html>`;
    }

    private async handleGetProjects() {
        try {
            Logger.getInstance().info('[Panel] handleGetProjects invoked');
            this._panel.webview.postMessage({ type: 'log', payload: '请求项目列表...' });
            const projects = await this._debtService.getProjects();
            Logger.getInstance().info(`[Panel] projects fetched count=${projects.length}`);
            // 尝试识别当前工作区对应的 project（优先匹配 localPath 或 local_path）
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            let currentProjectId: string | null = null;
            if (workspaceFolder) {
                const wsPath = workspaceFolder.uri.fsPath;
                const normalize = (value?: string) => {
                    if (!value) return '';
                    let normalized = value.replace(/\\+/g, '/');
                    normalized = normalized.replace(/\/+/g, '/');
                    normalized = normalized.replace(/\/+$/, '');
                    return normalized.toLowerCase();
                };
                const wsNormalized = normalize(wsPath);
                const match = projects.find((p: any) => normalize(p.localPath) === wsNormalized || normalize(p.local_path) === wsNormalized);
                if (match) currentProjectId = match.id || (match as any).project_id || null;
            }

            this._panel.webview.postMessage({
                type: 'projectsData',
                payload: {
                    projects,
                    currentProjectId
                }
            });
            this._panel.webview.postMessage({ type: 'log', payload: `项目列表返回，数量=${projects.length}, currentProjectId=${currentProjectId || '无'}` });
        } catch (error: any) {
            Logger.getInstance().error('[Panel] 获取项目列表失败: ' + error.message);
            this._panel.webview.postMessage({
                type: 'error',
                payload: error.message
            });
            this._panel.webview.postMessage({ type: 'log', payload: '获取项目列表失败: ' + error.message });
        }
    }

    private async handleGetDebtSummary(payload: any) {
        try {
            const summary = await this._debtService.getDebtSummary(payload.projectId);
            this._panel.webview.postMessage({
                type: 'debtSummary',
                payload: summary
            });
        } catch (error: any) {
            this._panel.webview.postMessage({
                type: 'error',
                payload: error.message
            });
        }
    }

    private async handleAnalyzeWorkspace() {
        try {
            const res = await this._analysisService.analyzeWorkspace();
            this._panel.webview.postMessage({ type: 'actionResult', payload: res ? '工作区分析已触发' : '分析未启动' });
        } catch (error: any) {
            this._panel.webview.postMessage({ type: 'error', payload: error.message });
        }
    }

    private async handleAnalyzeProject(payload: any) {
        try {
            const projectId = payload.projectId;
            const projects = await this._debtService.getProjects();
            const project = projects.find((p: any) => String(p.id) === String(projectId) || String((p as any).project_id) === String(projectId));
            if (!project) { this._panel.webview.postMessage({ type: 'error', payload: '找不到项目' }); return }
            const localPath = (project as any).localPath || (project as any).local_path;
            const res = await this._analysisService.analyzeProject(localPath);
            this._panel.webview.postMessage({ type: 'actionResult', payload: res ? '项目分析已触发' : '分析未启动' });
        } catch (error: any) {
            this._panel.webview.postMessage({ type: 'error', payload: error.message });
        }
    }

    private async handleAnalyzeFile(payload: any) {
        try {
            let filePath = payload?.filePath;
            if (!filePath) {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    filePath = editor.document.uri.fsPath;
                }
            }

            if (!filePath) {
                throw new Error('缺少文件路径，请先打开需要分析的文件');
            }

            const res = await this._analysisService.analyzeFile(filePath);
            this._panel.webview.postMessage({ type: 'actionResult', payload: res ? '文件分析完成' : '文件分析未启动' });
        } catch (error: any) {
            this._panel.webview.postMessage({ type: 'error', payload: error.message });
        }
    }

    private async handleGetDebts(payload: any) {
        try {
            const debts = await this._debtService.getProjectDebts(payload.projectId);
            this._panel.webview.postMessage({ type: 'debtsData', payload: debts });
        } catch (error: any) {
            this._panel.webview.postMessage({ type: 'error', payload: error.message });
        }
    }

    private async handleUpdateDebtStatus(payload: any) {
        try {
            await this._debtService.updateDebtStatus(payload.debtId, payload.status);
            this._panel.webview.postMessage({ type: 'actionResult', payload: '债务状态已更新' });
        } catch (error: any) {
            this._panel.webview.postMessage({ type: 'error', payload: error.message });
        }
    }

    private async handleAddDebt(payload: any) {
        try {
            await this._debtService.addDebt(payload);
            this._panel.webview.postMessage({ type: 'actionResult', payload: '债务已添加' });
        } catch (error: any) {
            this._panel.webview.postMessage({ type: 'error', payload: error.message });
        }
    }

    private async handleExecuteCommand(payload: any) {
        try {
            const command = payload?.command;
            if (!command) {
                throw new Error('缺少 command 参数');
            }
            const args = Array.isArray(payload?.args) ? payload.args : (payload?.args ? [payload.args] : []);
            await vscode.commands.executeCommand(command, ...args);
            this._panel.webview.postMessage({ type: 'actionResult', payload: `已执行命令: ${command}` });
        } catch (error: any) {
            this._panel.webview.postMessage({ type: 'error', payload: error.message });
        }
    }

    private async handleLockProject(payload: any) {
        // 后端已改为在处理期间自动加锁并在完成时自动解锁。前端保留此方法以兼容旧消息，但不再执行显式锁操作。
        this._panel.webview.postMessage({ type: 'actionResult', payload: '后端已自动管理项目锁（处理中自动加锁，完成自动解锁），手动加锁已被忽略' });
    }

    private async handleUnlockProject(payload: any) {
        // 后端已改为在处理完成后自动解锁。前端保留此方法以兼容旧消息，但不再执行显式解锁。
        this._panel.webview.postMessage({ type: 'actionResult', payload: '后端已自动管理项目锁（完成时自动解锁），手动解锁已被忽略' });
    }

    private async handleGetProjectCurrent(payload: any) {
        try {
            const apiClient = (this._debtService as any).apiClient;
            if (!apiClient || !apiClient.getProjectCurrent) throw new Error('不支持 current API');
            const current = await apiClient.getProjectCurrent(payload.projectId);
            this._panel.webview.postMessage({ type: 'actionResult', payload: JSON.stringify(current) });
        } catch (error: any) {
            this._panel.webview.postMessage({ type: 'error', payload: error.message });
        }
    }

    public dispose() {
        DebtAnalysisPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}