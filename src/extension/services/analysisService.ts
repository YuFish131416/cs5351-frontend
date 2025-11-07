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

    constructor() {
        this.apiClient = new ApiClient();
        this.configManager = ConfigManager.getInstance();
        this.logger = Logger.getInstance();
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

            // 检查项目是否已存在
            const projects = await this.apiClient.getProjects();
            let project = projects.find(p => p.localPath === projectPath);

            if (!project) {
                // 创建新项目
                project = await this.apiClient.createProject({
                    name: this.getProjectName(projectPath),
                    localPath: projectPath,
                    language: await this.detectProjectLanguage(projectPath)
                });
                this.logger.info(`创建新项目: ${project.name}`);
            }

            // 触发分析 — 使用项目 ID（后端路径为 /projects/{project_id}/analysis）
            const analysisResult = await this.apiClient.triggerAnalysis(project.id);
            this.currentAnalysis.set(project.id, analysisResult.id);

            // 启动进度监控（传入 project.id 以便查询状态时使用正确路径）
            this.monitorAnalysisProgress(analysisResult.id, project.id);

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
            const projects = await this.apiClient.getProjects();
            const project = projects.find(p => p.localPath === workspaceFolder.uri.fsPath);
            if (!project) {
                throw new Error('找不到对应的项目，请先分析工作区以创建项目记录');
            }

            const analysisResult = await this.apiClient.triggerAnalysis(project.id, relativePath);

            // 等待分析完成并获取债务数据
            const debts = await this.waitForFileAnalysis(analysisResult.id, relativePath, project.id);
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