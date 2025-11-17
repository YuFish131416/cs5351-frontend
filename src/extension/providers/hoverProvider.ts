import * as vscode from 'vscode';
import { DebtItem } from '../../types';
import { DebtService } from '../services/debtService';

export class DebtHoverProvider implements vscode.HoverProvider {
    private debtService: DebtService;

    constructor() {
        this.debtService = new DebtService();
    }

    async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
        try {
            if (document.uri.scheme !== 'file') {
                return null;
            }

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return null;
            }

            const projects = await this.debtService.getProjects();
            const project = projects.find(p => p.localPath === workspaceFolder.uri.fsPath);

            if (!project) {
                return null;
            }

            const fileDebts = await this.debtService.getFileDebts(project.id, document.fileName);
            const lineDebts = fileDebts.filter(debt =>
                this.isDebtAtPosition(debt, position)
            );

            if (lineDebts.length === 0) {
                return null;
            }

            const hoverContent = this.createHoverContent(lineDebts);
            return new vscode.Hover(hoverContent);

        } catch (error) {
            console.error('提供 Hover 时出错:', error);
            return null;
        }
    }

    private isDebtAtPosition(debt: DebtItem, position: vscode.Position): boolean {
        const location = debt.metadata?.location;
        if (!location) {
            return false;
        }

        const debtLine = location.line - 1; // 转换为 0-based
        return debtLine === position.line;
    }

    private createHoverContent(debts: DebtItem[]): vscode.MarkdownString {
        const content = new vscode.MarkdownString();
        content.isTrusted = true;

        content.appendMarkdown('### 🚨 技术债务\n\n');

        const encodeArgs = (value: DebtItem) => {
            try {
                return encodeURIComponent(JSON.stringify([value]));
            } catch {
                return encodeURIComponent(JSON.stringify([ { id: value.id } ]));
            }
        };

        debts.forEach((debt, index) => {
            const severityIcon = this.getSeverityIcon(debt.severity);
            const statusIcon = this.getStatusIcon(debt.status);
            const encodedArgs = encodeArgs(debt);

            content.appendMarkdown(`**${severityIcon} ${debt.debtType.toUpperCase()}** ${statusIcon}\n\n`);
            content.appendMarkdown(`${debt.description}\n\n`);
            content.appendMarkdown(`- **预估修复时间**: ${debt.estimatedEffort} 小时\n`);
            content.appendMarkdown(`- **严重程度**: ${debt.severity}\n`);

            if (debt.metadata?.suggestion) {
                content.appendMarkdown(`- **修复建议**: ${debt.metadata.suggestion}\n`);
            }

            content.appendMarkdown(`\n[查看详情](command:technicalDebt.showDebtDetails?${encodedArgs}) | `);
            content.appendMarkdown(`[标记为处理中](command:technicalDebt.markAsInProgress?${encodedArgs}) | `);
            content.appendMarkdown(`[标记为已解决](command:technicalDebt.markAsResolved?${encodedArgs})\n`);

            if (index < debts.length - 1) {
                content.appendMarkdown('\n---\n\n');
            }
        });

        return content;
    }

    private getSeverityIcon(severity: string): string {
        switch (severity) {
            case 'critical': return '🔴';
            case 'high': return '🟠';
            case 'medium': return '🟡';
            case 'low': return '🟢';
            default: return '⚪';
        }
    }

    private getStatusIcon(status: string): string {
        switch (status) {
            case 'open': return '📋';
            case 'in_progress': return '🔄';
            case 'resolved': return '✅';
            case 'wont_fix': return '❌';
            default: return '❓';
        }
    }
}