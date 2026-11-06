import React from "react";
import type { PartnerProvider } from "../research/partnerData";

// A data partner's logo, or its name as a wordmark in the partner's colour until an admin uploads
// one (Settings -> Data Partners). Used in the brief, the library and on the client's plan.

type ProviderLike = Pick<PartnerProvider, "name" | "logoUrl" | "color">;

export function PartnerLogo({ provider, size = "md", label }: { provider: ProviderLike; size?: "sm" | "md" | "lg"; label?: string }) {
  const height = size === "sm" ? "h-4" : size === "lg" ? "h-9" : "h-6";
  const text = size === "sm" ? "text-[10px] px-1.5" : size === "lg" ? "text-base px-3" : "text-xs px-2";
  if (provider.logoUrl) {
    return <img src={provider.logoUrl} alt={label || provider.name} title={label || provider.name} className={`${height} w-auto max-w-[140px] object-contain`} />;
  }
  return (
    <span
      title={label || provider.name}
      className={`inline-flex items-center ${height} ${text} rounded-md font-display font-extrabold tracking-tight whitespace-nowrap border`}
      style={{ color: provider.color, borderColor: `${provider.color}33`, backgroundColor: `${provider.color}0f` }}
    >
      {provider.name}
    </span>
  );
}
