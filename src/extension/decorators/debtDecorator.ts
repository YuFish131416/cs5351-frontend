import * as vscode from 'vscode';
import { DebtItem, DebtSeverity } from '../../types';
import { DebtService } from '../services/debtService';
import { ConfigManager } from '../utils/configManager';

export class DebtDecorator {
    private debtService: DebtService;
    private configManager: ConfigManager;
    private decorationTypes: Map<DebtSeverity, vscode.TextEditorDecorationType> = new Map();
    private currentDecorations: Map<string, vscode.DecorationOptions[]> = new Map();

    constructor() {
        this.debtService = new DebtService();
        this.configManager = ConfigManager.getInstance();
        this.initializeDecorationTypes();
    }

    private initializeDecorationTypes(): void {
        // 清除现有的装饰类型
        this.decorationTypes.forEach(decoration => decoration.dispose());
        this.decorationTypes.clear();

        // 为每种严重程度创建装饰类型
        const severityStyles: Record<DebtSeverity, vscode.DecorationRenderOptions> = {
            [DebtSeverity.CRITICAL]: {
                backgroundColor: 'rgba(244, 67, 54, 0.1)',
                border: '1px solid rgba(244, 67, 54, 0.3)',
                overviewRulerColor: '#f44336',
                overviewRulerLane: vscode.OverviewRulerLane.Right
            },
            [DebtSeverity.HIGH]: {
                backgroundColor: 'rgba(255, 152, 0, 0.1)',
                border: '1px solid rgba(255, 152, 0, 0.3)',
                overviewRulerColor: '#ff9800',
                overviewRulerLane: vscode.OverviewRulerLane.Right
            },
            [DebtSeverity.MEDIUM]: {
                backgroundColor: 'rgba(255, 235, 59, 0.1)',
                border: '1px solid rgba(255, 235, 59, 0.3)',
                overviewRulerColor: '#ffeb3b',
                overviewRulerLane: vscode.OverviewRulerLane.Right
            },
            [DebtSeverity.LOW]: {
                backgroundColor: 'rgba(76, 175, 80, 0.1)',
                border: '1px solid rgba(76, 175, 80, 0.3)',
                overviewRulerColor: '#4caf50',
                overviewRulerLane: vscode.OverviewRulerLane.Right
            }
        };

        Object.entries(severityStyles).forEach(([severity, style]) => {
            const decorationType = vscode.window.createTextEditorDecorationType(style);
            this.decorationTypes.set(severity as DebtSeverity, decorationType);
        });
    }

    async updateDecorationsForActiveEditor(): Promise<void> {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return;
        }

        await this.updateDecorationsForEditor(activeEditor);
    }

    async updateDecorationsForEditor(editor: vscode.TextEditor): Promise<void> {
        const config = this.configManager.getConfig();
        const minSeverity = config.ui.decorationSeverity;

        if (!config.ui.heatmapEnabled) {
            this.clearDecorationsForEditor(editor);
            return;
        }

        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return;
            }

            const projects = await this.debtService.getProjects();
            const project = projects.find(p => p.localPath === workspaceFolder.uri.fsPath);
            
            if (!project) {
                return;
            }

            const fileDebts = await this.debtService.getFileDebts(project.id, editor.document.fileName);
            const filteredDebts = fileDebts.filter(debt => 
                this.isSeverityAboveThreshold(debt.severity, minSeverity)
            );

            this.applyDecorations(editor, filteredDebts);

        } catch (error: any) {
            console.error('更新装饰器时出错:', error.message);
        }
    }

    private isSeverityAboveThreshold(severity: DebtSeverity, threshold: DebtSeverity): boolean {
        const severityOrder = {
            [DebtSeverity.CRITICAL]: 4,
            [DebtSeverity.HIGH]: 3,
            [DebtSeverity.MEDIUM]: 2,
            [DebtSeverity.LOW]: 1
        };

        return severityOrder[severity] >= severityOrder[threshold];
    }

    private applyDecorations(editor: vscode.TextEditor, debts: DebtItem[]): void {
        // 清除现有装饰
        this.clearDecorationsForEditor(editor);

        // 按严重程度分组债务
        const debtsBySeverity = new Map<DebtSeverity, vscode.DecorationOptions[]>();

        debts.forEach(debt => {
            const lineNumber = this.extractLineNumberFromMetadata(debt);
            if (lineNumber === undefined) {
                return;
            }

            const range = new vscode.Range(lineNumber, 0, lineNumber, 0);
            const decoration: vscode.DecorationOptions = {
                range: range,
                hoverMessage: this.createHoverMessage(debt)
            };

            if (!debtsBySeverity.has(debt.severity)) {
                debtsBySeverity.set(debt.severity, []);
            }
            debtsBySeverity.get(debt.severity)!.push(decoration);
        });

        // 应用装饰
        debtsBySeverity.forEach((decorations, severity) => {
            const decorationType = this.decorationTypes.get(severity);
            if (decorationType) {
                editor.setDecorations(decorationType, decorations);
                
                // 保存当前装饰以便后续清理
                const editorKey = editor.document.uri.toString();
                if (!this.currentDecorations.has(editorKey)) {
                    this.currentDecorations.set(editorKey, []);
                }
                this.currentDecorations.get(editorKey)!.push(...decorations);
            }
        });
    }

    private extractLineNumberFromMetadata(debt: DebtItem): number | undefined {
        const location = debt.metadata?.location;
        if (location && typeof location.line === 'number') {
            return location.line - 1; // VSCode 行号从 0 开始
        }
        return undefined;
    }

    private createHoverMessage(debt: DebtItem): vscode.MarkdownString {
        const message = new vscode.MarkdownString();
        message.appendMarkdown(`### 🚨 技术债务\n\n`);
        message.appendMarkdown(`**类型**: ${debt.debtType}\n\n`);
        message.appendMarkdown(`**描述**: ${debt.description}\n\n`);
        message.appendMarkdown(`**严重程度**: ${debt.severity}\n\n`);
        message.appendMarkdown(`**预估修复**: ${debt.estimatedEffort} 小时\n\n`);
        
        if (debt.metadata?.suggestion) {
            message.appendMarkdown(`**建议**: ${debt.metadata.suggestion}\n\n`);
        }

        return message;
    }

    clearDecorationsForEditor(editor: vscode.TextEditor): void {
        this.decorationTypes.forEach(decorationType => {
            editor.setDecorations(decorationType, []);
        });

        const editorKey = editor.document.uri.toString();
        this.currentDecorations.delete(editorKey);
    }

    clearAllDecorations(): void {
        vscode.window.visibleTextEditors.forEach(editor => {
            this.clearDecorationsForEditor(editor);
        });
        this.currentDecorations.clear();
    }

    dispose(): void {
        this.clearAllDecorations();
        this.decorationTypes.forEach(decoration => decoration.dispose());
        this.decorationTypes.clear();
    }
}