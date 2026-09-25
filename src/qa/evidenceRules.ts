// How a plan may use its evidence. One text, given to every step that writes plan prose
// (synthesis, the narrative writer, the channel reasoning, the prose fixer) and named in the
// auditor's rubric, so the writers and the judge work to the same standard.
//
// The rules are the failure modes the auditor kept finding in live runs, written as rules for
// the writer. Before this, synthesis and the narrative carried general "cite the research"
// instructions, and the same scope errors came back run after run for the fixer to patch:
// a DTC buyers' income split presented as the whole audience's, a total-TV index used to time
// CTV, a general e-commerce peak presented as pet-category behaviour, "32% more likely" turned
// into "32% of owners", product names the brief never mentioned.

export const EVIDENCE_RULES = `EVIDENCE RULES (the QA audit checks every one):
1. KEEP THE POPULATION. A figure describes the group the research measured. A split for a sub-group (DTC buyers, primary food shoppers, subscribers, one generation) is not the whole audience's split; say which group it describes.
2. KEEP THE CATEGORY. A national, cross-category or industry-wide figure (all e-commerce, all TV, all U.S. adults) stays general: "across U.S. e-commerce..." It is never this category's or this advertiser's own behaviour.
3. KEEP THE MEDIUM AND THE BEHAVIOUR. Total-TV viewing is not CTV or streaming. When people watch is not when they shop, search or buy. A desktop or gaming statistic says nothing about a different activity.
4. KEEP THE MEASURE. An index or "X% more likely" is relative, not a share of people. A "top reason" or ranking is not an incidence. Composition, reach, penetration and index are different things.
5. KEEP THE EXACT FIGURE AND RANGE. Quote numbers, ranges and time windows as reported. Never narrow, round into a new figure, combine figures, or extend a figure to a period or place it does not cover.
6. ADVERTISER FACTS COME ONLY FROM THE BRIEF OF RECORD. Present a product, formulation, format, offer, price, program, retailer or fulfilment option as the advertiser's only if it is in the brief of record's verified advertiser facts. Research that mentions the advertiser's products is not verification. The usual slips: subscriptions or autoship, bundles, trial or variety packs, pack sizes, discounts, guarantees, a product's availability at a named retailer, and health benefits of a product. State none of these unless it is a verified fact. Otherwise describe the category and the shopper ("probiotic dry food", "owners who buy online"), not a product or an offer.
7. NO PROMISED OUTCOMES. Say how the plan pursues each KPI and how it will be measured, never that it will meet a target or guarantee a result. Use the KPIs as stated: name them freely, but do not reinterpret one or change its target.
8. COSTS AND BENCHMARKS only when the research reports them for this context; otherwise label them as a planning assumption.
9. TIMING NEEDS TIMING EVIDENCE FOR THIS CATEGORY. The day and hour charts are national TV-viewing baselines: they may set CTV timing, described as when the audience watches TV. Search, social, display and purchase timing need research about this category or audience; data the research labels GENERAL, or about another activity, cannot set them. Without category timing, recommend testing dayparts rather than stating a proven window.`;
