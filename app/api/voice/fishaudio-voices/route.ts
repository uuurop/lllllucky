import { NextResponse } from "next/server";
import { proxyFetch } from "@/lib/proxy-fetch";

// Fish Audio（鱼声）音色列表同步:GET /model?self=true,Bearer 鉴权。
// self=true 只列用户自己上传/克隆的声音模型;每项的 _id 即 TTS 用的 reference_id。

export const runtime = "nodejs";
export const maxDuration = 15;

const DEFAULT_FISHAUDIO_BASE_URL = "https://api.fish.audio/v1";

function normalizeBaseUrl(value: unknown): string {
    const raw = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_FISHAUDIO_BASE_URL;
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

        const response = await proxyFetch(`${baseUrl}/model?self=true&page_size=100`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: "application/json",
            },
        });

        const text = await response.text();
        let data: unknown = null;
        try {
            data = JSON.parse(text);
        } catch {
            return NextResponse.json({ error: "upstream_not_json", message: text.slice(0, 500) }, { status: 502 });
        }

        if (!response.ok) {
            const message = String(getRecord(data).message || getRecord(data).detail || text || `HTTP ${response.status}`).slice(0, 500);
            return NextResponse.json({ error: "get_voice_failed", message }, { status: 502 });
        }

        const rawItems = Array.isArray(getRecord(data).items) ? getRecord(data).items as unknown[] : [];
        const voices = rawItems.flatMap(item => {
            const record = getRecord(item);
            const id = record._id ?? record.id;
            if (typeof id !== "string" || !id.trim()) return [];
            const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : id.trim();
            return [{ id: id.trim(), name: `${title} (${id.trim()})` }];
        });

        return NextResponse.json({ ok: true, voices });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: "get_voice_failed", message: message.slice(0, 500) }, { status: 502 });
    }
}
