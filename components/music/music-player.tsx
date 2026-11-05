// components/music/music-player.tsx — Full-screen immersive music player
// Cover-led now playing page and timestamp-aligned bilingual lyrics.
// A vinyl mode is kept as a switchable style for nostalgia.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMusicPlayer, type PlayMode } from "@/lib/music-context";
import { scrollElementWithinContainer } from "@/lib/dom-scroll";
import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import { extractCoverPalette, DEFAULT_COVER_PALETTE, type CoverPalette } from "@/lib/cover-color";
import {
    getUserPlaylists, addTracksToPlaylist, getNeteasePlayInfo,
    isNeteaseConfigured, recordTrackPlaylist,
    getSongCommentPage, getNeteaseSongDetail,
    type NeteasePlaylist,
} from "@/lib/music-service";
import MusicCommentsPage from "./music-comments";
import MusicArtistPage from "./music-artist";
import { loadMusicBg, playerBgStyle, MUSIC_BG_EVENT, type MusicBgConfig } from "@/lib/music-bg";
import { getNeteaseLyricBundle } from "@/lib/music-service";
import { bilingualLyrics } from "@/lib/music-lyrics";
import { CloudLikeButton } from "./music-desktop-lyrics";
import MusicCompanion, { openCompanionRecords, shareCompanionLyric, useMusicCompanion } from "./music-companion";

const COMPANION_MOTION_KEY = "music-companion-window-motion-v1";
registerKvMigration(COMPANION_MOTION_KEY);
type CompanionWindowMotion = "on" | "auto" | "off";

const PLAY_MODE_ICONS: Record<PlayMode, { svg: string; label: string }> = {
    sequence: {
        svg: `<path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
        label: "顺序播放",
    },
    shuffle: {
        svg: `<path d="M18 4l3 3-3 3M18 14l3 3-3 3M3 7h3a5 5 0 0 1 5 5 5 5 0 0 0 5 5h5M21 7h-5a5 5 0 0 0-3.16 1.13M3 17h3a5 5 0 0 0 3.16-1.13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
        label: "随机播放",
    },
    "repeat-one": {
        svg: `<path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><text x="12" y="15" text-anchor="middle" fill="currentColor" font-size="8" font-weight="bold">1</text>`,
        label: "单曲循环",
    },
};


function formatCount(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return "";
    if (value >= 100000000) return `${Math.round(value / 10000000) / 10}亿`;
    if (value >= 10000) return `${Math.round(value / 1000) / 10}万`;
    return String(value);
}

type PlayerStyle = "modern" | "vinyl";
type BodyView = "cover" | "lyrics";

export default function MusicPlayer() {
    const player = useMusicPlayer();
    const companion = useMusicCompanion();
    const lyricPress = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number; shared: boolean }>({ timer: null, x: 0, y: 0, shared: false });
    const progressRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragTime, setDragTime] = useState(0);
    const [view, setView] = useState<BodyView>("cover");
    const [showMore, setShowMore] = useState(false);
    const [companionMotion, setCompanionMotion] = useState<CompanionWindowMotion>(() => {
        const saved = kvGet(COMPANION_MOTION_KEY);
        return saved === "auto" || saved === "off" ? saved : "on";
    });
    const [showTranslation, setShowTranslation] = useState(true);
    const [browsingLyrics, setBrowsingLyrics] = useState(false);
    const [lyricBundle, setLyricBundle] = useState({ id: "", original: "", translated: "" });
    const [playerStyle, setPlayerStyle] = useState<PlayerStyle>(() =>
        (typeof window !== "undefined" && kvGet("music-player-cover-style-v2") === "vinyl") ? "vinyl" : "modern");
    const [showQueue, setShowQueue] = useState(false);
    const [showComments, setShowComments] = useState(false);
    const [artistView, setArtistView] = useState<{ id: number; name: string } | null>(null);
    const [palette, setPalette] = useState<CoverPalette>(DEFAULT_COVER_PALETTE);
    const [bgCfg, setBgCfg] = useState<MusicBgConfig>(() => loadMusicBg());
    const [commentTotal, setCommentTotal] = useState(0);

    useEffect(() => {
        const handleBgChange = () => setBgCfg(loadMusicBg());
        window.addEventListener(MUSIC_BG_EVENT, handleBgChange);
        return () => window.removeEventListener(MUSIC_BG_EVENT, handleBgChange);
    }, []);

    // kv cache hydrates asynchronously from IndexedDB — the initial read above
    // may run before it's ready, silently dropping the saved vinyl preference
    // and custom background. Re-read a few times until hydration has settled.
    useEffect(() => {
        const timers = [300, 1200, 3000].map(ms => setTimeout(() => {
            const stored = kvGet("music-player-cover-style-v2");
            if (stored === "vinyl" || stored === "modern") {
                setPlayerStyle(prev => (prev === stored ? prev : stored));
            }
            setBgCfg(prev => {
                const fresh = loadMusicBg();
                return JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh;
            });
            const motion = kvGet(COMPANION_MOTION_KEY);
            if (motion === "on" || motion === "auto" || motion === "off") setCompanionMotion(motion);
        }, ms));
        return () => timers.forEach(clearTimeout);
    }, []);
    const [musicToast, setMusicToast] = useState<string | null>(null);
    const [pendingPlayTrackId, setPendingPlayTrackId] = useState<string | null>(null);
    const musicToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const musicLoadingFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const currentTime = isDragging ? dragTime : player.currentTime;
    const progress = player.duration > 0 ? currentTime / player.duration : 0;

    const formatTime = (s: number) => {
        if (!s || !isFinite(s)) return "0:00";
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, "0")}`;
    };

    const clearMusicToast = useCallback(() => {
        if (musicToastTimerRef.current) clearTimeout(musicToastTimerRef.current);
        if (musicLoadingFallbackRef.current) clearTimeout(musicLoadingFallbackRef.current);
        musicToastTimerRef.current = null;
        musicLoadingFallbackRef.current = null;
        setMusicToast(null);
        setPendingPlayTrackId(null);
    }, []);

    const showMusicToast = useCallback((text: string, duration = 2000) => {
        if (musicToastTimerRef.current) clearTimeout(musicToastTimerRef.current);
        if (musicLoadingFallbackRef.current) clearTimeout(musicLoadingFallbackRef.current);
        musicToastTimerRef.current = null;
        musicLoadingFallbackRef.current = null;
        setPendingPlayTrackId(null);
        setMusicToast(text);
        if (duration > 0) {
            musicToastTimerRef.current = setTimeout(() => {
                setMusicToast(null);
                musicToastTimerRef.current = null;
            }, duration);
        }
    }, []);

    const beginMusicLoadingToast = useCallback((trackId: string) => {
        if (musicToastTimerRef.current) clearTimeout(musicToastTimerRef.current);
        if (musicLoadingFallbackRef.current) clearTimeout(musicLoadingFallbackRef.current);
        musicToastTimerRef.current = null;
        setPendingPlayTrackId(trackId);
        setMusicToast("加载音乐中...");
        musicLoadingFallbackRef.current = setTimeout(() => {
            setMusicToast(null);
            setPendingPlayTrackId(null);
            musicLoadingFallbackRef.current = null;
        }, 8000);
    }, []);

    useEffect(() => {
        if (!pendingPlayTrackId || player.currentTrack?.id !== pendingPlayTrackId) return;
        clearMusicToast();
    }, [clearMusicToast, pendingPlayTrackId, player.currentTrack?.id]);

    useEffect(() => () => {
        if (musicToastTimerRef.current) clearTimeout(musicToastTimerRef.current);
        if (musicLoadingFallbackRef.current) clearTimeout(musicLoadingFallbackRef.current);
    }, []);

    // ── Ambient palette from cover art ──
    const coverUrl = player.currentTrack?.coverUrl;
    useEffect(() => {
        let cancelled = false;
        extractCoverPalette(coverUrl).then(p => { if (!cancelled) setPalette(p); });
        return () => { cancelled = true; };
    }, [coverUrl]);

    // ── Comment count for current track ──
    const isNeteaseTrack = player.currentTrack?.id?.startsWith("netease_") ?? false;
    const neteaseId = isNeteaseTrack ? parseInt(player.currentTrack!.id.replace("netease_", ""), 10) : 0;

    useEffect(() => {
        setCommentTotal(0);
        setShowComments(false);
        setArtistView(null);
        if (!neteaseId || !isNeteaseConfigured()) return;
        let cancelled = false;
        getSongCommentPage(neteaseId, 0, 1).then(page => {
            if (!cancelled) setCommentTotal(page.total);
        });
        return () => { cancelled = true; };
    }, [neteaseId]);

    const getTimeFromEvent = useCallback((clientX: number) => {
        const bar = progressRef.current;
        if (!bar || !player.duration) return 0;
        const rect = bar.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return ratio * player.duration;
    }, [player.duration]);

    const handleProgressDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const time = getTimeFromEvent(e.clientX);
        setDragTime(time);
        setIsDragging(true);
    }, [getTimeFromEvent]);

    const handleProgressMove = useCallback((e: React.PointerEvent) => {
        if (!isDragging) return;
        setDragTime(getTimeFromEvent(e.clientX));
    }, [isDragging, getTimeFromEvent]);

    const handleProgressUp = useCallback((e: React.PointerEvent) => {
        if (!isDragging) return;
        const time = getTimeFromEvent(e.clientX);
        setDragTime(time);
        player.seek(time);
        setIsDragging(false);
    }, [isDragging, getTimeFromEvent, player]);

    const cyclePlayMode = useCallback(() => {
        const modes: PlayMode[] = ["sequence", "shuffle", "repeat-one"];
        const idx = modes.indexOf(player.playMode);
        player.setPlayMode(modes[(idx + 1) % modes.length]);
    }, [player]);

    const togglePlayerStyle = useCallback(() => {
        setPlayerStyle(prev => {
            const next: PlayerStyle = prev === "modern" ? "vinyl" : "modern";
            try { kvSet("music-player-cover-style-v2", next); } catch { /* ignore */ }
            showMusicToast(next === "vinyl" ? "已切换为黑胶唱片样式" : "已切换为现代封面样式");
            return next;
        });
    }, [showMusicToast]);

    // ── Parse LRC lyrics ──
    const parsedLyrics = useMemo(() => ({ current: bilingualLyrics(
        lyricBundle.id === player.currentTrack?.id ? lyricBundle.original || player.currentTrack?.lyrics || "" : player.currentTrack?.lyrics || "",
        lyricBundle.id === player.currentTrack?.id ? lyricBundle.translated : "",
    ) }), [lyricBundle, player.currentTrack?.id, player.currentTrack?.lyrics]);
    const [activeLyricIdx, setActiveLyricIdx] = useState(-1);
    const lyricsContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelled = false;
        const id = player.currentTrack?.id || "";
        const songId = /^netease_(\d+)$/.exec(id)?.[1];
        setBrowsingLyrics(false);
        setShowMore(false);
        if (songId) getNeteaseLyricBundle(Number(songId)).then(bundle => {
            if (!cancelled) setLyricBundle({ id, ...bundle });
        });
        return () => { cancelled = true; };
    }, [player.currentTrack?.id]);

    useEffect(() => {
        const lyrics = parsedLyrics.current;
        if (lyrics.length === 0) { setActiveLyricIdx(-1); return; }
        let idx = -1;
        for (let i = lyrics.length - 1; i >= 0; i--) {
            if (player.currentTime >= lyrics[i].time) {
                idx = i;
                break;
            }
        }
        setActiveLyricIdx(idx);
    }, [player.currentTime, parsedLyrics]);

    // Auto-scroll lyrics
    useEffect(() => {
        if (view !== "lyrics" || browsingLyrics || activeLyricIdx < 0 || !lyricsContainerRef.current) return;
        const el = lyricsContainerRef.current.children[activeLyricIdx] as HTMLElement;
        if (el) scrollElementWithinContainer(lyricsContainerRef.current, el, { behavior: "smooth", block: "center" });
    }, [activeLyricIdx, view, browsingLyrics, showTranslation]);

    const handleLyricClick = useCallback((idx: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (lyricPress.current.shared) { lyricPress.current.shared = false; return; }
        const line = parsedLyrics.current[idx];
        if (line) { player.seek(Math.max(0, line.time)); setBrowsingLyrics(false); }
    }, [player, parsedLyrics]);

    useEffect(() => () => { if (lyricPress.current.timer) clearTimeout(lyricPress.current.timer); }, []);

    const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
    const [playlists, setPlaylists] = useState<NeteasePlaylist[]>([]);
    const [loadingPlaylists, setLoadingPlaylists] = useState(false);
    const [addResult, setAddResult] = useState<{ ok: boolean; message: string } | null>(null);


    // Clear add result after 2s
    useEffect(() => {
        if (!addResult) return;
        const t = setTimeout(() => setAddResult(null), 2000);
        return () => clearTimeout(t);
    }, [addResult]);


    const handleAddToPlaylist = useCallback(async (playlist: NeteasePlaylist) => {
        if (!neteaseId) return;
        const result = await addTracksToPlaylist(playlist.id, [neteaseId]);
        if (result.ok) {
            recordTrackPlaylist(neteaseId, playlist.id);
        }
        setAddResult(result);
        setShowPlaylistPicker(false);
    }, [neteaseId]);

    const openShareViaChat = useCallback(() => {
        if (!player.currentTrack) return;
        window.dispatchEvent(new CustomEvent("open-mini-chat", {
            detail: { share: { type: "music", title: player.currentTrack.title, artist: player.currentTrack.artist } },
        }));
    }, [player.currentTrack]);

    const openMiniChat = useCallback(() => {
        window.dispatchEvent(new CustomEvent("open-mini-chat"));
    }, []);

    const openArtistPage = useCallback(async () => {
        if (!player.currentTrack) return;
        if (!isNeteaseTrack || !isNeteaseConfigured()) {
            showMusicToast("本地歌曲暂无歌手主页");
            return;
        }
        const detail = await getNeteaseSongDetail(neteaseId);
        const first = detail?.artistList?.[0];
        if (!first) {
            showMusicToast("没有找到歌手信息");
            return;
        }
        setArtistView(first);
    }, [player.currentTrack, isNeteaseTrack, neteaseId, showMusicToast]);

    const track = player.currentTrack;

    const getAdjacentTrack = (direction: "prev" | "next") => {
        if (player.queue.length === 0 || !player.currentTrack) return null;
        const idx = player.queue.findIndex(t => t.id === player.currentTrack!.id);
        if (idx < 0) return null;
        if (player.playMode === "shuffle") {
            return player.queue[Math.floor(Math.random() * player.queue.length)] ?? null;
        }
        const offset = direction === "next" ? 1 : -1;
        const nextIdx = (idx + offset + player.queue.length) % player.queue.length;
        return player.queue[nextIdx] ?? null;
    };

    const handleSwitchToTrack = useCallback(async (target: typeof player.currentTrack) => {
        if (!target) return;
        if (target.id.startsWith("netease_")) {
            beginMusicLoadingToast(target.id);
            const nid = parseInt(target.id.replace("netease_", ""), 10);
            const info = await getNeteasePlayInfo(nid);
            if (!info.url) {
                showMusicToast(info.reason || "加载失败，请稍后重试", 2600);
                return;
            }
            player.playUrl(info.url, target);
            if (info.trial) showMusicToast("VIP 歌曲，当前播放 30 秒试听", 2600);
            return;
        }
        player.playTrack(target);
    }, [beginMusicLoadingToast, player, showMusicToast]);

    const handlePrev = useCallback(() => {
        const target = getAdjacentTrack("prev");
        if (target?.id.startsWith("netease_")) {
            void handleSwitchToTrack(target);
            return;
        }
        player.prev();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handleSwitchToTrack, player]);

    const handleNext = useCallback(() => {
        const target = getAdjacentTrack("next");
        if (target?.id.startsWith("netease_")) {
            void handleSwitchToTrack(target);
            return;
        }
        player.next();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handleSwitchToTrack, player]);

    if (!track) return null;

    const hasLyrics = parsedLyrics.current.length > 0;
    const modeInfo = PLAY_MODE_ICONS[player.playMode];
    const activeLyricText = activeLyricIdx >= 0 ? parsedLyrics.current[activeLyricIdx]?.text : "";
    const customBg = playerBgStyle(bgCfg);
    const ambientVars = {
        "--mp-c1": palette[0],
        "--mp-c2": palette[1],
        "--mp-c3": palette[2],
        ...(customBg || {}),
    } as React.CSSProperties;

    return (
        <div className="music-player mp-lumen mp-spotify" data-view={view} data-companion-motion={companionMotion} style={ambientVars} onKeyDown={e => { if (e.key === "Escape") setShowMore(false); }}>
            {musicToast && (
                <div className="music-toast-overlay">
                    <div className="music-toast-chip">
                        {musicToast === "加载音乐中..." ? (
                            <span className="ui-loading-toast-content">
                                <span className="ui-loading-spinner" />
                                <span>{musicToast}</span>
                            </span>
                        ) : musicToast}
                    </div>
                </div>
            )}

            {/* Ambient flowing background tinted by cover colors (hidden on custom bg) */}
            <div className="mp-ambient" aria-hidden="true">
                {!customBg && (
                    <>
                        <i className="mp-blob mp-blob-1" />
                        <i className="mp-blob mp-blob-2" />
                        <i className="mp-blob mp-blob-3" />
                    </>
                )}
                <span className="mp-grain" />
                <span className="mp-vignette" />
            </div>

            {/* Header: secondary actions live in a compact popover. */}
            <div className="mp-top">
                <button className="music-player-close" aria-label={view === "lyrics" ? "返回封面" : "收起播放器"} onClick={() => view === "lyrics" ? setView("cover") : player.closeFullPlayer()}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m5 9 7 7 7-7" /></svg>
                </button>
                <div className="np-source"><small>{view === "lyrics" ? "正在播放 · 歌词" : "正在播放"}</small><strong title={view === "lyrics" ? track.title : track.playbackSource || "当前播放队列"}>{view === "lyrics" ? track.title : track.playbackSource || "当前播放队列"}</strong></div>
                <button className="music-player-ctrl-btn mp-top-btn" aria-label="更多音乐功能" aria-expanded={showMore} onClick={() => setShowMore(value => !value)}>
                    <svg width="23" height="23" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
                </button>
            </div>
            {showMore && <>
                <button className="np-menu-backdrop" aria-label="关闭更多菜单" onClick={() => setShowMore(false)} />
                <div className="np-menu">
                    <button onClick={() => { setShowMore(false); openCompanionRecords(); }}>一起听过的时光</button>
                    <button onClick={() => {
                        const next: CompanionWindowMotion = companionMotion === "on" ? "auto" : companionMotion === "auto" ? "off" : "on";
                        setCompanionMotion(next); kvSet(COMPANION_MOTION_KEY, next);
                    }}>陪听窗口动画：{companionMotion === "on" ? "开启" : companionMotion === "auto" ? "跟随系统" : "关闭"}</button>
                    <button onClick={() => { togglePlayerStyle(); setShowMore(false); }}>{playerStyle === "vinyl" ? "使用方形封面" : "使用黑胶封面"}</button>
                    <button onClick={() => { openMiniChat(); setShowMore(false); }}>聊天小窗</button>
                    <button onClick={() => { setShowMore(false); if (!isNeteaseTrack) { showMusicToast("本地歌曲暂不支持云端歌单"); return; } setShowPlaylistPicker(true); setLoadingPlaylists(true); getUserPlaylists().then(setPlaylists).finally(() => setLoadingPlaylists(false)); }}>收藏到其他歌单</button>
                    <button onClick={() => { void openArtistPage(); setShowMore(false); }}>歌手主页</button>
                    <button onClick={() => { openShareViaChat(); setShowMore(false); }}>分享到聊天</button>
                </div>
            </>}

            {/* Body — cover / vinyl / glow lyrics */}
            <div className="mp-body">
                {view === "lyrics" ? (
                    <div className="mp-lyrics-wrap">
                        <div className="np-lyrics-toolbar">
                            <span>{parsedLyrics.current.some(line => line.translation) ? "双语歌词" : "原文歌词 · 暂无翻译"}</span>
                            {companion.session && <button className="np-share-lyric" disabled={!activeLyricText} onClick={() => {
                                const line = parsedLyrics.current[activeLyricIdx];
                                if (line?.text) shareCompanionLyric([line.text, line.translation].filter(Boolean).join("\n"));
                            }}>给 TA 看这句</button>}
                            <button type="button" aria-pressed={showTranslation} disabled={!parsedLyrics.current.some(line => line.translation)} onClick={() => setShowTranslation(value => !value)}>译</button>
                        </div>
                        {hasLyrics ? (
                            <div className="mp-lyrics" ref={lyricsContainerRef} onWheel={() => setBrowsingLyrics(true)} onTouchMove={() => setBrowsingLyrics(true)} onKeyDown={e => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key)) setBrowsingLyrics(true); }} tabIndex={0} aria-label="歌曲歌词">
                                {parsedLyrics.current.map((line, i) => {
                                    const dist = Math.abs(i - activeLyricIdx);
                                    return (
                                        <div
                                            key={i}
                                            className="mp-lyric-line"
                                            {...(i === activeLyricIdx ? { "data-active": "" } : dist === 1 ? { "data-near": "" } : {})}
                                            onClick={(e) => handleLyricClick(i, e)}
                                            onPointerDown={event => {
                                                if (lyricPress.current.timer) clearTimeout(lyricPress.current.timer);
                                                lyricPress.current = { timer: null, x: event.clientX, y: event.clientY, shared: false };
                                                if (!companion.session || !line.text || event.button !== 0) return;
                                                lyricPress.current.timer = setTimeout(() => {
                                                    lyricPress.current.shared = true;
                                                    shareCompanionLyric([line.text, line.translation].filter(Boolean).join("\n"));
                                                }, 550);
                                            }}
                                            onPointerMove={event => {
                                                const press = lyricPress.current;
                                                if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 7 && press.timer) clearTimeout(press.timer);
                                            }}
                                            onPointerUp={() => { if (lyricPress.current.timer) clearTimeout(lyricPress.current.timer); }}
                                            onPointerCancel={() => { if (lyricPress.current.timer) clearTimeout(lyricPress.current.timer); }}
                                            onContextMenu={event => {
                                                if (!companion.session || !line.text) return;
                                                event.preventDefault();
                                                if (lyricPress.current.timer) clearTimeout(lyricPress.current.timer);
                                                if (!lyricPress.current.shared) shareCompanionLyric([line.text, line.translation].filter(Boolean).join("\n"));
                                                lyricPress.current.shared = true;
                                            }}
                                        >
                                            <span className="np-lyric-original">{line.text || "♪"}</span>
                                            {showTranslation && line.translation && <span className="np-lyric-translation">{line.translation}</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="mp-lyrics mp-lyrics-empty">
                                <div className="mp-lyric-line" data-active="">暂无歌词</div>
                            </div>
                        )}
                        {browsingLyrics && <button className="np-lyrics-resume" onClick={() => setBrowsingLyrics(false)}>回到当前句</button>}
                    </div>
                ) : playerStyle === "vinyl" ? (
                    <div className="music-player-vinyl-area" onClick={() => setView("lyrics")}>
                        <div className="music-player-vinyl-glow" />
                        <div className="music-player-vinyl" {...(player.isPlaying ? { "data-spinning": "" } : {})}>
                            <div className="music-player-vinyl-groove music-player-vinyl-groove-1" />
                            <div className="music-player-vinyl-groove music-player-vinyl-groove-2" />
                            <div className="music-player-vinyl-groove music-player-vinyl-groove-3" />
                            <div className="music-player-vinyl-center">
                                {track.coverUrl ? (
                                    <img src={track.coverUrl} alt="" className="music-player-vinyl-cover" />
                                ) : (
                                    <div className="music-player-vinyl-cover-placeholder">
                                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                                            <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                                        </svg>
                                    </div>
                                )}
                            </div>
                            <div className="music-player-vinyl-dot" />
                        </div>
                        <div className="music-player-tonearm" {...(player.isPlaying ? { "data-playing": "" } : {})}>
                            <div className="music-player-tonearm-pivot" />
                            <div className="music-player-tonearm-arm" />
                            <div className="music-player-tonearm-joint" />
                            <div className="music-player-tonearm-head" />
                        </div>
                    </div>
                ) : (
                    <div className="mp-cover-area" onClick={() => setView("lyrics")}>
                        <div className="mp-cover" {...(player.isPlaying ? {} : { "data-paused": "" })}>
                            {track.coverUrl ? (
                                <img src={track.coverUrl} alt="" />
                            ) : (
                                <div className="mp-cover-placeholder">
                                    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                                        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                                    </svg>
                                </div>
                            )}
                        </div>
                        <div className="mp-lyric-peek">
                            {activeLyricText ? (
                                <>「{activeLyricText}」<span>点击查看歌词</span></>
                            ) : hasLyrics ? (
                                <span>点击查看歌词</span>
                            ) : null}
                        </div>
                    </div>
                )}
            </div>

            {view === "cover" && <div className="np-details">
                <div className="mp-titles">
                    <div className="mp-song" title={track.title}>{track.title}</div>
                    <button className="mp-artist" onClick={openArtistPage}>{track.artist || "未知歌手"}<span aria-hidden="true"> ›</span></button>
                </div>
                <CloudLikeButton key={track.id} track={track} />
            </div>}

            {/* Seekable thin progress rail */}
            <div className="mp-progress-area">
                <div
                    ref={progressRef}
                    className="np-progress"
                    role="slider"
                    tabIndex={0}
                    aria-label="歌曲播放进度"
                    aria-valuemin={0}
                    aria-valuemax={player.duration || 0}
                    aria-valuenow={Math.max(0, Math.min(player.duration || 0, currentTime))}
                    aria-valuetext={`${formatTime(currentTime)} / ${formatTime(player.duration)}`}
                    onKeyDown={e => {
                        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
                        e.preventDefault();
                        const nextTime = e.key === "Home" ? 0 : e.key === "End" ? player.duration : currentTime + (e.key === "ArrowLeft" ? -5 : 5);
                        player.seek(Math.max(0, Math.min(player.duration || 0, nextTime)));
                    }}
                    onPointerDown={handleProgressDown}
                    onPointerMove={handleProgressMove}
                    onPointerUp={handleProgressUp}
                    onPointerCancel={handleProgressUp}
                >
                    <span className="np-progress-rail"><span style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} /><i style={{ left: `${Math.max(0, Math.min(1, progress)) * 100}%` }} /></span>
                </div>
                <div className="mp-times">
                    <span>{formatTime(currentTime)}</span>
                    <span>-{formatTime(Math.max(0, player.duration - currentTime))}</span>
                </div>
            </div>

            {/* Controls */}
            <div className="mp-controls">
                <button className="music-player-ctrl-btn mp-ctrl-side" onClick={cyclePlayMode} title={modeInfo.label}>
                    <svg width="20" height="20" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: modeInfo.svg }} />
                </button>
                <button className="music-player-ctrl-btn mp-ctrl" onClick={handlePrev}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                    </svg>
                </button>
                <button className="music-player-ctrl-btn mp-ctrl-play" onClick={player.togglePlay}>
                    {player.isPlaying ? (
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
                        </svg>
                    ) : (
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    )}
                </button>
                <button className="music-player-ctrl-btn mp-ctrl" onClick={handleNext}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 18l8.5-6L6 6v12zm8.5 0h2V6h-2v12z" />
                    </svg>
                </button>
                <button
                    className="music-player-ctrl-btn mp-ctrl-side"
                    onClick={() => setShowQueue(true)}
                    disabled={player.queue.length === 0}
                    title="播放列表"
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                    </svg>
                </button>
            </div>

            <div className="mp-social">
                <MusicCompanion track={track} currentTime={player.currentTime} isPlaying={player.isPlaying} onTogglePlay={player.togglePlay} onNext={handleNext} backgroundStyle={customBg} />
                <button className="mp-social-btn np-social-icon" onClick={openShareViaChat} aria-label="分享歌曲" title="分享歌曲">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M12 16V3m-4 4 4-4 4 4M5 13v7h14v-7" /></svg>
                </button>
                <button className="mp-social-btn np-social-icon" onClick={() => { if (!isNeteaseTrack) { showMusicToast("本地歌曲暂无评论区"); return; } setShowComments(true); }} aria-label="歌曲评论" title={commentTotal > 0 ? `歌曲评论 · ${formatCount(commentTotal)}` : "歌曲评论"}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L4 21l1.5-4.3A8.5 8.5 0 1 1 21 12z" /></svg>
                </button>
            </div>
            {view === "cover" && <button className="np-lyrics-preview" onClick={() => { setBrowsingLyrics(false); setView("lyrics"); }}>
                <span><strong>歌词</strong><small>{activeLyricText || (hasLyrics ? "跟随音乐，查看完整歌词" : "查看歌词")}</small></span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4" /></svg>
            </button>}

            {/* Queue drawer */}
            {showQueue && (
                <div className="music-queue-overlay" onClick={() => setShowQueue(false)}>
                    <div className="music-queue-drawer" onClick={e => e.stopPropagation()}>
                        <div className="music-queue-header">
                            <span>播放列表</span>
                            <span className="music-queue-count">{player.queue.length}首</span>
                            <button className="music-playlist-picker-close" onClick={() => setShowQueue(false)}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            </button>
                        </div>
                        <div className="music-queue-list">
                            {player.queue.map((t, idx) => {
                                const isCurrent = t.id === track.id;
                                return (
                                    <div
                                        key={t.id}
                                        className="music-queue-item"
                                        role="button"
                                        tabIndex={0}
                                        {...(isCurrent ? { "data-current": "" } : {})}
                                        onClick={() => { void handleSwitchToTrack(t); }}
                                    >
                                        <span className="music-queue-item-idx">{idx + 1}</span>
                                        <div className="music-queue-item-info">
                                            <div className="music-queue-item-title">{t.title}</div>
                                            <div className="music-queue-item-artist">{t.artist}</div>
                                        </div>
                                        {isCurrent && player.isPlaying && (
                                            <div className="music-wave music-queue-wave">{[0, 1, 2].map(i => <span key={i} className="music-wave-bar" style={{ animationDelay: `${i * 0.15}s` }} />)}</div>
                                        )}
                                        {!isCurrent && (
                                            <button
                                                className="music-queue-item-del"
                                                onClick={e => { e.stopPropagation(); player.removeFromQueue(t.id); }}
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* Playlist picker overlay */}
            {showPlaylistPicker && (
                <div className="music-playlist-picker-overlay" onClick={() => setShowPlaylistPicker(false)}>
                    <div className="music-playlist-picker" onClick={e => e.stopPropagation()}>
                        <div className="music-playlist-picker-header">
                            <span>收藏到歌单</span>
                            <button className="music-playlist-picker-close" onClick={() => setShowPlaylistPicker(false)}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            </button>
                        </div>
                        <div className="music-playlist-picker-list">
                            {loadingPlaylists ? (
                                <div className="music-playlist-picker-loading">加载歌单...</div>
                            ) : playlists.length === 0 ? (
                                <div className="music-playlist-picker-loading">没有找到歌单</div>
                            ) : playlists.map(pl => (
                                <button key={pl.id} className="music-playlist-picker-item" onClick={() => handleAddToPlaylist(pl)}>
                                    <img src={pl.coverUrl} alt="" className="music-playlist-picker-cover" />
                                    <div className="music-playlist-picker-info">
                                        <div className="music-playlist-picker-name">{pl.name}</div>
                                        <div className="music-playlist-picker-count">{pl.trackCount}首</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Comments overlay */}
            {showComments && neteaseId > 0 && (
                <MusicCommentsPage
                    songId={neteaseId}
                    title={track.title}
                    artist={track.artist}
                    coverUrl={track.coverUrl}
                    onClose={() => setShowComments(false)}
                />
            )}

            {/* Artist overlay */}
            {artistView && (
                <MusicArtistPage
                    artistId={artistView.id}
                    artistName={artistView.name}
                    onClose={() => setArtistView(null)}
                />
            )}

            {/* Add result toast */}
            {addResult && (
                <div className={`music-toast ${addResult.ok ? "music-toast-ok" : "music-toast-err"}`}>
                    {addResult.ok ? "✓ " : "✗ "}{addResult.message}
                </div>
            )}

        </div>
    );
}
