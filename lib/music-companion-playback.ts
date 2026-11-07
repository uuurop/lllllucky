import { getNeteaseLyrics, getNeteasePlayInfo, unifiedSearch } from "./music-service";
import { getAudioBlob, type MusicTrack } from "./music-storage";
import { nextCompanionTrack, sameCompanionSong, type CompanionMusicAction } from "./music-companion-actions";
import type { MusicControlSnapshot } from "./music-control-bridge";

/** Resolve everything before touching the current audio. Never fall back to an unrelated search hit. */
export async function resolveCompanionPlayback(action: CompanionMusicAction, snapshot: MusicControlSnapshot, valid: () => boolean): Promise<{ track: MusicTrack; source: string | Blob }> {
    let track: MusicTrack | null = null;
    if (action.kind === "next") {
        track = nextCompanionTrack(snapshot.queue, snapshot.currentTrack?.id || "", snapshot.playMode === "shuffle");
        if (!track) throw new Error("播放队列里没有其他歌曲，先添加一些歌吧。");
    } else {
        // A combined title/artist query does not match the local library's single-field search.
        let results = await unifiedSearch(action.title);
        if (!valid()) throw new Error("切歌请求已失效。");
        const matches = (item: typeof results[number]) => sameCompanionSong(action.title, item.title) && (!action.artist || item.artist.normalize("NFKC").toLowerCase().includes(action.artist.normalize("NFKC").toLowerCase()));
        if (action.artist && !results.some(matches)) results = await unifiedSearch(`${action.title} ${action.artist}`);
        if (!valid()) throw new Error("切歌请求已失效。");
        const candidates = results.filter(matches);
        for (const item of candidates.slice(0, 5)) {
            if (!valid()) throw new Error("切歌请求已失效。");
            if ((item.localTrack?.id || (item.neteaseResult ? `netease_${item.neteaseResult.id}` : "")) === snapshot.currentTrack?.id) throw new Error("这首歌已经在播放，继续听就好。");
            if (item.localTrack) {
                const blob = await getAudioBlob(item.localTrack.id);
                if (blob) return { track: item.localTrack, source: blob };
            } else if (item.neteaseResult) {
                const song = item.neteaseResult, info = await getNeteasePlayInfo(song.id);
                if (info.url) return { source: info.url, track: { id: `netease_${song.id}`, title: song.name, artist: song.artists, duration: song.duration / 1000, coverUrl: song.coverUrl, lyrics: await getNeteaseLyrics(song.id).catch(() => ""), liked: false, addedAt: new Date().toISOString() } };
            }
        }
        throw new Error("没有找到歌名和歌手匹配的可播放歌曲，当前歌曲保持不变。");
    }
    if (!valid()) throw new Error("切歌请求已失效。");
    if (track.id.startsWith("netease_")) {
        const info = await getNeteasePlayInfo(Number(track.id.slice(8)));
        if (info.url) return { track: { ...track, lyrics: track.lyrics || await getNeteaseLyrics(Number(track.id.slice(8))).catch(() => "") }, source: info.url };
        throw new Error(info.reason || "下一首暂时无法播放。");
    }
    const blob = await getAudioBlob(track.id);
    if (!blob) throw new Error("下一首的本地音频不存在。");
    return { track, source: blob };
}
