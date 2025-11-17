import { Buffer } from 'buffer';
import minimatch from 'minimatch';
import * as vscode from 'vscode';
import { AnalysisResult, DebtItem, Project } from '../../types';
import { ApiClient } from '../utils/apiClient';
import { ConfigManager } from '../utils/configManager';
import { Logger } from '../utils/logger';

interface EnsureProjectResult {
    project: Project;
    created: boolean;
}

export class AnalysisService {
    private readonly apiClient: ApiClient;
    private readonly configManager: ConfigManager;
    private readonly logger: Logger;
    private readonly currentAnalysis: Map<string, string> = new Map();
    private readonly clientId: string;
    private readonly context?: vscode.ExtensionContext;

    constructor(context?: vscode.ExtensionContext) {
        this.apiClient = new ApiClient();
        this.configManager = ConfigManager.getInstance();
        this.logger = Logger.getInstance();
        this.context = context;
        this.clientId = this.restoreClientId();
    }

    async analyzeWorkspace(): Promise<AnalysisResult | null> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('请先打开一个工作区，再运行项目分析。');
            return null;
        }

        return this.analyzeProject(workspaceFolder.uri.fsPath);
    }

    async analyzeProject(projectPath: string): Promise<AnalysisResult | null> {
        try {
            this.logger.info(`开始分析项目: ${projectPath}`);
            const ensureResult = await this.ensureProject(projectPath);

            const current = await this.safeGetProjectCurrent(ensureResult.project.id);
            if (this.isAnalysisRunning(current)) {
                vscode.window.showInformationMessage('项目已经有正在运行的分析任务，已取消重复触发。');
                return null;
            }

            const analysisResult = await this.apiClient.triggerAnalysis(ensureResult.project.id);
            const analysisId = this.extractAnalysisId(analysisResult);
            if (analysisId) {
                this.currentAnalysis.set(ensureResult.project.id, analysisId);
                this.monitorAnalysisProgress(analysisId, ensureResult.project.id).catch(() => undefined);
            }

            return analysisResult;
        } catch (error: any) {
            this.logger.error('分析项目失败', error);
            vscode.window.showErrorMessage(`分析项目失败: ${error?.message || '未知错误'}`);
            return null;
        }
    }

    async analyzeFile(filePath: string): Promise<DebtItem[] | null> {
        const config = this.configManager.getConfig();
        if (this.isFileExcluded(filePath, config.analysis.excludedPatterns)) {
            this.logger.debug('文件命中排除规则，跳过分析', { filePath });
            return null;
        }

        if (await this.isFileTooLarge(filePath, config.analysis.maxFileSize)) {
            this.logger.warn('文件过大，跳过分析', { filePath });
            return null;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            this.logger.warn('未找到工作区，无法执行文件分析');
            return null;
        }

        try {
            const ensureResult = await this.ensureProject(workspaceFolder.uri.fsPath);
            const relativePath = vscode.workspace.asRelativePath(filePath).replace(/\\/g, '/');

            const triggerResult = await this.apiClient.triggerAnalysis(ensureResult.project.id, relativePath);
            const analysisId = this.extractAnalysisId(triggerResult);
            if (!analysisId) {
                throw new Error('后端未返回分析任务 ID');
            }

            return await this.waitForFileAnalysis(analysisId, relativePath, ensureResult.project.id);
        } catch (error: any) {
            this.logger.error('分析文件失败', error);
            vscode.window.showErrorMessage(`分析文件失败: ${error?.message || '未知错误'}`);
            return null;
        }
    }

    getCurrentAnalysis(projectId: string): string | undefined {
        return this.currentAnalysis.get(projectId);
    }

    private restoreClientId(): string {
        const fallback = this.generateClientId();
        try {
            const stored = this.context?.globalState.get<string>('tdm.clientId');
            if (stored) {
                return stored;
            }
            this.context?.globalState.update('tdm.clientId', fallback);
            return fallback;
        } catch (error) {
            this.logger.warn('恢复客户端 ID 失败，使用新的 ID', error);
            return fallback;
        }
    }

    private generateClientId(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    private async ensureProject(projectPath: string): Promise<EnsureProjectResult> {
        const existingRaw = await this.apiClient.getProjectByPath(projectPath).catch(() => null);
        const existing = this.normalizeProject(existingRaw);
        if (existing) {
            return { project: existing, created: false };
        }

        const payload = {
            name: this.getProjectName(projectPath),
            localPath: projectPath,
            language: await this.detectProjectLanguage(projectPath)
        };
        const idempotencyKey = `tdm:${Buffer.from(projectPath).toString('base64')}`;
        const createdRaw = await this.apiClient.createProjectIdempotent(payload, idempotencyKey);
        const project = this.normalizeProject(createdRaw);
        if (!project) {
            throw new Error('项目创建成功但返回数据格式异常');
        }

        vscode.window.showInformationMessage(`已创建项目「${project.name}」，即将开始分析。`);
        return { project, created: true };
    }

    private normalizeProject(raw: any): Project | null {
        if (!raw) {
            return null;
        }

        const project: Project = {
            id: String(raw.id ?? raw.project_id ?? ''),
            name: raw.name ?? '',
            description: raw.description ?? '',
            repoUrl: raw.repo_url ?? raw.repoUrl ?? '',
            localPath: raw.localPath ?? raw.local_path ?? '',
            language: raw.language ?? 'unknown',
            createdAt: raw.created_at ?? raw.createdAt ?? '',
            updatedAt: raw.updated_at ?? raw.updatedAt ?? ''
        };

        if (!project.id || !project.localPath) {
            return null;
        }

        return project;
    }

    private async safeGetProjectCurrent(projectId: string): Promise<any> {
        try {
            return await this.apiClient.getProjectCurrent(projectId);
        } catch (error) {
            this.logger.warn('获取项目当前分析状态失败，忽略继续执行', error);
            return null;
        }
    }

    private isAnalysisRunning(current: any): boolean {
        if (!current) {
            return false;
        }

        const status = String(current.status ?? '').toLowerCase();
        return ['running', 'analyzing', 'started'].includes(status);
    }

    private extractAnalysisId(result: any): string | null {
        if (!result) {
            return null;
        }

        return (
            result.analysis_id ||
            result.analysisId ||
            result.task_id ||
            result.taskId ||
            result.id ||
            null
        );
    }

    private async monitorAnalysisProgress(analysisId: string, projectId: string): Promise<void> {
        const progressOptions: vscode.ProgressOptions = {
            location: vscode.ProgressLocation.Notification,
            title: '技术债务分析',
            cancellable: true
        };

        await vscode.window.withProgress(progressOptions, async (progress, token) => {
            let completed = false;
            let retries = 0;
            const maxRetries = 30;

            token.onCancellationRequested(() => {
                this.logger.info('用户取消了分析进度跟踪');
            });

            while (!completed && retries < maxRetries && !token.isCancellationRequested) {
                try {
                    const status = await this.apiClient.getAnalysisStatus(projectId, analysisId);
                    const phase = String(status.status || '').toLowerCase();

                    if (phase === 'completed') {
                        progress.report({ increment: 100, message: '分析完成' });
                        vscode.window.showInformationMessage('项目分析已完成。');
                        completed = true;
                    } else if (phase === 'failed') {
                        progress.report({ increment: 100, message: '分析失败' });
                        vscode.window.showErrorMessage('项目分析失败，请稍后重试。');
                        completed = true;
                    } else {
                        progress.report({ increment: 5, message: '分析进行中...' });
                        await this.delay(5000);
                        retries += 1;
                    }
                } catch (error: any) {
                    const statusCode = error?.response?.status;
                    if (statusCode && statusCode >= 400 && statusCode < 500) {
                        this.logger.error('获取分析状态失败，停止查询', error);
                        vscode.window.showErrorMessage(`获取分析状态失败: ${statusCode}`);
                        break;
                    }

                    this.logger.warn('获取分析状态失败，重试', error);
                    retries += 1;
                    await this.delay(5000);
                }
            }

            if (!completed && retries >= maxRetries) {
                vscode.window.showWarningMessage('分析进度查询超时，请稍后查看结果。');
            }

            this.currentAnalysis.delete(projectId);
        });
    }

    private async waitForFileAnalysis(analysisId: string, filePath: string, projectId: string): Promise<DebtItem[]> {
        let retries = 0;
        const maxRetries = 12;

        while (retries < maxRetries) {
            try {
                const status = await this.apiClient.getAnalysisStatus(projectId, analysisId);
                const phase = String(status.status || '').toLowerCase();

                if (phase === 'completed') {
                    return await this.apiClient.getFileDebts(projectId, filePath);
                }

                if (phase === 'failed') {
                    throw new Error('文件分析失败');
                }

                await this.delay(5000);
                retries += 1;
            } catch (error: any) {
                this.logger.warn('等待文件分析结果失败，重试', error);
                retries += 1;
                await this.delay(5000);
            }
        }

        throw new Error('文件分析超时');
    }

    private getProjectName(projectPath: string): string {
        const parts = projectPath.split(/[\\/]/);
        return parts.pop() || 'Unknown Project';
    }

    private async detectProjectLanguage(projectPath: string): Promise<string> {
        const folder = vscode.workspace.workspaceFolders?.find((f) => f.uri.fsPath === projectPath);
        if (!folder) {
            return 'unknown';
        }

        const checks: Array<{ pattern: string; language: string }> = [
            { pattern: 'package.json', language: 'javascript' },
            { pattern: 'requirements.txt', language: 'python' },
            { pattern: 'pom.xml', language: 'java' },
            { pattern: 'go.mod', language: 'go' },
            { pattern: 'Cargo.toml', language: 'rust' }
        ];

        for (const check of checks) {
            const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, check.pattern), '**/node_modules/**', 1);
            if (matches.length > 0) {
                return check.language;
            }
        }

        return 'unknown';
    }

    private isFileExcluded(filePath: string, patterns: string[]): boolean {
        return patterns.some((pattern) => minimatch(filePath, pattern));
    }

    private async isFileTooLarge(filePath: string, maxSize: number): Promise<boolean> {
        try {
            const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
            return stat.size > maxSize;
        } catch (error) {
            this.logger.warn('读取文件大小失败，忽略限制', error);
            return false;
        }
    }

    private async delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
