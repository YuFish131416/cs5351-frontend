import * as vscode from 'vscode';
import { FileDebtIndex, FileDebt } from '../services/fileDebtIndex';
import { Logger } from '../utils/logger';

export class InlineDebtDecorator {
    private static _instance: InlineDebtDecorator | undefined;
    static getInstance(): InlineDebtDecorator { return this._instance ?? (this._instance = new InlineDebtDecorator()); }

    private index = FileDebtIndex.getInstance();
    private logger = Logger.getInstance();
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
        const groups: Record<string, vscode.Range[]> = { low: [], medium: [], high: [], critical: [] };
        for (const d of debts) {
            const line = Math.max(0, d.line - 1);
            if (line >= editor.document.lineCount) continue;
            const range = new vscode.Range(line, 0, line, editor.document.lineAt(line).text.length);
            groups[d.severity]?.push(range);
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
