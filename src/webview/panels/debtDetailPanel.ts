import * as path from 'path';
import * as vscode from 'vscode';
import { DebtItem, DebtStatus } from '../../types';
import { DebtService } from '../../extension/services/debtService';
import { getNonce } from '../utils/getNonce';

export class DebtDetailPanel {
    public static currentPanel: DebtDetailPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _debt: DebtItem;
    private _debtService: DebtService;

    public static createOrShow(extensionUri: vscode.Uri, debt: DebtItem, debtService: DebtService) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (DebtDetailPanel.currentPanel) {
            DebtDetailPanel.currentPanel._panel.reveal(column);
            DebtDetailPanel.currentPanel._debt = debt;
            DebtDetailPanel.currentPanel._update();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'technicalDebtDetail',
            `债务详情 - ${debt.filePath}`,
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

        DebtDetailPanel.currentPanel = new DebtDetailPanel(panel, extensionUri, debt, debtService);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, debt: DebtItem, debtService: DebtService) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._debt = debt;
        this._debtService = debtService;

        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // 处理来自 webview 的消息
        this._panel.webview.onDidReceiveMessage(
            async (data) => {
                switch (data.type) {
                    case 'updateDebtStatus':
                        await this.handleUpdateDebtStatus(data.payload);
                        break;
                    case 'navigateToFile':
                        await this.handleNavigateToFile(data.payload);
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

        // 将债务数据转换为 JSON 字符串，用于前端显示
        const debtData = JSON.stringify(this._debt);

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <title>债务详情</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                    line-height: 1.5;
                }
                .container {
                    max-width: 800px;
                    margin: 0 auto;
                }
                .header {
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 15px;
                    margin-bottom: 20px;
                }
                .debt-info {
                    background: var(--vscode-editor-inactiveSelectionBackground);
                    padding: 15px;
                    border-radius: 5px;
                    margin-bottom: 20px;
                }
                .severity-critical { border-left: 4px solid #f44336; }
                .severity-high { border-left: 4px solid #ff9800; }
                .severity-medium { border-left: 4px solid #ffeb3b; }
                .severity-low { border-left: 4px solid #4caf50; }
                .actions {
                    display: flex;
                    gap: 10px;
                    margin: 20px 0;
                }
                button {
                    padding: 8px 16px;
                    border: none;
                    border-radius: 3px;
                    cursor: pointer;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                }
                button:hover {
                    background: var(--vscode-button-hoverBackground);
                }
                .metadata {
                    background: var(--vscode-input-background);
                    padding: 15px;
                    border-radius: 5px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: var(--vscode-editor-font-size);
                }
                .suggestion {
                    background: var(--vscode-textBlockQuote-background);
                    border-left: 4px solid var(--vscode-textBlockQuote-border);
                    padding: 10px 15px;
                    margin: 15px 0;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>技术债务详情</h1>
                </div>
                
                <div class="debt-info severity-${this._debt.severity}">
                    <h2>${this._debt.description}</h2>
                    <p><strong>文件:</strong> ${this._debt.filePath}</p>
                    <p><strong>类型:</strong> ${this._debt.debtType}</p>
                    <p><strong>严重程度:</strong> ${this._debt.severity}</p>
                    <p><strong>预估修复时间:</strong> ${this._debt.estimatedEffort} 小时</p>
                    <p><strong>状态:</strong> ${this._debt.status}</p>
                    <p><strong>创建时间:</strong> ${new Date(this._debt.createdAt).toLocaleString()}</p>
                </div>

                ${this._debt.metadata?.suggestion ? `
                <div class="suggestion">
                    <h3>修复建议</h3>
                    <p>${this._debt.metadata.suggestion}</p>
                </div>
                ` : ''}

                <div class="actions">
                    <button onclick="updateStatus('in_progress')">标记为处理中</button>
                    <button onclick="updateStatus('resolved')">标记为已解决</button>
                    <button onclick="updateStatus('wont_fix')">忽略此债务</button>
                    <button onclick="navigateToFile()">定位到文件</button>
                </div>

                ${this._debt.metadata ? `
                <div class="metadata">
                    <h3>详细元数据</h3>
                    <pre>${JSON.stringify(this._debt.metadata, null, 2)}</pre>
                </div>
                ` : ''}
            </div>

            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                const debtData = ${debtData};

                function updateStatus(status) {
                    vscode.postMessage({
                        type: 'updateDebtStatus',
                        payload: {
                            debtId: debtData.id,
                            status: status
                        }
                    });
                }

                function navigateToFile() {
                    vscode.postMessage({
                        type: 'navigateToFile',
                        payload: {
                            filePath: debtData.filePath,
                            line: debtData.metadata?.location?.line || 1
                        }
                    });
                }

                // 设置初始状态
                vscode.setState({ debt: debtData });
            </script>
        </body>
        </html>`;
    }

    private async handleUpdateDebtStatus(payload: { debtId: string; status: DebtStatus }) {
        try {
            await this._debtService.updateDebtStatus(payload.debtId, payload.status);
            vscode.window.showInformationMessage(`债务状态已更新为: ${payload.status}`);
            
            // 刷新树视图
            vscode.commands.executeCommand('technicalDebt.refresh');
            
            // 关闭面板
            this._panel.dispose();
        } catch (error: any) {
            vscode.window.showErrorMessage(`更新债务状态失败: ${error.message}`);
        }
    }

    private async handleNavigateToFile(payload: { filePath: string; line: number }) {
        try {
            const filePath = payload.filePath;
            let fileUri: vscode.Uri;

            if (path.isAbsolute(filePath)) {
                fileUri = vscode.Uri.file(filePath);
            } else {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceFolder) {
                    throw new Error('未打开工作区，无法定位相对路径');
                }
                fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
            }

            const document = await vscode.workspace.openTextDocument(fileUri);
            const editor = await vscode.window.showTextDocument(document);

            // 定位到具体行
            const line = Math.max(0, (payload.line || 1) - 1); // 转换为 0-based
            const position = new vscode.Position(line, 0);
            const range = new vscode.Range(position, position);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

            // 设置选择
            editor.selection = new vscode.Selection(position, position);
        } catch (error: any) {
            vscode.window.showErrorMessage(`无法打开文件: ${error.message}`);
        }
    }

    public dispose() {
        DebtDetailPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}