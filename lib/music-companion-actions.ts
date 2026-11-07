import type { MusicTrack } from "./music-storage";

export type CompanionMusicAction = { kind: "next" } | { kind: "song"; title: string; artist: string };
export type CompanionMusicPermission = "off" | "confirm" | "direct";
export const COMPANION_SWITCH_COOLDOWN = 60_000;
export const COMPANION_MUSIC_ACTION_TTL = 120_000;

/** Only a complete structured response can request an action; ordinary dialogue never executes. */
export function parseCompanionMusicReply(raw: string): { reply: string; action: CompanionMusicAction | null } {
    const text = raw.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1").trim();
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error("角色回复格式未完成，请重试。切歌未执行。"); }
    if (!value || typeof value !== "object" || !("reply" in value) || typeof value.reply !== "string" || !value.reply.trim()) throw new Error("角色回复缺少聊天内容，切歌未执行。");
    const action = "musicAction" in value ? value.musicAction : null;
    if (action == null) return { reply: value.reply, action: null };
    if (typeof action !== "object" || !("kind" in action)) throw new Error("切歌请求格式无效，未执行。");
    if (action.kind === "next" && Object.keys(action).every(key => key === "kind")) return { reply: value.reply, action: { kind: "next" } };
    if (action.kind === "song" && "title" in action && typeof action.title === "string" && action.title.trim() && action.title.length <= 120 && Object.keys(action).every(key => ["kind", "title", "artist"].includes(key))) {
        const artist = "artist" in action ? action.artist : "";
        if (typeof artist === "string" && artist.length <= 120) return { reply: value.reply, action: { kind: "song", title: action.title.trim(), artist: artist.trim() } };
    }
    throw new Error("切歌请求格式无效，未执行。");
}

export function nextCompanionTrack(queue: MusicTrack[], currentId: string, shuffle: boolean, random = Math.random()): MusicTrack | null {
    const others = queue.filter(track => track.id !== currentId);
    if (!others.length) return null;
    if (shuffle) return others[Math.min(others.length - 1, Math.max(0, Math.floor(random * others.length)))];
    const index = queue.findIndex(track => track.id === currentId);
    for (let offset = 1; offset <= queue.length; offset++) {
        const track = queue[(index + offset) % queue.length];
        if (track.id !== currentId) return track;
    }
    return null;
}

export function sameCompanionSong(title: string, candidate: string): boolean {
    const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
    return !!normalize(title) && normalize(title) === normalize(candidate);
}
