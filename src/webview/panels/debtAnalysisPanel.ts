import * as vscode from 'vscode';
import { DebtService } from '../../extension/services/debtService';
import { AnalysisService } from '../../extension/services/analysisService';
import { getNonce } from '../utils/getNonce';

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
                    case 'lockProject':
                        await this.handleLockProject(data.payload);
                        break;
                    case 'unlockProject':
                        await this.handleUnlockProject(data.payload);
                        break;
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
                .toolbar { margin-bottom: 12px; }
                button { margin-right: 8px; }
                #projectsList { list-style: none; padding: 0; }
                .projectItem { padding: 8px; border-bottom: 1px solid rgba(128,128,128,0.08); display:flex; justify-content:space-between; align-items:center }
                .projectMeta { display:flex; flex-direction:column }
                .projectActions button { margin-left: 6px }
                #messages { margin-top: 12px; color: var(--vscode-foreground); }
                #debtsArea { margin-top: 12px; }
                table { width:100%; border-collapse: collapse }
                th, td { text-align:left; padding:6px; border-bottom:1px solid rgba(128,128,128,0.06) }
            </style>
        </head>
        <body>
            <div id="app">
                <h1>技术债务分析</h1>

                <div class="toolbar">
                    <button id="btnAnalyzeWorkspace">分析工作区</button>
                    <button id="btnRefreshProjects">刷新项目列表</button>
                </div>

                <section>
                    <h2>项目</h2>
                    <ul id="projectsList"><li>正在加载项目…</li></ul>
                </section>

                <section id="debtsArea">
                    <h2>债务详情</h2>
                    <div id="debtsContainer">请选择一个项目以查看其债务</div>
                </section>

                <div id="messages"></div>
            </div>

            <script nonce="${nonce}">
                (function(){
                    const vscode = acquireVsCodeApi();

                    const projectsList = document.getElementById('projectsList');
                    const debtsContainer = document.getElementById('debtsContainer');
                    const messages = document.getElementById('messages');
                    let currentProjectId = null;

                    function showMessage(text, isError) {
                        messages.textContent = text;
                        messages.style.color = isError ? 'var(--vscode-errorForeground)' : 'var(--vscode-foreground)';
                        setTimeout(()=>{ if (messages.textContent === text) messages.textContent = ''; }, 5000);
                    }

                    function renderProjects(projects){
                        if(!projects || projects.length === 0){ projectsList.innerHTML = '<li>暂无项目</li>'; return }
                        projectsList.innerHTML = '';
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
                            const btnLock = document.createElement('button'); btnLock.textContent = '加锁'; btnLock.dataset.action='lockProject'; btnLock.dataset.id = p.id || p.project_id || '';
                            const btnUnlock = document.createElement('button'); btnUnlock.textContent = '解锁'; btnUnlock.dataset.action='unlockProject'; btnUnlock.dataset.id = p.id || p.project_id || '';
                            actions.appendChild(btnAnalyze); actions.appendChild(btnView); actions.appendChild(btnLock); actions.appendChild(btnUnlock);

                            li.appendChild(meta); li.appendChild(actions);
                            projectsList.appendChild(li);
                        });
                    }

                    function renderDebts(debts){
                        if(!debts || debts.length === 0){ debtsContainer.innerHTML = '<div>该项目暂无债务</div>'; return }
                        let html = '<table><thead><tr><th>文件</th><th>行</th><th>严重度</th><th>描述</th><th>操作</th></tr></thead><tbody>';
                        debts.forEach(d => {
                            const file = d.filePath || d.file_path || (d.metadata && d.metadata.location && d.metadata.location.path) || '';
                            const line = (d.metadata && d.metadata.location && d.metadata.location.line) || d.lineNumber || '';
                            const id = (d.id !== undefined && d.id !== null) ? String(d.id) : (d.debtId || d.debt_id || '');
                            html += '<tr>' +
                                    '<td>' + escapeHtml(file) + '</td>' +
                                    '<td>' + line + '</td>' +
                                    '<td>' + (d.severity || '') + '</td>' +
                                    '<td>' + escapeHtml(d.description) + '</td>' +
                                    '<td>' +
                                      '<button data-action="updateDebtStatus" data-debt-id="' + escapeHtml(id) + '" data-status="in_progress">进行中</button>' +
                                      '<button data-action="updateDebtStatus" data-debt-id="' + escapeHtml(id) + '" data-status="resolved">已解决</button>' +
                                      '<button data-action="updateDebtStatus" data-debt-id="' + escapeHtml(id) + '" data-status="wont_fix">忽略</button>' +
                                    '</td>' +
                                  '</tr>';
                        });
                        html += '</tbody></table>';
                        debtsContainer.innerHTML = html;
                    }

                    function escapeHtml(s){ if(!s) return ''; return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

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
                            case 'lockProject':
                                vscode.postMessage({ type:'lockProject', payload:{ projectId: id } });
                                break;
                            case 'unlockProject':
                                vscode.postMessage({ type:'unlockProject', payload:{ projectId: id } });
                                break;
                        }
                    });

                    // Delegated click handler for debts actions (update status)
                    debtsContainer.addEventListener('click', (ev) => {
                        const btn = ev.target.closest && ev.target.closest('button');
                        if(!btn) return;
                        const action = btn.dataset.action;
                        if(action === 'updateDebtStatus'){
                            const debtId = btn.dataset.debtId;
                            const status = btn.dataset.status;
                            if(!debtId || !status) { showMessage('缺少债务 ID 或状态', true); return }
                            // 禁用债务区的所有按钮，防止重复点击
                            Array.from(debtsContainer.querySelectorAll('button')).forEach(b => b.disabled = true);
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
            const projects = await this._debtService.getProjects();
            // 尝试识别当前工作区对应的 project（优先匹配 localPath 或 local_path）
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            let currentProjectId: string | null = null;
            if (workspaceFolder) {
                const wsPath = workspaceFolder.uri.fsPath;
                const match = projects.find((p: any) => (p.localPath && p.localPath === wsPath) || (p.local_path && p.local_path === wsPath));
                if (match) currentProjectId = match.id || (match as any).project_id || null;
            }

            this._panel.webview.postMessage({
                type: 'projectsData',
                payload: {
                    projects,
                    currentProjectId
                }
            });
        } catch (error: any) {
            this._panel.webview.postMessage({
                type: 'error',
                payload: error.message
            });
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
            const project = projects.find((p: any) => p.id === projectId || p.project_id === projectId);
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
            const filePath = payload.filePath;
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

    private async handleLockProject(payload: any) {
        try {
            const apiClient = (this._debtService as any).apiClient;
            const clientId = (this._analysisService as any).clientId || 'vscode-client';
            if (!apiClient || !apiClient.lockProject) throw new Error('不支持锁 API');
            await apiClient.lockProject(payload.projectId, clientId, 300);
            this._panel.webview.postMessage({ type: 'actionResult', payload: '项目已加锁' });
        } catch (error: any) {
            this._panel.webview.postMessage({ type: 'error', payload: error.message });
        }
    }

    private async handleUnlockProject(payload: any) {
        try {
            const apiClient = (this._debtService as any).apiClient;
            const clientId = (this._analysisService as any).clientId || 'vscode-client';
            if (!apiClient || !apiClient.unlockProject) throw new Error('不支持解锁 API');
            await apiClient.unlockProject(payload.projectId, clientId);
            this._panel.webview.postMessage({ type: 'actionResult', payload: '项目已解锁' });
        } catch (error: any) {
            this._panel.webview.postMessage({ type: 'error', payload: error.message });
        }
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