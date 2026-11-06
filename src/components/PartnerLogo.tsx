import React from "react";
import type { PartnerProvider } from "../research/partnerData";
import { fitLogo } from "../utils/logoFit";
import { useTrimmedLogo } from "./useTrimmedLogo";

// A data partner's logo, or its name as a wordmark in the partner's colour until an admin uploads
// one (Settings -> Data Partners). Used in the brief, the library and on the client's plan.
//
// Logos come in every shape, so each is trimmed to its visible pixels and given the same area
// inside a fixed box (utils/logoFit) rather than the same height. `framed` puts the box in a white
// tile with a border: where logos sit in a row or a column, the tile edges are what the eye lines
// up, which hides the differences no sizing can fix (MediaRadar's mark sits above its wordmark).

type ProviderLike = Pick<PartnerProvider, "name" | "logoUrl" | "color">;
type Size = "sm" | "md" | "lg";

// box: the space the logo may use; ref: the height a typical 3.7:1 wordmark gets.
const SIZES: Record<Size, { box: { width: number; height: number }; ref: number; pad: string; text: string }> = {
  sm: { box: { width: 84, height: 22 }, ref: 17, pad: "px-3.5 py-2", text: "text-[11px]" },
  md: { box: { width: 100, height: 28 }, ref: 21, pad: "px-4 py-2.5", text: "text-xs" },
  lg: { box: { width: 124, height: 36 }, ref: 27, pad: "px-5 py-3", text: "text-base" },
};

export function PartnerLogo({ provider, size = "md", label, framed = false }: { provider: ProviderLike; size?: Size; label?: string; framed?: boolean }) {
  const spec = SIZES[size];
  const logo = useTrimmedLogo(provider.logoUrl || undefined);
  const name = label || provider.name;

  let inner: React.ReactNode;
  if (provider.logoUrl) {
    // Until the trim finishes the box is held empty, so the row does not jump.
    const fit = logo ? fitLogo(logo.aspect, spec.ref, spec.box) : null;
    inner = (
      <span className="inline-flex items-center justify-center" style={{ width: framed ? spec.box.width : fit?.width ?? spec.box.width, height: spec.box.height }}>
        {logo && fit && <img src={logo.src} alt={name} title={name} style={{ width: fit.width, height: fit.height }} className="block max-w-none" />}
      </span>
    );
  } else if (framed) {
    inner = (
      <span className={`inline-flex items-center justify-center ${spec.text} font-display font-extrabold tracking-tight whitespace-nowrap overflow-hidden`} style={{ width: spec.box.width, height: spec.box.height, color: provider.color }} title={name}>
        {provider.name}
      </span>
    );
  } else {
    const height = size === "sm" ? "h-4" : size === "lg" ? "h-9" : "h-6";
    const text = size === "sm" ? "text-[10px] px-1.5" : size === "lg" ? "text-base px-3" : "text-xs px-2";
    return (
      <span
        title={name}
        className={`inline-flex items-center ${height} ${text} rounded-md font-display font-extrabold tracking-tight whitespace-nowrap border`}
        style={{ color: provider.color, borderColor: `${provider.color}33`, backgroundColor: `${provider.color}0f` }}
      >
        {provider.name}
      </span>
    );
  }

  if (!framed) return inner as React.ReactElement;
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-xs ${spec.pad}`}>{inner}</span>;
}
