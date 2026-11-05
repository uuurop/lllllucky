"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMusicPlayerOptional } from "@/lib/music-context";
import { companionDuration, requestCompanionRoom } from "@/lib/music-companion";
import { companionMessagePreview } from "@/lib/music-companion-messages";
import { companionFloatBounds, placeCompanionFloat, type CompanionDock } from "@/lib/music-companion-float";
import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import { useMusicCompanion } from "./music-companion";

const POSITION_KEY = "music-companion-capsule-position-v1";
registerKvMigration(POSITION_KEY);
const OBSTACLES = ".music-float-orb,.music-float-island,.music-float-close,.music-dynamic-island-panel,.music-status-island,.music-desktop-lyrics";

export default function MusicCompanionFloat() {
    const player = useMusicPlayerOptional();
    const snapshot = useMusicCompanion();
    const { session, panelOpen, roomRequested } = snapshot;
    const anchor = useRef<HTMLSpanElement>(null);
    const [phone, setPhone] = useState<HTMLElement | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [dock, setDock] = useState<CompanionDock | null>(null);
    const [position, setPosition] = useState({ x: 10, y: 400, side: "left" as "left" | "right", ready: false });
    const [dragging, setDragging] = useState(false);
    const drag = useRef<{ id: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
    const suppressClick = useRef(false);
    const [preview, setPreview] = useState("");
    const seenReply = useRef("");
    const visible = loaded && !!session && !!player?.currentTrack && !panelOpen && !roomRequested;
    const width = Math.min(preview ? 228 : 122, phone?.clientWidth || 375);
    const height = preview ? 88 : 42;
    const lastReply = session?.messages.filter(message => message.role === "assistant").at(-1);

    useEffect(() => { setPhone(anchor.current?.closest<HTMLElement>("[data-ui='phone-screen']") || null); }, []);
    useEffect(() => {
        if (!snapshot.ready) return;
        try {
            const saved = JSON.parse(kvGet(POSITION_KEY) || "null");
            if ((saved?.side === "left" || saved?.side === "right") && Number.isFinite(saved.y)) setDock({ side: saved.side, y: Math.max(0, Math.min(1, saved.y)) });
        } catch { /* Default to the edge opposite the music orb. */ }
        setLoaded(true);
    }, [snapshot.ready]);
    useEffect(() => {
        if (!lastReply) { seenReply.current = ""; setPreview(""); return; }
        if (seenReply.current === lastReply.id) return;
        seenReply.current = lastReply.id;
        if (panelOpen || roomRequested) return;
        setPreview(companionMessagePreview(lastReply.text));
        const timer = setTimeout(() => setPreview(""), 6500);
        return () => clearTimeout(timer);
    }, [lastReply?.id, session?.id]);
    useEffect(() => { if (panelOpen || roomRequested) setPreview(""); }, [panelOpen, roomRequested]);

    useEffect(() => {
        if (!phone || !visible) {
            setPosition(previous => previous.ready ? { ...previous, ready: false } : previous);
            return;
        }
        if (dragging) return;
        let frame = 0;
        const observed = new Set<Element>();
        const resize = new ResizeObserver(() => schedule());
        resize.observe(phone);
        const update = () => {
            if (!phone.clientWidth || !phone.clientHeight) return;
            const screenRect = phone.getBoundingClientRect();
            const sx = screenRect.width / phone.clientWidth || 1, sy = screenRect.height / phone.clientHeight || 1;
            const nodes = [...phone.querySelectorAll<HTMLElement>(OBSTACLES)];
            for (const node of observed) if (!nodes.includes(node as HTMLElement)) { resize.unobserve(node); observed.delete(node); }
            const obstacles = nodes.flatMap(node => {
                if (!observed.has(node)) { resize.observe(node); observed.add(node); }
                const rect = node.getBoundingClientRect();
                return rect.width && rect.height ? [{ x: (rect.left - screenRect.left) / sx, y: (rect.top - screenRect.top) / sy, width: rect.width / sx, height: rect.height / sy }] : [];
            });
            const orbSide = phone.querySelector(".music-float")?.getAttribute("data-side");
            const preferred: CompanionDock = dock || { side: orbSide === "left" ? "right" : "left", y: .68 };
            const next = placeCompanionFloat({ width: phone.clientWidth, height: phone.clientHeight }, { width, height }, preferred, obstacles);
            setPosition(previous => Math.abs(previous.x - next.x) < .5 && Math.abs(previous.y - next.y) < .5 && previous.side === next.side && previous.ready ? previous : { ...next, ready: true });
        };
        function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); }
        const mutations = new MutationObserver(records => {
            if (records.some(record => {
                const target = record.target instanceof Element ? record.target : record.target.parentElement;
                if (target?.closest(".mc-capsule")) return false;
                if (target?.closest(".music-float,.music-island-root,.music-desktop-lyrics")) return true;
                return [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches(OBSTACLES) || !!node.querySelector(OBSTACLES)));
            })) schedule();
        });
        mutations.observe(phone, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class", "data-side", "data-expanded", "data-tucked"] });
        update();
        return () => { cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect(); };
    }, [phone, visible, dock, width, height, dragging]);

    const open = () => {
        if (suppressClick.current) { suppressClick.current = false; return; }
        if (!player?.currentTrack) return;
        requestCompanionRoom();
        player.openFullPlayer();
    };
    const finishDrag = (event: React.PointerEvent<HTMLButtonElement>, cancelled = false) => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (current.moved && phone && !cancelled) {
            const bounds = companionFloatBounds({ width: phone.clientWidth, height: phone.clientHeight }, { width, height });
            const next: CompanionDock = { side: position.x + width / 2 > phone.clientWidth / 2 ? "right" : "left", y: (position.y - bounds.minY) / (bounds.maxY - bounds.minY || 1) };
            setDock(next); kvSet(POSITION_KEY, JSON.stringify(next));
        }
        suppressClick.current = current.moved || cancelled;
        setDragging(false);
    };
    const motion = kvGet("music-companion-window-motion-v1") || "on";
    return <><span ref={anchor} hidden />{phone && visible && position.ready && session && createPortal(
        <button type="button" className="mc-capsule" data-side={position.side} data-preview={!!preview} data-dragging={dragging || undefined} data-motion={motion}
            style={{ left: position.x, top: position.y, width, height }}
            aria-label={`和${session.name}一起听，已陪伴${companionDuration(session.seconds)}，点击打开聊天室`} title="点击回到一起听 · 拖动调整位置"
            onClick={event => { if (event.detail === 0) suppressClick.current = false; open(); }} onPointerDown={event => {
                if (event.button !== 0 || !event.isPrimary) return;
                event.stopPropagation(); suppressClick.current = false;
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: position.x, top: position.y, moved: false };
            }} onPointerMove={event => {
                const current = drag.current;
                if (!current || current.id !== event.pointerId || !phone) return;
                const rect = phone.getBoundingClientRect();
                const dx = (event.clientX - current.x) / (rect.width / phone.clientWidth || 1), dy = (event.clientY - current.y) / (rect.height / phone.clientHeight || 1);
                if (Math.hypot(dx, dy) > 5) current.moved = true;
                if (!current.moved) return;
                setDragging(true);
                const bounds = companionFloatBounds({ width: phone.clientWidth, height: phone.clientHeight }, { width, height });
                setPosition(previous => ({ ...previous, x: Math.max(bounds.minX, Math.min(bounds.maxX, current.left + dx)), y: Math.max(bounds.minY, Math.min(bounds.maxY, current.top + dy)) }));
            }} onPointerUp={event => finishDrag(event)} onPointerCancel={event => finishDrag(event, true)}>
            <span className="mc-capsule-main">
                <span className="mc-capsule-avatar">{session.avatar ? <img src={session.avatar} alt="" draggable={false} /> : session.name.slice(0, 1)}</span>
                <span className="mc-capsule-label"><b>{session.name}</b><small>{companionDuration(session.seconds)}</small></span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 14v-3a8 8 0 0 1 16 0v3M7 12H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2zm10 0h2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2z" /></svg>
            </span>
            <span className="mc-capsule-preview" aria-hidden={!preview}>{preview}</span>
        </button>, phone)}</>;
}
