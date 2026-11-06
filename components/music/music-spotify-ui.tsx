"use client";
/* eslint-disable @next/next/no-img-element -- Media URLs are user-configurable; retain native loading without changing global image configuration. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMusicPlayer } from "@/lib/music-context";
import type { MusicControlsValue } from "@/lib/music-context";
import type { NeteaseSearchResult } from "@/lib/music-service";
import { requestCompanionRoom, isCompanionConnected } from "@/lib/music-companion";
import { useMusicCompanion } from "./music-companion";
import { CloudLikeButton } from "./music-desktop-lyrics";

export function SpotifyIcon({ name, size = 22 }: { name: string; size?: number }) {
    const paths: Record<string, ReactNode> = {
        home: <path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z" />,
        search: <><circle cx="10.5" cy="10.5" r="7.5" /><path d="m16 16 5 5" /></>,
        library: <><path d="M4 3v18M9 3v18m5-17 5-1 3 17-5 1z" /></>,
        local: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" /></>,
        back: <path d="m15 4-8 8 8 8" />, arrow: <path d="M20 12H4m7-7-7 7 7 7" />, close: <path d="m5 5 14 14M5 19 19 5" />,
        plus: <path d="M12 3v18M3 12h18" />, play: <path d="m8 5 11 7-11 7z" />,
        pause: <path d="M8 5v14M16 5v14" />, check: <path d="m5 12 4 4L20 5" />,
        more: <><circle cx="4" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="20" cy="12" r="1" /></>,
        "more-vertical": <><circle cx="12" cy="4" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="20" r="1" /></>,
        sort: <><path d="M8 3v18m-4-4 4 4 4-4M16 21V3m-4 4 4-4 4 4" /></>,
        grid: <><rect x="3" y="3" width="6" height="6" /><rect x="15" y="3" width="6" height="6" /><rect x="3" y="15" width="6" height="6" /><rect x="15" y="15" width="6" height="6" /></>,
        list: <path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01" />,
        shuffle: <><path d="M3 5h3c5 0 7 14 12 14h3m-4-4 4 4-4 3M3 19h3c2 0 4-3 5-5m2-4c2-3 3-5 5-5h3m-4-3 4 3-4 4" /></>,
        heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />,
        headphones: <><path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12h3v8H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Zm16 0h-3v8h3a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2Z" /></>,
        note: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
    };
    return <svg width={size} height={size} viewBox="0 0 24 24" fill={name === "play" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={name === "pause" ? 4 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.note}</svg>;
}

export function SpotifyDetailNav({ onBack, onMore, backLabel = "返回", moreLabel = "音乐设置", expanded }: { onBack: () => void; onMore: () => void; backLabel?: string; moreLabel?: string; expanded?: boolean }) {
    return <nav className="spt-detail-nav" aria-label="音乐详情导航"><button className="spt-detail-nav-button" aria-label={backLabel} onClick={onBack}><SpotifyIcon name="arrow" size={25} /></button><button className="spt-detail-nav-button" aria-label={moreLabel} aria-expanded={expanded} onClick={onMore}><SpotifyIcon name="more-vertical" size={23} /></button></nav>;
}

export function musicCoverSource(src?: string) {
    let image = src;
    if (src) {
        try { const url = new URL(src); if (url.hostname.endsWith(".music.126.net") && !url.searchParams.has("param")) { url.searchParams.set("param", "320y320"); image = url.toString(); } } catch { /* Local/data/custom covers keep their original source. */ }
    }
    return image;
}
export function SpotifyCover({ src, name = "", round = false, liked = false }: { src?: string; name?: string; round?: boolean; liked?: boolean }) {
    const [failed, setFailed] = useState("");
    const image = musicCoverSource(src);
    return <span className={`spt-cover${round ? " spt-cover-round" : ""}${liked ? " spt-cover-liked" : ""}`}>
        {liked ? <SpotifyIcon name="heart" size={27} /> : image && failed !== image ? <img src={image} alt="" loading="lazy" onError={() => setFailed(image!)} /> : <span>{name.slice(0, 1) || "♪"}</span>}
    </span>;
}

export function SpotifySongRow({ song, onPlay, player, source }: { song: NeteaseSearchResult; onPlay: (song: NeteaseSearchResult) => void; player?: MusicControlsValue; source?: string }) {
    const [menu, setMenu] = useState(false);
    const queued = !!player?.queue.some(item => item.id === `netease_${song.id}`);
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!menu) return;
        const close = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setMenu(false); };
        document.addEventListener("pointerdown", close);
        return () => document.removeEventListener("pointerdown", close);
    }, [menu]);
    const active = player?.currentTrack?.id === `netease_${song.id}`;
    return <div ref={root} className="spt-song-row" data-playing={active || undefined} onKeyDown={event => { if (event.key === "Escape") setMenu(false); }}>
        <button className="spt-song-main" onClick={() => onPlay(song)}><SpotifyCover src={song.coverUrl} name={song.name} /><span><b>{song.name}</b><small>{song.artists}{song.album ? ` · ${song.album}` : ""}</small></span></button>
        {player && <button className="spt-icon" aria-label={`更多：${song.name}`} aria-expanded={menu} onClick={() => setMenu(value => !value)}><SpotifyIcon name="more" size={20} /></button>}
        {menu && player && <div className="spt-row-menu">
            <button onClick={() => { setMenu(false); onPlay(song); }}><SpotifyIcon name="play" size={15} />播放</button>
            <button onClick={() => { const track = { id: `netease_${song.id}`, title: song.name, artist: song.artists, duration: song.duration / 1000, coverUrl: song.coverUrl, liked: false, addedAt: new Date().toISOString(), playbackSource: source || "播放队列" }; if (!queued) player.setQueue([...player.queue, track]); }}><SpotifyIcon name={queued ? "check" : "plus"} size={15} />{queued ? "已在播放队列" : "加入播放队列"}</button>
        </div>}
    </div>;
}

export function SpotifyMiniPlayer() {
    const player = useMusicPlayer();
    const companion = useMusicCompanion();
    const track = player.currentTrack;
    if (!track) return null;
    const progress = player.duration > 0 ? Math.max(0, Math.min(100, player.currentTime / player.duration * 100)) : 0;
    return <div className="spt-mini-player">
        <button className="spt-mini-main" aria-label={`打开播放器：${track.title}`} onClick={player.openFullPlayer}><SpotifyCover src={track.coverUrl} name={track.title} /><span><b>{track.title}<i> · {track.artist}</i></b><small>{companion.session ? isCompanionConnected(companion.session) ? `和 ${companion.session.name} 一起听` : companion.session.invitation?.status === "failed" ? "一起听邀请未连接" : `正在邀请 ${companion.session.name}` : "当前播放"}</small></span></button>
        {companion.session ? <button className="spt-icon" aria-label="打开一起听聊天室" onClick={() => { requestCompanionRoom(); player.openFullPlayer(); }}><SpotifyIcon name="headphones" size={21} /></button> : <CloudLikeButton key={track.id} track={track} />}
        <button className="spt-icon spt-mini-play" aria-label={player.isPlaying ? "暂停" : "播放"} onClick={player.togglePlay}><SpotifyIcon name={player.isPlaying ? "pause" : "play"} size={22} /></button>
        <span className="spt-mini-progress"><i style={{ width: `${progress}%` }} /></span>
    </div>;
}
