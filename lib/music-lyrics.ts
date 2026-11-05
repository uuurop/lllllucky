export type LyricLine = { time: number; text: string; translation?: string };

export function parseLrc(source: string): LyricLine[] {
    const offset = Number(/\[offset:([+-]?\d+)\]/i.exec(source)?.[1] || 0) / 1000;
    const lines: LyricLine[] = [];
    for (const row of source.split(/\r?\n/)) {
        const text = row.replace(/\[[^\]]*\]/g, "").trim();
        for (const match of row.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)) {
            lines.push({ time: Number(match[1]) * 60 + Number(match[2]) - offset, text });
        }
    }
    return lines.sort((a, b) => a.time - b.time);
}

/** Match timestamps, not line numbers: translations often omit credits or gaps. */
export function bilingualLyrics(original: string, translated: string): LyricLine[] {
    const lines = parseLrc(original);
    const translations = parseLrc(translated);
    const assigned = new Map<number, { distance: number; text: string }>();
    for (const translation of translations) {
        if (!translation.text || !lines.length) continue;
        let low = 0, high = lines.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (lines[mid].time < translation.time) low = mid + 1;
            else high = mid;
        }
        const candidates = [low - 1, low].filter(i => i >= 0 && i < lines.length);
        const index = candidates.sort((a, b) => Math.abs(lines[a].time - translation.time) - Math.abs(lines[b].time - translation.time))[0];
        const distance = Math.abs(lines[index].time - translation.time);
        if (distance > .6 || (assigned.get(index)?.distance ?? Infinity) <= distance) continue;
        assigned.set(index, { distance, text: translation.text });
    }
    return lines.map((line, i) => ({ ...line, translation: assigned.get(i)?.text }));
}
