import * as vscode from 'vscode';
import { DebtService } from '../../extension/services/debtService';
import { AnalysisService } from '../../extension/services/analysisService';
import { getNonce } from '../utils/getNonce';
import { Logger } from '../../extension/utils/logger';

interface DebtStatusPayload {
    debtId: string;
    status: string;
}

export class DebtAnalysisPanel {
    private static currentPanel: DebtAnalysisPanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private readonly debtService: DebtService;
    private readonly analysisService: AnalysisService;
    private readonly disposables: vscode.Disposable[] = [];

    static createOrShow(extensionUri: vscode.Uri, debtService: DebtService, analysisService: AnalysisService): void {
        const column = vscode.window.activeTextEditor?.viewColumn;

        if (DebtAnalysisPanel.currentPanel) {
            DebtAnalysisPanel.currentPanel.panel.reveal(column);
            DebtAnalysisPanel.currentPanel.postInitialData();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'technicalDebtDashboard',
            'Technical Debt Dashboard',
            column ?? vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.joinPath(extensionUri, 'dist'),
                    vscode.Uri.joinPath(extensionUri, 'out')
                ]
            }
        );

        DebtAnalysisPanel.currentPanel = new DebtAnalysisPanel(panel, extensionUri, debtService, analysisService);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, debtService: DebtService, analysisService: AnalysisService) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.debtService = debtService;
        this.analysisService = analysisService;

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(message => this.handleMessage(message), null, this.disposables);

        this.render();
    }

    private render(): void {
        const nonce = getNonce();
        this.panel.webview.html = `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8" />
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Technical Debt Dashboard</title>
            <style>
                body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 16px; }
                h1 { margin-top: 0; }
                button { margin-right: 8px; }
                .flex { display: flex; gap: 16px; }
                .pane { flex: 1; border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px; min-height: 200px; }
                .list { list-style: none; padding: 0; margin: 0; }
                .list-item { padding: 8px; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; }
                .list-item:hover { background: var(--vscode-list-hoverBackground); }
                .list-item.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
                .status { margin-top: 12px; min-height: 20px; font-size: 0.9em; opacity: 0.9; }
                table { width: 100%; border-collapse: collapse; }
                th, td { text-align: left; padding: 6px; border-bottom: 1px solid var(--vscode-panel-border); }
                th { font-weight: 600; }
                .actions button { margin-right: 4px; }
            </style>
        </head>
        <body>
            <h1>Technical Debt Dashboard</h1>
            <div>
                <button id="analyzeWorkspace">Analyze workspace</button>
                <button id="refreshProjects">Refresh projects</button>
                <button id="openSettings">Settings</button>
            </div>
            <div class="flex" style="margin-top: 16px;">
                <div class="pane" style="max-width: 320px;">
                    <h2>Projects</h2>
                    <ul id="projectList" class="list"><li>Loading projects…</li></ul>
                </div>
                <div class="pane">
                    <h2 id="debtsTitle">Debts</h2>
                    <div id="debtsContainer">Select a project to inspect its debts.</div>
                </div>
            </div>
            <div class="status" id="status"></div>
            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                let currentProjectId = null;

                const statusEl = document.getElementById('status');
                const projectListEl = document.getElementById('projectList');
                const debtsContainerEl = document.getElementById('debtsContainer');
                const debtsTitleEl = document.getElementById('debtsTitle');

                function setStatus(text, isError) {
                    statusEl.textContent = text || '';
                    statusEl.style.color = isError ? 'var(--vscode-errorForeground)' : 'inherit';
                }

                function renderProjects(projects) {
                    if (!projects.length) {
                        projectListEl.innerHTML = '<li>No projects found. Analyze a workspace to get started.</li>';
                        currentProjectId = null;
                        debtsContainerEl.innerHTML = 'Select a project to inspect its debts.';
                        debtsTitleEl.textContent = 'Debts';
                        return;
                    }

                    const items = projects.map(project => {
                        const id = project.id || project.project_id;
                        const label = project.name || project.localPath;
                        const description = project.localPath || '';
                        const activeClass = id === currentProjectId ? 'list-item active' : 'list-item';
                        return '<li class="' + activeClass + '" data-id="' + id + '" title="' + description + '">' + label + '</li>';
                    });

                    projectListEl.innerHTML = items.join('');
                }

                function renderDebts(projectName, debts) {
                    debtsTitleEl.textContent = projectName ? 'Debts · ' + projectName : 'Debts';
                    if (!debts.length) {
                        debtsContainerEl.innerHTML = '<p>No debts recorded for this project.</p>';
                        return;
                    }

                    const rows = debts.map(debt => {
                        const line = (debt.metadata && debt.metadata.location && debt.metadata.location.line) || debt.line || 1;
                        return '<tr>' +
                            '<td>' + debt.severity + '</td>' +
                            '<td>' + debt.status + '</td>' +
                            '<td>' + debt.filePath + '</td>' +
                            '<td>' + line + '</td>' +
                            '<td>' + debt.description + '</td>' +
                            '<td class="actions">' +
                                '<button data-action="update" data-status="in_progress" data-id="' + debt.id + '">In progress</button>' +
                                '<button data-action="update" data-status="resolved" data-id="' + debt.id + '">Resolved</button>' +
                                '<button data-action="update" data-status="wont_fix" data-id="' + debt.id + '">Ignore</button>' +
                            '</td>' +
                        '</tr>';
                    });

                    debtsContainerEl.innerHTML = '<table>' +
                        '<thead><tr><th>Severity</th><th>Status</th><th>File</th><th>Line</th><th>Description</th><th></th></tr></thead>' +
                        '<tbody>' + rows.join('') + '</tbody>' +
                    '</table>';
                }

                projectListEl.addEventListener('click', event => {
                    const li = event.target.closest('li[data-id]');
                    if (!li) {
                        return;
                    }
                    currentProjectId = li.dataset.id;
                    Array.from(projectListEl.querySelectorAll('.list-item')).forEach(item => item.classList.remove('active'));
                    li.classList.add('active');
                    vscode.postMessage({ type: 'getDebts', payload: { projectId: currentProjectId } });
                });

                debtsContainerEl.addEventListener('click', event => {
                    const button = event.target.closest('button[data-action="update"]');
                    if (!button) {
                        return;
                    }
                    const debtId = button.dataset.id;
                    const status = button.dataset.status;
                    if (!debtId || !status) {
                        return;
                    }
                    vscode.postMessage({ type: 'updateDebtStatus', payload: { debtId, status } });
                });

                document.getElementById('analyzeWorkspace').addEventListener('click', () => {
                    setStatus('Triggering workspace analysis…');
                    vscode.postMessage({ type: 'analyzeWorkspace' });
                });

                document.getElementById('refreshProjects').addEventListener('click', () => {
                    setStatus('Refreshing projects…');
                    vscode.postMessage({ type: 'getProjects' });
                });

                document.getElementById('openSettings').addEventListener('click', () => {
                    vscode.postMessage({ type: 'openSettings' });
                });

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'projects':
                            renderProjects(message.payload.projects || []);
                            if (!currentProjectId && message.payload.projects && message.payload.projects.length) {
                                currentProjectId = message.payload.projects[0].id || message.payload.projects[0].project_id;
                                vscode.postMessage({ type: 'getDebts', payload: { projectId: currentProjectId } });
                            }
                            setStatus('');
                            break;
                        case 'debts':
                            renderDebts(message.payload.projectName, message.payload.debts || []);
                            setStatus('');
                            break;
                        case 'status':
                            setStatus(message.payload, false);
                            vscode.postMessage({ type: 'getProjects' });
                            if (currentProjectId) {
                                vscode.postMessage({ type: 'getDebts', payload: { projectId: currentProjectId } });
                            }
                            break;
                        case 'error':
                            setStatus(message.payload || 'Unexpected error', true);
                            break;
                    }
                });

                vscode.postMessage({ type: 'getProjects' });
            </script>
        </body>
        </html>`;

        this.postInitialData();
    }

    private async handleMessage(message: any): Promise<void> {
        try {
            switch (message.type) {
                case 'getProjects':
                    await this.postProjects();
                    break;
                case 'getDebts':
                    await this.postDebts(message.payload?.projectId);
                    break;
                case 'analyzeWorkspace':
                    await this.analysisService.analyzeWorkspace();
                    this.postStatus('Workspace analysis triggered.');
                    break;
                case 'analyzeProject':
                    if (message.payload?.projectId) {
                        await this.analysisService.analyzeProject(message.payload.projectId);
                        this.postStatus('Project analysis triggered.');
                    }
                    break;
                case 'updateDebtStatus':
                    await this.updateDebtStatus(message.payload as DebtStatusPayload);
                    break;
                case 'openSettings':
                    vscode.commands.executeCommand('workbench.action.openSettings', 'technicalDebt');
                    break;
                default:
                    Logger.getInstance().debug('[Dashboard] Unknown message', message);
            }
        } catch (error: any) {
            this.postError(error.message ?? String(error));
        }
    }

    private async postProjects(): Promise<void> {
        try {
            const projects = await this.debtService.getProjects();
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const current = workspaceFolder ? await this.debtService.getProjectByPath(workspaceFolder.uri.fsPath) : null;
            this.panel.webview.postMessage({
                type: 'projects',
                payload: {
                    projects,
                    currentProjectId: current?.id ?? null
                }
            });
        } catch (error: any) {
            this.postError(error.message ?? 'Failed to load projects.');
        }
    }

    private async postDebts(projectId: string | undefined): Promise<void> {
        if (!projectId) {
            return;
        }

        try {
            const projects = await this.debtService.getProjects();
            const target = projects.find(project => String(project.id) === String(projectId));
            const debts = await this.debtService.getProjectDebts(projectId);
            this.panel.webview.postMessage({
                type: 'debts',
                payload: {
                    projectName: target?.name ?? target?.localPath ?? '',
                    debts
                }
            });
        } catch (error: any) {
            this.postError(error.message ?? 'Failed to load debts.');
        }
    }

    private async updateDebtStatus(payload: DebtStatusPayload): Promise<void> {
        if (!payload?.debtId || !payload?.status) {
            this.postError('Invalid debt update payload.');
            return;
        }

        try {
            await this.debtService.updateDebtStatus(payload.debtId, payload.status as any);
            this.postStatus('Debt status updated.');
        } catch (error: any) {
            this.postError(error.message ?? 'Failed to update debt status.');
        }
    }

    private postStatus(message: string): void {
        this.panel.webview.postMessage({ type: 'status', payload: message });
    }

    private postError(message: string): void {
        this.panel.webview.postMessage({ type: 'error', payload: message });
    }

    private postInitialData(): void {
        this.postProjects().catch(error => this.postError(error.message ?? 'Failed to initialise dashboard.'));
    }

    dispose(): void {
        DebtAnalysisPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            disposable?.dispose();
        }
    }
}
