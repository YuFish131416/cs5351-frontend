import * as vscode from 'vscode';
import { DebtService } from '../services/debtService';
import { DebtItem, Project } from '../../types';

// 基础树项类
abstract class BaseTreeItem extends vscode.TreeItem {
    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
    }
}

// 项目树项
class ProjectTreeItem extends BaseTreeItem {
    public readonly type = 'project';
    
    constructor(public readonly project: Project) {
        super(project.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.tooltip = project.description;
        this.contextValue = 'project';
        this.description = project.language;
    }
}

// 债务树项
class DebtTreeItem extends BaseTreeItem {
    public readonly type = 'debt';
    
    constructor(public readonly debt: DebtItem) {
        super(DebtTreeItem.formatDebtLabel(debt), vscode.TreeItemCollapsibleState.None);
        this.description = `预估工时: ${debt.estimatedEffort}h`;
        this.tooltip = DebtTreeItem.createTooltip(debt);
        this.contextValue = 'debt';
        
        // 设置图标
        this.iconPath = DebtTreeItem.getSeverityIcon(debt.severity);
        
        // 设置命令，点击时显示债务详情
        this.command = {
            command: 'technicalDebt.showDebtDetails',
            title: '显示债务详情',
            arguments: [debt]
        };
    }

    private static formatDebtLabel(debt: DebtItem): string {
        const fileName = debt.filePath.split(/[\\/]/).pop() || debt.filePath;
        return `${fileName} - ${debt.severity}`;
    }

    private static createTooltip(debt: DebtItem): string {
        return [
            `文件: ${debt.filePath}`,
            `类型: ${debt.debtType}`,
            `严重程度: ${debt.severity}`,
            `描述: ${debt.description}`,
            `预估修复: ${debt.estimatedEffort} 小时`,
            `状态: ${debt.status}`,
            `创建时间: ${new Date(debt.createdAt).toLocaleString()}`
        ].join('\n');
    }

    private static getSeverityIcon(severity: string): vscode.ThemeIcon {
        switch (severity) {
            case 'critical':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
            case 'high':
                return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
            case 'medium':
                return new vscode.ThemeIcon('info', new vscode.ThemeColor('list.infoForeground'));
            case 'low':
                return new vscode.ThemeIcon('symbol-event', new vscode.ThemeColor('list.highlightForeground'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }
}

// 错误树项
class ErrorTreeItem extends BaseTreeItem {
    public readonly type = 'error';
    
    constructor(message: string) {
        super(message, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('error');
        this.contextValue = 'error';
    }
}

// 树项类型联合
type TreeItem = ProjectTreeItem | DebtTreeItem | ErrorTreeItem;

export class TechnicalDebtProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(
        private context: vscode.ExtensionContext,
        private debtService: DebtService
    ) {}

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeItem): Promise<TreeItem[]> {
        if (!element) {
            // 根节点 - 显示项目列表
            return this.getProjectItems();
        }

        if (element instanceof ProjectTreeItem) {
            // 项目子节点 - 显示债务项
            return this.getDebtItems(element.project.id);
        }

        // 错误项或其他类型没有子项
        return [];
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    private async getProjectItems(): Promise<TreeItem[]> {
        try {
            const projects = await this.debtService.getProjects();
            if (projects.length === 0) {
                return [new ErrorTreeItem('没有找到项目，请先分析工作区')];
            }
            return projects.map(project => new ProjectTreeItem(project));
        } catch (error: any) {
            vscode.window.showErrorMessage(`获取项目列表失败: ${error.message}`);
            return [new ErrorTreeItem('获取项目列表失败')];
        }
    }

    private async getDebtItems(projectId: string): Promise<TreeItem[]> {
        try {
            const debts = await this.debtService.getProjectDebts(projectId);
            if (debts.length === 0) {
                return [new ErrorTreeItem('该项目暂无技术债务')];
            }
            return debts.map(debt => new DebtTreeItem(debt));
        } catch (error: any) {
            return [new ErrorTreeItem('获取债务数据失败')];
        }
    }
}