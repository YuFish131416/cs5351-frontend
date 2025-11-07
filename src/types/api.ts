// src/types/api.ts
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