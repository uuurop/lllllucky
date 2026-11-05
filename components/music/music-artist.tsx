"use client";
/* eslint-disable @next/next/no-img-element -- The artist image comes from the configured music service. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMusicControls } from "@/lib/music-context";
import type { MusicTrack } from "@/lib/music-storage";
import { getArtistDetail, getArtistTopSongs, getArtistAlbums, getAlbumTracks, getNeteasePlayInfo, getNeteaseSongDetail, getNeteaseLyrics, type NeteaseArtist, type NeteaseAlbum, type NeteaseSearchResult } from "@/lib/music-service";
import { SpotifyCover, SpotifyIcon, SpotifySongRow, SpotifyDetailNav } from "./music-spotify-ui";

type Props = { artistId: number; artistName: string; onClose: () => void };
function formatFans(value: number) { return value >= 100000000 ? `${Math.round(value / 10000000) / 10}亿` : value >= 10000 ? `${Math.round(value / 1000) / 10}万` : value.toLocaleString(); }
function toTrack(song: NeteaseSearchResult, source: string): MusicTrack {
    return { id: `netease_${song.id}`, title: song.name, artist: song.artists, duration: song.duration / 1000, coverUrl: song.coverUrl, liked: false, addedAt: new Date().toISOString(), playbackSource: source };
}

export default function MusicArtistPage({ artistId, artistName, onClose }: Props) {
    const player = useMusicControls();
    const [artist, setArtist] = useState<NeteaseArtist | null>(null);
    const [topSongs, setTopSongs] = useState<NeteaseSearchResult[]>([]);
    const [albums, setAlbums] = useState<NeteaseAlbum[]>([]);
    const [loading, setLoading] = useState(true);
    const [section, setSection] = useState<"music" | "albums" | "about">("music");
    const [showAll, setShowAll] = useState(false);
    const [menu, setMenu] = useState(false);
    const [openAlbum, setOpenAlbum] = useState<NeteaseAlbum | null>(null);
    const [albumSongs, setAlbumSongs] = useState<NeteaseSearchResult[]>([]);
    const [albumLoading, setAlbumLoading] = useState(false);
    const [pendingSongId, setPendingSongId] = useState<number | null>(null);
    const [toast, setToast] = useState("");
    const playRequest = useRef(0);
    const name = artist?.name || artistName;
    useEffect(() => {
        let alive = true;
        ++playRequest.current; setPendingSongId(null); setLoading(true); setArtist(null); setTopSongs([]); setAlbums([]); setSection("music"); setOpenAlbum(null); setShowAll(false); setMenu(false);
        Promise.allSettled([getArtistDetail(artistId), getArtistTopSongs(artistId), getArtistAlbums(artistId, 30)]).then(([detail, songs, records]) => {
            if (!alive) return;
            if (detail.status === "fulfilled") setArtist(detail.value);
            if (songs.status === "fulfilled") setTopSongs(songs.value);
            if (records.status === "fulfilled") setAlbums(records.value);
            setLoading(false);
        });
        return () => { alive = false; ++playRequest.current; };
    }, [artistId]);
    useEffect(() => {
        if (!openAlbum) return;
        let alive = true; setAlbumLoading(true); setAlbumSongs([]);
        getAlbumTracks(openAlbum.id).then(songs => { if (alive) setAlbumSongs(songs); }).finally(() => { if (alive) setAlbumLoading(false); });
        return () => { alive = false; };
    }, [openAlbum]);
    useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 2500); return () => clearTimeout(timer); }, [toast]);
    const playSong = useCallback(async (song: NeteaseSearchResult, queue?: NeteaseSearchResult[], source = name) => {
        const token = ++playRequest.current; setPendingSongId(song.id);
        try {
            const info = await getNeteasePlayInfo(song.id);
            if (token !== playRequest.current) return;
            if (!info.url) { setToast(info.reason || "这首歌暂时无法播放"); return; }
            const [detail, lyrics] = await Promise.all([getNeteaseSongDetail(song.id).catch(() => null), getNeteaseLyrics(song.id).catch(() => "")]);
            if (token !== playRequest.current) return;
            const track = { ...toTrack(song, source), title: detail?.name || song.name, artist: detail?.artists || song.artists, coverUrl: detail?.coverUrl || song.coverUrl, lyrics };
            if (queue) player.setQueue(queue.map(item => item.id === song.id ? track : toTrack(item, source)));
            else if (player.queue.some(item => item.id === track.id)) player.setQueue(player.queue.map(item => item.id === track.id ? track : item));
            else player.setQueue([track, ...player.queue]);
            player.playUrl(info.url, track);
            if (info.trial) setToast("当前为歌曲试听片段");
        } catch { if (token === playRequest.current) setToast("暂时无法播放，请稍后重试"); }
        finally { if (token === playRequest.current) setPendingSongId(null); }
    }, [name, player]);
    const currentSongs = openAlbum ? albumSongs : topSongs;
    const source = openAlbum?.name || name;
    const active = player.currentTrack?.playbackSource === source;
    const playAll = () => {
        if (active && player.currentTrack) { player.togglePlay(); return; }
        const song = currentSongs[player.playMode === "shuffle" ? Math.floor(Math.random() * currentSongs.length) : 0];
        if (song) void playSong(song, currentSongs, source);
    };
    const albumShelf = albums.length > 0 && <div className="spt-shelf spt-artist-albums">{albums.map(album => <button key={album.id} className="spt-shelf-card" onClick={() => { setOpenAlbum(album); setSection("albums"); }}><SpotifyCover src={album.coverUrl} name={album.name} /><b>{album.name}</b><small>{album.year ? `${album.year} · ` : ""}专辑</small></button>)}</div>;
    return <div className="mart-page spt-artist-page">
        <div className="mart-hero">
            {artist?.cover && <img src={artist.cover} alt="" className="mart-hero-img" />}
            <div className="mart-hero-fade" />
            <SpotifyDetailNav backLabel={openAlbum ? "返回歌手" : "返回"} onBack={() => openAlbum ? setOpenAlbum(null) : onClose()} moreLabel="更多歌手功能" expanded={menu} onMore={() => setMenu(value => !value)} />
            {menu && <div className="spt-artist-menu"><button onClick={() => { setSection("albums"); setOpenAlbum(null); setMenu(false); }}>查看专辑</button><button onClick={() => { setSection("about"); setMenu(false); }}>歌手简介</button><button onClick={() => { void navigator.clipboard.writeText(`https://music.163.com/#/artist?id=${artistId}`).then(() => setToast("歌手链接已复制"), () => setToast("暂时无法复制链接")); setMenu(false); }}>复制歌手链接</button></div>}
            <div className="mart-id"><h1 className="mart-name">{name}</h1><span className="spt-artist-label">艺人</span></div>
        </div>
        <div className="mart-body">
            <p className="spt-artist-stats">{[typeof artist?.fansCount === "number" ? `${formatFans(artist.fansCount)} 位粉丝` : "", artist?.musicSize ? `${artist.musicSize} 首歌曲` : "", artist?.albumSize ? `${artist.albumSize} 张专辑` : ""].filter(Boolean).join(" · ") || "探索这位艺人的音乐"}</p>
            <div className="spt-artist-actions"><button className="spt-outline-button" onClick={() => { setSection("about"); setOpenAlbum(null); }}>歌手简介</button><span /><button className="spt-icon" aria-label="随机播放" aria-pressed={player.playMode === "shuffle"} onClick={() => player.setPlayMode(player.playMode === "shuffle" ? "sequence" : "shuffle")}><SpotifyIcon name="shuffle" size={27} /></button><button className="spt-green-play" aria-label={active && player.isPlaying ? "暂停" : openAlbum ? "播放专辑" : "播放热门歌曲"} disabled={!currentSongs.length || pendingSongId !== null} onClick={playAll}><SpotifyIcon name={active && player.isPlaying ? "pause" : "play"} size={29} /></button></div>
            <div className="spt-artist-tabs" role="tablist" aria-label="歌手作品分类">{([["music", "音乐"], ["albums", "专辑"], ["about", "简介"]] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={section === value} onClick={() => { setSection(value); setOpenAlbum(null); }}>{label}</button>)}</div>
            {loading ? <p className="spt-state" role="status">加载歌手信息…</p> : <>
                {section === "music" && <><div className="spt-artist-section-head"><h2>热门</h2><small>{topSongs.length} 首</small></div><div>{topSongs.slice(0, showAll ? topSongs.length : 10).map((song, index) => <div key={song.id} className="spt-artist-song" data-pending={pendingSongId === song.id || undefined} aria-busy={pendingSongId === song.id}><span>{index + 1}</span><SpotifySongRow song={song} player={player} source={name} onPlay={item => void playSong(item)} /></div>)}</div>{topSongs.length > 10 && <button className="spt-artist-show-all spt-outline-button" onClick={() => setShowAll(value => !value)}>{showAll ? "收起热门歌曲" : "查看全部热门歌曲"}</button>}{!topSongs.length && <p className="spt-state">暂未获取到热门歌曲</p>}{albums.length > 0 && <section className="spt-section"><h2>专辑与发行</h2>{albumShelf}</section>}</>}
                {section === "albums" && (openAlbum ? <><button className="spt-inline-back" onClick={() => setOpenAlbum(null)}><SpotifyIcon name="back" size={17} />返回专辑列表</button><div className="spt-artist-section-head"><h2>{openAlbum.name}</h2></div>{albumLoading ? <p className="spt-state" role="status">加载专辑…</p> : albumSongs.length ? albumSongs.map(song => <SpotifySongRow key={song.id} song={song} player={player} source={openAlbum.name} onPlay={item => void playSong(item, undefined, openAlbum.name)} />) : <p className="spt-state">暂无可用曲目</p>}</> : <section className="spt-section"><h2>专辑</h2>{albumShelf || <p className="spt-state">暂未获取到专辑</p>}</section>)}
                {section === "about" && <section className="spt-artist-about"><h2>关于 {name}</h2><p>{artist?.briefDesc || "暂未提供更多歌手介绍。"}</p></section>}
            </>}
        </div>
        {toast && <div className="music-toast music-toast-err mcmt-toast" role="status">{toast}</div>}
    </div>;
}
