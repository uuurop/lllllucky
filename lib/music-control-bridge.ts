import type { MusicTrack } from "./music-storage";
import type { PlayMode } from "./music-context";
import type { CompanionMusicAction } from "./music-companion-actions";

export type MusicControlSnapshot = {
    currentTrack: MusicTrack | null;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    playMode: PlayMode;
    queue: MusicTrack[];
    volume: number;
    revision?: number;
    trackStartedAt?: number;
};

export type MusicControlBridge = {
    switchForCompanion?: (action: CompanionMusicAction, valid: () => boolean, stillAllowed?: () => boolean) => Promise<{ ok: boolean; message: string; track?: MusicTrack }>;
    getState: () => MusicControlSnapshot;
    playTrack: (track: MusicTrack) => Promise<{ ok: boolean; message: string; track?: MusicTrack }>;
    playByQuery: (query: string, artist?: string) => Promise<{ ok: boolean; message: string; track?: MusicTrack }>;
    addToQueue: (tracks: MusicTrack[], options?: { replace?: boolean; playFirst?: boolean }) => Promise<{ ok: boolean; message: string; queue: MusicTrack[] }>;
    pause: () => void;
    resume: () => void;
    stop: () => void;
    next: () => void;
    prev: () => void;
    setPlayMode: (mode: PlayMode) => void;
};

let bridge: MusicControlBridge | null = null;

export function registerMusicControlBridge(nextBridge: MusicControlBridge | null): void {
    bridge = nextBridge;
}

export function getMusicControlBridge(): MusicControlBridge | null {
    return bridge;
}
