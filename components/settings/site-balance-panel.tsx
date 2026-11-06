"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, RefreshCw, MoreHorizontal, Wallet, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/modal";
import { loadSiteAccounts, saveSiteAccounts, loadSiteBalanceExpanded, saveSiteBalanceExpanded, querySiteBalance, siteBalanceMethod, type SiteAccount, type SiteBalanceResult } from "@/lib/site-balance-storage";
import styles from "./site-balance.module.css";

type Success = Extract<SiteBalanceResult, { ok: true }>;
type View = { success?: Success; updatedAt?: number; error?: string };
const money = (value: number | null) => value === null ? "—" : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const methodNames = { password: "账号密码", token: "访问令牌", "openai-billing": "兼容计费接口" };
function host(url: string) { try { return new URL(url).host; } catch { return url; } }

export function SiteBalancePanel() {
    const [sites, setSites] = useState<SiteAccount[]>([]);
    const [expanded, setExpanded] = useState(true);
    const [ready, setReady] = useState(false);
    const [views, setViews] = useState<Record<string, View>>({});
    const [querying, setQuerying] = useState<Record<string, boolean>>({});
    const [editing, setEditing] = useState<SiteAccount | null>(null);
    const [formError, setFormError] = useState("");
    const [deleting, setDeleting] = useState<string | null>(null);
    const requests = useRef(new Map<string, AbortController>());
    const mounted = useRef(false);
    useEffect(() => {
        mounted.current = true;
        setSites(loadSiteAccounts()); setExpanded(loadSiteBalanceExpanded()); setReady(true);
        const active = requests.current;
        return () => { mounted.current = false; active.forEach(controller => controller.abort()); active.clear(); };
    }, []);
    const persist = (next: SiteAccount[]) => { setSites(next); saveSiteAccounts(next); };
    const query = async (site: SiteAccount) => {
        requests.current.get(site.id)?.abort();
        const controller = new AbortController(); requests.current.set(site.id, controller);
        setQuerying(prev => ({ ...prev, [site.id]: true }));
        setViews(prev => ({ ...prev, [site.id]: { ...prev[site.id], error: undefined } }));
        try {
            const result = await querySiteBalance(site, controller.signal);
            if (!mounted.current || requests.current.get(site.id) !== controller || controller.signal.aborted) return;
            setViews(prev => ({ ...prev, [site.id]: result.ok ? { success: result, updatedAt: Date.now() } : { ...prev[site.id], error: result.error } }));
        } finally {
            if (mounted.current && requests.current.get(site.id) === controller) {
                requests.current.delete(site.id); setQuerying(prev => ({ ...prev, [site.id]: false }));
            }
        }
    };
    const edit = (site?: SiteAccount) => {
        setFormError(""); setEditing(site ? { ...site, method: siteBalanceMethod(site) } : { id: `site-${crypto.randomUUID()}`, name: "", siteUrl: "", username: "", password: "", method: "token", quotaPerUsd: 500000, userId: "" });
    };
    const save = () => {
        if (!editing) return;
        let url: URL;
        try { url = new URL(editing.siteUrl.trim()); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error(); }
        catch { setFormError("请填写有效的 http / https 站点地址，不要在网址中包含账号密码。"); return; }
        const method = siteBalanceMethod(editing);
        if (!editing.password.trim() || (method === "password" && !editing.username.trim())) { setFormError(method === "password" ? "请填写登录账号和密码。" : "请填写令牌或 API Key。"); return; }
        if (method !== "openai-billing" && (!Number.isFinite(editing.quotaPerUsd) || editing.quotaPerUsd! <= 0)) { setFormError("每美元额度必须是大于 0 的数字。"); return; }
        if (editing.userId && !/^\d+$/.test(editing.userId)) { setFormError("用户 ID 应为数字，或留空。"); return; }
        const next = { ...editing, name: editing.name.trim(), siteUrl: url.origin, username: method === "password" ? editing.username.trim() : "", password: method === "password" ? editing.password : editing.password.trim(), method };
        const old = sites.find(site => site.id === next.id);
        if (old && (old.siteUrl !== next.siteUrl || old.username !== next.username || old.password !== next.password || siteBalanceMethod(old) !== method || old.quotaPerUsd !== next.quotaPerUsd || old.userId !== next.userId)) setViews(prev => { const copy = { ...prev }; delete copy[next.id]; return copy; });
        persist(old ? sites.map(site => site.id === next.id ? next : site) : [...sites, next]);
        setEditing(null); void query(next);
    };
    const remove = () => {
        if (!deleting) return;
        requests.current.get(deleting)?.abort(); requests.current.delete(deleting);
        persist(sites.filter(site => site.id !== deleting));
        setViews(prev => { const next = { ...prev }; delete next[deleting]; return next; });
        setQuerying(prev => { const next = { ...prev }; delete next[deleting]; return next; }); setDeleting(null);
    };
    return <section className={styles.panel} aria-label="站点余额">
        <button type="button" className={styles.heading} disabled={!ready} aria-expanded={expanded} aria-controls="site-balance-cards" onClick={() => { setExpanded(!expanded); saveSiteBalanceExpanded(!expanded); }}>
            <Wallet size={18} /><span>站点余额<small>{sites.length} 个站点</small></span><ChevronDown size={17} className={expanded ? styles.chevronOpen : styles.chevron} />
        </button>
        {expanded && <div id="site-balance-cards" className={styles.content}>
            <div className={styles.toolbar}><span>各站额度独立展示</span><button type="button" onClick={() => edit()}><Plus size={14} />添加站点</button></div>
            {!sites.length && <div className={styles.empty}><Wallet size={25} /><b>把站点余额放在这里</b><span>添加站点，选择查询方式即可查看。</span><button type="button" onClick={() => edit()}>添加第一个站点</button></div>}
            {sites.map(site => {
                const view = views[site.id], success = view?.success, busy = querying[site.id];
                return <article key={site.id} className={styles.card}>
                    <header><span className={styles.mark}>{(site.name || host(site.siteUrl)).slice(0, 1).toUpperCase()}</span><div className={styles.siteName}><b>{site.name || host(site.siteUrl)}</b><small>{host(site.siteUrl)}</small></div>
                        <details className={styles.menu}><summary aria-label={`${site.name || host(site.siteUrl)} 更多操作`}><MoreHorizontal size={20} /></summary><div><button type="button" onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); edit(site); }}>编辑站点</button><button type="button" onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); setDeleting(site.id); }}>删除站点</button></div></details>
                    </header>
                    <div className={styles.metrics}>
                        <div className={styles.primaryMetric}><span className={styles.balanceLabel}>{view?.error && success ? "上次可用余额" : "可用余额"}</span><div className={styles.amount}>{success ? money(success.balanceUsd) : "—"}{success?.balanceUsd !== null && success && <small>USD</small>}</div></div>
                        <div className={styles.meta}><span>{success ? success.usedUsd !== null ? `已用 ${money(success.usedUsd)}` : "站点未提供已用额度" : busy ? "正在查询，请稍候…" : "尚未查询"}</span><small>{view?.updatedAt ? `更新于 ${new Date(view.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "尚无成功查询"}</small></div>
                    </div>
                    {view?.error && <details className={styles.error}><summary>{success ? "本次查询失败，保留上次结果" : "查询失败，查看原因"}</summary><p>{view.error}</p></details>}
                    <footer>{success ? <details className={styles.detail}><summary>查询详情</summary><p>方式：{methodNames[success.via || siteBalanceMethod(site)]}{success.accountName ? ` · 账户：${success.accountName}` : ""}{success.rawQuota !== undefined ? ` · 原始额度：${success.rawQuota} · 每美元：${site.quotaPerUsd ?? 500000}` : ""}</p></details> : <small>{methodNames[siteBalanceMethod(site)]}</small>}<button type="button" disabled={busy} onClick={() => void query(site)} aria-label={`刷新 ${site.name || host(site.siteUrl)} 余额`}><RefreshCw size={13} className={busy ? styles.spin : undefined} />{busy ? "查询中" : view?.error ? "重试" : "刷新"}</button></footer>
                </article>;
            })}
            <p className={styles.note}>凭据保存在本机，查询时经应用后端转发。站点须提供对应查询接口。</p>
        </div>}
        {editing && <div className="modal-overlay modal-overlay-bottom"><section className={`modal-sheet ${styles.editor}`} role="dialog" aria-modal="true" aria-label="站点设置">
            <div className="modal-header"><button type="button" className="modal-header-btn modal-header-btn-muted" aria-label="取消编辑站点" onClick={() => setEditing(null)}><X size={18} /></button><span className="modal-header-title">{sites.some(site => site.id === editing.id) ? "编辑站点" : "添加站点"}</span><span /></div>
            <form className={`modal-body hide-scrollbar ${styles.form}`} onSubmit={event => { event.preventDefault(); save(); }}>
                <label>站点名称<input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="例如：常用中转站" maxLength={80} /></label>
                <label>站点地址<input type="url" required value={editing.siteUrl} onChange={e => setEditing({ ...editing, siteUrl: e.target.value })} placeholder="https://api.example.com" /></label>
                <label>查询方式<select value={siteBalanceMethod(editing)} onChange={e => setEditing({ ...editing, method: e.target.value as SiteAccount["method"], password: "", username: "" })}><option value="token">访问令牌</option><option value="password">账号密码</option><option value="openai-billing">兼容计费接口</option></select></label>
                {siteBalanceMethod(editing) === "password" && <label>登录账号<input required autoComplete="off" value={editing.username} onChange={e => setEditing({ ...editing, username: e.target.value })} placeholder="用户名或邮箱" /></label>}
                <label>{siteBalanceMethod(editing) === "password" ? "登录密码" : siteBalanceMethod(editing) === "token" ? "访问令牌" : "API Key"}<input type="password" required autoComplete="new-password" value={editing.password} onChange={e => setEditing({ ...editing, password: e.target.value })} /></label>
                <p className={styles.note}>{siteBalanceMethod(editing) === "password" ? "只通过账号登录查询；需验证码或二步验证的站点请使用访问令牌。" : siteBalanceMethod(editing) === "token" ? "填写站点个人设置中的访问令牌，它可能不同于调用模型的 API Key。" : "仅支持提供兼容 credit_grants 计费接口的站点，并非所有 API Key 都能查询余额。"}</p>
                {siteBalanceMethod(editing) !== "openai-billing" && <details className={styles.advanced}><summary>高级设置</summary><label>每 1 USD 对应的额度<input type="number" min="0.000001" step="any" required value={editing.quotaPerUsd ?? 500000} onChange={e => setEditing({ ...editing, quotaPerUsd: Number(e.target.value) })} /></label><label>用户 ID（可选）<input inputMode="numeric" value={editing.userId || ""} onChange={e => setEditing({ ...editing, userId: e.target.value.trim() })} placeholder="站点要求 New-Api-User 时填写" /></label><p className={styles.note}>默认每美元 500000 额度。请按站点规则设置，换算结果以 USD 展示。</p></details>}
                {formError && <p className={styles.error} role="alert">{formError}</p>}
                <button type="submit" className={styles.save}>保存并查询</button>
            </form>
        </section></div>}
        {deleting && <ConfirmDialog title="删除站点？" message="删除本机保存的站点和凭据，不影响该站点的真实账户。" variant="danger" confirmLabel="删除" cancelLabel="取消" onConfirm={remove} onCancel={() => setDeleting(null)} />}
    </section>;
}
