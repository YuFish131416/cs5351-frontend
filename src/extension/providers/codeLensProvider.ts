import * as vscode from 'vscode';
import { DebtItem, DebtSeverity } from '../../types';
import { DebtService } from '../services/debtService';

export class DebtCodeLensProvider implements vscode.CodeLensProvider {
    private debtService: DebtService;
    private onDidChangeCodeLensesEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this.onDidChangeCodeLensesEmitter.event;

    constructor() {
        this.debtService = new DebtService();
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];

        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return codeLenses;
            }

            const projects = await this.debtService.getProjects();
            const project = projects.find(p => p.localPath === workspaceFolder.uri.fsPath);

            if (!project) {
                return codeLenses;
            }

            const fileDebts = await this.debtService.getFileDebts(project.id, document.fileName);

            // 按行号分组债务
            const debtsByLine = new Map<number, DebtItem[]>();

            fileDebts.forEach(debt => {
                const lineNumber = this.extractLineNumberFromMetadata(debt);
                if (lineNumber !== undefined) {
                    if (!debtsByLine.has(lineNumber)) {
                        debtsByLine.set(lineNumber, []);
                    }
                    debtsByLine.get(lineNumber)!.push(debt);
                }
            });

            // 为每个有债务的行创建 CodeLens
            for (const [lineNumber, debts] of debtsByLine) {
                const range = new vscode.Range(lineNumber, 0, lineNumber, 0);
                // 只传递单个债务对象给命令（首个），避免向命令传入数组导致调用方误读
                const codeLens = this.createCodeLens(range, debts);
                if (codeLens) {
                    codeLenses.push(codeLens);
                }
            }

        } catch (error) {
            console.error('提供 CodeLens 时出错:', error);
        }

        return codeLenses;
    }

    private extractLineNumberFromMetadata(debt: DebtItem): number | undefined {
        // 从元数据中提取行号信息
        // 这取决于后端如何存储位置信息
        const location = debt.metadata?.location;
        if (location && typeof location.line === 'number') {
            return location.line - 1; // VSCode 行号从 0 开始
        }
        return undefined;
    }

    private createCodeLens(range: vscode.Range, debts: DebtItem[]): vscode.CodeLens | null {
        if (debts.length === 0) {
            return null;
        }

        const highestSeverity = this.getHighestSeverity(debts);
        const debtCount = debts.length;
        const totalEffort = debts.reduce((sum, debt) => sum + debt.estimatedEffort, 0);

        const title = `技术债务: ${debtCount} 个问题 (${totalEffort}h)`;

        const codeLens = new vscode.CodeLens(range, {
            title: title,
            tooltip: this.createTooltip(debts),
            command: 'technicalDebt.showDebtDetails',
            // 仅传递首个债务对象作为参数，调用方可以基于需要进一步处理
            arguments: [debts[0]]
        });

        return codeLens;
    }

    private getHighestSeverity(debts: DebtItem[]): DebtSeverity {
        const severityOrder = {
            [DebtSeverity.CRITICAL]: 4,
            [DebtSeverity.HIGH]: 3,
            [DebtSeverity.MEDIUM]: 2,
            [DebtSeverity.LOW]: 1
        };

        return debts.reduce((highest, debt) => {
            return severityOrder[debt.severity] > severityOrder[highest] ? debt.severity : highest;
        }, DebtSeverity.LOW);
    }

    private createTooltip(debts: DebtItem[]): string {
        const debtDescriptions = debts.map(debt =>
            `• [${debt.severity.toUpperCase()}] ${debt.description} (${debt.estimatedEffort}h)`
        ).join('\n');

        return `技术债务详情:\n${debtDescriptions}`;
    }

    refresh(): void {
        this.onDidChangeCodeLensesEmitter.fire();
    }
}