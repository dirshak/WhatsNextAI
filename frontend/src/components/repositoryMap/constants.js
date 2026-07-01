// Shared sizing/style constants for the Repository Map's layout + rendering.
export const NODE_W = 118;
export const NODE_H = 30;
export const NODE_COLLIDE_RADIUS = Math.hypot(NODE_W, NODE_H) / 2 + 14;

export const GROUP_PADDING = 34;      // inner padding around a group's local layout
export const GROUP_HEADER_H = 26;     // reserved space for the group's label header
export const GROUP_GAP = 60;          // minimum gap enforced between group boxes

export const GROUP_PALETTE = [
    "#5b8def", "#c99a4a", "#4fae82", "#c96a86",
    "#8b85d6", "#4aa9a3", "#a480c9", "#e0a458",
];
export const EXTERNAL_COLOR = "#8a8a8a";
export const TEST_STROKE = "#f5c451";

export function colorForGroup(groupId, groupOrder) {
    if (groupId === "external_apis") return EXTERNAL_COLOR;
    const idx = groupOrder.indexOf(groupId);
    return GROUP_PALETTE[(idx < 0 ? 0 : idx) % GROUP_PALETTE.length];
}
