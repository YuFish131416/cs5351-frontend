// src/types/extension.ts
import {DebtSeverity} from "./debt";

export interface ExtensionConfig {
    api: {
        baseUrl: string;
        timeout: number;
    };
    analysis: {
        autoAnalyzeOnSave: boolean;
        excludedPatterns: string[];
        maxFileSize: number;
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