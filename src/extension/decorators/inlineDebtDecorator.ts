import * as vscode from 'vscode';
import { FileDebtIndex, FileDebt } from '../services/fileDebtIndex';

const severityLabel: Record<string, string> = {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low'
};

export class InlineDebtDecorator {
    private static _instance: InlineDebtDecorator | undefined;
    static getInstance(): InlineDebtDecorator { return this._instance ?? (this._instance = new InlineDebtDecorator()); }

    private index = FileDebtIndex.getInstance();
    private decorationTypes: Record<string, vscode.TextEditorDecorationType> = {};
    private enabled = true;

    constructor() {
        this.createDecorationTypes();
    }

    setEnabled(v: boolean) { this.enabled = v; if (!v) this.clearAllEditors(); else this.refreshActiveEditor(); }

    private createDecorationTypes() {
        const base = (color: string) => vscode.window.createTextEditorDecorationType({
            isWholeLine: false,
            backgroundColor: color,
            overviewRulerColor: color,
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            gutterIconPath: undefined,
        });
        this.decorationTypes['low'] = base('rgba(100,149,237,0.18)');
        this.decorationTypes['medium'] = base('rgba(255,193,7,0.25)');
        this.decorationTypes['high'] = base('rgba(255,87,34,0.30)');
        this.decorationTypes['critical'] = base('rgba(244,67,54,0.45)');
    }

    async refreshActiveEditor(forceScan = false) {
        if (!this.enabled) return;
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const doc = editor.document;
        const debts = await this.index.scanFile(doc, forceScan);
        this.apply(editor, debts);
    }

    private apply(editor: vscode.TextEditor, debts: FileDebt[]) {
        // group by severity
        const groups: Record<string, vscode.DecorationOptions[]> = { low: [], medium: [], high: [], critical: [] };
        for (const d of debts) {
            const line = Math.max(0, d.line - 1);
            if (line >= editor.document.lineCount) continue;
            const severityKey = String(d.severity || 'low').toLowerCase();
            const severityLabelText = severityLabel[severityKey] ?? severityKey.toUpperCase();
            const riskFlags = d.riskFlags && d.riskFlags.length ? d.riskFlags : (d.metadata?.risk_flags ?? []);
            const smellFlags = d.smellFlags && d.smellFlags.length ? d.smellFlags : (d.metadata?.smell_flags ?? []);
            const effort = d.estimatedEffort ?? d.metadata?.estimated_effort;
            const score = d.debtScore ?? d.metadata?.debt_score;

            const bulletLines: string[] = [`- 行号：${line + 1}`];
            if (riskFlags && riskFlags.length) {
                bulletLines.push(`- 风险标记：${riskFlags.map(flag => `\`${flag}\``).join(' ')}`);
            }
            if (d.description) {
                bulletLines.push(`- 描述：${d.description.trim()}`);
            }
            if (smellFlags && smellFlags.length) {
                bulletLines.push(`- 代码气味：${smellFlags.map(flag => `\`${flag}\``).join(' ')}`);
            }
            if (Number.isFinite(effort)) {
                bulletLines.push(`- 预估修复：${Math.round(Number(effort))} 小时`);
            }
            if (typeof score === 'number') {
                bulletLines.push(`- 债务得分：${score.toFixed(3)}`);
            }

            const hover = new vscode.MarkdownString(`**${severityLabelText} 技术债务**\n\n${bulletLines.join('\n')}`);
            hover.supportHtml = false;
            hover.isTrusted = true;

            const range = new vscode.Range(line, 0, line, editor.document.lineAt(line).text.length);
            groups[severityKey]?.push({ range, hoverMessage: hover });
        }
        for (const key of Object.keys(this.decorationTypes)) {
            editor.setDecorations(this.decorationTypes[key], groups[key] || []);
        }
    }

    clearAllEditors() {
        for (const e of vscode.window.visibleTextEditors) {
            for (const key of Object.keys(this.decorationTypes)) e.setDecorations(this.decorationTypes[key], []);
        }
    }
}
