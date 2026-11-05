// Companion transcripts are prompt-only recent context, never native memory-summary events.
import { kvGet } from "./kv-db";
import type { CompanionRecord } from "./music-companion";

export function loadCompanionRecordsForContext(characterId: string): CompanionRecord[] {
    try {
        const saved = JSON.parse(kvGet("music-companion-v1") || "null");
        if (!Array.isArray(saved?.records)) return [];
        const seen = new Set<string>();
        return saved.records.filter((record: CompanionRecord) => {
            if (!record || record.characterId !== characterId || typeof record.id !== "string" || seen.has(record.id)
                || !Number.isFinite(record.endedAt) || !Array.isArray(record.tracks)) return false;
            seen.add(record.id); return true;
        }).slice(0, 20);
    } catch { return []; }
}

export function companionRecentEntries(characterId: string) {
    return loadCompanionRecordsForContext(characterId).flatMap(record => {
        const stamp = (at: number) => new Date(Math.max(0, Math.min(8640000000000000, at))).toISOString();
        const tracks = record.tracks.filter(track => track && typeof track.title === "string");
        const header = {
            id: `${record.id}:end`, sourceApp: "music" as const, timestamp: stamp(record.endedAt),
            content: `[一起听结束] 你与对方结束了一次一起听。${tracks.length ? `听过${tracks.map(track => `《${track.title}》${track.artist ? `（${track.artist}）` : ""}`).join("、")}。` : "这次没有播放歌曲。"}相关对话属于这次一起听，不是当前新消息。`,
        };
        const messages = Array.isArray(record.messages) ? record.messages.filter(message => message && (message.role === "assistant" || message.role === "user") && typeof message.text === "string" && message.text.trim()) : [];
        return [...messages.map((message, index) => ({
            id: `${record.id}:message:${index}`, sourceApp: "music" as const,
            timestamp: stamp(Number.isFinite(message.at) ? Math.min(message.at, record.endedAt) : record.endedAt),
            content: `[一起听 · ${message.song || "音乐"}] ${message.role === "assistant" ? record.name || "角色" : record.userName || "对方"}：${message.quote ? `（分享歌词：${message.quote}）` : ""}${message.text}`,
        })), header];
    }).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
