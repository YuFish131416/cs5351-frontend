import * as vscode from 'vscode';
import { TechnicalDebtProvider } from './providers/technicalDebtProvider';
import { DebtCodeLensProvider } from './providers/codeLensProvider';
import { DebtHoverProvider } from './providers/hoverProvider';
import { DebtDecorator } from './decorators/debtDecorator';
import { DebtAnalysisPanel } from '../webview/panels/debtAnalysisPanel';
import { DebtDetailPanel } from '../webview/panels/debtDetailPanel';
import { AnalysisService } from './services/analysisService';
import { DebtService } from './services/debtService';
import { ConfigManager } from './utils/configManager';
import { Logger } from './utils/logger';
import { ApiClient } from './utils/apiClient';
import { DebtItem, DebtStatus } from '../types';

// 全局变量
let debtDecorator: DebtDecorator;
let codeLensProvider: DebtCodeLensProvider;
let statusBarItem: vscode.StatusBarItem;
let debtProvider: TechnicalDebtProvider;

export async function activate(context: vscode.ExtensionContext) {
    const logger = Logger.getInstance();
    logger.info('Technical Debt Manager 插件已激活');

    try {
        // 初始化服务
        const apiClient = new ApiClient();
    const analysisService = new AnalysisService(context);
        const debtService = new DebtService();
        const configManager = ConfigManager.getInstance();

        // 健康检查
        await performHealthCheck(apiClient);

        // 创建状态栏项
        statusBarItem = createStatusBarItem();
        context.subscriptions.push(statusBarItem);

        // 初始化提供者
        debtProvider = new TechnicalDebtProvider(context, debtService);
        codeLensProvider = new DebtCodeLensProvider();
        const hoverProvider = new DebtHoverProvider();
        debtDecorator = new DebtDecorator();

        // 注册树视图
        const debtTreeView = vscode.window.createTreeView('technicalDebtView', {
            treeDataProvider: debtProvider
        });
        context.subscriptions.push(debtTreeView);

        // 注册命令 - 确保所有命令都在这里注册
        const commands = registerCommands(context, analysisService, debtService, debtProvider);
        context.subscriptions.push(...commands);

        // 注册提供者
        const providers = registerProviders(context, codeLensProvider, hoverProvider);
        context.subscriptions.push(...providers);

        // 注册事件监听器
        const eventListeners = registerEventListeners(context, debtDecorator, debtProvider, codeLensProvider, debtService);
        context.subscriptions.push(...eventListeners);

        // 配置变化监听
        const configChangeListener = configManager.onConfigChange(() => {
            logger.info('配置已更新，重新加载装饰器');
            debtDecorator.updateDecorationsForActiveEditor();
            codeLensProvider.refresh();
            updateStatusBar(statusBarItem, debtService);
        });
        context.subscriptions.push(configChangeListener);

        // 初始更新
        await updateStatusBar(statusBarItem, debtService);
        debtDecorator.updateDecorationsForActiveEditor();

        logger.info('Technical Debt Manager 插件初始化完成');

    } catch (error: any) {
        Logger.getInstance().error('插件初始化失败:', error);
        vscode.window.showErrorMessage('技术债务管理器初始化失败: ' + error.message);
    }
}

export function deactivate() {
    Logger.getInstance().info('Technical Debt Manager 插件已停用');
    debtDecorator?.dispose();
    statusBarItem?.dispose();
}

// 辅助函数
async function performHealthCheck(apiClient: ApiClient): Promise<void> {
    try {
        const isHealthy = await apiClient.healthCheck();
        if (!isHealthy) {
            vscode.window.showWarningMessage(
                '技术债务服务未连接，部分功能可能不可用',
                '检查连接'
            ).then(selection => {
                if (selection === '检查连接') {
                    vscode.commands.executeCommand('technicalDebt.showSettings');
                }
            });
        }
    } catch (error: any) {
        Logger.getInstance().warn('健康检查失败:', error.message);
    }
}

function createStatusBarItem(): vscode.StatusBarItem {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    item.text = '$(warning) 技术债务';
    item.tooltip = '查看技术债务分析';
    item.command = 'technicalDebt.showDashboard';
    item.show();
    return item;
}

function registerCommands(
    context: vscode.ExtensionContext,
    analysisService: AnalysisService,
    debtService: DebtService,
    debtProvider: TechnicalDebtProvider
): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // 分析命令
    disposables.push(
        vscode.commands.registerCommand('technicalDebt.analyzeWorkspace', async () => {
            try {
                await analysisService.analyzeWorkspace();
                debtProvider.refresh();
                codeLensProvider.refresh();
                debtDecorator.updateDecorationsForActiveEditor();
                updateStatusBar(statusBarItem, debtService);
            } catch (error: any) {
                vscode.window.showErrorMessage('分析工作区失败: ' + error.message);
            }
        })
    );

    disposables.push(
        vscode.commands.registerCommand('technicalDebt.analyzeFile', async (uri: vscode.Uri) => {
            try {
                const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.fileName;
                if (filePath) {
                    await analysisService.analyzeFile(filePath);
                    debtProvider.refresh();
                    codeLensProvider.refresh();
                    debtDecorator.updateDecorationsForActiveEditor();
                    updateStatusBar(statusBarItem, debtService);
                }
            } catch (error: any) {
                vscode.window.showErrorMessage('分析文件失败: ' + error.message);
            }
        })
    );

    // 项目管理命令
    disposables.push(
        vscode.commands.registerCommand('technicalDebt.showProjects', async () => {
            try {
                const projects = await debtService.getProjects();
                if (projects.length === 0) {
                    vscode.window.showInformationMessage('当前没有项目，请先分析工作区');
                    return;
                }

                const projectItems = projects.map(project => ({
                    label: project.name,
                    description: project.localPath,
                    project
                }));

                const selected = await vscode.window.showQuickPick(projectItems, {
                    placeHolder: '选择要查看的项目'
                });

                if (selected) {
                    // 可以在这里打开项目详情或执行其他操作
                    vscode.window.showInformationMessage(`已选择项目: ${selected.project.name}`);
                }
            } catch (error: any) {
                vscode.window.showErrorMessage('获取项目列表失败: ' + error.message);
            }
        })
    );

    // 面板命令
        disposables.push(
        vscode.commands.registerCommand('technicalDebt.showDashboard', () => {
            DebtAnalysisPanel.createOrShow(context.extensionUri, debtService, analysisService);
        })
    );

        disposables.push(
            vscode.commands.registerCommand('technicalDebt.showDebtDetails', (debtOrList: DebtItem | DebtItem[] | undefined) => {
                // 支持传入单个 DebtItem 或数组（例如当调用来源不确定时）
                if (!debtOrList) {
                    vscode.window.showErrorMessage('无效的债务项');
                    return;
                }

                let debt: DebtItem | undefined;
                if (Array.isArray(debtOrList)) {
                    if (debtOrList.length === 0) {
                        vscode.window.showErrorMessage('无效的债务项');
                        return;
                    }
                    // 如果传入数组，则提示用户选择要查看的债务，或者默认使用第一项
                    debt = debtOrList[0];
                } else {
                    debt = debtOrList;
                }

                DebtDetailPanel.createOrShow(context.extensionUri, debt, debtService);
            })
        );

    // 设置命令
    disposables.push(
        vscode.commands.registerCommand('technicalDebt.showSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'technicalDebt');
        })
    );

    // 刷新命令
    disposables.push(
        vscode.commands.registerCommand('technicalDebt.refresh', async () => {
            try {
                debtProvider.refresh();
                codeLensProvider.refresh();
                debtDecorator.updateDecorationsForActiveEditor();
                await updateStatusBar(statusBarItem, debtService);
                vscode.window.showInformationMessage('技术债务数据已刷新');
            } catch (error: any) {
                vscode.window.showErrorMessage('刷新失败: ' + error.message);
            }
        })
    );

    // 债务状态管理命令
        disposables.push(
            vscode.commands.registerCommand('technicalDebt.markAsInProgress', async (debtOrList: DebtItem | DebtItem[] | undefined) => {
                try {
                    const debt = Array.isArray(debtOrList) ? debtOrList[0] : debtOrList;
                    if (!debt || !debt.id) {
                        vscode.window.showErrorMessage('无效的债务项，无法更新状态');
                        return;
                    }

                    await debtService.updateDebtStatus(debt.id, DebtStatus.IN_PROGRESS);
                    vscode.window.showInformationMessage('债务状态已更新为"处理中"');
                    debtProvider.refresh();
                    codeLensProvider.refresh();
                    debtDecorator.updateDecorationsForActiveEditor();
                } catch (error: any) {
                    vscode.window.showErrorMessage('更新债务状态失败: ' + error.message);
                }
            })
        );

        disposables.push(
            vscode.commands.registerCommand('technicalDebt.markAsResolved', async (debtOrList: DebtItem | DebtItem[] | undefined) => {
                try {
                    const debt = Array.isArray(debtOrList) ? debtOrList[0] : debtOrList;
                    if (!debt || !debt.id) {
                        vscode.window.showErrorMessage('无效的债务项，无法更新状态');
                        return;
                    }

                    await debtService.updateDebtStatus(debt.id, DebtStatus.RESOLVED);
                    vscode.window.showInformationMessage('债务状态已更新为"已解决"');
                    debtProvider.refresh();
                    codeLensProvider.refresh();
                    debtDecorator.updateDecorationsForActiveEditor();
                } catch (error: any) {
                    vscode.window.showErrorMessage('更新债务状态失败: ' + error.message);
                }
            })
        );

        disposables.push(
            vscode.commands.registerCommand('technicalDebt.ignoreDebt', async (debtOrList: DebtItem | DebtItem[] | undefined) => {
                try {
                    const debt = Array.isArray(debtOrList) ? debtOrList[0] : debtOrList;
                    if (!debt || !debt.id) {
                        vscode.window.showErrorMessage('无效的债务项，无法更新状态');
                        return;
                    }

                    await debtService.updateDebtStatus(debt.id, DebtStatus.WONT_FIX);
                    vscode.window.showInformationMessage('债务状态已更新为"忽略"');
                    debtProvider.refresh();
                    codeLensProvider.refresh();
                    debtDecorator.updateDecorationsForActiveEditor();
                } catch (error: any) {
                    vscode.window.showErrorMessage('更新债务状态失败: ' + error.message);
                }
            })
        );

    // 添加债务命令
    disposables.push(
        vscode.commands.registerCommand('technicalDebt.addDebt', async (uri: vscode.Uri) => {
            try {
                const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.fileName;
                if (!filePath) {
                    vscode.window.showErrorMessage('请先打开一个文件');
                    return;
                }

                const description = await vscode.window.showInputBox({
                    prompt: '请输入债务描述',
                    placeHolder: '描述这个技术债务...'
                });

                if (!description) {
                    return;
                }

                const severityItems = [
                    { label: '低', value: 'low' },
                    { label: '中', value: 'medium' },
                    { label: '高', value: 'high' },
                    { label: '严重', value: 'critical' }
                ];

                const severity = await vscode.window.showQuickPick(severityItems, {
                    placeHolder: '选择债务严重程度'
                });

                if (!severity) {
                    return;
                }

                // 获取当前光标位置
                const editor = vscode.window.activeTextEditor;
                const lineNumber = editor ? editor.selection.active.line + 1 : 1;

                await debtService.addDebt({
                    filePath,
                    lineNumber,
                    description,
                    severity: severity.value as any,
                    category: 'manual',
                    debtType: 'code_smell'
                });

                vscode.window.showInformationMessage('技术债务已添加');
                debtProvider.refresh();
                codeLensProvider.refresh();
                debtDecorator.updateDecorationsForActiveEditor();
            } catch (error: any) {
                vscode.window.showErrorMessage('添加债务失败: ' + error.message);
            }
        })
    );

    return disposables;
}

function registerProviders(
    context: vscode.ExtensionContext,
    codeLensProvider: DebtCodeLensProvider,
    hoverProvider: DebtHoverProvider
): vscode.Disposable[] {
    return [
        // 注册 CodeLens 提供者
        vscode.languages.registerCodeLensProvider(
            [
                { scheme: 'file', language: 'python' },
                { scheme: 'file', language: 'javascript' },
                { scheme: 'file', language: 'typescript' },
                { scheme: 'file', language: 'java' },
                { scheme: 'file', language: 'cpp' },
                { scheme: 'file', language: 'c' },
                { scheme: 'file', language: 'csharp' },
                { scheme: 'file', language: 'go' },
                { scheme: 'file', language: 'rust' }
            ],
            codeLensProvider
        ),

        // 注册 Hover 提供者
        vscode.languages.registerHoverProvider(
            [
                { scheme: 'file', language: 'python' },
                { scheme: 'file', language: 'javascript' },
                { scheme: 'file', language: 'typescript' },
                { scheme: 'file', language: 'java' },
                { scheme: 'file', language: 'cpp' },
                { scheme: 'file', language: 'c' },
                { scheme: 'file', language: 'csharp' },
                { scheme: 'file', language: 'go' },
                { scheme: 'file', language: 'rust' }
            ],
            hoverProvider
        ),

        // 注册文档符号提供者（用于在文件大纲中显示债务）
        vscode.languages.registerDocumentSymbolProvider(
            [
                { scheme: 'file', language: 'python' },
                { scheme: 'file', language: 'javascript' },
                { scheme: 'file', language: 'typescript' },
                { scheme: 'file', language: 'java' }
            ],
            {
                provideDocumentSymbols: async (document: vscode.TextDocument) => {
                    try {
                        const debtService = new DebtService();
                        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

                        if (!workspaceFolder) {
                            return [];
                        }

                        const project = await debtService.getProjectByPath(workspaceFolder.uri.fsPath);
                        if (!project) {
                            return [];
                        }

                        const debts = await debtService.getFileDebts(project.id, document.fileName);

                        return debts.map(debt => new vscode.SymbolInformation(
                            `[${debt.severity}] ${debt.description}`,
                            vscode.SymbolKind.String,
                            '',
                            new vscode.Location(
                                document.uri,
                                new vscode.Range(
                                    new vscode.Position((debt.metadata?.location?.line || 1) - 1, 0),
                                    new vscode.Position((debt.metadata?.location?.line || 1) - 1, 0)
                                )
                            )
                        ));
                    } catch (error) {
                        return [];
                    }
                }
            }
        )
    ];
}

function registerEventListeners(
    context: vscode.ExtensionContext,
    debtDecorator: DebtDecorator,
    debtProvider: TechnicalDebtProvider,
    codeLensProvider: DebtCodeLensProvider,
    debtService: DebtService
): vscode.Disposable[] {
    return [
        // 文档保存事件
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            const config = ConfigManager.getInstance().getConfig();
            if (config.analysis.autoAnalyzeOnSave) {
                try {
                    const analysisService = new AnalysisService(context);
                    await analysisService.analyzeFile(document.fileName);

                    // 刷新 UI
                    debtProvider.refresh();
                    codeLensProvider.refresh();

                    // 找到对应的编辑器并更新装饰器
                    const editors = vscode.window.visibleTextEditors.filter(
                        editor => editor.document.uri.toString() === document.uri.toString()
                    );

                    editors.forEach(editor => {
                        debtDecorator.updateDecorationsForEditor(editor);
                    });

                    await updateStatusBar(statusBarItem, debtService);
                } catch (error: any) {
                    Logger.getInstance().error('自动分析失败:', error);
                }
            }
        }),

        // 激活编辑器变化事件
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                debtDecorator.updateDecorationsForEditor(editor);
            }
        }),

        // 文档变化事件
        vscode.workspace.onDidChangeTextDocument((event) => {
            // 文档内容变化时刷新 CodeLens
            if (event.contentChanges.length > 0) {
                codeLensProvider.refresh();
            }
        }),

        // 配置文件变化事件
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('technicalDebt')) {
                debtProvider.refresh();
                codeLensProvider.refresh();
                debtDecorator.updateDecorationsForActiveEditor();
                updateStatusBar(statusBarItem, debtService);
            }
        }),

        // 工作区文件夹变化事件
        vscode.workspace.onDidChangeWorkspaceFolders((event) => {
            debtProvider.refresh();
            updateStatusBar(statusBarItem, debtService);
        }),

        // 文档关闭事件
        vscode.workspace.onDidCloseTextDocument((document) => {
            // 清理已关闭文档的装饰器
            const editor = vscode.window.visibleTextEditors.find(e => e.document === document);
            if (editor) {
                debtDecorator.clearDecorationsForEditor(editor);
            }
        })
    ];
}

async function updateStatusBar(statusBarItem: vscode.StatusBarItem, debtService: DebtService): Promise<void> {
    try {
        const config = ConfigManager.getInstance().getConfig();
        if (!config.ui.showStatusBar) {
            statusBarItem.hide();
            return;
        }

        statusBarItem.show();

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            statusBarItem.text = '$(warning) 技术债务';
            statusBarItem.tooltip = '技术债务分析 (无工作区)';
            statusBarItem.backgroundColor = undefined;
            return;
        }

        const projects = await debtService.getProjects();
        const project = projects.find(p => p.localPath === workspaceFolder.uri.fsPath);

        if (project) {
            const summary = await debtService.getDebtSummary(project.id);
            const criticalCount = summary.bySeverity.critical || 0;
            const highCount = summary.bySeverity.high || 0;

            if (criticalCount > 0) {
                statusBarItem.text = `$(error) ${criticalCount} 关键`;
                statusBarItem.tooltip = `技术债务摘要: ${summary.totalDebts} 个债务 (${criticalCount} 关键, ${highCount} 高)`;
                statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            } else if (highCount > 0) {
                statusBarItem.text = `$(warning) ${highCount} 高`;
                statusBarItem.tooltip = `技术债务摘要: ${summary.totalDebts} 个债务 (${highCount} 高)`;
                statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            } else {
                statusBarItem.text = `$(check) ${summary.totalDebts} 债务`;
                statusBarItem.tooltip = `技术债务摘要: ${summary.totalDebts} 个债务`;
                statusBarItem.backgroundColor = undefined;
            }
        } else {
            statusBarItem.text = '$(warning) 技术债务';
            statusBarItem.tooltip = '点击分析技术债务';
            statusBarItem.backgroundColor = undefined;
        }
    } catch (error: any) {
        statusBarItem.text = '$(warning) 技术债务';
        statusBarItem.tooltip = '技术债务分析 (加载失败)';
        statusBarItem.backgroundColor = undefined;
        Logger.getInstance().warn('状态栏更新失败:', error.message);
    }
}