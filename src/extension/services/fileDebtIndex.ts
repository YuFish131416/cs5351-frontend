import * as vscode from 'vscode';
import { DebtService } from './debtService';
import { Logger } from '../utils/logger';
import { DebtStatus, DebtSeverity } from '../../types/debt';

export interface FileDebt {
    id: string;
    filePath: string;
    line: number;
    severity: DebtSeverity;
    description: string;
    status: string; // keep raw then map if needed
    createdAt?: string;
    updatedAt?: string;
}

interface CacheEntry {
    debts: FileDebt[];
    fetchedAt: number;
    filePath: string;
}

export class FileDebtIndex {
    private static _instance: FileDebtIndex | undefined;
    static getInstance(): FileDebtIndex {
        if (!this._instance) this._instance = new FileDebtIndex();
        return this._instance;
    }

    private logger = Logger.getInstance();
    private debtService = new DebtService();
    private cache = new Map<string, CacheEntry>();
    private ttlMs = 120 * 1000; // 2 minutes default
    private workspaceProjectId: string | null = null;
    private ensuringProject: Promise<string | null> | null = null;

    setTTL(seconds: number) { this.ttlMs = Math.max(10, seconds) * 1000; }

    async ensureProject(): Promise<string | null> {
        if (this.workspaceProjectId) return this.workspaceProjectId;
        if (this.ensuringProject) return this.ensuringProject;
        this.ensuringProject = (async () => {
            try {
                const folder = vscode.workspace.workspaceFolders?.[0];
                if (!folder) { this.logger.warn('无工作区，跳过项目创建'); return null; }
                const localPath = folder.uri.fsPath;
                // 尝试创建或获取
                const project = await this.debtService.getProjectByPath(localPath) || await this.debtService.createProject({ name: folder.name, localPath });
                this.workspaceProjectId = String(project.id);
                this.logger.info('[FileDebtIndex] 使用项目ID: ' + this.workspaceProjectId);
                return this.workspaceProjectId;
            } catch (e: any) {
                this.logger.error('创建/获取项目失败: ' + e.message);
                return null;
            } finally {
                this.ensuringProject = null;
            }
        })();
        return this.ensuringProject;
    }

    private normalizePath(p: string): string {
        let s = p.replace(/\\/g, '/');
        s = s.replace(/\/+$/g, '');
        // VS Code 无直接 env.os 属性，这里使用 process.platform
        const isWin = process.platform === 'win32';
        return isWin ? s.toLowerCase() : s;
    }

    private mapSeverity(raw: string): DebtSeverity {
        const v = (raw || '').toLowerCase();
        if (v === 'critical') return DebtSeverity.CRITICAL;
        if (v === 'high') return DebtSeverity.HIGH;
        if (v === 'medium') return DebtSeverity.MEDIUM;
        return DebtSeverity.LOW;
    }

    async scanFile(document: vscode.TextDocument, forceRefresh = false): Promise<FileDebt[]> {
        const projectId = await this.ensureProject();
        if (!projectId) return [];
        const filePath = document.uri.fsPath;
        const key = this.normalizePath(filePath);
        const cached = this.cache.get(key);
        if (cached && !forceRefresh && (Date.now() - cached.fetchedAt < this.ttlMs)) return cached.debts;
        return this.fetchAndCacheFile(projectId, filePath, key);
    }

    private async fetchAndCacheFile(projectId: string, filePath: string, key?: string): Promise<FileDebt[]> {
        const cacheKey = key ?? this.normalizePath(filePath);
        try {
            const debtsRaw = await (this.debtService as any).apiClient.getFileDebts(projectId, filePath);
            const debts: FileDebt[] = (debtsRaw || []).map((d: any) => ({
                id: String(d.id),
                filePath: d.file_path || d.filePath || filePath,
                line: Number(d.line || d.metadata?.location?.line || 1),
                severity: this.mapSeverity(d.severity),
                description: d.message || d.description || '',
                status: String(d.status || 'open').toLowerCase(),
                createdAt: d.created_at,
                updatedAt: d.updated_at
            }));
            this.cache.set(cacheKey, { debts, fetchedAt: Date.now(), filePath });
            return debts;
        } catch (e: any) {
            this.logger.error('扫描文件失败: ' + e.message);
            this.cache.delete(cacheKey);
            return [];
        }
    }

    getCachedFileDebts(document: vscode.TextDocument): FileDebt[] {
        const key = this.normalizePath(document.uri.fsPath);
        const cached = this.cache.get(key);
        return cached ? cached.debts : [];
    }

    async updateDebtStatus(debt: FileDebt, status: DebtStatus): Promise<boolean> {
        try {
            const mapped = status === DebtStatus.WONT_FIX ? 'ignored' : status;
            await (this.debtService as any).apiClient.updateDebtStatus(debt.id, mapped);
            // Invalidate cache for file
            const key = this.normalizePath(debt.filePath);
            this.cache.delete(key);
            return true;
        } catch (e: any) {
            this.logger.error('更新债务状态失败: ' + e.message);
            return false;
        }
    }

    aggregateWorkspaceDebts(): FileDebt[] {
        const all: FileDebt[] = [];
        for (const entry of this.cache.values()) all.push(...entry.debts);
        return all.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line);
    }

    clearAll() { this.cache.clear(); }

    async refreshAllCached(forceRescan = true): Promise<void> {
        const projectId = await this.ensureProject();
        if (!projectId) return;
        for (const [key, entry] of this.cache.entries()) {
            if (!forceRescan && (Date.now() - entry.fetchedAt < this.ttlMs)) {
                continue;
            }
            await this.fetchAndCacheFile(projectId, entry.filePath, key);
        }
    }
}
