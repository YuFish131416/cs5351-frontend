import * as path from 'path';
import * as vscode from 'vscode';
import { FileDebtIndex, FileDebt } from '../services/fileDebtIndex';
import { DebtService } from '../services/debtService';
import { DebtItem, DebtSeverity } from '../../types/debt';

abstract class BaseTreeItem extends vscode.TreeItem {
    constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState) {
        super(label, collapsibleState);
    }
}

export enum ViewMode {
    FILE = 'file',
    WORKSPACE = 'workspace'
}

const severityLabelMap: Record<DebtSeverity, string> = {
    [DebtSeverity.CRITICAL]: 'Critical',
    [DebtSeverity.HIGH]: 'High',
    [DebtSeverity.MEDIUM]: 'Medium',
    [DebtSeverity.LOW]: 'Low'
};

function formatSeverityLabel(severity: DebtSeverity): string {
    return severityLabelMap[severity] ?? 'Low';
}

class ViewSwitcherTreeItem extends BaseTreeItem {
    public readonly type = 'switcher';

    constructor(public readonly target: ViewMode) {
        super(ViewSwitcherTreeItem.getLabel(target), vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'viewSwitcher';
        this.command = {
            command: 'technicalDebt.switchViewMode',
            title: '切换视图',
            arguments: [target]
        };
        this.description = ViewSwitcherTreeItem.getDescription(target);
        this.tooltip = ViewSwitcherTreeItem.getTooltip(target);
        this.iconPath = target === ViewMode.FILE
            ? new vscode.ThemeIcon('arrow-left')
            : new vscode.ThemeIcon('symbol-structure');
    }

    private static getLabel(target: ViewMode): string {
        return target === ViewMode.FILE ? '返回文件视图' : '查看项目概览';
    }

    private static getDescription(target: ViewMode): string {
        return target === ViewMode.FILE ? '展示当前已打开文件中的债务' : '聚合整个工作区的债务';
    }

    private static getTooltip(target: ViewMode): string {
        return target === ViewMode.FILE
            ? '切换回“当前文件”视图以关注正在编辑的文件。'
            : '切换至“项目概览”视图以查看整个工作区的技术债务。';
    }
}

class WorkspaceDebtTreeItem extends BaseTreeItem {
    public readonly type = 'workspace-debt';

    constructor(
        public readonly debt: DebtItem,
        private readonly resolvedPath: string,
        private readonly relativePath: string,
        private readonly originalPath: string
    ) {
        super(WorkspaceDebtTreeItem.getLabel(debt), vscode.TreeItemCollapsibleState.None);
        this.tooltip = WorkspaceDebtTreeItem.getTooltip(debt, resolvedPath, relativePath, originalPath);
        this.contextValue = 'workspaceDebtItem';
        this.iconPath = WorkspaceDebtTreeItem.getSeverityIcon(debt.severity);
        this.description = WorkspaceDebtTreeItem.buildDescription(debt, relativePath || path.basename(resolvedPath));
        this.command = {
            command: 'technicalDebt.revealDebtInEditor',
            title: '跳转到代码位置',
            arguments: [WorkspaceDebtTreeItem.buildCommandPayload(debt, resolvedPath)]
        };
    }

    private static getLabel(debt: DebtItem): string {
        const severity = String(debt.severity || '').toUpperCase();
        const riskFlags = WorkspaceDebtTreeItem.getRiskFlags(debt);
        const snippet = riskFlags.length ? riskFlags.slice(0, 2).join(' · ') : (debt.description || '').replace(/\s+/g, ' ').slice(0, 80);
        return `[${severity}] ${snippet || '技术债务'}`;
    }

    private static buildCommandPayload(debt: DebtItem, resolvedPath: string): FileDebt {
        const line = WorkspaceDebtTreeItem.getLine(debt);
        const metadata = WorkspaceDebtTreeItem.getMetadata(debt);
        const payload: FileDebt = {
            id: String(debt.id),
            filePath: resolvedPath,
            line,
            severity: debt.severity,
            description: debt.description || '',
            status: String(debt.status || 'open').toLowerCase(),
            metadata,
            riskFlags: WorkspaceDebtTreeItem.getRiskFlags(debt),
            smellFlags: WorkspaceDebtTreeItem.getSmellFlags(metadata),
            estimatedEffort: metadata?.estimated_effort,
            debtScore: typeof metadata?.debt_score === 'number' ? metadata?.debt_score : undefined
        };
        return payload;
    }

    private static getTooltip(debt: DebtItem, _resolvedPath: string, _relativePath: string, _originalPath: string): vscode.MarkdownString {
        const line = WorkspaceDebtTreeItem.getLine(debt);
        const riskFlags = WorkspaceDebtTreeItem.getRiskFlags(debt);
        const metadata = WorkspaceDebtTreeItem.getMetadata(debt);
        const smellFlags = WorkspaceDebtTreeItem.getSmellFlags(metadata);
        const score = metadata?.debt_score;
        const effort = metadata?.estimated_effort;

        const md = new vscode.MarkdownString(undefined, true);
        md.supportHtml = false;
        md.isTrusted = true;
        md.appendMarkdown(`**${formatSeverityLabel(debt.severity)} · 行 ${line}**\n\n`);
        md.appendMarkdown(`- 状态：${String(debt.status || 'open')}\n`);
        if (riskFlags.length) {
            md.appendMarkdown(`- 风险标记：${riskFlags.map(flag => `\`${flag}\``).join(' ')}\n`);
        }
        if (smellFlags.length) {
            md.appendMarkdown(`- 代码气味：${smellFlags.map(flag => `\`${flag}\``).join(' ')}\n`);
        }
        if (typeof score === 'number') {
            md.appendMarkdown(`- 债务得分：${score.toFixed(3)}\n`);
        }
        if (Number.isFinite(effort)) {
            md.appendMarkdown(`- 预估修复：${Math.round(Number(effort))} 小时\n`);
        }
        if (debt.description) {
            md.appendMarkdown(`\n${debt.description.trim()}`);
        }
        return md;
    }

    private static getLine(debt: DebtItem): number {
        const meta = (debt.metadata as any) || {};
        const metaLine = Number(meta?.location?.line ?? meta?.line);
        const fallbackLine = Number((debt as any).line);
        if (Number.isFinite(metaLine) && metaLine > 0) {
            return metaLine;
        }
        if (Number.isFinite(fallbackLine) && fallbackLine > 0) {
            return fallbackLine;
        }
        return 1;
    }

    private static buildDescription(debt: DebtItem, fallback: string): string {
        const line = WorkspaceDebtTreeItem.getLine(debt);
        const riskFlags = WorkspaceDebtTreeItem.getRiskFlags(debt);
        const riskSnippet = riskFlags.length ? riskFlags[0] : null;
        const bits = [`行 ${line}`];
        if (riskSnippet) {
            bits.push(riskSnippet);
        } else if (fallback) {
            bits.push(fallback);
        }
        return bits.join(' · ');
    }

    static getMetadata(debt: DebtItem): Record<string, any> | undefined {
        return (debt.metadata && typeof debt.metadata === 'object') ? debt.metadata : undefined;
    }

    static getRiskFlags(debt: DebtItem): string[] {
        const metadata = WorkspaceDebtTreeItem.getMetadata(debt);
        const flags = metadata?.risk_flags || metadata?.riskFlags || (debt as any).risk_flags || [];
        return Array.isArray(flags) ? (flags as string[]).filter(Boolean) : [];
    }

    private static getSmellFlags(metadata?: Record<string, any>): string[] {
        const flags = metadata?.smell_flags || metadata?.smellFlags || [];
        return Array.isArray(flags) ? (flags as string[]).filter(Boolean) : [];
    }

    private static getSeverityIcon(severity: DebtSeverity): vscode.ThemeIcon {
        switch (severity) {
            case DebtSeverity.CRITICAL:
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
            case DebtSeverity.HIGH:
                return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red'));
            case DebtSeverity.MEDIUM:
                return new vscode.ThemeIcon('info', new vscode.ThemeColor('charts.orange'));
            case DebtSeverity.LOW:
                return new vscode.ThemeIcon('symbol-boolean', new vscode.ThemeColor('charts.yellow'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }
}

class FileTreeItem extends BaseTreeItem {
    public readonly type = 'file';

    constructor(
        public readonly filePath: string,
        public readonly debtCount: number,
        private readonly worstSeverity: DebtSeverity | undefined,
        private readonly severityCounts: Record<DebtSeverity, number>,
        options?: {
            initialState?: vscode.TreeItemCollapsibleState;
            displayPath?: string;
            summary?: string;
        }
    ) {
        super(
            path.basename(filePath),
            options?.initialState ?? (debtCount > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None)
        );
        this.contextValue = 'debtFile';
        this.iconPath = FileTreeItem.getSeverityIcon(worstSeverity);
        this.resourceUri = vscode.Uri.file(filePath);
        this.displayPath = options?.displayPath;
        this.description = options?.summary
            ? options.summary
            : debtCount > 0
                ? FileTreeItem.formatDescription(debtCount, severityCounts)
                : '无债务';
        this.tooltip = FileTreeItem.createTooltip(filePath, debtCount, severityCounts, this.displayPath, options?.summary);
    }

    private readonly displayPath?: string;

    private static getSeverityIcon(severity?: DebtSeverity): vscode.ThemeIcon {
        switch (severity) {
            case DebtSeverity.CRITICAL:
                return new vscode.ThemeIcon('flame', new vscode.ThemeColor('errorForeground'));
            case DebtSeverity.HIGH:
                return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red'));
            case DebtSeverity.MEDIUM:
                return new vscode.ThemeIcon('symbol-field', new vscode.ThemeColor('charts.orange'));
            case DebtSeverity.LOW:
                return new vscode.ThemeIcon('symbol-misc', new vscode.ThemeColor('charts.yellow'));
            default:
                return new vscode.ThemeIcon('file-code');
        }
    }

    private static formatDescription(debtCount: number, counts: Record<DebtSeverity, number>): string {
        const parts: string[] = [`${debtCount} 项`];
        const order: DebtSeverity[] = [DebtSeverity.CRITICAL, DebtSeverity.HIGH, DebtSeverity.MEDIUM, DebtSeverity.LOW];
        for (const severity of order) {
            const value = counts[severity] ?? 0;
            if (value > 0) {
                parts.push(`${formatSeverityLabel(severity)}×${value}`);
            }
        }
        return parts.join(' · ');
    }

    private static createTooltip(
        filePath: string,
        debtCount: number,
        counts: Record<DebtSeverity, number>,
        displayPath?: string,
        summary?: string
    ): vscode.MarkdownString {
        const md = new vscode.MarkdownString(undefined, true);
        md.supportHtml = false;
        md.isTrusted = true;
        const relative = displayPath && displayPath !== filePath ? displayPath : path.basename(filePath);
        md.appendMarkdown(`**${relative}**\n\n`);
        md.appendMarkdown(`- 债务总数：${debtCount}\n`);
        if (summary) {
            md.appendMarkdown(`- 风险摘要：${summary}\n`);
        }
        const severityOrder: DebtSeverity[] = [DebtSeverity.CRITICAL, DebtSeverity.HIGH, DebtSeverity.MEDIUM, DebtSeverity.LOW];
        for (const severity of severityOrder) {
            const count = counts[severity] ?? 0;
            md.appendMarkdown(`- ${formatSeverityLabel(severity)}：${count}\n`);
        }
        return md;
    }
}

class DebtTreeItem extends BaseTreeItem {
    public readonly type = 'debt';

    constructor(public readonly debt: FileDebt) {
        super(DebtTreeItem.getLabel(debt), vscode.TreeItemCollapsibleState.None);
        this.tooltip = DebtTreeItem.createTooltip(debt);
        this.contextValue = 'debtItem';
        this.iconPath = DebtTreeItem.getSeverityIcon(debt.severity);
        this.command = {
            command: 'technicalDebt.revealDebtInEditor',
            title: '跳转到代码位置',
            arguments: [debt]
        };
        this.description = DebtTreeItem.buildDescription(debt);
    }

    private static getLabel(debt: FileDebt): string {
        const severity = String(debt.severity || '').toUpperCase();
        const risk = (debt.riskFlags && debt.riskFlags.length ? debt.riskFlags : debt.metadata?.risk_flags) || [];
        const snippetSource = risk && (risk as string[]).length ? (risk as string[]).join(' · ') : (debt.description || '');
        const snippet = snippetSource.replace(/\s+/g, ' ').slice(0, 60);
        return `[${severity}] ${snippet || '技术债务'}`;
    }

    private static createTooltip(debt: FileDebt): vscode.MarkdownString {
        const riskFlags = debt.riskFlags && debt.riskFlags.length ? debt.riskFlags : (debt.metadata?.risk_flags ?? []);
        const smellFlags = debt.smellFlags && debt.smellFlags.length ? debt.smellFlags : (debt.metadata?.smell_flags ?? []);
        const md = new vscode.MarkdownString(undefined, true);
        md.supportHtml = false;
        md.isTrusted = true;
        md.appendMarkdown(`**${formatSeverityLabel(debt.severity)} · 行 ${debt.line}**\n\n`);
        md.appendMarkdown(`- 状态：${String(debt.status || 'open')}\n`);
        if (riskFlags && riskFlags.length) {
            md.appendMarkdown(`- 风险标记：${riskFlags.map(flag => `\`${flag}\``).join(' ')}\n`);
        }
        if (smellFlags && smellFlags.length) {
            md.appendMarkdown(`- 代码气味：${smellFlags.map(flag => `\`${flag}\``).join(' ')}\n`);
        }
        if (typeof debt.debtScore === 'number') {
            md.appendMarkdown(`- 债务得分：${debt.debtScore.toFixed(3)}\n`);
        }
        if (Number.isFinite(debt.estimatedEffort)) {
            md.appendMarkdown(`- 预估修复：${Math.round(Number(debt.estimatedEffort))} 小时\n`);
        }
        if (debt.description) {
            md.appendMarkdown(`\n${debt.description.trim()}`);
        }
        return md;
    }

    private static buildDescription(debt: FileDebt): string {
        const riskFlags = debt.riskFlags && debt.riskFlags.length ? debt.riskFlags : (debt.metadata?.risk_flags ?? []);
        const risk = Array.isArray(riskFlags) && riskFlags.length ? riskFlags[0] : null;
        return risk ? `行 ${debt.line} · ${risk}` : `行 ${debt.line}`;
    }

    private static getSeverityIcon(severity: DebtSeverity): vscode.ThemeIcon {
        switch (severity) {
            case DebtSeverity.CRITICAL:
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
            case DebtSeverity.HIGH:
                return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red'));
            case DebtSeverity.MEDIUM:
                return new vscode.ThemeIcon('info', new vscode.ThemeColor('charts.orange'));
            case DebtSeverity.LOW:
                return new vscode.ThemeIcon('symbol-boolean', new vscode.ThemeColor('charts.yellow'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }
}

class EmptyTreeItem extends BaseTreeItem {
    public readonly type = 'empty';

    constructor(message: string) {
        super(message, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'empty';
        this.iconPath = new vscode.ThemeIcon('pass');
    }
}

type TreeItem = ViewSwitcherTreeItem | FileTreeItem | DebtTreeItem | WorkspaceDebtTreeItem | EmptyTreeItem;

interface WorkspaceFileGroup {
    resolvedPath: string;
    relativePath: string;
    originalPath: string;
    debts: DebtItem[];
}

export class TechnicalDebtProvider implements vscode.TreeDataProvider<TreeItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private viewMode: ViewMode = ViewMode.FILE;
    private workspaceDebtsCache = new Map<string, WorkspaceFileGroup>();

    constructor(private readonly fileIndex: FileDebtIndex, private readonly debtService: DebtService) {}

    setViewMode(mode: ViewMode) {
        if (this.viewMode !== mode) {
            this.viewMode = mode;
            if (mode === ViewMode.FILE) {
                this.workspaceDebtsCache.clear();
            }
            this.refresh();
        }
    }

    getViewMode(): ViewMode {
        return this.viewMode;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeItem): Promise<TreeItem[]> {
        if (!element) {
            return this.viewMode === ViewMode.FILE ? this.getFileRootItems() : this.getWorkspaceRootItems();
        }

        if (element instanceof ViewSwitcherTreeItem) {
            return [];
        }

        if (element instanceof FileTreeItem) {
            return this.getDebtItems(element.filePath);
        }

        return [];
    }

    private async getFileRootItems(): Promise<TreeItem[]> {
        const docsMap = new Map<string, vscode.TextDocument>();
        const active = vscode.window.activeTextEditor?.document;
        if (active && active.uri.scheme === 'file') {
            docsMap.set(active.uri.toString(), active);
        }
        for (const editor of vscode.window.visibleTextEditors) {
            const doc = editor.document;
            if (doc.uri.scheme === 'file') {
                docsMap.set(doc.uri.toString(), doc);
            }
        }

        const items: TreeItem[] = [];
        items.push(new ViewSwitcherTreeItem(ViewMode.WORKSPACE));

        if (!docsMap.size) {
            items.push(new EmptyTreeItem('当前没有打开的文件'));
            return items;
        }

        const fileItems: FileTreeItem[] = [];
        for (const doc of docsMap.values()) {
            const debts = await this.fileIndex.scanFile(doc, false);
            const worst = this.pickWorstSeverity(debts);
            const counts = this.countBySeverity(debts);
            const summary = this.buildRiskSummaryFromFileDebts(debts);
            fileItems.push(new FileTreeItem(doc.uri.fsPath, debts.length, worst, counts, { summary }));
        }
        fileItems.sort((a, b) => String(a.label ?? '').localeCompare(String(b.label ?? '')));

        const hasDebts = fileItems.some(item => item.debtCount > 0);
        items.push(...fileItems);
        if (!hasDebts) {
            items.push(new EmptyTreeItem('打开的文件暂无技术债务，可先执行扫描命令'));
        }

        return items;
    }

    private async getWorkspaceRootItems(): Promise<TreeItem[]> {
        const items: TreeItem[] = [];
        items.push(new ViewSwitcherTreeItem(ViewMode.FILE));

        const projectDebts = await this.getWorkspaceDebts();
        if (!projectDebts.length) {
            items.push(new EmptyTreeItem('项目暂无技术债务，可先执行扫描命令'));
            return items;
        }

        const grouped = new Map<string, WorkspaceFileGroup>();
        for (const debt of projectDebts) {
            const resolution = this.resolveWorkspacePath(debt.filePath);
            const key = resolution.absolutePath;
            const group = grouped.get(key) ?? {
                resolvedPath: key,
                relativePath: resolution.relativePath,
                originalPath: resolution.originalPath,
                debts: [] as DebtItem[]
            };
            group.debts.push(debt);
            grouped.set(key, group);
        }

        const groups = Array.from(grouped.values());
        const severityOrder: DebtSeverity[] = [DebtSeverity.CRITICAL, DebtSeverity.HIGH, DebtSeverity.MEDIUM, DebtSeverity.LOW];
        groups.sort((a, b) => {
            const aSeverity = this.pickWorstSeverityFromDebts(a.debts) ?? DebtSeverity.LOW;
            const bSeverity = this.pickWorstSeverityFromDebts(b.debts) ?? DebtSeverity.LOW;
            const severityDiff = severityOrder.indexOf(aSeverity) - severityOrder.indexOf(bSeverity);
            if (severityDiff !== 0) {
                return severityDiff;
            }
            return (a.relativePath || a.resolvedPath).localeCompare(b.relativePath || b.resolvedPath);
        });

        this.workspaceDebtsCache = new Map(groups.map(group => [group.resolvedPath, group]));

        for (const group of groups) {
            const severity = this.pickWorstSeverityFromDebts(group.debts);
            const fileCounts = this.countBySeverityFromDebts(group.debts);
            const fileItem = new FileTreeItem(
                group.resolvedPath,
                group.debts.length,
                severity,
                fileCounts,
                {
                    initialState: vscode.TreeItemCollapsibleState.Collapsed,
                    displayPath: group.relativePath !== group.resolvedPath ? group.relativePath : undefined
                }
            );
            items.push(fileItem);
        }

        if (!items.some(item => item instanceof FileTreeItem)) {
            items.push(new EmptyTreeItem('项目暂无技术债务，可先执行扫描命令'));
        }

        return items;
    }

    private async getWorkspaceDebts(): Promise<DebtItem[]> {
        const projectId = await this.fileIndex.ensureProject();
        if (!projectId) {
            return [];
        }
        try {
            return await this.debtService.getProjectDebts(projectId);
        } catch (error: any) {
            void vscode.window.showErrorMessage('无法获取项目技术债务: ' + (error?.message || error));
            return [];
        }
    }

    private async getDebtItems(filePath: string): Promise<TreeItem[]> {
        if (this.viewMode === ViewMode.WORKSPACE) {
            const group = this.workspaceDebtsCache.get(filePath);
            if (!group || !group.debts.length) {
                return [new EmptyTreeItem('该文件暂无技术债务')];
            }
            return group.debts.map(d => new WorkspaceDebtTreeItem(d, group.resolvedPath, group.relativePath, group.originalPath));
        }

        const debts = this.fileIndex.getCachedDebtsByPath(filePath);
        if (!debts.length) {
            return [new EmptyTreeItem('该文件暂无技术债务')];
        }
        const order: Record<DebtSeverity, number> = {
            [DebtSeverity.CRITICAL]: 0,
            [DebtSeverity.HIGH]: 1,
            [DebtSeverity.MEDIUM]: 2,
            [DebtSeverity.LOW]: 3
        } as const;
        const sorted = debts.slice().sort((a, b) => {
            const severityDiff = (order[a.severity] ?? 99) - (order[b.severity] ?? 99);
            if (severityDiff !== 0) {
                return severityDiff;
            }
            return a.line - b.line;
        });
        return sorted.map(debt => new DebtTreeItem(debt));
    }

    private pickWorstSeverity(debts: FileDebt[]): DebtSeverity | undefined {
        const priority: DebtSeverity[] = [DebtSeverity.CRITICAL, DebtSeverity.HIGH, DebtSeverity.MEDIUM, DebtSeverity.LOW];
        for (const level of priority) {
            if (debts.some(d => d.severity === level)) {
                return level;
            }
        }
        return undefined;
    }

    private countBySeverity(debts: FileDebt[]): Record<DebtSeverity, number> {
        const counts: Record<DebtSeverity, number> = {
            [DebtSeverity.CRITICAL]: 0,
            [DebtSeverity.HIGH]: 0,
            [DebtSeverity.MEDIUM]: 0,
            [DebtSeverity.LOW]: 0
        };
        for (const debt of debts) {
            counts[debt.severity] = (counts[debt.severity] ?? 0) + 1;
        }
        return counts;
    }

    private pickWorstSeverityFromDebts(debts: DebtItem[]): DebtSeverity | undefined {
        const priority: DebtSeverity[] = [DebtSeverity.CRITICAL, DebtSeverity.HIGH, DebtSeverity.MEDIUM, DebtSeverity.LOW];
        for (const level of priority) {
            if (debts.some(d => d.severity === level)) {
                return level;
            }
        }
        return undefined;
    }

    private countBySeverityFromDebts(debts: DebtItem[]): Record<DebtSeverity, number> {
        const counts: Record<DebtSeverity, number> = {
            [DebtSeverity.CRITICAL]: 0,
            [DebtSeverity.HIGH]: 0,
            [DebtSeverity.MEDIUM]: 0,
            [DebtSeverity.LOW]: 0
        };
        for (const debt of debts) {
            counts[debt.severity] = (counts[debt.severity] ?? 0) + 1;
        }
        return counts;
    }

    private resolveWorkspacePath(rawPath: string): { absolutePath: string; relativePath: string; originalPath: string } {
        const originalPath = rawPath || '';
        const normalizedRaw = originalPath.replace(/\\/g, '/');
        const workspace = vscode.workspace.workspaceFolders?.[0];

        let absolutePath = normalizedRaw;
        if (!originalPath) {
            absolutePath = workspace?.uri.fsPath ?? '';
        } else if (path.isAbsolute(originalPath) || path.isAbsolute(normalizedRaw)) {
            absolutePath = path.normalize(originalPath || normalizedRaw);
        } else if (/^[a-zA-Z]:\//.test(normalizedRaw)) {
            absolutePath = path.normalize(normalizedRaw);
        } else if (/^\\\\/.test(originalPath) || /^\/\//.test(normalizedRaw)) {
            absolutePath = path.normalize(originalPath || normalizedRaw);
        } else if (workspace) {
            const trimmed = normalizedRaw.replace(/^\.\/+/, '').replace(/^\/+/g, '');
            absolutePath = path.normalize(path.join(workspace.uri.fsPath, trimmed));
        } else {
            absolutePath = path.resolve(normalizedRaw);
        }

        let relativePath = absolutePath;
        if (workspace) {
            const relativeCandidate = path.relative(workspace.uri.fsPath, absolutePath);
            if (relativeCandidate && !relativeCandidate.startsWith('..') && !path.isAbsolute(relativeCandidate)) {
                relativePath = relativeCandidate.replace(/\\/g, '/');
            } else {
                relativePath = absolutePath;
            }
        }

        return {
            absolutePath,
            relativePath,
            originalPath: originalPath || absolutePath
        };
    }

    private buildRiskSummary(debts: DebtItem[]): string | undefined {
        const flagCounter = new Map<string, number>();
        for (const debt of debts) {
            const flags = WorkspaceDebtTreeItem.getRiskFlags(debt);
            for (const flag of flags) {
                flagCounter.set(flag, (flagCounter.get(flag) ?? 0) + 1);
            }
        }
        if (!flagCounter.size) {
            return undefined;
        }
        const sorted = Array.from(flagCounter.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        const top = sorted.slice(0, 2).map(([flag, count]) => `${flag}×${count}`);
        return top.join(' · ');
    }

    private buildRiskSummaryFromFileDebts(debts: FileDebt[]): string | undefined {
        const flagCounter = new Map<string, number>();
        for (const debt of debts) {
            const flags = debt.riskFlags && debt.riskFlags.length ? debt.riskFlags : (debt.metadata?.risk_flags ?? []);
            if (!Array.isArray(flags)) {
                continue;
            }
            for (const flag of flags) {
                if (!flag) {
                    continue;
                }
                flagCounter.set(flag, (flagCounter.get(flag) ?? 0) + 1);
            }
        }
        if (!flagCounter.size) {
            return undefined;
        }
        const sorted = Array.from(flagCounter.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        const top = sorted.slice(0, 2).map(([flag, count]) => `${flag}×${count}`);
        return top.join(' · ');
    }
}