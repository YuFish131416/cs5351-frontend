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
        return this.client.get('/projects');
    }

    async getProject(projectId: string): Promise<Project> {
        return this.client.get(`/projects/${projectId}`);
    }

    async createProject(projectData: Partial<Project>): Promise<Project> {
        return this.client.post('/projects', projectData);
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
        if (filters?.severity) {
            filters.severity.forEach(s => params.append('severity', s));
        }
        if (filters?.type) {
            filters.type.forEach(t => params.append('type', t));
        }
        if (filters?.status) {
            filters.status.forEach(s => params.append('status', s));
        }

        return this.client.get(`/debts/project/${projectId}?${params.toString()}`);
    }

    async getDebtSummary(projectId: string): Promise<DebtSummary> {
        return this.client.get(`/projects/${projectId}/debt-summary`);
    }

    async updateDebtStatus(debtId: string, status: DebtStatus, comment?: string): Promise<DebtItem> {
        return this.client.put(`/debts/${debtId}`, { status, comment });
    }

    // 获取指定文件的债务。后端路由为 GET /debts/project/{project_id}，通过 query param file_path 过滤。
    async getFileDebts(projectId: string, filePath: string): Promise<DebtItem[]> {
        return this.client.get(`/debts/project/${projectId}`, {
            params: { file_path: filePath }
        });
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