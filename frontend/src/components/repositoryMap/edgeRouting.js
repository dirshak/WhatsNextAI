// Edge routing for the Repository Map.
//
// IMPORTANT: every individual file-to-file dependency edge is rendered —
// grouping is a purely visual/organizational aid and must never reduce the
// number of rendered dependencies (see classifyEdges below: no aggregation,
// one entry in exactly one of intra/inter per edge).
//
// Inter-group edges are routed through group-boundary "ports" rather than
// as straight lines between file centers: each edge exits its source
// group's box at the point on the boundary facing the target group, and
// enters the target group's box the same way. Multiple edges between the
// same two groups are bundled into a shared corridor near the boxes (fanned
// out in the same order their real endpoints sit in, so the bundle doesn't
// self-cross) and only separate as they approach their actual destination
// files — a metro-map effect. This is a practical approximation of
// obstacle-aware bundled routing (ports + fan-out ordering + smooth cubic
// curves), not a full force-directed-bundling or visibility-graph
// pathfinder — it does not route *around* a third, unrelated group box
// that happens to sit between two others. That's a known limitation, not
// an oversight: real obstacle-avoidance routing is a much larger algorithm
// than this scope calls for.
//
// Pure functions only — no D3 selections, no DOM.

// Splits edges into same-group ("intra") and cross-group ("inter") lists.
// No aggregation — every edge appears in exactly one list.
export function classifyEdges(edges, nodesById) {
    const intra = [];
    const inter = [];
    for (const e of edges) {
        const s = nodesById.get(e.source);
        const t = nodesById.get(e.target);
        if (!s || !t) continue;
        if (s.group === t.group) intra.push(e);
        else inter.push(e);
    }
    return { intra, inter };
}

// Point where a ray from a box's center toward (towardX, towardY) crosses
// the box's own boundary, plus the outward unit normal at that point (which
// side of the rectangle it hit) — the edge's "exit"/"entry" port.
function boxPort(box, towardX, towardY) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const dx = towardX - cx;
    const dy = towardY - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy, nx: 0, ny: -1 };

    const halfW = box.width / 2;
    const halfH = box.height / 2;
    const tx = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
    const ty = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);

    let nx = 0, ny = 0;
    if (tx < ty) nx = Math.sign(dx); else ny = Math.sign(dy);

    return { x: cx + dx * t, y: cy + dy * t, nx, ny };
}

const BUNDLE_SPACING = 9;   // px between adjacent bundled edges near a port
const PORT_PULL = 46;       // how far the curve's control point is pulled outward from the port

function cubicPath(sx, sy, c1x, c1y, c2x, c2y, tx, ty) {
    return `M${sx},${sy} C${c1x},${c1y} ${c2x},${c2y} ${tx},${ty}`;
}

// One curved path PER inter-group edge (never per group-pair — see module
// docstring). `groupBoxes` is the Map from layoutEngine.js; `nodesById`
// maps node id -> node (for each node's `.group`).
export function buildInterGroupPaths(interEdges, nodePositions, groupBoxes, nodesById) {
    const byPair = new Map(); // "groupA|groupB" (sorted) -> edges[]
    for (const e of interEdges) {
        const s = nodesById.get(e.source);
        const t = nodesById.get(e.target);
        if (!s || !t) continue;
        const key = [s.group, t.group].sort().join("");
        if (!byPair.has(key)) byPair.set(key, []);
        byPair.get(key).push(e);
    }

    const paths = [];
    for (const [key, pairEdges] of byPair) {
        const [gA, gB] = key.split("");
        const boxA = groupBoxes.get(gA);
        const boxB = groupBoxes.get(gB);
        if (!boxA || !boxB) continue;

        const centerA = { x: boxA.x + boxA.width / 2, y: boxA.y + boxA.height / 2 };
        const centerB = { x: boxB.x + boxB.width / 2, y: boxB.y + boxB.height / 2 };
        const dirX = centerB.x - centerA.x;
        const dirY = centerB.y - centerA.y;
        const dirLen = Math.hypot(dirX, dirY) || 1;
        // tangent = direction perpendicular to the A<->B axis, used to fan
        // bundled edges out side-by-side near their shared ports.
        const tangX = -dirY / dirLen;
        const tangY = dirX / dirLen;

        // Order edges by where their group-A-side endpoint actually sits
        // (projected onto the tangent axis) so the bundle fans out in the
        // same order its members will separate toward on approach — avoids
        // the bundle crossing itself.
        const ordered = pairEdges
            .map(e => {
                const sourceNode = nodesById.get(e.source);
                const aIsSource = sourceNode.group === gA;
                const aSidePos = nodePositions.get(aIsSource ? e.source : e.target);
                const proj = aSidePos ? (aSidePos.x - centerA.x) * tangX + (aSidePos.y - centerA.y) * tangY : 0;
                return { e, proj };
            })
            .sort((p, q) => p.proj - q.proj);

        const n = ordered.length;
        const maxSpread = Math.min(boxA.width, boxA.height, boxB.width, boxB.height) * 0.35;

        ordered.forEach(({ e }, i) => {
            const sPos = nodePositions.get(e.source);
            const tPos = nodePositions.get(e.target);
            if (!sPos || !tPos) return;

            const sourceNode = nodesById.get(e.source);
            const aIsSource = sourceNode.group === gA;
            const sourceBox = aIsSource ? boxA : boxB;
            const targetBox = aIsSource ? boxB : boxA;
            const sourceCenterOther = aIsSource ? centerB : centerA; // "toward" point for the exit port
            const targetCenterOther = aIsSource ? centerA : centerB;

            const offset = Math.max(-maxSpread, Math.min(maxSpread, (i - (n - 1) / 2) * BUNDLE_SPACING));

            const exitPort = boxPort(sourceBox, sourceCenterOther.x, sourceCenterOther.y);
            const entryPort = boxPort(targetBox, targetCenterOther.x, targetCenterOther.y);

            const exitX = exitPort.x + tangX * offset;
            const exitY = exitPort.y + tangY * offset;
            const entryX = entryPort.x + tangX * offset;
            const entryY = entryPort.y + tangY * offset;

            const c1x = exitX + exitPort.nx * PORT_PULL;
            const c1y = exitY + exitPort.ny * PORT_PULL;
            const c2x = entryX + entryPort.nx * PORT_PULL;
            const c2y = entryY + entryPort.ny * PORT_PULL;

            paths.push({
                key: `${e.source}->${e.target}`,
                source: e.source,
                target: e.target,
                kind: e.kind,
                label: e.label,
                path: cubicPath(sPos.x, sPos.y, c1x, c1y, c2x, c2y, tPos.x, tPos.y),
            });
        });
    }

    return paths;
}

// Lightweight single-edge path recompute for drag interactions — reuses the
// same port geometry as the bundle above but without re-deriving fan-out
// order (an edge being dragged doesn't change which group it belongs to,
// only its exact endpoint, so its existing bundle slot is still valid; this
// just needs to track the moving endpoint smoothly).
export function pathForEdge(edge, nodePositions, groupBoxes, nodesById) {
    const s = nodesById.get(edge.source);
    const t = nodesById.get(edge.target);
    const sPos = nodePositions.get(edge.source);
    const tPos = nodePositions.get(edge.target);
    if (!s || !t || !sPos || !tPos) return null;

    const sourceBox = groupBoxes.get(s.group);
    const targetBox = groupBoxes.get(t.group);
    if (!sourceBox || !targetBox) return null;

    const targetCenter = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
    const sourceCenter = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
    const exitPort = boxPort(sourceBox, targetCenter.x, targetCenter.y);
    const entryPort = boxPort(targetBox, sourceCenter.x, sourceCenter.y);

    const c1x = exitPort.x + exitPort.nx * PORT_PULL;
    const c1y = exitPort.y + exitPort.ny * PORT_PULL;
    const c2x = entryPort.x + entryPort.nx * PORT_PULL;
    const c2y = entryPort.y + entryPort.ny * PORT_PULL;

    return cubicPath(sPos.x, sPos.y, c1x, c1y, c2x, c2y, tPos.x, tPos.y);
}
