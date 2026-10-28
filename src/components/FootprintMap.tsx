import React from "react";
import type { GeoFootprintView } from "../planning/geoFootprint";
import { MAP_MARKETS, MAP_STATES, footprintViewBox } from "../planning/knowledge/geoMap";

// Tailwind's indigo and slate, as fills: SVG paths cannot take the utility classes' colours
// through currentColor without a class per state.
const FILL = {
  targeted: "#4f46e5",
  dmaStates: "#c7d2fe",
  other: "#e2e8f0",
  stroke: "#ffffff",
};

/** Markets past this many get dots but no labels, which would only overlap. */
const MAX_LABELS = 5;

function shortMarketName(name: string): string {
  return name.split(/[(,-]/)[0].trim();
}

interface Label { id: string; text: string; x: number; y: number; anchor: "start" | "end" }

/**
 * Places each label beside its dot without covering another: right of the dot if that is clear,
 * else left, else nudged down until clear. Neighbouring markets (Hartford and Providence) sit
 * close enough that labels on one side would overlap. Widths are estimated from the character
 * count, which is close enough at these sizes.
 */
function placeLabels(items: Array<{ id: string; text: string; x: number; y: number; r: number }>, fontSize: number): Label[] {
  const boxes: Array<[number, number, number, number]> = [];
  const overlaps = (box: [number, number, number, number]) =>
    boxes.some((other) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1]);
  const placed: Label[] = [];
  for (const item of [...items].sort((a, b) => a.y - b.y)) {
    const width = item.text.length * fontSize * 0.56;
    const gap = item.r + fontSize * 0.3;
    const boxAt = (anchor: "start" | "end", y: number): [number, number, number, number] => anchor === "start"
      ? [item.x + gap, y - fontSize * 0.6, item.x + gap + width, y + fontSize * 0.6]
      : [item.x - gap - width, y - fontSize * 0.6, item.x - gap, y + fontSize * 0.6];
    let choice: { anchor: "start" | "end"; y: number } = { anchor: "start", y: item.y };
    if (overlaps(boxAt("start", item.y))) {
      choice = !overlaps(boxAt("end", item.y)) ? { anchor: "end", y: item.y } : { anchor: "start", y: item.y };
      while (overlaps(boxAt(choice.anchor, choice.y))) choice.y += fontSize * 0.5;
    }
    boxes.push(boxAt(choice.anchor, choice.y));
    placed.push({ id: item.id, text: item.text, anchor: choice.anchor, y: choice.y, x: choice.anchor === "start" ? item.x + gap : item.x - gap });
  }
  return placed;
}

/**
 * The footprint on a real map, framed to the states involved. State plans shade the targeted
 * states only; DMA plans shade the states the markets reach
 * and put a dot at each market's main city, sized by its households.
 */
export const FootprintMap: React.FC<{ view: GeoFootprintView }> = ({ view }) => {
  const isDma = view.scope === "dma";
  const covered = new Set(view.coveredStates);
  const [minX, minY, width, height] = footprintViewBox(view.coveredStates);

  const maxHouseholds = Math.max(...view.rows.map((row) => row.households), 1);
  const dots = isDma
    ? view.rows
        .map((row) => ({ row, point: MAP_MARKETS[row.id] }))
        .filter((dot): dot is { row: typeof view.rows[number]; point: NonNullable<typeof dot.point> } => Boolean(dot.point))
        // Largest last, so a big market never hides a small neighbour's dot.
        .sort((a, b) => a.row.households - b.row.households)
    : [];
  const radius = (households: number) => width * (0.008 + 0.022 * Math.sqrt(households / maxHouseholds));
  const fontSize = width * 0.03;
  const labels = dots.length <= MAX_LABELS
    ? placeLabels(dots.map(({ row, point }) => ({ id: row.id, text: shortMarketName(row.name), x: point.x, y: point.y, r: radius(row.households) })), fontSize)
    : [];
  // DC is a few map units across; a dot keeps it visible when it is targeted.
  const dcState = MAP_STATES.find((state) => state.code === "DC");
  const showDcDot = !isDma && covered.has("DC") && dcState;

  return (
    <div>
      <svg
        viewBox={`${minX} ${minY} ${width} ${height}`}
        className="w-full h-auto block"
        role="img"
        aria-label={isDma
          ? `Map of ${view.rows.length} markets across ${view.coveredStates.join(", ")}`
          : `Map of targeted states: ${view.coveredStates.join(", ")}`}
      >
        {MAP_STATES.map((state) => (
          <path
            key={state.code}
            d={state.d}
            fill={covered.has(state.code) ? (isDma ? FILL.dmaStates : FILL.targeted) : FILL.other}
            stroke={FILL.stroke}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {showDcDot && (
          <circle
            cx={(dcState.bbox[0] + dcState.bbox[2]) / 2}
            cy={(dcState.bbox[1] + dcState.bbox[3]) / 2}
            r={width * 0.009}
            fill={FILL.targeted}
            stroke={FILL.stroke}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {dots.map(({ row, point }) => (
          <circle
            key={row.id}
            cx={point.x}
            cy={point.y}
            r={radius(row.households)}
            fill={FILL.targeted}
            fillOpacity={0.85}
            stroke={FILL.stroke}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          >
            <title>{`${row.name} · ${(row.households / 1_000_000).toFixed(1)}M TV households`}</title>
          </circle>
        ))}
        {labels.map((label) => (
          <text
            key={`label-${label.id}`}
            x={label.x}
            y={label.y}
            textAnchor={label.anchor}
            dominantBaseline="middle"
            fontSize={fontSize}
            fontWeight={600}
            fill="#1e293b"
            stroke="#ffffff"
            strokeWidth={3}
            paintOrder="stroke"
            vectorEffect="non-scaling-stroke"
            style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}
          >
            {label.text}
          </text>
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500 mt-3">
        {isDma ? (
          <>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />Market (size = TV households)</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-200" />States reached</span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-600" />Targeted</span>
        )}
      </div>
    </div>
  );
};
