// Geometry for the music-only companion capsule, in virtual-phone CSS pixels.
export type CompanionDock = { side: "left" | "right"; y: number };
export type CompanionFloatRect = { x: number; y: number; width: number; height: number };
export type CompanionFloatSize = { width: number; height: number };
export function companionFloatBounds(screen: CompanionFloatSize, size: CompanionFloatSize) {
    const maxX = Math.max(0, screen.width - size.width - 10);
    const minX = Math.min(10, maxX);
    const minY = Math.min(76, Math.max(0, screen.height - size.height - 10));
    const maxY = Math.max(minY, screen.height - size.height - 90);
    return { minX, maxX, minY, maxY };
}
function overlapArea(a: CompanionFloatRect, b: CompanionFloatRect) {
    return Math.max(0, Math.min(a.x + a.width, b.x + b.width + 8) - Math.max(a.x, b.x - 8))
        * Math.max(0, Math.min(a.y + a.height, b.y + b.height + 8) - Math.max(a.y, b.y - 8));
}
export function placeCompanionFloat(screen: CompanionFloatSize, size: CompanionFloatSize, dock: CompanionDock, obstacles: CompanionFloatRect[]) {
    const bounds = companionFloatBounds(screen, size);
    const desiredY = bounds.minY + Math.max(0, Math.min(1, dock.y)) * (bounds.maxY - bounds.minY);
    const ys = [desiredY, ...obstacles.flatMap(rect => [rect.y - size.height - 10, rect.y + rect.height + 10]), bounds.minY, bounds.maxY];
    const candidates = ([dock.side, dock.side === "left" ? "right" : "left"] as const).flatMap(side => ys.map(y => {
        const x = side === "left" ? bounds.minX : bounds.maxX;
        y = Math.max(bounds.minY, Math.min(bounds.maxY, y));
        const rect = { x, y, ...size };
        const overlap = obstacles.reduce((sum, obstacle) => sum + overlapArea(rect, obstacle), 0);
        return { x, y, side, overlap, distance: Math.abs(y - desiredY) + (side === dock.side ? 0 : 64) };
    }));
    candidates.sort((a, b) => a.overlap - b.overlap || a.distance - b.distance);
    const best = candidates[0];
    return { x: best.x, y: best.y, side: best.side };
}
