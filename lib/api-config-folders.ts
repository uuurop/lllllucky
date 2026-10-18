"use client";

// API 配置文件夹：这里不重起炉灶存一套，直接桥接到本仓库已有的 lib/api-folder-storage
// （设置 → API 设置里的文件夹就是用它），这样设置页建的文件夹在剧情绑定选择框里也能看到。

import { loadApiFolders } from "./api-folder-storage";
import type { ItemFolder } from "./item-folders";

export type ApiConfigFolder = ItemFolder;

/** 读设置页的 API 文件夹，转成通用 ItemFolder 形态（createdAt 用排序权重顶上，选择框只关心 id/name） */
export function loadApiConfigFolders(): ApiConfigFolder[] {
    return loadApiFolders().map((folder) => ({
        id: folder.id,
        name: folder.name,
        createdAt: folder.order,
    }));
}

/** 本仓库的 API 文件夹没有「最外层混排顺序」这一份存储，返回空即是默认顺序（文件夹在前） */
export function loadApiConfigRootOrder(): string[] {
    return [];
}
