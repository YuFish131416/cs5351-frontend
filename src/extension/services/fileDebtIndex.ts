import * as path from 'path';
import * as vscode from 'vscode';
import { DebtService } from './debtService';
import { Logger } from '../utils/logger';
import { DebtStatus, DebtSeverity } from '../../types/debt';

export interface FileDebt {
    id: string;
    filePath: string;
    line: number;
    severity: DebtSeverity;
    description?: string;
    status?: string;
    metadata?: Record<string, any>;
    riskFlags?: string[];
    smellFlags?: string[];
    estimatedEffort?: number;
    debtScore?: number;
}

interface CacheEntry {
    debts: FileDebt[];
    fetchedAt: number;
    filePath: string;
}

/**
 * Shared cache of file level debt data to back inline decorations and code lenses.
 */
export class FileDebtIndex {
    private static instance: FileDebtIndex | undefined;

    static getInstance(): FileDebtIndex {
        if (!this.instance) {
            this.instance = new FileDebtIndex();
        }
        return this.instance;
    }

    private readonly logger = Logger.getInstance();
    private readonly debtService = new DebtService();
    private readonly cache = new Map<string, CacheEntry>();
    private readonly changeEmitter = new vscode.EventEmitter<void>();
    readonly onDidChange = this.changeEmitter.event;
    private ttlMs = 120 * 1000;
    private workspaceProjectId: string | null = null;
    private ensuringProject: Promise<string | null> | null = null;

    setTTL(seconds: number): void {
        this.ttlMs = Math.max(10, seconds) * 1000;
    }

    async ensureProject(): Promise<string | null> {
        if (this.workspaceProjectId) {
            return this.workspaceProjectId;
        }
        if (this.ensuringProject) {
            return this.ensuringProject;
        }

        this.ensuringProject = (async () => {
            try {
                const folder = vscode.workspace.workspaceFolders?.[0];
                if (!folder) {
                    this.logger.warn('No workspace folder detected while resolving project id.');
                    return null;
                }

                const localPath = folder.uri.fsPath;
                const existing = await this.debtService.getProjectByPath(localPath);
                if (existing) {
                    this.workspaceProjectId = existing.id;
                    return existing.id;
                }

                const created = await this.debtService.createProject({
                    name: folder.name,
                    localPath,
                    language: await this.detectProjectLanguage(folder)
                });
                this.workspaceProjectId = created.id;
                vscode.window.showInformationMessage(`Created project “${created.name}” for technical debt tracking.`);
                return created.id;
            } catch (error: any) {
                this.logger.error('Failed to create or resolve project id: ' + error.message);
                return null;
            } finally {
                this.ensuringProject = null;
            }
        })();

        return this.ensuringProject;
    }

    async scanFile(document: vscode.TextDocument, forceRefresh = false): Promise<FileDebt[]> {
        if (document.uri.scheme !== 'file') {
            this.logger.debug('Skipping debt scan for non-file document', { scheme: document.uri.scheme, uri: document.uri.toString() });
            return [];
        }

        if (this.isVirtualDocument(document)) {
            this.logger.debug('Skipping debt scan for virtual document', { uri: document.uri.toString() });
            return [];
        }

        const projectId = await this.ensureProject();
        if (!projectId) {
            return [];
        }

        const filePath = document.uri.fsPath;
        const cacheKey = this.normalizePath(filePath);
        const cached = this.cache.get(cacheKey);

        if (cached && !forceRefresh && Date.now() - cached.fetchedAt < this.ttlMs) {
            return cached.debts;
        }

        return this.fetchAndCacheFile(projectId, filePath, cacheKey);
    }

    getCachedFileDebts(document: vscode.TextDocument): FileDebt[] {
        const key = this.normalizePath(document.uri.fsPath);
        const cached = this.cache.get(key);
        return cached ? cached.debts : [];
    }

    getCachedDebtsByPath(filePath: string): FileDebt[] {
        const key = this.normalizePath(filePath);
        const cached = this.cache.get(key);
        return cached ? cached.debts : [];
    }

    async updateDebtStatus(debt: FileDebt, status: DebtStatus): Promise<boolean> {
        try {
            await this.debtService.updateDebtStatus(debt.id, status);
            const key = this.normalizePath(debt.filePath);
            this.cache.delete(key);
            this.changeEmitter.fire();
            return true;
        } catch (error: any) {
            this.logger.error('Failed to update debt status: ' + error.message);
            return false;
        }
    }

    aggregateWorkspaceDebts(): FileDebt[] {
        const all: FileDebt[] = [];
        for (const entry of this.cache.values()) {
            all.push(...entry.debts);
        }
        return all.sort((left, right) => {
            const pathCompare = left.filePath.localeCompare(right.filePath);
            return pathCompare !== 0 ? pathCompare : left.line - right.line;
        });
    }

    clearAll(): void {
        this.cache.clear();
        this.changeEmitter.fire();
    }

    async refreshAllCached(forceRescan = true): Promise<void> {
        const projectId = await this.ensureProject();
        if (!projectId) {
            return;
        }

        for (const [key, entry] of this.cache.entries()) {
            const expired = Date.now() - entry.fetchedAt >= this.ttlMs;
            if (!forceRescan && !expired) {
                continue;
            }
            await this.fetchAndCacheFile(projectId, entry.filePath, key);
        }
    }

    private async fetchAndCacheFile(projectId: string, filePath: string, cacheKey?: string): Promise<FileDebt[]> {
        const key = cacheKey ?? this.normalizePath(filePath);
        try {
            const debts = await this.debtService.getFileDebts(projectId, filePath);
            const mapped: FileDebt[] = debts.map(debt => ({
                id: debt.id,
                filePath: this.resolveAbsolutePath(debt.filePath, filePath),
                line: Math.max(1, Number(debt.metadata?.location?.line ?? debt.metadata?.line ?? (debt as any).line ?? 1)),
                severity: this.mapSeverity(debt.severity),
                description: debt.description,
                status: String(debt.status || '').toLowerCase() || 'open',
                metadata: debt.metadata,
                riskFlags: this.coerceStringArray((debt.metadata as any)?.risk_flags ?? (debt.metadata as any)?.riskFlags),
                smellFlags: this.coerceStringArray((debt.metadata as any)?.smell_flags ?? (debt.metadata as any)?.smellFlags),
                estimatedEffort: Number((debt.metadata as any)?.estimated_effort ?? debt.estimatedEffort) || undefined,
                debtScore: typeof (debt.metadata as any)?.debt_score === 'number' ? (debt.metadata as any).debt_score : undefined
            }));

            this.cache.set(key, {
                debts: mapped,
                fetchedAt: Date.now(),
                filePath
            });
            this.changeEmitter.fire();
            return mapped;
        } catch (error: any) {
            this.logger.error('Failed to fetch file debts: ' + error.message);
            this.cache.delete(key);
            this.changeEmitter.fire();
            return [];
        }
    }

    dispose(): void {
        this.changeEmitter.dispose();
    }

    private normalizePath(rawPath: string): string {
        let normalized = rawPath.replace(/\\/g, '/');
        normalized = normalized.replace(/\/+/g, '/');
        normalized = normalized.replace(/\/+$/g, '');
        if (process.platform === 'win32') {
            normalized = normalized.toLowerCase();
        }
        return normalized;
    }

    private isVirtualDocument(document: vscode.TextDocument): boolean {
        const raw = document.uri.toString(true).toLowerCase();
        if (!raw) {
            return false;
        }
        if (raw.includes('extension-output-')) {
            return true;
        }
        if (raw.startsWith('vscode-remote://') || raw.startsWith('vscode-userdata://')) {
            return true;
        }
        return false;
    }

    private resolveAbsolutePath(preferred: string | undefined, fallback: string): string {
        const pick = preferred && preferred.trim().length ? preferred : fallback;
        if (path.isAbsolute(pick)) {
            return path.normalize(pick);
        }

        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
        const containingWorkspace = workspaceFolders.find(folder => fallback.startsWith(folder.uri.fsPath));
        if (containingWorkspace) {
            return path.normalize(path.join(containingWorkspace.uri.fsPath, pick));
        }
        if (workspaceFolders.length) {
            return path.normalize(path.join(workspaceFolders[0].uri.fsPath, pick));
        }
        return path.normalize(fallback);
    }

    private mapSeverity(raw: DebtSeverity | string): DebtSeverity {
        if (Object.values(DebtSeverity).includes(raw as DebtSeverity)) {
            return raw as DebtSeverity;
        }
        const value = String(raw || '').toLowerCase();
        switch (value) {
            case 'critical':
                return DebtSeverity.CRITICAL;
            case 'high':
                return DebtSeverity.HIGH;
            case 'medium':
                return DebtSeverity.MEDIUM;
            default:
                return DebtSeverity.LOW;
        }
    }

    private coerceStringArray(value: unknown): string[] | undefined {
        if (!value) {
            return undefined;
        }
        if (Array.isArray(value)) {
            return value.filter(item => typeof item === 'string') as string[];
        }
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.split(',').map(item => item.trim()).filter(Boolean);
        }
        return undefined;
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

        return 'unknown';
    }
}
