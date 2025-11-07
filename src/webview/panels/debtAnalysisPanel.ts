import * as vscode from 'vscode';
import { DebtService } from '../../extension/services/debtService';
import { getNonce } from '../utils/getNonce';

export class DebtAnalysisPanel {
    public static currentPanel: DebtAnalysisPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _debtService: DebtService;

    public static createOrShow(extensionUri: vscode.Uri, debtService: DebtService) {
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

        DebtAnalysisPanel.currentPanel = new DebtAnalysisPanel(panel, extensionUri, debtService);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, debtService: DebtService) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._debtService = debtService;

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
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                }
                #app {
                    max-width: 1200px;
                    margin: 0 auto;
                }
            </style>
        </head>
        <body>
            <div id="app">
                <h1>技术债务分析面板</h1>
                <div id="dashboard">加载中...</div>
            </div>
            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();

                // 请求项目数据
                vscode.postMessage({ type: 'getProjects' });

                // 处理来自扩展的消息
                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'projectsData':
                            document.getElementById('dashboard').innerHTML = 
                                '<p>项目数量: ' + message.payload.length + '</p>';
                            break;
                        case 'debtSummary':
                            document.getElementById('dashboard').innerHTML = 
                                '<p>总债务数: ' + message.payload.totalDebts + '</p>';
                            break;
                        case 'error':
                            document.getElementById('dashboard').innerHTML = 
                                '<p style="color: red;">错误: ' + message.payload + '</p>';
                            break;
                    }
                });
            </script>
        </body>
        </html>`;
    }

    private async handleGetProjects() {
        try {
            const projects = await this._debtService.getProjects();
            this._panel.webview.postMessage({
                type: 'projectsData',
                payload: projects
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