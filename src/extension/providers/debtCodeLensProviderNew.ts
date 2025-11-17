import * as vscode from 'vscode';
import { FileDebtIndex } from '../services/fileDebtIndex';
import { DebtStatus } from '../../types/debt';

export class DebtCodeLensProviderNew implements vscode.CodeLensProvider {
    private index = FileDebtIndex.getInstance();
    private onDidChangeEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this.onDidChangeEmitter.event;

    refresh() { this.onDidChangeEmitter.fire(); }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const debts = this.index.getCachedFileDebts(document);
        const lenses: vscode.CodeLens[] = [];
        if (debts.length > 0) {
            const summary = this.summarize(debts);
            lenses.push(new vscode.CodeLens(new vscode.Range(0,0,0,0), {
                title: `技术债务: 共${debts.length} (low:${summary.low} / med:${summary.medium} / high:${summary.high} / crit:${summary.critical})`,
                command: 'technicalDebt.showFileDebts'
            }));
        } else {
            lenses.push(new vscode.CodeLens(new vscode.Range(0,0,0,0), {
                title: '技术债务: 无 (点击扫描)',
                command: 'technicalDebt.scanFile'
            }));
        }
        // Row lenses
        for (const d of debts) {
            const line = Math.max(0, d.line - 1);
            if (line >= document.lineCount) continue;
            lenses.push(new vscode.CodeLens(new vscode.Range(line,0,line,0), {
                title: `标记进行中`,
                command: 'technicalDebt.markDebt.inProgress',
                arguments: [d]
            }));
            lenses.push(new vscode.CodeLens(new vscode.Range(line,0,line,0), {
                title: `标记已解决`,
                command: 'technicalDebt.markDebt.resolved',
                arguments: [d]
            }));
            lenses.push(new vscode.CodeLens(new vscode.Range(line,0,line,0), {
                title: `忽略`,
                command: 'technicalDebt.markDebt.ignored',
                arguments: [d]
            }));
        }
        return lenses;
    }

    private summarize(debts: any[]) {
        const result: Record<string, number> = { low:0, medium:0, high:0, critical:0 };
        debts.forEach(d => { result[d.severity] = (result[d.severity]||0)+1; });
        return result;
    }
}
