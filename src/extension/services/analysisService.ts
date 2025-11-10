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

            // 尝试为该项目加锁，避免并发重复触发
            try {
                await this.apiClient.lockProject(project.id, this.clientId, 300);
                this.logger.info(`已为项目加锁: ${project.id} (client=${this.clientId})`);
            } catch (lockErr: any) {
                // 如果锁被占用，后端应返回 409 并包含 locked_by
                const lockedBy = lockErr?.response?.data?.locked_by || lockErr?.response?.data?.owner;
                this.logger.warn(`无法为项目加锁（已被占用）: ${lockedBy}`);
                vscode.window.showInformationMessage(`项目正在被其他客户端处理（${lockedBy}），已取消本次触发`);
                return null;
            }

            // 检查是否已有正在运行的分析，避免重复触发
            try {
                const current = await this.apiClient.getProjectCurrent(project.id);
                if (current && current.current_analysis_id && ['running','analyzing','started'].includes((current.status || '').toString())) {
                    this.logger.info(`项目已有正在运行的分析: ${current.current_analysis_id}`);
                    // 释放锁（如果我们刚刚获得锁则需要解锁）
                    try { await this.apiClient.unlockProject(project.id, this.clientId); } catch(e){}
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

            // 尝试加锁
            try {
                await this.apiClient.lockProject(project.id, this.clientId, 300);
            } catch (lockErr: any) {
                const lockedBy = lockErr?.response?.data?.locked_by;
                vscode.window.showInformationMessage(`项目被其他客户端占用(${lockedBy})，跳过触发文件分析`);
                return null;
            }

            const analysisResult = await this.apiClient.triggerAnalysis(project.id, relativePath);

            // 等待分析完成并获取债务数据
            const analysisId = (analysisResult as any).analysis_id || (analysisResult as any).task_id || (analysisResult as any).id || (analysisResult as any).taskId;
            const debts = await this.waitForFileAnalysis(analysisId, relativePath, project.id);

            // 解锁（尝试）
            try { await this.apiClient.unlockProject(project.id, this.clientId); } catch (e) {}

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
                // 在分析结束后尝试释放锁（如果是本客户端持有）
                try {
                    await this.apiClient.unlockProject(projectId, this.clientId);
                    this.logger.info(`已释放项目锁: ${projectId}`);
                } catch (e) {
                    this.logger.warn(`释放项目锁失败: ${e?.message || e}`);
                }
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