// API 配置文件夹：把 API 设置页里的供应商卡片按文件夹分组收纳。
// 纯本地存储（kv-db），不参与任何云端同步语义之外的特殊逻辑。

import type { ApiFolder } from "./settings-types";
import { kvGet, kvSet, registerKvMigration } from "./kv-db";

const API_FOLDERS_KEY = "ai_phone_api_folders_v1";
registerKvMigration(API_FOLDERS_KEY);

export function loadApiFolders(): ApiFolder[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = kvGet(API_FOLDERS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as ApiFolder[];
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter(f => f && typeof f.id === "string" && typeof f.name === "string")
            .map((f, i) => ({ id: f.id, name: f.name, order: typeof f.order === "number" ? f.order : i }))
            .sort((a, b) => a.order - b.order);
    } catch {
        return [];
    }
}

export function saveApiFolders(folders: ApiFolder[]): void {
    if (typeof window === "undefined") return;
    const normalized = folders.map((f, i) => ({ id: f.id, name: f.name, order: i }));
    kvSet(API_FOLDERS_KEY, JSON.stringify(normalized));
}

export function createApiFolder(name: string): ApiFolder {
    const folders = loadApiFolders();
    const folder: ApiFolder = {
        id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim() || "新建文件夹",
        order: folders.length,
    };
    saveApiFolders([...folders, folder]);
    return folder;
}

export function renameApiFolder(id: string, name: string): void {
    saveApiFolders(loadApiFolders().map(f => (f.id === id ? { ...f, name: name.trim() || f.name } : f)));
}

export function deleteApiFolder(id: string): void {
    saveApiFolders(loadApiFolders().filter(f => f.id !== id));
}
