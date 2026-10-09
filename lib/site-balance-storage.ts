// 中转站余额面板：保存各站点的网址与账密，配合 /api/site-balance 路由
// 查询余额。账密只存在本机 kv-db，不上传任何服务器（查询时由本站后端
// 路由转发到对应站点，避免浏览器 CORS）。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";

const SITE_ACCOUNTS_KEY = "ai_phone_site_accounts_v1";
registerKvMigration(SITE_ACCOUNTS_KEY);

export type SiteAccount = {
    id: string;
    /** 备注名，如「XX 中转」 */
    name: string;
    /** 站点首页地址，如 https://api.example.com（不带 /v1） */
    siteUrl: string;
    username: string;
    password: string;
};

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
        return parsed.filter(s => s && typeof s.id === "string" && typeof s.siteUrl === "string");
    } catch {
        return [];
    }
}

export function saveSiteAccounts(accounts: SiteAccount[]): void {
    if (typeof window === "undefined") return;
    kvSet(SITE_ACCOUNTS_KEY, JSON.stringify(accounts));
}

/** 调本站后端路由查询单个站点余额。 */
export async function querySiteBalance(account: SiteAccount): Promise<SiteBalanceResult> {
    try {
        const res = await fetch("/api/site-balance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                siteUrl: account.siteUrl,
                username: account.username,
                password: account.password,
            }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) {
            return { ok: false, error: data?.error || `查询失败（HTTP ${res.status}）` };
        }
        return data as SiteBalanceResult;
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
