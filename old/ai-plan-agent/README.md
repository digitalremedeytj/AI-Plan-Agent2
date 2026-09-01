# Audience Profile Builder

A full-stack, research-backed digital media strategy and audience research tool built using React, Express, and Google Gemini 3.5 with Search Grounding. 

Audience Profile Builder generates high-quality, media-planning-ready consumer audience profiles and CTV-first tactical recommendations based on live web research. It can analyze direct textual descriptions or reverse-engineer audience metrics from brand/advertiser landing page URLs.

---

## Key Capabilities

- **Hybrid Input Channels**: Generate strategic profiles using direct audience queries (e.g., *"Luxury Travelers in the US"*) or from brand URLs (e.g., *"https://www.razer.com"*).
- **Google Search Grounding**: Integrates live Google Search grounding to retrieve real, citable industry reports (from MRI-Simmons, Statista, eMarketer, GWI, Nielsen, and other authoritative Tier 1 & Tier 2 sources).
- **Interactive Metric Dashboards**: Renders native, high-fidelity responsive charts for domains reach, device platform splits, age distribution, gender skews, household income ranges, and weekly/hourly activation timelines.
- **Transparency-First Data Tables**: All charts support a toggleable "View Data Table" mode showing the raw data points and source attributions.
- **Professional Markdown Exports**: Download complete, formal multi-page agency-style media plan reports with a single click.
- **Advanced Strategy Tuning**: Support for localized regenerations prioritizing stricter scientific sourcing or deeper programmatic recommendations.

---

## Tech Stack

- **Frontend**: React 19, Tailwind CSS, Recharts (for charts), Lucide React (for icons)
- **Backend**: Express (Node.js), TypeScript, tsx, esbuild (for server builds)
- **AI Core**: `@google/genai` TypeScript SDK
- **Model**: `gemini-3.5-flash` with Google Search Grounding and structured JSON Schema output

---

## Environment Configuration

To run this application locally, you must provide your Gemini API key in a `.env` file at the root directory:

1. Copy the `.env.example` file to create a `.env` file:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and fill in your actual **Gemini API Key**:
   ```env
   GEMINI_API_KEY="AIzaSyYourActualAPIKeyHere..."
   APP_URL="http://localhost:3000"
   ```

---

## Local Development Setup

To start the application locally:

### 1. Install Dependencies
Run the package installation:
```bash
npm install
```

### 2. Launch Development Server
Boot the Express + Vite unified server on port `3000`:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your web browser.

### 3. Compile Production Bundle
To compile both the React client assets and the bundle server (compiled to CJS for reliable runtime execution):
```bash
npm run build
```

### 4. Start Production Server
Run the production build:
```bash
npm run start
```

---

## Sourcing & Grounding Notes

1. **Syndicated vs. Modeled Data**: If public quantitative figures are unavailable, the model is instructed to output standard, rounded "Modeled Planning Proxies" (e.g., for daypart indexes) to prevent hallucinating exact figures, while labeling them clearly in accordance with real-world agency practices.
2. **Authority Tiers**:
   - **Tier 1**: Government datasets, official industry associations (IAB, MRC), primary platform reports.
   - **Tier 2**: Reputable analytical firms (MRI-Simmons, Statista, eMarketer, Similarweb, Nielsen, Comscore).
   - **Tier 3**: Trade press coverage, reputable news coverage.
   - **Tier 4**: Basic blog content (used purely as auxiliary directional context).

---

## Example Test Inputs

Test the app's performance and accuracy using these verified queries:

- **Query A (Gamers)**:
  - **Audience**: "Gamers in the US"
  - **URL**: `https://www.razer.com`
  - **Campaign Focus**: `CTV-first digital media plan`
- **Query B (Boutique Travel)**:
  - **Audience**: "Luxury travelers looking for high-end boutique hotels"
  - **URL**: `https://www.visitcalifornia.com`
  - **Campaign Focus**: `Full-funnel digital media plan`
- **Query C (Families)**:
  - **Audience**: "New parents shopping for organic baby products"
  - **URL**: `https://www.target.com`
  - **Campaign Focus**: `Retail/media commerce plan`
