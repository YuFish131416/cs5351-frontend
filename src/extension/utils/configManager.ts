import * as vscode from 'vscode';
import { ExtensionConfig, DebtSeverity } from '../../types';

export class ConfigManager {
    private static instance: ConfigManager;
    private config: vscode.WorkspaceConfiguration;

    private constructor() {
        this.config = vscode.workspace.getConfiguration('technicalDebt');
    }

    static getInstance(): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }

    getConfig(): ExtensionConfig {
        return {
            api: {
                baseUrl: this.config.get<string>('api.baseUrl') || 'http://localhost:8000/api/v1',
                timeout: this.config.get<number>('api.timeout') || 30000
            },
            analysis: {
                autoAnalyzeOnSave: this.config.get<boolean>('analysis.autoAnalyzeOnSave') || false,
                excludedPatterns: this.config.get<string[]>('analysis.excludedPatterns') || ['**/node_modules/**', '**/dist/**'],
                maxFileSize: this.config.get<number>('analysis.maxFileSize') || 1024 * 1024
            },
            ui: {
                showStatusBar: this.config.get<boolean>('ui.showStatusBar') || true,
                decorationSeverity: this.config.get<DebtSeverity>('ui.decorationSeverity') || DebtSeverity.MEDIUM,
                heatmapEnabled: this.config.get<boolean>('ui.heatmapEnabled') || true
            }
        };
    }

    async updateConfig(section: string, value: any): Promise<void> {
        await this.config.update(section, value, vscode.ConfigurationTarget.Global);
        this.config = vscode.workspace.getConfiguration('technicalDebt');
    }

    onConfigChange(callback: () => void): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('technicalDebt')) {
                this.config = vscode.workspace.getConfiguration('technicalDebt');
                callback();
            }
        });
    }
}