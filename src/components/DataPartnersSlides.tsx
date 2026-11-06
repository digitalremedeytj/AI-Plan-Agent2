import React from "react";
import { clientPeriod, type PartnerEvidence, type PartnerProvider } from "../research/partnerData";
import { formatSpend, competitiveHighlights, type CompetitiveRow } from "../research/partnerReinforcement";
import { clip, type PartnerSlideKind } from "../research/partnerSlides";
import { fitLogo } from "../utils/logoFit";
import { useTrimmedLogo } from "./useTrimmedLogo";

// The Data Partners slides, drawn as layout and captured to PNG or PDF. They follow the same brand
// guide as the persona slides (server.ts, /api/personas/generate-slide): teal #0e8f86, deep teal
// #0e3b42 surfaces, indigo #6b63e6, a little lime #a6cf56, body text #0c1e24, Lexend throughout,
// uppercase eyebrows at 0.08em, a white canvas holding only cards (no slide title, footer or
// company logo, which the deck supplies). The partners' own logos are content, so they stay.
// Inline styles throughout: the capture reads computed styles and must not depend on Tailwind.

export const SLIDE = {
  teal: "#0e8f86",
  deep: "#0e3b42",
  indigo: "#6b63e6",
  lime: "#a6cf56",
  ink: "#0c1e24",
  body: "#33474d",
  muted: "#64748b",
  card: "#F8FAFC",
  border: "#E2E8F0",
  canvas: "#FFFFFF",
  font: "Lexend, Inter, ui-sans-serif, system-ui, sans-serif",
};

type Provider = Pick<PartnerProvider, "id" | "name" | "logoUrl" | "color">;

export interface PartnerSlideProps {
  kind: PartnerSlideKind;
  evidence: PartnerEvidence;
  /** The partners with their current logos. */
  providers: Provider[];
  /** The slide's size in CSS pixels; the capture scales it up to the export size. */
  width: number;
  height: number;
}

type Layout = "wide" | "square" | "tall";

export function DataPartnersSlide({ kind, evidence, providers, width, height }: PartnerSlideProps) {
  const ratio = width / height;
  const layout: Layout = ratio >= 1.25 ? "wide" : ratio > 0.85 ? "square" : "tall";
  // Type scales with the short side, so a square slide is not set in 16:9 sizes.
  const u = Math.min(width, height) / 1080;
  const ctx = { evidence, providers, layout, u };
  return (
    <div
      style={{
        width, height, boxSizing: "border-box", padding: 64 * u, background: SLIDE.canvas, fontFamily: SLIDE.font, color: SLIDE.ink,
        display: "flex", flexDirection: "column", gap: 28 * u, overflow: "hidden",
      }}
    >
      {kind === "partners" && <PartnersSlide {...ctx} />}
      {kind === "competitors" && <CompetitorsSlide {...ctx} />}
      {kind === "markets" && <MarketsSlide {...ctx} />}
    </div>
  );
}

interface Ctx {
  evidence: PartnerEvidence;
  providers: Provider[];
  layout: Layout;
  u: number;
}

const eyebrow = (u: number, color: string = SLIDE.teal): React.CSSProperties => ({
  fontSize: 15 * u, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color, lineHeight: 1.2,
});
const headline = (u: number, size: number, color: string = SLIDE.ink): React.CSSProperties => ({
  fontSize: size * u, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.05, color, margin: 0,
});
const card = (u: number, extra: React.CSSProperties = {}): React.CSSProperties => ({
  background: SLIDE.card, border: `1px solid ${SLIDE.border}`, borderRadius: 20 * u, padding: 28 * u,
  boxShadow: "0 10px 30px rgba(14, 59, 66, 0.06)", boxSizing: "border-box", ...extra,
});

// The same sizing as the plan's logos (PartnerLogo): trimmed, equal area, a fixed tile. The
// capture cannot do object-fit, so the image gets explicit width and height from fitLogo.
const LOGO_TILES = {
  hero: { box: { width: 190, height: 54 }, ref: 40, padX: 22, padY: 14 },
  card: { box: { width: 136, height: 38 }, ref: 29, padX: 16, padY: 12 },
  chip: { box: { width: 130, height: 34 }, ref: 26, padX: 0, padY: 0 },
} as const;

function Logo({ provider, u, tile }: { provider: Provider | undefined; u: number; tile: keyof typeof LOGO_TILES }) {
  const logo = useTrimmedLogo(provider?.logoUrl || undefined);
  if (!provider) return null;
  const spec = LOGO_TILES[tile];
  const framed = tile !== "chip";
  const fit = logo ? fitLogo(logo.aspect, spec.ref, spec.box) : null;
  const frame: React.CSSProperties = framed
    ? { background: "#FFFFFF", border: tile === "card" ? `1px solid ${SLIDE.border}` : "none", borderRadius: 14 * u, padding: `${spec.padY * u}px ${spec.padX * u}px`, boxSizing: "content-box" }
    : {};
  return (
    <span style={{ ...frame, width: (framed ? spec.box.width : fit?.width ?? spec.box.width) * u, height: spec.box.height * u, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {provider.logoUrl ? (
        logo && fit && <img src={logo.src} alt={provider.name} style={{ width: fit.width * u, height: fit.height * u, display: "block", maxWidth: "none" }} />
      ) : (
        // A tight line height makes the capture draw the text low and clip it; 1.3 sits true.
        <span style={{ display: "block", fontSize: spec.ref * 0.68 * u, fontWeight: 700, letterSpacing: "-0.02em", color: provider.color, lineHeight: 1.3, whiteSpace: "nowrap" }}>{provider.name}</span>
      )}
    </span>
  );
}

function PartnersSlide({ evidence, providers, layout, u }: Ctx) {
  const credits = [...new Set(evidence.datasets.map((d) => d.providerLabel))];
  const creditText = credits.length === 1 ? credits[0] : `${credits.slice(0, -1).join(", ")} and ${credits[credits.length - 1]}`;
  const providerFor = (id: string) => providers.find((p) => p.id === id);
  const maxDatasets = layout === "wide" ? 4 : 3;
  const shown = evidence.datasets.slice(0, maxDatasets);
  const changes = (evidence.allocationChanges || []).slice(-2);
  const stats = [
    { value: evidence.factCount, label: `verified data point${evidence.factCount === 1 ? "" : "s"}` },
    { value: evidence.datasets.length, label: `partner dataset${evidence.datasets.length === 1 ? "" : "s"}` },
    { value: evidence.providers.length, label: `data partner${evidence.providers.length === 1 ? "" : "s"}` },
  ];

  const hero = (
    <div style={{ background: SLIDE.deep, borderRadius: 24 * u, padding: 44 * u, display: "flex", flexDirection: "column", justifyContent: "center", gap: 22 * u, boxShadow: "0 14px 40px rgba(14, 59, 66, 0.18)", flex: layout === "wide" ? 1 : undefined }}>
      <div style={eyebrow(u, SLIDE.lime)}>Data partners</div>
      <h2 style={headline(u, layout === "wide" ? 50 : 54, "#FFFFFF")}>Built on licensed research from our data partners</h2>
      <p style={{ margin: 0, fontSize: 21 * u, lineHeight: 1.5, color: "rgba(255,255,255,0.82)" }}>
        The audience, market and competitive figures in this plan are taken from {creditText}. Each was checked against the partner's data by our team before it was used.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 * u, marginTop: 6 * u }}>
        {evidence.providers.map((p) => <Logo key={p.id} provider={providerFor(p.id) ?? p} u={u} tile="hero" />)}
      </div>
    </div>
  );

  const statRow = (
    <div style={{ display: "flex", gap: 18 * u }}>
      {stats.map((s) => (
        <div key={s.label} style={card(u, { flex: 1, padding: 24 * u })}>
          {/* lineHeight 1 makes the capture draw the figure low, over its label. */}
          <div style={{ fontSize: 60 * u, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.25, color: SLIDE.teal }}>{s.value.toLocaleString()}</div>
          <div style={{ ...eyebrow(u, SLIDE.muted), fontSize: 13 * u, marginTop: 10 * u }}>{s.label}</div>
        </div>
      ))}
    </div>
  );

  // Cards share the column's height, so two datasets fill the slide as well as four do; with
  // fewer of them the type is larger.
  const descSize = shown.length <= 2 ? 23 : shown.length === 3 ? 20 : 18;
  const datasets = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 * u, flex: 1, minHeight: 0 }}>
      <div style={eyebrow(u)}>What each dataset measured</div>
      {shown.map((d) => (
        <div key={d.id} style={card(u, { display: "flex", gap: 28 * u, alignItems: "center", padding: 28 * u, flex: 1, minHeight: 0 })}>
          <Logo provider={providerFor(d.provider)} u={u} tile="card" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, fontSize: descSize * u, lineHeight: 1.5, color: SLIDE.ink }}>{clip(d.description, layout === "wide" ? 200 : 160)}</p>
            <div style={{ marginTop: 14 * u, display: "flex", flexWrap: "wrap", gap: 12 * u, alignItems: "center", fontSize: 15 * u, color: SLIDE.muted }}>
              <span style={{ fontWeight: 600, color: SLIDE.body }}>{d.providerLabel}</span>
              {clientPeriod(d.period) && <span>{clientPeriod(d.period)}</span>}
              {d.markets.length > 0 && <span>{d.markets.slice(0, 3).join(", ")}{d.markets.length > 3 ? ` +${d.markets.length - 3} more` : ""}</span>}
              <span style={{ background: "rgba(166, 207, 86, 0.22)", color: "#3f5a14", fontWeight: 600, borderRadius: 999, padding: `${4 * u}px ${12 * u}px`, lineHeight: 1.4 }}>{d.factCount} data points</span>
            </div>
          </div>
        </div>
      ))}
      {evidence.datasets.length > shown.length && (
        <div style={{ fontSize: 15 * u, color: SLIDE.muted }}>+{evidence.datasets.length - shown.length} more partner dataset{evidence.datasets.length - shown.length === 1 ? "" : "s"}</div>
      )}
      {changes.length > 0 && (
        <div style={card(u, { borderLeft: `${6 * u}px solid ${SLIDE.lime}`, padding: 24 * u })}>
          <div style={eyebrow(u, SLIDE.indigo)}>What the partner data changed</div>
          {changes.map((c) => (
            <div key={`${c.appliedAt}-${c.title}`} style={{ marginTop: 12 * u }}>
              <div style={{ fontSize: 19 * u, fontWeight: 700, color: SLIDE.ink }}>{c.title}</div>
              <div style={{ fontSize: 16 * u, lineHeight: 1.5, color: SLIDE.body }}>{clip(c.reason, 220)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (layout === "wide") {
    return (
      <div style={{ display: "flex", gap: 32 * u, flex: 1, minHeight: 0 }}>
        <div style={{ width: "40%", display: "flex", flexDirection: "column", gap: 24 * u, minHeight: 0 }}>{hero}{statRow}</div>
        {datasets}
      </div>
    );
  }
  return <>{hero}{statRow}{datasets}</>;
}

function SourceChip({ evidence, providers, u, label }: Ctx & { label: string }) {
  const id = evidence.competitive?.provider;
  const provider = providers.find((p) => p.id === id) ?? evidence.providers.find((p) => p.id === id);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 * u, flexShrink: 0 }}>
      <span style={{ ...eyebrow(u, SLIDE.muted), fontSize: 13 * u }}>Source</span>
      <span style={{ background: "#FFFFFF", border: `1px solid ${SLIDE.border}`, borderRadius: 12 * u, padding: `${10 * u}px ${16 * u}px`, display: "inline-flex", alignItems: "center", gap: 10 * u }}>
        <Logo provider={provider} u={u} tile="chip" />
        {provider && label !== provider.name && <span style={{ fontSize: 14 * u, color: SLIDE.muted }}>{label}</span>}
      </span>
    </div>
  );
}

function HeaderCard({ ctx, eyebrowText, title, meta }: { ctx: Ctx; eyebrowText: string; title: string; meta: string }) {
  const { u, layout, evidence } = ctx;
  return (
    <div style={card(u, { display: "flex", flexDirection: layout === "tall" ? "column" : "row", alignItems: layout === "tall" ? "flex-start" : "center", justifyContent: "space-between", gap: 20 * u, padding: 32 * u })}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 * u, minWidth: 0 }}>
        <div style={eyebrow(u)}>{eyebrowText}</div>
        <h2 style={headline(u, 46)}>{title}</h2>
        {meta && <div style={{ fontSize: 17 * u, color: SLIDE.muted }}>{meta}</div>}
      </div>
      <SourceChip {...ctx} label={evidence.competitive?.providerLabel ?? ""} />
    </div>
  );
}

function metaLine(evidence: PartnerEvidence): string {
  const c = evidence.competitive;
  if (!c) return "";
  return [c.scope, clientPeriod(c.period), c.totalSpend ? `${formatSpend(c.totalSpend)} tracked` : ""].filter(Boolean).join("  ·  ");
}

function Bars({ title, rows, color, u, max }: { title: string; rows: CompetitiveRow[]; color: string; u: number; max: number }) {
  const top = Math.max(...rows.map((r) => r.spend), 1);
  const shown = rows.slice(0, max);
  return (
    <div style={card(u, { flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", gap: 14 * u })}>
      <div style={eyebrow(u)}>{title}</div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-evenly", gap: 10 * u }}>
      {shown.map((r) => (
        <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 16 * u }}>
          {/* No overflow clipping: the capture draws text a little low, and clipping cuts the
              descenders off. clip() already keeps the name inside the column. */}
          <div style={{ width: 230 * u, flexShrink: 0, fontSize: 17 * u, lineHeight: 1.4, fontWeight: r.isAdvertiser ? 700 : 400, color: r.isAdvertiser ? SLIDE.teal : SLIDE.ink, whiteSpace: "nowrap" }}>
            {clip(r.name, 22)}{r.isAdvertiser ? " (you)" : ""}
          </div>
          <div style={{ flex: 1, height: 16 * u, background: "#E8EEF2", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: `${Math.max(2, (r.spend / top) * 100)}%`, height: "100%", borderRadius: 999, background: r.isAdvertiser ? SLIDE.lime : color }} />
          </div>
          <div style={{ width: 92 * u, textAlign: "right", fontSize: 17 * u, fontWeight: 600, color: SLIDE.ink, flexShrink: 0 }}>{formatSpend(r.spend)}</div>
        </div>
      ))}
      </div>
    </div>
  );
}

function CompetitorsSlide(ctx: Ctx) {
  const { evidence, layout, u } = ctx;
  const c = evidence.competitive;
  if (!c) return null;
  const highlights = competitiveHighlights(c);
  const rows = layout === "wide" ? 9 : layout === "square" ? 7 : 8;
  const both = c.competitors.length > 0 && c.mediaTypes.length > 0;
  return (
    <>
      <HeaderCard ctx={ctx} eyebrowText="Competitive landscape" title="Where competitors are spending" meta={metaLine(evidence)} />
      {highlights.length > 0 && (
        <div style={{ display: "flex", flexDirection: layout === "tall" ? "column" : "row", gap: 16 * u }}>
          {highlights.map((h) => (
            <div key={h} style={card(u, { flex: 1, padding: 22 * u, borderLeft: `${6 * u}px solid ${SLIDE.lime}`, fontSize: 18 * u, lineHeight: 1.45, color: SLIDE.ink })}>{h}</div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: layout === "wide" && both ? "row" : "column", gap: 20 * u, flex: 1, minHeight: 0 }}>
        {c.competitors.length > 0 && <Bars title="Spend by competitor" rows={c.competitors} color={SLIDE.teal} u={u} max={both && layout !== "wide" ? Math.min(rows, 6) : rows} />}
        {c.mediaTypes.length > 0 && <Bars title="Competitor spend by media type" rows={c.mediaTypes} color={SLIDE.indigo} u={u} max={both && layout !== "wide" ? Math.min(rows, 5) : rows} />}
      </div>
    </>
  );
}

function MarketsSlide(ctx: Ctx) {
  const { evidence, layout, u } = ctx;
  const c = evidence.competitive;
  if (!c) return null;
  const rows = c.markets.slice(0, layout === "wide" ? 9 : 12);
  const cell: React.CSSProperties = { padding: `${14 * u}px ${16 * u}px`, fontSize: 18 * u, borderBottom: `1px solid ${SLIDE.border}`, color: SLIDE.ink, textAlign: "left" };
  const head: React.CSSProperties = { ...cell, ...eyebrow(u, SLIDE.muted), fontSize: 13 * u, padding: `${10 * u}px ${16 * u}px` };
  return (
    <>
      <HeaderCard ctx={ctx} eyebrowText="Market by market" title="Who leads competitive spend in each market" meta={metaLine(evidence)} />
      <div style={card(u, { flex: 1, minHeight: 0, padding: `${12 * u}px ${20 * u}px`, display: "flex", flexDirection: "column" })}>
        <table style={{ width: "100%", flex: rows.length >= 5 ? 1 : undefined, borderCollapse: "collapse", fontFamily: SLIDE.font }}>
          <thead>
            <tr>
              <th style={head}>Market</th>
              <th style={head}>Spend leader</th>
              <th style={{ ...head, textAlign: "right" }}>Leader's share</th>
              <th style={{ ...head, textAlign: "right" }}>Total tracked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.market}>
                <td style={{ ...cell, fontWeight: 600 }}>{m.market}</td>
                <td style={cell}>
                  {m.leader ?? "—"}
                  {m.leaderSpend !== undefined && <span style={{ color: SLIDE.muted }}>{`  ·  ${formatSpend(m.leaderSpend)}`}</span>}
                </td>
                <td style={{ ...cell, textAlign: "right" }}>
                  {m.leaderShare !== undefined ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 * u }}>
                      <span style={{ display: "inline-block", width: 90 * u, height: 10 * u, background: "#E8EEF2", borderRadius: 999, overflow: "hidden" }}>
                        <span style={{ display: "block", width: `${Math.min(100, m.leaderShare)}%`, height: "100%", background: SLIDE.teal }} />
                      </span>
                      <span style={{ fontWeight: 600, minWidth: 64 * u }}>{`${m.leaderShare.toFixed(m.leaderShare % 1 ? 1 : 0)}%`}</span>
                    </span>
                  ) : "—"}
                </td>
                <td style={{ ...cell, textAlign: "right", fontWeight: 600 }}>{m.totalSpend !== undefined ? formatSpend(m.totalSpend) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {c.markets.length > rows.length && <div style={{ padding: `${12 * u}px ${16 * u}px`, fontSize: 14 * u, color: SLIDE.muted }}>+{c.markets.length - rows.length} more markets in the plan</div>}
      </div>
    </>
  );
}
