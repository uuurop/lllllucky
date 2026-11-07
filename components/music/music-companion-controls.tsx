"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { clearCompanionMusicNotice, confirmCompanionMusicAction, DEFAULT_COMPANION_TRANSLATION_COLORS, dismissCompanionMusicAction, getCompanionServerState, getCompanionState, setCompanionMusicPermission, setCompanionTranslationAlwaysVisible, setCompanionTranslationColors, setCompanionTranslationOutline, setCompanionWaitSeconds, subscribeCompanion } from "@/lib/music-companion";

function useControlState() { return useSyncExternalStore(subscribeCompanion, getCompanionState, getCompanionServerState); }

function CompanionMusicSettings() {
    const state = useControlState();
    return <div className="mc-music-settings">
        <div className="mc-tool-segments" role="group" aria-label="角色切歌方式">
            {(["off", "confirm", "direct"] as const).map(value => <button type="button" key={value} disabled={!state.ready} aria-pressed={state.musicPermission === value} onClick={() => { if (state.musicPermission !== value) setCompanionMusicPermission(value); }}>{value === "off" ? "关闭" : value === "confirm" ? "确认后切换" : "直接切换"}</button>)}
        </div>
        <p className="mc-tool-description">{state.musicPermission === "off" ? "TA 只陪你听歌，不操作播放器。" : state.musicPermission === "confirm" ? "TA 提议换歌后，由你确认。两次切歌至少间隔一分钟。" : "当前歌曲先听 30 秒，两次切歌至少间隔一分钟。手动操作后，旧请求会取消。"}</p>
    </div>;
}

type CompanionTool = "wait" | "colors" | "music";
function ToolIcon({ kind }: { kind: CompanionTool }) {
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {kind === "wait" ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> : kind === "colors" ? <><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4l-.3-.3A1.9 1.9 0 0 1 15.5 14H17a4 4 0 0 0 4-4c0-4-4-7-9-7Z" /><circle cx="7.5" cy="10" r=".8" /><circle cx="11" cy="6.5" r=".8" /><circle cx="16" cy="8" r=".8" /></> : <><path d="M4 7h4l8 10h4M4 17h4l3-4M15 7h5M17 4l3 3-3 3M17 14l3 3-3 3" /></>}
    </svg>;
}

/** One compact toolbar and one shared tray; opening settings never moves the composer. */
export function CompanionComposerTools() {
    const state = useControlState();
    const [active, setActive] = useState<CompanionTool | null>(null);
    const [waitDraft, setWaitDraft] = useState(String(state.waitSeconds));
    const shell = useRef<HTMLDivElement>(null), id = useId();
    useEffect(() => setWaitDraft(String(state.waitSeconds)), [state.waitSeconds, active]);
    useEffect(() => {
        if (!active) return;
        const outside = (event: PointerEvent) => { if (event.target instanceof Node && !shell.current?.contains(event.target)) setActive(null); };
        document.addEventListener("pointerdown", outside);
        return () => document.removeEventListener("pointerdown", outside);
    }, [active]);
    const close = () => { shell.current?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.focus(); setActive(null); };
    const translationStyle = { "--mc-translation-color": state.translationColors.text, "--mc-translation-outline": state.translationOutlineEnabled ? state.translationColors.outline : "transparent" } as CSSProperties;
    const title = active === "wait" ? "回复等待" : active === "colors" ? "译文颜色" : "角色切歌";
    return <div ref={shell} className="mc-tools-shell" onKeyDown={event => { if (event.key === "Escape" && active) { event.stopPropagation(); close(); } }}>
        <div className="mc-composer-tools">
            <button type="button" className="mc-translation-toggle" role="switch" aria-checked={state.translationAlwaysVisible} onClick={() => setCompanionTranslationAlwaysVisible(!state.translationAlwaysVisible)}><span>翻译常显</span><span className="mc-translation-switch" aria-hidden="true" /></button>
            <div className="mc-tool-actions">
                {(["wait", "colors", "music"] as const).map(kind => <button key={kind} type="button" className="mc-tool-button" aria-label={kind === "wait" ? `回复等待：${state.waitSeconds}秒` : kind === "colors" ? "译文颜色设置" : `角色切歌：${state.musicPermission === "off" ? "关闭" : state.musicPermission === "confirm" ? "确认后切换" : "直接切换"}`} title={kind === "wait" ? `等待 ${state.waitSeconds} 秒` : kind === "colors" ? "译文颜色" : "角色切歌"} aria-expanded={active === kind} aria-controls={`${id}-${kind}`} onClick={() => setActive(value => value === kind ? null : kind)}><ToolIcon kind={kind} /><span>{kind === "wait" ? "等待" : kind === "colors" ? "译文" : "切歌"}</span></button>)}
            </div>
        </div>
        {active && <div key={active} id={`${id}-${active}`} className="mc-tool-tray" role="group" aria-label={title} style={translationStyle}>
            <div className="mc-tool-tray-heading"><b>{title}</b><button type="button" aria-label="收起设置" onClick={close}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button></div>
            {active === "wait" && <div className="mc-wait-settings">
                <label htmlFor={`${id}-seconds`}>停止输入后</label><div><button type="button" aria-label="减少等待时间" disabled={state.waitSeconds <= 0} onClick={() => setCompanionWaitSeconds(state.waitSeconds - 1)}>−</button><input id={`${id}-seconds`} type="number" min={0} max={60} step={1} aria-label="回复等待秒数" value={waitDraft} onBlur={() => setWaitDraft(String(getCompanionState().waitSeconds))} onChange={event => { setWaitDraft(event.target.value); if (Number.isFinite(event.target.valueAsNumber)) setCompanionWaitSeconds(event.target.valueAsNumber); }} /><span>秒</span><button type="button" aria-label="增加等待时间" disabled={state.waitSeconds >= 60} onClick={() => setCompanionWaitSeconds(state.waitSeconds + 1)}>＋</button></div>
                <small>从最后一次输入开始计时，0 秒为立即回复。</small>
            </div>}
            {active === "colors" && <div className="mc-color-panel">
                <button type="button" className="mc-translation-toggle mc-outline-toggle" role="switch" aria-label="译文描边" aria-checked={state.translationOutlineEnabled} onClick={() => setCompanionTranslationOutline(!state.translationOutlineEnabled)}><span>译文描边</span><span className="mc-translation-switch" aria-hidden="true" /></button>
                <div className="mc-color-fields">
                    <label><span>文字</span><input type="color" aria-label="译文文字颜色" value={state.translationColors.text} onChange={event => setCompanionTranslationColors({ text: event.target.value })} /><small>{state.translationColors.text.toUpperCase()}</small></label>
                    <label data-disabled={!state.translationOutlineEnabled || undefined}><span>描边</span><input type="color" aria-label="译文描边颜色" disabled={!state.translationOutlineEnabled} value={state.translationColors.outline} onChange={event => setCompanionTranslationColors({ outline: event.target.value })} /><small>{state.translationColors.outline.toUpperCase()}</small></label>
                </div>
                <div className="mc-color-preview-row"><span className="mc-color-preview">这是译文的样子</span><button type="button" onClick={() => setCompanionTranslationColors(DEFAULT_COMPANION_TRANSLATION_COLORS)}>恢复默认</button></div>
            </div>}
            {active === "music" && <CompanionMusicSettings />}
        </div>}
    </div>;
}

export function CompanionMusicActionPrompt() {
    const state = useControlState(), pending = state.pendingMusicAction;
    if (!pending && !state.musicActionNotice) return null;
    return <div className="mc-music-action" role="status" aria-live="polite">
        {pending ? <><div><small>{state.session?.name || "TA"} 想换首歌</small><b>{pending.action.kind === "next" ? "播放队列里的下一首" : `《${pending.action.title}》${pending.action.artist ? ` · ${pending.action.artist}` : ""}`}</b></div><div className="mc-music-action-buttons"><button type="button" onClick={dismissCompanionMusicAction}>暂不</button><button type="button" onClick={() => void confirmCompanionMusicAction(pending.id)}>切换</button></div></> : <><span>{state.musicActionNotice}</span>{!state.musicActionBusy && <button type="button" onClick={clearCompanionMusicNotice} aria-label="关闭切歌提示">×</button>}</>}
    </div>;
}
