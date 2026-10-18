import { NextResponse } from "next/server";
import { proxyFetch } from "@/lib/proxy-fetch";

// ElevenLabs 音色列表同步:GET /v1/voices,xi-api-key 鉴权。
// 返回用户音色库(克隆音色 + 已收藏的音色),供语音设置页填充下拉。

export const runtime = "nodejs";
export const maxDuration = 15;

const DEFAULT_ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";

function normalizeBaseUrl(value: unknown): string {
    const raw = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_ELEVENLABS_BASE_URL;
    return raw.replace(/\/$/, "");
}

function getRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
        const baseUrl = normalizeBaseUrl(body.baseUrl);

        if (!apiKey) return NextResponse.json({ error: "missing_api_key" }, { status: 400 });

        const response = await proxyFetch(`${baseUrl}/voices`, {
            method: "GET",
            headers: { "xi-api-key": apiKey },
        });

        const text = await response.text();
        let data: unknown = null;
        try {
            data = JSON.parse(text);
        } catch {
            return NextResponse.json({ error: "upstream_not_json", message: text.slice(0, 500) }, { status: 502 });
        }

        if (!response.ok) {
            const detail = getRecord(getRecord(data).detail);
            const message = String(detail.message || getRecord(data).message || text || `HTTP ${response.status}`).slice(0, 500);
            return NextResponse.json({ error: "get_voice_failed", message }, { status: 502 });
        }

        const rawVoices = Array.isArray(getRecord(data).voices) ? getRecord(data).voices as unknown[] : [];
        const voices = rawVoices.flatMap(item => {
            const record = getRecord(item);
            const voiceId = record.voice_id ?? record.voiceId ?? record.id;
            if (typeof voiceId !== "string" || !voiceId.trim()) return [];
            const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : voiceId.trim();
            const category = typeof record.category === "string" && record.category.trim() ? ` (${record.category.trim()})` : "";
            return [{ id: voiceId.trim(), name: `${name}${category}` }];
        });

        return NextResponse.json({ ok: true, voices });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: "get_voice_failed", message: message.slice(0, 500) }, { status: 502 });
    }
}
