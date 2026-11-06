// 中转站余额面板：保存各站点的网址与账密，配合 /api/site-balance 路由
// 查询余额。凭据保存在本机；查询时会经应用后端转发到目标站点。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";

const SITE_ACCOUNTS_KEY = "ai_phone_site_accounts_v1";
registerKvMigration(SITE_ACCOUNTS_KEY);
const EXPANDED_KEY = "ai_phone_site_balance_expanded_v1";
registerKvMigration(EXPANDED_KEY);
export type SiteBalanceMethod = "password" | "token" | "openai-billing";

export type SiteAccount = {
    id: string;
    /** 备注名，如「XX 中转」 */
    name: string;
    /** 站点首页地址，如 https://api.example.com（不带 /v1） */
    siteUrl: string;
    username: string;
    password: string;
    method?: SiteBalanceMethod;
    quotaPerUsd?: number;
    userId?: string;
};

export function siteBalanceMethod(site: SiteAccount): SiteBalanceMethod {
    return site.method || (site.username.trim() ? "password" : /^sk-/.test(site.password) ? "openai-billing" : "token");
}
export function loadSiteBalanceExpanded() { return kvGet(EXPANDED_KEY) !== "false"; }
export function saveSiteBalanceExpanded(expanded: boolean) { kvSet(EXPANDED_KEY, String(expanded)); }

export type SiteBalanceResult =
    | {
        ok: true;
        /** 剩余额度（美元）；站点按次数计费时为 null */
        balanceUsd: number | null;
        /** 已用额度（美元） */
        usedUsd: number | null;
        /** 原始额度单位（new-api quota，$1 = 500000） */
        rawQuota?: number;
        /** 站点用户名回显 */
        accountName?: string;
        /** 实际命中的查询方式 */
        via?: "password" | "token" | "openai-billing";
    }
    | { ok: false; error: string };

export function loadSiteAccounts(): SiteAccount[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = kvGet(SITE_ACCOUNTS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as SiteAccount[];
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(s => s && typeof s.id === "string" && typeof s.siteUrl === "string")
            .map(s => ({ ...s, name: typeof s.name === "string" ? s.name : "", username: typeof s.username === "string" ? s.username : "", password: typeof s.password === "string" ? s.password : "",
                method: ["password", "token", "openai-billing"].includes(s.method || "") ? s.method : undefined,
                userId: typeof s.userId === "string" ? s.userId : "",
                quotaPerUsd: Number.isFinite(s.quotaPerUsd) && s.quotaPerUsd! > 0 ? s.quotaPerUsd : 500000 }));
    } catch {
        return [];
    }
}

export function saveSiteAccounts(accounts: SiteAccount[]): void {
    if (typeof window === "undefined") return;
    kvSet(SITE_ACCOUNTS_KEY, JSON.stringify(accounts));
}

/** 调本站后端路由查询单个站点余额。 */
export async function querySiteBalance(account: SiteAccount, signal?: AbortSignal): Promise<SiteBalanceResult> {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(cancel, 25000);
    try {
        const res = await fetch("/api/site-balance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
                siteUrl: account.siteUrl,
                username: account.username,
                password: account.password,
                method: siteBalanceMethod(account),
                quotaPerUsd: account.quotaPerUsd ?? 500000,
                userId: account.userId,
            }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) {
            return { ok: false, error: data?.error || `查询失败（HTTP ${res.status}）` };
        }
        if (data.ok !== true) return { ok: false, error: typeof data.error === "string" ? data.error : "查询返回格式不正确" };
        const finiteOrNull = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isFinite(value));
        if (!finiteOrNull(data.balanceUsd) || !finiteOrNull(data.usedUsd)) return { ok: false, error: "站点返回的金额格式不正确" };
        return data as SiteBalanceResult;
    } catch (e) {
        return { ok: false, error: controller.signal.aborted ? signal?.aborted ? "查询已取消" : "查询超时，请重试" : e instanceof Error ? e.message : "查询失败" };
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", cancel);
    }
}
