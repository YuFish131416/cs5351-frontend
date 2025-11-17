import { Buffer } from 'buffer';
import * as path from 'path';
import * as vscode from 'vscode';
import { ApiClient } from '../utils/apiClient';
import { Logger } from '../utils/logger';
import { Project } from '../../types';

interface EnsureProjectResult {
    project: Project;
    created: boolean;
}

export class ProjectAnalysisRunner {
    private readonly apiClient: ApiClient;
    private readonly logger: Logger;

    constructor(apiClient?: ApiClient) {
        this.apiClient = apiClient ?? new ApiClient();
        this.logger = Logger.getInstance();
    }

    async run(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('请先打开一个工作区，再运行项目债务分析。');
            return;
        }

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: '运行项目债务分析',
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ message: '准备项目...' });
                    const ensureResult = await this.ensureProject(workspaceFolder);

                    progress.report({ message: '获取最新分析状态...' });
                    const current = await this.apiClient.getProjectCurrent(ensureResult.project.id);

                    const statusMessage = this.composeStatusMessage(ensureResult.project, current, ensureResult.created);
                    this.logger.info('项目分析状态获取成功', {
                        projectId: ensureResult.project.id,
                        status: current?.status,
                        currentAnalysisId: current?.current_analysis_id ?? current?.currentAnalysisId ?? null
                    });

                    vscode.window.showInformationMessage(statusMessage);
                }
            );
        } catch (error) {
            this.logger.error('获取项目分析状态失败', error);
            throw error;
        }
    }

    private async ensureProject(workspaceFolder: vscode.WorkspaceFolder): Promise<EnsureProjectResult> {
        const localPath = workspaceFolder.uri.fsPath;
        const existingRaw = await this.apiClient.getProjectByPath(localPath).catch(() => null);
        const existingProject = this.normalizeProject(existingRaw);

        if (existingProject) {
            return { project: existingProject, created: false };
        }

        const payload = {
            name: workspaceFolder.name,
            localPath,
            language: await this.detectProjectLanguage(workspaceFolder)
        };
        const idempotencyKey = `tdm:${Buffer.from(localPath).toString('base64')}`;

        const createdRaw = await this.apiClient.createProjectIdempotent(payload, idempotencyKey);
        const createdProject = this.normalizeProject(createdRaw);
        if (!createdProject) {
            throw new Error('项目创建成功但返回数据格式不正确。');
        }

        vscode.window.showInformationMessage(`已为当前工作区创建项目「${createdProject.name}」。`);
        return { project: createdProject, created: true };
    }

    private normalizeProject(raw: any): Project | null {
        if (!raw) {
            return null;
        }

        const normalized: Project = {
            id: String(raw.id ?? raw.project_id ?? ''),
            name: raw.name ?? '',
            description: raw.description ?? '',
            repoUrl: raw.repo_url ?? raw.repoUrl ?? '',
            localPath: raw.localPath ?? raw.local_path ?? '',
            language: raw.language ?? 'unknown',
            createdAt: raw.created_at ?? raw.createdAt ?? '',
            updatedAt: raw.updated_at ?? raw.updatedAt ?? ''
        };

        if (!normalized.id || !normalized.localPath) {
            return null;
        }

        return normalized;
    }

    private composeStatusMessage(project: Project, current: any, created: boolean): string {
        const parts: string[] = [];
        const status = current?.status ?? 'unknown';
        const currentAnalysisId = current?.current_analysis_id ?? current?.currentAnalysisId;

        if (status) {
            parts.push(`状态：${status}`);
        }
        if (currentAnalysisId) {
            parts.push(`分析ID：${currentAnalysisId}`);
        }

        const detail = parts.length > 0 ? `${parts.join('，')}。` : '未返回状态信息。';
        const prefix = created ? `已创建项目「${project.name}」，` : `已找到项目「${project.name}」，`;
        return `${prefix}${detail}`;
    }

    private async detectProjectLanguage(folder: vscode.WorkspaceFolder): Promise<string> {
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

        const extension = path.extname(folder.uri.fsPath).toLowerCase();
        if (extension === '.py') {
            return 'python';
        }
        if (extension === '.ts' || extension === '.js') {
            return 'javascript';
        }

        return 'unknown';
    }
}
