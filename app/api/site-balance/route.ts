// 只使用用户选定的查询方式；凭据不留存、不跨站重定向。
import { NextResponse } from "next/server";
import { Agent, fetch as upstreamFetch } from "undici";
import { lookup } from "node:dns";
import { BlockList, isIP } from "node:net";

export const runtime = "nodejs";
const blocked = new BlockList();
for (const [address, prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",3]] as const) blocked.addSubnet(address,prefix,"ipv4");
function isPublicBalanceAddress(address: string): boolean {
    if (isIP(address) === 4) return !blocked.check(address,"ipv4");
    // 仅全球单播 IPv6；排除映射地址、隧道和保留/文档网段。
    if (isIP(address) !== 6 || !/^[23]/i.test(address)) return false;
    const first = parseInt(address.split(":")[0],16), second = parseInt(address.split(":")[1] || "0",16);
    return !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) && first !== 0x2002 && first !== 0x3fff;
}
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
class QueryError extends Error {}

export async function POST(request: Request) {
    const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
    let body: unknown;
    try { body = await request.json(); } catch { return reply({ ok:false,error:"请求体格式不正确。" },400); }
    if (!object(body)) return reply({ok:false,error:"请求体必须是对象。"},400);
    let origin: string;
    try {
        const url = new URL(typeof body.siteUrl === "string" ? body.siteUrl.trim() : "");
        const hostname = url.hostname.replace(/^\[|\]$/g,"");
        if (!["https:","http:"].includes(url.protocol) || url.username || url.password || hostname === "localhost" || hostname.endsWith(".localhost") || (isIP(hostname) && !isPublicBalanceAddress(hostname))) throw new Error();
        origin = url.origin;
    } catch { return reply({ok:false,error:"请使用公开站点的 http / https 地址，不支持本机或内网地址。"},400); }
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    // 旧客户端迁移：填了账号便按密码处理，不再根据密码长度猜测。
    const method = body.method ?? (username ? "password" : /^sk-/.test(password) ? "openai-billing" : "token");
    if (!["password","token","openai-billing"].includes(String(method))) return reply({ok:false,error:"请选择有效的查询方式。"},400);
    if (!password.trim() || (method === "password" && !username) || username.length > 320 || password.length > 8192) return reply({ok:false,error:"请填写有效的账号和凭据。"},400);
    const quotaPerUsd = body.quotaPerUsd ?? 500000;
    if (!finite(quotaPerUsd) || quotaPerUsd <= 0 || quotaPerUsd > 1e15) return reply({ok:false,error:"额度换算比例必须是有效的正数。"},400);
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    if (userId && !/^\d{1,20}$/.test(userId)) return reply({ok:false,error:"用户 ID 必须是数字。"},400);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal?.addEventListener("abort",abort,{once:true});
    if (request.signal?.aborted) abort();
    const timeout = setTimeout(abort,20000);
    // 在连接实际使用的 DNS 解析处校验并固定地址，避免检查后再解析导致 DNS 重绑定。
    // 专用直连 dispatcher 不继承系统代理，确保目标地址校验不能被代理绕过。
    const agent = new Agent({ connect: { lookup(hostname, _options, callback) {
        lookup(hostname,{all:true,verbatim:true},(error,addresses) => {
            if (error) { callback(error,"",4); return; }
            if (!addresses.length || addresses.some(item => !isPublicBalanceAddress(item.address))) { callback(new Error("站点解析到了非公开地址"),"",4); return; }
            if (typeof _options === "object" && _options.all) { callback(null,addresses); return; }
            const selected = addresses[0]; callback(null,selected.address,selected.family);
        });
    } } });
    try {
        const read = async (path: string, headers: Record<string,string>, loginBody?: string) => {
            const res = await upstreamFetch(origin + path,{method:loginBody ? "POST" : "GET",headers,body:loginBody,redirect:"manual",signal:controller.signal,dispatcher:agent});
            if (!res.ok) { await res.body?.cancel(); throw new QueryError(res.status >= 300 && res.status < 400 ? "站点发生重定向，请填写最终站点地址。" : `站点返回 HTTP ${res.status}，请检查查询方式与凭据。`); }
            // 计时覆盖 DNS、连接和完整响应体；限制意外返回的超大页面。
            const reader = res.body?.getReader(); let text = "", bytes = 0; const decoder = new TextDecoder();
            if (reader) { try { while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 1048576) { await reader.cancel(); throw new QueryError("站点响应过大，无法识别为余额信息。"); } text += decoder.decode(chunk.value,{stream:true}); } text += decoder.decode(); } finally { reader.releaseLock(); } }
            let data: unknown; try { data = JSON.parse(text); } catch { throw new QueryError("站点未返回可识别的 JSON，请检查地址和查询方式。"); }
            if (!object(data)) throw new QueryError("站点返回格式无法识别。");
            if (data.success === false) throw new QueryError("站点拒绝了查询，请检查凭据、用户 ID 或额外验证要求。");
            return {data,headers:res.headers};
        };
        const quota = (data: unknown) => {
            if (!object(data) || !finite(data.quota)) throw new QueryError("站点未提供有效的额度字段。");
            const balanceUsd = data.quota / quotaPerUsd, usedUsd = finite(data.used_quota) ? data.used_quota / quotaPerUsd : null;
            if (!finite(balanceUsd) || (usedUsd !== null && !finite(usedUsd))) throw new QueryError("额度换算超出有效范围，请检查站点换算比例。");
            return {ok:true,via:method,balanceUsd,usedUsd,rawQuota:data.quota,accountName:typeof data.username === "string" ? data.username : username};
        };
        if (method === "password") {
            const login = await read("/api/user/login",{"Content-Type":"application/json"},JSON.stringify({username,password}));
            const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).filter(Boolean).join("; ");
            if (!cookie) return reply(quota(login.data.data));
            const loginId = object(login.data.data) && (typeof login.data.data.id === "number" || typeof login.data.data.id === "string") ? String(login.data.data.id) : "";
            const headers: Record<string,string> = {Cookie:cookie};
            if (userId || /^\d+$/.test(loginId)) headers["New-Api-User"] = userId || loginId;
            return reply(quota((await read("/api/user/self",headers)).data.data));
        }
        const headers: Record<string,string> = {Authorization:`Bearer ${password.trim()}`};
        if (method === "token") { if (userId) headers["New-Api-User"] = userId; return reply(quota((await read("/api/user/self",headers)).data.data)); }
        const grants = (await read("/v1/dashboard/billing/credit_grants",headers)).data;
        if (!finite(grants.total_available) && !finite(grants.total_used)) throw new QueryError("该站点未提供兼容的余额字段，请尝试其他查询方式。");
        return reply({ok:true,via:method,balanceUsd:finite(grants.total_available) ? grants.total_available : null,usedUsd:finite(grants.total_used) ? grants.total_used : null});
    } catch (error) {
        return reply({ok:false,error:controller.signal.aborted ? "查询超时或已取消，请稍后重试。" : error instanceof QueryError ? error.message : "无法连接站点，请检查公开地址、网络与查询方式。"});
    } finally {
        clearTimeout(timeout); request.signal?.removeEventListener("abort",abort); await agent.destroy();
    }
}
