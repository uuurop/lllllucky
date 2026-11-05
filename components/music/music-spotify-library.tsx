"use client";
/* eslint-disable @next/next/no-img-element -- Preserve arbitrary user-provided media without changing global image configuration. */
import { useEffect, useState } from "react";
import type { MusicControlsValue } from "@/lib/music-context";
import { getAlbumTracks, getSubscribedMusicArtists, type NeteaseArtist, type NeteasePlaylist, type NeteasePlayRecord, type NeteaseSearchResult, type NeteaseUserDetail, type NeteaseDjRadio, type NeteaseDjProgram, type NeteaseAlbumSub, type NeteaseUserEvent } from "@/lib/music-service";
import MusicArtistPage from "./music-artist";
import { SpotifyCover, SpotifyIcon, SpotifySongRow } from "./music-spotify-ui";

type Props = {
    playlists: NeteasePlaylist[]; loading: boolean; player: MusicControlsValue;
    recent: NeteaseSearchResult[]; albums: NeteaseAlbumSub[]; radios: NeteaseDjRadio[]; events: NeteaseUserEvent[];
    records: NeteasePlayRecord[]; profile: NeteaseUserDetail | null; query: string; searchOpen: boolean;
    onQuery: (query: string) => void; onPlaylist: (playlist: NeteasePlaylist) => void;
    onPlay: (song: NeteaseSearchResult, source?: string) => void; onPlayAll: (songs: NeteaseSearchResult[], source?: string) => void;
    onHeart: () => void; heartBusy: boolean; radioId: number | null; programs: Record<number, NeteaseDjProgram[]>;
    onRadio: (radio: NeteaseDjRadio) => void; onProgram: (radio: NeteaseDjRadio, program: NeteaseDjProgram) => void;
};
export default function SpotifyLibrary(props: Props) {
    const [filter, setFilter] = useState("all");
    const [scope, setScope] = useState("all");
    const [alphabetical, setAlphabetical] = useState(false);
    const [grid, setGrid] = useState(false);
    const [artists, setArtists] = useState<NeteaseArtist[]>([]);
    const [artist, setArtist] = useState<NeteaseArtist | null>(null);
    const [album, setAlbum] = useState<NeteaseAlbumSub | null>(null);
    const [songs, setSongs] = useState<NeteaseSearchResult[]>([]);
    const [albumLoading, setAlbumLoading] = useState(false);
    useEffect(() => { let alive = true; getSubscribedMusicArtists().then(items => { if (alive) setArtists(items); }); return () => { alive = false; }; }, []);
    useEffect(() => { if (!album) return; let alive = true; setAlbumLoading(true); setSongs([]); getAlbumTracks(album.id).then(items => { if (alive) setSongs(items); }).finally(() => { if (alive) setAlbumLoading(false); }); return () => { alive = false; }; }, [album]);
    const matches = (name: string) => name.toLocaleLowerCase().includes(props.query.trim().toLocaleLowerCase());
    const like = props.playlists.find(item => item.specialType === 5) || props.playlists.find(item => item.name.includes("喜欢的音乐"));
    const playlists = props.playlists.filter(item => item !== like && matches(item.name) && (filter !== "playlists" || scope === "all" || (scope === "collected" ? item.subscribed : !item.subscribed)));
    if (alphabetical) playlists.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    const filters = [["all", "全部"], ["playlists", "歌单"], ["albums", "专辑"], ["artists", "艺人"], ["recent", "最近播放"]];
    const totalPlays = props.records.reduce((sum, item) => sum + item.playCount, 0);
    const hours = props.records.reduce((sum, item) => sum + item.playCount * item.song.duration, 0) / 3600000;
    return <>
        <div className="spt-library-page">
            {album ? <><button className="spt-inline-back" onClick={() => setAlbum(null)}><SpotifyIcon name="back" />返回音乐库</button><div className="spt-album-hero"><SpotifyCover src={album.picUrl} name={album.name} /><h2>{album.name}</h2><p>{album.artist}</p><button className="spt-green-play" aria-label="播放专辑" disabled={!songs.length} onClick={() => props.onPlayAll(songs, album.name)}><SpotifyIcon name="play" size={26} /></button></div>{albumLoading ? <p className="spt-state" role="status">加载专辑…</p> : songs.length ? songs.map(song => <SpotifySongRow key={song.id} song={song} onPlay={song => props.onPlay(song, album.name)} player={props.player} source={album.name} />) : <p className="spt-state">暂无可用曲目</p>}</> : <>
                {props.searchOpen && <input className="spt-library-search" aria-label="搜索音乐库" placeholder="在音乐库中查找" value={props.query} onChange={event => props.onQuery(event.target.value)} autoFocus />}
                <div className="spt-pills">{filters.map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
                <div className="spt-library-tools"><button onClick={() => setAlphabetical(value => !value)}><SpotifyIcon name="sort" size={17} />{alphabetical ? "名称排序" : "默认排序"}</button><span />{filter === "playlists" && <select aria-label="歌单范围" value={scope} onChange={event => setScope(event.target.value)}><option value="all">所有歌单</option><option value="created">创建的</option><option value="collected">收藏的</option></select>}<button aria-label={grid ? "切换为列表" : "切换为网格"} onClick={() => setGrid(value => !value)}><SpotifyIcon name={grid ? "list" : "grid"} size={20} /></button></div>
                {props.loading && !props.playlists.length && <p className="spt-state" role="status">加载音乐库…</p>}
                <div className="spt-library-items" data-layout={grid ? "grid" : "list"}>
                    {(filter === "all" || filter === "playlists") && <>
                        {like && matches(like.name) && <div className="spt-library-liked"><button className="spt-library-row" onClick={() => props.onPlaylist(like)}><SpotifyCover liked /><span><b>{like.name}</b><small><i>♥</i> 歌单 · {props.profile?.nickname || like.creator} · {like.trackCount} 首</small></span></button><button className="spt-heart-mode" disabled={props.heartBusy} onClick={props.onHeart} title="心动模式">{props.heartBusy ? "…" : "心动"}</button></div>}
                        {playlists.map(item => <button key={item.id} className="spt-library-row" onClick={() => props.onPlaylist(item)}><SpotifyCover src={item.coverUrl} name={item.name} /><span><b>{item.name}</b><small>歌单 · {item.creator || "我的音乐库"}{item.subscribed ? " · 已收藏" : ""}</small></span></button>)}
                    </>}
                    {(filter === "all" || filter === "albums") && props.albums.filter(item => matches(item.name + " " + item.artist)).map(item => <button key={`album-${item.id}`} className="spt-library-row" onClick={() => setAlbum(item)}><SpotifyCover src={item.picUrl} name={item.name} /><span><b>{item.name}</b><small>专辑 · {item.artist}</small></span></button>)}
                    {(filter === "all" || filter === "artists") && artists.filter(item => matches(item.name)).map(item => <button key={`artist-${item.id}`} className="spt-library-row" onClick={() => setArtist(item)}><SpotifyCover src={item.cover} name={item.name} round /><span><b>{item.name}</b><small>艺人</small></span></button>)}
                    {filter === "recent" && props.recent.filter(item => matches(item.name + " " + item.artists)).map(song => <SpotifySongRow key={song.id} song={song} player={props.player} onPlay={song => props.onPlay(song, "最近播放")} source="最近播放" />)}
                </div>
                {filter === "albums" && !props.albums.length && <p className="spt-state">收藏的专辑会出现在这里</p>}
                {filter === "artists" && !artists.length && <p className="spt-state">关注的艺人会出现在这里</p>}
                {filter === "recent" && !props.recent.length && <p className="spt-state">播放音乐后，回来看看你的足迹</p>}
                {!props.loading && !props.playlists.length && filter === "all" && <p className="spt-state">登录网易云账号后，同步你的歌单和收藏。</p>}
                {props.radios.length > 0 && <details className="spt-library-extra"><summary>收藏的播客</summary>{props.radios.map(radio => <div key={radio.id}><button className="spt-library-row" onClick={() => props.onRadio(radio)}><SpotifyCover src={radio.picUrl} name={radio.name} /><span><b>{radio.name}</b><small>{radio.dj} · {radio.programCount || 0} 期</small></span></button>{props.radioId === radio.id && <div className="spt-episodes">{props.programs[radio.id] ? props.programs[radio.id].map(program => <button key={program.id} onClick={() => props.onProgram(radio, program)}>{program.name}<SpotifyIcon name="play" size={14} /></button>) : <p>加载节目…</p>}</div>}</div>)}</details>}
                {props.events.length > 0 && <details className="spt-library-extra"><summary>音乐笔记</summary>{props.events.map(event => <div key={event.id} className="spt-note-card"><p>{event.text}</p><div>{event.pics.slice(0, 3).map(src => <img key={src} src={src} alt="" loading="lazy" />)}</div>{event.song && <button onClick={() => props.onPlay(event.song!)}>♪ {event.song.name}</button>}</div>)}</details>}
                {props.records.length > 0 && <details className="spt-library-extra"><summary>听歌足迹与账号</summary><p>{props.profile?.nickname} · 本周播放 {totalPlays} 次</p><p>约 {Math.round(hours * 10) / 10} 小时<span className="spt-muted-note">（按次数与歌曲时长估算）</span></p>{props.profile?.signature && <p>{props.profile.signature}</p>}<p className="spt-muted-note">关注 {props.profile?.follows ?? "—"} · 粉丝 {props.profile?.followeds ?? "—"}{props.profile?.level ? ` · Lv.${props.profile.level}` : ""}</p></details>}
            </>}
        </div>
        {artist && <MusicArtistPage artistId={artist.id} artistName={artist.name} onClose={() => setArtist(null)} />}
    </>;
}
