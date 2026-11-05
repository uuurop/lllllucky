"use client";
/* eslint-disable @next/next/no-img-element -- User-configured remote covers use native loading and source CDN thumbnails. */
import { useEffect, useRef, useState } from "react";
import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import type { MusicControlsValue } from "@/lib/music-context";
import { getHotSearchDetail, getPersonalizedPlaylists, getToplists, getAlbumTracks, searchNeteaseCatalog, type NeteaseCatalog, type NeteaseCatalogKind, type NeteaseCatalogAlbum, type NeteasePlaylist, type NeteaseSearchResult } from "@/lib/music-service";
import MusicArtistPage from "./music-artist";
import { musicCoverSource, SpotifyCover, SpotifyIcon, SpotifySongRow } from "./music-spotify-ui";

const HISTORY_KEY = "music-spotify-search-history-v1";
registerKvMigration(HISTORY_KEY);
const CATEGORIES = [
    { name: "华语", query: "华语", color: "#dc148c" }, { name: "欧美", query: "欧美", color: "#006450" },
    { name: "K-Pop", query: "韩语", color: "#233c78" }, { name: "日语", query: "日语", color: "#8d00e7" },
    { name: "流行", query: "流行", color: "#bc5900" }, { name: "说唱", query: "说唱", color: "#ba2466" },
    { name: "轻音乐", query: "轻音乐", color: "#477d95" }, { name: "放松一下", query: "治愈", color: "#737d2a" },
];
const FILTERS: [NeteaseCatalogKind, string][] = [["all", "综合"], ["songs", "歌曲"], ["artists", "艺人"], ["playlists", "歌单"], ["albums", "专辑"]];

export default function SpotifySearch({ player, onPlay, onPlayAll, onOpenPlaylist }: { player: MusicControlsValue; onPlay: (song: NeteaseSearchResult, source?: string) => void; onPlayAll: (songs: NeteaseSearchResult[], source?: string) => void; onOpenPlaylist: (playlist: NeteasePlaylist) => void }) {
    const [query, setQuery] = useState("");
    const [term, setTerm] = useState("");
    const [kind, setKind] = useState<NeteaseCatalogKind>("all");
    const [catalog, setCatalog] = useState<NeteaseCatalog | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [recommendations, setRecommendations] = useState<NeteasePlaylist[]>([]);
    const [charts, setCharts] = useState<NeteasePlaylist[]>([]);
    const [hot, setHot] = useState<string[]>([]);
    const [history, setHistory] = useState<string[]>([]);
    const [artist, setArtist] = useState<{ id: number; name: string } | null>(null);
    const [album, setAlbum] = useState<NeteaseCatalogAlbum | null>(null);
    const [albumSongs, setAlbumSongs] = useState<NeteaseSearchResult[]>([]);
    const [albumBusy, setAlbumBusy] = useState(false);
    const request = useRef<AbortController | null>(null);
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        let alive = true;
        try { const saved = JSON.parse(kvGet(HISTORY_KEY) || "[]"); if (Array.isArray(saved)) setHistory(saved.filter(value => typeof value === "string").slice(0, 8)); } catch { /* Fresh search history. */ }
        Promise.allSettled([getPersonalizedPlaylists(12), getToplists(), getHotSearchDetail()]).then(([playlists, toplists, searches]) => {
            if (!alive) return;
            if (playlists.status === "fulfilled") setRecommendations(playlists.value);
            if (toplists.status === "fulfilled") setCharts(toplists.value);
            if (searches.status === "fulfilled") setHot(searches.value.map(item => item.keyword));
        });
        return () => { alive = false; request.current?.abort(); };
    }, []);
    const search = async (value: string, filter = kind) => {
        const text = value.trim();
        if (!text) return;
        request.current?.abort();
        const controller = new AbortController(); request.current = controller;
        setTerm(text); setQuery(text); setKind(filter); setBusy(true); setCatalog(null); setError("");
        const next = [text, ...history.filter(item => item !== text)].slice(0, 8);
        setHistory(next); kvSet(HISTORY_KEY, JSON.stringify(next));
        const timeout = setTimeout(() => { if (request.current === controller && !controller.signal.aborted) { controller.abort(); setBusy(false); setError("搜索超时，请稍后重试"); } }, 25000);
        try {
            const result = await searchNeteaseCatalog(text, filter, controller.signal);
            if (!controller.signal.aborted) setCatalog(result);
        } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "搜索失败，请重试"); }
        finally { clearTimeout(timeout); if (!controller.signal.aborted) setBusy(false); }
    };
    const cancel = () => { request.current?.abort(); setQuery(""); setTerm(""); setCatalog(null); setBusy(false); setError(""); setKind("all"); };
    useEffect(() => {
        if (!album) return;
        let alive = true;
        setAlbumSongs([]); setAlbumBusy(true);
        getAlbumTracks(album.id).then(songs => { if (alive) setAlbumSongs(songs); }).finally(() => { if (alive) setAlbumBusy(false); });
        return () => { alive = false; };
    }, [album]);
    const shelves = (title: string, playlists: NeteasePlaylist[]) => playlists.length > 0 && <section className="spt-section"><h2>{title}</h2><div className="spt-shelf">{playlists.map(playlist => <button key={playlist.id} className="spt-shelf-card" onClick={() => onOpenPlaylist(playlist)}><SpotifyCover src={playlist.coverUrl} name={playlist.name} /><b>{playlist.name}</b><small>{playlist.creator || "歌单"}</small></button>)}</div></section>;
    const count = catalog ? catalog.songs.length + catalog.artists.length + catalog.playlists.length + catalog.albums.length : 0;
    return <>
        <div className="spt-search-page">
            {album ? <div className="spt-album-results"><button className="spt-inline-back" onClick={() => setAlbum(null)}><SpotifyIcon name="back" />返回搜索结果</button><div className="spt-album-hero"><SpotifyCover src={album.coverUrl} name={album.name} /><h2>{album.name}</h2><p>{album.artist}</p><button className="spt-green-play" aria-label="播放专辑" disabled={!albumSongs.length} onClick={() => onPlayAll(albumSongs, album.name)}><SpotifyIcon name="play" size={26} /></button></div>{albumBusy ? <p className="spt-state" role="status">加载专辑曲目…</p> : albumSongs.length ? albumSongs.map(song => <SpotifySongRow key={song.id} song={song} player={player} source={album.name} onPlay={song => onPlay(song, album.name)} />) : <p className="spt-state">暂时没有可用曲目</p>}</div> : <>
                <form className={`spt-search-form${term ? " is-results" : ""}`} onSubmit={event => { event.preventDefault(); void search(query); }}>
                    <div><SpotifyIcon name="search" size={22} /><input ref={input} type="search" enterKeyHint="search" aria-label="搜索音乐" placeholder="想听什么？" value={query} onChange={event => setQuery(event.target.value)} /><button type="button" className="spt-search-clear" aria-label={query ? "清空搜索" : "开始搜索"} onClick={() => query ? (setQuery(""), input.current?.focus()) : input.current?.focus()}><SpotifyIcon name={query ? "close" : "search"} size={18} /></button></div>
                    {term && <button type="button" onClick={cancel}>取消</button>}
                </form>
                {term ? <>
                    <div className="spt-pills spt-result-filters">{FILTERS.map(([value, label]) => <button key={value} aria-pressed={kind === value} onClick={() => void search(term, value)}>{label}</button>)}</div>
                    {busy ? <p className="spt-state" role="status">正在搜索“{term}”…</p> : error ? <div className="spt-state" role="alert"><p>{error}</p><button className="spt-outline-button" onClick={() => void search(term)}>重试</button></div> : catalog && <div className="spt-search-results">
                        {catalog.partial && <p className="spt-muted-note">部分类型暂时不可用，已显示可用结果。</p>}
                        {catalog.artists.length > 0 && <section className="spt-section"><h2>艺人</h2>{catalog.artists.slice(0, kind === "all" ? 3 : 30).map(item => <button key={item.id} className="spt-library-row" onClick={() => setArtist(item)}><SpotifyCover src={item.cover} name={item.name} round /><span><b>{item.name}</b><small>艺人</small></span><SpotifyIcon name="back" size={16} /></button>)}</section>}
                        {catalog.songs.length > 0 && <section className="spt-section"><h2>歌曲</h2>{catalog.songs.map(song => <SpotifySongRow key={song.id} song={song} onPlay={song => onPlay(song, `搜索 · ${term}`)} player={player} source={`搜索 · ${term}`} />)}</section>}
                        {shelves("歌单", catalog.playlists)}
                        {catalog.albums.length > 0 && <section className="spt-section"><h2>专辑</h2>{catalog.albums.map(item => <button key={item.id} className="spt-library-row" onClick={() => setAlbum(item)}><SpotifyCover src={item.coverUrl} name={item.name} /><span><b>{item.name}</b><small>专辑 · {item.artist}</small></span><SpotifyIcon name="plus" size={19} /></button>)}</section>}
                        {!count && <div className="spt-state"><h3>没有找到相关内容</h3><p>试试其他歌名、歌手或关键词。</p></div>}
                    </div>}
                </> : <>
                    {history.length > 0 && <section className="spt-section spt-search-history"><div className="spt-section-title"><h2>最近搜索</h2><button onClick={() => { setHistory([]); kvSet(HISTORY_KEY, "[]"); }}>清除</button></div><div className="spt-pills">{history.map(item => <button key={item} onClick={() => void search(item)}>{item}</button>)}</div></section>}
                    <section className="spt-section"><h2>浏览音乐</h2><div className="spt-category-grid">{CATEGORIES.slice(0, 4).map((category, index) => <button key={category.name} style={{ background: category.color }} onClick={() => void search(category.query, "playlists")}><b>{category.name}</b>{recommendations[index]?.coverUrl ? <img src={musicCoverSource(recommendations[index].coverUrl)} loading="lazy" alt="" /> : <span className="spt-category-note">♪</span>}</button>)}</div></section>
                    {shelves("发现新内容", recommendations)}
                    <section className="spt-section"><h2>更多音乐风格</h2><div className="spt-category-grid">{CATEGORIES.slice(4).map((category, index) => <button key={category.name} style={{ background: category.color }} onClick={() => void search(category.query, "playlists")}><b>{category.name}</b>{recommendations[index + 4]?.coverUrl ? <img src={musicCoverSource(recommendations[index + 4].coverUrl)} loading="lazy" alt="" /> : <span className="spt-category-note">♪</span>}</button>)}</div></section>
                    {shelves("排行榜", charts.slice(0, 8))}
                    {hot.length > 0 && <section className="spt-section"><h2>大家都在搜</h2><div className="spt-hot-grid">{hot.slice(0, 12).map((item, index) => <button key={item} onClick={() => void search(item)}><i>{index + 1}</i>{item}</button>)}</div></section>}
                </>}
            </>}
        </div>
        {artist && <MusicArtistPage artistId={artist.id} artistName={artist.name} onClose={() => setArtist(null)} />}
    </>;
}
