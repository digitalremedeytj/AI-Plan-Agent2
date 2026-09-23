import workbookSource from "./workbook-83126.json";
import type { AttachedPlanningRecord, ProductStatus } from "../types";

type SheetName = keyof typeof workbookSource.sheets;
type CellValue = string | number | boolean | null;
type SourceRecord = Record<string, CellValue>;

export interface NormalizedKnowledgeRecord extends AttachedPlanningRecord {
  recordType: "targeting" | "publisher" | "measurement" | "creative_enhancement" | "inventory_control";
  sourceLabel: string;
  status: ProductStatus;
  digitalRemedyExecutable: boolean;
  recommendationEligible: boolean;
  attachesTo: string[];
  trigger: string;
  verticalGate: string;
  dataDependency: string;
  reviewStatus: "verified" | "provisional" | "incomplete";
  metadata: Record<string, CellValue>;
}

export interface CompatibilityEdge {
  fromId: string;
  toId: string;
  relationship: "compatible" | "incompatible";
  availability: "default" | "allowed" | "unsupported" | "future";
  notes: string;
}

export interface PlanningKnowledgeBase {
  catalogVersion: string;
  sourceWorkbook: string;
  sourceWorkbookVersion: string;
  targetingTactics: NormalizedKnowledgeRecord[];
  publishers: NormalizedKnowledgeRecord[];
  measurementCapabilities: NormalizedKnowledgeRecord[];
  creativeEnhancements: NormalizedKnowledgeRecord[];
  inventoryControls: NormalizedKnowledgeRecord[];
  compatibilityEdges: CompatibilityEdge[];
}

const REQUIRED_SHEETS: Array<{ name: SheetName; headers: string[] }> = [
  { name: "Master_Schema", headers: ["Axis / Layer", "Entry", "Include When / Trigger (short)"] },
  { name: "Audience_Targeting", headers: ["Tactic", "Category", "Include When (Audience)"] },
  { name: "Channels", headers: ["Channel", "Default Priority"] },
  { name: "Measurement", headers: ["Capability", "Status", "Pricing"] },
  { name: "High_Impact_Units", headers: ["High Impact Unit", "Attaches To (Channel / Environment)"] },
  { name: "Inventory_Controls", headers: ["Control", "Attaches To"] },
  { name: "Publishers", headers: ["Publisher", "Channel"] },
  { name: "Master_Compatibility", headers: ["Type", "Item", "Display", "CTV/OTT"] },
];

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function splitList(value: CellValue): string[] {
  return String(value || "")
    .split(/[,;&/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sheetRecords(sheetName: SheetName): SourceRecord[] {
  const values = workbookSource.sheets[sheetName].values as CellValue[][];
  const headers = values[0].map((header) => String(header || ""));
  return values.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])),
  );
}

export function validateWorkbookSource(): string[] {
  const errors: string[] = [];
  if (workbookSource.schemaVersion !== 1) errors.push("Unsupported workbook JSON schema version.");
  REQUIRED_SHEETS.forEach(({ name, headers }) => {
    const sheet = workbookSource.sheets[name];
    if (!sheet || !Array.isArray(sheet.values) || sheet.values.length < 2) {
      errors.push(`Workbook sheet ${name} is missing or empty.`);
      return;
    }
    const actualHeaders = new Set(sheet.values[0].map((header) => String(header || "")));
    headers.forEach((header) => {
      if (!actualHeaders.has(header)) errors.push(`Workbook sheet ${name} is missing header ${header}.`);
    });
  });
  return errors;
}

const masterRecords = sheetRecords("Master_Schema");
const masterByEntry = new Map(masterRecords.map((record) => [String(record.Entry || "").trim(), record]));

const measurementAliases: Record<string, string> = {
  "Online / Booking / Order Attribution": "Online/Order Attribution",
  "Consumer Journey Analytics (OPA)": "Consumer Journey / OPA",
  "Purchase Attribution (Affinity Solutions)": "Purchase Attribution (Affinity)",
  "CPG Sales Validation (Circana / MarketLift)": "CPG Sales Validation (Circana)",
};

function normalizeStatus(value: CellValue): ProductStatus {
  const status = String(value || "live").toLowerCase();
  if (status === "beta" || status === "future" || status === "retired") return status;
  return "live";
}

function buildTargeting(): NormalizedKnowledgeRecord[] {
  return sheetRecords("Audience_Targeting")
    .filter((record) => String(record.Tactic || "").trim())
    .map((record) => {
      const sourceLabel = String(record.Tactic).trim();
      const trigger = [record["Include When (Audience)"], record["Include When (KPI)"]].filter(Boolean).join("; ");
      const reviewStatus = trigger ? "provisional" : "incomplete";
      return {
        id: `tactic.${slugify(sourceLabel)}`,
        displayName: sourceLabel,
        recordType: "targeting",
        sourceLabel,
        status: "live",
        digitalRemedyExecutable: true,
        recommendationEligible: Boolean(trigger),
        attachesTo: ["Any Channel"],
        trigger,
        verticalGate: "",
        dataDependency: String(record["Data Dependency"] || ""),
        rationale: trigger || "Workbook record requires trigger review.",
        reviewStatus,
        metadata: record,
      };
    });
}

function buildPublishers(): NormalizedKnowledgeRecord[] {
  return sheetRecords("Publishers")
    .filter((record) => String(record.Publisher || "").trim())
    .map((record) => {
      const sourceLabel = String(record.Publisher).trim();
      const tier = String(record.Tier || "").trim();
      return {
        id: `publisher.${slugify(sourceLabel)}.${slugify(String(record.Channel || "unknown"))}`,
        displayName: sourceLabel,
        recordType: "publisher",
        sourceLabel,
        status: "live",
        digitalRemedyExecutable: true,
        recommendationEligible: true,
        attachesTo: splitList(record.Channel),
        trigger: String(record["Notes / Environment"] || ""),
        verticalGate: "",
        dataDependency: "",
        rationale: String(record["Notes / Environment"] || "Available within the workbook channel environment."),
        reviewStatus: tier ? "provisional" : "incomplete",
        metadata: record,
      };
    });
}

function buildMeasurements(): NormalizedKnowledgeRecord[] {
  return sheetRecords("Measurement")
    .filter((record) => String(record.Capability || "").trim())
    .map((record) => {
      const sourceLabel = String(record.Capability).trim();
      const masterLabel = measurementAliases[sourceLabel] || sourceLabel;
      const master = masterByEntry.get(masterLabel);
      const status = normalizeStatus(record.Status);
      const trigger = String(record["Include When (KPI/Goal)"] || master?.["Include When / Trigger (short)"] || "");
      return {
        id: `measurement.${slugify(sourceLabel)}`,
        displayName: sourceLabel,
        recordType: "measurement",
        sourceLabel,
        status,
        digitalRemedyExecutable: status !== "retired",
        recommendationEligible: status === "live",
        attachesTo: splitList(master?.["Attaches To"] || "Any Channel"),
        trigger,
        verticalGate: String(record["Vertical Gate"] || master?.["Vertical Gate"] || ""),
        dataDependency: String(master?.["Data Dependency"] || record["Exposure Match Method"] || ""),
        rationale: String(record["Answers / What It Proves"] || trigger || "Measurement capability"),
        pricing: String(record.Pricing || ""),
        limitation: String(record["What It CANNOT Prove"] || ""),
        reviewStatus: trigger && record.Pricing ? "provisional" : "incomplete",
        metadata: record,
      };
    });
}

function buildEnhancements(): NormalizedKnowledgeRecord[] {
  return sheetRecords("High_Impact_Units")
    .filter((record) => String(record["High Impact Unit"] || "").trim())
    .map((record) => {
      const sourceLabel = String(record["High Impact Unit"]).trim();
      const trigger = String(record["Trigger (when to add)"] || "").trim();
      const formatType = String(record["Format Type"] || "").trim();
      const notes = String(record["Spec / Vendor Notes"] || "").trim();
      const complete = Boolean(trigger && formatType && notes);
      return {
        id: `enhancement.${slugify(sourceLabel)}`,
        displayName: sourceLabel,
        recordType: "creative_enhancement",
        sourceLabel,
        status: "live",
        digitalRemedyExecutable: true,
        recommendationEligible: complete,
        attachesTo: splitList(record["Attaches To (Channel / Environment)"]),
        trigger,
        verticalGate: "",
        dataDependency: "",
        rationale: trigger || "Workbook trigger is not yet populated.",
        reviewStatus: complete ? "provisional" : "incomplete",
        metadata: record,
      };
    });
}

function buildInventoryControls(): NormalizedKnowledgeRecord[] {
  return sheetRecords("Inventory_Controls")
    .filter((record) => String(record.Control || "").trim() && String(record["What It Does"] || "").trim())
    .map((record) => {
      const sourceLabel = String(record.Control).trim();
      const trigger = String(record["Trigger (when to add)"] || "").trim();
      return {
        id: `inventory.${slugify(sourceLabel)}`,
        displayName: sourceLabel,
        recordType: "inventory_control",
        sourceLabel,
        status: "live",
        digitalRemedyExecutable: true,
        recommendationEligible: true,
        attachesTo: splitList(record["Attaches To"]),
        trigger,
        verticalGate: "",
        dataDependency: "",
        rationale: String(record["What It Does"]),
        reviewStatus: trigger ? "provisional" : "incomplete",
        metadata: record,
      };
    });
}

const compatibilityTargets: Record<string, string> = {
  Display: "channel.display",
  OLV: "channel.olv",
  "CTV/OTT": "channel.ctv",
  Native: "channel.native",
  Audio: "channel.audio",
  DOOH: "channel.dooh",
  Search: "channel.search",
  Social: "channel.social_meta",
};

/**
 * The compatibility sheet names tactics more briefly than the targeting sheet does
 * ("Contextual" for "Contextual Targeting", "Retargeting off CTV / OTT" for "Sequential
 * Retargeting off CTV / OTT"), so slugging its names produced ids no tactic had. 11 of its 28
 * tactic rows matched nothing, and those tactics could never attach to a channel. A row now
 * resolves to the tactic whose id it names, or failing that the tactics whose id contains it;
 * the all-retailers row resolves to every retailer's data tactic.
 */
export function resolveCompatibilityTacticIds(itemSlug: string, tacticIds: string[]): string[] {
  const exact = tacticIds.filter((id) => id === `tactic.${itemSlug}`);
  if (exact.length > 0) return exact;
  if (itemSlug.startsWith("retail_data")) return tacticIds.filter((id) => id.includes("retail_data_off_site_activation"));
  const containing = tacticIds.filter((id) => id.slice("tactic.".length).includes(itemSlug));
  // "contextual" is contained in both Contextual Targeting and Contextual Suppression; the row
  // means the tactic whose name starts with it.
  const starting = containing.filter((id) => id.startsWith(`tactic.${itemSlug}`));
  return (starting.length > 0 ? starting : containing).slice(0, starting.length > 0 ? 1 : containing.length);
}

function buildCompatibilityEdges(): CompatibilityEdge[] {
  const edges: CompatibilityEdge[] = [];
  const tacticIds = buildTargeting().map((record) => record.id);
  sheetRecords("Master_Compatibility").forEach((record) => {
    const item = String(record.Item || "").trim();
    const type = String(record.Type || "").trim().toLowerCase();
    if (!item || !type) return;
    const prefix = type.includes("target") ? "tactic" : type.includes("measure") ? "measurement" : "enhancement";
    const resolved = prefix === "tactic" ? resolveCompatibilityTacticIds(slugify(item), tacticIds) : [];
    const fromIds = resolved.length > 0 ? resolved : [`${prefix}.${slugify(item)}`];
    for (const fromId of fromIds) {
      Object.entries(compatibilityTargets).forEach(([column, toId]) => {
        const compatible = String(record[column] || "").trim().toUpperCase() === "Y";
        edges.push({
          fromId,
          toId,
          relationship: compatible ? "compatible" : "incompatible",
          availability: compatible ? "allowed" : "unsupported",
          notes: `Workbook Master_Compatibility ${column} value: ${record[column] || "-"}`,
        });
      });
    }
  });
  return edges;
}

export const planningKnowledgeBase: PlanningKnowledgeBase = {
  catalogVersion: workbookSource.catalogVersion,
  sourceWorkbook: workbookSource.sourceWorkbook,
  sourceWorkbookVersion: workbookSource.sourceWorkbookVersion,
  targetingTactics: buildTargeting(),
  publishers: buildPublishers(),
  measurementCapabilities: buildMeasurements(),
  creativeEnhancements: buildEnhancements(),
  inventoryControls: buildInventoryControls(),
  compatibilityEdges: buildCompatibilityEdges(),
};

export function validatePlanningKnowledgeBase(kb: PlanningKnowledgeBase = planningKnowledgeBase): string[] {
  const errors = validateWorkbookSource();
  const collections: Array<[string, NormalizedKnowledgeRecord[]]> = [
    ["targeting", kb.targetingTactics],
    ["publishers", kb.publishers],
    ["measurement", kb.measurementCapabilities],
    ["enhancements", kb.creativeEnhancements],
    ["inventory", kb.inventoryControls],
  ];
  const ids = new Set<string>();
  collections.forEach(([name, records]) => {
    if (records.length === 0) errors.push(`Normalized ${name} collection is empty.`);
    records.forEach((record) => {
      if (ids.has(record.id)) errors.push(`Duplicate normalized knowledge id: ${record.id}`);
      ids.add(record.id);
      if (record.status !== "live" && record.recommendationEligible) {
        errors.push(`${record.id} is unavailable but recommendation eligible.`);
      }
    });
  });
  return errors;
}
