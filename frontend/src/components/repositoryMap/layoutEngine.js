// Hierarchical (two-level) force layout for the Repository Map.
//
// Replaces a single flat simulation over every file (which produces one
// hairball, overlapping group boxes, and files that drift outside their own
// group — see plan doc) with three phases:
//
//   A. Local layout: each group lays out only its own files/intra-group
//      edges, relative to its own (0,0) origin.
//   B. Global layout: one pseudo-node per GROUP (not per file) is
//      positioned by its own simulation, with forceCollide sized to that
//      group's real Phase-A footprint — a hard non-overlap constraint,
//      not a soft bias.
//   C. Compose: a file's final position = its Phase-A local position +
//      its group's Phase-B offset. A file can't drift outside its group
//      because it never participates in the global simulation directly.
//
// Pure functions only — no D3 selections, no React, no DOM. Fully
// unit-testable in isolation (see scratchpad verify_layout_engine.mjs).
import * as d3 from "d3";
import { GROUP_GAP, GROUP_HEADER_H, GROUP_PADDING, NODE_COLLIDE_RADIUS } from "./constants.js";

const LOCAL_SETTLE_TICKS = 150;
const GLOBAL_SETTLE_TICKS = 300;

function groupNodesByGroup(nodes) {
    const byGroup = new Map();
    for (const n of nodes) {
        if (!byGroup.has(n.group)) byGroup.set(n.group, []);
        byGroup.get(n.group).push(n);
    }
    return byGroup;
}

// Phase A — one group's own files, laid out relative to a local (0,0).
// Returns { positions: Map<id,{x,y}>, width, height } where width/height
// already include padding + header space (so Phase B can size collision
// directly from it, and Phase C/box-drawing needs no further adjustment).
function layoutGroupLocally(groupNodes, intraEdges) {
    const positions = new Map();

    if (groupNodes.length === 1) {
        positions.set(groupNodes[0].id, { x: 0, y: 0 });
    } else if (groupNodes.length <= 4) {
        // Too few nodes for a simulation to do anything useful — a simple
        // row avoids wasting a settle pass on 1-3 points.
        const spacing = NODE_COLLIDE_RADIUS * 1.8;
        const startX = -((groupNodes.length - 1) * spacing) / 2;
        groupNodes.forEach((n, i) => positions.set(n.id, { x: startX + i * spacing, y: 0 }));
    } else {
        const simNodes = groupNodes.map(n => ({ id: n.id }));
        const simEdges = intraEdges.map(e => ({ source: e.source, target: e.target }));
        const sim = d3.forceSimulation(simNodes)
            .force("link", d3.forceLink(simEdges).id(d => d.id).distance(90).strength(0.4))
            .force("charge", d3.forceManyBody().strength(-190))
            .force("collision", d3.forceCollide(NODE_COLLIDE_RADIUS))
            .force("center", d3.forceCenter(0, 0).strength(0.05))
            .stop();
        for (let i = 0; i < LOCAL_SETTLE_TICKS; i++) sim.tick();
        simNodes.forEach(n => positions.set(n.id, { x: n.x, y: n.y }));
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const { x, y } of positions.values()) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const halfW = NODE_COLLIDE_RADIUS, halfH = NODE_COLLIDE_RADIUS / 1.6;
    const width = (maxX - minX) + halfW * 2 + GROUP_PADDING * 2;
    const height = (maxY - minY) + halfH * 2 + GROUP_PADDING * 2 + GROUP_HEADER_H;
    // Re-center positions on the bbox center so Phase C can add the
    // group's global offset directly (local origin == box center).
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    for (const [id, p] of positions) positions.set(id, { x: p.x - cx, y: p.y - cy });

    return { positions, width, height };
}

function aggregateInterGroupLinks(edges, nodesById) {
    const linkMap = new Map();
    for (const e of edges) {
        const s = nodesById.get(e.source);
        const t = nodesById.get(e.target);
        if (!s || !t || s.group === t.group) continue;
        const key = [s.group, t.group].sort().join("|");
        linkMap.set(key, (linkMap.get(key) || 0) + 1);
    }
    return Array.from(linkMap.entries()).map(([key, count]) => {
        const [source, target] = key.split("|");
        return { source, target, count };
    });
}

// Phase B — position the groups themselves (as rigid bodies), not files.
function layoutGroupsGlobally(groupFootprints, interGroupLinks, canvasSize) {
    const groupIds = Array.from(groupFootprints.keys());
    const width = canvasSize?.width || 1200;
    const height = canvasSize?.height || 800;

    if (groupIds.length === 1) {
        const gid = groupIds[0];
        return new Map([[gid, { x: width / 2, y: height / 2 }]]);
    }

    // Seed on a ring so the collision/charge forces have room to separate
    // groups immediately, rather than starting stacked near the center.
    const ringRadius = Math.max(width, height) * 0.3 + groupIds.length * 40;
    const groupNodes = groupIds.map((gid, i) => {
        const angle = (2 * Math.PI * i) / groupIds.length;
        const footprint = groupFootprints.get(gid);
        return {
            id: gid,
            r: Math.hypot(footprint.width, footprint.height) / 2,
            x: width / 2 + ringRadius * Math.cos(angle),
            y: height / 2 + ringRadius * Math.sin(angle),
        };
    });

    const sim = d3.forceSimulation(groupNodes)
        .force("charge", d3.forceManyBody().strength(-800))
        .force("collision", d3.forceCollide(d => d.r + GROUP_GAP))
        .force("link", d3.forceLink(interGroupLinks).id(d => d.id).distance(80).strength(0.12))
        .force("center", d3.forceCenter(width / 2, height / 2).strength(0.015))
        .stop();

    for (let i = 0; i < GLOBAL_SETTLE_TICKS; i++) sim.tick();

    const offsets = new Map();
    for (const n of groupNodes) offsets.set(n.id, { x: n.x, y: n.y });
    return offsets;
}

/**
 * @param {Array} nodes - [{id, group, ...}]
 * @param {Array} edges - [{source, target, kind, label}] (ids, not objects)
 * @param {Array<string>} groupOrder - group ids in a stable display order
 * @param {{width:number,height:number}} canvasSize
 * @returns {{ nodePositions: Map<string,{x:number,y:number}>, groupBoxes: Map<string,{x:number,y:number,width:number,height:number}> }}
 */
export function computeHierarchicalLayout(nodes, edges, groupOrder, canvasSize) {
    const nodesById = new Map(nodes.map(n => [n.id, n]));
    const byGroup = groupNodesByGroup(nodes);

    const groupFootprints = new Map(); // gid -> { positions, width, height }
    for (const gid of groupOrder) {
        const members = byGroup.get(gid);
        if (!members || members.length === 0) continue;
        const memberIds = new Set(members.map(n => n.id));
        const intraEdges = edges.filter(e => memberIds.has(e.source) && memberIds.has(e.target));
        groupFootprints.set(gid, layoutGroupLocally(members, intraEdges));
    }

    const interGroupLinks = aggregateInterGroupLinks(edges, nodesById);
    const groupOffsets = layoutGroupsGlobally(groupFootprints, interGroupLinks, canvasSize);

    const nodePositions = new Map();
    const groupBoxes = new Map();
    for (const [gid, footprint] of groupFootprints) {
        const offset = groupOffsets.get(gid) || { x: canvasSize?.width / 2 || 600, y: canvasSize?.height / 2 || 400 };
        for (const [id, local] of footprint.positions) {
            nodePositions.set(id, { x: local.x + offset.x, y: local.y + offset.y });
        }
        groupBoxes.set(gid, {
            x: offset.x - footprint.width / 2,
            y: offset.y - footprint.height / 2,
            width: footprint.width,
            height: footprint.height,
        });
    }

    return { nodePositions, groupBoxes };
}
