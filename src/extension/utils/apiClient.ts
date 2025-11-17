import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { ApiResponse, PaginatedResponse, Project, DebtItem, AnalysisResult, DebtSummary } from '../../types';
import {DebtSeverity, DebtStatus, DebtType, HeatMapData} from "../../types/debt";

export class ApiClient {
    private client: AxiosInstance;
    private configManager: ConfigManager;
    private isOnline: boolean = true;

    constructor() {
        this.configManager = ConfigManager.getInstance();
        this.initializeClient();
    }

    private initializeClient(): void {
        const config = this.configManager.getConfig();

        this.client = axios.create({
            baseURL: config.api.baseUrl,
            timeout: config.api.timeout,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'VSCode-Technical-Debt-Extension/1.0.0'
            }
        });

        this.setupInterceptors();
    }

    private setupInterceptors(): void {
        // 请求拦截器
        this.client.interceptors.request.use(
            (config: import('axios').InternalAxiosRequestConfig) => {
                vscode.window.setStatusBarMessage('$(sync~spin) 连接到技术债务服务...', 2000);
                return config;
            },
            (error) => {
                this.handleError(error);
                return Promise.reject(error);
            }
        );

        // 响应拦截器
        this.client.interceptors.response.use(
            (response: AxiosResponse) => {
                this.isOnline = true;
                return response.data;
            },
            (error) => {
                this.isOnline = false;
                this.handleError(error);
                return Promise.reject(error);
            }
        );
    }

    private handleError(error: any): void {
        let message = '未知错误';

        if (error.code === 'ECONNREFUSED') {
            message = '无法连接到技术债务服务，请确保后端服务正在运行';
        } else if (error.response) {
            message = `服务器错误: ${error.response.status} - ${error.response.data?.detail || error.response.statusText}`;
        } else if (error.request) {
            message = '网络请求失败，请检查网络连接';
        } else {
            message = error.message;
        }

        vscode.window.showErrorMessage(`技术债务工具: ${message}`);
    }

    // 项目相关 API
    async getProjects(): Promise<Project[]> {
        const raw: any = await (this.client as any).get('/projects');
        const mapProject = (p: any): Project => ({
            id: String(p.id ?? p.project_id),
            name: p.name,
            description: p.description ?? '',
            repoUrl: p.repo_url ?? p.repoUrl ?? '',
            localPath: p.localPath ?? p.local_path ?? '',
            language: p.language ?? '',
            createdAt: p.created_at ?? p.createdAt ?? '',
            updatedAt: p.updated_at ?? p.updatedAt ?? ''
        });
        return Array.isArray(raw) ? raw.map(mapProject) : [];
    }

    async getProject(projectId: string): Promise<Project> {
        const p: any = await (this.client as any).get(`/projects/${projectId}`);
        return {
            id: String(p.id ?? p.project_id),
            name: p.name,
            description: p.description ?? '',
            repoUrl: p.repo_url ?? p.repoUrl ?? '',
            localPath: p.localPath ?? p.local_path ?? '',
            language: p.language ?? '',
            createdAt: p.created_at ?? p.createdAt ?? '',
            updatedAt: p.updated_at ?? p.updatedAt ?? ''
        };
    }

    async createProject(projectData: Partial<Project>): Promise<Project> {
        const res: any = await (this.client as any).post('/projects', projectData);
        return {
            id: String(res.id ?? res.project_id),
            name: res.name,
            description: res.description ?? '',
            repoUrl: res.repo_url ?? res.repoUrl ?? '',
            localPath: res.localPath ?? res.local_path ?? '',
            language: res.language ?? '',
            createdAt: res.created_at ?? res.createdAt ?? '',
            updatedAt: res.updated_at ?? res.updatedAt ?? ''
        };
    }

    // Create project with optional Idempotency-Key header
    async createProjectIdempotent(projectData: Partial<Project>, idempotencyKey?: string): Promise<Project> {
        const config: AxiosRequestConfig = {};
        if (idempotencyKey) {
            config.headers = { 'Idempotency-Key': idempotencyKey };
        }
        const res: any = await (this.client as any).post('/projects', projectData, config);
        return {
            id: String(res.id ?? res.project_id),
            name: res.name,
            description: res.description ?? '',
            repoUrl: res.repo_url ?? res.repoUrl ?? '',
            localPath: res.localPath ?? res.local_path ?? '',
            language: res.language ?? '',
            createdAt: res.created_at ?? res.createdAt ?? '',
            updatedAt: res.updated_at ?? res.updatedAt ?? ''
        };
    }

    // 查找项目 by local path（如果后端实现了专门接口则调用它，否则前端会落回到 /projects 列表）
    async getProjectByPath(localPath: string): Promise<Project | null> {
        const tryServer = async (p: string) => {
            try {
                const res = await this.client.get(`/projects/by-path`, { params: { localPath: p } });
                return (res as any) || null;
            } catch (e) {
                return null;
            }
        };

        // 1) try original
        let project = await tryServer(localPath);
        if (project) return project;

        // 2) try normalized variants to handle Windows/URL encoding differences
        const variants: string[] = [];
        // replace backslashes with forward slashes
        variants.push(localPath.replace(/\\/g, '/'));
        // replace forward slashes with backslashes
        variants.push(localPath.replace(/\//g, '\\'));
        // trim trailing slashes
        variants.push(localPath.replace(/[\\/]+$/, ''));
        // normalized path (node)
        try {
            const path = require('path');
            variants.push(path.normalize(localPath));
        } catch (e) {
            // ignore
        }

        for (const v of variants) {
            if (!v) continue;
            project = await tryServer(v);
            if (project) return project;
        }

        // fallback to listing projects and matching with loose normalization
        const projects = await this.getProjects();
        const normalize = (p: string) => {
            let s = (p || '').split('\\').join('/');
            while (s.endsWith('/')) s = s.slice(0, -1);
            return s.toLowerCase();
        };
        const target = normalize(localPath);
        return projects.find(p => normalize(p.localPath) === target) || null;
    }

    async updateProject(projectId: string, projectData: Partial<Project>): Promise<Project> {
        return this.client.put(`/projects/${projectId}`, projectData);
    }

    // 分析相关 API
    // 触发对某个项目的分析。后端期望的路径为: /projects/{project_id}/analysis
    async triggerAnalysis(projectId: string, filePath?: string): Promise<AnalysisResult> {
        return this.client.post(`/projects/${projectId}/analysis`, {
            file_path: filePath,
            incremental: !!filePath
        });
    }

    // 获取项目当前状态（锁信息 / current_analysis 等）
    async getProjectCurrent(projectId: string): Promise<any> {
        return this.client.get(`/projects/${projectId}/current`);
    }

    // Lock APIs
    // Lock APIs
    // NOTE: 后端已调整为在处理期间自动加锁并在处理完成时自动解锁。
    // 保留这些方法以保持向后兼容，但前端将不再发起显式的锁/解锁请求，调用将返回一个已忽略的提示。
    async lockProject(projectId: string, clientId: string, ttlSeconds: number = 300): Promise<any> {
        // 不再发送请求给后端。保留调用签名以免破坏现有代码路径。
        vscode.window.showInformationMessage('后端已改为在处理期间自动加锁，前端不再需要手动加锁，已忽略此调用。');
        return Promise.resolve({ message: 'ignored - server-managed-locking' });
    }

    async renewLock(projectId: string, clientId: string, ttlSeconds: number = 300): Promise<any> {
        vscode.window.showInformationMessage('后端自动管理锁续租，前端 renewLock 已被忽略。');
        return Promise.resolve({ message: 'ignored - server-managed-locking' });
    }

    async unlockProject(projectId: string, clientId: string): Promise<any> {
        vscode.window.showInformationMessage('后端在处理完成时会自动解锁，前端不再需要手动解锁，已忽略此调用。');
        return Promise.resolve({ message: 'ignored - server-managed-locking' });
    }

    // 获取分析状态 — 后端路径为 /projects/{project_id}/analysis/{analysis_id}
    async getAnalysisStatus(projectId: string, analysisId: string): Promise<AnalysisResult> {
        return this.client.get(`/projects/${projectId}/analysis/${analysisId}`);
    }

    // 债务相关 API
    async getProjectDebts(projectId: string, filters?: {
        severity?: DebtSeverity[];
        type?: DebtType[];
        status?: DebtStatus[];
    }): Promise<DebtItem[]> {
        const params = new URLSearchParams();
        // 仅传递 file_path（后端当前仅支持），其余过滤在前端进行
        const raw: any = await (this.client as any).get(`/debts/project/${projectId}?${params.toString()}`);
        const mapStatusFromServer = (s: string): DebtStatus => {
            if (!s) return DebtStatus.OPEN;
            const v = String(s).toLowerCase();
            if (v === 'ignored') return DebtStatus.WONT_FIX;
            if (v === 'in_progress') return DebtStatus.IN_PROGRESS;
            if (v === 'resolved') return DebtStatus.RESOLVED;
            return DebtStatus.OPEN;
        };
        const mapSeverity = (s: string): DebtSeverity => {
            const v = String(s || '').toLowerCase();
            if (v === 'critical') return DebtSeverity.CRITICAL;
            if (v === 'high') return DebtSeverity.HIGH;
            if (v === 'medium') return DebtSeverity.MEDIUM;
            return DebtSeverity.LOW;
        };
        const parseMetadata = (value: any) => {
            if (!value) return undefined;
            if (typeof value === 'string') {
                try {
                    return JSON.parse(value);
                } catch (e) {
                    return undefined;
                }
            }
            return value as Record<string, any>;
        };
        return (Array.isArray(raw) ? raw : []).map((d: any): DebtItem => ({
            id: String(d.id),
            projectId: String(projectId),
            filePath: d.file_path ?? d.filePath ?? '',
            debtType: DebtType.CODE_SMELL,
            severity: mapSeverity(d.severity),
            description: d.message ?? d.description ?? '',
            estimatedEffort: 0,
            status: mapStatusFromServer(d.status),
            metadata: (() => {
                const metadata = parseMetadata(d.metadata ?? d.project_metadata);
                if (metadata && typeof metadata === 'object') {
                    if (!metadata.location && (d.line || metadata.line)) {
                        const lineValue = Number(metadata.line ?? d.line);
                        metadata.location = { line: Number.isFinite(lineValue) && lineValue > 0 ? lineValue : 1 };
                    }
                    return metadata;
                }
                const lineValue = Number(d.line);
                if (Number.isFinite(lineValue) && lineValue > 0) {
                    return { location: { line: lineValue } };
                }
                return undefined;
            })(),
            createdAt: d.created_at ?? '',
            updatedAt: d.updated_at ?? ''
        }));
    }

    async getDebtSummary(projectId: string): Promise<DebtSummary> {
        const raw: any = await (this.client as any).get(`/projects/${projectId}/debt-summary`);
        const bySeverityRaw = raw?.by_severity || raw?.bySeverity || {};
        const pick = (k: string) => Number(bySeverityRaw[k] || 0);
        return {
            totalDebts: Number(raw?.total ?? 0),
            bySeverity: {
                [DebtSeverity.LOW]: pick('low'),
                [DebtSeverity.MEDIUM]: pick('medium'),
                [DebtSeverity.HIGH]: pick('high'),
                [DebtSeverity.CRITICAL]: pick('critical'),
            },
            byType: {
                [DebtType.COMPLEXITY]: 0,
                [DebtType.DUPLICATION]: 0,
                [DebtType.CODE_SMELL]: 0,
                [DebtType.TODO]: 0,
                [DebtType.HOTSPOT]: 0,
            },
            totalEstimatedEffort: 0,
            averageDebtScore: 0,
        };
    }

    async updateDebtStatus(debtId: string, status: DebtStatus, comment?: string): Promise<DebtItem> {
        const toServerStatus = (s: DebtStatus) => s === DebtStatus.WONT_FIX ? 'ignored' : s;
        const res: any = await (this.client as any).put(`/debts/${debtId}`, { status: toServerStatus(status), comment });
        const mapStatusFromServer = (s: string): DebtStatus => {
            if (!s) return DebtStatus.OPEN;
            const v = String(s).toLowerCase();
            if (v === 'ignored') return DebtStatus.WONT_FIX;
            if (v === 'in_progress') return DebtStatus.IN_PROGRESS;
            if (v === 'resolved') return DebtStatus.RESOLVED;
            return DebtStatus.OPEN;
        };
        return {
            id: String(res.id),
            projectId: String(res.project_id ?? res.projectId ?? ''),
            filePath: res.file_path ?? res.filePath ?? '',
            debtType: DebtType.CODE_SMELL,
            severity: (String(res.severity || 'low').toLowerCase() as any) as DebtSeverity,
            description: res.message ?? res.description ?? '',
            estimatedEffort: 0,
            status: mapStatusFromServer(res.status),
            metadata: res.line ? { location: { line: Number(res.line) || 1 } } : undefined,
            createdAt: res.created_at ?? '',
            updatedAt: res.updated_at ?? ''
        };
    }

    // 获取指定文件的债务。后端路由为 GET /debts/project/{project_id}，通过 query param file_path 过滤。
    async getFileDebts(projectId: string, filePath: string): Promise<DebtItem[]> {
        const raw: any = await (this.client as any).get(`/debts/project/${projectId}`, { params: { file_path: filePath } });
        const parseMetadata = (value: any) => {
            if (!value) return undefined;
            if (typeof value === 'string') {
                try {
                    return JSON.parse(value);
                } catch (e) {
                    return undefined;
                }
            }
            return value as Record<string, any>;
        };
        return (Array.isArray(raw) ? raw : []).map((d: any): DebtItem => ({
            id: String(d.id),
            projectId: String(projectId),
            filePath: d.file_path ?? d.filePath ?? '',
            debtType: DebtType.CODE_SMELL,
            severity: (String(d.severity || 'low').toLowerCase() as any) as DebtSeverity,
            description: d.message ?? d.description ?? '',
            estimatedEffort: 0,
            status: (String(d.status || 'open').toLowerCase() === 'ignored') ? DebtStatus.WONT_FIX : (d.status as DebtStatus),
            metadata: (() => {
                const metadata = parseMetadata(d.metadata ?? d.project_metadata);
                if (metadata && typeof metadata === 'object') {
                    if (!metadata.location && (d.line || metadata.line)) {
                        const lineValue = Number(metadata.line ?? d.line);
                        metadata.location = { line: Number.isFinite(lineValue) && lineValue > 0 ? lineValue : 1 };
                    }
                    return metadata;
                }
                const lineValue = Number(d.line);
                if (Number.isFinite(lineValue) && lineValue > 0) {
                    return { location: { line: lineValue } };
                }
                return undefined;
            })(),
            createdAt: d.created_at ?? '',
            updatedAt: d.updated_at ?? ''
        }));
    }

    // 热点图数据
    async getHeatMapData(projectId: string): Promise<HeatMapData[]> {
        return this.client.get(`/projects/${projectId}/heatmap`);
    }

    // 健康检查
    async healthCheck(): Promise<boolean> {
        // 不是所有后端都会提供 /health 端点。尝试访问根路径 (/) 作为健康检查，
        // 若根路径不可用，再尝试获取 /projects 作为回退检查。
        try {
            await this.client.get('/');
            this.isOnline = true;
            return true;
        } catch (error) {
            try {
                await this.client.get('/projects');
                this.isOnline = true;
                return true;
            } catch (err) {
                this.isOnline = false;
                return false;
            }
        }
    }

    getOnlineStatus(): boolean {
        return this.isOnline;
    }
}