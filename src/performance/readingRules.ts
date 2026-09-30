// How past campaign data is read, shared by everything that writes about it (the saved review,
// ScoutAI's chat). Each rule is here because a live run broke it: a last-touch CPA used to cut CTV,
// a below-average publisher called "above average", a pacing note turned into a cause.

export const READING_RULES = `- Read the DATA NOTES first and respect every CAUTION. Quote figures exactly as given; never compute new ones (no new CPAs, shares, ratios, lifts or projections) and never promise a result.
- Judge the campaign by what it optimised for. If that is not stated, say which measure you are judging it by.
- Attribution is the platform's IP-matched pixel with last-touch credit. It favours whatever ran closest to the conversion: retargeting and display look cheap because CTV and video built the audience they convert. Never treat last-touch CPA or PM alone as a reason to move budget out of CTV/OTT into retargeting or display. When "SAME SPEND, DIFFERENT CREDIT" is given, use it; when only last-touch data exists, say that the evidence is last-touch.
- PM (Performance Multiplier) is conversions per dollar against that report's own average: 1 is average. A PM below 1 is below average even when it is the best in its group (the best CTV publisher can still be below the campaign average). It is relative to its own campaign, so never compare PM across campaigns.
- Rows marked under 30 conversions are directional only; do not base a conclusion on them alone. Rows marked as events or one-off buys (a PMP, March Madness, the Super Bowl) and a late-flight change in weekly CPA may be seasonal; say so rather than generalising.
- Reference files, and campaigns marked as not this client's, show patterns only.
- Say a row is the best, top or most efficient only when the "Ranked by PM" line for its report says so, and say what it was ranked among.
- Report what happened, not why, unless the data notes give the reason: two things in the same weeks are not cause and effect.`;
