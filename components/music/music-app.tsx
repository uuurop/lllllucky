// components/music/music-app.tsx — Music App main page (immersive, no PageShell)
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
    loadAllTracks, saveTrack, deleteTrack,
    generateTrackId, parseFilename, getAudioDuration,
    type MusicTrack,
} from "@/lib/music-storage";
import { useMusicControls, type MusicControlsValue } from "@/lib/music-context";
import { SessionCustomCSS } from "@/components/ui/session-custom-css";
import {
    isNeteaseConfigured, loadMusicApiConfig, saveMusicApiConfig,
    searchNetease, getNeteasePlayInfo, getNeteaseLyrics, getNeteaseSongDetail,
    testNeteaseConnection, getQrKey, getQrImage, checkQrStatus, checkLoginStatus,
    getUserPlaylists, getPlaylistTracks, saveNeteaseCookie, clearNeteaseCookie,
    getDailyRecommendSongs, getHotSearchDetail, getPersonalizedPlaylists,
    getRecommendResource, getToplists, getUserRecordWithCounts,
    getPlaylistDetail, getUserDetail, subscribePlaylist,
    getDjSublist, getDjPrograms, getAlbumSublist, getAlbumTracks,
    getUserEvents, getRecentSongs, getIntelligenceList,
    type NeteaseHotSearch, type NeteaseSearchResult,
    type NeteasePlaylist, type NeteaseToplist, type MusicApiConfig,
    type NeteasePlaylistDetail, type NeteaseUserDetail, type NeteasePlayRecord,
    type NeteaseDjRadio, type NeteaseDjProgram, type NeteaseAlbumSub, type NeteaseUserEvent,
} from "@/lib/music-service";
import { clearMusicCloudSyncData } from "@/lib/chat-engine";
import MusicCommentsPage from "./music-comments";
import {
    loadMusicBg, saveMusicBg, clearMusicBg, fileToCompressedDataUrl, appBgStyle,
    MUSIC_BG_EVENT, loadMusicFloatMode, saveMusicFloatMode,
    type MusicBgConfig, type MusicPlayerBgMode,
    type MusicFloatMode,
} from "@/lib/music-bg";

import { SpotifyIcon, SpotifyCover, SpotifyMiniPlayer, SpotifySongRow, SpotifyDetailNav } from "./music-spotify-ui";
import SpotifySearch from "./music-spotify-search";
import SpotifyLibrary from "./music-spotify-library";

type Props = { onClose: () => void };
type TabId = "recommend" | "mine" | "search" | "local";

export default function MusicApp({ onClose }: Props) {
    const [tracks, setTracks] = useState<MusicTrack[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<TabId>("local");
    const [hasNetease, setHasNetease] = useState(false);
    const [homeFilter, setHomeFilter] = useState<"all" | "playlists" | "charts">("all");
    const [librarySearchOpen, setLibrarySearchOpen] = useState(false);
    const [libraryQuery, setLibraryQuery] = useState("");
    const [profile, setProfile] = useState<NeteaseUserDetail | null>(() => readMusicCache("music-user-detail", null));
    const [showSettings, setShowSettings] = useState(false);
    const [showCssEditor, setShowCssEditor] = useState(false);
    const [customCss, setCustomCss] = useState("");
    const [activePlaylist, setActivePlaylist] = useState<NeteasePlaylist | null>(null);
    const [dailyView, setDailyView] = useState<NeteaseSearchResult[] | null>(null);
    const [playlists, setPlaylists] = useState<NeteasePlaylist[]>([]);
    const [playlistsLoading, setPlaylistsLoading] = useState(true);
    const [musicToast, setMusicToast] = useState<string | null>(null);
    const [pendingPlayTrackId, setPendingPlayTrackId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const musicToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const musicLoadingFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [bgCfg, setBgCfg] = useState<MusicBgConfig>(() => loadMusicBg());
    const player = useMusicControls();

    useEffect(() => {
        const handleBgChange = () => setBgCfg(loadMusicBg());
        window.addEventListener(MUSIC_BG_EVENT, handleBgChange);
        return () => window.removeEventListener(MUSIC_BG_EVENT, handleBgChange);
    }, []);

    // kv cache hydrates asynchronously — re-read the custom background until settled
    useEffect(() => {
        const timers = [300, 1200, 3000].map(ms => setTimeout(() => {
            setBgCfg(prev => {
                const fresh = loadMusicBg();
                return JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh;
            });
        }, ms));
        return () => timers.forEach(clearTimeout);
    }, []);

    useEffect(() => {
        loadAllTracks().then(t => { setTracks(t); setLoading(false); });
        const neteaseOk = isNeteaseConfigured();
        setHasNetease(neteaseOk);
        if (neteaseOk) {
            setTab("recommend");
            void getUserDetail().then(detail => { if (detail) { setProfile(detail); writeMusicCache("music-user-detail", detail); } });
        }
        setCustomCss(kvGet("music-custom-css") || "");
        // Load cached playlists immediately, then refresh from API
        if (neteaseOk) {
            try {
                const cached = kvGet("music-playlists-cache");
                if (cached) { setPlaylists(JSON.parse(cached)); setPlaylistsLoading(false); }
            } catch { /* ignore */ }
            getUserPlaylists().then(p => {
                setPlaylists(p);
                setPlaylistsLoading(false);
                if (p.length > 0) kvSet("music-playlists-cache", JSON.stringify(p));
            });
        } else {
            setPlaylistsLoading(false);
        }
    }, []);

    useEffect(() => {
        const handleLibraryUpdated = () => {
            void loadAllTracks().then(setTracks);
        };
        window.addEventListener("music-library-updated", handleLibraryUpdated);
        return () => window.removeEventListener("music-library-updated", handleLibraryUpdated);
    }, []);

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

    // ── Upload handler ──
    const handleUpload = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const newTracks: MusicTrack[] = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
            const audioExts = ["mp3", "m4a", "aac", "ogg", "wav", "flac", "wma", "opus", "webm"];
            if (!file.type.startsWith("audio/") && !audioExts.includes(ext)) continue;
            const { title, artist } = parseFilename(file.name);
            const duration = await getAudioDuration(file);
            const track: MusicTrack = { id: generateTrackId(), title, artist, duration, liked: false, addedAt: new Date().toISOString() };
            await saveTrack(track, file);
            newTracks.push(track);
        }
        if (newTracks.length > 0) setTracks(prev => [...newTracks, ...prev]);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const handlePlay = (track: MusicTrack) => {
        track = { ...track, playbackSource: "本地音乐" };
        // Add this single track to front of queue (if not already in it)
        if (!player.queue.some(t => t.id === track.id)) {
            player.setQueue([track, ...player.queue]);
        } else {
            player.setQueue(player.queue.map(t => t.id === track.id ? { ...t, playbackSource: track.playbackSource } : t));
        }
        player.playTrack(track);
    };

    const handleDelete = async (trackId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        await deleteTrack(trackId);
        setTracks(prev => prev.filter(t => t.id !== trackId));
        if (player.currentTrack?.id === trackId) player.stop();
    };

    /** Convert NeteaseSearchResult → MusicTrack */
    const toMusicTrack = useCallback((r: NeteaseSearchResult, extra?: { lyrics?: string; coverUrl?: string; name?: string; artists?: string }): MusicTrack => ({
        id: `netease_${r.id}`,
        title: extra?.name || r.name,
        artist: extra?.artists || r.artists,
        duration: r.duration / 1000,
        coverUrl: extra?.coverUrl || r.coverUrl,
        lyrics: extra?.lyrics,
        liked: false,
        addedAt: new Date().toISOString(),
    }), []);

    /** Play a single Netease song — append to queue */
    const handlePlayNetease = useCallback(async (result: NeteaseSearchResult, sourceName = "当前播放队列") => {
        const trackId = `netease_${result.id}`;
        beginMusicLoadingToast(trackId);
        const info = await getNeteasePlayInfo(result.id);
        if (!info.url) {
            showMusicToast(info.reason || "加载失败，请稍后重试", 2600);
            return;
        }
        const detail = await getNeteaseSongDetail(result.id);
        const lyrics = await getNeteaseLyrics(result.id);
        const track = { ...toMusicTrack(result, { lyrics, coverUrl: detail?.coverUrl, name: detail?.name, artists: detail?.artists }), playbackSource: sourceName };
        // Prepend to existing queue
        if (!player.queue.some(t => t.id === track.id)) {
            player.setQueue([track, ...player.queue]);
        } else {
            player.setQueue(player.queue.map(t => t.id === track.id ? { ...t, playbackSource: sourceName } : t));
        }
        player.playUrl(info.url, track);
        if (info.trial) showMusicToast("VIP 歌曲，当前播放 30 秒试听", 2600);
    }, [beginMusicLoadingToast, player, showMusicToast, toMusicTrack]);

    /** Play all tracks from a playlist — replace queue */
    const handlePlayAllNetease = useCallback(async (results: NeteaseSearchResult[], sourceName = "当前播放队列") => {
        if (results.length === 0) return;
        const queue = results.map(r => ({ ...toMusicTrack(r), playbackSource: sourceName }));
        player.setQueue(queue);

        beginMusicLoadingToast(`netease_${results[0].id}`);
        let playable: { song: NeteaseSearchResult; url: string; index: number; trial: boolean } | null = null;
        let firstReason = "";
        for (let i = 0; i < results.length; i++) {
            const song = results[i];
            const info = await getNeteasePlayInfo(song.id);
            if (info.url) {
                playable = { song, url: info.url, index: i, trial: info.trial };
                break;
            }
            if (!firstReason && info.reason) firstReason = info.reason;
        }

        if (!playable) {
            showMusicToast(firstReason || "歌单内暂无可播放歌曲", 2600);
            return;
        }

        beginMusicLoadingToast(`netease_${playable.song.id}`);
        const detail = await getNeteaseSongDetail(playable.song.id);
        const lyrics = await getNeteaseLyrics(playable.song.id);
        const track = { ...toMusicTrack(playable.song, { lyrics, coverUrl: detail?.coverUrl, name: detail?.name, artists: detail?.artists }), playbackSource: sourceName };
        player.playUrl(playable.url, track);
        if (playable.index > 0) showMusicToast(`已跳过 ${playable.index} 首不可播放歌曲`);
        else if (playable.trial) showMusicToast("VIP 歌曲，当前播放 30 秒试听", 2600);
    }, [beginMusicLoadingToast, player, showMusicToast, toMusicTrack]);

    const formatTime = (s: number) => {
        if (!s || !isFinite(s)) return "--:--";
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, "0")}`;
    };

    const onSettingsSaved = () => {
        const neteaseOk = isNeteaseConfigured();
        setHasNetease(neteaseOk);
        if (neteaseOk) {
            setTab("recommend");
            // API address may have changed — clear old cache and reload playlists
            kvRemove("music-playlists-cache");
            setPlaylistsLoading(true);
            setPlaylists([]);
            setActivePlaylist(null);
            getUserPlaylists().then(p => {
                setPlaylists(p);
                setPlaylistsLoading(false);
                if (p.length > 0) kvSet("music-playlists-cache", JSON.stringify(p));
            }).catch(() => setPlaylistsLoading(false));
        } else {
            setTab("local");
            kvRemove("music-playlists-cache");
            setPlaylists([]);
            setPlaylistsLoading(false);
        }
    };

    return (
        <div className="music-app music-spotify" style={appBgStyle(bgCfg)} {...(player.currentTrack ? { "data-nowbar": "" } : {})}>
            {customCss && <SessionCustomCSS css={customCss} scope=".music-app" />}
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

            {dailyView || activePlaylist ? <SpotifyDetailNav onBack={() => { setDailyView(null); setActivePlaylist(null); }} onMore={() => setShowSettings(true)} /> : <header className="music-header spt-app-header">
                    <button className="spt-icon" aria-label="返回桌面" onClick={onClose}><SpotifyIcon name="back" size={25} /></button>
                    {tab === "recommend" ? <div className="spt-pills spt-home-filters">{([["all", "全部"], ["playlists", "歌单"], ["charts", "排行榜"]] as const).map(([value, label]) => <button key={value} aria-pressed={homeFilter === value} onClick={() => setHomeFilter(value)}>{label}</button>)}</div> : <h1>{tab === "mine" ? "音乐库" : tab === "search" ? "搜索" : "本地音乐"}</h1>}
                    <div className="spt-header-actions">{tab === "mine" && <button className="spt-icon" aria-label="搜索音乐库" onClick={() => setLibrarySearchOpen(value => !value)}><SpotifyIcon name="search" /></button>}{tab === "local" && <button className="spt-icon" aria-label="自定义音乐样式" onClick={() => setShowCssEditor(true)}><SpotifyIcon name="more" /></button>}<button className="spt-account-avatar" aria-label="音乐设置" onClick={() => setShowSettings(true)}>{profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : (profile?.nickname || "M").slice(0, 1)}</button></div>
            </header>}

            {/* Tab content */}
            {tab === "recommend" && hasNetease && (dailyView ? (
                <DailySongsPage
                    songs={dailyView}
                    player={player}
                    formatTime={formatTime}
                    onPlayNetease={song => { void handlePlayNetease(song, "每日推荐"); }}
                    onPlayAll={songs => { void handlePlayAllNetease(songs, "每日推荐"); }}
                />
            ) : activePlaylist ? (
                <PlaylistsTab
                    player={player}
                    formatTime={formatTime}
                    onPlayNetease={song => { void handlePlayNetease(song, activePlaylist.name); }}
                    onPlayAll={songs => { void handlePlayAllNetease(songs, activePlaylist.name); }}
                    activePlaylist={activePlaylist}
                    setActivePlaylist={setActivePlaylist}
                    playlists={playlists}
                    loading={playlistsLoading}
                    onToast={showMusicToast}
                />
            ) : (
                <RecommendTab
                    formatTime={formatTime}
                    filter={homeFilter}
                    onPlayNetease={song => { void handlePlayNetease(song, "发现音乐"); }}
                    onPlayAll={songs => { void handlePlayAllNetease(songs, "每日推荐"); }}
                    onGoSearch={() => setTab("search")}
                    onOpenDaily={setDailyView}
                    onOpenPlaylist={setActivePlaylist}
                />
            ))}

            {tab === "mine" && hasNetease && (
                <MineTab
                    player={player}
                    formatTime={formatTime}
                    onPlayNetease={(song, source) => { void handlePlayNetease(song, source || activePlaylist?.name || "我的音乐"); }}
                    onPlayAll={(songs, source) => { void handlePlayAllNetease(songs, source || activePlaylist?.name || "我的音乐"); }}
                    activePlaylist={activePlaylist}
                    setActivePlaylist={setActivePlaylist}
                    playlists={playlists}
                    loading={playlistsLoading}
                    onToast={showMusicToast}
                    onGoLocal={() => setTab("local")}
                    onOpenSettings={() => setShowSettings(true)}
                    query={libraryQuery} searchOpen={librarySearchOpen} onQuery={setLibraryQuery}
                />
            )}

            {tab === "local" && (
                <>
                    {/* Header Action: Upload Area inside the tab - Removed inline version */}
                    <input ref={fileInputRef} type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.wav,.flac" multiple hidden onChange={(e) => handleUpload(e.target.files)} />

                    {/* Song list */}
                    {loading ? (
                        <div className="music-empty"><div className="music-empty-text">加载中...</div></div>
                    ) : tracks.length === 0 ? (
                        <div className="music-empty"><div className="music-empty-icon">♪</div><div className="music-empty-text">还没有音乐</div></div>
                    ) : (
                        <SongList tracks={tracks} player={player} formatTime={formatTime} onDelete={handleDelete} onPlay={handlePlay} />
                    )}
                </>
            )}

            {tab === "search" && hasNetease && <>
                <div className="spt-page-host" hidden={!!activePlaylist}><SpotifySearch player={player} onPlay={(song, source) => { void handlePlayNetease(song, source || "搜索结果"); }} onPlayAll={(songs, source) => { void handlePlayAllNetease(songs, source); }} onOpenPlaylist={setActivePlaylist} /></div>
                {activePlaylist && <PlaylistsTab player={player} formatTime={formatTime} onPlayNetease={song => { void handlePlayNetease(song, activePlaylist.name); }} onPlayAll={songs => { void handlePlayAllNetease(songs, activePlaylist.name); }} activePlaylist={activePlaylist} setActivePlaylist={setActivePlaylist} playlists={playlists} loading={playlistsLoading} onToast={showMusicToast} />}
            </>}
            {tab !== "local" && !hasNetease && <div className="spt-state"><h2>从音乐开始</h2><p>先在音乐设置中连接你的音乐服务。</p><button className="spt-outline-button" onClick={() => setShowSettings(true)}>打开音乐设置</button></div>}

            {/* Floating buttons */}
            {tab === "local" && (
                <>
                    <button
                        className="music-fab-add"
                        onClick={() => fileInputRef.current?.click()}
                        title="添加本地音乐"
                        style={{ bottom: player.currentTrack ? "calc(146px + env(safe-area-inset-bottom, 0px))" : "calc(90px + env(safe-area-inset-bottom, 0px))" }}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                    </button>
                </>
            )}

            {/* Bottom dock: mini player + tab bar share one glass slab */}
            <div className="music-bottom-dock">
            {player.currentTrack && <SpotifyMiniPlayer />}

            <nav className="music-tabbar" aria-label="音乐导航">
                {([["recommend", "home", "首页"], ["search", "search", "搜索"], ["mine", "library", "音乐库"], ["local", "local", "本地"]] as const).map(([value, icon, label]) => <button key={value} className="music-tabbar-item" data-active={tab === value ? "" : undefined} aria-current={tab === value ? "page" : undefined} onClick={() => { setTab(value); setActivePlaylist(null); setDailyView(null); }}><SpotifyIcon name={icon} size={26} /><span>{label}</span></button>)}
            </nav>
            </div>

            {/* Settings Modal */}
            {showSettings && (
                <div className="music-settings-modal-overlay" onClick={() => setShowSettings(false)}>
                    <div className="music-settings-modal-dialog" onClick={(e) => e.stopPropagation()}>
                        <MusicSettingsTab onBack={() => setShowSettings(false)} onSaved={onSettingsSaved} />
                    </div>
                </div>
            )}

            {/* CSS Editor Modal */}
            {showCssEditor && (
                <div className="music-settings-modal-overlay" onClick={() => setShowCssEditor(false)}>
                    <div className="music-settings-modal-dialog" onClick={(e) => e.stopPropagation()}>
                        <MusicCssEditor onClose={() => setShowCssEditor(false)} onSave={setCustomCss} />
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Recommend Tab (home) ──

function RecommendTab({ onOpenDaily, onOpenPlaylist, filter }: {
    formatTime: (s: number) => string; onPlayNetease: (song: NeteaseSearchResult) => void; onPlayAll: (songs: NeteaseSearchResult[]) => void;
    onGoSearch: () => void; onOpenDaily: (songs: NeteaseSearchResult[]) => void; onOpenPlaylist: (playlist: NeteasePlaylist) => void;
    filter: "all" | "playlists" | "charts";
}) {
    const [daily, setDaily] = useState<NeteaseSearchResult[]>(() => readMusicCache("music-recommend-daily", []));
    const [playlists, setPlaylists] = useState<NeteasePlaylist[]>(() => readMusicCache("music-recommend-playlists", []));
    const [charts, setCharts] = useState<NeteaseToplist[]>(() => readMusicCache("music-recommend-toplists", []));
    const [loading, setLoading] = useState(false);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let alive = true; setLoading(true);
        Promise.allSettled([getDailyRecommendSongs(), getRecommendResource().then(items => items.length ? items : getPersonalizedPlaylists(18)), getToplists()]).then(([songs, recommended, toplists]) => {
            if (!alive) return;
            if (songs.status === "fulfilled") { setDaily(songs.value); writeMusicCache("music-recommend-daily", songs.value); }
            if (recommended.status === "fulfilled") { setPlaylists(recommended.value); writeMusicCache("music-recommend-playlists", recommended.value); }
            if (toplists.status === "fulfilled") { setCharts(toplists.value); writeMusicCache("music-recommend-toplists", toplists.value); }
            setLoading(false);
        });
        return () => { alive = false; };
    }, [retry]);
    const shelf = (title: string, items: NeteasePlaylist[]) => items.length > 0 && <section className="spt-section"><h2>{title}</h2><div className="spt-shelf">{items.map(item => <button key={item.id} className="spt-shelf-card" onClick={() => onOpenPlaylist(item)}><SpotifyCover src={item.coverUrl} name={item.name} /><b>{item.name}</b><small>{item.creator || `${item.trackCount} 首歌曲`}</small></button>)}</div></section>;
    return <div className="spt-home-page">
        {filter === "all" && <section className="spt-section"><h2>为你推荐</h2><div className="spt-shelf">
            {daily.length > 0 && <button className="spt-shelf-card spt-daily-shelf" onClick={() => onOpenDaily(daily)}><span className="spt-daily-cover">{daily[0]?.coverUrl && <img src={daily[0].coverUrl} alt="" />}<i>{new Date().getDate()}</i></span><b>每日推荐</b><small>根据你的口味，每天为你更新</small></button>}
            {playlists.slice(0, 7).map(item => <button key={item.id} className="spt-shelf-card" onClick={() => onOpenPlaylist(item)}><SpotifyCover src={item.coverUrl} name={item.name} /><b>{item.name}</b><small>{item.creator || "发现你的下一首心动"}</small></button>)}
        </div></section>}
        {filter === "playlists" && shelf("为你推荐的歌单", playlists)}
        {filter !== "playlists" && shelf("热门榜单", charts.slice(0, 8))}
        {filter === "all" && shelf("继续发现", playlists.slice(7))}
        {filter === "charts" && shelf("更多音乐榜单", charts.slice(8))}
        {loading && !daily.length && !playlists.length && !charts.length && <p className="spt-state" role="status">正在为你寻找音乐…</p>}
        {!loading && !daily.length && !playlists.length && !charts.length && <div className="spt-state"><h3>暂时没有推荐内容</h3><p>检查音乐服务连接，或稍后再来。</p><button className="spt-outline-button" onClick={() => setRetry(value => value + 1)}>重新加载</button></div>}
    </div>;
}

// ── Daily Recommendation Page (second-level, like a playlist) ──
function DailySongsPage({ songs, player, onPlayNetease, onPlayAll }: {
    songs: NeteaseSearchResult[]; player: MusicControlsValue; formatTime: (s: number) => string;
    onPlayNetease: (song: NeteaseSearchResult) => void; onPlayAll: (songs: NeteaseSearchResult[]) => void;
}) {
    const active = player.currentTrack?.playbackSource === "每日推荐";
    return <div className="music-playlist-detail spt-playlist-detail">
        <div className="spt-playlist-hero"><SpotifyCover src={songs[0]?.coverUrl} name="每日推荐" /><div><h2>每日推荐</h2><p>为你挑选 · 每天更新</p></div></div>
        <p className="spt-playlist-description">从熟悉的旋律，到下一首心动。</p><p className="spt-muted-note">{songs.length} 首歌曲</p>
        <div className="spt-playlist-actions"><span /><button className="spt-icon" aria-label="随机播放" aria-pressed={player.playMode === "shuffle"} onClick={() => player.setPlayMode(player.playMode === "shuffle" ? "sequence" : "shuffle")}><SpotifyIcon name="shuffle" /></button><button className="spt-green-play" aria-label={active && player.isPlaying ? "暂停每日推荐" : "播放每日推荐"} onClick={() => active ? player.togglePlay() : onPlayAll(songs)}><SpotifyIcon name={active && player.isPlaying ? "pause" : "play"} size={26} /></button></div>
        {songs.map(song => <SpotifySongRow key={song.id} song={song} player={player} source="每日推荐" onPlay={onPlayNetease} />)}
    </div>;
}

// ── Mine Tab（网易云「我的」页式排版：全部真数据，拿不到的板块直接隐藏） ──
function MineTab({ player, formatTime, onPlayNetease, onPlayAll, activePlaylist, setActivePlaylist, playlists, loading, onToast, onGoLocal, onOpenSettings, query, searchOpen, onQuery }: {
    player: MusicControlsValue;
    formatTime: (s: number) => string;
    onPlayNetease: (r: NeteaseSearchResult, source?: string) => void;
    onPlayAll: (results: NeteaseSearchResult[], source?: string) => void;
    activePlaylist: NeteasePlaylist | null;
    setActivePlaylist: (pl: NeteasePlaylist | null) => void;
    playlists: NeteasePlaylist[];
    loading: boolean;
    onToast: (text: string) => void;
    onGoLocal: () => void;
    onOpenSettings: () => void;
    query: string; searchOpen: boolean; onQuery: (query: string) => void;
}) {
    const [weekRecords, setWeekRecords] = useState<NeteasePlayRecord[]>(() => readMusicCache("music-user-week-records", []));
    const [userDetail, setUserDetail] = useState<NeteaseUserDetail | null>(() => readMusicCache("music-user-detail", null));
    const [recentSongs, setRecentSongs] = useState<NeteaseSearchResult[]>(() => readMusicCache("music-user-recent-songs", []));
    const [djRadios, setDjRadios] = useState<NeteaseDjRadio[]>(() => readMusicCache("music-user-dj-sublist", []));
    const [subAlbums, setSubAlbums] = useState<NeteaseAlbumSub[]>(() => readMusicCache("music-user-album-sublist", []));
    const [userEvents, setUserEvents] = useState<NeteaseUserEvent[]>(() => readMusicCache("music-user-events", []));
    const [openRadioId, setOpenRadioId] = useState<number | null>(null);
    const [radioPrograms, setRadioPrograms] = useState<Record<number, NeteaseDjProgram[]>>({});
    const [heartBusy, setHeartBusy] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const cfg = loadMusicApiConfig();
        if (!cfg.baseUrl.trim()) return;
        getUserRecordWithCounts(1).then(records => {
            if (cancelled) return;
            setWeekRecords(records);
            writeMusicCache("music-user-week-records", records);
        });
        getUserDetail().then(detail => {
            if (cancelled || !detail) return;
            setUserDetail(detail);
            writeMusicCache("music-user-detail", detail);
        });
        getRecentSongs().then(songs => {
            if (cancelled || songs.length === 0) return;
            setRecentSongs(songs);
            writeMusicCache("music-user-recent-songs", songs);
        });
        getDjSublist().then(radios => {
            if (cancelled) return;
            setDjRadios(radios);
            writeMusicCache("music-user-dj-sublist", radios);
        });
        getAlbumSublist().then(albums => {
            if (cancelled) return;
            setSubAlbums(albums);
            writeMusicCache("music-user-album-sublist", albums);
        });
        getUserEvents().then(events => {
            if (cancelled) return;
            setUserEvents(events);
            writeMusicCache("music-user-events", events);
        });
        return () => { cancelled = true; };
    }, []);

    const likePlaylist = playlists.find(pl => pl.specialType === 5) ?? playlists.find(pl => pl.name.includes("喜欢的音乐")) ?? null;
    const recentList = recentSongs.length > 0 ? recentSongs : weekRecords.map(r => r.song);

    const startHeartMode = async () => {
        if (!likePlaylist || heartBusy) return;
        setHeartBusy(true);
        try {
            const likeTracks = await getPlaylistTracks(likePlaylist.id);
            const seed = likeTracks[0];
            if (!seed) { onToast("喜欢列表是空的，先收藏几首歌"); return; }
            const smart = await getIntelligenceList(seed.id, likePlaylist.id);
            if (smart.length === 0) { onToast("心动模式接口不可用"); return; }
            onPlayAll([seed, ...smart.filter(track => track.id !== seed.id)], "心动模式");
            onToast("心动模式已开启");
        } finally {
            setHeartBusy(false);
        }
    };

    const openRadio = async (radio: NeteaseDjRadio) => {
        if (openRadioId === radio.id) { setOpenRadioId(null); return; }
        setOpenRadioId(radio.id);
        if (!radioPrograms[radio.id]) {
            const programs = await getDjPrograms(radio.id);
            setRadioPrograms(prev => ({ ...prev, [radio.id]: programs }));
        }
    };

    const playProgram = (radio: NeteaseDjRadio, program: NeteaseDjProgram) => {
        onPlayNetease({
            id: program.mainSongId,
            name: program.name,
            artists: radio.dj || radio.name,
            album: radio.name,
            duration: program.duration,
            coverUrl: program.coverUrl || radio.picUrl,
        }, radio.name);
    };

    return <>
        {activePlaylist && <PlaylistsTab player={player} formatTime={formatTime} onPlayNetease={onPlayNetease} onPlayAll={onPlayAll} activePlaylist={activePlaylist} setActivePlaylist={setActivePlaylist} playlists={playlists} loading={loading} onToast={onToast} />}
        <div className="spt-page-host" hidden={!!activePlaylist}><SpotifyLibrary playlists={playlists} loading={loading} player={player} recent={recentList} albums={subAlbums} radios={djRadios} events={userEvents} records={weekRecords} profile={userDetail} query={query} searchOpen={searchOpen} onQuery={onQuery} onPlaylist={setActivePlaylist} onPlay={onPlayNetease} onPlayAll={onPlayAll} onHeart={() => void startHeartMode()} heartBusy={heartBusy} radioId={openRadioId} programs={radioPrograms} onRadio={radio => void openRadio(radio)} onProgram={playProgram} /></div>
    </>;
}

// ── Song List (local) ──
function SongList({ tracks, player, formatTime, onDelete, onPlay }: {
    tracks: MusicTrack[];
    player: MusicControlsValue;
    formatTime: (s: number) => string;
    onDelete: (id: string, e: React.MouseEvent) => void;
    onPlay: (t: MusicTrack) => void;
}) {
    const [deleteTarget, setDeleteTarget] = useState<MusicTrack | null>(null);

    return (
        <div className="music-list">
            {tracks.map((track, idx) => {
                const isCurrent = player.currentTrack?.id === track.id;
                return (
                    <div key={track.id} className="music-song" {...(isCurrent ? { "data-playing": "" } : {})} style={{ animationDelay: `${Math.min(idx * 0.04, 0.5)}s` }} onClick={() => onPlay(track)}>
                        <div className="music-song-cover">
                            {track.coverUrl ? <img src={track.coverUrl} alt="" /> : (
                                <div className="music-song-cover-placeholder">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                                </div>
                            )}
                            {isCurrent && player.isPlaying && (
                                <div className="music-song-playing-overlay">
                                    <div className="music-wave">{[0, 1, 2, 3].map(i => <span key={i} className="music-wave-bar" style={{ animationDelay: `${i * 0.15}s` }} />)}</div>
                                </div>
                            )}
                        </div>
                        <div className="music-song-info">
                            <div className="music-song-title">{track.title}</div>
                            <div className="music-song-artist">{track.artist}</div>
                        </div>
                        <div className="music-song-duration">{formatTime(track.duration)}</div>
                        <div className="music-song-actions">
                            <button className="music-song-action-btn" data-danger="" onClick={(e) => { e.stopPropagation(); setDeleteTarget(track); }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                            </button>
                        </div>
                    </div>
                );
            })}

            {/* Delete confirm modal */}
            {deleteTarget && (
                <div className="music-settings-modal-overlay" onClick={() => setDeleteTarget(null)}>
                    <div className="music-settings-modal-dialog music-confirm-dialog" onClick={e => e.stopPropagation()}>
                        <div className="music-settings-header"><h2>删除确认</h2></div>
                        <div className="music-settings-body">
                            <div className="music-confirm-text">确定删除「{deleteTarget.title}」吗？</div>
                            <div className="music-settings-actions">
                                <button className="music-settings-btn" onClick={() => setDeleteTarget(null)}>取消</button>
                                <button className="music-settings-btn music-settings-btn-danger" onClick={(e) => { onDelete(deleteTarget.id, e); setDeleteTarget(null); }}>删除</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}

// ── Online Search Tab ──
// Search presentation lives in music-spotify-search.tsx.

// ── Playlists Tab ──
function PlaylistsTab({ player, formatTime, onPlayNetease, onPlayAll, activePlaylist, setActivePlaylist, playlists, loading, onToast }: {
    player: MusicControlsValue;
    formatTime: (s: number) => string;
    onPlayNetease: (r: NeteaseSearchResult) => void;
    onPlayAll: (results: NeteaseSearchResult[]) => void;
    activePlaylist: NeteasePlaylist | null;
    setActivePlaylist: (pl: NeteasePlaylist | null) => void;
    playlists: NeteasePlaylist[];
    loading: boolean;
    onToast: (text: string) => void;
}) {
    const [tracks, setTracks] = useState<NeteaseSearchResult[]>([]);
    const [loadingTracks, setLoadingTracks] = useState(false);
    const [detail, setDetail] = useState<NeteasePlaylistDetail | null>(null);
    const [isSubscribed, setIsSubscribed] = useState(false);
    const [subDelta, setSubDelta] = useState(0);
    const [subscribing, setSubscribing] = useState(false);
    const [showComments, setShowComments] = useState(false);
    const [sort, setSort] = useState<"default" | "title" | "artist">("default");
    const [filterOpen, setFilterOpen] = useState(false);
    const [trackQuery, setTrackQuery] = useState("");
    const [showMoreOptions, setShowMoreOptions] = useState(false);

    // Fetch rich playlist meta (play count / tags / description)
    useEffect(() => {
        setShowComments(false); setTrackQuery(""); setFilterOpen(false); setSort("default"); setShowMoreOptions(false); setDetail(null);
        setSubDelta(0);
        setIsSubscribed(false);
        if (!activePlaylist) {
            setDetail(null);
            return;
        }
        let cancelled = false;
        const cacheKey = `music-playlist-detail-${activePlaylist.id}`;
        const cached = readMusicCache<NeteasePlaylistDetail | null>(cacheKey, null);
        if (cached) {
            setDetail(cached);
            setIsSubscribed(!!cached.subscribed);
        }
        getPlaylistDetail(activePlaylist.id).then(d => {
            if (cancelled || !d) return;
            setDetail(d);
            setIsSubscribed(!!d.subscribed);
            setSubDelta(0);
            writeMusicCache(cacheKey, d);
        });
        return () => { cancelled = true; };
    }, [activePlaylist]);

    const handleCollect = async () => {
        if (!activePlaylist || subscribing) return;
        const next = !isSubscribed;
        setSubscribing(true);
        const result = await subscribePlaylist(activePlaylist.id, next);
        setSubscribing(false);
        onToast(result.message);
        if (result.ok) {
            setIsSubscribed(next);
            setSubDelta(d => d + (next ? 1 : -1));
        }
    };

    // Clear tracks when navigating back to playlist list
    useEffect(() => {
        if (!activePlaylist) {
            setTracks([]);
            return;
        }

        let cancelled = false;
        const cacheKey = `music-playlist-tracks-${activePlaylist.id}`;
        try {
            const cached = kvGet(cacheKey);
            if (cached) { setTracks(JSON.parse(cached)); setLoadingTracks(false); }
            else { setLoadingTracks(true); }
        } catch { setLoadingTracks(true); }

        getPlaylistTracks(activePlaylist.id).then((nextTracks) => {
            if (cancelled) return;
            setTracks(nextTracks);
            setLoadingTracks(false);
            if (nextTracks.length > 0) kvSet(cacheKey, JSON.stringify(nextTracks));
        }).catch(() => {
            if (!cancelled) setLoadingTracks(false);
        });

        return () => { cancelled = true; };
    }, [activePlaylist]);

    const openPlaylist = async (pl: NeteasePlaylist) => {
        setActivePlaylist(pl);
    };

    // Showing tracks inside a playlist
    if (activePlaylist) {
        const visibleTracks = tracks.filter(song => `${song.name} ${song.artists}`.toLocaleLowerCase().includes(trackQuery.trim().toLocaleLowerCase()));
        if (sort !== "default") visibleTracks.sort((a, b) => (sort === "title" ? a.name : a.artists).localeCompare(sort === "title" ? b.name : b.artists, "zh-CN"));
        const active = player.currentTrack?.playbackSource === activePlaylist.name;
        const minutes = Math.round(tracks.reduce((sum, song) => sum + song.duration, 0) / 60000);
        const duration = minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟` : `${minutes} 分钟`;
        return <>
            <div className="music-playlist-detail spt-playlist-detail">
                <div className="spt-playlist-hero"><SpotifyCover src={detail?.coverUrl || activePlaylist.coverUrl} name={activePlaylist.name} /><div><h2>{activePlaylist.name}</h2><p><span className="spt-creator-dot">{(detail?.creator || activePlaylist.creator || "M").slice(0, 1)}</span>{detail?.creator || activePlaylist.creator || "音乐歌单"}</p></div></div>
                {detail?.description && <p className="spt-playlist-description">{detail.description}</p>}
                <p className="spt-muted-note">{detail?.trackCount || activePlaylist.trackCount} 首歌曲{tracks.length > 0 ? ` · ${duration}` : ""}</p>
                <div className="spt-playlist-actions">
                    <button className="spt-icon" aria-label={isSubscribed ? "取消收藏歌单" : "收藏歌单"} aria-pressed={isSubscribed} disabled={subscribing} onClick={handleCollect}><SpotifyIcon name={isSubscribed ? "check" : "plus"} size={25} /></button>
                    <button className="spt-icon" aria-label="歌单评论" onClick={() => setShowComments(true)}><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 11a9 9 0 0 1-13 8l-5 2 2-5a9 9 0 1 1 16-5Z" /></svg></button>
                    <button className="spt-icon" aria-label="更多歌单功能" aria-expanded={showMoreOptions} onClick={() => setShowMoreOptions(value => !value)}><SpotifyIcon name="more" /></button><span />
                    <button className="spt-icon" aria-label="随机播放" aria-pressed={player.playMode === "shuffle"} onClick={() => player.setPlayMode(player.playMode === "shuffle" ? "sequence" : "shuffle")}><SpotifyIcon name="shuffle" size={25} /></button>
                    <button className="spt-green-play" disabled={!tracks.length} aria-label={active && player.isPlaying ? "暂停歌单" : "播放歌单"} onClick={() => active ? player.togglePlay() : onPlayAll(visibleTracks.length ? visibleTracks : tracks)}><SpotifyIcon name={active && player.isPlaying ? "pause" : "play"} size={27} /></button>
                </div>
                {showMoreOptions && <div className="spt-playlist-more"><p>{detail?.playCount ? `${formatMusicCount(detail.playCount)} 次播放 · ` : ""}{Math.max(0, (detail?.subscribedCount || 0) + subDelta)} 次收藏{detail?.commentCount ? ` · ${formatMusicCount(detail.commentCount)} 条评论` : ""}</p>{detail?.tags?.length ? <p>{detail.tags.join(" · ")}</p> : null}<button className="spt-outline-button" onClick={() => { void navigator.clipboard.writeText(`https://music.163.com/#/playlist?id=${activePlaylist.id}`).then(() => onToast("歌单链接已复制"), () => onToast("复制失败，请检查浏览器权限")); }}>复制歌单链接</button></div>}
                <div className="spt-playlist-tools"><button onClick={() => { setFilterOpen(value => !value); setTrackQuery(""); }}><SpotifyIcon name="search" size={16} />查找歌曲</button><button onClick={() => setSort(value => value === "default" ? "title" : value === "title" ? "artist" : "default")}><SpotifyIcon name="sort" size={16} />{sort === "default" ? "排序" : sort === "title" ? "按歌名" : "按艺人"}</button></div>
                {filterOpen && <input className="spt-library-search" aria-label="在歌单内搜索" placeholder="在这张歌单里查找" value={trackQuery} onChange={event => setTrackQuery(event.target.value)} autoFocus />}
                {loadingTracks ? <p className="spt-state" role="status">加载歌单…</p> : visibleTracks.length ? visibleTracks.map(song => <SpotifySongRow key={song.id} song={song} onPlay={onPlayNetease} player={player} source={activePlaylist.name} />) : <p className="spt-state">{trackQuery ? "没有匹配的歌曲" : "歌单中暂无可用曲目"}</p>}
            </div>
            {showComments && <MusicCommentsPage songId={activePlaylist.id} resType={2} title={activePlaylist.name} artist={detail?.creator || activePlaylist.creator || "歌单"} coverUrl={detail?.coverUrl || activePlaylist.coverUrl} onClose={() => setShowComments(false)} />}
        </>;
    }

    // Playlist grid
    return (
        <div className="music-playlists">
            {loading ? (
                <div className="music-empty"><div className="music-empty-text">加载歌单...</div></div>
            ) : playlists.length === 0 ? (
                <div className="music-empty">
                    <div className="music-empty-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round"><rect x="2" y="3" width="20" height="18" rx="2" /><path d="M8 12h8M8 16h5" /></svg>
                    </div>
                    <div className="music-empty-text">没有歌单</div>
                    <div className="music-empty-text" style={{ fontSize: "calc(11px*var(--app-text-scale,1))", opacity: 0.5 }}>请先在设置中登录网易云账号</div>
                </div>
            ) : (
                <div className="music-playlist-grid">
                    {playlists.map(pl => (
                        <div key={pl.id} className="music-playlist-card" onClick={() => openPlaylist(pl)}>
                            <div className="music-playlist-cover">
                                <img src={pl.coverUrl} alt="" />
                                <span className="music-playlist-count">{pl.trackCount}</span>
                            </div>
                            <div className="music-playlist-name">{pl.name}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Settings Tab ──
function MusicSettingsTab({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
    const [config, setConfig] = useState<MusicApiConfig>(() => loadMusicApiConfig());
    const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
    const [testing, setTesting] = useState(false);

    // QR login state
    const [qrImg, setQrImg] = useState<string | null>(null);
    const [qrKey, setQrKey] = useState<string | null>(null);
    const [qrStatus, setQrStatus] = useState<string>("");
    const [qrPolling, setQrPolling] = useState(false);
    const [loginNickname, setLoginNickname] = useState<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Custom background state (app pages + player each have their own image)
    const [bg, setBg] = useState<MusicBgConfig>(() => loadMusicBg());
    const [bgMsg, setBgMsg] = useState<string | null>(null);
    const [bgUrlDraft, setBgUrlDraft] = useState(() => {
        const cfg = loadMusicBg();
        return cfg.image.startsWith("data:") ? "" : cfg.image;
    });
    const [playerUrlDraft, setPlayerUrlDraft] = useState(() => {
        const cfg = loadMusicBg();
        return cfg.playerImage.startsWith("data:") ? "" : cfg.playerImage;
    });
    const bgFileRef = useRef<HTMLInputElement>(null);
    const playerFileRef = useRef<HTMLInputElement>(null);
    const [floatMode, setFloatMode] = useState<MusicFloatMode>(() => loadMusicFloatMode());

    const applyBg = (next: MusicBgConfig) => {
        const result = saveMusicBg(next);
        setBgMsg(result.ok ? null : result.message);
        if (result.ok) setBg(next);
    };

    const handleBgUpload = async (files: FileList | null, target: "app" | "player") => {
        const file = files?.[0];
        if (!file) return;
        try {
            const dataUrl = await fileToCompressedDataUrl(file);
            if (target === "app") {
                applyBg({ ...bg, image: dataUrl });
                setBgUrlDraft("");
            } else {
                applyBg({ ...bg, playerImage: dataUrl, playerMode: "custom" });
                setPlayerUrlDraft("");
            }
        } catch (e) {
            setBgMsg(e instanceof Error ? e.message : "图片处理失败");
        }
        if (bgFileRef.current) bgFileRef.current.value = "";
        if (playerFileRef.current) playerFileRef.current.value = "";
    };

    const handleBgUrl = (target: "app" | "player") => {
        const url = (target === "app" ? bgUrlDraft : playerUrlDraft).trim();
        if (!url) return;
        if (!/^https?:\/\//.test(url)) { setBgMsg("请输入 http(s) 图片链接"); return; }
        const secure = url.replace(/^http:\/\//, "https://");
        if (target === "app") applyBg({ ...bg, image: secure });
        else applyBg({ ...bg, playerImage: secure, playerMode: "custom" });
    };

    const handleBgClear = () => {
        clearMusicBg();
        setBg(loadMusicBg());
        setBgUrlDraft("");
        setPlayerUrlDraft("");
        setBgMsg(null);
    };

    const setPlayerMode = (mode: MusicPlayerBgMode) => {
        applyBg({ ...bg, playerMode: mode });
    };

    // Check login status on mount when API is configured
    useEffect(() => {
        const base = config.baseUrl.trim();
        if (!base) return;
        checkLoginStatus(base).then(s => {
            if (s.loggedIn && s.nickname) {
                setLoginNickname(s.nickname);
            }
        });
    }, [config.baseUrl]);

    // Cleanup polling on unmount
    useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

    const handleSave = () => {
        const nextConfig = { ...config, baseUrl: config.baseUrl.trim(), enabled: true };
        saveMusicApiConfig(nextConfig);
        setConfig(nextConfig);
        onSaved();
        onBack();
    };

    const handleTest = async () => {
        if (!config.baseUrl.trim()) return;
        setTesting(true);
        setTestResult(null);
        const result = await testNeteaseConnection(config.baseUrl.trim());
        setTestResult(result);
        setTesting(false);
    };

    const startQrLogin = async () => {
        const base = config.baseUrl.trim();
        if (!base) return;
        setQrStatus("获取二维码...");
        setQrImg(null);
        if (pollRef.current) clearInterval(pollRef.current);

        const key = await getQrKey(base);
        if (!key) { setQrStatus("获取二维码失败"); return; }
        setQrKey(key);

        const img = await getQrImage(base, key);
        if (!img) { setQrStatus("生成二维码失败"); return; }
        setQrImg(img);
        setQrStatus("请用网易云音乐 App 扫码");
        setQrPolling(true);

        pollRef.current = setInterval(async () => {
            const res = await checkQrStatus(base, key);
            if (res.code === 803) {
                // Authorized — save auth cookie for subsequent API calls
                if (res.cookie) saveNeteaseCookie(res.cookie);
                const nextConfig = { ...config, baseUrl: base, enabled: true };
                saveMusicApiConfig(nextConfig);
                setConfig(nextConfig);
                if (pollRef.current) clearInterval(pollRef.current);
                setQrPolling(false);
                setQrImg(null);
                setQrStatus("");
                setLoginNickname(res.nickname || "已登录");
                onSaved();
            } else if (res.code === 802) {
                setQrStatus("已扫码，请在手机上确认");
            } else if (res.code === 800) {
                if (pollRef.current) clearInterval(pollRef.current);
                setQrPolling(false);
                setQrImg(null);
                setQrStatus("二维码已过期，请重新获取");
            }
            // 801 = waiting, do nothing
        }, 2000);
    };

    const handleLogout = () => {
        if (pollRef.current) clearInterval(pollRef.current);
        setQrPolling(false);
        setQrImg(null);
        setQrKey(null);
        setQrStatus("");
        setLoginNickname(null);
        clearNeteaseCookie();
        clearMusicCloudSyncData();
        onSaved();
    };

    return (
        <div className="music-settings">
            <div className="music-settings-header">
                <h2>设置</h2>
                <button className="music-settings-close" onClick={onBack}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
            </div>

            <div className="music-settings-body">
                <div className="music-settings-section">
                    <div className="music-settings-label">后台悬浮样式</div>
                    <div className="music-settings-hint">退出音乐 App 后，选择播放控件的显示方式</div>
                    <div className="music-settings-actions">
                        <button type="button" className={`music-settings-btn${floatMode === "orb" ? " music-settings-btn-primary" : ""}`} aria-pressed={floatMode === "orb"} onClick={() => { saveMusicFloatMode("orb"); setFloatMode("orb"); }}>悬浮球</button>
                        <button type="button" className={`music-settings-btn${floatMode === "island" ? " music-settings-btn-primary" : ""}`} aria-pressed={floatMode === "island"} onClick={() => { saveMusicFloatMode("island"); setFloatMode("island"); }}>灵动岛</button>
                    </div>
                </div>
                <div className="music-settings-section">
                    <div className="music-settings-label">网易云 API 地址</div>
                    <div className="music-settings-hint">默认使用公共服务，也可以改成自己的 NeteaseCloudMusicApi 地址</div>
                    <input
                        className="music-settings-input"
                        placeholder="https://your-api.vercel.app"
                        value={config.baseUrl}
                        onChange={(e) => setConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                    />
                </div>

                <div className="music-settings-actions">
                    <button className="music-settings-btn" onClick={handleTest} disabled={testing || !config.baseUrl.trim()}>
                        {testing ? "测试中..." : "测试连接"}
                    </button>
                    <button className="music-settings-btn music-settings-btn-primary" onClick={handleSave}>
                        保存
                    </button>
                </div>

                {testResult && (
                    <div className={`music-settings-result ${testResult.ok ? "music-settings-result-ok" : "music-settings-result-err"}`}>
                        {testResult.ok ? "✓ " : "✗ "}{testResult.message}
                    </div>
                )}

                {/* QR Login Section */}
                {config.baseUrl.trim() && (
                    <div className="music-settings-section music-qr-section">
                        <div className="music-settings-label">网易云账号登录</div>
                        <div className="music-settings-hint">登录后可播放 VIP 歌曲（需扫码）</div>

                        {loginNickname ? (
                            <div className="music-qr-logged">
                                <span className="music-qr-nickname">{loginNickname}</span>
                                <span className="music-qr-badge">已登录</span>
                            </div>
                        ) : (
                            <>
                                <div className="music-settings-actions" style={{ marginTop: '8px' }}>
                                    <button
                                        className="music-settings-btn"
                                        onClick={startQrLogin}
                                        disabled={qrPolling}
                                    >
                                        {qrPolling ? "等待扫码中..." : "扫码登录"}
                                    </button>
                                </div>

                                {qrImg && (
                                    <div className="music-qr-wrap">
                                        <img src={qrImg} alt="QR Code" className="music-qr-img" />
                                    </div>
                                )}
                            </>
                        )}

                        {qrStatus && <div className="music-qr-status">{qrStatus}</div>}
                    </div>
                )}

                {loginNickname && (
                    <div className="music-settings-actions" style={{ marginTop: 20 }}>
                        <button
                            className="music-settings-btn"
                            onClick={handleLogout}
                        >
                            退出登录
                        </button>
                    </div>
                )}

                {/* Custom backgrounds: app pages + player page */}
                <div className="music-settings-section music-qr-section">
                    <div className="music-settings-label">App 页面背景</div>
                    <div className="music-settings-hint">首页/歌单/我的等页面的背景图，上传或粘贴链接即时生效</div>

                    {bg.image && (
                        <div className="music-bg-preview" style={{ backgroundImage: `url("${bg.image}")` }}>
                            <span style={{ opacity: bg.dim / 100 }} />
                        </div>
                    )}

                    <input ref={bgFileRef} type="file" accept="image/*" hidden onChange={e => { void handleBgUpload(e.target.files, "app"); }} />
                    <div className="music-settings-actions" style={{ marginTop: 8 }}>
                        <button className="music-settings-btn" onClick={() => bgFileRef.current?.click()}>上传图片</button>
                        {bg.image && <button className="music-settings-btn" onClick={() => applyBg({ ...bg, image: "" })}>清除此图</button>}
                    </div>

                    <div className="music-settings-actions">
                        <input
                            className="music-settings-input"
                            placeholder="https:// 图片链接"
                            value={bgUrlDraft}
                            onChange={e => setBgUrlDraft(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && handleBgUrl("app")}
                        />
                        <button className="music-settings-btn" style={{ flex: "0 0 76px" }} onClick={() => handleBgUrl("app")} disabled={!bgUrlDraft.trim()}>使用</button>
                    </div>

                    {bg.image && (
                        <>
                            <div className="music-settings-row" style={{ marginTop: 4 }}>
                                <span className="music-settings-label">背景暗化 {bg.dim}%</span>
                            </div>
                            <input
                                type="range"
                                className="music-bg-range"
                                min={20}
                                max={85}
                                value={bg.dim}
                                onChange={e => applyBg({ ...bg, dim: parseInt(e.target.value, 10) })}
                            />
                        </>
                    )}
                </div>

                <div className="music-settings-section music-qr-section">
                    <div className="music-settings-label">播放页背景</div>
                    <div className="music-settings-hint">全屏播放页可以单独设置背景</div>

                    <div className="music-bg-modes">
                        <button className="music-bg-mode" {...(bg.playerMode === "cover" ? { "data-on": "" } : {})} onClick={() => setPlayerMode("cover")}>封面取色</button>
                        <button className="music-bg-mode" {...(bg.playerMode === "follow" ? { "data-on": "" } : {})} onClick={() => setPlayerMode("follow")}>跟随App背景</button>
                        <button className="music-bg-mode" {...(bg.playerMode === "custom" ? { "data-on": "" } : {})} onClick={() => setPlayerMode("custom")}>独立图片</button>
                    </div>

                    {bg.playerMode === "custom" && (
                        <>
                            {bg.playerImage && (
                                <div className="music-bg-preview" style={{ backgroundImage: `url("${bg.playerImage}")` }}>
                                    <span style={{ opacity: bg.playerDim / 100 }} />
                                </div>
                            )}

                            <input ref={playerFileRef} type="file" accept="image/*" hidden onChange={e => { void handleBgUpload(e.target.files, "player"); }} />
                            <div className="music-settings-actions" style={{ marginTop: 8 }}>
                                <button className="music-settings-btn" onClick={() => playerFileRef.current?.click()}>上传图片</button>
                                {bg.playerImage && <button className="music-settings-btn" onClick={() => applyBg({ ...bg, playerImage: "" })}>清除此图</button>}
                            </div>

                            <div className="music-settings-actions">
                                <input
                                    className="music-settings-input"
                                    placeholder="https:// 图片链接"
                                    value={playerUrlDraft}
                                    onChange={e => setPlayerUrlDraft(e.target.value)}
                                    onKeyDown={e => e.key === "Enter" && handleBgUrl("player")}
                                />
                                <button className="music-settings-btn" style={{ flex: "0 0 76px" }} onClick={() => handleBgUrl("player")} disabled={!playerUrlDraft.trim()}>使用</button>
                            </div>

                            {bg.playerImage && (
                                <>
                                    <div className="music-settings-row" style={{ marginTop: 4 }}>
                                        <span className="music-settings-label">背景暗化 {bg.playerDim}%</span>
                                    </div>
                                    <input
                                        type="range"
                                        className="music-bg-range"
                                        min={20}
                                        max={85}
                                        value={bg.playerDim}
                                        onChange={e => applyBg({ ...bg, playerDim: parseInt(e.target.value, 10) })}
                                    />
                                </>
                            )}
                        </>
                    )}

                    {(bg.image || bg.playerImage) && (
                        <div className="music-settings-actions" style={{ marginTop: 8 }}>
                            <button className="music-settings-btn" onClick={handleBgClear}>全部恢复默认背景</button>
                        </div>
                    )}
                    {bgMsg && <div className="music-qr-status">{bgMsg}</div>}
                </div>
            </div>
        </div>
    );
}

function readMusicCache<T>(key: string, fallback: T): T {
    try {
        const raw = kvGet(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && "data" in parsed) return parsed.data as T;
        return parsed as T;
    } catch {
        return fallback;
    }
}

function writeMusicCache<T>(key: string, data: T): void {
    try {
        kvSet(key, JSON.stringify({ data, updatedAt: Date.now() }));
    } catch { /* ignore */ }
}

function formatMusicCount(value: number): string {
    if (!Number.isFinite(value)) return "0";
    if (value >= 100000000) return `${Math.round(value / 10000000) / 10}亿`;
    if (value >= 10000) return `${Math.round(value / 1000) / 10}万`;
    return String(value);
}

// ── CSS Editor ──
import { MUSIC_CSS_EXAMPLE } from "@/lib/css-examples";
import CSSSchemeBar from "@/components/ui/css-scheme-picker";
import { kvGet, kvSet, kvRemove } from "@/lib/kv-db";

function MusicCssEditor({ onClose, onSave }: { onClose: () => void; onSave: (css: string) => void }) {
    const [css, setCss] = useState(() => kvGet("music-custom-css") || "");

    const handleSave = () => {
        const trimmed = css.trim();
        if (trimmed) kvSet("music-custom-css", trimmed);
        else kvRemove("music-custom-css");
        onSave(trimmed);
        window.dispatchEvent(new CustomEvent("music-css-change", { detail: trimmed }));
        onClose();
    };

    return (
        <div className="music-settings">
            <div className="music-settings-header">
                <h2>自定义样式</h2>
                <button className="music-settings-close" onClick={onClose}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
            </div>
            <div className="music-settings-body">
                <div className="music-settings-hint">输入 CSS 代码，覆盖音乐页面任意样式</div>
                <textarea
                    className="music-settings-input"
                    style={{ height: 280, resize: "none", fontFamily: "'SF Mono', 'Menlo', 'Monaco', monospace", fontSize: "calc(13px*var(--app-text-scale,1))", lineHeight: 1.6, padding: "12px 14px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}
                    value={css}
                    onChange={e => setCss(e.target.value)}
                    placeholder="/* 在此输入自定义 CSS... */"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                />
                <div className="music-settings-actions">
                    <CSSSchemeBar target="music" currentCSS={css} onLoad={setCss} btnStyle={{
                      border: "1px solid var(--c-music-surface-solid, rgba(255,255,255,0.12))",
                      background: "var(--c-music-surface, rgba(255,255,255,0.06))",
                      color: "var(--c-music-text, #e0d8f0)",
                    }} modalVars={{
                      panel: "var(--c-music-bg, #0c0a1a)",
                      border: "var(--c-music-surface-solid, rgba(255,255,255,0.12))",
                      text: "var(--c-music-text, #e0d8f0)",
                      textDim: "var(--c-music-accent, #b49de8)",
                      input: "var(--c-music-surface, rgba(255,255,255,0.06))",
                      inputBorder: "var(--c-music-surface-solid, rgba(255,255,255,0.12))",
                      accent: "var(--c-music-accent, #b49de8)",
                    }} />
                    <button className="music-settings-btn" onClick={() => setCss(MUSIC_CSS_EXAMPLE)}>示例</button>
                    <button className="music-settings-btn" onClick={() => setCss("")}>清空</button>
                    <button className="music-settings-btn music-settings-btn-primary" onClick={handleSave}>保存</button>
                </div>
            </div>
        </div>
    );
}
