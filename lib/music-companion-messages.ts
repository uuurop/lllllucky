import { containsChinese, normalizeBilingualTextInput, splitBilingualText } from "./bilingual-text";
import { parseAIResponse } from "./rich-message-parser";

export type CompanionTextPart = { original: string; translated?: string };

/** Reuse ordinary chat parsing without executing actions or saving state/memory. */
export function normalizeCompanionReply(raw: string): string {
    const visible = raw.replace(/<(think|thinking|thought|inner|status|summary)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
        .replace(/```[\s\S]*?```/g, "").trim();
    return parseAIResponse(visible, []).parts.flatMap(part => {
        if (!part.mediaType || part.mediaType === "quote") return [part.content];
        // A spoken reply can be displayed as text; no actual voice/tool action runs here.
        if (part.mediaType === "audio" && part.mediaData?.label) return [part.mediaData.label];
        return [];
    }).filter(Boolean).join("\n\n").trim();
}

function pairedParts(original: string, translated: string): CompanionTextPart[] {
    const originals = original.split(/\n+/).map(line => line.trim()).filter(Boolean);
    const translations = translated.split(/\n+/).map(line => line.trim()).filter(Boolean);
    // Never guess a pairing when a custom bilingual format has unequal line counts.
    return originals.length === translations.length
        ? originals.map((line, index) => line === translations[index] ? { original: line } : { original: line, translated: translations[index] })
        : [{ original, translated }];
}

/** Pair the languages before splitting actual newlines; visual wrapping is untouched. */
export function splitCompanionText(text: string): CompanionTextPart[] {
    const normalized = normalizeBilingualTextInput(text).replace(/\r\n?/g, "\n").trim();
    if (!normalized) return [];
    if (normalized.indexOf("|") !== -1 && normalized.indexOf("|") === normalized.lastIndexOf("|")) {
        const pair = splitBilingualText(normalized);
        // Support whole-block custom formats as well as the usual one pair per line.
        // A Chinese message following a complete bilingual line is a separate message.
        if (pair && pair.original.includes("\n") && pair.original.split("\n").slice(0, -1).every(line => !containsChinese(line))) {
            return pairedParts(pair.original, pair.translated);
        }
    }
    return normalized.split(/\n\s*\n/).flatMap(block => {
        const lines = block.split("\n").map(line => line.trim()).filter(Boolean);
        // A separator on its own line belongs to the surrounding bilingual block.
        const pair = !lines.some(line => splitBilingualText(line)) ? splitBilingualText(block) : null;
        if (pair) return pairedParts(pair.original, pair.translated);
        return lines.map(line => {
            const bilingual = splitBilingualText(line);
            return bilingual ? { original: bilingual.original, translated: bilingual.translated } : { original: line };
        });
    });
}

export function companionMessagePreview(text: string): string {
    return splitCompanionText(text).map(part => part.original).join(" ");
}
