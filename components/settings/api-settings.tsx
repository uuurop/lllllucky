"use client";

import { useState, useEffect, useCallback, useContext } from "react";
import { Plus, RefreshCw, Rss, AlertCircle, FileEdit, Trash2, X, Check, FolderPlus, ChevronDown, ChevronRight, Pencil, Wallet, Globe, KeyRound } from "lucide-react";
import { SettingsContext } from "../phone-settings-app";
import type { ApiConfig, ApiFolder } from "@/lib/settings-types";
import { loadApiConfigs, removeApiConfigReferences, saveApiConfigs } from "@/lib/settings-storage";
import { loadApiFolders, createApiFolder, renameApiFolder, deleteApiFolder } from "@/lib/api-folder-storage";
import { loadSiteAccounts, saveSiteAccounts, querySiteBalance, type SiteAccount, type SiteBalanceResult } from "@/lib/site-balance-storage";
import { generateEmbedding, isEmbeddingModelName } from "@/lib/memory-embedding";
import { ConfirmDialog } from "@/components/ui/modal";
import { Toggle, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/feedback";
import { determineBaseUrl, simpleLLMCall } from "@/lib/api-helpers";

const DEFAULT_CONFIGS: ApiConfig[] = [
    {
        id: "default-openai",
        name: "OpenAI 官方",
        provider: "OpenAI",
        apiKey: "",
        defaultModel: "gpt-4o",
        enableNativeTools: true,
        enableImageRecognition: true,
        enableImageGeneration: true,
        preventEmptyGenerateRambling: true,
    }
];

function getNativeToolProtocolLabel(config: ApiConfig): string {
    if (config.provider === "Anthropic" && !config.baseUrl) return "Anthropic";
    if (config.provider === "Google") return "Gemini";
    return "OpenAI-compatible";
}

function formatUsd(value: number | null | undefined): string {
    if (value === null || value === undefined || isNaN(value)) return "—";
    return `$${value.toFixed(2)}`;
}

export function ApiSettings() {
    const { setSubpageRightAction } = useContext(SettingsContext);
    const [configs, setConfigs] = useState<ApiConfig[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isNewConfig, setIsNewConfig] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);

    // Testing and Fetching states
    const [isFetching, setIsFetching] = useState<Record<string, boolean>>({});
    const [fetchedModels, setFetchedModels] = useState<Record<string, string[]>>({});
    const [isTesting, setIsTesting] = useState<Record<string, boolean>>({});
    const [testResult, setTestResult] = useState<Record<string, { success: boolean; message: string }>>({});

    // ── 文件夹分类 ──
    const [folders, setFolders] = useState<ApiFolder[]>([]);
    const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
    const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
    const [renamingFolderName, setRenamingFolderName] = useState("");
    const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null);

    // ── 站点余额面板 ──
    const [siteAccounts, setSiteAccounts] = useState<SiteAccount[]>([]);
    const [editingSite, setEditingSite] = useState<SiteAccount | null>(null);
    const [isSiteModalOpen, setIsSiteModalOpen] = useState(false);
    const [confirmDeleteSiteId, setConfirmDeleteSiteId] = useState<string | null>(null);
    const [balances, setBalances] = useState<Record<string, SiteBalanceResult>>({});
    const [queryingSites, setQueryingSites] = useState<Record<string, boolean>>({});

    // Load from localStorage on mount
    useEffect(() => {
        const loaded = loadApiConfigs();
        if (loaded.length > 0) {
            setConfigs(loaded);
        } else {
            setConfigs(DEFAULT_CONFIGS);
            saveApiConfigs(DEFAULT_CONFIGS);
        }
        setFolders(loadApiFolders());
        setSiteAccounts(loadSiteAccounts());
        setIsLoaded(true);
    }, []);

    const persist = useCallback((newConfigs: ApiConfig[]) => {
        setConfigs(newConfigs);
        saveApiConfigs(newConfigs);
    }, []);

    const persistSites = useCallback((newSites: SiteAccount[]) => {
        setSiteAccounts(newSites);
        saveSiteAccounts(newSites);
    }, []);

    const addConfig = useCallback(() => {
        const newConfig: ApiConfig = {
            id: `config-${Date.now()}`,
            name: "新配置",
            provider: "Custom",
            apiKey: "",
            defaultModel: "",
            enableNativeTools: true,
            enableImageRecognition: false,
            enableImageGeneration: false,
            preventEmptyGenerateRambling: true,
        };
        persist([...configs, newConfig]);
        setIsNewConfig(true);
        setEditingId(newConfig.id);
    }, [configs, persist]);

    useEffect(() => {
        setSubpageRightAction("api",
            <button
                onClick={addConfig}
                className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-[20px] bg-black px-4 text-xs font-bold text-white shadow-sm transition-all hover:bg-gray-800 hover:shadow-md active:scale-95 focus:outline-none"
            >
                <Plus size={15} strokeWidth={1.8} />
                <span>新增API方案</span>
            </button>
        );
        return () => setSubpageRightAction("api", null);
    }, [addConfig, setSubpageRightAction]);

    const updateConfig = (id: string, updates: Partial<ApiConfig>) => {
        persist(configs.map(c => c.id === id ? { ...c, ...updates } : c));
    };

    const removeConfig = (id: string) => {
        persist(configs.filter(c => c.id !== id));
        removeApiConfigReferences(id);
        const newFetchedModels = { ...fetchedModels };
        delete newFetchedModels[id];
        setFetchedModels(newFetchedModels);

        const newTestResults = { ...testResult };
        delete newTestResults[id];
        setTestResult(newTestResults);
    };

    // ── 文件夹操作 ──
    const handleCreateFolder = () => {
        const folder = createApiFolder(`新建文件夹 ${folders.length + 1}`);
        setFolders(loadApiFolders());
        // 创建后立刻进入重命名，省一步
        setRenamingFolderId(folder.id);
        setRenamingFolderName(folder.name);
    };

    const handleRenameFolder = () => {
        if (!renamingFolderId) return;
        renameApiFolder(renamingFolderId, renamingFolderName);
        setFolders(loadApiFolders());
        setRenamingFolderId(null);
    };

    const handleDeleteFolder = (id: string) => {
        // 删除文件夹不删配置：里面的配置回到「未分类」
        persist(configs.map(c => (c.folderId === id ? { ...c, folderId: undefined } : c)));
        deleteApiFolder(id);
        setFolders(loadApiFolders());
    };

    const toggleFolderCollapsed = (id: string) => {
        setCollapsedFolders(prev => ({ ...prev, [id]: !prev[id] }));
    };

    // ── 站点余额操作 ──
    const handleQueryBalance = async (site: SiteAccount) => {
        setQueryingSites(prev => ({ ...prev, [site.id]: true }));
        const result = await querySiteBalance(site);
        setBalances(prev => ({ ...prev, [site.id]: result }));
        setQueryingSites(prev => ({ ...prev, [site.id]: false }));
    };

    const handleSaveSite = () => {
        if (!editingSite) return;
        const trimmed: SiteAccount = {
            ...editingSite,
            name: editingSite.name.trim(),
            siteUrl: editingSite.siteUrl.trim(),
            username: editingSite.username.trim(),
        };
        if (!trimmed.siteUrl) return;
        const exists = siteAccounts.some(s => s.id === trimmed.id);
        persistSites(exists
            ? siteAccounts.map(s => (s.id === trimmed.id ? trimmed : s))
            : [...siteAccounts, trimmed]);
        setIsSiteModalOpen(false);
        // 保存后自动查一次余额
        void handleQueryBalance(trimmed);
        setEditingSite(null);
    };

    const openAddSite = () => {
        setEditingSite({
            id: `site-${Date.now()}`,
            name: "",
            siteUrl: "",
            username: "",
            password: "",
        });
        setIsSiteModalOpen(true);
    };

    // Use unified determineBaseUrl from api-helpers

    const fetchModels = async (config: ApiConfig) => {
        setIsFetching(prev => ({ ...prev, [config.id]: true }));
        setTestResult(prev => ({ ...prev, [config.id]: { success: false, message: "" } }));

        try {
            const baseUrl = determineBaseUrl(config);
            if (!baseUrl) throw new Error("缺少 Base URL");
            if (!config.apiKey) throw new Error("缺少 API Key");

            // Gemini 原生协议（/v1beta）：URL 用 ?key= 鉴权，响应是 { models: [{ name }] }
            // OpenAI 兼容（/v1）：Authorization: Bearer + 响应是 { data: [{ id }] }
            const isGoogleNative = config.provider === "Google";
            // 用户常把完整端点填进 Base URL（如 .../v1/embeddings、.../v1/chat/completions），
            // 拼 /models 前剥掉这类端点后缀；已以 /models 结尾则原样使用。
            const modelsBase = baseUrl
                .replace(/\/$/, "")
                .replace(/\/(chat\/completions|completions|embeddings|messages)$/i, "");
            const modelsUrl = /\/models$/i.test(modelsBase) ? modelsBase : `${modelsBase}/models`;
            const url = isGoogleNative
                ? `${modelsUrl}?key=${encodeURIComponent(config.apiKey)}`
                : modelsUrl;
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (!isGoogleNative) headers["Authorization"] = `Bearer ${config.apiKey}`;

            const response = await fetch(url, { method: "GET", headers });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            let modelNames: string[] = [];
            if (isGoogleNative && Array.isArray(data?.models)) {
                // Gemini 原生：name 可能是 "models/gemini-2.5-pro" 或纯名字
                modelNames = data.models.map((m: { name: string }) => (m.name || "").replace(/^models\//, ""));
            } else if (Array.isArray(data?.data)) {
                modelNames = data.data.map((m: { id: string }) => m.id);
            } else {
                throw new Error("返回数据格式不符合预期");
            }
            setFetchedModels(prev => ({ ...prev, [config.id]: modelNames }));
            setTestResult(prev => ({ ...prev, [config.id]: { success: true, message: `成功获取 ${modelNames.length} 个模型` } }));
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            setTestResult(prev => ({ ...prev, [config.id]: { success: false, message: `拉取失败: ${msg}` } }));
            setFetchedModels(prev => ({ ...prev, [config.id]: [] }));
        } finally {
            setIsFetching(prev => ({ ...prev, [config.id]: false }));
        }
    };

    const testConnection = async (config: ApiConfig) => {
        if (!config.defaultModel) {
            setTestResult(prev => ({ ...prev, [config.id]: { success: false, message: "请先输入或选择默认模型" } }));
            return;
        }

        setIsTesting(prev => ({ ...prev, [config.id]: true }));
        setTestResult(prev => ({ ...prev, [config.id]: { success: false, message: "" } }));

        try {
            // 向量模型配置：测 /embeddings 端点。原来一律测 /chat/completions，
            // 导致 embedding 配置永远 404「测试失败」。
            if (isEmbeddingModelName(config.defaultModel)) {
                const embedding = await generateEmbedding("你好", config, { throwOnError: true });
                if (!embedding) throw new Error("接口未返回向量数据");
                setTestResult(prev => ({
                    ...prev,
                    [config.id]: { success: true, message: `测试成功! 向量模型可用，维度 ${embedding.length}` },
                }));
                return;
            }
            const result = await simpleLLMCall(
                config,
                [{ role: "user", content: "你好" }],
                // Cap (not spend): reasoning models (deepseek-reasoner / gemini-pro 等) burn
                // tokens on hidden reasoning first, so a tiny cap leaves the visible
                // content empty and the test falsely fails (finishReason=length).
                // 4096 covers heavy thinkers; a "你好" reply still stops well before it.
                { temperature: 0.2, max_tokens: 4096 },
            );
            if (result.error || !result.content) {
                throw new Error(result.error || "模型返回了空内容");
            }
            const reply = result.content.replace(/\s+/g, " ").trim();
            const preview = reply.length > 80 ? `${reply.slice(0, 80)}...` : reply;
            setTestResult(prev => ({
                ...prev,
                [config.id]: { success: true, message: `测试成功! 模型回复: ${preview}` },
            }));
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            setTestResult(prev => ({ ...prev, [config.id]: { success: false, message: `测试失败: ${msg}` } }));
        } finally {
            setIsTesting(prev => ({ ...prev, [config.id]: false }));
        }
    };

    if (!isLoaded) return null;

    /** 单个配置卡片（原样保留原来的卡片结构与交互）。 */
    const renderConfigCard = (config: ApiConfig) => (
        <div
            key={config.id}
            className="ui-config-card min-w-0 cursor-pointer"
            style={{ aspectRatio: "3 / 2", padding: "12px", justifyContent: "space-between" }}
            role="button"
            tabIndex={0}
            aria-label={`编辑 ${config.name || config.provider}`}
            onClick={() => setEditingId(config.id)}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setEditingId(config.id);
                }
            }}
        >
            <div className="min-w-0 flex flex-col gap-1">
                <span className="truncate text-[calc(14.4px*var(--app-text-scale,1))] font-bold leading-tight text-[var(--c-text-title)]">{config.name || config.provider}</span>
                <span className="menu-desc truncate">{config.defaultModel || config.provider || "未设置模型"}</span>
            </div>
            <div className="flex gap-2 shrink-0 items-center justify-end">
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        setEditingId(config.id);
                    }}
                    className="ui-link-btn"
                >
                    <FileEdit size={18} />
                </button>
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        setConfirmDeleteId(config.id);
                    }}
                    className="ui-link-btn"
                    data-variant="danger"
                >
                    <Trash2 size={18} />
                </button>
            </div>
        </div>
    );

    /** 文件夹分组渲染：有文件夹时按组展示，没有则退回原来的平面网格。 */
    const renderConfigGroups = () => {
        if (folders.length === 0) {
            return (
                <div className="grid grid-cols-2 gap-3">
                    {configs.map(renderConfigCard)}
                </div>
            );
        }
        const uncategorized = configs.filter(c => !c.folderId || !folders.some(f => f.id === c.folderId));
        return (
            <div className="flex flex-col gap-4">
                {folders.map(folder => {
                    const folderConfigs = configs.filter(c => c.folderId === folder.id);
                    const collapsed = collapsedFolders[folder.id] === true;
                    return (
                        <div key={folder.id} className="flex flex-col gap-2">
                            <div className="flex items-center gap-2 px-1">
                                <button
                                    type="button"
                                    onClick={() => toggleFolderCollapsed(folder.id)}
                                    className="flex flex-1 items-center gap-1.5 min-w-0 text-left"
                                >
                                    {collapsed ? <ChevronRight size={16} className="shrink-0 text-[var(--c-icon)]" /> : <ChevronDown size={16} className="shrink-0 text-[var(--c-icon)]" />}
                                    <span className="menu-label font-semibold truncate">{folder.name}</span>
                                    <span className="menu-desc shrink-0">{folderConfigs.length}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setRenamingFolderId(folder.id); setRenamingFolderName(folder.name); }}
                                    className="ui-link-btn"
                                    aria-label={`重命名 ${folder.name}`}
                                >
                                    <Pencil size={15} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfirmDeleteFolderId(folder.id)}
                                    className="ui-link-btn"
                                    data-variant="danger"
                                    aria-label={`删除文件夹 ${folder.name}`}
                                >
                                    <Trash2 size={15} />
                                </button>
                            </div>
                            {!collapsed && (
                                folderConfigs.length > 0 ? (
                                    <div className="grid grid-cols-2 gap-3">
                                        {folderConfigs.map(renderConfigCard)}
                                    </div>
                                ) : (
                                    <span className="menu-desc px-1">空文件夹——编辑配置时可以把它归到这里。</span>
                                )
                            )}
                        </div>
                    );
                })}
                {uncategorized.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <span className="menu-label font-semibold px-1">未分类</span>
                        <div className="grid grid-cols-2 gap-3">
                            {uncategorized.map(renderConfigCard)}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <h2 className="m-0 mx-2 ts-28 font-bold italic leading-none text-black">API Settings</h2>
                <button
                    type="button"
                    onClick={handleCreateFolder}
                    className="ui-btn ui-btn-ghost inline-flex items-center gap-1 whitespace-nowrap"
                >
                    <FolderPlus size={15} />
                    <span>新建文件夹</span>
                </button>
            </div>

            {configs.length === 0 ? (
                <div className="ui-empty">
                    <div className="ui-icon-circle">
                        <AlertCircle size={24} />
                    </div>
                    <span className="menu-label font-semibold">没有 API 配置</span>
                    <span className="menu-desc max-w-[240px]">
                        配置 API 密钥和模型以连接到 AI 服务。
                    </span>
                    <button onClick={addConfig} className="ui-btn ui-btn-primary rounded-[20px] mt-2">
                        <Plus size={16} /> 添加配置
                    </button>
                </div>
            ) : (
                renderConfigGroups()
            )}

            {/* ── 站点余额面板 ── */}
            <div className="flex flex-col gap-3 mt-2">
                <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                        <Wallet size={17} className="text-[var(--c-icon)]" />
                        <span className="menu-label font-semibold">站点余额</span>
                    </div>
                    <button
                        type="button"
                        onClick={openAddSite}
                        className="ui-btn ui-btn-ghost inline-flex items-center gap-1 whitespace-nowrap"
                    >
                        <Plus size={15} />
                        <span>添加站点</span>
                    </button>
                </div>
                {siteAccounts.length === 0 ? (
                    <span className="menu-desc px-1">
                        把中转站的网址和账密存进来，一键查看各站余额（支持 new-api / one-api 体系的站点）。账密只保存在本机。
                    </span>
                ) : (
                    <div className="flex flex-col gap-2">
                        {siteAccounts.map(site => {
                            const result = balances[site.id];
                            const querying = queryingSites[site.id] === true;
                            return (
                                <div key={site.id} className="menu-item" style={{ cursor: "default" }}>
                                    <div className="menu-label-group min-w-0">
                                        <span className="menu-label truncate">{site.name || site.siteUrl}</span>
                                        <span className="menu-desc truncate">
                                            <Globe size={11} className="inline-block mr-1 -mt-[1px]" />
                                            {site.siteUrl}
                                        </span>
                                        {result && (
                                            result.ok ? (
                                                <span className="menu-desc">
                                                    余额 <b className="text-[var(--c-text-title)]">{formatUsd(result.balanceUsd)}</b>
                                                    {result.usedUsd !== null && <> · 已用 {formatUsd(result.usedUsd)}</>}
                                                </span>
                                            ) : (
                                                <span className="menu-desc" style={{ color: "var(--c-danger, #e5484d)" }}>{result.error}</span>
                                            )
                                        )}
                                    </div>
                                    <div className="menu-right flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => void handleQueryBalance(site)}
                                            disabled={querying}
                                            className="ui-link-btn"
                                            aria-label={`查询 ${site.name || site.siteUrl} 余额`}
                                        >
                                            <RefreshCw size={16} className={querying ? "animate-spin" : ""} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => { setEditingSite(site); setIsSiteModalOpen(true); }}
                                            className="ui-link-btn"
                                            aria-label={`编辑站点 ${site.name || site.siteUrl}`}
                                        >
                                            <FileEdit size={16} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setConfirmDeleteSiteId(site.id)}
                                            className="ui-link-btn"
                                            data-variant="danger"
                                            aria-label={`删除站点 ${site.name || site.siteUrl}`}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {editingId && (
                <div className="modal-overlay modal-overlay-bottom">
                    <div className="modal-sheet" data-ui="modal-sheet">
                        <div className="modal-header" data-ui="modal-header">
                            <button onClick={() => { if (isNewConfig && editingId) removeConfig(editingId); setIsNewConfig(false); setEditingId(null); }} className="modal-header-btn modal-header-btn-muted"><X size={18} /></button>
                            <span className="modal-header-title">{isNewConfig ? "添加配置" : "编辑配置"}</span>
                            <button onClick={() => { setIsNewConfig(false); setEditingId(null); }} className="modal-header-btn modal-header-btn-action"><Check size={18} /></button>
                        </div>

                        <div className="modal-body hide-scrollbar flex flex-col gap-4 pb-10" data-ui="modal-body">
                            {(() => {
                                const config = configs.find(c => c.id === editingId);
                                if (!config) return null;
                                return (
                                    <>
                                        <div className="flex flex-col gap-1">
                                            <label className="menu-desc ml-1">配置名称 (Name)</label>
                                            <Input
                                                type="text"
                                                value={config.name || ""}
                                                onChange={(e) => updateConfig(config.id, { name: e.target.value })}
                                                placeholder="例如: 我的 OpenAI"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <label className="menu-desc ml-1">服务商 (Provider)</label>
                                            <select
                                                value={config.provider}
                                                onChange={(e) => updateConfig(config.id, { provider: e.target.value })}
                                                className="ui-select"
                                            >
                                                <option value="OpenAI">OpenAI</option>
                                                <option value="Anthropic">Anthropic</option>
                                                <option value="Google">Google Gemini</option>
                                                <option value="DeepSeek">DeepSeek</option>
                                                <option value="Groq">Groq</option>
                                                <option value="OpenRouter">OpenRouter</option>
                                                <option value="Moonshot">Kimi (Moonshot)</option>
                                                <option value="Zhipu">Zhipu (GLM)</option>
                                                <option value="SiliconFlow">SiliconFlow</option>
                                                <option value="TogetherAI">Together AI</option>
                                                <option value="Custom">自定义 (Custom)</option>
                                            </select>
                                        </div>

                                        {folders.length > 0 && (
                                            <div className="flex flex-col gap-1">
                                                <label className="menu-desc ml-1">所属文件夹</label>
                                                <select
                                                    value={config.folderId || ""}
                                                    onChange={(e) => updateConfig(config.id, { folderId: e.target.value || undefined })}
                                                    className="ui-select"
                                                >
                                                    <option value="">未分类</option>
                                                    {folders.map(f => (
                                                        <option key={f.id} value={f.id}>{f.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {/* Custom 必填 Base URL；其他 provider 可选填中转站地址 */}
                                        <div className="flex flex-col gap-1">
                                            <label className="menu-desc ml-1">
                                                Base URL {config.provider === "Custom" ? "（必填）" : "（可选，留空用官方端点）"}
                                                {config.provider === "Google" && (
                                                    <span style={{ color: "#888", marginLeft: 6, fontSize: "0.85em" }}>
                                                        中转站填 https://xxx/v1beta 走原生协议
                                                    </span>
                                                )}
                                            </label>
                                            <Input
                                                type="url"
                                                value={config.baseUrl || ""}
                                                onChange={(e) => updateConfig(config.id, { baseUrl: e.target.value })}
                                                placeholder={
                                                    config.provider === "Custom"
                                                        ? "https://api.example.com/v1"
                                                        : config.provider === "Google"
                                                            ? "https://your-proxy.example.com/v1beta"
                                                            : "默认用官方端点，留空即可"
                                                }
                                            />
                                        </div>

                                        <div className="flex flex-col gap-1">
                                            <label className="menu-desc ml-1">API Key</label>
                                            <Input
                                                type="password"
                                                value={config.apiKey}
                                                onChange={(e) => updateConfig(config.id, { apiKey: e.target.value })}
                                                placeholder="sk-..."
                                            />
                                        </div>

                                        <div className="flex flex-col gap-1">
                                            <label className="menu-desc ml-1">默认模型 (Default Model)</label>
                                            <div className="flex gap-2">
                                                {fetchedModels[config.id] && fetchedModels[config.id].length > 0 ? (
                                                    <select
                                                        value={config.defaultModel}
                                                        onChange={(e) => updateConfig(config.id, { defaultModel: e.target.value })}
                                                        className="ui-select flex-1"
                                                    >
                                                        <option value="">请选择模型...</option>
                                                        {fetchedModels[config.id].map(m => (
                                                            <option key={m} value={m}>{m}</option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    <input
                                                        type="text"
                                                        value={config.defaultModel}
                                                        onChange={(e) => updateConfig(config.id, { defaultModel: e.target.value })}
                                                        placeholder="gpt-4o, claude-3-opus..."
                                                        className="ui-input flex-1"
                                                    />
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex gap-3 mt-1">
                                            <button
                                                onClick={() => fetchModels(config)}
                                                disabled={isFetching[config.id]}
                                                className="ui-btn ui-btn ui-btn-soft-action flex-1"
                                            >
                                                <RefreshCw size={16} className={isFetching[config.id] ? "animate-spin" : ""} />
                                                {isFetching[config.id] ? "拉取中..." : "拉取模型列表"}
                                            </button>

                                            <button
                                                onClick={() => testConnection(config)}
                                                disabled={isTesting[config.id]}
                                                className="ui-btn ui-btn ui-btn-success flex-1"
                                            >
                                                <Rss size={16} className={isTesting[config.id] ? "animate-spin" : ""} />
                                                {isTesting[config.id] ? "测试中..." : "测试连接"}
                                            </button>
                                        </div>

                                        {testResult[config.id] && testResult[config.id].message && (
                                            <Alert variant={testResult[config.id].success ? "success" : "danger"}>
                                                <AlertCircle size={16} className="mt-[2px] shrink-0" />
                                                <span className="break-all leading-[1.5]">{testResult[config.id].message}</span>
                                            </Alert>
                                        )}

                                        <div
                                            className="ui-toggle-row mt-2 overflow-visible"
                                            style={{ display: "block", position: "relative", height: "auto", flexShrink: 0, padding: "14px 76px 14px 16px" }}
                                        >
                                            <span className="menu-label font-medium">启用原生工具调用</span>
                                            <span className="menu-desc whitespace-normal break-words leading-[1.45]">
                                                开启后自动选择该服务商可用的原生工具格式（当前：{getNativeToolProtocolLabel(config)}）；关闭后使用文本动作协议。
                                            </span>
                                            <span style={{ position: "absolute", top: 0, bottom: 0, right: 16, display: "flex", alignItems: "center" }}>
                                                <Toggle
                                                    checked={config.enableNativeTools !== false}
                                                    onChange={(v) => updateConfig(config.id, { enableNativeTools: v })}
                                                />
                                            </span>
                                        </div>

                                        <div className="ui-toggle-row mt-2">
                                            <span className="menu-label font-medium">启用图像识别</span>
                                            <Toggle checked={config.enableImageRecognition} onChange={(v) => updateConfig(config.id, { enableImageRecognition: v })} />
                                        </div>

                                        <div className="ui-toggle-row mt-2">
                                            <span className="flex min-w-0 flex-col">
                                                <span className="menu-label font-medium">防胡言乱语</span>
                                                <span className="menu-desc">防止没有用户输入时胡言乱语</span>
                                            </span>
                                            <Toggle
                                                checked={config.preventEmptyGenerateRambling === true}
                                                onChange={(v) => updateConfig(config.id, { preventEmptyGenerateRambling: v })}
                                            />
                                        </div>

                                    </>
                                )
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {/* ── 站点编辑弹窗 ── */}
            {isSiteModalOpen && editingSite && (
                <div className="modal-overlay modal-overlay-bottom">
                    <div className="modal-sheet" data-ui="modal-sheet">
                        <div className="modal-header" data-ui="modal-header">
                            <button onClick={() => { setIsSiteModalOpen(false); setEditingSite(null); }} className="modal-header-btn modal-header-btn-muted"><X size={18} /></button>
                            <span className="modal-header-title">{siteAccounts.some(s => s.id === editingSite.id) ? "编辑站点" : "添加站点"}</span>
                            <button onClick={handleSaveSite} className="modal-header-btn modal-header-btn-action"><Check size={18} /></button>
                        </div>
                        <div className="modal-body hide-scrollbar flex flex-col gap-4 pb-10" data-ui="modal-body">
                            <div className="flex flex-col gap-1">
                                <label className="menu-desc ml-1">备注名（可选）</label>
                                <Input
                                    type="text"
                                    value={editingSite.name}
                                    onChange={(e) => setEditingSite({ ...editingSite, name: e.target.value })}
                                    placeholder="例如：XX 中转站"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="menu-desc ml-1">站点网址</label>
                                <Input
                                    type="url"
                                    value={editingSite.siteUrl}
                                    onChange={(e) => setEditingSite({ ...editingSite, siteUrl: e.target.value })}
                                    placeholder="https://api.example.com"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="menu-desc ml-1">登录账号（令牌登录可留空）</label>
                                <Input
                                    type="text"
                                    value={editingSite.username}
                                    onChange={(e) => setEditingSite({ ...editingSite, username: e.target.value })}
                                    placeholder="站点注册的用户名 / 邮箱"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="menu-desc ml-1">登录密码 / 访问令牌</label>
                                <Input
                                    type="password"
                                    value={editingSite.password}
                                    onChange={(e) => setEditingSite({ ...editingSite, password: e.target.value })}
                                    placeholder="登录密码，或站点「个人设置」里的系统访问令牌"
                                />
                            </div>
                            <Alert variant="info">
                                <KeyRound size={16} className="mt-[2px] shrink-0" />
                                <span className="leading-[1.5]">账密只保存在本机，查询时经本站后端直连目标站点。支持 new-api / one-api 体系的中转站；账密登录不通时会自动尝试访问令牌和 OpenAI 计费接口（sk- key 也可直接填在密码栏）。</span>
                            </Alert>
                        </div>
                    </div>
                </div>
            )}

            {/* ── 文件夹重命名弹窗 ── */}
            {renamingFolderId && (
                <div className="modal-overlay modal-overlay-bottom">
                    <div className="modal-sheet" data-ui="modal-sheet">
                        <div className="modal-header" data-ui="modal-header">
                            <button onClick={() => setRenamingFolderId(null)} className="modal-header-btn modal-header-btn-muted"><X size={18} /></button>
                            <span className="modal-header-title">重命名文件夹</span>
                            <button onClick={handleRenameFolder} className="modal-header-btn modal-header-btn-action"><Check size={18} /></button>
                        </div>
                        <div className="modal-body hide-scrollbar flex flex-col gap-4 pb-10" data-ui="modal-body">
                            <Input
                                type="text"
                                value={renamingFolderName}
                                onChange={(e) => setRenamingFolderName(e.target.value)}
                                placeholder="文件夹名称"
                                autoFocus
                            />
                        </div>
                    </div>
                </div>
            )}

            {confirmDeleteId && (
                <ConfirmDialog
                    title="确认删除？"
                    message="删除配置后无法恢复。是否继续？"
                    icon={AlertCircle}
                    variant="danger"
                    confirmLabel="确认删除"
                    cancelLabel="取消"
                    onConfirm={() => {
                        removeConfig(confirmDeleteId);
                        setConfirmDeleteId(null);
                    }}
                    onCancel={() => setConfirmDeleteId(null)}
                />
            )}

            {confirmDeleteFolderId && (
                <ConfirmDialog
                    title="删除文件夹？"
                    message="文件夹里的配置不会被删除，它们会回到「未分类」。是否继续？"
                    icon={AlertCircle}
                    variant="danger"
                    confirmLabel="删除文件夹"
                    cancelLabel="取消"
                    onConfirm={() => {
                        handleDeleteFolder(confirmDeleteFolderId);
                        setConfirmDeleteFolderId(null);
                    }}
                    onCancel={() => setConfirmDeleteFolderId(null)}
                />
            )}

            {confirmDeleteSiteId && (
                <ConfirmDialog
                    title="删除站点？"
                    message="删除后本机保存的该站点账密会一并清除。是否继续？"
                    icon={AlertCircle}
                    variant="danger"
                    confirmLabel="确认删除"
                    cancelLabel="取消"
                    onConfirm={() => {
                        persistSites(siteAccounts.filter(s => s.id !== confirmDeleteSiteId));
                        const next = { ...balances };
                        delete next[confirmDeleteSiteId];
                        setBalances(next);
                        setConfirmDeleteSiteId(null);
                    }}
                    onCancel={() => setConfirmDeleteSiteId(null)}
                />
            )}
        </div>
    );
}
