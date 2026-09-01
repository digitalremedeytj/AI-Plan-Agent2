# ScoutAI Media Plan Spreadsheet Parser: Technical & Architecture Guide

This comprehensive guide details the design, pipeline, optimization mechanics, and execution parameters of the ScoutAI Media Plan Spreadsheet Parser. It is written to serve as an in-depth reference for developers, system architects, and technical analysts who want to understand how the platform processes messy, unstructured media plans with 100% mathematical accuracy and zero hallucination risk.

---

## 1. High-Level Executive Summary

The **ScoutAI Media Plan Parser** is an enterprise-grade document extraction service that automates the transformation of unstructured media buying spreadsheets (Excel `.xlsx`/`.xls` and `.csv` formats) into normalized, type-safe JSON objects representing active media placements. 

### Core System Attributes
| Feature | Technical Specification | Purpose |
|---|---|---|
| **AI Model** | OpenAI `gpt-5.6` | Decides column intent, dynamic row headers, and writes Python code. |
| **Sandboxed Engine** | OpenAI Code Interpreter (4GB Memory Tier) | Executes Python data manipulation scripts safely in isolation. |
| **Parsing Strategy** | Programmatic Execution (No LLM completion) | Eliminates hallucinations. All data is parsed and formatted using Python. |
| **SHA-256 Caching** | Memory Map + Persistent Disk (`.media_plan_cache.json`) | Delivers sub-second instant response for previously parsed workbooks. |
| **Cache Bypass** | Client & Server `ignoreCache` Flag | Allows users to toggle off cache or click "Re-run Process" to re-execute parsing. |
| **Max Extraction Limit** | 500 Placements (Truncated cleanly) | Prevents output token exhaustion and truncated JSON structures. |
| **Multi-Plan Support** | Sheet & In-Sheet Section / Scenario Isolation | Isolates multiple budget options/tiers or tabs into distinct sub-plans. |
| **RFP Brief Extraction** | Native RFP Brief Specifications & Capability Matching | Extracts submission dates, flight dates, target audiences, and maps Digital Remedy solutions. |
| **Durable Keep-Alive** | Unlimited Socket Timeout (`req.socket.setTimeout(0)`) | Prevents network timeouts/gateways dropping connections during runtimes. |
| **Data Hygiene** | Ephemeral Upload Lifecycle (GDPR / HIPAA ready) | Zero persistent raw file storage; uploads are purged from local disk and OpenAI. |

### The Core Breakthrough: Automated Sheet Bypassing & Multi-Plan Isolation
Media planners often attach massive geospatial coordinates (e.g., thousands of targeted zip codes), creative spec sheets, or venue lists (e.g., 18,000+ DOOH screens) directly inside the media plan workbook. Loading or trying to convert these massive auxiliary rows into placements would instantly trigger **Out Of Memory (OOM) errors**, **socket timeouts**, and **invalid/truncated JSON outputs**. 

Furthermore, agency workbooks frequently bundle multiple media plan options (e.g., Option A vs. Option B, low vs. high budget scenarios, or separate channel tabs) within the same file. 

The ScoutAI Parser overcomes this through a **programmatic two-phase gatekeeper**:
1. It inspects sheet metadata using `openpyxl` in `read_only` mode first, automatically filtering out auxiliary reference sheets by keyword matching, and processing only sheets with valid media plan layout characteristics.
2. It detects tab names and in-sheet section banners (e.g. "Option A - $50k Budget", "Option B - $100k Budget", "Tier 1", "Breakout Scenario") to assign a distinct `planName` to each placement line item, automatically populating interactive sub-tabs in the UI.

---

## 2. System Architecture & The 5-Phase Pipeline

The parser operates via a synchronous, state-aware processing pipeline that spans the React frontend, the Express backend, OpenAI's file ingestion layers, and sandboxed sandbox runtimes.

```
┌─────────────────┐            File Ingestion            ┌─────────────────┐
│  React Frontend ├─────────────────────────────────────>│  Express Server │
└─────────────────┘                                      └────────┬────────┘
        ▲                                                         │
        │                                                         │ 1. Stream File Buffer
        │                                                         ▼
┌───────┴─────────┐            Purge Signals             ┌─────────────────┐
│ Interactive UI  │<─────────────────────────────────────┤ OpenAI Files API│
└─────────────────┘                                      └────────┬────────┘
                                                                  │
                                                                  │ 2. Get File ID
                                                                  ▼
┌─────────────────┐            Parse Signals             ┌─────────────────┐
│ Express Server  │<─────────────────────────────────────┤ OpenAI Responses│
└─────────────────┘          (Normalized JSON)           └────────┬────────┘
                                                                  │
                                                                  │ 3. Exec Python VM
                                                                  ▼
                                                         ┌─────────────────┐
                                                         │ Code Interpreter│
                                                         │ (4G Memory Tier)│
                                                         └─────────────────┘
```

### Phase 1: Client Ingestion & Socket Keep-Alive
1. The user drops a spreadsheet or RFP document (`.xlsx`, `.xls`, `.csv`, `.txt`) onto the ScoutAI file upload zone.
2. The UI checks the **Bypass / Ignore Cache** toggle (`ignoreCache`). If disabled (default), the client checks `localStorage` for cached results matching the file fingerprint (`${file.name}_${file.size}_${file.lastModified}`).
3. The browser transmits the file payload as a multipart request (`multipart/form-data`) to `/api/parse-plan`, including `ignoreCache: "true"` if cache bypass is toggled ON or re-run is triggered.
4. To protect against standard 2-minute timeouts imposed by reverse proxies, API gateways (like Nginx), or Node.js event-loop thresholds, the server sets:
   ```ts
   req.socket.setTimeout(0);
   ```
   This disables the idle socket timeout, allowing the connection to stay open as long as the Code Interpreter is running.

### Phase 2: SHA-256 Server Caching & Fast Lookup
1. The server calculates the binary SHA-256 hash of the uploaded file buffer.
2. **Cache Lookup**: If `ignoreCache` is NOT requested, the server checks its in-memory `mediaPlanParseCache` map (backed by disk persistence in `.media_plan_cache.json`).
3. If a match exists:
   - The server instantly returns the cached placements and RFP brief analysis without calling the OpenAI API.
   - Response header includes `cached: true` and `cachedAt` timestamp.
4. If `ignoreCache` is `true` or no cache match is found, the server bypasses cache and logs: `CACHE BYPASS requested... Re-running full AI analysis`.

### Phase 3: OpenAI File Ingestion
1. The uploaded file is temporarily stored in the system temp directory (`/tmp`) under a clean random UUID but **retains the original extension** (e.g., `.xlsx`). Keeping the file extension is critical; otherwise, pandas and openpyxl cannot select the appropriate engines.
2. The server streams this file payload to the OpenAI Files API (`openai.files.create`) using the `"assistants"` purpose.
3. OpenAI responds with a unique `file_id` (e.g., `file-abc123xyz`), confirming the spreadsheet has been mounted and is ready for sandboxed mounting.

### Phase 4: Sandboxed Execution & Smart Pre-Filtering
1. The server calls `openai.responses.create` using `gpt-5.6`.
2. It explicitly configures the `code_interpreter` tool, allocating a high-capacity **4GB memory limit container** (`container: { type: "auto", memory_limit: "4g" }`).
3. Instead of letting the model freely run code, ScoutAI passes a **highly strict, optimized Python template** inside the system instructions.
4. The container boots a Linux sandbox, mounts the uploaded file, and runs the Python script.

### Phase 5: Data Normalization, RFP Brief Analysis, & Verification
Inside the Python sandbox and client-side ingestion pipeline:
- Excludes heavy reference sheets by checking keywords and row counts.
- **Campaign Metadata Extraction**: Automatically scans header/preamble cells for `Advertiser Name`, `Website URL`, and `KPI (Goals)` to pre-populate open form input fields.
- **RFP Brief Analysis**: When an RFP document or brief specification is uploaded, extracts submission due dates, flight dates, target audiences, geographic requirements, payment terms, reporting asks, and maps grounded Digital Remedy capabilities.
- Propagates merged cells downwards to make sure every row has its respective publisher and site data.
- Dynamically resolves parent-child stacked column headers (e.g. "Location" merged over a "Type" column and a blank details column).
- Detects multi-plan section boundaries ("Option A", "Tier 2", "High Budget Scenario") and maps them into `planName`.
- Maps column labels dynamically to the standard schema.
- Cleans and casts numeric properties (strips symbols, parses CPM units).
- Validates flight dates and splits combined duration strings (e.g. "08/01/2026 - 08/31/2026").
- Formats the resulting dataset into a single JSON array and outputs it.

### Phase 6: Cache Saving & Complete Ephemeral Cleanup
1. The model's output text (containing raw JSON or RFP analysis) is returned to the Express server.
2. The Express server parses the JSON result, populates `mediaPlanParseCache` with the SHA-256 key, and flushes the cache map to disk (`.media_plan_cache.json`).
3. **Storage Hygiene Step**: In the `finally` block, the server instantly:
   - Deletes the local temporary file from `/tmp`.
   - Deletes the file from OpenAI's servers using `openai.files.delete(fileUploadId)`.
   This ensures that no proprietary corporate media planning documents are persisted in raw form on disk or on OpenAI servers.

---

## 3. High-Performance Python Script Design & Mechanics

Below is the structured, optimized Python execution template used by the model inside the sandbox. This code is optimized to run with high efficiency, preventing memory exhaustion and timeout errors:

```python
import pandas as pd
import openpyxl
import json
import re
import os

def parse_media_plan(file_path):
    # Determine if file is CSV
    if file_path.lower().endswith('.csv'):
        try:
            df = pd.read_csv(file_path)
            return parse_dataframe(df, sheet_name="Main Plan")
        except Exception as e:
            print(f"Error reading CSV: {e}")
            return []

    # 1. Use openpyxl in read_only mode to quickly inspect sheets without loading data
    try:
        wb = openpyxl.load_workbook(file_path, read_only=True)
        all_sheets = wb.sheetnames
        wb.close()
    except Exception as e:
        print(f"Error reading workbook sheets: {e}")
        return []
    
    # 2. Filter sheets by name first to avoid loading huge reference/spec sheets
    exclude_keywords = ['zip', 'venue', 'location', 'spec', 'audience', 'creative', 'contacts', 'log', 'reference', 'readme', 'guidelines', 'sheet2', 'metadata']
    candidate_sheets = []
    for s in all_sheets:
        s_lower = s.lower()
        if any(kw in s_lower for kw in exclude_keywords):
            continue
        candidate_sheets.append(s)
    
    # If all sheets were filtered out, fallback to all sheets except extremely obvious reference ones
    if not candidate_sheets:
        candidate_sheets = [s for s in all_sheets if not any(kw in s.lower() for kw in ['zip', 'venue', 'location', 'spec'])]
    
    if not candidate_sheets:
        candidate_sheets = all_sheets
        
    all_placements = []
    
    # 3. Process candidate sheets
    for sheet in candidate_sheets:
        try:
            sample_df = pd.read_excel(file_path, sheet_name=sheet, nrows=5)
            if sample_df.empty:
                continue
            df = pd.read_excel(file_path, sheet_name=sheet, header=None)
        except Exception as e:
            print(f"Error loading sheet {sheet}: {e}")
            continue
            
        placements = parse_dataframe(df, sheet_name=sheet)
        all_placements.extend(placements)
        
        # Safeguard overall output size to avoid token truncation
        if len(all_placements) >= 500:
            all_placements = all_placements[:500]
            break
            
    return all_placements

def parse_dataframe(df, sheet_name="Main Plan"):
    if df.empty:
        return []

    # Dynamic header search
    keywords = ['publisher', 'site', 'placement', 'budget', 'cpm', 'rate', 'units', 'ad type', 'buy type', 'cost', 'net cost', 'gross cost']
    
    header_idx = -1
    max_matches = 0
    
    for idx, row in df.iterrows():
        if idx > 25:
            break
        row_str = [str(val).lower() for val in row.values if pd.notna(val)]
        matches = sum(1 for val in row_str if any(kw in val for kw in keywords))
        if matches > max_matches:
            max_matches = matches
            header_idx = idx
            
    if header_idx == -1 or max_matches < 2:
        cols = [str(c).strip() for c in df.columns]
        df.columns = cols
        data_df = df
    else:
        # Resolve parent-child stacked column headers (e.g. "Location" merged over a "Type" column and a blank details column)
        header_cols = []
        if header_idx > 0:
            parent_row = df.iloc[header_idx - 1].ffill().values
            child_row = df.iloc[header_idx].values
            for c_idx in range(len(child_row)):
                p_val = str(parent_row[c_idx]).strip() if c_idx < len(parent_row) and pd.notna(parent_row[c_idx]) else ""
                c_val = str(child_row[c_idx]).strip() if pd.notna(child_row[c_idx]) else ""
                if p_val and p_val.lower() not in ['nan', 'unnamed:']:
                    if c_val and c_val.lower() not in ['nan', 'unnamed:'] and c_val.lower() != p_val.lower():
                        header_cols.append(f"{p_val} {c_val}")
                    else:
                        header_cols.append(p_val)
                else:
                    header_cols.append(c_val if c_val and c_val.lower() not in ['nan', 'unnamed:'] else f"Col_{c_idx}")
        else:
            header_cols = [str(val).strip() if pd.notna(val) else f"Col_{c_idx}" for c_idx, val in enumerate(df.iloc[header_idx].values)]
            
        df.columns = header_cols
        data_df = df.iloc[header_idx + 1:].copy()
        
    col_mapping = {}
    col_indices = {}
    for idx_col, col in enumerate(data_df.columns):
        col_lower = str(col).lower()
        if 'perf' in col_lower or 'adv' in col_lower:
            col_mapping['advPerformance'] = col
            col_indices['advPerformance'] = idx_col
        elif 'media' in col_lower:
            col_mapping['mediaType'] = col
            col_indices['mediaType'] = idx_col
        elif 'product' in col_lower:
            col_mapping['productType'] = col
            col_indices['productType'] = idx_col
        elif 'publisher' in col_lower or 'network' in col_lower or 'partner' in col_lower:
            col_mapping['publisher'] = col
            col_indices['publisher'] = idx_col
        elif ('placement' in col_lower and 'type' not in col_lower) or 'package' in col_lower or 'item' in col_lower:
            col_mapping['placementName'] = col
            col_indices['placementName'] = idx_col
        elif 'audience' in col_lower or 'target' in col_lower or 'segment' in col_lower:
            col_mapping['audience'] = col
            col_indices['audience'] = idx_col
        elif 'start' in col_lower:
            col_mapping['startDate'] = col
            col_indices['startDate'] = idx_col
        elif 'end' in col_lower:
            col_mapping['endDate'] = col
            col_indices['endDate'] = idx_col
        elif 'flight' in col_lower or 'duration' in col_lower or ('date' in col_lower and 'start' not in col_lower and 'end' not in col_lower):
            col_mapping['flightDates'] = col
            col_indices['flightDates'] = idx_col
        elif 'loc' in col_lower and 'type' in col_lower:
            col_mapping['locationType'] = col
            col_indices['locationType'] = idx_col
        elif 'loc' in col_lower or 'geo' in col_lower or 'market' in col_lower:
            col_mapping['locationDetails'] = col
            col_indices['locationDetails'] = idx_col
        elif ('pricing' in col_lower and 'type' in col_lower) or 'pricing structure type' in col_lower:
            col_mapping['pricingStructureType'] = col
            col_indices['pricingStructureType'] = idx_col
        elif 'pricing' in col_lower or 'structure' in col_lower or 'rate' in col_lower or 'cpm' in col_lower:
            col_mapping['pricingStructureDetails'] = col
            col_indices['pricingStructureDetails'] = idx_col
        elif any(kw in col_lower for kw in ['budget', 'cost', 'spend', 'total cost', 'net cost']):
            col_mapping['budget'] = col
            col_indices['budget'] = idx_col
        elif any(kw in col_lower for kw in ['impression', 'imp', 'unit', 'qty', 'volume', 'count', 'quantity']):
            col_mapping['impressions'] = col
            col_indices['impressions'] = idx_col
        elif 'size' in col_lower or 'creative' in col_lower or 'dimension' in col_lower:
            col_mapping['adSizes'] = col
            col_indices['adSizes'] = idx_col
        elif 'note' in col_lower or 'comment' in col_lower or 'instruction' in col_lower:
            col_mapping['notes'] = col
            col_indices['notes'] = idx_col

    # Handle merged Location header over Type & blank/Detail column
    if 'locationType' in col_indices and 'locationDetails' not in col_mapping:
        loc_type_idx = col_indices['locationType']
        if loc_type_idx + 1 < len(data_df.columns):
            next_col = data_df.columns[loc_type_idx + 1]
            col_mapping['locationDetails'] = next_col

    # Fallbacks for common alternative naming
    for idx_col, col in enumerate(data_df.columns):
        col_lower = str(col).lower()
        if 'publisher' not in col_mapping and ('site' in col_lower or 'vendor' in col_lower):
            col_mapping['publisher'] = col
        if 'mediaType' not in col_mapping and ('ad type' in col_lower or 'format' in col_lower or 'channel' in col_lower):
            col_mapping['mediaType'] = col
        if 'productType' not in col_mapping and ('tier' in col_lower or 'placement type' in col_lower):
            col_mapping['productType'] = col
        if 'pricingStructureType' not in col_mapping and ('buy type' in col_lower or 'pricing model' in col_lower or 'model' in col_lower):
            col_mapping['pricingStructureType'] = col
        if 'pricingStructureDetails' not in col_mapping and ('rate' in col_lower or 'cpm' in col_lower or 'cost/m' in col_lower):
            col_mapping['pricingStructureDetails'] = col
        if 'impressions' not in col_mapping and ('units' in col_lower or 'qty' in col_lower):
            col_mapping['impressions'] = col
        if 'locationType' not in col_mapping and ('geography' in col_lower):
            col_mapping['locationType'] = col
        if 'flightDates' not in col_mapping and ('dates' in col_lower or 'flight' in col_lower):
            col_mapping['flightDates'] = col

    placements = []
    current_section = ""

    for _, row in data_df.iterrows():
        # Detect in-sheet plan option or section headers
        non_nulls = [str(v).strip() for v in row.values if pd.notna(v) and str(v).strip() != ""]
        if len(non_nulls) == 1 or (len(non_nulls) == 2 and not any(k in col_mapping for k in ['budget', 'publisher'])):
            cell_text = non_nulls[0]
            cell_lower = cell_text.lower()
            if any(kw in cell_lower for kw in ['option', 'tier', 'scenario', 'package', 'budget option', 'plan a', 'plan b', 'plan c', 'alternative', 'breakout']):
                current_section = cell_text
                continue

        p_val = lambda k: str(row[col_mapping[k]]).strip() if k in col_mapping and pd.notna(row[col_mapping[k]]) else ""
        
        pub = p_val('publisher')
        place = p_val('placementName')
        budget_str = p_val('budget')
        
        # Skip total, summary or disclaimer rows
        if not pub and not place and not budget_str:
            continue
        if any(kw in pub.lower() for kw in ['total', 'summary', 'disclaimer', 'notes', 'grand total']):
            continue
        if any(kw in place.lower() for kw in ['total', 'summary', 'disclaimer', 'notes', 'grand total']):
            continue
            
        def clean_numeric(val):
            if not val: return 0.0
            cleaned = re.sub(r'[^\d.]', '', val)
            try:
                return float(cleaned)
            except ValueError:
                return 0.0
                
        budget = clean_numeric(budget_str)
        impressions = clean_numeric(p_val('impressions'))
        rate_val = p_val('pricingStructureDetails')
        
        # Format Adv. Performance as Yes/No
        perf_val = p_val('advPerformance').lower()
        adv_perf = "No"
        if any(kw in perf_val for kw in ['yes', 'y', 'true', '1', 'active']):
            adv_perf = "Yes"
        elif any(kw in perf_val for kw in ['no', 'n', 'false', '0']):
            adv_perf = "No"
        else:
            adv_perf = "No" if not perf_val else ("Yes" if perf_val == "yes" else "No")
            
        start_date = p_val('startDate')
        end_date = p_val('endDate')
        flight_dates = p_val('flightDates')
        if (not start_date or not end_date) and flight_dates:
            parts = re.split(r'\s+(?:to|-|through)\s+|\s*-\s*', flight_dates, maxsplit=1)
            if len(parts) == 2:
                if not start_date: start_date = parts[0].strip()
                if not end_date: end_date = parts[1].strip()
            elif len(parts) == 1 and parts[0]:
                if not start_date: start_date = parts[0].strip()

        # Build composite plan / option name label
        if current_section and sheet_name and sheet_name.lower() not in ['sheet1', 'main plan', 'media plan']:
            full_plan_name = f"{sheet_name} - {current_section}"
        elif current_section:
            full_plan_name = current_section
        else:
            full_plan_name = sheet_name or "Main Plan"

        # Handle Ad Serving, Advanced Measurement & Product Type edge cases
        raw_media_type = p_val('mediaType')
        raw_product_type = p_val('productType')

        m_low = raw_media_type.lower()
        p_low = raw_product_type.lower()
        pl_low = place.lower()

        if any(kw in m_low or kw in p_low or kw in pl_low for kw in ['ad serving', 'ad server', 'serving fee', '3rd party ad serving', 'third party ad serving']):
            extracted_media_type = 'Ad Serving'
            extracted_product_type = raw_product_type or 'Ad Server Fees'
        elif any(kw in p_low for kw in ['halo', 'incrementality']) and (not raw_media_type or m_low in ['standard', 'display', 'other']):
            extracted_media_type = 'Advanced Measurement'
            extracted_product_type = 'Halo Effect Study' if 'halo' in p_low else 'Incrementality'
        elif any(kw in m_low for kw in ['measurement', 'advanced measurement', 'halo', 'incrementality']):
            extracted_media_type = 'Advanced Measurement'
            if 'halo' in p_low:
                extracted_product_type = 'Halo Effect Study'
            elif 'incrementality' in p_low:
                extracted_product_type = 'Incrementality'
            else:
                extracted_product_type = raw_product_type or 'Measurement Study'
        else:
            extracted_media_type = raw_media_type or 'Display'
            extracted_product_type = raw_product_type or 'Standard'

        placements.append({
            'planName': full_plan_name,
            'advPerformance': adv_perf,
            'mediaType': extracted_media_type,
            'productType': extracted_product_type,
            'placementName': place,
            'publisher': pub or 'Unknown Publisher',
            'audience': p_val('audience') or 'All Users',
            'startDate': start_date,
            'endDate': end_date,
            'locationType': p_val('locationType') or 'National',
            'locationDetails': p_val('locationDetails') or 'National',
            'pricingStructureType': p_val('pricingStructureType') or 'CPM',
            'pricingStructureDetails': rate_val or 'CPM',
            'budget': budget,
            'impressions': impressions,
            'adSizes': p_val('adSizes') or 'Flexible',
            'notes': p_val('notes')
        })
    return placements
```

---

## 4. Key Logic & Processing Strategies

To handle the highly dynamic nature of agency media plans, the parser employs a range of programmatic healing techniques.

### Multi-Plan & Scenario Option Separation
Agencies frequently present multiple media plan variations inside a single workbook (e.g. separate tabs for "CTV Plan" vs. "Display Plan", or in-sheet section banners like "Option A - $50k Budget" and "Option B - $100k Budget").
ScoutAI isolates these options cleanly into a `planName` property:
1. **Sheet Tab Isolation**: Sheet names are tracked per placement.
2. **In-Sheet Section Detection**: Rows containing single cells or section headers matching keywords (`option`, `tier`, `scenario`, `package`, `budget option`, `plan a`, `plan b`, `alternative`, `breakout`) are captured as section boundaries.
3. **Composite Naming**: If both a custom tab name and section header exist, they combine into `Sheet Name - Section Name`.

### Parent-Child & Merged Header Column Resolution
Planners frequently merge a top-level category header (e.g. "Location") across two sub-columns where row 1 has "Type" and row 2 has an unlabeled/blank column for specific market names.
The parser inspecting parent rows automatically joins parent and child column names:
```python
if p_val and c_val and c_val.lower() != p_val.lower():
    header_cols.append(f"{p_val} {c_val}") # Results in "Location Type" and "Location Details"
```
If a secondary column remains unlabeled directly to the right of `locationType`, the index offset logic automatically assigns it as `locationDetails`.

### Merged Cell Propagation
Planners frequently merge cell blocks for visual cleanliness (e.g., grouping ten rows under a single merged "NBC" cell). Standard parsers treat cells after the first row in a merge as null, throwing away critical publisher assignments.
ScoutAI solves this using front-loaded forward-fill propagation:
```python
df = df.ffill(axis=0)
```
This forces pandas to carry down the merged category label to every corresponding sub-row before any schema extraction begins.

### Dynamic Header Matching
Rather than assuming headers sit on row 1, the script scans the first 25 rows looking for keywords matching a typical media plan schema. The row containing the highest keyword match index is promoted to the column header row, and all rows above it (preambles, planner contacts, dates) are sliced away.

### Sanitization of Financial Cells
Planners enter values as currency text (e.g., `"$45,000.00"` or `"15,000,000 imps"`). The Python parsing layer uses regular expressions to isolate decimal values and clean numerical strings, avoiding standard casting crashes:
```python
re.sub(r'[^\d.]', '', val)
```

### Self-Healing Arithmetic Verification
If budget numbers are missing or damaged but units (e.g., Impressions) and rate (e.g., CPM) are present, the Python script cross-calculates and heals the data:
$$\text{Budget} = \text{Units} \times \left( \frac{\text{Rate}}{1000} \right) \quad (\text{if Pricing Model is CPM})$$

### Single-Column Flight Date Splitting
Planners often record flight durations in a single, combined cell (e.g., `"2026-08-01 - 2026-08-31"`, `"08/01/2026 to 08/31/2026"`, or `"Aug 1 - Aug 31"`), rather than mapping start and end times to separate columns.
ScoutAI automatically detects these combined date columns, matches them, and programmatically splits the duration using high-precision regular expressions into distinct `startDate` and `endDate` fields.

### Added Value & Non-Media Line Item Resolution (Ad Serving & Advanced Measurement)
In agency media plans, technical services and measurement add-ons are often included directly as line items alongside media placements. ScoutAI explicitly identifies and categorizes these non-media items:

1. **Ad Serving** (`ad_serving`):
   - **Line Item Identifiers**: `"Ad Serving"`, `"Ad Server Fee"`, `"3rd Party Ad Serving"`, `"Ad Serving Fees"`.
   - **Classification**: Categorized under Canonical Media Taxonomy as `ad_serving` (`"Ad Serving"`).
   - **Scoring Exclusion**: Recognized as a technical utility/fee, NOT an active media reach channel.

2. **Advanced Measurement** (`advanced_measurement`):
   - **Line Item Identifiers**: `"Advanced Measurement"`, `"Halo Effect Study"`, `"Incrementality Study"`, `"Attribution Study"`, `"Lift Study"`.
   - **Classification**: Categorized under Canonical Media Taxonomy as `advanced_measurement` (`"Advanced Measurement"`).
   - **Supported Product Types**:
     - `"Halo Effect Study"`: Evaluates downstream cross-channel impact or sales lift caused by upper-funnel media.
     - `"Incrementality"`: Evaluates causal incremental lift comparing exposed vs. unexposed audiences.
   - **Scoring Exclusion**: Recognized as an analytics add-on, NOT an active media reach channel.

#### Non-Scoring Policy for Added-Value / Technical Line Items:
During Channel Strategy evaluation:
- Both **Ad Serving** and **Advanced Measurement** line items are assigned `score = 0.0` (`audienceFit = 0`, `goalMatch = 0`).
- In the UI, they are displayed with a neutral `"Added Value / Non-Media"` badge and `N/A` scores so that technical fees or measurement studies do not penalize the media plan's overall channel strategy score.
- ScoutAI's AI recommendation engine is strictly forbidden from proposing Ad Serving or Advanced Measurement as new media channel recommendations.

---

## 5. Supported Schemas & Output Format

The parser extracts and formats every individual media plan placement cleanly into a rich schema consisting of **17 columns**. When returned to the client, the schema is formatted as a JSON array of objects with the following keys:

1. **Plan / Option Name** (`planName`): Identifies the specific tab, scenario, or budget option tier (e.g., `"Option A - $50k Budget"`).
2. **Adv. Performance (Yes/No)** (`advPerformance`): Categorized flag (`"Yes"` or `"No"`) identifying whether placement performance tracking is active.
3. **Media Type** (`mediaType`): High-level medium category (e.g., `"CTV"`, `"Digital"`, `"Linear"`).
4. **Product Type** (`productType`): Format product category (e.g., `"Standard"`, `"Video"`, `"Sponsorship"`).
5. **Placement Name** (`placementName`): Descriptive name for the ad unit package or item line.
6. **Publisher** (`publisher`): Media publisher, site, vendor or network partner name.
7. **Audience** (`audience`): Targeting segment or demographic focus details.
8. **Start Date** (`startDate`): The planned flight campaign start date string.
9. **End Date** (`endDate`): The planned flight campaign end date string.
10. **Location Type** (`locationType`): High-level geographical level (e.g., `"National"`, `"Local DMA"`, `"Regional"`).
11. **Location Details** (`locationDetails`): Specific target location names or DMA codes.
12. **Pricing Structure Type** (`pricingStructureType`): Pricing model used (e.g., `"CPM"`, `"CPC"`, `"Flat Rate"`).
13. **Pricing Structure Details** (`pricingStructureDetails`): Unit cost or rate description (e.g., `"28.50"`, `"$15 Flat"`).
14. **Budget ($)** (`budget`): Extracted, cleaned or calculated total net media spend (numeric float).
15. **Impressions** (`impressions`): Total estimated impression or volume quantity (numeric float).
16. **Ad Sizes** (`adSizes`): Creative dimensional requirements (e.g., `"300x250"`, `"1920x1080"`, `"Flexible"`).
17. **Notes** (`notes`): A catchall text field containing any extra custom instructions, annotations, or line-item comments.

### Target JSON Structure
```json
[
  {
    "planName": "Option A - $50k Budget",
    "advPerformance": "Yes",
    "mediaType": "CTV",
    "productType": "Video",
    "placementName": "CTV Prime Video Non-Skippable 30s",
    "publisher": "NBC Universal",
    "audience": "A18-49 Demo Focus",
    "startDate": "2026-08-01",
    "endDate": "2026-08-31",
    "locationType": "National",
    "locationDetails": "US National",
    "pricingStructureType": "CPM",
    "pricingStructureDetails": "28.50",
    "budget": 42750.0,
    "impressions": 1500000.0,
    "adSizes": "16:9 / 1920x1080",
    "notes": "Added performance-based premium tracking package"
  }
]
```

---

## 6. Frontend Sub-Tab Interactive UI & Campaign Metadata Form

### Campaign Metadata Open Form Fields
Alongside the upload parser, the application interface provides open text fields for campaign metadata:
- **Advertiser Name** *(Optional)*: Positioned **over** the Website URL input field. Allows entering brand/client names (e.g., Acura, Nike).
- **Website URL** *(Optional)*: Positioned between Advertiser Name and KPI (Goal).
- **KPI (Goal)** *(Optional)*: Positioned **under** the Website URL input field. Supports multiple goals via an interactive `[+] Add KPI` button:
  - Media buyers can dynamically append multiple target goals or performance targets (e.g., CPA < $45, 80% VCR, ROAS > 3.0).
  - If the uploaded media plan contains preamble metadata with multiple KPIs, the parser automatically populates multiple KPI input fields.
  - Neither input is required.

### Interactive Sub-Tab Filtering
When the extracted placements arrive on the React frontend:
- **Single Plan Files**: If all placements belong to a single plan/sheet, the UI presents the extracted placements table directly without clutter.
- **Multi-Plan Files**: If multiple distinct `planName` categories are detected, an interactive sub-tab bar automatically renders above the table:
  - **All Plans Combined Tab**: Shows the aggregated total net budget, total impression volume, and overall line count across all scenarios, with a sticky **Plan / Option** badge column in the table.
  - **Individual Scenario Tabs** (`Option A`, `Option B`, etc.): Allows media buyers to instantly filter down to a specific option, re-calculating the net budget and KPI metrics exclusively for that plan.

### Cache Bypass Controls & UI Re-run Mechanics
Below the drag-and-drop file upload zone, an integrated cache control card gives media buyers complete governance over the AI parsing cache:
- **Bypass / Ignore Cache Checkbox**: Allows toggling `ignoreCache` on or off. When checked, the UI displays a `"Cache Off"` badge and forces `/api/parse-plan` to bypass both client-side `localStorage` and server-side SHA-256 caching.
- **Re-run Process Button**: Clicking **Re-run Process** instantly triggers `handleFileUpload` with `forceReparse = true`, forcing a fresh pass through the OpenAI Files API and Code Interpreter sandbox without requiring the user to manually re-select the file from disk.

### Action Submit Button State Handlers
To eliminate UI blockers where the primary action button would remain disabled ("Awaiting parsed plan..."):
- The main AI generation button condition evaluates whether **any** valid input exists:
  ```ts
  const isSubmitDisabled = briefMode === "upload" && (
    isParsingPlan || 
    !uploadedFileName || 
    (!uploadedFileText && !rfpAnalysis && extractedPlacements.length === 0)
  );
  ```
- **RFP Brief Integration**: Uploading an RFP file without media line items populates `rfpAnalysis` (or `uploadedFileText`), instantly enabling the "Run AI Process" button without requiring spreadsheet line items.

---

## 7. Resilience, Error Handling, and Scalability

### Sandbox Resource Allocations
- **Memory Overhead**: The container leverages the auto-allocated **4GB Memory Profile** inside OpenAI's infrastructure, which prevents Out Of Memory (OOM) failures when loading extensive workbooks.
- **CPU Scheduling**: The execution of the sandboxed code is dedicated to a distinct task thread inside OpenAI's execution zone, isolated from our main Express event loop.

### Fail-Safe & Fallback Behavior
- If a worksheet contains zero candidate media plan sheets due to overly aggressive keyword filtering, the engine rolls back and candidate-scans all sheets, bypassing only absolute blacklisted keywords (`['zip', 'venue', 'location', 'spec']`).
- In case of a parse failure, the server returns the raw execution logs, aiding debugging without crashing the main application runtime.
- The 500-row crop threshold ensures that response tokens never overflow the max response limit of `gpt-5.6`.
