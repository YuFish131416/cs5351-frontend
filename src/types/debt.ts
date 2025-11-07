// src/types/debt.ts
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