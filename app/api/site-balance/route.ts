// 站点余额查询：代理浏览器到中转站（new-api / one-api 体系）的
// 登录 + 自查接口，规避 CORS。账密由客户端每次请求带来，服务端不留存。
//
// 流程：POST {site}/api/user/login 拿 session cookie
//   → GET {site}/api/user/self 读 quota / used_quota（$1 = 500000 quota）
// 部分二开站点把登录挂在别的路径，这里只对主流体系负责，失败时给出
// 可读错误，由前端原样展示。

import { NextResponse } from "next/server";
import { proxyFetch } from "@/lib/proxy-fetch";

const QUOTA_PER_USD = 500000;
const FETCH_TIMEOUT_MS = 20_000;

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
    if (!username || !password) {
        return NextResponse.json({ ok: false, error: "请填写站点的账号和密码。" }, { status: 400 });
    }

    // ── 第一步：登录拿 session cookie ──
    let cookie = "";
    try {
        const loginRes = await fetchWithTimeout(`${origin}/api/user/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
            redirect: "manual",
        });
        const setCookies = loginRes.headers.getSetCookie?.() ?? [];
        cookie = setCookies.map(c => c.split(";")[0]).filter(Boolean).join("; ");
        const loginData = await loginRes.json().catch(() => null);
        // new-api: { success: true, data: {...} }；失败 { success: false, message }
        if (!loginRes.ok || loginData?.success === false) {
            const msg = loginData?.message || `登录失败（HTTP ${loginRes.status}）`;
            return NextResponse.json({ ok: false, error: `登录失败：${msg}` }, { status: 200 });
        }
        // 有的站点登录响应体直接带 quota，可以省一次请求
        if (!cookie && loginData?.data && typeof loginData.data.quota === "number") {
            return NextResponse.json({
                ok: true,
                balanceUsd: loginData.data.quota / QUOTA_PER_USD,
                usedUsd: typeof loginData.data.used_quota === "number" ? loginData.data.used_quota / QUOTA_PER_USD : null,
                rawQuota: loginData.data.quota,
                accountName: loginData.data.username || username,
            });
        }
    } catch (e) {
        const msg = e instanceof Error && e.name === "AbortError" ? "连接站点超时。" : `无法连接到站点：${e instanceof Error ? e.message : String(e)}`;
        return NextResponse.json({ ok: false, error: msg }, { status: 200 });
    }

    if (!cookie) {
        return NextResponse.json({ ok: false, error: "登录成功但未拿到会话凭证，该站点可能不是 new-api 体系。" }, { status: 200 });
    }

    // ── 第二步：读账户信息 ──
    try {
        const selfRes = await fetchWithTimeout(`${origin}/api/user/self`, {
            method: "GET",
            headers: { Cookie: cookie },
        });
        const selfData = await selfRes.json().catch(() => null);
        if (!selfRes.ok || selfData?.success === false || !selfData?.data) {
            const msg = selfData?.message || `查询账户信息失败（HTTP ${selfRes.status}）`;
            return NextResponse.json({ ok: false, error: msg }, { status: 200 });
        }
        const quota = typeof selfData.data.quota === "number" ? selfData.data.quota : null;
        const used = typeof selfData.data.used_quota === "number" ? selfData.data.used_quota : null;
        return NextResponse.json({
            ok: true,
            balanceUsd: quota === null ? null : quota / QUOTA_PER_USD,
            usedUsd: used === null ? null : used / QUOTA_PER_USD,
            rawQuota: quota ?? undefined,
            accountName: selfData.data.username || selfData.data.display_name || username,
        });
    } catch (e) {
        const msg = e instanceof Error && e.name === "AbortError" ? "查询余额超时。" : `查询余额失败：${e instanceof Error ? e.message : String(e)}`;
        return NextResponse.json({ ok: false, error: msg }, { status: 200 });
    }
}
