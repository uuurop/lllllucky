"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useMusicPlayerOptional } from "@/lib/music-context";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import type { MusicTrack } from "@/lib/music-storage";
import { resolveUserIdentity } from "@/lib/settings-storage";
import {
    askCompanion, clearCompanionError, companionCharacterIssue, companionDuration, companionReplyDelaySeconds, DEFAULT_COMPANION_TRANSLATION_COLORS,
    finishCompanion, getCompanionServerState, getCompanionState, initializeCompanion,
    saveCompanionDraft, setCompanionMode, setCompanionPanelOpen, setCompanionTranslationAlwaysVisible, setCompanionTranslationColors, startCompanion, subscribeCompanion, tickCompanion,
    setCompanionTranslationOutline, setCompanionRoomTitle, setCompanionReplyInterval, summarizeCompanionRecord,
    queueCompanionMessage, noteCompanionInput, releaseCompanionInput, setCompanionWaitSeconds,
    type CompanionMessage, type CompanionMode, type CompanionRecord,
} from "@/lib/music-companion";
import { companionMessagePreview, splitCompanionText, type CompanionTextPart } from "@/lib/music-companion-messages";
import CompanionReplyActions from "./music-companion-message-actions";

const SHARE_EVENT = "music-companion-share-lyric";
const RECORDS_EVENT = "music-companion-open-records";
export function openCompanionRecords() { window.dispatchEvent(new Event(RECORDS_EVENT)); }
export function shareCompanionLyric(quote: string) {
    window.dispatchEvent(new CustomEvent(SHARE_EVENT, { detail: { quote } }));
}
export function useMusicCompanion() {
    return useSyncExternalStore(subscribeCompanion, getCompanionState, getCompanionServerState);
}

/** Lives alongside the music float, so returning to the virtual desktop keeps the session. */
export function MusicCompanionRuntime() {
    const player = useMusicPlayerOptional();
    const snapshot = useMusicCompanion();
    const playerRef = useRef(player);
    playerRef.current = player;
    const sessionId = snapshot.session?.id;
    const mode = snapshot.session?.mode;
    useEffect(() => {
        void initializeCompanion();
        window.addEventListener("pagehide", saveCompanionDraft);
        return () => window.removeEventListener("pagehide", saveCompanionDraft);
    }, []);
    useEffect(() => {
        if (!sessionId || !player?.isPlaying) return;
        let last = performance.now();
        const capture = () => {
            const now = performance.now();
            const current = playerRef.current;
            if (current?.currentTrack && current.isPlaying && getCompanionState().session?.id === sessionId) tickCompanion(current.currentTrack, (now - last) / 1000);
            last = now;
        };
        if (playerRef.current?.currentTrack) tickCompanion(playerRef.current.currentTrack, 0);
        const timer = setInterval(capture, 1000);
        return () => { clearInterval(timer); capture(); saveCompanionDraft(); };
    }, [sessionId, player?.isPlaying, player?.currentTrack?.id]);
    useEffect(() => {
        if (!sessionId || mode !== "occasional" || !player?.isPlaying) return;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        const schedule = () => {
            timer = setTimeout(async () => {
                const state = getCompanionState();
                const current = playerRef.current;
                if (!stopped && state.session?.id === sessionId && current?.isPlaying && current.currentTrack && !state.busy && !state.waiting && !state.userTyping && !state.error && document.visibilityState === "visible") {
                    await askCompanion(current.currentTrack, current.currentTime, { automatic: true });
                }
                if (!stopped) schedule();
            }, companionReplyDelaySeconds(snapshot.replyIntervalSeconds) * 1000);
        };
        schedule();
        return () => { stopped = true; clearTimeout(timer); };
    }, [sessionId, mode, player?.isPlaying, snapshot.replyIntervalSeconds]);
    return null;
}

function Headphones({ size = 18 }: { size?: number }) {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14v-3a8 8 0 0 1 16 0v3M7 12H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2zm10 0h2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2z" /></svg>;
}
function Avatar({ src, name, className = "" }: { src?: string | null; name: string; className?: string }) {
    return <span className={`mc-avatar ${className}`}>{src ? <img src={src} alt={name} /> : <span>{name.slice(0, 1)}</span>}</span>;
}
function CompanionBubble({ part, defaultExpanded }: { part: CompanionTextPart; defaultExpanded: boolean }) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    // The global switch sets a default; each bubble can still be toggled independently.
    useEffect(() => setExpanded(defaultExpanded), [defaultExpanded]);
    const translationId = useId();
    return <div className="mc-fragment">
        {part.translated ? <button type="button" className="mc-bubble mc-bubble-translatable"
            aria-expanded={expanded} aria-controls={translationId} title={expanded ? "收起译文" : "点击气泡查看译文"}
            onClick={() => setExpanded(value => !value)}>
            <span>{part.original}</span>
        </button> : <div className="mc-bubble"><span>{part.original}</span></div>}
        {part.translated && <div id={translationId} className="mc-translation" data-open={expanded} aria-hidden={!expanded}>
            <div><p lang="zh-Hans">{part.translated}</p></div>
        </div>}
    </div>;
}
function CompanionMessageGroup({ message, name, avatar, currentSong, showTranslations, laterCount, busy }: { message: CompanionMessage; name: string; avatar: string | null; currentSong: string; showTranslations: boolean; laterCount: number; busy: boolean }) {
    const parts = useMemo(() => message.role === "assistant" ? splitCompanionText(message.text) : [{ original: message.text }], [message.role, message.text]);
    const bubbles = parts.map((part, index) => <CompanionBubble key={`${index}:${part.original}:${part.translated || ""}`} part={part} defaultExpanded={showTranslations} />);
    return <div className={`mc-message mc-message-${message.role}`}>
        {message.role === "assistant" && <Avatar src={avatar} name={name} />}
        <div className="mc-message-body">
            {message.quote && <blockquote>{message.quote}</blockquote>}
            {message.role === "assistant" ? <CompanionReplyActions message={message} laterCount={laterCount} busy={busy}>{bubbles}</CompanionReplyActions> : bubbles}
            {message.song !== currentSong && <em>关于《{message.song}》</em>}
        </div>
    </div>;
}
function ModePicker({ mode, onChange }: { mode: CompanionMode; onChange: (mode: CompanionMode) => void }) {
    const { replyIntervalSeconds } = useMusicCompanion();
    const [intervalOpen, setIntervalOpen] = useState(false);
    return <div className="mc-mode-picker"><div className="mc-modes" role="group" aria-label="陪听模式">
        <button type="button" aria-pressed={mode === "quiet"} onClick={() => { setIntervalOpen(false); onChange("quiet"); }}><span>安静陪伴</span><small>你开口，TA 再回应</small></button>
        <button type="button" aria-pressed={mode === "occasional"} aria-expanded={intervalOpen && mode === "occasional"} onClick={() => { if (mode === "occasional") setIntervalOpen(value => !value); else { onChange("occasional"); setIntervalOpen(false); } }}><span>偶尔说话</span><small>{replyIntervalSeconds === null ? "约每 1.5～3 分钟" : `间隔 ${replyIntervalSeconds >= 60 ? `${Math.round(replyIntervalSeconds / 60 * 100) / 100} 分钟` : `${replyIntervalSeconds} 秒`}`} · 再点设置</small></button>
    </div>{intervalOpen && mode === "occasional" && <ReplyIntervalPicker value={replyIntervalSeconds} onSaved={() => setIntervalOpen(false)} />}</div>;
}
function ReplyIntervalPicker({ value, onSaved }: { value: number | null; onSaved: () => void }) {
    const [unit, setUnit] = useState<"seconds" | "minutes">("minutes");
    const [amount, setAmount] = useState(String((value || 180) / 60));
    const [error, setError] = useState("");
    const save = (seconds: number | null) => { setCompanionReplyInterval(seconds); onSaved(); };
    return <div className="mc-interval-panel" role="group" aria-label="角色发言间隔">
        <div className="mc-interval-heading"><b>发言间隔</b><small>播放音乐时生效</small></div>
        <div className="mc-interval-presets">{[30, 60, 180, 300, 600].map(seconds => <button type="button" key={seconds} aria-pressed={value === seconds} onClick={() => save(seconds)}>{seconds < 60 ? `${seconds}秒` : `${seconds / 60}分钟`}</button>)}<button type="button" aria-pressed={value === null} onClick={() => save(null)}>默认随机</button></div>
        <form className="mc-interval-custom" onSubmit={event => { event.preventDefault(); const seconds = Number(amount) * (unit === "minutes" ? 60 : 1); if (!Number.isFinite(seconds) || seconds < 15 || seconds > 3600) { setError("请设置 15 秒至 60 分钟之间的间隔"); return; } save(Math.round(seconds)); }}>
            <input type="number" step="any" min={unit === "minutes" ? .25 : 15} max={unit === "minutes" ? 60 : 3600} aria-label="自定义发言间隔" value={amount} onChange={event => { setAmount(event.target.value); setError(""); }} />
            <select aria-label="发言间隔单位" value={unit} onChange={event => { const next = event.target.value as typeof unit; const seconds = Number(amount) * (unit === "minutes" ? 60 : 1); setAmount(String(next === "minutes" ? Math.round(seconds / 60 * 100) / 100 : Math.round(seconds))); setUnit(next); }}><option value="seconds">秒</option><option value="minutes">分钟</option></select>
            <button type="submit">保存</button>
        </form>{error && <p role="alert">{error}</p>}
    </div>;
}
function EditableCompanionTitle({ title }: { title: string }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(title);
    const cancelled = useRef(false);
    const save = () => { if (!cancelled.current) setCompanionRoomTitle(draft); setEditing(false); };
    if (editing) return <input className="mc-title-input" aria-label="一起听标题" value={draft} maxLength={40} autoFocus onChange={event => setDraft(event.target.value)} onBlur={save} onKeyDown={event => { if (event.nativeEvent.isComposing) return; if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); save(); } if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelled.current = true; setEditing(false); } }} />;
    return <button type="button" className="mc-title-edit" aria-label="修改一起听标题" title="点击修改标题" onClick={() => { cancelled.current = false; setDraft(title); setEditing(true); }}><span>{title}</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m16 3 5 5-12 12H4v-5Z" /></svg></button>;
}
function RecordCard({ record, detail = false }: { record: CompanionRecord; detail?: boolean }) {
    const date = new Date(record.startedAt);
    return <div className={`mc-record ${detail ? "mc-record-detail" : ""}`}>
        <div className="mc-record-date">{date.toLocaleDateString(undefined, { month: "long", day: "numeric" })} · {date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</div>
        <strong>和 {record.name}，一起听过</strong>
        <div className="mc-record-stats"><span><b>{companionDuration(record.seconds)}</b>陪伴时长</span><span><b>{record.tracks.length}</b>首歌</span></div>
        {record.summary ? <p className="mc-record-summary">{record.summary}</p> : record.summaryStatus ? <p className="mc-record-summary mc-record-summary-muted">{record.summaryStatus === "pending" ? "TA 正在留下一句话…" : "留言暂未生成，聊天和歌曲已保存。"}</p> : record.quote && <blockquote>“{companionMessagePreview(record.quote)}”</blockquote>}
        <div className="mc-record-songs">{record.tracks.slice(0, detail ? 100 : 3).map(track => <span key={track.id}>♪ {track.title}<small>{track.artist}</small></span>)}</div>
        {!record.tracks.length && <p>这次还没有开始播放歌曲。</p>}
        {!detail && record.tracks.length > 3 && <small>还有 {record.tracks.length - 3} 首</small>}
        {record.interrupted && <small>上次离开页面时保存的陪听</small>}
    </div>;
}

type Sheet = "invite" | "chat" | "records" | "summary" | null;
export default function MusicCompanion({ track, currentTime, isPlaying, onTogglePlay, onNext, backgroundStyle }: {
    track: MusicTrack; currentTime: number; isPlaying: boolean; onTogglePlay: () => void; onNext: () => void; backgroundStyle?: CSSProperties;
}) {
    const snapshot = useMusicCompanion();
    const { session, busy, error } = snapshot;
    const translationStyle = { "--mc-translation-color": snapshot.translationColors.text, "--mc-translation-outline": snapshot.translationOutlineEnabled ? snapshot.translationColors.outline : "transparent" } as CSSProperties;
    const [colorsOpen, setColorsOpen] = useState(false);
    const [waitOpen, setWaitOpen] = useState(false);
    const [waitDraft, setWaitDraft] = useState(String(snapshot.waitSeconds));
    useEffect(() => setWaitDraft(String(snapshot.waitSeconds)), [snapshot.waitSeconds, waitOpen]);
    const colorsId = useId();
    const [sheet, setSheetNow] = useState<Sheet>(null);
    const [motion, setMotion] = useState<"opening" | "closing" | "switch-out" | "switch-in" | null>(null);
    const motionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [characters, setCharacters] = useState<Character[]>([]);
    const [selected, setSelected] = useState("");
    const [mode, setMode] = useState<CompanionMode>("occasional");
    const [draft, setDraft] = useState("");
    const [quote, setQuote] = useState("");
    const [summary, setSummary] = useState<CompanionRecord | null>(null);
    const currentSummary = snapshot.records.find(item => item.id === summary?.id) || summary;
    const [confirmEnd, setConfirmEnd] = useState(false);
    const [overlayHost, setOverlayHost] = useState<HTMLElement | null>(null);
    const entry = useRef<HTMLDivElement>(null);
    const thread = useRef<HTMLDivElement>(null);
    const composer = useRef<HTMLInputElement>(null);
    const dialog = useRef<HTMLElement>(null);
    const openRef = useRef(sheet);
    openRef.current = sheet;
    const setSheet = useCallback((next: Sheet) => {
        if (motionTimer.current) clearTimeout(motionTimer.current);
        const current = openRef.current;
        const preference = entry.current?.closest<HTMLElement>(".music-player")?.dataset.companionMotion || "auto";
        const disabled = preference === "off" || (preference !== "on" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
        if (disabled) { setSheetNow(next); setMotion(null); return; }
        if (!current && next) {
            setSheetNow(next); setMotion("opening");
            motionTimer.current = setTimeout(() => setMotion(null), 380);
        } else if (current && !next) {
            setMotion("closing");
            motionTimer.current = setTimeout(() => { setSheetNow(null); setMotion(null); }, 260);
        } else if (current !== next) {
            setMotion("switch-out");
            motionTimer.current = setTimeout(() => {
                setSheetNow(next); setMotion("switch-in");
                motionTimer.current = setTimeout(() => setMotion(null), 220);
            }, 140);
        } else setMotion(null);
    }, []);
    useEffect(() => () => { if (motionTimer.current) clearTimeout(motionTimer.current); }, []);
    const messageCount = session?.messages.length || 0;
    const lastMessageText = session?.messages[messageCount - 1]?.text;
    const identity = useMemo(() => resolveUserIdentity(session?.characterId || selected, "chat"), [session?.characterId, selected, snapshot.ready]);
    useEffect(() => { void initializeCompanion(); }, []);
    useEffect(() => { setOverlayHost(entry.current?.closest<HTMLElement>(".music-player") || null); }, []);
    useEffect(() => {
        if (sheet !== "invite") return;
        const available = loadCharacters();
        setCharacters(available);
        setSelected(available.some(item => item.id === snapshot.lastCharacterId) ? snapshot.lastCharacterId : available[0]?.id || "");
        setMode(snapshot.mode);
    }, [sheet, snapshot.ready]);
    useEffect(() => {
        const share = (event: Event) => {
            const incoming = (event as CustomEvent<{ quote: string }>).detail?.quote;
            if (!getCompanionState().session || typeof incoming !== "string" || !incoming.trim()) return;
            setQuote(incoming.slice(0, 600));
            setSheet("chat");
        };
        window.addEventListener(SHARE_EVENT, share);
        const showRecords = () => setSheet("records");
        window.addEventListener(RECORDS_EVENT, showRecords);
        return () => {
            window.removeEventListener(SHARE_EVENT, share);
            window.removeEventListener(RECORDS_EVENT, showRecords);
        };
    }, []);
    useEffect(() => {
        if (snapshot.roomRequested && session) setSheet("chat");
    }, [snapshot.roomRequested, session?.id, setSheet]);
    useEffect(() => {
        setCompanionPanelOpen(!!sheet);
        return () => setCompanionPanelOpen(false);
    }, [sheet]);
    useEffect(() => {
        setConfirmEnd(false);
        if (sheet !== "chat") { setColorsOpen(false); setWaitOpen(false); }
    }, [sheet]);
    useEffect(() => {
        if (!sheet) return;
        const previous = document.activeElement as HTMLElement | null;
        dialog.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
        return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
    }, [sheet]);
    useEffect(() => {
        if (confirmEnd) dialog.current?.querySelector<HTMLButtonElement>(".mc-end-confirm button")?.focus({ preventScroll: true });
    }, [confirmEnd]);
    useEffect(() => {
        if (sheet === "chat" && thread.current) thread.current.scrollTop = thread.current.scrollHeight;
    }, [sheet, messageCount, lastMessageText, busy, quote]);
    useEffect(() => () => releaseCompanionInput(), [session?.id]);
    useEffect(() => { setQuote(""); setDraft(""); }, [session?.id, track.id]);
    const activeCharacter = characters.find(character => character.id === selected);
    const issue = activeCharacter ? companionCharacterIssue(activeCharacter) : "";
    const start = () => {
        if (!activeCharacter || !startCompanion(activeCharacter, mode)) return;
        tickCompanion(track, 0);
        setSheet("chat");
        void askCompanion(track, currentTime, { greeting: true });
    };
    const send = () => {
        if (!draft.trim() && !quote) return;
        const text = draft.trim();
        const shared = quote;
        setDraft(""); setQuote("");
        queueCompanionMessage(track, currentTime, { text: text || "想把这句歌词分享给你。", quote: shared || undefined });
        composer.current?.focus();
    };
    const finish = () => {
        const result = finishCompanion();
        setSummary(result);
        setSheet("summary");
        setQuote(""); setDraft("");
    };
    const title = sheet === "invite" ? "让音乐，多一个人听" : sheet === "chat" ? snapshot.roomTitle : sheet === "records" ? "一起听过的时光" : "把这一刻留下来";
    return <>
        <div ref={entry} className="mc-social-entry">
            <button className="mc-social-invite" disabled={!snapshot.ready} aria-expanded={!!sheet} aria-controls="music-companion-sheet" onClick={() => setSheet(session ? "chat" : "invite")}>
                <Headphones size={18} />
                <span>{session ? `和 ${session.name} 一起听` : "邀请 TA 一起听"}</span>
            </button>
        </div>
        {sheet && overlayHost && createPortal(<div className="mc-mask" data-motion={motion || undefined} onClick={() => setSheet(null)} onKeyDown={event => {
            if (event.key === "Escape") { event.stopPropagation(); setSheet(null); }
            if (event.key !== "Tab") return;
            const scope = confirmEnd ? dialog.current?.querySelector(".mc-end-confirm") : dialog.current;
            const buttons = scope?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea, select:not(:disabled)");
            if (!buttons?.length) return;
            const first = buttons[0], last = buttons[buttons.length - 1];
            if (event.shiftKey && (document.activeElement === first || !scope?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && (document.activeElement === last || !scope?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
        }}>
            <section ref={dialog} id="music-companion-sheet" className={`mc-sheet mc-sheet-${sheet}`} data-motion={motion || undefined} style={backgroundStyle} role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}>
                <span className="mc-handle" aria-hidden="true" />
                <header className="mc-sheet-head"><div><small>LISTEN TOGETHER</small><h2>{sheet === "chat" ? <EditableCompanionTitle title={title} /> : title}</h2></div><button className="mc-icon-button" onClick={() => setSheet(null)} aria-label="收起陪听面板"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg></button></header>
                {sheet === "invite" && <>
                    <div className="mc-scroll">
                        <div className="mc-invite-preview"><span className="mc-pair mc-pair-large"><Avatar src={identity?.avatarUrl} name="我" /><Avatar src={activeCharacter?.avatar} name={activeCharacter?.name || "TA"} /></span><strong>和 {activeCharacter?.name || "TA"}，从这首歌开始</strong><span>《{track.title}》 · {track.artist}</span></div>
                        <div className="mc-section-title">选一个陪你听歌的人<small>{characters.length} 位角色</small></div>
                        <div className="mc-character-list">{characters.map(character => <button key={character.id} className="mc-character" aria-pressed={selected === character.id} onClick={() => setSelected(character.id)}><Avatar src={character.avatar} name={character.name} /><span><b>{character.name}</b><small>{companionCharacterIssue(character) || "一起分享这一刻"}</small></span><i>{selected === character.id ? "✓" : ""}</i></button>)}</div>
                        {!characters.length && <p className="mc-empty">还没有角色，先创建一个你想一起听歌的人吧。</p>}
                        <div className="mc-section-title">想怎样一起听</div>
                        <ModePicker mode={mode} onChange={setMode} />
                        <p className="mc-note">收起面板后陪听仍会继续。TA 优先使用角色的音乐 API，未单独配置时使用全局 API。</p>
                    </div>
                    <footer className="mc-sheet-footer"><button className="mc-primary" onClick={start} disabled={!snapshot.ready || !activeCharacter || !!issue || !!session}><Headphones size={17} />{issue ? "先完善角色设置" : "开始一起听"}</button>{issue && <small className="mc-inline-note">{issue}</small>}</footer>
                </>}
                {sheet === "chat" && session && <>
                    <div className="mc-room-info"><span className="mc-pair"><Avatar src={identity?.avatarUrl} name="我" /><Avatar src={session.avatar} name={session.name} /></span><span><b>和 {session.name} 一起听</b><small>已陪伴 {companionDuration(session.seconds)}</small></span><button className="mc-end" onClick={() => setConfirmEnd(true)}>结束</button></div>
                    <div className="mc-room-mode"><ModePicker mode={session.mode} onChange={setCompanionMode} /></div>
                    <div className="mc-now"><div>{track.coverUrl ? <img src={track.coverUrl} alt="" /> : <Headphones size={22} />}</div><span><b>{track.title}</b><small>{track.artist || "未知歌手"}</small></span><button className="mc-icon-button" onClick={onTogglePlay} aria-label={isPlaying ? "暂停" : "播放"}>{isPlaying ? "Ⅱ" : "▶"}</button><button className="mc-icon-button" onClick={onNext} aria-label="下一首">››</button></div>
                    <div className="mc-thread" ref={thread} style={translationStyle}>
                        <div className="mc-thread-date">陪听已开始</div>
                        {session.messages.map((message, index) => <CompanionMessageGroup key={message.id} message={message} name={session.name} avatar={session.avatar} currentSong={track.title} showTranslations={snapshot.translationAlwaysVisible} laterCount={session.messages.length - index - 1} busy={busy || snapshot.waiting || snapshot.userTyping} />)}
                        {busy && <div className="mc-typing" role="status"><span /><span /><span /><small>{session.name} 正在输入</small></div>}
                        {snapshot.waiting && <div className="mc-waiting" role="status">等你说完，再慢慢回应…</div>}
                        {!session.messages.length && !busy && <p className="mc-empty">可以聊聊这首歌，也可以在歌词页分享一句给 TA。</p>}
                    </div>
                    {error && <div className="mc-error" role="status"><span>{error}</span><button onClick={() => void askCompanion(track, currentTime)}>重试</button><button onClick={clearCompanionError} aria-label="关闭提示">×</button></div>}
                    <div className="mc-composer-wrap">
                        <div className="mc-composer-tools">
                            <button type="button" className="mc-translation-toggle" role="switch" aria-checked={snapshot.translationAlwaysVisible}
                                onClick={() => setCompanionTranslationAlwaysVisible(!snapshot.translationAlwaysVisible)}>
                                <span>翻译常显</span><span className="mc-translation-switch" aria-hidden="true" />
                            </button>
                            <button type="button" className="mc-color-button mc-wait-button" aria-expanded={waitOpen} onClick={() => { setWaitOpen(value => !value); setColorsOpen(false); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg><span>等待 {snapshot.waitSeconds}秒</span></button>
                            <button type="button" className="mc-color-button" aria-expanded={colorsOpen} aria-controls={colorsId} onClick={() => { setColorsOpen(value => !value); setWaitOpen(false); }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4l-.3-.3A1.9 1.9 0 0 1 15.5 14H17a4 4 0 0 0 4-4c0-4-4-7-9-7Z" /><circle cx="7.5" cy="10" r=".8" /><circle cx="11" cy="6.5" r=".8" /><circle cx="16" cy="8" r=".8" /></svg>
                                <span>译文颜色</span>
                            </button>
                        </div>
                        {waitOpen && <div className="mc-wait-settings" role="group" aria-label="回复等待时间"><label htmlFor={`${colorsId}-wait`}>回复等待</label><div><button type="button" aria-label="减少等待时间" disabled={snapshot.waitSeconds <= 0} onClick={() => setCompanionWaitSeconds(snapshot.waitSeconds - 1)}>−</button><input id={`${colorsId}-wait`} type="number" min={0} max={60} step={1} aria-label="回复等待秒数" value={waitDraft} onBlur={() => setWaitDraft(String(getCompanionState().waitSeconds))} onChange={event => { setWaitDraft(event.target.value); if (Number.isFinite(event.target.valueAsNumber)) setCompanionWaitSeconds(event.target.valueAsNumber); }} /><span>秒</span><button type="button" aria-label="增加等待时间" disabled={snapshot.waitSeconds >= 60} onClick={() => setCompanionWaitSeconds(snapshot.waitSeconds + 1)}>＋</button></div><small>停止输入后开始计时，0秒为立即回复。</small></div>}
                        {colorsOpen && <div id={colorsId} className="mc-color-panel" role="group" aria-label="译文颜色设置" style={translationStyle}>
                            <button type="button" className="mc-translation-toggle mc-outline-toggle" role="switch" aria-label="译文描边" aria-checked={snapshot.translationOutlineEnabled} onClick={() => setCompanionTranslationOutline(!snapshot.translationOutlineEnabled)}><span>译文描边</span><span className="mc-translation-switch" aria-hidden="true" /></button>
                            <div className="mc-color-fields">
                                <label><span>文字</span><input type="color" aria-label="译文文字颜色" value={snapshot.translationColors.text} onChange={event => setCompanionTranslationColors({ text: event.target.value })} /><small>{snapshot.translationColors.text.toUpperCase()}</small></label>
                                <label data-disabled={!snapshot.translationOutlineEnabled || undefined}><span>描边</span><input type="color" aria-label="译文描边颜色" disabled={!snapshot.translationOutlineEnabled} value={snapshot.translationColors.outline} onChange={event => setCompanionTranslationColors({ outline: event.target.value })} /><small>{snapshot.translationColors.outline.toUpperCase()}</small></label>
                            </div>
                            <div className="mc-color-preview-row"><span className="mc-color-preview">这是译文的样子</span><button type="button" onClick={() => setCompanionTranslationColors(DEFAULT_COMPANION_TRANSLATION_COLORS)}>恢复默认</button></div>
                        </div>}
                        {quote && <div className="mc-quote-draft"><span>分享歌词<q>{quote}</q></span><button onClick={() => setQuote("")} aria-label="取消分享歌词">×</button></div>}
                        <form className="mc-composer" onSubmit={event => { event.preventDefault(); send(); }}><input ref={composer} value={draft} maxLength={500} onChange={event => { setDraft(event.target.value); noteCompanionInput((event.nativeEvent as InputEvent).isComposing); }} onCompositionStart={() => noteCompanionInput(true)} onCompositionEnd={() => noteCompanionInput(false)} onBlur={releaseCompanionInput} onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} placeholder={quote ? "这句歌词，让你想到了什么？" : `和 ${session.name} 说点什么…`} aria-label="陪听聊天内容" /><button type="submit" disabled={!draft.trim() && !quote} aria-label="发送陪听消息">↑</button></form>
                        <small className="mc-footer-hint">收起只隐藏聊天 · 音乐和陪伴继续</small>
                    </div>
                    {confirmEnd && <div className="mc-end-confirm"><strong>结束这次一起听？</strong><p>保存歌曲与聊天，回到私聊也能接着聊。音乐继续播放。</p><div><button className="mc-secondary" onClick={() => setConfirmEnd(false)}>再听一会儿</button><button className="mc-primary" onClick={finish}>结束并留个纪念</button></div></div>}
                </>}
                {sheet === "chat" && !session && <p className="mc-empty">这次陪听已结束。收起面板后可以重新邀请。</p>}
                {sheet === "records" && <div className="mc-scroll mc-record-list">{snapshot.records.length ? snapshot.records.map(item => <button key={item.id} className="mc-record-button" onClick={() => { setSummary(item); setSheet("summary"); }}><RecordCard record={item} /></button>) : <div className="mc-empty mc-empty-records"><Headphones size={36} /><strong>还没有一起听的记录</strong><span>邀请 TA 听完一首歌，留住第一个片刻。</span></div>}</div>}
                {sheet === "summary" && <><div className="mc-scroll">{currentSummary && <RecordCard record={currentSummary} detail />}{currentSummary?.summaryStatus === "failed" && (!!currentSummary.messages?.length || !!currentSummary.tracks.length) && <button type="button" className="mc-summary-retry" onClick={() => void summarizeCompanionRecord(currentSummary.id)}>重新生成留言</button>}</div><footer className="mc-sheet-footer"><button className="mc-primary" onClick={() => setSheet(null)}>收好这一刻</button></footer></>}
            </section>
        </div>, overlayHost)}
    </>;
}
