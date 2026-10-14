// 汇率换算：红包/转账/余额的外币支持。
// 钱包统一以人民币元结算；外币只是展示与角色侧的计价单位，收付款在钱包边界换算。
// 汇率来源：https://open.er-api.com/v6/latest/CNY （免 key 免费接口），kv 缓存，
// 拉不到时用内置兜底值，钱包面板里可手动修改。

import { kvGet, kvSet } from "./kv-db";

export type CurrencyCode = "CNY" | "KRW" | "JPY" | "USD" | "EUR";

export interface CurrencyMeta {
    code: CurrencyCode;
    name: string;       // 中文名
    symbol: string;     // 符号
    decimals: number;   // 显示小数位
}

export const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
    CNY: { code: "CNY", name: "人民币", symbol: "¥", decimals: 2 },
    KRW: { code: "KRW", name: "韩元", symbol: "₩", decimals: 0 },
    JPY: { code: "JPY", name: "日元", symbol: "¥", decimals: 0 },
    USD: { code: "USD", name: "美元", symbol: "$", decimals: 2 },
    EUR: { code: "EUR", name: "欧元", symbol: "€", decimals: 2 },
};

export const FOREIGN_CURRENCY_CODES: CurrencyCode[] = ["KRW", "JPY", "USD", "EUR"];

export function isCurrencyCode(value: unknown): value is CurrencyCode {
    return typeof value === "string" && value in CURRENCIES;
}

/** 语义：1 元人民币 = X 外币 */
export interface ExchangeRateState {
    rates: Record<CurrencyCode, number>; // CNY 恒为 1
    fetchedAt: string; // ISO
    source: "api" | "fallback" | "manual";
}

// 兜底值（2026 年初的大致水平），拉不到接口时用，可在钱包面板手动改
export const FALLBACK_RATES: Record<CurrencyCode, number> = {
    CNY: 1,
    KRW: 190,
    JPY: 20.5,
    USD: 0.14,
    EUR: 0.13,
};

const RATE_STATE_KEY = "ai_phone_exchange_rates_v1";
export const EXCHANGE_RATE_UPDATED_EVENT = "exchange-rate-updated";
const STALE_MS = 6 * 60 * 60 * 1000; // 6 小时拉一次就够

let fetchPromise: Promise<ExchangeRateState> | null = null;

export function loadExchangeRates(): ExchangeRateState {
    if (typeof window === "undefined") {
        return { rates: { ...FALLBACK_RATES }, fetchedAt: "", source: "fallback" };
    }
    try {
        const raw = kvGet(RATE_STATE_KEY);
        if (!raw) return { rates: { ...FALLBACK_RATES }, fetchedAt: "", source: "fallback" };
        const parsed = JSON.parse(raw) as Partial<ExchangeRateState>;
        const rates = { ...FALLBACK_RATES };
        for (const code of FOREIGN_CURRENCY_CODES) {
            const v = Number(parsed.rates?.[code]);
            if (Number.isFinite(v) && v > 0) rates[code] = v;
        }
        return {
            rates,
            fetchedAt: typeof parsed.fetchedAt === "string" ? parsed.fetchedAt : "",
            source: parsed.source === "api" || parsed.source === "manual" ? parsed.source : "fallback",
        };
    } catch {
        return { rates: { ...FALLBACK_RATES }, fetchedAt: "", source: "fallback" };
    }
}

export function saveExchangeRates(state: ExchangeRateState): ExchangeRateState {
    const rates = { ...FALLBACK_RATES, ...state.rates, CNY: 1 };
    const next: ExchangeRateState = { rates, fetchedAt: state.fetchedAt, source: state.source };
    kvSet(RATE_STATE_KEY, JSON.stringify(next));
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(EXCHANGE_RATE_UPDATED_EVENT, { detail: next }));
    }
    return next;
}

/** 手动改某一个币种的汇率（钱包面板用） */
export function setManualRate(code: CurrencyCode, rate: number): ExchangeRateState {
    const current = loadExchangeRates();
    if (code !== "CNY" && Number.isFinite(rate) && rate > 0) {
        current.rates[code] = rate;
    }
    return saveExchangeRates({
        rates: current.rates,
        fetchedAt: new Date().toISOString(),
        source: "manual",
    });
}

export function isExchangeRateStale(state: ExchangeRateState, maxAgeMs = STALE_MS): boolean {
    if (!state.fetchedAt) return true;
    const t = new Date(state.fetchedAt).getTime();
    if (!Number.isFinite(t)) return true;
    return Date.now() - t > maxAgeMs;
}

/** 拉取最新汇率；stale 才拉，接口失败保留旧值。同一时刻只发一个请求。 */
export async function fetchExchangeRates(force = false): Promise<ExchangeRateState> {
    const current = loadExchangeRates();
    if (!force && !isExchangeRateStale(current)) return current;
    if (fetchPromise) return fetchPromise;
    fetchPromise = (async () => {
        try {
            const res = await fetch("https://open.er-api.com/v6/latest/CNY");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json() as { result?: string; rates?: Record<string, number> };
            if (data?.result !== "success" || !data.rates) throw new Error("bad payload");
            const rates = { ...current.rates };
            for (const code of FOREIGN_CURRENCY_CODES) {
                const v = Number(data.rates[code]);
                if (Number.isFinite(v) && v > 0) rates[code] = v;
            }
            return saveExchangeRates({
                rates,
                fetchedAt: new Date().toISOString(),
                source: "api",
            });
        } catch {
            return current; // 失败保留旧值/兜底
        } finally {
            fetchPromise = null;
        }
    })();
    return fetchPromise;
}

// ── 换算 ──

/** 元 → 外币，按币种精度取整（韩元/日元无小数） */
export function cnyToForeign(amountCny: number, code: CurrencyCode, rates?: ExchangeRateState): number {
    if (code === "CNY") return round2(amountCny);
    const rate = (rates ?? loadExchangeRates()).rates[code] || FALLBACK_RATES[code];
    const raw = amountCny * rate;
    const decimals = CURRENCIES[code].decimals;
    const factor = 10 ** decimals;
    return Math.round(raw * factor) / factor;
}

/** 外币 → 元（保留 2 位） */
export function foreignToCny(amount: number, code: CurrencyCode, rates?: ExchangeRateState): number {
    if (code === "CNY") return round2(amount);
    const rate = (rates ?? loadExchangeRates()).rates[code] || FALLBACK_RATES[code];
    if (rate <= 0) return 0;
    return round2(amount / rate);
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/** 格式化外币金额：₩9,500 / $12.50 */
export function formatForeignAmount(amount: number, code: CurrencyCode): string {
    const meta = CURRENCIES[code];
    return `${meta.symbol}${amount.toLocaleString("zh-CN", {
        minimumFractionDigits: meta.decimals,
        maximumFractionDigits: meta.decimals,
    })}`;
}

// ── 时区 → 货币 ──

/** 按 IANA 时区推导货币；未绑定或无法识别时回退人民币 */
export function currencyFromTimeZone(timeZone?: string | null): CurrencyCode {
    const tz = (timeZone || "").trim();
    if (!tz) return "CNY";
    if (tz === "Asia/Seoul") return "KRW";
    if (tz === "Asia/Tokyo") return "JPY";
    if (tz.startsWith("America/") || tz.startsWith("US/")) return "USD";
    if (tz.startsWith("Europe/")) return "EUR";
    return "CNY";
}
