/**
 * Digital Remedy Context Provider
 *
 * This module provides structured information about Digital Remedy's services,
 * capabilities, and solutions to enhance AI responses.
 */

// Company Overview
export const companyOverview = `
Digital Remedy is a comprehensive performance marketing company specializing in media planning, campaign execution, optimization, and analytics. They offer services across traditional and digital media platforms including TV, Connected TV (CTV), YouTube TV, and digital out-of-home advertising. Their expertise includes dynamic creative optimization, predictive prospecting, and contextual targeting. They aim to maximize media spend effectiveness by providing custom KPI achievement through connected inventory platforms and in-depth data analytics. Digital Remedy emphasizes 24/7 support to ensure optimal results for their clients' advertising campaigns.

Key Features and Services:
1. Media Planning and Execution: End-to-end solutions for media campaigns across various platforms.
2. Cross-Channel Advertising: Expertise in TV, CTV, YouTube TV, and digital out-of-home.
3. Dynamic Creative Optimization: Tailoring ads in real-time for better engagement.
4. Predictive Prospecting: Utilizing data to predict and target potential customers.
5. Contextual Targeting: Placing ads in relevant contexts to enhance effectiveness.
6. Data Analytics and Reporting: Detailed analysis to measure and optimize campaign performance.
7. 24/7 Support: Continuous assistance to ensure campaign success.

Approach:
Digital Remedy combines innovative technology with expert strategy to drive performance for their clients. They focus on utilizing data-driven insights to refine targeting and improve ad engagement, ensuring that every dollar spent on media delivers maximum ROI. Their integrated solutions are designed to meet the unique needs of each client, with a strong emphasis on achieving measurable results.
`;

// Main Solution Categories
export const mainSolutionCategories = {
  performanceTV: {
    title: "Performance TV",
    description: "Use traditional linear TV, CTV, YouTubeTV, and more to create personalized, engaging media that captures your audience and desired outcomes at scale.",
    capabilities: [
      "Premium OTT Inventory: Access to over 50 premium OTT publishers for optimized audience targeting.",
      "Linear TV Buying: Strategic planning and media spend efficiency for national and local linear TV buys.",
      "Halo Effect: Link CTV spend to a cohesive strategy for improved multi-channel performance."
    ]
  },
  performanceAction: {
    title: "Performance Action",
    description: "Drive the actions your business needs most, such as online sales, ad clicks, content downloads, and foot traffic, with customized channel strategies.",
    capabilities: [
      "Omnichannel Inventory: Multi-channel access at scale for effective audience reach.",
      "Predictive Prospecting: AI/ML analytics to predict audience intent and achieve campaign objectives.",
      "Incrementality Measurement and Optimization: Measure and isolate the impact of media channels by examining conversion rates."
    ]
  },
  performanceBrand: {
    title: "Performance Brand",
    description: "Build your brand, change customer perception, and reach the right audience with the right message to exceed campaign goals.",
    capabilities: [
      "Omnichannel Inventory: Multi-channel access at scale for effective audience reach.",
      "High-Impact Creative: Immersive creative experiences that drive high conversion.",
      "Brand Lift Measurement: Cross-channel impact measurement for key performance insights."
    ]
  }
};

// Detailed Capabilities
export const capabilities = {
  performanceCTV: {
    title: "Performance CTV",
    description: "End-to-end campaign management with premium OTT inventory and real-time analytics."
  },
  premiumOTT: {
    title: "Premium OTT Inventory",
    description: "Access to over 50 premium OTT publishers for optimized targeting."
  },
  linearTV: {
    title: "Linear TV Buying",
    description: "Strategic planning and media spend efficiency for national and local linear TV buys."
  },
  tvInsights: {
    title: "TV Insights",
    description: "Cross-platform measurement and competitor intel for smarter data-driven decisions."
  },
  haloEffect: {
    title: "Halo Effect",
    description: "Comprehensive approach linking CTV spend to multi-channel performance."
  },
  attribution: {
    title: "Attribution Methodologies",
    description: "Understand the true impact of marketing through detailed attribution models."
  },
  customMeasurement: {
    title: "Custom Measurement",
    description: "Tailored solutions for unique goals, turning analytics into actionable optimizations."
  },
  brandLift: {
    title: "Brand Lift Measurement",
    description: "Sophisticated survey-based measurement to see which channels and creative placements perform best."
  },
  contextualTargeting: {
    title: "Contextual Targeting",
    description: "Place ads in contextually relevant environments that align with user content to ensure high engagement rates."
  },
  dooh: {
    title: "Digital Out-of-Home (DOOH)",
    description: "Enhance advertising reach by including digital screens in public spaces and high-traffic areas."
  },
  dco: {
    title: "Dynamic Creative Optimization",
    description: "Personalize and optimize creative in real-time, delivering relevant ads with volume efficiency."
  },
  predictiveProspecting: {
    title: "Predictive Prospecting",
    description: "Utilize AI/ML analytics to identify and reach audiences with the highest propensity to convert."
  },
  retargeting: {
    title: "Retargeting",
    description: "Engage audiences already activated by your campaign with various retargeting strategies."
  }
};

// Premium CTV Publishers with CPM data
export const ctvPublishers = {
  streamingServices: [
    { name: "Hulu", cpm: 16.68, scalability: 5 },
    { name: "Pluto", cpm: 10.63, scalability: 5 },
    { name: "Tubi", cpm: 21.57, scalability: 4 },
    { name: "Sling", cpm: 15.72, scalability: 4 },
    { name: "DirecTV Stream", cpm: 13.59, scalability: 4 },
    { name: "Peacock", cpm: 36.50, scalability: 3 },
    { name: "Xumo", cpm: 18.66, scalability: 3 },
    { name: "Philo", cpm: 13.04, scalability: 2 },
    { name: "Plex", cpm: 17.02, scalability: 2 },
    { name: "Fubo", cpm: 13.86, scalability: 2 },
    { name: "Crackle", cpm: 16.60, scalability: 1 },
    { name: "Max", cpm: 39.93, scalability: 1 },
    { name: "Vevo", cpm: 22.22, scalability: 2 }
  ],
  networks: [
    { name: "Disney", cpm: 15.68, scalability: 4 },
    { name: "Paramount", cpm: 23.75, scalability: 4 },
    { name: "Scripps Networks", cpm: 22.22, scalability: 3 },
    { name: "ESPN", cpm: 18.27, scalability: 2 },
    { name: "Discovery+", cpm: 33.66, scalability: 2 },
    { name: "Fuse", cpm: 22.22, scalability: 2 },
    { name: "Outside TV", cpm: 22.22, scalability: 2 },
    { name: "ABC", cpm: 21.60, scalability: 1 },
    { name: "AMC", cpm: 17.97, scalability: 1 },
    { name: "Bloomberg", cpm: 19.81, scalability: 1 },
    { name: "CBS", cpm: 18.71, scalability: 1 },
    { name: "Cheddar", cpm: 22.27, scalability: 1 },
    { name: "CNN", cpm: 23.94, scalability: 1 },
    { name: "CNBC", cpm: 27.11, scalability: 1 },
    { name: "Discovery", cpm: 20.89, scalability: 1 },
    { name: "Fox", cpm: 20.65, scalability: 1 },
    { name: "Freeform", cpm: 14.78, scalability: 1 },
    { name: "FX", cpm: 23.89, scalability: 1 },
    { name: "Hallmark", cpm: 23.15, scalability: 1 },
    { name: "Moonbug", cpm: 21.32, scalability: 1 },
    { name: "NBC", cpm: 21.94, scalability: 1 },
    { name: "Newsy", cpm: 22.22, scalability: 1 },
    { name: "NewsON", cpm: 13.32, scalability: 1 },
    { name: "NFL", cpm: 21.71, scalability: 1 },
    { name: "Science Channel", cpm: 22.22, scalability: 1 },
    { name: "Travel Channel", cpm: 20.35, scalability: 1 },
    { name: "Turner", cpm: 14.14, scalability: 1 },
    { name: "A&E", cpm: 15.62, scalability: 1 }
  ],
  devices: [
    { name: "Roku", cpm: 9.88, scalability: 5 },
    { name: "Samsung", cpm: 17.97, scalability: 5 },
    { name: "LG", cpm: 18.29, scalability: 5 },
    { name: "Vizio", cpm: 14.81, scalability: 5 }
  ]
};

// CTV Plan Framework
export const ctvPlanFramework = {
  title: "CTV Plan Framework",
  description: "Comprehensive framework for creating effective CTV advertising plans",
  sections: [
    {
      title: "1. Business Objectives & KPIs",
      items: [
        "Brand, DR or hybrid goal (e.g., incremental reach vs. site visits)",
        "North-star KPI(s) with baseline and stretch targets (CPM, VCR, cost-per-completed-view, incremental reach, ROAS, foot-traffic lift, etc.)",
        "Learning agenda: tests you must run and the decision they will inform"
      ]
    },
    {
      title: "2. Audience & Data Strategy",
      items: [
        "Primary audience definitions (1P CRM lists, ACR / smart-TV data, demo, behavioral, contextual)",
        "Identity framework for addressability (UID2, PPID, hashed e-mail, clean-room partner)",
        "Data onboarding & privacy controls (GDPR/CCPA consent strings, IAB TCF v2.2)"
      ]
    },
    {
      title: "3. Inventory & Supply Path",
      items: [
        "Coverage across the streaming services, networks, and devices",
        "Price and scalability consideration"
      ]
    },
    {
      title: "4. Budget, Flighting & Pacing",
      items: [
        "Total budget & share-of-marketing-wallet",
        "Flight dates, day-parting, holiday/event bursts",
        "Pacing model and bid ceilings per inventory tier"
      ]
    },
    {
      title: "5. Creative & Messaging",
      items: [
        "Asset map: 6-, 15-, 30-, 60-sec, interactive / shoppable, QR codes, dynamic creative variants",
        "Technical specs (VAST 4.x tags, mezzanine & ready-to-serve files, 4K/HDR, closed captions)",
        "Audio loudness (-24 LUFS), brand guidelines, creative testing plan"
      ]
    },
    {
      title: "6. Targeting Rules & Frequency Management",
      items: [
        "Household vs. individual reach strategy; frequency-cap thresholds across devices",
        "Geo, contextual, content-network/channel fields (enabled by ORTB 2.6)",
        "Exclusion & competitive-separation logic"
      ]
    },
    {
      title: "7. Measurement & Attribution Framework",
      items: [
        "Viewability & completion rate (OM SDK, IAS/Moat)",
        "Reach & frequency dedup (Nielsen ONE, iSpot, Comscore)",
        "Incrementality: baseline-holdout or geo-split lift tests",
        "Outcome attribution: S2S conversions, pixel / SDK events, retail / foot-traffic studies",
        "Reporting cadence and stakeholder dashboards adsmanager.paramount.com"
      ]
    },
    {
      title: "8. Optimization Playbook",
      items: [
        "Mid-flight levers: bid shading, CPM floors, audience/creative reallocations",
        "Creative rotation & fatigue checks",
        "Monitoring and adjustments for pacing or KPI drift"
      ]
    },
    {
      title: "9. Brand Safety, Suitability & Fraud Controls",
      items: [
        "Monitoring by MOAT and Protected Media",
        "Pre-bid IVT filters, ads.cert signatures, OM SDK content-URL signals",
        "Post-bid monitoring"
      ]
    }
  ]
};

// Get context for specific analysis types
export function getContextForAnalysis(analysisType) {
  switch (analysisType.toLowerCase()) {
    case 'audience':
      return getAudienceAnalysisContext();
    case 'competitors':
      return getCompetitorAnalysisContext();
    case 'trends':
      return getTrendsAnalysisContext();
    case 'digital':
      return getDigitalPresenceContext();
    case 'reviews':
      return getReviewsAnalysisContext();
    case 'brand':
      return getBrandAnalysisContext();
    case 'product':
      return getProductOfferingContext();
    case 'company':
      return getCompanyOverviewContext();
    case 'seasonal':
      return getSeasonalOpportunitiesContext();
    case 'localization':
      return getLocalizationContext();
    case 'publishers':
      return getCTVPublishersContext();
    case 'ctvplan':
      return getCTVPlanContext();
    case 'final':
      return getFullContext();
    default:
      return companyOverview;
  }
}

// Context for audience analysis
function getAudienceAnalysisContext() {
  return `
${companyOverview}

Digital Remedy's audience targeting capabilities:

1. Predictive Prospecting: Digital Remedy leverages AI/ML analytics to locate and reach your highest-propensity audiences accurately, predicting their intent and ensuring the fulfillment of campaign objectives through advanced targeting.

2. Contextual Targeting: Digital Remedy places ads in contextually relevant environments that align with user content to ensure high engagement rates and performance metrics. This ensures that ads are displayed in environments that resonate with your target audience.

3. Dynamic Creative Optimization (DCO): This service delivers relevant messaging for each impression through real-time creative customization, driving high performance. Digital Remedy serves relevant ads efficiently to meet unique campaign goals via product feeds and pixeling.

4. Omnichannel Inventory: Digital Remedy provides access to a wide variety of inventory across multiple channels, ensuring ads reach the desired audience regardless of the platform they use.
`;
}

// Context for competitor analysis
function getCompetitorAnalysisContext() {
  return `
${companyOverview}

Digital Remedy's competitive advantage capabilities:

1. Performance TV Solution: Digital Remedy offers a comprehensive 360-degree TV strategy, integrating linear TV and CTV to optimize campaign performance with access to linear inventory with lower minimums and various OTT publishers.

2. Brand Lift Measurement: Digital Remedy helps understand exactly what's working by enabling sophisticated survey-based measurement to see which channels and creative placements perform best, comparing brand impact against competitors.

3. Incrementality Measurement & Optimization: Digital Remedy isolates the impact of media channels by examining conversion rates across exposed and non-exposed users, helping identify which actions result directly from campaigns.

4. Attribution Methodologies: Digital Remedy provides insights into cross-channel impact and measures campaign success in comparison to competitors, ensuring transparency and optimization across campaigns.
`;
}

// Context for market trends analysis
function getTrendsAnalysisContext() {
  return `
${companyOverview}

Digital Remedy's trend-leveraging capabilities:

1. TV Insights: Digital Remedy combines the reach of linear and digital TV, utilizing real-time data to optimize and measure ad performance, ensuring broader audience reach and transparency.

2. Performance CTV: Digital Remedy specializes in targeting and serving high-quality ads on Connected TV platforms, leveraging data to optimize ad delivery and performance.

3. Digital Out-of-Home (DOOH): Digital Remedy enhances the reach of advertising by including digital screens in public spaces, engaging audiences in high-traffic areas.

4. Performance Audio: Digital Remedy delivers targeted audio ads through various digital audio platforms to engage audiences effectively and drive performance.
`;
}

// Context for digital presence analysis
function getDigitalPresenceContext() {
  return `
${companyOverview}

Digital Remedy's digital presence enhancement capabilities:

1. High Impact Creative: Digital Remedy offers high-impact ad formats that drive greater engagement and brand recall, designed to capture attention and deliver messages effectively.

2. Social Boost: Digital Remedy amplifies social media presence by boosting the performance of social media ads to enhance engagement and reach.

3. Shoppable Creative: Digital Remedy creates shoppable ads that allow audiences to purchase directly from the ad, enhancing the path to purchase and increasing conversion rates.

4. Interactive Ads: Digital Remedy enhances user engagement through interactive ad formats that encourage audience interaction, boosting engagement and brand experience.

5. Halo Effect: Digital Remedy reconnects disconnected channels and campaigns into a comprehensive approach, linking CTV spend to a cohesive strategy and improving multi-channel performance.
`;
}

// Context for customer reviews analysis
function getReviewsAnalysisContext() {
  return `
${companyOverview}

Digital Remedy's customer feedback enhancement capabilities:

1. Brand Lift Measurement: Digital Remedy helps understand exactly what's working by enabling sophisticated survey-based measurement to see which channels and creative placements perform best, comparing brand impact against competitors.

2. Attribution Methodologies: Digital Remedy provides insights into cross-channel impact and measures campaign success in comparison to competitors, ensuring transparency and optimization across campaigns.

3. Custom Measurement: Digital Remedy offers tailored measurement solutions to meet specific campaign goals, providing insights into key performance indicators and helping gauge the overall success of campaigns.

4. Incrementality Measurement & Optimization: Digital Remedy isolates the impact of media channels by examining conversion rates across exposed and non-exposed users, helping identify which actions result directly from campaigns.
`;
}

// Context for brand messaging analysis
function getBrandAnalysisContext() {
  return `
${companyOverview}

Digital Remedy's brand enhancement capabilities:

1. Performance Brand Solution: Digital Remedy encompasses a range of strategies aimed at enhancing brand recognition and overall brand performance through optimized digital strategies.

2. High Impact Creative: Digital Remedy offers high-impact ad formats that drive greater engagement and brand recall, designed to capture attention and deliver messages effectively.

3. Dynamic Creative Optimization (DCO): Digital Remedy personalizes and optimizes creative in real-time, delivering relevant ads with volume efficiency and customization through product feeds and pixeling.

4. Interactive Ads: Digital Remedy enhances user engagement through interactive ad formats that encourage audience interaction, boosting engagement and brand experience.

5. Shoppable Creative: Digital Remedy creates shoppable ads that allow audiences to purchase directly from the ad, enhancing the path to purchase and increasing conversion rates.
`;
}

// Context for product offering analysis
function getProductOfferingContext() {
  return `
${companyOverview}

Digital Remedy's product promotion capabilities:

1. Performance Action Solution: Digital Remedy includes Dynamic Creative Optimization (DCO), Predictive Prospecting, and Retargeting to help personalize ads, locate high-propensity audiences, and engage audiences who have shown interest in campaigns.

2. Omnichannel Inventory: Digital Remedy provides access to a wide variety of inventory across multiple channels, ensuring ads reach the desired audience regardless of the platform they use.

3. Retargeting Capabilities: Digital Remedy engages audiences already activated by campaigns with various retargeting strategies such as Website Visitation Retargeting, Store Visitation Retargeting, Sequential Retargeting, and CRM Retargeting.

4. Contextual Targeting: Digital Remedy places ads in contextually relevant environments that align with user content to ensure high engagement rates and performance metrics.
`;
}

// Context for company overview analysis
function getCompanyOverviewContext() {
  return `
${companyOverview}

Digital Remedy's mission and approach:

Digital Remedy meets marketing challenges by reimagining performance advertising for brands and agencies. Their solutions connect the right data with the highest performing media to achieve greater brand impact, increase consumer actions, and create powerful TV campaigns.

Key benefits for clients include:
• Optimized Media Spend: Efficient use of advertising budgets.
• Enhanced Targeting: Better reach to potential customers through advanced targeting methods.
• Comprehensive Support: Continuous monitoring and support to adapt to changing market conditions.
• Performance Measurement: Clear metrics and reporting to track success and areas for improvement.
`;
}

// Context for seasonal opportunities analysis
function getSeasonalOpportunitiesContext() {
  return `
${companyOverview}

Digital Remedy's seasonal campaign capabilities:

1. Dynamic Creative Optimization (DCO): Digital Remedy delivers relevant messaging for each impression through real-time creative customization, allowing for timely seasonal campaign adjustments.

2. TV Insights: Digital Remedy combines the reach of linear and digital TV, utilizing real-time data to optimize and measure ad performance for seasonal campaigns.

3. Halo Effect: Digital Remedy reconnects disconnected channels and campaigns into a comprehensive approach, linking CTV spend to a cohesive strategy for improved multi-channel performance during seasonal promotions.

4. Incrementality Measurement & Optimization: Digital Remedy helps measure and analyze the incremental reach provided by each media channel during seasonal campaigns.
`;
}

// Context for localization analysis
function getLocalizationContext() {
  return `
${companyOverview}

Digital Remedy's localization capabilities:

1. Linear TV Buying: Digital Remedy provides strategic planning and media spend efficiency for national and local linear TV buys, allowing for geographically targeted campaigns.

2. Digital Out-of-Home (DOOH): Digital Remedy enhances the reach of advertising by including digital screens in public spaces, engaging audiences in specific high-traffic areas.

3. Omnichannel Inventory: Digital Remedy provides access to inventory across multiple channels, ensuring ads reach the desired audience in specific geographic locations.

4. Custom Measurement: Digital Remedy offers tailored measurement solutions for unique goals, including location-specific performance metrics.
`;
}

// Context for CTV Publishers analysis
function getCTVPublishersContext() {
  return `
${companyOverview}

Digital Remedy's Premium CTV Publisher Network:

Digital Remedy provides access to over 50 premium OTT publishers across three main categories:

1. Streaming Services:
   - High Scalability (5): Hulu ($$), Pluto ($)
   - Strong Scalability (4): Tubi ($$$), Sling ($$), DirecTV Stream ($)
   - Moderate Scalability (3): Peacock ($$$$$), Xumo ($$$)
   - Limited Scalability (2): Philo ($), Plex ($$), Fubo ($)
   - Niche Scalability (1): Crackle ($$), Max ($$$$$)

2. Networks:
   - Strong Scalability (4): Disney ($$), Paramount ($$$$$)
   - Moderate Scalability (3): Scripps Networks ($$$$)
   - Limited Scalability (2): ESPN ($$), Discovery+ ($$$$$), Fuse ($$$$), Outside TV ($$$$)
   - Specialized Reach (1): ABC ($$$), AMC ($$), Bloomberg ($$$), CBS ($$$), Cheddar ($$$$$), CNN ($$$$$), CNBC ($$$$$), Discovery ($$$), Fox ($$$), FX ($$$$$), Hallmark ($$$$$), NBC ($$$$), NFL ($$$$), Science Channel ($$$$), Travel Channel ($$$)

3. Device Platforms:
   - All with Excellent Scalability (5): Roku ($), Samsung ($$), LG ($$), Vizio ($)

This diverse publisher network allows Digital Remedy to create highly targeted campaigns with optimal reach and frequency across various audience segments. The mix of high-scalability, cost-effective platforms and premium, specialized channels enables customized strategies based on campaign goals, target audience, and budget considerations.
`;
}

// Context for CTV Plan creation
function getCTVPlanContext() {
  return `
${companyOverview}

Digital Remedy's CTV Plan Framework:

To create an effective CTV advertising plan, Digital Remedy recommends addressing the following key components:

1. Business Objectives & KPIs
   - Brand, DR or hybrid goal (e.g., incremental reach vs. site visits)
   - North-star KPI(s) with baseline and stretch targets (CPM, VCR, cost-per-completed-view, incremental reach, ROAS, foot-traffic lift, etc.)
   - Learning agenda: tests you must run and the decision they will inform
   - Digital Remedy has a proprietary pixel that can custom attributes like checkout amount and match it back to the user who viewed the ad for advanced attribution.

2. Audience & Data Strategy
   - IMPORTANT: Use the audience segments identified in the Target Audience Analysis (Step 3) of the research process
   - Recommend specific audience segments from the earlier analysis that would be most effective for CTV campaigns
   - For each recommended segment, explain why it's suitable for CTV advertising
   - Identity framework for addressability (UID2, PPID, hashed e-mail, clean-room partner)
   - Data onboarding & privacy controls (GDPR/CCPA consent strings, IAB TCF v2.2)

3. Inventory & Supply Path
   - IMPORTANT: Select specific premium publishers from Digital Remedy's inventory based on price and scalability
   - Recommend a specific allocation across streaming services, networks, and devices
   - Consider the following publisher information when making recommendations:

   Streaming Services:
   - High Scalability (5): Hulu ($$), Pluto ($)
   - Strong Scalability (4): Tubi ($$$), Sling ($$), DirecTV Stream ($)
   - Moderate Scalability (3): Peacock ($$$$$), Xumo ($$$)
   - Limited Scalability (2): Philo ($), Plex ($$), Fubo ($)
   - Niche Scalability (1): Crackle ($$), Max ($$$$$)

   Networks:
   - Strong Scalability (4): Disney ($$), Paramount ($$$$$)
   - Moderate Scalability (3): Scripps Networks ($$$$)
   - Limited Scalability (2): ESPN ($$), Discovery+ ($$$$$), Fuse ($$$$), Outside TV ($$$$)
   - Specialized Reach (1): ABC ($$$), AMC ($$), Bloomberg ($$$), CBS ($$$), Cheddar ($$$$$), CNN ($$$$$), CNBC ($$$$$), Discovery ($$$), Fox ($$$), FX ($$$$$), Hallmark ($$$$$), NBC ($$$$), NFL ($$$$), Science Channel ($$$$), Travel Channel ($$$)

   Device Platforms:
   - All with Excellent Scalability (5): Roku ($), Samsung ($$), LG ($$), Vizio ($)

   - Provide a percentage allocation across these publishers based on the company's target audience and budget considerations
   - Explain the rationale for the recommended allocation

4. Budget, Flighting & Pacing
   - Total budget & share-of-marketing-wallet
   - Flight dates, day-parting, holiday/event bursts
   - Pacing model and bid ceilings per inventory tier

5. Creative & Messaging
   - Asset map: 6-, 15-, 30-, 60-sec, interactive / shoppable, QR codes, dynamic creative variants
   - Technical specs (VAST 4.x tags, mezzanine & ready-to-serve files, 4K/HDR, closed captions)
   - Audio loudness (-24 LUFS), brand guidelines, creative testing plan

6. Targeting Rules & Frequency Management
   - Household vs. individual reach strategy; frequency-cap thresholds across devices
   - Geo, contextual, content-network/channel fields (enabled by ORTB 2.6)
   - Exclusion & competitive-separation logic

7. Measurement & Attribution Framework
   - Viewability & completion rate (OM SDK, IAS/Moat)
   - Reach & frequency dedup (Nielsen ONE, iSpot, Comscore)
   - Incrementality: baseline-holdout or geo-split lift tests
   - Outcome attribution: S2S conversions, pixel / SDK events, retail / foot-traffic studies
   - Reporting cadence and stakeholder dashboards adsmanager.paramount.com

8. Optimization Playbook
   - Mid-flight levers: bid shading, CPM floors, audience/creative reallocations
   - Creative rotation & fatigue checks
   - Monitoring and adjustments for pacing or KPI drift

9. Brand Safety, Suitability & Fraud Controls
   - Monitoring by MOAT and Protected Media
   - Pre-bid IVT filters, ads.cert signatures, OM SDK content-URL signals
   - Post-bid monitoring

Digital Remedy's Performance CTV solution provides end-to-end campaign management with premium OTT inventory and real-time analytics, allowing for comprehensive implementation of this framework. Our access to over 50 premium OTT publishers across streaming services, networks, and device platforms enables precise targeting and maximum reach for your CTV campaigns.
`;
}

// Full context for final report
export function getFullContext() {
  return `
${companyOverview}

Digital Remedy offers three main solution categories:

1. Performance TV: Use traditional linear TV, CTV, YouTubeTV, and more to create personalized, engaging media that captures your audience and desired outcomes at scale.

2. Performance Action: Drive the actions your business needs most, such as online sales, ad clicks, content downloads, and foot traffic, with customized channel strategies.

3. Performance Brand: Build your brand, change customer perception, and reach the right audience with the right message to exceed campaign goals.

Key capabilities include:
- Premium OTT Inventory: Access to over 50 premium OTT publishers
- Linear TV Buying: Strategic planning for national and local TV buys
- Predictive Prospecting: AI/ML analytics to predict audience intent
- Dynamic Creative Optimization: Real-time creative customization
- Contextual Targeting: Placing ads in relevant content environments
- Brand Lift Measurement: Survey-based measurement of campaign impact
- Incrementality Measurement: Isolating the impact of media channels
- Attribution Methodologies: Understanding true marketing impact
- Halo Effect: Linking CTV spend to multi-channel performance
- Digital Out-of-Home (DOOH): Enhancing advertising reach in public spaces
- Interactive Ads: Enhancing user engagement through interactive formats
- Shoppable Creative: Creating ads that allow direct purchasing
- Social Boost: Amplifying social media presence and performance

Premium CTV Publishers:
Digital Remedy provides access to a wide range of premium CTV publishers across three categories:

1. Streaming Services: Including high-scalability platforms like Hulu ($$, scalability: 5), Pluto ($, scalability: 5), Tubi ($$$, scalability: 4), and Sling ($$, scalability: 4).

2. Networks: Including major networks like Disney ($$, scalability: 4), Paramount ($$$$$, scalability: 4), and Scripps Networks ($$$$, scalability: 3), as well as specialized networks like ESPN, Discovery+, and many more.

3. Devices: Including highly scalable platforms like Roku ($, scalability: 5), Samsung ($$, scalability: 5), LG ($$, scalability: 5), and Vizio ($, scalability: 5).

This diverse publisher network allows for precise targeting and maximum reach across various audience segments.
`;
}
