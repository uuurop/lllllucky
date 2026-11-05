"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMusicPlayerOptional } from "@/lib/music-context";
import { getCloudSongLiked, setCloudSongLiked, getNeteaseLyrics } from "@/lib/music-service";
import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import type { MusicTrack } from "@/lib/music-storage";

const LYRICS_EVENT = "music-desktop-lyrics-toggle";
const POSITION_KEY = "music-desktop-lyrics-position-v1";
const APPEARANCE_KEY = "music-desktop-lyrics-appearance-v1";
registerKvMigration(POSITION_KEY);
registerKvMigration(APPEARANCE_KEY);
const LYRIC_COLORS = [
    { name: "白色", value: "#ffffff" },
    { name: "黑色", value: "#202124" },
    { name: "黄色", value: "#ffe36e" },
    { name: "绿色", value: "#8ee8ad" },
    { name: "蓝色", value: "#8dcaff" },
    { name: "粉色", value: "#ffadd6" },
];

export function DesktopLyricsButton() {
    return <button type="button" className="music-float-island-btn music-float-extra" aria-label="桌面歌词（锁定时点击解锁）" title="桌面歌词（锁定时点击解锁）" onClick={e => { e.stopPropagation(); window.dispatchEvent(new Event(LYRICS_EVENT)); }}>词</button>;
}

export function CloudLikeButton({ track }: { track: MusicTrack }) {
    const [liked, setLiked] = useState<boolean | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const activeId = useRef(track.id);
    activeId.current = track.id;
    const pending = useRef(false);
    const songId = /^netease_(\d+)$/.exec(track.id)?.[1];
    useEffect(() => {
        let disposed = false;
        setLiked(null);
        setMessage("");
        pending.current = !!songId;
        setBusy(!!songId);
        if (songId) getCloudSongLiked(Number(songId)).then(value => {
            if (!disposed) setLiked(value);
        }).catch(() => { /* Click retries and explains login/network failures. */ }).finally(() => {
            if (!disposed) { pending.current = false; setBusy(false); }
        });
        return () => { disposed = true; };
    }, [songId]);
    useEffect(() => {
        if (!message) return;
        const timer = setTimeout(() => setMessage(""), 3500);
        return () => clearTimeout(timer);
    }, [message]);
    const toggle = async () => {
        if (pending.current) return;
        if (!songId) { setMessage("本地歌曲无法同步到网易云红心歌单"); return; }
        const id = track.id;
        pending.current = true;
        setBusy(true);
        try {
            const current = liked ?? await getCloudSongLiked(Number(songId));
            if (activeId.current !== id) return;
            await setCloudSongLiked(Number(songId), !current);
            if (activeId.current === id) {
                setLiked(!current);
                setMessage(!current ? "已加入网易云我喜欢的音乐" : "已取消网易云红心");
            }
        } catch (error) {
            if (activeId.current === id) setMessage(error instanceof Error ? error.message : "同步失败，请重试");
        } finally { pending.current = false; setBusy(false); }
    };
    return <>
        <button type="button" className="music-float-island-btn music-float-extra" data-liked={liked === true ? "" : undefined} aria-label={liked ? "取消网易云红心" : "加入网易云我喜欢的音乐"} aria-pressed={liked === true} disabled={busy} onClick={e => { e.stopPropagation(); void toggle(); }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" /></svg>
        </button>
        {message && <span className="music-float-feedback" role="status" onClick={e => e.stopPropagation()}>{message}</span>}
    </>;
}

function parseLyrics(lrc: string) {
    const lines: { time: number; text: string }[] = [];
    const offset = Number(/\[offset:([+-]?\d+)\]/i.exec(lrc)?.[1] || 0) / 1000;
    for (const line of lrc.split(/\r?\n/)) {
        const tags = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
        const text = line.replace(/\[[^\]]*\]/g, "").trim();
        for (const tag of tags) lines.push({ time: Number(tag[1]) * 60 + Number(tag[2]) - offset, text });
    }
    return lines.sort((a, b) => a.time - b.time);
}

export default function MusicDesktopLyrics({ hidden = false }: { hidden?: boolean }) {
    const player = useMusicPlayerOptional();
    const [visible, setVisible] = useState(false);
    const [locked, setLocked] = useState(false);
    const [position, setPosition] = useState({ x: 20, y: 380 });
    const [appearance, setAppearance] = useState({ size: 18, color: "#ffffff" });
    const [lyrics, setLyrics] = useState("");
    const [loading, setLoading] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
    const lockedRef = useRef(locked);
    lockedRef.current = locked;
    useEffect(() => {
        try {
            const saved = JSON.parse(kvGet(POSITION_KEY) || "null");
            if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) setPosition(saved);
        } catch { /* Default position. */ }
        try {
            const saved = JSON.parse(kvGet(APPEARANCE_KEY) || "null");
            if (saved) setAppearance({
                size: Number.isFinite(saved.size) ? Math.max(12, Math.min(30, Math.round(saved.size))) : 18,
                color: LYRIC_COLORS.some(color => color.value === saved.color) ? saved.color : "#ffffff",
            });
        } catch { /* Default appearance. */ }
        const toggle = () => {
            if (lockedRef.current) { setLocked(false); setVisible(true); }
            else setVisible(value => !value);
        };
        window.addEventListener(LYRICS_EVENT, toggle);
        return () => window.removeEventListener(LYRICS_EVENT, toggle);
    }, []);
    const track = player?.currentTrack;
    useEffect(() => {
        let disposed = false;
        setLyrics(track?.lyrics || "");
        setLoading(false);
        const songId = /^netease_(\d+)$/.exec(track?.id || "")?.[1];
        if (visible && !track?.lyrics && songId) {
            setLoading(true);
            getNeteaseLyrics(Number(songId)).then(value => { if (!disposed) setLyrics(value); }).catch(() => { if (!disposed) setLyrics(""); }).finally(() => { if (!disposed) setLoading(false); });
        }
        return () => { disposed = true; };
    }, [track?.id, track?.lyrics, visible]);
    const lines = useMemo(() => parseLyrics(lyrics), [lyrics]);
    let index = -1;
    for (let i = lines.length - 1; i >= 0; i--) if ((player?.currentTime || 0) >= lines[i].time) { index = i; break; }
    const plain = lyrics.replace(/\[[^\]]*\]/g, "").trim().split(/\r?\n/).filter(Boolean);
    const text = lines.length ? (index < 0 ? "前奏…" : lines[index].text || "间奏…") : loading ? "歌词加载中…" : plain[0] || "暂无歌词";
    const next = lines.length ? lines[index + 1]?.text : plain[1];
    useEffect(() => {
        if (!visible || hidden || !root.current) return;
        const el = root.current;
        const parent = el.closest("[data-ui='phone-screen']") as HTMLElement | null;
        if (!parent) return;
        const clamp = () => setPosition(p => ({ x: Math.max(0, Math.min(p.x, parent.clientWidth - el.offsetWidth)), y: Math.max(0, Math.min(p.y, parent.clientHeight - el.offsetHeight)) }));
        clamp();
        const observer = new ResizeObserver(clamp);
        observer.observe(parent);
        observer.observe(el);
        return () => observer.disconnect();
    }, [visible, hidden]);
    const changeAppearance = (next: typeof appearance) => {
        setAppearance(next);
        kvSet(APPEARANCE_KEY, JSON.stringify(next));
    };
    const lyricStyle = {
        color: appearance.color,
        textShadow: appearance.color === "#202124" ? "0 1px 2px rgba(255,255,255,.8)" : "0 1px 3px #000",
    };
    if (!visible || !track || hidden) return null;
    return <div ref={root} className="music-desktop-lyrics" data-locked={locked ? "" : undefined} style={{ left: position.x, top: position.y }} onPointerDown={e => {
        if (locked || (e.target as HTMLElement).closest("button") || e.button !== 0) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: position.x, top: position.y };
    }} onPointerMove={e => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const parent = e.currentTarget.closest("[data-ui='phone-screen']") as HTMLElement | null;
        if (!parent) return;
        const rect = parent.getBoundingClientRect();
        const scaleX = rect.width / parent.clientWidth || 1;
        const scaleY = rect.height / parent.clientHeight || 1;
        setPosition({ x: Math.max(0, Math.min(d.left + (e.clientX - d.x) / scaleX, parent.clientWidth - e.currentTarget.offsetWidth)), y: Math.max(0, Math.min(d.top + (e.clientY - d.y) / scaleY, parent.clientHeight - e.currentTarget.offsetHeight)) });
    }} onPointerUp={e => {
        if (drag.current?.id !== e.pointerId) return;
        drag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        kvSet(POSITION_KEY, JSON.stringify(position));
    }} onPointerCancel={() => { drag.current = null; }}>
        {!locked && <div className="music-desktop-lyrics-tools"><span className="music-desktop-lyrics-label"><i aria-hidden="true">⠿</i> 桌面歌词 <small>拖动调整位置</small></span><button type="button" onClick={() => setLocked(true)}>锁定</button><button type="button" className="music-desktop-lyrics-close" aria-label="关闭桌面歌词" onClick={() => setVisible(false)}>×</button></div>}
        <div className="music-desktop-lyrics-lines">
            <div className="music-desktop-lyrics-current" style={{ ...lyricStyle, fontSize: appearance.size }} aria-live="off">{text}</div>
            {next && <div className="music-desktop-lyrics-next" style={{ ...lyricStyle, fontSize: Math.max(12, appearance.size - 4) }}>{next}</div>}
        </div>
        {!locked && <>
            <div className="music-desktop-lyrics-appearance" onPointerDown={e => e.stopPropagation()}>
                <div className="music-desktop-lyrics-size">
                    <button type="button" aria-label="缩小歌词字号" disabled={appearance.size <= 12} onClick={() => changeAppearance({ ...appearance, size: Math.max(12, appearance.size - 2) })}>－</button>
                    <span aria-label={`歌词字号 ${appearance.size}`}>{appearance.size}</span>
                    <button type="button" aria-label="放大歌词字号" disabled={appearance.size >= 30} onClick={() => changeAppearance({ ...appearance, size: Math.min(30, appearance.size + 2) })}>＋</button>
                </div>
                <div className="music-desktop-lyrics-colors" role="group" aria-label="歌词颜色">
                    {LYRIC_COLORS.map(color => <button key={color.value} type="button" aria-label={`${color.name}歌词`} title={color.name} aria-pressed={appearance.color === color.value} style={{ backgroundColor: color.value }} onClick={() => changeAppearance({ ...appearance, color: color.value })} />)}
                </div>
            </div>
        </>}
    </div>;
}
