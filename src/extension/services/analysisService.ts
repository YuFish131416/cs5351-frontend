import * as vscode from 'vscode';
import { ApiClient } from '../utils/apiClient';
import { ConfigManager } from '../utils/configManager';
import { AnalysisResult, DebtItem } from '../../types';
import { Logger } from '../utils/logger';

export class AnalysisService {
    private apiClient: ApiClient;
    private configManager: ConfigManager;
    private logger: Logger;
    // map of projectId -> analysisId
    private currentAnalysis: Map<string, string> = new Map();
    private clientId: string;
    private context?: vscode.ExtensionContext;

    constructor(context?: vscode.ExtensionContext) {
        this.apiClient = new ApiClient();
        this.configManager = ConfigManager.getInstance();
        this.logger = Logger.getInstance();
        this.context = context;

        // client id persisted in global state so locks and idempotency work across sessions
        try {
            const stored = context?.globalState.get<string>('tdm.clientId');
            if (stored) {
                this.clientId = stored;
            } else {
                this.clientId = this.generateClientId();
                context?.globalState.update('tdm.clientId', this.clientId);
            }
        } catch (e) {
            // fallback
            this.clientId = this.generateClientId();
        }
    }

    private generateClientId(): string {
        // simple UUID v4-ish generator
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    async analyzeWorkspace(): Promise<AnalysisResult | null> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('请先打开一个工作区');
            return null;
        }

        return this.analyzeProject(workspaceFolder.uri.fsPath);
    }

    async analyzeProject(projectPath: string): Promise<AnalysisResult | null> {
        try {
            this.logger.info(`开始分析项目: ${projectPath}`);
            // 检查项目是否已存在（尝试专用 by-path 接口，失败则回退到列出所有项目）
            let project = await this.apiClient.getProjectByPath(projectPath);

            if (!project) {
                // 创建新项目，使用幂等 Key（基于 projectPath），以避免重复创建
                const idempotencyKey = `tdm:${Buffer.from(projectPath).toString('base64')}`;
                project = await this.apiClient.createProjectIdempotent({
                    name: this.getProjectName(projectPath),
                    localPath: projectPath,
                    language: await this.detectProjectLanguage(projectPath)
                }, idempotencyKey);
                this.logger.info(`创建或获取项目: ${project.name}`);
            }

            // 注意: 后端已改为在触发分析时自动加锁并在处理完成后自动解锁。
            // 前端不再显式请求锁，直接继续触发分析。

            // 检查是否已有正在运行的分析，避免重复触发
            try {
                const current = await this.apiClient.getProjectCurrent(project.id);
                if (current && current.current_analysis_id && ['running','analyzing','started'].includes((current.status || '').toString())) {
                    this.logger.info(`项目已有正在运行的分析: ${current.current_analysis_id}`);
                    vscode.window.showInformationMessage('项目已有正在运行的分析，已取消重复触发');
                    return null;
                }
            } catch (e) {
                // 如果获取 current 失败，继续尝试触发分析（谨慎）
                this.logger.warn('获取项目当前分析信息失败，继续触发分析');
            }

            // 触发分析 — 使用项目 ID（后端路径为 /projects/{project_id}/analysis）
            const analysisResult = await this.apiClient.triggerAnalysis(project.id);
            const analysisId = (analysisResult as any).analysis_id || (analysisResult as any).task_id || (analysisResult as any).id || (analysisResult as any).taskId;
            if (analysisId) {
                this.currentAnalysis.set(project.id, analysisId);
                // 启动进度监控（传入 project.id 以便查询状态时使用正确路径）
                this.monitorAnalysisProgress(analysisId, project.id).catch(() => {});
            }

            return analysisResult;
        } catch (error) {
            this.logger.error(`分析项目失败: ${error.message}`);
            vscode.window.showErrorMessage(`分析失败: ${error.message}`);
            return null;
        }
    }

    async analyzeFile(filePath: string): Promise<DebtItem[] | null> {
        const config = this.configManager.getConfig();

        // 检查文件是否在排除模式中
        if (this.isFileExcluded(filePath, config.analysis.excludedPatterns)) {
            return null;
        }

        // 检查文件大小
        if (await this.isFileTooLarge(filePath, config.analysis.maxFileSize)) {
            this.logger.warn(`文件过大，跳过分析: ${filePath}`);
            return null;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return null;
        }

        try {
            const relativePath = vscode.workspace.asRelativePath(filePath);

            // 先获取对应的 project（根据 workspace path）以取得 project.id
            // 获取或创建 project
            let project = await this.apiClient.getProjectByPath(workspaceFolder.uri.fsPath);
            if (!project) {
                const idempotencyKey = `tdm:${Buffer.from(workspaceFolder.uri.fsPath).toString('base64')}`;
                project = await this.apiClient.createProjectIdempotent({
                    name: this.getProjectName(workspaceFolder.uri.fsPath),
                    localPath: workspaceFolder.uri.fsPath,
                    language: await this.detectProjectLanguage(workspaceFolder.uri.fsPath)
                }, idempotencyKey);
            }

            // 注意: 后端会在处理期间自动加锁，前端不再向后端发起显式加锁请求。

            const analysisResult = await this.apiClient.triggerAnalysis(project.id, relativePath);

            // 等待分析完成并获取债务数据
            const analysisId = (analysisResult as any).analysis_id || (analysisResult as any).task_id || (analysisResult as any).id || (analysisResult as any).taskId;
            const debts = await this.waitForFileAnalysis(analysisId, relativePath, project.id);

            // 后端将自动在处理完成时解锁；前端无需显式解锁。

            return debts;
        } catch (error) {
            this.logger.error(`分析文件失败: ${error.message}`);
            return null;
        }
    }

    private async monitorAnalysisProgress(analysisId: string, projectId: string): Promise<void> {
        const progressOptions = {
            location: vscode.ProgressLocation.Notification,
            title: "分析技术债务",
            cancellable: true
        };

        await vscode.window.withProgress(progressOptions, async (progress, token) => {
            token.onCancellationRequested(() => {
                this.logger.info('用户取消了分析');
            });

            let isCompleted = false;
            let retryCount = 0;
            const maxRetries = 30; // 5分钟超时

            while (!isCompleted && retryCount < maxRetries && !token.isCancellationRequested) {
                try {
                    const status = await this.apiClient.getAnalysisStatus(projectId, analysisId);

                    // 如果后端直接返回 4xx 错误（例如 400 表示无效的 analysisId），将其视为终止条件，避免无限轮询
                    // 注意：axios 在响应拦截器中会将非 2xx 的响应抛出为异常，因此大多数 4xx 会进入 catch 分支下面。
                    switch (status.status) {
                        case 'completed':
                            isCompleted = true;
                            progress.report({ increment: 100, message: '分析完成' });
                            vscode.window.showInformationMessage('技术债务分析完成');
                            break;
                        case 'failed':
                            isCompleted = true;
                            progress.report({ increment: 100, message: '分析失败' });
                            vscode.window.showErrorMessage('技术债务分析失败');
                            break;
                        case 'running':
                            progress.report({
                                increment: 10,
                                message: '分析中...'
                            });
                            break;
                    }

                    if (!isCompleted) {
                        await new Promise(resolve => setTimeout(resolve, 5000)); // 5秒轮询
                        retryCount++;
                    }
                } catch (error) {
                    // 如果是 HTTP 错误并且状态码位于 400-499，通常表示请求不正确或资源不存在，停止轮询并告知用户
                    const statusCode = error?.response?.status;
                    if (statusCode && statusCode >= 400 && statusCode < 500) {
                        this.logger.error(`检查分析状态失败（客户端错误 ${statusCode}），停止轮询: ${error.message}`);
                        vscode.window.showErrorMessage(`无法获取分析状态（${statusCode}）: ${error?.response?.data?.detail || error.message}`);
                        break;
                    }

                    this.logger.error(`检查分析状态失败: ${error.message}`);
                    retryCount++;
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }

            if (retryCount >= maxRetries) {
                vscode.window.showWarningMessage('分析超时，请稍后查看结果');
            }

            // 删除基于 projectId 的当前分析记录
            this.currentAnalysis.delete(projectId);
            // 注意：后端现在负责在处理完成后自动解锁，前端不再尝试显式解锁。
        });
    }

    private async waitForFileAnalysis(analysisId: string, filePath: string, projectId: string): Promise<DebtItem[]> {
        let retryCount = 0;
        const maxRetries = 12; // 1分钟超时

        while (retryCount < maxRetries) {
            try {
                const status = await this.apiClient.getAnalysisStatus(projectId, analysisId);

                if (status.status === 'completed') {
                    return await this.apiClient.getFileDebts(projectId, filePath);
                } else if (status.status === 'failed') {
                    throw new Error('文件分析失败');
                }

                await new Promise(resolve => setTimeout(resolve, 5000));
                retryCount++;
            } catch (error: any) {
                this.logger.error(`等待文件分析完成失败: ${error.message}`);
                retryCount++;
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        throw new Error('文件分析超时');
    }

    private getProjectName(projectPath: string): string {
        return projectPath.split(/[\\/]/).pop() || 'Unknown Project';
    }

    private async detectProjectLanguage(projectPath: string): Promise<string> {
        if ((await vscode.workspace.findFiles('package.json')).length > 0) {
            return 'javascript';
        } else if ((await vscode.workspace.findFiles('requirements.txt')).length > 0) {
            return 'python';
        } else if ((await vscode.workspace.findFiles('pom.xml')).length > 0) {
            return 'java';
        } else {
            return 'unknown';
        }
    }

    private isFileExcluded(filePath: string, excludedPatterns: string[]): boolean {
        return excludedPatterns.some(pattern => {
            const minimatch = require('minimatch');
            return minimatch(filePath, pattern);
        });
    }

    private async isFileTooLarge(filePath: string, maxSize: number): Promise<boolean> {
        try {
            const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
            return stat.size > maxSize;
        } catch (error) {
            return false;
        }
    }

    getCurrentAnalysis(projectId: string): string | undefined {
        return this.currentAnalysis.get(projectId);
    }
}