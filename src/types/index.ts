// API 相关类型
export interface ApiResponse<T> {
    data: T;
    status: string;
    message?: string;
}

export interface PaginatedResponse<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
}

// 债务相关枚举
export enum DebtSeverity {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
    CRITICAL = 'critical'
}

export enum DebtType {
    COMPLEXITY = 'complexity',
    DUPLICATION = 'duplication',
    CODE_SMELL = 'code_smell',
    TODO = 'todo',
    HOTSPOT = 'hotspot'
}

export enum DebtStatus {
    OPEN = 'open',
    IN_PROGRESS = 'in_progress',
    RESOLVED = 'resolved',
    WONT_FIX = 'wont_fix'
}

// 核心数据模型
export interface DebtItem {
    id: string;
    projectId: string;
    filePath: string;
    debtType: DebtType;
    severity: DebtSeverity;
    description: string;
    estimatedEffort: number;
    status: DebtStatus;
    metadata?: Record<string, any>;
    createdAt: string;
    updatedAt: string;
}

export interface Project {
    id: string;
    name: string;
    description?: string;
    repoUrl?: string;
    localPath: string;
    language: string;
    createdAt: string;
    updatedAt: string;
}

export interface AnalysisResult {
    id: string;
    projectId: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    metrics: Record<string, any>;
    startedAt: string;
    completedAt?: string;
}

export interface HeatMapData {
    filePath: string;
    heatScore: number;
    changeCount: number;
    authorCount: number;
    lastModified: string;
    complexityScore: number;
}

export interface DebtSummary {
    totalDebts: number;
    bySeverity: Record<DebtSeverity, number>;
    byType: Record<DebtType, number>;
    totalEstimatedEffort: number;
    averageDebtScore: number;
}

// 配置相关类型
export interface ExtensionConfig {
    api: {
        baseUrl: string;
        timeout: number;
    };
    analysis: {
        autoAnalyzeOnSave: boolean;
        excludedPatterns: string[];
        maxFileSize: number;
        refreshInterval: number;
    };
    ui: {
        showStatusBar: boolean;
        decorationSeverity: DebtSeverity;
        heatmapEnabled: boolean;
    };
}

export interface WebviewMessage {
    type: string;
    payload?: any;
    id?: string;
}