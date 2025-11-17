import * as path from 'path';
import * as vscode from 'vscode';
import { ApiClient } from '../utils/apiClient';
import { Project, DebtItem, DebtSummary, DebtStatus, DebtSeverity, DebtType } from '../../types';
import { Logger } from '../utils/logger';

export class DebtService {
    private apiClient: ApiClient;
    private logger: Logger;
    private cache: Map<string, { data: any; timestamp: number }> = new Map();
    private cacheTimeout = 5 * 60 * 1000; // 5分钟缓存

    constructor() {
        this.apiClient = new ApiClient();
        this.logger = Logger.getInstance();
    }

    /**
     * 获取所有项目列表
     */
    async getProjects(): Promise<Project[]> {
        const cacheKey = 'projects';
        const cached = this.getCachedData(cacheKey);
        if (cached) {
            return cached as Project[];
        }

        try {
            this.logger.info('获取项目列表...');
            const projects = await this.apiClient.getProjects();
            this.setCachedData(cacheKey, projects);
            return projects;
        } catch (error: any) {
            const detail = this.extractErrorMessage(error);
            this.logger.error('获取项目列表失败:', detail);
            throw new Error(`获取项目列表失败: ${detail}`);
        }
    }

    /**
     * 根据本地路径获取项目
     */
    async getProjectByPath(localPath: string): Promise<Project | null> {
        try {
            const direct = await this.apiClient.getProjectByPath(localPath);
            if (direct) {
                const raw: any = direct as any;
                return {
                    id: String(raw.id ?? raw.project_id ?? ''),
                    name: raw.name ?? '',
                    description: raw.description ?? '',
                    repoUrl: raw.repo_url ?? raw.repoUrl ?? '',
                    localPath: raw.localPath ?? raw.local_path ?? localPath,
                    language: raw.language ?? 'unknown',
                    createdAt: raw.created_at ?? raw.createdAt ?? '',
                    updatedAt: raw.updated_at ?? raw.updatedAt ?? ''
                };
            }

            const projects = await this.getProjects();
            const normalize = (value: string) => {
                if (!value) {
                    return '';
                }
                let normalized = value.replace(/\\/g, '/');
                normalized = normalized.replace(/\/+/g, '/');
                normalized = normalized.replace(/\/+$/g, '');
                return normalized.toLowerCase();
            };
            const target = normalize(localPath);
            return projects.find(project => normalize(project.localPath) === target) || null;
        } catch (error: any) {
            this.logger.error('根据路径获取项目失败:', error.message);
            return null;
        }
    }

    /**
     * 创建新项目
     */
    async createProject(projectData: {
        name: string;
        localPath: string;
        description?: string;
        repoUrl?: string;
        language?: string;
    }): Promise<Project> {
        try {
            this.logger.info(`创建项目: ${projectData.name}`);
            const project = await this.apiClient.createProject(projectData);

            // 清除项目列表缓存
            this.clearCache('projects');

            this.logger.info(`项目创建成功: ${project.id}`);
            return project;
        } catch (error: any) {
            this.logger.error('创建项目失败:', error.message);
            throw new Error(`创建项目失败: ${error.message}`);
        }
    }

    /**
     * 获取项目的技术债务列表
     */
    async getProjectDebts(projectId: string, filters?: {
        severity?: DebtSeverity[];
        type?: DebtType[];
        status?: DebtStatus[];
    }): Promise<DebtItem[]> {
        const cacheKey = `debts:${projectId}:${JSON.stringify(filters || {})}`;
        const cached = this.getCachedData(cacheKey);
        if (cached) {
            return cached as DebtItem[];
        }

        try {
            this.logger.info(`获取项目 ${projectId} 的债务列表...`);
            const debts = await this.apiClient.getProjectDebts(projectId);

            // 应用过滤器
            let filteredDebts = debts;
            if (filters) {
                if (filters.severity && filters.severity.length > 0) {
                    filteredDebts = filteredDebts.filter(debt =>
                        filters.severity!.includes(debt.severity)
                    );
                }
                if (filters.type && filters.type.length > 0) {
                    filteredDebts = filteredDebts.filter(debt =>
                        filters.type!.includes(debt.debtType)
                    );
                }
                if (filters.status && filters.status.length > 0) {
                    filteredDebts = filteredDebts.filter(debt =>
                        filters.status!.includes(debt.status)
                    );
                }
            }

            this.setCachedData(cacheKey, filteredDebts);
            return filteredDebts;
        } catch (error: any) {
            this.logger.error(`获取项目 ${projectId} 的债务列表失败:`, error.message);
            throw new Error(`获取债务列表失败: ${error.message}`);
        }
    }

    /**
     * 获取项目的债务摘要
     */
    async getDebtSummary(projectId: string): Promise<DebtSummary> {
        const cacheKey = `summary:${projectId}`;
        const cached = this.getCachedData(cacheKey);
        if (cached) {
            return cached as DebtSummary;
        }

        try {
            this.logger.info(`获取项目 ${projectId} 的债务摘要...`);
            const summary = await this.apiClient.getDebtSummary(projectId);
            this.setCachedData(cacheKey, summary);
            return summary;
        } catch (error: any) {
            this.logger.error(`获取项目 ${projectId} 的债务摘要失败:`, error.message);

            // 如果API调用失败，返回一个空的摘要
            return {
                totalDebts: 0,
                bySeverity: {
                    [DebtSeverity.LOW]: 0,
                    [DebtSeverity.MEDIUM]: 0,
                    [DebtSeverity.HIGH]: 0,
                    [DebtSeverity.CRITICAL]: 0
                },
                byType: {
                    [DebtType.COMPLEXITY]: 0,
                    [DebtType.DUPLICATION]: 0,
                    [DebtType.CODE_SMELL]: 0,
                    [DebtType.TODO]: 0,
                    [DebtType.HOTSPOT]: 0
                },
                totalEstimatedEffort: 0,
                averageDebtScore: 0
            };
        }
    }

    /**
     * 获取指定文件的债务
     */
    async getFileDebts(projectId: string, filePath: string): Promise<DebtItem[]> {
        const lookup = await this.resolvePathForRequest(filePath);
        if (!lookup) {
            this.logger.debug('跳过获取缺失文件的技术债务', { projectId, filePath });
            return [];
        }

        const cacheKey = `fileDebts:${projectId}:${lookup.request}`;
        const cached = this.getCachedData(cacheKey);
        if (cached) {
            return cached as DebtItem[];
        }

        try {
            this.logger.info(`获取文件 ${lookup.request} 的债务...`);
            const debts = await this.apiClient.getFileDebts(projectId, lookup.request);
            const normalized = debts.map(debt => ({
                ...debt,
                filePath: this.resolveDebtFilePath(debt.filePath, lookup.absolute)
            }));
            this.setCachedData(cacheKey, normalized);
            return normalized;
        } catch (error: any) {
            const detail = this.extractErrorMessage(error);
            this.logger.error(`获取文件 ${lookup.request} 的债务失败:`, detail);
            throw new Error(`获取文件债务失败: ${detail}`);
        }
    }

    /**
     * 更新债务状态
     */
    async updateDebtStatus(debtId: string, status: DebtStatus, comment?: string): Promise<DebtItem> {
        try {
            this.logger.info(`更新债务 ${debtId} 状态为: ${status}`);
            const updatedDebt = await this.apiClient.updateDebtStatus(debtId, status);

            // 清除相关缓存
            this.clearDebtRelatedCaches(updatedDebt.projectId);

            this.logger.info(`债务状态更新成功: ${debtId}`);
            return updatedDebt;
        } catch (error: any) {
            this.logger.error(`更新债务 ${debtId} 状态失败:`, error.message);
            throw new Error(`更新债务状态失败: ${error.message}`);
        }
    }

    /**
     * 批量更新债务状态
     */
    async batchUpdateDebtStatus(debtIds: string[], status: DebtStatus, comment?: string): Promise<DebtItem[]> {
        const results: DebtItem[] = [];
        const errors: string[] = [];

        for (const debtId of debtIds) {
            try {
                const updatedDebt = await this.updateDebtStatus(debtId, status, comment);
                results.push(updatedDebt);
            } catch (error: any) {
                errors.push(`债务 ${debtId}: ${error.message}`);
            }
        }

        if (errors.length > 0) {
            this.logger.warn(`批量更新债务状态时出现 ${errors.length} 个错误`);
            if (results.length === 0) {
                throw new Error(`所有更新都失败: ${errors.join('; ')}`);
            }
        }

        return results;
    }

    /**
     * 获取严重债务（高和关键级别）
     */
    async getCriticalDebts(projectId: string): Promise<DebtItem[]> {
        return this.getProjectDebts(projectId, {
            severity: [DebtSeverity.HIGH, DebtSeverity.CRITICAL]
        });
    }

    /**
     * 获取待处理的债务（开放状态）
     */
    async getOpenDebts(projectId: string): Promise<DebtItem[]> {
        return this.getProjectDebts(projectId, {
            status: [DebtStatus.OPEN]
        });
    }

    /**
     * 获取已解决的债务
     */
    async getResolvedDebts(projectId: string): Promise<DebtItem[]> {
        return this.getProjectDebts(projectId, {
            status: [DebtStatus.RESOLVED]
        });
    }

    /**
     * 根据文件路径获取债务统计
     */
    async getDebtStatsByFile(projectId: string): Promise<Map<string, { count: number; effort: number }>> {
        try {
            const debts = await this.getProjectDebts(projectId);
            const stats = new Map<string, { count: number; effort: number }>();

            debts.forEach(debt => {
                const current = stats.get(debt.filePath) || { count: 0, effort: 0 };
                current.count += 1;
                current.effort += debt.estimatedEffort;
                stats.set(debt.filePath, current);
            });

            return stats;
        } catch (error: any) {
            this.logger.error(`获取文件债务统计失败:`, error.message);
            return new Map();
        }
    }

    /**
     * 获取债务趋势数据（需要后端支持）
     */
    async getDebtTrend(projectId: string, days: number = 30): Promise<any> {
        // 这是一个示例实现，实际需要后端提供相应的API
        // 这里返回模拟数据
        return {
            timeline: this.generateTimeline(days),
            debtCounts: this.generateRandomData(days, 50, 200),
            effortSums: this.generateRandomData(days, 100, 500)
        };
    }

    /**
     * 清除所有缓存
     */
    clearAllCache(): void {
        this.logger.info('清除所有缓存');
        this.cache.clear();
    }

    /**
     * 清除特定项目的缓存
     */
    clearProjectCache(projectId: string): void {
        this.logger.info(`清除项目 ${projectId} 的缓存`);
        const keysToDelete: string[] = [];

        this.cache.forEach((value, key) => {
            if (key.includes(projectId)) {
                keysToDelete.push(key);
            }
        });

        keysToDelete.forEach(key => this.cache.delete(key));
    }

    /**
     * 健康检查
     */
    async healthCheck(): Promise<boolean> {
        try {
            return await this.apiClient.healthCheck();
        } catch (error: any) {
            this.logger.error('健康检查失败:', error.message);
            return false;
        }
    }

    /**
 * 添加技术债务
 */
    async addDebt(debtData: {
        filePath: string;
        lineNumber: number;
        description: string;
        severity: string;
        category: string;
        debtType: string;
    }): Promise<DebtItem> {
        try {
            this.logger.info(`添加技术债务: ${debtData.description}`);
            // 这里需要根据实际的 API 实现添加债务的逻辑
            // 目前暂未实现具体的 API 调用
            throw new Error('添加债务功能暂未实现');
        } catch (error: any) {
            this.logger.error('添加债务失败:', error.message);
            throw new Error(`添加债务失败: ${error.message}`);
        }
    }

    // 私有方法

    private extractErrorMessage(error: any): string {
        if (!error) {
            return '未知错误';
        }

        if (typeof error === 'string') {
            return error;
        }

        const responseDetail = error?.response?.data?.detail || error?.response?.data?.message;
        if (responseDetail) {
            return responseDetail;
        }

        if (error?.message && error.message !== 'Error') {
            return error.message;
        }

        const status = error?.response?.status;
        const statusText = error?.response?.statusText;
        if (status) {
            return statusText ? `HTTP ${status} ${statusText}` : `HTTP ${status}`;
        }

        try {
            return JSON.stringify(error);
        } catch (serializationError) {
            return String(error);
        }
    }

    private async resolvePathForRequest(filePath: string): Promise<{ absolute: string; request: string } | null> {
        if (!filePath) {
            return null;
        }

        const normalizedInput = filePath.replace(/\\/g, '/');
        const candidates: Array<{ absolute: string; base?: vscode.WorkspaceFolder }> = [];

        if (path.isAbsolute(normalizedInput)) {
            candidates.push({ absolute: path.normalize(normalizedInput) });
        }

        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
        for (const folder of workspaceFolders) {
            const absolute = path.normalize(path.join(folder.uri.fsPath, normalizedInput));
            candidates.push({ absolute, base: folder });
        }

        for (const candidate of candidates) {
            if (await this.pathExists(candidate.absolute)) {
                const base = candidate.base ?? this.findContainingWorkspace(candidate.absolute);
                const request = this.buildRequestPath(candidate.absolute, base);
                return { absolute: candidate.absolute, request };
            }
        }

        return null;
    }

    private buildRequestPath(absolutePath: string, base?: vscode.WorkspaceFolder): string {
        const normalizedAbsolute = absolutePath.replace(/\\/g, '/');
        if (base) {
            const basePath = base.uri.fsPath.replace(/\\/g, '/');
            if (normalizedAbsolute.toLowerCase().startsWith(basePath.toLowerCase())) {
                const relative = normalizedAbsolute.slice(basePath.length).replace(/^\/+/, '');
                if (relative) {
                    return relative;
                }
            }
        }
        return normalizedAbsolute;
    }

    private resolveDebtFilePath(rawPath: string | undefined, fallbackAbsolute: string): string {
        if (rawPath) {
            const normalized = rawPath.replace(/\\/g, '/');
            if (path.isAbsolute(normalized)) {
                return path.normalize(normalized);
            }

            const base = this.findContainingWorkspace(fallbackAbsolute);
            if (base) {
                const candidate = path.normalize(path.join(base.uri.fsPath, normalized));
                return candidate;
            }
        }
        return path.normalize(fallbackAbsolute);
    }

    private findContainingWorkspace(absolutePath: string): vscode.WorkspaceFolder | undefined {
        const normalizedAbsolute = absolutePath.replace(/\\/g, '/').toLowerCase();
        return (vscode.workspace.workspaceFolders ?? []).find(folder =>
            normalizedAbsolute.startsWith(folder.uri.fsPath.replace(/\\/g, '/').toLowerCase())
        );
    }

    private async pathExists(candidatePath: string): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(candidatePath));
            return true;
        } catch {
            return false;
        }
    }

    private getCachedData(key: string): any | null {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }

        // 缓存过期或不存在
        if (cached) {
            this.cache.delete(key);
        }
        return null;
    }

    private setCachedData(key: string, data: any): void {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    private clearCache(key: string): void {
        this.cache.delete(key);
    }

    private clearDebtRelatedCaches(projectId?: string): void {
        if (projectId) {
            this.clearProjectCache(projectId);
        } else {
            // 未知项目时，尽量清理债务相关缓存键
            const keysToDelete: string[] = [];
            this.cache.forEach((_, key) => {
                if (key.startsWith('debts:') || key.startsWith('fileDebts:') || key.startsWith('summary:')) {
                    keysToDelete.push(key);
                }
            });
            keysToDelete.forEach(k => this.cache.delete(k));
        }
        this.clearCache('projects');
    }

    private generateTimeline(days: number): string[] {
        const timeline: string[] = [];
        const now = new Date();

        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            timeline.push(date.toISOString().split('T')[0]);
        }

        return timeline;
    }

    private generateRandomData(days: number, min: number, max: number): number[] {
        const data: number[] = [];

        for (let i = 0; i < days; i++) {
            data.push(Math.floor(Math.random() * (max - min + 1)) + min);
        }

        return data;
    }
}