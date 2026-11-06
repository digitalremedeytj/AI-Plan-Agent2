import React from "react";
import { createPortal } from "react-dom";
import { jsPDF } from "jspdf";
import { Check, Copy, Download, FileText, Loader2, MonitorPlay, ShieldCheck, X } from "lucide-react";
import type { PartnerEvidence, PartnerProvider } from "../research/partnerData";
import { partnerSlideFileName, partnerSlides, type PartnerSlideKind } from "../research/partnerSlides";
import { captureElementToCanvas } from "../utils/html2canvasPolyfill";
import { DataPartnersSlide } from "./DataPartnersSlides";
import { prepareLogo } from "./useTrimmedLogo";

// Export the Data Partners section as presentation slides in the persona slides' design. Always
// 16:9 (2560x1440): the slides are dropped into PowerPoint and Google Slides decks, which are 16:9. Unlike the persona studio nothing is generated: the preview is the slide itself,
// so what the planner sees is exactly what downloads, with every figure as verified.

interface Props {
  evidence: PartnerEvidence;
  providers: Array<Pick<PartnerProvider, "id" | "name" | "logoUrl" | "color">>;
  hidden: { dataPartners: boolean; competitive: boolean };
  advertiserName: string;
  initialKind?: PartnerSlideKind;
  onClose: () => void;
  /** For the usage log; the export never reaches the server. */
  onExported: (format: string) => void;
}

// Laid out at 1920x1080 and captured at 4/3, so the PNG is 2560x1440: the persona slides' 16:9 size.
const CAPTURE_SCALE = 4 / 3;
const EXPORT = { width: 2560, height: 1440, ratio: "16:9" };
const PREVIEW_WIDTH = 760;

export function DataPartnersExportModal({ evidence, providers, hidden, advertiserName, initialKind, onClose, onExported }: Props) {
  const specs = partnerSlides(evidence, hidden);
  const [selected, setSelected] = React.useState<PartnerSlideKind[]>(specs.map((s) => s.kind));
  const [active, setActive] = React.useState<PartnerSlideKind | undefined>(initialKind && specs.some((s) => s.kind === initialKind) ? initialKind : specs[0]?.kind);
  const [busy, setBusy] = React.useState<null | "png" | "pdf" | "copy">(null);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const captureRefs = React.useRef<Partial<Record<PartnerSlideKind, HTMLDivElement | null>>>({});

  const width = Math.round(EXPORT.width / CAPTURE_SCALE);
  const height = Math.round(EXPORT.height / CAPTURE_SCALE);
  const previewScale = Math.min(PREVIEW_WIDTH / width, 470 / height);
  const ordered = specs.filter((s) => selected.includes(s.kind));
  const activeSpec = specs.find((s) => s.kind === active);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const capture = async (kind: PartnerSlideKind) => {
    const el = captureRefs.current[kind];
    if (!el) throw new Error("The slide was not ready to export.");
    // Lexend is the slides' typeface; capturing before it loads would set them in the fallback.
    try { await Promise.all(["400", "600", "700"].map((w) => document.fonts.load(`${w} 24px Lexend`))); } catch { /* fallback font */ }
    // The logos are drawn once trimmed; wait for them, then for React to put them on the page.
    await Promise.all(providers.filter((p) => p.logoUrl).map((p) => prepareLogo(p.logoUrl)));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return captureElementToCanvas(el, { scale: CAPTURE_SCALE, width, height, backgroundColor: "#ffffff" });
  };

  const run = async (kind: "png" | "pdf" | "copy", work: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await work();
    } catch (err: any) {
      setError(`The slide could not be exported (${err?.message || err}).`);
    } finally {
      setBusy(null);
    }
  };

  const downloadPng = () => active && run("png", async () => {
    const canvas = await capture(active);
    const link = document.createElement("a");
    link.download = partnerSlideFileName(advertiserName, active, EXPORT.ratio, "png");
    link.href = canvas.toDataURL("image/png");
    link.click();
    onExported(`partners_slide_${active}`);
  });

  const copyPng = () => active && run("copy", async () => {
    const canvas = await capture(active);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("the image could not be created");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onExported(`partners_copy_${active}`);
  });

  const downloadPdf = () => run("pdf", async () => {
    if (ordered.length === 0) throw new Error("choose at least one slide");
    const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: [EXPORT.width, EXPORT.height] });
    for (const [i, spec] of ordered.entries()) {
      const canvas = await capture(spec.kind);
      if (i > 0) pdf.addPage([EXPORT.width, EXPORT.height], "landscape");
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, EXPORT.width, EXPORT.height);
    }
    pdf.save(partnerSlideFileName(advertiserName, "all", EXPORT.ratio, "pdf"));
    onExported("partners_pdf");
  });

  const toggle = (kind: PartnerSlideKind) => setSelected((cur) => (cur.includes(kind) ? cur.filter((k) => k !== kind) : specs.filter((s) => s.kind === kind || cur.includes(s.kind)).map((s) => s.kind)));

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs font-sans" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-[1180px] max-h-[92vh] flex flex-col bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden text-left" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-700 shrink-0"><MonitorPlay className="w-4 h-4" /></div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Data Partners slides</h2>
              <p className="text-xs text-slate-500">The partners' logos and verified figures, exactly as they appear in the plan, in the persona slides' design.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={Boolean(busy)} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 cursor-pointer disabled:opacity-40" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex flex-col md:flex-row min-h-0 flex-1 overflow-y-auto">
          <div className="md:w-[300px] shrink-0 border-b md:border-b-0 md:border-r border-slate-100 p-5 space-y-5">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Slides</div>
              <ul className="space-y-1.5">
                {specs.map((s) => (
                  <li key={s.kind}>
                    {/* The row previews the slide; only the checkbox decides whether it is in the PDF. */}
                    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${active === s.kind ? "border-teal-300 bg-teal-50/50" : "border-slate-200 hover:bg-slate-50"}`}>
                      <input type="checkbox" checked={selected.includes(s.kind)} onChange={() => toggle(s.kind)} className="mt-0.5 h-3.5 w-3.5 accent-teal-600 cursor-pointer" aria-label={`Include ${s.label} in the PDF`} />
                      <button type="button" onClick={() => setActive(s.kind)} className="min-w-0 flex-1 text-left cursor-pointer">
                        <span className="block text-xs font-semibold text-slate-800">{s.label}</span>
                        <span className="block text-[11px] leading-snug text-slate-500">{s.description}</span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-[11px] leading-snug text-slate-500">16:9 at 2560×1440, ready to drop into a PowerPoint or Google Slides deck.</p>
            <p className="flex items-start gap-1 text-[10px] leading-snug text-slate-400"><ShieldCheck className="w-3 h-3 mt-px shrink-0" /> Nothing is generated: every figure and logo is the one approved in the plan. Hidden sections are left out.</p>
          </div>

          <div className="flex-1 min-w-0 p-5 flex flex-col items-center gap-4 bg-slate-50/60">
            {activeSpec ? (
              <>
                <div className="rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-white" style={{ width: width * previewScale, height: height * previewScale }}>
                  <div style={{ width, height, transform: `scale(${previewScale})`, transformOrigin: "top left" }}>
                    <DataPartnersSlide kind={activeSpec.kind} evidence={evidence} providers={providers} width={width} height={height} />
                  </div>
                </div>
                {error && <p className="text-xs text-rose-600">{error}</p>}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button type="button" onClick={downloadPng} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 px-4 py-2 rounded-lg cursor-pointer disabled:cursor-not-allowed">
                    {busy === "png" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Download PNG
                  </button>
                  <button type="button" onClick={copyPng} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50">
                    {busy === "copy" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : copied ? <Check className="w-3.5 h-3.5 text-teal-600" /> : <Copy className="w-3.5 h-3.5" />} {copied ? "Copied" : "Copy image"}
                  </button>
                  <button type="button" onClick={downloadPdf} disabled={Boolean(busy) || ordered.length === 0} className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-800 bg-white border border-teal-200 hover:bg-teal-50 px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50">
                    {busy === "pdf" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />} Download PDF ({ordered.length} slide{ordered.length === 1 ? "" : "s"})
                  </button>
                </div>
              </>
            ) : (
              <p className="py-16 text-sm text-slate-500">Every Data Partners section is hidden from the client, so there is nothing to export.</p>
            )}
          </div>
        </div>
      </div>

      {/* Full-size copies for the capture: a scaled preview would capture at the wrong size. */}
      <div style={{ position: "fixed", left: "-99999px", top: 0, pointerEvents: "none", zIndex: -9999 }} aria-hidden="true">
        {specs.map((s) => (
          <div key={s.kind} ref={(el) => { captureRefs.current[s.kind] = el; }} style={{ width, height, overflow: "hidden" }}>
            <DataPartnersSlide kind={s.kind} evidence={evidence} providers={providers} width={width} height={height} />
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
