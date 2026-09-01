# RFP Upload and Parsing Implementation Guide

This guide provides technical specifications, code examples, and step-by-step instructions for implementing the RFP (Request for Proposal) upload and AI parsing pipeline used in ScoutAI. You can share this document directly with a software engineer or AI coding agent to replicate or adapt this feature in another application.

---

## 1. High-Level Architecture Overview

The RFP upload and parsing system follows a **Full-Stack Client/Server Architecture**:

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │                            FRONTEND (React)                             │
 │                                                                         │
 │  1. File Upload / Paste Input & Form Inputs                             │
 │     - Accepts .xlsx, .xls, .csv, .txt files or direct text paste        │
 │     - Form fields: Advertiser Name (optional), Website URL (optional),   │
 │       KPI / Goals (optional, dynamic multi-input with [+] Add KPI)      │
 │                                                                         │
 │  2. Client-Side Parsing & Metadata Auto-Extraction                      │
 │     - XLSX/XLS: Parsed in-browser using SheetJS (xlsx) into tabular text │
 │     - CSV/TXT: Read as plain text via FileReader                        │
 │     - Auto-extracts Advertiser Name, Website URL, & KPIs from preamble  │
 │       metadata cells to pre-populate form inputs                        │
 │                                                                         │
 │  3. API Dispatch                                                        │
 │     - Sends payload { advertiserName, kpis, briefText, url, geography,  │
 │       campaignFocus, additionalContext }                                │
 └────────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼  POST /api/research
 ┌─────────────────────────────────────────────────────────────────────────┐
 │                            BACKEND (Express)                            │
 │                                                                         │
 │  4. Gemini AI + Search Grounding                                        │
 │     - Calls Google GenAI SDK (@google/genai)                            │
 │     - Model: gemini-3.5-flash with googleSearch tool enabled             │
 │     - Enforces responseSchema (Structured Outputs via Type constants)   │
 │                                                                         │
 │  5. Robust JSON Parsing & Sanitization                                  │
 │     - Cleans control characters (\n, \r, \t inside string values)       │
 │     - Fallback JSON extractor for wrapped or padded model output        │
 │                                                                         │
 │  6. State Injection & Merging                                           │
 │     - Merges parsed brief data into application state/templates         │
 └─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Required Dependencies

Install the following npm packages in the target project:

```bash
npm install @google/genai express xlsx dotenv
npm install --save-dev @types/express @types/node tsx esbuild
```

- **`@google/genai`**: Official Google GenAI SDK for Gemini model interaction and structured JSON output.
- **`xlsx`**: In-browser reading of `.xlsx` and `.xls` files into formatted text.
- **`express`**: Node.js backend server hosting the proxy endpoint.

---

## 3. Client-Side Implementation Guide

### 3.1 Supported File Types, Form Inputs & Auto-Extraction Logic

The frontend supports two input modes:
1. **Document Upload**: Supports `.xlsx`, `.xls`, `.csv`, `.txt`.
2. **Direct Text Paste**: Textarea for raw RFP briefs, budgets, or line items.

#### Form Input Specification & Field Layout
The upload and campaign brief form includes open field inputs for campaign metadata. None of these fields are required:

- **Advertiser Name** *(Optional)*: Positioned **over** the Website URL field. Text input for brand or client name (e.g. "Acura", "Digital Remedy").
- **Website URL** *(Optional)*: Positioned between Advertiser Name and KPI (Goal). URL input for brand landing page or domain.
- **KPI (Goal)** *(Optional)*: Positioned **under** the Website URL field. Supports single or **multiple KPI inputs** dynamically managed via a `[+] Add KPI` button.
  - Media buyers can click `[+] Add KPI` to create additional input fields.
  - Each additional KPI input includes a delete icon (`X`) to remove it.
  - If the uploaded file contains multiple KPIs (e.g. "CPA < $45, 80% VCR, ROAS > 3.0"), the parser automatically pre-populates the form with multiple KPI input fields.

#### Automatic Campaign Metadata Extraction Logic (`extractCampaignMetadata`)

When a user uploads a spreadsheet, the parser automatically scans preamble rows and metadata cells (looking for labels like `Advertiser`, `Client`, `Brand`, `URL`, `Website`, `KPI`, `Goal`, `Objective`) to extract campaign parameters and populate the form fields:

```typescript
const extractCampaignMetadata = (sheetsData: Array<{ name: string; rows: any[][] }>) => {
  let advertiserName = "";
  let websiteUrl = "";
  const foundKpis: string[] = [];

  const advLabels = ["advertiser", "client", "brand", "advertiser name", "client name", "brand name"];
  const urlLabels = ["url", "website", "website url", "site", "landing page", "domain"];
  const kpiLabels = ["kpi", "kpis", "goal", "goals", "primary kpi", "target kpi", "objective", "objectives", "campaign goal", "campaign kpi"];

  for (const sheet of sheetsData) {
    const rows = sheet.rows || [];
    const scanLimit = Math.min(rows.length, 30);

    for (let r = 0; r < scanLimit; r++) {
      const row = rows[r];
      if (!row) continue;

      for (let c = 0; c < row.length; c++) {
        const cellVal = row[c];
        if (cellVal === null || cellVal === undefined) continue;
        const cellStr = String(cellVal).trim();
        if (!cellStr) continue;

        const lowerCell = cellStr.toLowerCase();
        const colonIdx = cellStr.indexOf(":");
        let keyPart = "";
        let valPart = "";

        if (colonIdx > 0 && colonIdx < 35) {
          keyPart = cellStr.substring(0, colonIdx).trim().toLowerCase();
          valPart = cellStr.substring(colonIdx + 1).trim();
        }

        if (!valPart) {
          for (let nextC = c + 1; nextC < Math.min(row.length, c + 4); nextC++) {
            if (row[nextC] !== null && row[nextC] !== undefined && String(row[nextC]).trim()) {
              valPart = String(row[nextC]).trim();
              break;
            }
          }
        }

        const checkKey = keyPart || lowerCell.replace(/:$/, "").trim();

        if (!advertiserName && advLabels.some((l) => checkKey === l || checkKey.includes(l))) {
          if (valPart && !advLabels.includes(valPart.toLowerCase())) {
            advertiserName = valPart;
          }
        }

        if (!websiteUrl && urlLabels.some((l) => checkKey === l || checkKey.includes(l))) {
          if (valPart && !urlLabels.includes(valPart.toLowerCase())) {
            websiteUrl = valPart;
          }
        }

        if (kpiLabels.some((l) => checkKey === l || checkKey.includes(l))) {
          if (valPart && !kpiLabels.includes(valPart.toLowerCase())) {
            const splitParts = valPart.split(/[,;\n\/]+/).map((s) => s.trim()).filter(Boolean);
            splitParts.forEach((p) => {
              if (!foundKpis.includes(p)) {
                foundKpis.push(p);
              }
            });
          }
        }
      }
    }
  }

  return { advertiserName, websiteUrl, kpis: foundKpis };
};
```

#### File Reading Logic (React / TypeScript)

```typescript
import React, { useState } from 'react';
import * as XLSX from 'xlsx';

export function useRfpUploader() {
  const [briefText, setBriefText] = useState<string>('');
  const [uploadedBriefName, setUploadedBriefName] = useState<string>('');
  const [briefInputMode, setBriefInputMode] = useState<'upload' | 'manual'>('upload');

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedBriefName(file.name);
    const extension = file.name.split('.').pop()?.toLowerCase();

    if (extension === 'xlsx' || extension === 'xls') {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          let fullText = "";

          // Iterate through every sheet and convert rows to pipe-delimited text
          workbook.SheetNames.forEach((sheetName) => {
            const sheet = workbook.Sheets[sheetName];
            const jsonRows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
            fullText += `--- Sheet: ${sheetName} ---\n`;
            jsonRows.forEach((row) => {
              if (row && row.length > 0) {
                fullText += row.join(" | ") + "\n";
              }
            });
          });

          setBriefText(fullText.trim());
        } catch (err: any) {
          alert("Error reading Excel file: " + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // Plain text, CSV, TXT
      const reader = new FileReader();
      reader.onload = (evt) => {
        setBriefText((evt.target?.result as string) || '');
      };
      reader.readAsText(file);
    }
  };

  return {
    briefText,
    setBriefText,
    uploadedBriefName,
    briefInputMode,
    setBriefInputMode,
    handleFileUpload,
  };
}
```

### 3.2 Drag-and-Drop & File Upload UI Component

```tsx
<div className="relative border border-dashed border-gray-200 hover:border-blue-400 bg-slate-50/50 hover:bg-slate-50 rounded-xl p-4 text-center cursor-pointer transition min-h-[90px] flex flex-col justify-center items-center">
  <input
    type="file"
    accept=".txt,.csv,.xlsx,.xls"
    onChange={handleFileUpload}
    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
  />
  <div className="flex flex-col items-center">
    {uploadedBriefName ? (
      <div className="flex items-center space-x-1.5 bg-emerald-50 border border-emerald-100 text-emerald-800 px-3 py-1.5 rounded-xl">
        <span className="text-xs font-semibold truncate max-w-[200px]">{uploadedBriefName}</span>
      </div>
    ) : (
      <div className="flex flex-col items-center space-y-1">
        <span className="text-xs font-semibold text-gray-600">Drag & drop or tap to select CSV, TXT, or XLSX</span>
        <span className="text-[10px] text-gray-400">Supported formats: .xlsx, .xls, .csv, .txt</span>
      </div>
    )}
  </div>
</div>
```

---

## 4. Server-Side API Implementation Guide

### 4.1 Server Configuration (`server.ts`)

To allow processing large briefs (e.g. multi-sheet Excel files or detailed text RFPs), increase Express body-parser limits to `50mb`:

```typescript
import express from "express";
import { GoogleGenAI, Type } from "@google/genai";

const app = express();

// Set high limits for large RFP briefs / base64 payloads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
```

### 4.2 Gemini API Integration with Search Grounding & Structured Schema

The backend uses `@google/genai` with `gemini-3.5-flash` to parse brief text and perform real-time research on the advertiser.

```typescript
app.post("/api/research", async (req, res) => {
  try {
    const { briefText, advertiserUrl } = req.body;

    if (!advertiserUrl) {
      return res.status(400).json({ success: false, error: "Advertiser URL is required." });
    }

    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ 
        success: false, 
        error: "GEMINI_API_KEY environment variable is missing." 
      });
    }

    const ai = new GoogleGenAI({
      apiKey: API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    const userBriefSnippet = briefText 
      ? `Here is the user's campaign brief:\n"""\n${briefText}\n"""\n`
      : "The user did not supply a specific campaign brief text; generate goals based on brand services.\n";

    const prompt = `You are an elite research and RFP analysis assistant.
Conduct direct, thorough web research using Google Search to locate facts about this brand:
- Brand website URL: ${advertiserUrl}
${userBriefSnippet}

Identify the brand name, target audience, key product offerings, and competitors.
Extract key budget constraints, target KPIs, and channel preferences from the brief text.
Return a structured JSON response matching the required schema.`;

    // Define strict JSON response schema
    const researchSchema = {
      type: Type.OBJECT,
      properties: {
        clientName: { type: Type.STRING, description: "Exact brand name researched from Google search" },
        clientDetails: { type: Type.STRING, description: "Industry or vertical descriptor" },
        clientMeta: { type: Type.STRING, description: "Geographic footprint or target DMAs" },
        descText: { type: Type.STRING, description: "Executive summary or campaign challenge statement" },
        briefScore: { type: Type.NUMBER, description: "Evaluation score of the brief (e.g. 5.5 - 7.0)" },
        recommendedScore: { type: Type.NUMBER, description: "Improved score after optimization (e.g. 8.2 - 9.4)" },
        
        // Custom domain fields (e.g., channels, competitors, audience personas)
        expansionAudiences: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              meta: { type: Type.STRING },
              desc: { type: Type.STRING },
              sources: { type: Type.STRING }
            },
            required: ["title", "meta", "desc", "sources"]
          }
        },
        channels: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              channel: { type: Type.STRING },
              score: { type: Type.STRING },
              rationale: { type: Type.STRING },
              isRecommended: { type: Type.BOOLEAN }
            },
            required: ["channel", "score", "rationale", "isRecommended"]
          }
        }
      },
      required: ["clientName", "clientDetails", "clientMeta", "descText", "channels"]
    };

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: researchSchema,
      },
    });

    const outputText = response.text || "";

    // Parse and sanitize response JSON
    let parsedData;
    try {
      const sanitized = escapeControlCharacters(outputText.trim());
      parsedData = JSON.parse(sanitized);
    } catch (parseErr) {
      console.warn("Standard JSON parse failed, using fallback extraction:", parseErr);
      const extracted = extractJson(outputText);
      parsedData = JSON.parse(escapeControlCharacters(extracted));
    }

    res.json({ success: true, data: parsedData });
  } catch (err: any) {
    console.error("RFP research failed:", err);
    res.status(500).json({ success: false, error: err.message || "Unknown processing error." });
  }
});
```

---

## 5. Robust JSON Parsing & Sanitization Helpers

LLMs occasionally return control characters (e.g. unescaped raw newlines or tabs inside JSON strings) or wrap JSON in markdown blocks (` ```json ... ``` `). The following helper functions ensure 100% reliable parsing.

### 5.1 Escaping Illegal Control Characters

```typescript
function escapeControlCharacters(str: string): string {
  let result = "";
  let inQuote = false;
  let i = 0;
  while (i < str.length) {
    const char = str[i];
    if (char === '"') {
      let escapeCount = 0;
      let j = i - 1;
      while (j >= 0 && str[j] === '\\') {
        escapeCount++;
        j--;
      }
      if (escapeCount % 2 === 0) {
        inQuote = !inQuote;
      }
      result += char;
    } else if (inQuote) {
      if (char === '\n') {
        result += '\\n';
      } else if (char === '\r') {
        result += '\\r';
      } else if (char === '\t') {
        result += '\\t';
      } else {
        const code = char.charCodeAt(0);
        if (code < 32) {
          result += ' '; // Convert control character to safe space
        } else {
          result += char;
        }
      }
    } else {
      result += char;
    }
    i++;
  }
  return result;
}
```

### 5.2 Extracting JSON Substrings

```typescript
function extractJson(str: string): string {
  const firstArray = str.indexOf('[');
  const firstObject = str.indexOf('{');
  
  let startIdx = -1;
  let endIdx = -1;
  
  if (firstArray !== -1 && (firstObject === -1 || firstArray < firstObject)) {
    startIdx = firstArray;
    endIdx = str.lastIndexOf(']');
  } else if (firstObject !== -1) {
    startIdx = firstObject;
    endIdx = str.lastIndexOf('}');
  }
  
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return str.substring(startIdx, endIdx + 1);
  }
  
  return str;
}
```

---

## 6. Guidelines for Adapting to a New Tool

If you are building a new tool that uses RFP uploads differently (for example, generating media plans, CRM entries, proposal documents, or campaign budget estimators):

1. **Keep the File Reader Unchanged**: The client-side Excel/CSV text conversion logic (`xlsx` library + SheetJS array loop) works universally for any tabular or text RFP.
2. **Customize `researchSchema`**: Update the `Type.OBJECT` properties in the server endpoint to match the data fields required by your new tool.
3. **Customize the AI System Prompt**: Tailor the Gemini prompt instructions to specify how the new tool should transform brief content (e.g. *"Extract all line items, CPMs, and impression targets from the brief"*).
4. **Fallback Field Merging**: Always merge the AI output with default fallback objects/templates so that missing optional fields in the AI response do not crash the UI.

---

## 7. Verification Checklist for Implementation

- [ ] Installed `@google/genai`, `xlsx`, and `express`.
- [ ] Set `express.json({ limit: "50mb" })` on server routes.
- [ ] Configured `GEMINI_API_KEY` in environment variables.
- [ ] Added `xlsx` file reader on client side for `.xlsx`/`.xls` support.
- [ ] Included `escapeControlCharacters` and `extractJson` sanitization functions in server endpoint.
- [ ] Enabled `googleSearch: {}` tool in Gemini model configuration for real-time brand grounding.

---

## 8. Recent Technical Updates & Best Practices

### 8.1 SHA-256 Server Caching & Local Storage Persistence
To prevent redundant API execution and provide instant response times when users test or reload identical RFP documents:
- **Server SHA-256 Hash**: The backend computes a SHA-256 checksum of the uploaded file binary buffer. Results (both media placements and `rfpAnalysis`) are stored in an in-memory `Map` and mirrored to `.media_plan_cache.json` on disk.
- **Client Fingerprinting**: The frontend tracks `${file.name}_${file.size}_${file.lastModified}` in `localStorage` for sub-second client-side hydration.

### 8.2 Cache Bypass & "Re-run Process" Workflow
- **Bypass / Ignore Cache Toggle**: An interactive toggle card under the file upload dropzone allows users to force a fresh analysis pass (`ignoreCache: true`).
- **Re-run Process Button**: Clicking **Re-run Process** triggers an instant re-upload using the stored file reference without forcing the user to select the file from their operating system file picker again.

### 8.3 Unified Submit Button Enabling Logic
To ensure that uploading an RFP document without tabular media line items never blocks the user from proceeding ("Awaiting parsed plan..."):
- The main action submit button checks if **any** valid input source is present:
  ```typescript
  const isSubmitDisabled = briefMode === "upload" && (
    isParsingPlan || 
    !uploadedFileName || 
    (!uploadedFileText && !rfpAnalysis && extractedPlacements.length === 0)
  );
  ```
- As soon as `rfpAnalysis`, `uploadedFileText`, or `extractedPlacements` is populated, the button smoothly turns active ("Run AI Process").

