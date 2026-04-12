// ============================================================
// Airsona — Location Recommendation Engine: Core Types
// ============================================================

export interface GeoCoordinates {
  lat: number;
  lon: number;
}

export interface LocationInput {
  city?: string;
  coordinates?: GeoCoordinates;
}

// ── Raw Data Layers ──────────────────────────────────────────

export interface ClimateData {
  solarRadiation: number;        // kWh/m²/day (annual avg)
  windSpeedAvg: number;          // m/s
  windSpeedSeasonal: {           // m/s per season
    spring: number; summer: number; autumn: number; winter: number;
  };
  temperatureAvg: number;        // °C annual avg
  temperatureRange: { min: number; max: number };
  humidity: number;              // % relative humidity annual avg
  rainfallAnnual: number;        // mm/year
  rainfallMonthly: number[];     // mm, 12 months
  sunshineHours: number;         // annual hours of sunshine
  uvIndex: number;               // annual avg UV index
  source: string;
}

export interface GeographicData {
  urbanClassification: "urban" | "peri-urban" | "rural";
  urbanDensityScore: number;     // 0–100
  elevation: number;             // meters
  terrain: "flat" | "hilly" | "mountainous" | "coastal";
  landAreaKm2: number;
  greenCoverPct: number;         // % tree/green cover
  waterBodiesNearby: boolean;
  distanceToWaterKm: number;
  coastlineProximity: boolean;
  source: string;
}

export interface PollutionData {
  aqi: number;
  aqiCategory: string;
  no2: number;                   // µg/m³
  co2: number;                   // ppm (local estimate)
  pm25: number;                  // µg/m³
  pm10: number;                  // µg/m³
  o3: number;                    // µg/m³
  primarySources: string[];      // e.g. ["traffic", "industry", "agriculture"]
  pollutionTrend: "improving" | "worsening" | "stable";
  source: string;
}

export interface InfrastructureData {
  buildingDensityScore: number;  // 0–100
  estimatedRooftopAreaPct: number; // % of urban area with usable rooftop
  trafficDensityScore: number;   // 0–100
  industrialZonesPct: number;    // % of area classified as industrial
  publicTransportScore: number;  // 0–100 (existing quality)
  evChargingStations: number;    // per 100k population
  organicWasteKgPerCapita: number; // kg/year
  source: string;
}

export interface PolicyData {
  renewableSubsidyAvailable: boolean;
  solarFeedInTariff: boolean;
  carbonTaxInEffect: boolean;
  evIncentives: boolean;
  greenBuildingCode: boolean;
  policyStrengthScore: number;   // 0–100 composite
  notes: string;
  source: string;
}

// ── Aggregated Environmental Profile ────────────────────────

export interface EnvironmentalProfile {
  location: {
    city: string;
    country: string;
    coordinates: GeoCoordinates;
    timezone: string;
  };
  climate: ClimateData;
  geography: GeographicData;
  pollution: PollutionData;
  infrastructure: InfrastructureData;
  policy: PolicyData;
  fetchedAt: string;
}

// ── Scoring Engine Output ────────────────────────────────────

export type SolutionType =
  | "Solar Energy"
  | "Wind Energy"
  | "Biogas"
  | "Micro-Hydro"
  | "Rainwater Harvesting"
  | "Green Roofs"
  | "EV Adoption"
  | "Waste Segregation"
  | "Urban Cooling"
  | "Public Transport Optimization";

export type DifficultyLevel = "Low" | "Medium" | "High" | "Very High";

export interface SolutionScore {
  solution: SolutionType;
  category: "renewable_energy" | "environmental_action";
  score: number;                  // 0–100
  confidence: number;             // 0–100 (data quality)
  subscores: Record<string, number>; // contributing factor scores
  rank: number;
  reason: string;
  estimatedImpact: string;
  implementationDifficulty: DifficultyLevel;
  timeToImpact: string;           // "3–6 months", "1–2 years" etc.
  costEstimate: string;           // USD range
  cobenefits: string[];
  barriers: string[];
  quickWin: boolean;
}

export interface WhatIfScenario {
  scenario: string;
  assumption: string;
  projectedAQIChange: number;     // % improvement (negative = worse)
  projectedCO2ReductionTons: number;
  projectedEnergyMWh: number;
  projectedJobs: number;
  confidence: string;
}

export interface Insight {
  type: "comparison" | "opportunity" | "barrier" | "synergy" | "warning";
  title: string;
  body: string;
  supporting_data: string;
  priority: "high" | "medium" | "low";
}

// ── Final Engine Response ────────────────────────────────────

export interface RecommendationEngineResponse {
  location: EnvironmentalProfile["location"];
  profile_summary: {
    solar_potential: "low" | "moderate" | "high" | "excellent";
    wind_potential: "low" | "moderate" | "high" | "excellent";
    pollution_severity: "good" | "moderate" | "poor" | "hazardous";
    urbanization: string;
    overall_environmental_risk: number; // 0–100
  };
  topRecommendations: SolutionScore[];
  comparisonMatrix: Array<{ solution: SolutionType; score: number; category: string }>;
  whatIfScenarios: WhatIfScenario[];
  insights: Insight[];
  dataQuality: {
    overall: number;    // 0–100
    climate: number;
    geography: number;
    pollution: number;
    infrastructure: number;
  };
  generatedAt: string;
}
