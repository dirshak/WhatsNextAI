// Derives the set of nodes/edges actually shown: applies node-level filters
// (external/tests/generated), edge-kind filters (structural/semantic), and
// collapses any group in collapsedGroupIds into one synthetic summary node
// with aggregated edges.
//
// Unlike the first-pass implementation, this does NOT compute positions or
// group bounding boxes — under the hierarchical layout engine, a collapsed
// group is simply a size-1 group like any other, and layoutEngine.js lays
// it out (and boxes it) the same way it lays out every other group. Pure
// function — no D3, no positions in or out.
export function buildVisibleGraph(rawNodes, rawEdges, collapsedGroupIds, filters) {
    const passesNodeFilter = (n) => {
        if (n.is_external && !filters.external) return false;
        if (n.is_test && !filters.tests) return false;
        if (n.is_generated && !filters.generated) return false;
        return true;
    };

    const visibleReal = rawNodes.filter(passesNodeFilter);
    const visibleIds = new Set(visibleReal.map(n => n.id));
    const nodeById = new Map(rawNodes.map(n => [n.id, n]));

    const groupCounts = new Map();
    for (const n of visibleReal) {
        if (!collapsedGroupIds.has(n.group)) continue;
        groupCounts.set(n.group, (groupCounts.get(n.group) || 0) + 1);
    }

    const displayNodes = visibleReal.filter(n => !collapsedGroupIds.has(n.group));
    for (const [groupId, count] of groupCounts) {
        displayNodes.push({
            id: `group:${groupId}`,
            isGroup: true,
            group: groupId,
            label: groupId,
            fileCount: count,
        });
    }

    const repFor = (id) => {
        const n = nodeById.get(id);
        if (!n || !visibleIds.has(id)) return null;
        return collapsedGroupIds.has(n.group) ? `group:${n.group}` : id;
    };

    const edgeMap = new Map();
    for (const e of rawEdges) {
        const src = repFor(e.source);
        const tgt = repFor(e.target);
        if (!src || !tgt || src === tgt) continue;
        const key = `${src} ${tgt}`;
        let agg = edgeMap.get(key);
        if (!agg) {
            agg = { source: src, target: tgt, kind: "structural", label: null };
            edgeMap.set(key, agg);
        }
        if (e.kind === "semantic" && agg.kind !== "semantic") {
            agg.kind = "semantic";
            agg.label = e.label;
        }
    }
    const displayEdges = Array.from(edgeMap.values()).filter(e =>
        e.kind === "semantic" ? filters.semantic : filters.structural
    );

    return { nodes: displayNodes, edges: displayEdges };
}
