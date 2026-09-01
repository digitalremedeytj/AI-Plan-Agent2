# Migration Plan: High-Accuracy Media Plan Parsing via OpenAI Code Interpreter

This document contains all necessary context, current implementation details, and a step-by-step technical plan to migrate the media plan document parsing pipeline to a high-accuracy system leveraging **OpenAI Code Interpreter (`gpt-5.6`)**.

---

## 1. Project Background & Context

### Goal
The application is a **Media Plan Document Analyzer**. Users upload media plan spreadsheets (typically in `.xlsx` or `.csv` formats) that contain media buy details (publisher, placement, geography, buy model, CPM, budget, etc.). The goal is to:
1. Provide a beautiful, high-fidelity **interactive spreadsheet grid preview** of the uploaded document on the frontend.
2. Accurately **extract and parse** the unstructured spreadsheet rows into a structured, validated JSON format representing media plan line items.
3. Automatically ignore irrelevant sections (e.g., advertiser/agency contact cards, summary rows, or notes) and focus strictly on the actual media buy placements.
4. **Accuracy is paramount.** Speed is secondary to getting 100% correct, verified row extractions with correct column mapping.

### Current Challenges
Spreadsheets vary wildly in layout, structure, and formatting. They contain:
- Multiple header rows.
- Merged columns and rows (where a single publisher cell covers 10 rows of placements).
- Inconsistent or nested columns (e.g., geographic targets combined in a single cell).
- Extraneous metadata or contact tables at the top or bottom of the sheet.

While text-based LLM completion works for basic layouts, it struggles with complex merged ranges, column alignment, and larger sheets.

---

## 2. Current Implementation Review

### Client-Side Preview (Successfully Optimized)
In the current turn, we successfully optimized the client-side workbook reader in `/src/App.tsx` to display an incredibly robust raw preview:
- **Merged-Cell Propagation**: We added direct support for reading XLSX `!merges` ranges. When a cell range is merged, we populate all empty sub-cells in that range with the top-left value, ensuring that sorting, filtering, and row indexing work cleanly.
- **Consistent Grid Columns**: All rows are normalized to the maximum column width (`maxCols`) and indexed with letters (A, B, C...).
- **Header Highlight**: An automated heuristic highlights lines that look like column headers (e.g., containing "Placement", "Site", "CPM", etc.).
- **Insight Extractor**: A sidebar extracts metadata fields (like Advertiser, Campaign, and Planner) from the top rows dynamically.

### Backend Parser (`/server.ts`)
The server exposes an API route `/api/parse` (or similar endpoint) that takes the file and processes it. Currently, it relies on passing text representation of sheet cells to a standard text completion API.
- **OpenAI Key**: A fully powered `OPENAI_API_KEY` environment variable is available.
- **OpenAI Client**: The `openai` npm SDK is already integrated on the backend.

---

## 3. The New Code Interpreter Architecture

Rather than relying on raw text completion to interpret column structures, we will leverage **OpenAI's Code Interpreter (the python tool)** running inside a sandboxed container.

### Why Code Interpreter?
1. **Dynamic Python Processing**: The model can write Python code using standard libraries like `pandas`, `openpyxl`, or `msoffice-crypt` to load the file, parse the sheets, and handle merged ranges programmatically.
2. **Programmatic Validation**: The Python script can verify row counts, sum up budgets/costs to match totals in the sheet, and validate data types (ensuring budgets are floats, dates are formatted, etc.) before returning the final JSON.
3. **Self-Correction**: If the Python script encounters a file formatting or encryption error, the model iteratively rewrites and executes the code until it succeeds.

---

## 4. API & Integration Details (Based on OpenAI 5.6 docs)

### Key OpenAI 5.6 Code Interpreter Endpoints
According to the latest documentation, the process involves:

1. **Creating a Container with Files**:
   We can create a sandboxed container and upload the user's uploaded spreadsheet directly to it, or use the auto mode by passing files to the `tools` array.
   ```javascript
   // Auto mode with file_ids
   const response = await client.responses.create({
     model: "gpt-5.6",
     tools: [{
       type: "code_interpreter",
       container: { type: "auto", memory_limit: "4g" }
     }],
     input: [
       {
         role: "user",
         content: [
           { type: "input_file", file_id: "uploaded-file-id" },
           { type: "input_text", text: "Please parse this media plan spreadsheet." }
         ]
       }
     ]
   });
   ```

2. **Writing the Python Script (Instructing the LLM)**:
   We will prompt the LLM to write a Python script that:
   - Uses `pandas` and `openpyxl` to open the file.
   - Detects merged cell structures and propagates values downward/sideward.
   - Separates contact card sections or summary blocks from the main placements grid.
   - Matches columns (e.g., identifying which column contains Publisher/Site, Placement Name, Cost Model, Cost Per Unit, Units, and Total Cost).
   - Generates a cleanly structured JSON matching the database schema.
   - Returns the JSON as output text.

---

## 5. Step-by-Step Implementation Plan for the Next Agent

When you start the next session, here is the exact sequence of modifications to perform:

### Step 1: Inspect the Server Parsing Endpoint
- Locate the file-parsing controller or route in `/server.ts` (look for `/api/upload` or `/api/parse-plan` or similar).
- Note how files are received (usually via `multer` or raw body) and how the payload is passed to the OpenAI API.

### Step 2: Implement File Upload to OpenAI
- Update `/server.ts` to upload the raw incoming stream/buffer to the OpenAI Files API:
  ```typescript
  import fs from 'fs';
  import OpenAI from 'openai';
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Upload file to OpenAI
  const fileUpload = await openai.files.create({
    file: fs.createReadStream(tempFilePath),
    purpose: "user_data",
  });
  ```

### Step 3: Call OpenAI 5.6 with Code Interpreter
- Call the OpenAI Responses API, attaching the uploaded `file_id` and requesting `code_interpreter`.
- Provide a clear, robust instruction prompt for the Python script.

#### Recommended Prompt Structure:
> "You are an expert media plan extraction agent. You have been given a media plan spreadsheet.
> 1. Use the python tool (`pandas`/`openpyxl`) to load the file.
> 2. Handle merged cells by forward-filling or propagating values.
> 3. Clean the table: ignore contact info sections, terms and conditions, and non-media grids.
> 4. Dynamically identify the main media placement header row (look for keys like 'Site', 'Publisher', 'Ad Type', 'Placement Name', 'Cost Model', 'Budget', 'Cost').
> 5. Map columns to this target structured format:
>    - `publisher` (string)
>    - `placementName` (string)
>    - `adType` (string)
>    - `buyType` (string)
>    - `geography` (string)
>    - `audience` (string)
>    - `rate` (number)
>    - `units` (number)
>    - `budget` (number)
>    - `startDate` (string, ISO date or clean text)
>    - `endDate` (string, ISO date or clean text)
> 6. Validate calculations: if a row has units and rate, compute the mathematical product and cross-reference with the row's total cost.
> 7. Output the final output purely as a valid JSON array of objects representing the parsed media buy placements. Do not wrap in markdown blocks; return raw JSON."

### Step 4: Handle the Response & Database Storage
- Extract the JSON payload from the assistant's response.
- Perform any final schema validations or mapping needed to match the existing database tables.
- Return the structured JSON to the React frontend, which will seamlessly render both the raw spreadsheet grid preview and the newly extracted line items.

---

## 6. Verification Checklist for Next Agent
- [ ] Verify that `.xlsx` and `.csv` files are successfully uploaded to OpenAI files.
- [ ] Confirm that `gpt-5.6` with the `code_interpreter` tool runs the Python environment without errors.
- [ ] Verify that merged columns (e.g. where "Digital Remedy" is merged across all rows) are successfully propagated to every line item.
- [ ] Confirm that contact info cards (like the ones at the bottom of the sheet) are successfully ignored during the extraction process.
- [ ] Check that linter passes and the dev server boots successfully on port 3000.
