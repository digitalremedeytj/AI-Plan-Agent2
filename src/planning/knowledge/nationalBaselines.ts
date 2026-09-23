// Published U.S. national distributions that audience estimates are built from. When the
// research has no audience-specific split for a chart, the model supplies only how this
// audience differs from the nation (a relative index per bracket, 100 = same as national) and
// code applies it to these figures. The estimate then starts from a real, citable shape - TV
// viewing really does peak at 8-9 PM - instead of whatever curve the model imagines.
//
// Every number below is copied from the cited table. Refresh them when the sources publish a
// new year; do not edit individual values.
//
// Retrieved 2026-09-22.

export interface ShareBaseline {
  kind: "share";
  /** Chart item key for the bracket label, e.g. "range" for the age chart. */
  labelKey: "range" | "gender" | "bracket";
  brackets: Array<{ label: string; share: number }>;
  source: string;
  url: string;
}

export interface IndexBaseline {
  kind: "index";
  labelKey: "day" | "hour";
  /** Relative activity by period, scaled so the mean across periods is 100. */
  periods: Array<{ label: string; index: number }>;
  source: string;
  url: string;
}

export type NationalBaseline = ShareBaseline | IndexBaseline;

// U.S. Census Bureau, Vintage 2024 national population estimates by single year of age and sex
// (NC-EST2024-SYASEXN), July 1, 2024. Shares of the resident population aged 18 and over
// (266,978,268), summed from single years of age.
const AGE: ShareBaseline = {
  kind: "share",
  labelKey: "range",
  brackets: [
    { label: "18-24", share: 11.7 },
    { label: "25-34", share: 17.4 },
    { label: "35-44", share: 17.1 },
    { label: "45-54", share: 15.3 },
    { label: "55-64", share: 15.6 },
    { label: "65+", share: 22.9 },
  ],
  source: "U.S. Census Bureau, Vintage 2024 population estimates (adults 18+)",
  url: "https://www.census.gov/data/tables/time-series/demo/popest/2020s-national-detail.html",
};

// Same table: adults 18+ by sex.
const GENDER: ShareBaseline = {
  kind: "share",
  labelKey: "gender",
  brackets: [
    { label: "Male", share: 49.0 },
    { label: "Female", share: 51.0 },
  ],
  source: "U.S. Census Bureau, Vintage 2024 population estimates (adults 18+)",
  url: "https://www.census.gov/data/tables/time-series/demo/popest/2020s-national-detail.html",
};

// U.S. Census Bureau, Current Population Survey ASEC 2025, Income in the United States: 2024
// (P60-286), Table A-2, all races, 2024 row. The table's first two brackets (under $15,000:
// 7.1; $15,000-$24,999: 6.4) and the next two ($25,000-$34,999: 6.8; $35,000-$49,999: 9.9)
// are combined to match the chart's bracket widths.
const INCOME: ShareBaseline = {
  kind: "share",
  labelKey: "bracket",
  brackets: [
    { label: "<$25k", share: 13.5 },
    { label: "$25k-$50k", share: 16.7 },
    { label: "$50k-$75k", share: 15.1 },
    { label: "$75k-$100k", share: 12.0 },
    { label: "$100k-$150k", share: 16.7 },
    { label: "$150k-$200k", share: 10.1 },
    { label: "$200k+", share: 16.0 },
  ],
  source: "U.S. Census Bureau, CPS ASEC 2025, household income in 2024 (P60-286, Table A-2)",
  url: "https://www.census.gov/library/publications/2025/demo/p60-286.html",
};

// U.S. Bureau of Labor Statistics, American Time Use Survey 2025, Table A-3: percent of the
// population age 15+ watching television, by hour starting at 12 AM.
export const ATUS_2025_TV_BY_HOUR = [
  3.4, 1.6, 1.0, 0.6, 0.7, 0.9, 1.8, 3.6, 4.6, 6.1, 7.6, 8.0,
  8.5, 9.9, 11.5, 12.5, 13.6, 14.8, 18.4, 24.7, 32.6, 31.1, 19.4, 8.7,
];

// BLS ATUS 2025, Table 2: average hours per day watching television, age 15+.
export const ATUS_2025_TV_HOURS = { weekday: 2.33, weekendOrHoliday: 3.27 };

const HOUR_BLOCKS = ["12am-3am", "3am-6am", "6am-9am", "9am-12pm", "12pm-3pm", "3pm-6pm", "6pm-9pm", "9pm-12am"];

function toIndex(values: number[]): number[] {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.map((value) => Math.round((value / mean) * 1000) / 10);
}

const HOUR_OF_DAY: IndexBaseline = {
  kind: "index",
  labelKey: "hour",
  periods: toIndex(HOUR_BLOCKS.map((_, block) => {
    const hours = ATUS_2025_TV_BY_HOUR.slice(block * 3, block * 3 + 3);
    return hours.reduce((sum, value) => sum + value, 0) / hours.length;
  })).map((index, i) => ({ label: HOUR_BLOCKS[i], index })),
  source: "U.S. Bureau of Labor Statistics, American Time Use Survey 2025 (TV viewing by hour, Table A-3)",
  url: "https://www.bls.gov/tus/tables/a3-2025.htm",
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_OF_WEEK: IndexBaseline = {
  kind: "index",
  labelKey: "day",
  periods: toIndex(DAYS.map((day) => (day === "Sat" || day === "Sun" ? ATUS_2025_TV_HOURS.weekendOrHoliday : ATUS_2025_TV_HOURS.weekday)))
    .map((index, i) => ({ label: DAYS[i], index })),
  source: "U.S. Bureau of Labor Statistics, American Time Use Survey 2025 (TV hours, weekdays vs weekends, Table 2)",
  url: "https://www.bls.gov/news.release/atus.t02.htm",
};

/** Keyed by the chart ids in src/qa/generationIntegrity.ts PROFILE_CHARTS. */
export const NATIONAL_BASELINES: Record<string, NationalBaseline> = {
  age: AGE,
  gender: GENDER,
  income: INCOME,
  dayOfWeek: DAY_OF_WEEK,
  hourOfDay: HOUR_OF_DAY,
};
