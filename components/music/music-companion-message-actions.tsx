"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { deleteCompanionReply, editCompanionReply, regenerateCompanionReply, type CompanionMessage } from "@/lib/music-companion";

/** Each assistant response is stored as one turn, even when shown as several bubbles. */
export default function CompanionReplyActions({ message, laterCount, busy, children }: { message: CompanionMessage; laterCount: number; busy: boolean; children: ReactNode }) {
    const [action, setAction] = useState<"menu" | "edit" | "delete" | "reroll" | null>(null);
    const [draft, setDraft] = useState("");
    const [error, setError] = useState("");
    const root = useRef<HTMLDivElement>(null);
    const panel = useRef<HTMLElement>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const down = useRef({ x: 0, y: 0 });
    const ignoreClickUntil = useRef(0);
    const clearHold = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
    const open = () => { setError(""); setAction("menu"); };
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    useEffect(() => {
        if (!action) return;
        const previous = document.activeElement as HTMLElement | null;
        panel.current?.querySelector<HTMLElement>(action === "edit" ? "textarea" : "button")?.focus({ preventScroll: true });
        return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
    }, [action]);
    const host = root.current?.closest(".mc-sheet");
    return <div ref={root} className="mc-reply-target" onContextMenu={event => { if (action) return; event.preventDefault(); event.stopPropagation(); clearHold(); open(); }}
        onPointerDown={event => {
            if (action || event.button !== 0) return;
            clearHold(); down.current = { x: event.clientX, y: event.clientY };
            timer.current = setTimeout(() => { ignoreClickUntil.current = Date.now() + 900; open(); }, 500);
        }} onPointerMove={event => { if (Math.hypot(event.clientX - down.current.x, event.clientY - down.current.y) > 9) clearHold(); }}
        onPointerUp={event => { clearHold(); if (action && !(event.target as Element).closest(".mc-reply-actions-mask")) ignoreClickUntil.current = Date.now() + 350; }} onPointerCancel={clearHold} onPointerLeave={clearHold}
        onClickCapture={event => { if (Date.now() < ignoreClickUntil.current && !(event.target as Element).closest(".mc-reply-actions-mask")) { event.preventDefault(); event.stopPropagation(); } }}
        onKeyDown={event => { if (!action && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) { event.preventDefault(); event.stopPropagation(); open(); } }}>
        {children}
        {action && host && createPortal(<div className="mc-reply-actions-mask" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) setAction(null); }} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={event => {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setAction(null); }
            if (event.key !== "Tab") return;
            event.stopPropagation();
            const controls = panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), textarea");
            if (!controls?.length) return;
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}>
            <section ref={panel} className="mc-reply-actions" role="dialog" aria-modal="true" aria-label={action === "edit" ? "编辑本次回复" : action === "delete" ? "删除本次回复" : action === "reroll" ? "重新生成本次回复" : "本次回复操作"}>
                <header><strong>{action === "edit" ? "编辑本次回复" : action === "delete" ? "删除本次回复？" : action === "reroll" ? "重新生成这轮回复？" : "本次回复"}</strong><button type="button" aria-label="关闭回复操作" onClick={() => setAction(null)}>×</button></header>
                {action === "menu" ? <><p>操作这次角色回复的全部气泡与译文</p><div className="mc-reply-menu"><button type="button" disabled={busy} onClick={() => { if (laterCount) setAction("reroll"); else { setAction(null); void regenerateCompanionReply(message.id); } }}>↻ <span>重新生成本次回复</span></button><button type="button" onClick={() => { setDraft(message.text); setAction("edit"); }}>✎ <span>编辑本次回复</span></button><button type="button" className="mc-reply-danger" onClick={() => setAction("delete")}>− <span>删除本次回复</span></button></div></> : action === "edit" ? <>
                    <p>可直接修改整段内容；双语请保留原文与译文的分隔格式。</p><textarea aria-label="本次回复内容" maxLength={24000} value={draft} onChange={event => { setDraft(event.target.value); setError(""); }} />
                    {error && <p role="alert">{error}</p>}<footer><button type="button" onClick={() => setAction(null)}>取消</button><button type="button" disabled={!draft.trim()} onClick={() => { if (editCompanionReply(message.id, draft)) setAction(null); else setError("请保留有效的回复文字。"); }}>保存修改</button></footer>
                </> : <><p>{action === "delete" ? "删除整轮回复及其译文，其他聊天保留。删除后无法恢复。" : `这轮之后的 ${laterCount} 条消息会在重生成成功后移除；失败时保留原聊天。`}</p><footer><button type="button" onClick={() => setAction(null)}>取消</button><button type="button" className={action === "delete" ? "mc-reply-danger" : ""} disabled={action === "reroll" && busy} onClick={() => { setAction(null); if (action === "delete") deleteCompanionReply(message.id); else void regenerateCompanionReply(message.id); }}>{action === "delete" ? "删除整轮回复" : "确认重生成"}</button></footer></>}
            </section>
        </div>, host)}
    </div>;
}
