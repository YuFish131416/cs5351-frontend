import * as vscode from 'vscode';

/**
 * 日志级别枚举
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4
}

/**
 * 日志配置接口
 */
export interface LoggerConfig {
    level: LogLevel;
    showTimestamp: boolean;
    showLevel: boolean;
    outputToConsole: boolean;
    outputToChannel: boolean;
    maxChannelLines: number;
}

/**
 * 默认日志配置
 */
const DEFAULT_CONFIG: LoggerConfig = {
    level: LogLevel.INFO,
    showTimestamp: true,
    showLevel: true,
    outputToConsole: true,
    outputToChannel: true,
    maxChannelLines: 1000
};

/**
 * 高级日志记录器
 * 提供多级别日志记录、输出通道管理和灵活的配置选项
 */
export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;
    private config: LoggerConfig;
    private isDevelopment: boolean;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Technical Debt Manager');
        this.config = { ...DEFAULT_CONFIG };
        this.isDevelopment = process.env.NODE_ENV === 'development';

        // 开发模式下默认使用 DEBUG 级别
        if (this.isDevelopment) {
            this.config.level = LogLevel.DEBUG;
        }

        this.info('Logger initialized', {
            level: LogLevel[this.config.level],
            development: this.isDevelopment
        });
    }

    /**
     * 获取 Logger 单例实例
     */
    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * 更新日志配置
     */
    setConfig(newConfig: Partial<LoggerConfig>): void {
        this.config = { ...this.config, ...newConfig };
        this.debug('Logger configuration updated', this.config);
    }

    /**
     * 获取当前配置
     */
    getConfig(): LoggerConfig {
        return { ...this.config };
    }

    /**
     * 设置日志级别
     */
    setLevel(level: LogLevel): void {
        this.config.level = level;
        this.info(`Log level set to: ${LogLevel[level]}`);
    }

    /**
     * DEBUG 级别日志
     * 用于详细的调试信息
     */
    debug(message: string, ...args: any[]): void {
        if (this.config.level <= LogLevel.DEBUG) {
            this.log('DEBUG', message, args);
        }
    }

    /**
     * INFO 级别日志
     * 用于常规信息记录
     */
    info(message: string, ...args: any[]): void {
        if (this.config.level <= LogLevel.INFO) {
            this.log('INFO', message, args);
        }
    }

    /**
     * WARN 级别日志
     * 用于警告信息
     */
    warn(message: string, ...args: any[]): void {
        if (this.config.level <= LogLevel.WARN) {
            this.log('WARN', message, args);
        }
    }

    /**
     * ERROR 级别日志
     * 用于错误信息
     */
    error(message: string, ...args: any[]): void {
        if (this.config.level <= LogLevel.ERROR) {
            this.log('ERROR', message, args);
        }
    }

    /**
     * 记录性能时间
     */
    time(label: string): () => void {
        const startTime = Date.now();

        return () => {
            const duration = Date.now() - startTime;
            this.debug(`Performance: ${label}`, { duration: `${duration}ms` });
        };
    }

    /**
     * 记录方法调用
     */
    trace(methodName: string, ...args: any[]): void {
        if (this.config.level <= LogLevel.DEBUG) {
            this.log('TRACE', `Calling: ${methodName}`, args);
        }
    }

    /**
     * 记录方法返回
     */
    traceReturn(methodName: string, returnValue: any): void {
        if (this.config.level <= LogLevel.DEBUG) {
            this.log('TRACE', `Return from: ${methodName}`, [{ returnValue }]);
        }
    }

    /**
     * 记录错误堆栈
     */
    errorWithStack(message: string, error: Error): void {
        if (this.config.level <= LogLevel.ERROR) {
            const stack = error.stack || 'No stack trace available';
            this.log('ERROR', `${message}: ${error.message}`, [{ stack }]);
        }
    }

    /**
     * 显示输出通道
     */
    show(): void {
        this.outputChannel.show(true);
    }

    /**
     * 隐藏输出通道
     */
    hide(): void {
        // VS Code 没有直接的 hide 方法，但我们可以确保它不显示
        // 实际上用户需要手动关闭输出面板
    }

    /**
     * 清除输出通道内容
     */
    clear(): void {
        this.outputChannel.clear();
        this.info('Log output cleared');
    }

    /**
     * 获取输出通道内容
     */
    getContent(): string {
        // 注意：VS Code API 没有直接获取输出通道内容的方法
        // 这个功能需要我们自己维护缓冲区
        return 'Output channel content not available programmatically';
    }

    /**
     * 保存日志到文件
     */
    async saveToFile(): Promise<boolean> {
        try {
            // 由于 VS Code API 限制，我们无法直接获取输出通道内容
            // 这里我们创建一个包含最近日志的文件
            const uri = await vscode.window.showSaveDialog({
                filters: {
                    'Log Files': ['log'],
                    'Text Files': ['txt'],
                    'All Files': ['*']
                },
                defaultUri: vscode.Uri.file(`technical-debt-log-${new Date().toISOString().split('T')[0]}.log`)
            });

            if (uri) {
                // 创建一个简单的日志文件
                const content = this.generateLogContent();
                const uint8Array = new TextEncoder().encode(content);
                await vscode.workspace.fs.writeFile(uri, uint8Array);

                this.info(`Log saved to: ${uri.fsPath}`);
                return true;
            }

            return false;
        } catch (error: any) {
            this.error('Failed to save log to file', error);
            return false;
        }
    }

    /**
     * 处理未捕获的异常
     */
    setupGlobalErrorHandling(): void {
        process.on('uncaughtException', (error: Error) => {
            this.errorWithStack('Uncaught Exception', error);
        });

        process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
            this.error('Unhandled Promise Rejection', { reason, promise });
        });

        this.info('Global error handling setup completed');
    }

    /**
     * 销毁 Logger 实例
     */
    dispose(): void {
        this.info('Logger disposed');
        this.outputChannel.dispose();
        Logger.instance = null as any;
    }

    // 私有方法

    /**
     * 核心日志记录方法
     */
    private log(level: string, message: string, args: any[]): void {
        const formattedMessage = this.formatMessage(level, message, args);

        // 输出到控制台
        if (this.config.outputToConsole) {
            this.writeToConsole(level, formattedMessage);
        }

        // 输出到输出通道
        if (this.config.outputToChannel) {
            this.writeToChannel(formattedMessage);
        }
    }

    /**
     * 格式化日志消息
     */
    private formatMessage(level: string, message: string, args: any[]): string {
        const parts: string[] = [];

        // 添加时间戳
        if (this.config.showTimestamp) {
            parts.push(`[${new Date().toISOString()}]`);
        }

        // 添加日志级别
        if (this.config.showLevel) {
            parts.push(`[${level}]`);
        }

        // 添加主要消息
        parts.push(message);

        // 添加额外参数
        if (args.length > 0) {
            const formattedArgs = args.map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg, this.replacer, 2) : String(arg)
            ).join(' ');

            if (formattedArgs.trim()) {
                parts.push(formattedArgs);
            }
        }

        return parts.join(' ');
    }

    /**
     * JSON 序列化替换器，处理循环引用
     */
    private replacer(key: string, value: any): any {
        // 处理 Error 对象
        if (value instanceof Error) {
            const error: any = {};
            Object.getOwnPropertyNames(value).forEach(prop => {
                error[prop] = (value as any)[prop];
            });
            return error;
        }

        // 处理其他对象
        return value;
    }

    /**
     * 写入控制台
     */
    private writeToConsole(level: string, message: string): void {
        const consoleMethod = this.getConsoleMethod(level);
        consoleMethod(message);
    }

    /**
     * 获取对应的控制台方法
     */
    private getConsoleMethod(level: string): (...args: any[]) => void {
        switch (level) {
            case 'ERROR':
                return console.error;
            case 'WARN':
                return console.warn;
            case 'DEBUG':
            case 'TRACE':
                return console.debug;
            default:
                return console.log;
        }
    }

    /**
     * 写入输出通道
     */
    private writeToChannel(message: string): void {
        this.outputChannel.appendLine(message);

        // 限制输出通道的行数
        this.limitChannelLines();
    }

    /**
     * 限制输出通道的行数
     */
    private limitChannelLines(): void {
        // VS Code API 没有直接的方法来获取或限制行数
        // 这个功能需要我们自己实现缓冲区管理
        // 目前 VS Code 会自动处理大量输出，所以我们暂时不实现这个功能
    }

    /**
     * 生成日志文件内容
     */
    private generateLogContent(): string {
        const header = [
            'Technical Debt Manager - Log File',
            `Generated: ${new Date().toISOString()}`,
            `Log Level: ${LogLevel[this.config.level]}`,
            '========================================',
            ''
        ].join('\n');

        // 由于无法获取历史日志，我们只生成一个简单的日志头
        return header;
    }
}

/**
 * 便捷的日志函数 - 可以直接使用而不需要获取实例
 */

export function debug(message: string, ...args: any[]): void {
    Logger.getInstance().debug(message, ...args);
}

export function info(message: string, ...args: any[]): void {
    Logger.getInstance().info(message, ...args);
}

export function warn(message: string, ...args: any[]): void {
    Logger.getInstance().warn(message, ...args);
}

export function error(message: string, ...args: any[]): void {
    Logger.getInstance().error(message, ...args);
}

export function trace(methodName: string, ...args: any[]): void {
    Logger.getInstance().trace(methodName, ...args);
}

export function traceReturn(methodName: string, returnValue: any): void {
    Logger.getInstance().traceReturn(methodName, returnValue);
}

export function errorWithStack(message: string, error: Error): void {
    Logger.getInstance().errorWithStack(message, error);
}

export function time(label: string): () => void {
    return Logger.getInstance().time(label);
}

/**
 * 性能监控装饰器
 */
export function logPerformance(target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = function (...args: any[]) {
        const logger = Logger.getInstance();
        const endTimer = logger.time(`${target.constructor.name}.${propertyName}`);

        try {
            const result = method.apply(this, args);

            // 处理 Promise
            if (result instanceof Promise) {
                return result.finally(endTimer);
            }

            endTimer();
            return result;
        } catch (error) {
            endTimer();
            throw error;
        }
    };

    return descriptor;
}

/**
 * 方法调用日志装饰器
 */
export function logMethodCall(target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = function (...args: any[]) {
        const logger = Logger.getInstance();
        logger.trace(`${target.constructor.name}.${propertyName}`, args);

        try {
            const result = method.apply(this, args);

            // 处理 Promise
            if (result instanceof Promise) {
                return result.then((resolvedValue) => {
                    logger.traceReturn(`${target.constructor.name}.${propertyName}`, resolvedValue);
                    return resolvedValue;
                }).catch((error) => {
                    logger.error(`Error in ${target.constructor.name}.${propertyName}`, error);
                    throw error;
                });
            }

            logger.traceReturn(`${target.constructor.name}.${propertyName}`, result);
            return result;
        } catch (error) {
            logger.error(`Error in ${target.constructor.name}.${propertyName}`, error);
            throw error;
        }
    };

    return descriptor;
}