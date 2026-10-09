// 站点余额查询：代理浏览器到中转站的查余额接口，规避 CORS。
// 账密/令牌由客户端每次请求带来，服务端不留存。
//
// 中转站体系繁杂，这里按主流方案依次尝试，任一成功即返回：
//   A. 账密登录（new-api / one-api 经典体系）：
//      POST /api/user/login 拿 session cookie → GET /api/user/self 读 quota
//   B. 访问令牌（new-api 较新版 / Veloera 等二开，「个人设置 → 系统访问令牌」）：
//      GET /api/user/self，Authorization: Bearer <令牌>
//   C. OpenAI 计费端点（官方 API 与支持它的中转站，用 sk- key）：
//      GET /v1/dashboard/billing/credit_grants + /subscription
// quota 换算：$1 = 500000 quota。

import { NextResponse } from "next/server";
import { proxyFetch } from "@/lib/proxy-fetch";

const QUOTA_PER_USD = 500000;
const FETCH_TIMEOUT_MS = 20_000;

type BalanceSuccess = {
    ok: true;
    balanceUsd: number | null;
    usedUsd: number | null;
    rawQuota?: number;
    accountName?: string;
    /** 实际命中的查询方式，前端可提示用户 */
    via: "password" | "token" | "openai-billing";
};
type BalanceFailure = { ok: false; error: string };
type Result = BalanceSuccess | BalanceFailure;

function normalizeSiteUrl(raw: string): string | null {
    try {
        const url = new URL(raw.trim());
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        // 只保留 origin，用户粘贴 /login、/v1 之类路径也无所谓
        return url.origin;
    } catch {
        return null;
    }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        return await proxyFetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function describeError(e: unknown, fallback: string): string {
    if (e instanceof Error && e.name === "AbortError") return "连接站点超时";
    return `${fallback}：${e instanceof Error ? e.message : String(e)}`;
}

function quotaResult(data: Record<string, unknown>, via: BalanceSuccess["via"], fallbackName: string): BalanceSuccess | null {
    if (typeof data.quota !== "number") return null;
    return {
        ok: true,
        via,
        balanceUsd: data.quota / QUOTA_PER_USD,
        usedUsd: typeof data.used_quota === "number" ? data.used_quota / QUOTA_PER_USD : null,
        rawQuota: data.quota,
        accountName: (typeof data.username === "string" && data.username)
            || (typeof data.display_name === "string" && data.display_name)
            || fallbackName,
    };
}

// ── A. 账密登录（new-api / one-api）──
async function tryPasswordLogin(origin: string, username: string, password: string): Promise<Result> {
    let cookie = "";
    let loginData: { success?: boolean; message?: string; data?: Record<string, unknown> } | null;
    try {
        const loginRes = await fetchWithTimeout(`${origin}/api/user/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
            redirect: "manual",
        });
        const setCookies = loginRes.headers.getSetCookie?.() ?? [];
        cookie = setCookies.map(c => c.split(";")[0]).filter(Boolean).join("; ");
        loginData = await loginRes.json().catch(() => null);
        if (!loginRes.ok || loginData?.success === false) {
            return { ok: false, error: loginData?.message || `登录失败（HTTP ${loginRes.status}）` };
        }
        // 有的站点登录响应体直接带 quota，可以省一次请求
        if (!cookie && loginData?.data) {
            const direct = quotaResult(loginData.data, "password", username);
            if (direct) return direct;
        }
    } catch (e) {
        return { ok: false, error: describeError(e, "无法连接到站点") };
    }

    if (!cookie) {
        return { ok: false, error: "登录成功但未拿到会话凭证" };
    }

    try {
        const selfRes = await fetchWithTimeout(`${origin}/api/user/self`, {
            method: "GET",
            headers: { Cookie: cookie },
        });
        const selfData = await selfRes.json().catch(() => null);
        if (!selfRes.ok || selfData?.success === false || !selfData?.data) {
            return { ok: false, error: selfData?.message || `查询账户信息失败（HTTP ${selfRes.status}）` };
        }
        return quotaResult(selfData.data, "password", username)
            ?? { ok: false, error: "站点返回的账户信息里没有额度字段" };
    } catch (e) {
        return { ok: false, error: describeError(e, "查询余额失败") };
    }
}

// ── B. 访问令牌（Authorization: Bearer）──
async function tryAccessToken(origin: string, token: string): Promise<Result> {
    try {
        const res = await fetchWithTimeout(`${origin}/api/user/self`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || data?.success === false || !data?.data) {
            return { ok: false, error: data?.message || `令牌查询失败（HTTP ${res.status}）` };
        }
        return quotaResult(data.data, "token", "")
            ?? { ok: false, error: "站点返回的账户信息里没有额度字段" };
    } catch (e) {
        return { ok: false, error: describeError(e, "令牌查询失败") };
    }
}

// ── C. OpenAI 计费端点（sk- key）──
async function tryOpenAIBilling(origin: string, apiKey: string): Promise<Result> {
    const headers = { Authorization: `Bearer ${apiKey}` };
    try {
        const grantsRes = await fetchWithTimeout(`${origin}/v1/dashboard/billing/credit_grants`, { headers });
        if (!grantsRes.ok) {
            return { ok: false, error: `计费接口查询失败（HTTP ${grantsRes.status}）` };
        }
        const grants = await grantsRes.json().catch(() => null);
        const available = typeof grants?.total_available === "number" ? grants.total_available : null;
        const used = typeof grants?.total_used === "number" ? grants.total_used : null;
        if (available === null && used === null) {
            return { ok: false, error: "计费接口返回格式无法识别" };
        }
        return { ok: true, via: "openai-billing", balanceUsd: available, usedUsd: used };
    } catch (e) {
        return { ok: false, error: describeError(e, "计费接口查询失败") };
    }
}

export async function POST(request: Request) {
    let body: { siteUrl?: string; username?: string; password?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ ok: false, error: "请求体格式不正确。" }, { status: 400 });
    }

    const origin = typeof body.siteUrl === "string" ? normalizeSiteUrl(body.siteUrl) : null;
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!origin) return NextResponse.json({ ok: false, error: "站点网址无效。" }, { status: 400 });
    if (!username && !password) {
        return NextResponse.json({ ok: false, error: "请填写站点的账号和密码（或令牌）。" }, { status: 400 });
    }

    const errors: string[] = [];

    // 密码字段形如 sk- / 令牌且没填账号：直接走令牌/计费通道，跳过登录
    const looksLikeKey = /^sk-|^[A-Za-z0-9_-]{32,}$/.test(password);
    const tryLoginFirst = Boolean(username) && !looksLikeKey;

    if (tryLoginFirst) {
        const r = await tryPasswordLogin(origin, username, password);
        if (r.ok) return NextResponse.json(r);
        errors.push(`账密登录：${r.error}`);
    }

    // 令牌通道：优先用密码字段；没填密码时若账号字段像令牌也试它
    const tokenCandidate = password || username;
    if (tokenCandidate) {
        const r = await tryAccessToken(origin, tokenCandidate);
        if (r.ok) return NextResponse.json(r);
        errors.push(`访问令牌：${r.error}`);
    }

    // OpenAI 计费通道：同样需要类 key 的凭据
    if (tokenCandidate) {
        const r = await tryOpenAIBilling(origin, tokenCandidate);
        if (r.ok) return NextResponse.json(r);
        errors.push(`OpenAI 计费接口：${r.error}`);
    }

    return NextResponse.json({
        ok: false,
        error: `三条查询通道都失败了（${errors.join("；")}）。请确认填的是登录账密，或站点「个人设置」里的系统访问令牌。`,
    });
}
