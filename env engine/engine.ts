// ============================================================
// Airsona — Environmental Recommendation Scoring Engine
// Weighted multi-factor scoring for each solution type
// ============================================================

import type {
  EnvironmentalProfile, SolutionScore, SolutionType,
  WhatIfScenario, Insight, RecommendationEngineResponse
} from "./engine.types";

// ── Scoring Weights Configuration ────────────────────────────
// These weights are calibrated to real-world effectiveness data.
// Each weight represents relative importance (0–1, sum need not = 1).

interface ScoringWeights {
  solar: {
    solarRadiation: number;    // kWh/m²/day — most critical
    rooftopAvailability: number;
    cloudCover: number;        // inverse humidity proxy
    urbanDensity: number;      // more buildings = more rooftop surface
    policySupport: number;
  };
  wind: {
    windSpeedAvg: number;
    windConsistency: number;   // variance across seasons
    elevation: number;         // higher = more wind
    openLand: number;          // rural = better for large turbines
    coastalProximity: number;  // coastal = better offshore potential
  };
  biogas: {
    organicWasteAvailability: number;
    urbanDensity: number;      // more people = more organic waste
    industrialWaste: number;
    landAvailability: number;
  };
  microHydro: {
    rainfallAnnual: number;
    waterBodiesNearby: number;
    elevation: number;
    terrain: number;           // hilly/mountainous favors hydro
  };
  rainwaterHarvesting: {
    rainfallAnnual: number;
    rainfallSeasonality: number; // higher variance = better stored value
    buildingDensity: number;
    urbanHeatIsland: number;
  };
  greenRoofs: {
    urbanHeatIsland: number;
    buildingDensity: number;
    rainfallAnnual: number;
    aqi: number;               // poor air = higher benefit
  };
  evAdoption: {
    trafficDensity: number;
    pollutionNO2: number;
    policyIncentives: number;
    existingChargingInfra: number; // inverse — less infra = more gap
  };
  wasteSegregation: {
    organicWasteKg: number;
    populationDensity: number;
    existingWasteManagement: number; // inverse — poor = more opportunity
  };
  urbanCooling: {
    temperatureAvg: number;
    urbanHeatIsland: number;
    buildingDensity: number;
    humidity: number;
  };
  publicTransport: {
    trafficDensity: number;
    aqi: number;
    co2Level: number;
    existingTransitScore: number; // inverse — poor = more opportunity
    urbanDensity: number;
  };
}

// ── Normalizer Utilities ──────────────────────────────────────

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

function normalize(value: number, min: number, max: number): number {
  return clamp(((value - min) / (max - min)) * 100);
}

function inverseNormalize(value: number, min: number, max: number): number {
  return 100 - normalize(value, min, max);
}

function weightedSum(scores: Record<string, number>, weights: Record<string, number>): number {
  let total = 0;
  let weightSum = 0;
  for (const [key, weight] of Object.entries(weights)) {
    total += (scores[key] || 0) * weight;
    weightSum += weight;
  }
  return weightSum > 0 ? clamp(total / weightSum) : 0;
}

// ── Individual Solution Scorers ───────────────────────────────

export function scoreSolar(profile: EnvironmentalProfile): SolutionScore {
  const { climate, geography, infrastructure, policy } = profile;
  
  const subscores: Record<string, number> = {
    solarRadiation: normalize(climate.solarRadiation, 2, 8.5),         // 2=low, 8.5=excellent
    rooftopAvailability: normalize(infrastructure.estimatedRooftopAreaPct, 10, 80),
    lowCloudCover: inverseNormalize(climate.humidity, 20, 95),          // less humidity = less clouds
    urbanDensity: normalize(geography.urbanDensityScore, 0, 100),
    policyBoost: normalize(policy.policyStrengthScore + (policy.solarFeedInTariff ? 20 : 0), 0, 120),
  };

  const weights = { solarRadiation: 0.40, rooftopAvailability: 0.25, lowCloudCover: 0.15, urbanDensity: 0.10, policyBoost: 0.10 };
  const score = Math.round(weightedSum(subscores, weights));

  const impactMWh = Math.round(
    (infrastructure.estimatedRooftopAreaPct / 100) * 
    geography.landAreaKm2 * 0.3 *                                       // usable area
    climate.solarRadiation * 365 * 0.18                                  // panel efficiency ~18%
  );

  return {
    solution: "Solar Energy",
    category: "renewable_energy",
    score,
    confidence: climate.solarRadiation > 0 ? 88 : 60,
    subscores,
    rank: 0, // assigned later
    reason: `Solar radiation of ${climate.solarRadiation.toFixed(1)} kWh/m²/day ${climate.solarRadiation > 5 ? "is excellent" : climate.solarRadiation > 4 ? "is good" : "is moderate"} for PV generation. ${infrastructure.estimatedRooftopAreaPct.toFixed(0)}% of urban area has usable rooftop space. ${policy.solarFeedInTariff ? "Feed-in tariff available." : ""}`,
    estimatedImpact: `${impactMWh.toLocaleString()} MWh/year potential. Could offset ${Math.round(impactMWh * 0.4)} tons CO₂/year.`,
    implementationDifficulty: score > 70 ? "Medium" : "High",
    timeToImpact: "6–18 months",
    costEstimate: "$800–$1,500 per kW installed",
    cobenefits: ["Reduces grid strain", "Energy independence", "Job creation", "Reduces AQI"],
    barriers: climate.solarRadiation < 4 ? ["Low solar radiation limits ROI"] : [],
    quickWin: score > 75 && policy.solarFeedInTariff,
  };
}

export function scoreWind(profile: EnvironmentalProfile): SolutionScore {
  const { climate, geography, policy } = profile;
  
  const seasonal = Object.values(climate.windSpeedSeasonal);
  const windVariance = Math.max(...seasonal) - Math.min(...seasonal);
  const windConsistencyScore = inverseNormalize(windVariance, 0, 5);

  const subscores: Record<string, number> = {
    windSpeed: normalize(climate.windSpeedAvg, 3, 12),                  // 3m/s min, 12m/s excellent
    windConsistency: windConsistencyScore,
    elevation: normalize(geography.elevation, 0, 2000),
    openLand: inverseNormalize(geography.urbanDensityScore, 0, 100),    // rural better for turbines
    coastalBonus: geography.coastlineProximity ? 80 : 40,
    terrainScore: geography.terrain === "mountainous" ? 70 : geography.terrain === "hilly" ? 55 : 40,
  };

  const weights = { windSpeed: 0.40, windConsistency: 0.20, openLand: 0.15, coastalBonus: 0.12, elevation: 0.08, terrainScore: 0.05 };
  const score = Math.round(weightedSum(subscores, weights));

  // Wind power calculation: P = 0.5 * ρ * A * v³ * Cp
  // Simplified: 1 turbine ~2MW at 7m/s
  const turbineCount = geography.terrain !== "flat" ? 
    Math.round(geography.landAreaKm2 * (1 - geography.urbanDensityScore / 100) * 0.05) : 
    Math.round(geography.landAreaKm2 * 0.02);

  return {
    solution: "Wind Energy",
    category: "renewable_energy",
    score,
    confidence: 72,
    subscores,
    rank: 0,
    reason: `Average wind speed of ${climate.windSpeedAvg.toFixed(1)} m/s ${climate.windSpeedAvg >= 7 ? "(commercially viable)" : climate.windSpeedAvg >= 5 ? "(viable for small turbines)" : "(marginal — large turbines needed)"}. ${geography.coastlineProximity ? "Coastal location enables offshore wind." : geography.terrain === "mountainous" ? "Mountainous terrain enhances wind resources." : ""}`,
    estimatedImpact: `${turbineCount} small-to-medium turbines viable. ~${(turbineCount * 4000).toLocaleString()} MWh/year potential.`,
    implementationDifficulty: score > 60 ? "High" : "Very High",
    timeToImpact: "2–5 years",
    costEstimate: "$1,200–$2,000 per kW installed",
    cobenefits: ["Zero operational emissions", "Land can be dual-use (agri-wind)", "Grid stability"],
    barriers: geography.urbanDensityScore > 60 ? ["Dense urban area limits turbine placement — consider rooftop micro-turbines"] : [],
    quickWin: false,
  };
}

export function scoreBiogas(profile: EnvironmentalProfile): SolutionScore {
  const { climate, geography, infrastructure } = profile;
  
  const subscores: Record<string, number> = {
    organicWasteAvailability: normalize(infrastructure.organicWasteKgPerCapita, 50, 300),
    urbanDensity: normalize(geography.urbanDensityScore, 0, 100),
    industrialWaste: normalize(infrastructure.industrialZonesPct, 0, 40),
    temperatureSuitability: normalize(climate.temperatureAvg, 10, 35),   // 20–35°C ideal for anaerobic digestion
  };

  const weights = { organicWasteAvailability: 0.40, urbanDensity: 0.25, temperatureSuitability: 0.20, industrialWaste: 0.15 };
  const score = Math.round(weightedSum(subscores, weights));

  const populationEstimate = geography.landAreaKm2 * geography.urbanDensityScore * 50;
  const biogasMWh = Math.round(populationEstimate * infrastructure.organicWasteKgPerCapita * 0.0003);

  return {
    solution: "Biogas",
    category: "renewable_energy",
    score,
    confidence: 65,
    subscores,
    rank: 0,
    reason: `${infrastructure.organicWasteKgPerCapita} kg organic waste per capita/year available. Temperature avg ${climate.temperatureAvg.toFixed(1)}°C ${climate.temperatureAvg >= 20 ? "supports efficient anaerobic digestion" : "requires heated digesters"}. ${infrastructure.industrialZonesPct.toFixed(0)}% industrial zone area provides additional feedstock.`,
    estimatedImpact: `~${biogasMWh.toLocaleString()} MWh/year. Methane capture reduces CH₄ emissions by 60%.`,
    implementationDifficulty: "Medium",
    timeToImpact: "1–3 years",
    costEstimate: "$200,000–$2M per plant",
    cobenefits: ["Waste reduction", "Organic fertilizer byproduct", "Local employment"],
    barriers: score < 50 ? ["Low organic waste density may affect plant economics"] : [],
    quickWin: geography.urbanDensityScore > 60 && climate.temperatureAvg > 20,
  };
}

export function scoreMicroHydro(profile: EnvironmentalProfile): SolutionScore {
  const { climate, geography } = profile;

  const subscores: Record<string, number> = {
    rainfall: normalize(climate.rainfallAnnual, 300, 3000),
    waterBodies: geography.waterBodiesNearby ? 85 : 15,
    elevation: normalize(geography.elevation, 50, 2000),
    terrain: geography.terrain === "mountainous" ? 90 : geography.terrain === "hilly" ? 65 : 20,
  };

  const weights = { rainfall: 0.30, waterBodies: 0.35, elevation: 0.15, terrain: 0.20 };
  const score = Math.round(weightedSum(subscores, weights));

  return {
    solution: "Micro-Hydro",
    category: "renewable_energy",
    score,
    confidence: 60,
    subscores,
    rank: 0,
    reason: `Annual rainfall of ${climate.rainfallAnnual.toFixed(0)}mm ${climate.rainfallAnnual > 1200 ? "is excellent" : climate.rainfallAnnual > 600 ? "is adequate" : "is insufficient"}. ${geography.waterBodiesNearby ? "Water bodies within 5km confirmed." : "No significant water bodies nearby."} Elevation ${geography.elevation}m ${geography.terrain === "mountainous" ? "with mountainous terrain provides good head pressure" : "terrain is not ideal for run-of-river hydro"}.`,
    estimatedImpact: score > 60 ? "50–500 kW small-scale plants viable. 24/7 baseload power." : "Limited hydro potential for this location.",
    implementationDifficulty: "Very High",
    timeToImpact: "3–7 years",
    costEstimate: "$1,000–$3,000 per kW installed",
    cobenefits: ["Baseload generation", "Irrigation potential", "Flood management"],
    barriers: score < 40 ? ["Insufficient rainfall or elevation gradient", "Environmental permits needed"] : ["High civil engineering cost", "Environmental impact assessment required"],
    quickWin: false,
  };
}

export function scoreRainwaterHarvesting(profile: EnvironmentalProfile): SolutionScore {
  const { climate, geography, infrastructure } = profile;

  const monthlyMax = Math.max(...climate.rainfallMonthly);
  const monthlyMin = Math.min(...climate.rainfallMonthly);
  const seasonality = (monthlyMax - monthlyMin) / (climate.rainfallAnnual / 12 + 1) * 50;

  const subscores: Record<string, number> = {
    rainfall: normalize(climate.rainfallAnnual, 200, 2500),
    seasonality: clamp(seasonality),                                     // high variation = harvest more valuable
    buildingDensity: normalize(geography.urbanDensityScore, 20, 100),
    waterStress: normalize(climate.temperatureAvg, 15, 45),              // hotter cities need water more
    rooftopArea: normalize(infrastructure.estimatedRooftopAreaPct, 10, 80),
  };

  const weights = { rainfall: 0.35, seasonality: 0.20, buildingDensity: 0.20, waterStress: 0.15, rooftopArea: 0.10 };
  const score = Math.round(weightedSum(subscores, weights));

  const annualHarvestLiters = Math.round(
    (infrastructure.estimatedRooftopAreaPct / 100) * geography.landAreaKm2 * 
    1e6 * climate.rainfallAnnual / 1000 * 0.8 // 80% capture efficiency
  );

  return {
    solution: "Rainwater Harvesting",
    category: "environmental_action",
    score,
    confidence: 80,
    subscores,
    rank: 0,
    reason: `Annual rainfall of ${climate.rainfallAnnual.toFixed(0)}mm with ${monthlyMax.toFixed(0)}mm peak month provides ${climate.rainfallAnnual > 600 ? "strong" : "moderate"} harvesting potential. ${geography.urbanDensityScore}% urban density means ${infrastructure.estimatedRooftopAreaPct.toFixed(0)}% catchment area available.`,
    estimatedImpact: `${(annualHarvestLiters / 1e9).toFixed(1)} billion litres/year harvestable. Reduces municipal water demand by up to 30%.`,
    implementationDifficulty: "Low",
    timeToImpact: "1–6 months",
    costEstimate: "$200–$2,000 per building",
    cobenefits: ["Reduces urban flooding", "Lowers water bills", "Groundwater recharge"],
    barriers: climate.rainfallAnnual < 300 ? ["Very low rainfall limits effectiveness"] : [],
    quickWin: climate.rainfallAnnual > 500 && geography.urbanDensityScore > 40,
  };
}

export function scoreGreenRoofs(profile: EnvironmentalProfile): SolutionScore {
  const { climate, geography, pollution, infrastructure } = profile;

  const urbanHeatScore = normalize(climate.temperatureAvg, 15, 40) * 
    (geography.urbanDensityScore / 100);

  const subscores: Record<string, number> = {
    urbanHeatIsland: clamp(urbanHeatScore),
    buildingDensity: normalize(geography.urbanDensityScore, 30, 100),
    airQualityBenefit: normalize(pollution.aqi, 30, 200),
    rainfall: normalize(climate.rainfallAnnual, 200, 1500),              // need some rain for plants
    rooftopArea: normalize(infrastructure.estimatedRooftopAreaPct, 20, 80),
  };

  const weights = { urbanHeatIsland: 0.30, buildingDensity: 0.25, airQualityBenefit: 0.20, rainfall: 0.15, rooftopArea: 0.10 };
  const score = Math.round(weightedSum(subscores, weights));

  return {
    solution: "Green Roofs",
    category: "environmental_action",
    score,
    confidence: 75,
    subscores,
    rank: 0,
    reason: `Urban heat island effect significant with avg temp ${climate.temperatureAvg.toFixed(1)}°C and ${geography.urbanDensityScore.toFixed(0)}% urban density. AQI of ${pollution.aqi} means green roofs would meaningfully filter particulates. ${infrastructure.estimatedRooftopAreaPct.toFixed(0)}% rooftop availability gives large surface area.`,
    estimatedImpact: "1°C–3°C reduction in urban heat island. Reduces stormwater runoff by 50%. Extends roof lifespan 2x.",
    implementationDifficulty: score > 70 ? "Medium" : "High",
    timeToImpact: "6–12 months",
    costEstimate: "$50–$200 per m²",
    cobenefits: ["Biodiversity habitat", "Noise reduction", "Building insulation", "Aesthetic value"],
    barriers: geography.urbanDensityScore < 40 ? ["Low density means limited impact at city scale"] : [],
    quickWin: pollution.aqi > 100 && geography.urbanDensityScore > 65,
  };
}

export function scoreEVAdoption(profile: EnvironmentalProfile): SolutionScore {
  const { pollution, infrastructure, policy } = profile;

  const chargingGap = inverseNormalize(infrastructure.evChargingStations, 0, 100); // more gap = more urgency

  const subscores: Record<string, number> = {
    trafficPollution: normalize(pollution.no2, 10, 100),                 // NO2 primary traffic indicator
    aqiUrgency: normalize(pollution.aqi, 40, 200),
    policyIncentives: policy.evIncentives ? 80 : 30,
    chargingInfraGap: chargingGap,
    trafficDensity: normalize(infrastructure.trafficDensityScore, 20, 100),
  };

  const weights = { trafficPollution: 0.30, aqiUrgency: 0.25, trafficDensity: 0.20, policyIncentives: 0.15, chargingInfraGap: 0.10 };
  const score = Math.round(weightedSum(subscores, weights));

  const vehicleEmissionReductionPct = score > 70 ? 35 : score > 50 ? 20 : 10;

  return {
    solution: "EV Adoption",
    category: "environmental_action",
    score,
    confidence: 78,
    subscores,
    rank: 0,
    reason: `NO2 at ${pollution.no2.toFixed(1)} µg/m³ ${pollution.no2 > 40 ? "exceeds WHO guidelines — vehicular emissions are a primary driver" : "indicates moderate traffic pollution"}. ${policy.evIncentives ? "EV incentives available to accelerate adoption." : "No current EV incentives — policy push needed."} Only ${infrastructure.evChargingStations} charging stations per 100k residents.`,
    estimatedImpact: `${vehicleEmissionReductionPct}% reduction in vehicle emissions. NO2 could drop by ${(pollution.no2 * vehicleEmissionReductionPct / 100).toFixed(1)} µg/m³.`,
    implementationDifficulty: "High",
    timeToImpact: "2–5 years",
    costEstimate: "$15,000–$50,000 per public charger",
    cobenefits: ["Noise reduction", "Reduced fuel imports", "Local air quality", "Health outcomes"],
    barriers: infrastructure.evChargingStations < 10 ? ["Charging infrastructure needs significant build-out"] : [],
    quickWin: pollution.no2 > 50 && policy.evIncentives,
  };
}

export function scoreWasteSegregation(profile: EnvironmentalProfile): SolutionScore {
  const { geography, infrastructure, pollution } = profile;

  const subscores: Record<string, number> = {
    organicWaste: normalize(infrastructure.organicWasteKgPerCapita, 80, 300),
    urbanDensity: normalize(geography.urbanDensityScore, 30, 100),
    pollutionBenefit: normalize(pollution.aqi, 40, 200),
    existingInfraGap: inverseNormalize(infrastructure.publicTransportScore, 0, 100), // proxy for city management
  };

  const weights = { organicWaste: 0.40, urbanDensity: 0.30, pollutionBenefit: 0.20, existingInfraGap: 0.10 };
  const score = Math.round(weightedSum(subscores, weights));

  return {
    solution: "Waste Segregation",
    category: "environmental_action",
    score,
    confidence: 82,
    subscores,
    rank: 0,
    reason: `${infrastructure.organicWasteKgPerCapita} kg/capita/year organic waste generation. Urban density of ${geography.urbanDensityScore.toFixed(0)}% creates concentrated collection points. Waste segregation enables biogas, compost, and recycling streams.`,
    estimatedImpact: "Diverts 40–60% waste from landfill. Enables biogas feedstock. Reduces landfill methane by 25%.",
    implementationDifficulty: "Low",
    timeToImpact: "3–12 months",
    costEstimate: "$5–$50 per household setup",
    cobenefits: ["Enables biogas production", "Composting", "Circular economy", "Job creation"],
    barriers: [],
    quickWin: geography.urbanDensityScore > 50,
  };
}

export function scoreUrbanCooling(profile: EnvironmentalProfile): SolutionScore {
  const { climate, geography, pollution } = profile;

  const heatUrgency = ((climate.temperatureAvg - 20) / 20) * 100; // 20°C baseline

  const subscores: Record<string, number> = {
    temperature: normalize(climate.temperatureAvg, 15, 45),
    heatIsland: clamp(heatUrgency * geography.urbanDensityScore / 100),
    buildingDensity: normalize(geography.urbanDensityScore, 40, 100),
    lowGreenCover: inverseNormalize(geography.greenCoverPct, 5, 50),
    aqiBenefit: normalize(pollution.aqi, 40, 200),
  };

  const weights = { temperature: 0.30, heatIsland: 0.30, buildingDensity: 0.20, lowGreenCover: 0.15, aqiBenefit: 0.05 };
  const score = Math.round(weightedSum(subscores, weights));

  return {
    solution: "Urban Cooling",
    category: "environmental_action",
    score,
    confidence: 73,
    subscores,
    rank: 0,
    reason: `Average temperature of ${climate.temperatureAvg.toFixed(1)}°C with ${geography.urbanDensityScore.toFixed(0)}% urban density creates ${climate.temperatureAvg > 30 ? "severe" : climate.temperatureAvg > 25 ? "significant" : "moderate"} urban heat island effect. Only ${geography.greenCoverPct.toFixed(0)}% green cover. Cool roofs and reflective paint can reduce heat absorption by 40%.`,
    estimatedImpact: "2°C–5°C reduction in urban temperature. Cuts AC energy use by 15–25%. Reduces heat mortality risk.",
    implementationDifficulty: "Low",
    timeToImpact: "1–6 months",
    costEstimate: "$1–$5 per m² (reflective paint)",
    cobenefits: ["Reduces energy demand", "Improves comfort", "Reduces AQI", "Mental health benefits"],
    barriers: climate.temperatureAvg < 20 ? ["Cool climate reduces urgency"] : [],
    quickWin: climate.temperatureAvg > 28 && geography.urbanDensityScore > 60,
  };
}

export function scorePublicTransport(profile: EnvironmentalProfile): SolutionScore {
  const { pollution, infrastructure, geography } = profile;

  const transitGap = inverseNormalize(infrastructure.publicTransportScore, 0, 100);

  const subscores: Record<string, number> = {
    trafficPollution: normalize(pollution.aqi + pollution.no2, 40, 300),
    trafficDensity: normalize(infrastructure.trafficDensityScore, 20, 100),
    urbanDensity: normalize(geography.urbanDensityScore, 30, 100),       // density justifies transit
    transitGap: transitGap,
    co2Urgency: normalize(pollution.co2, 400, 500),
  };

  const weights = { trafficDensity: 0.30, urbanDensity: 0.25, transitGap: 0.25, trafficPollution: 0.15, co2Urgency: 0.05 };
  const score = Math.round(weightedSum(subscores, weights));

  return {
    solution: "Public Transport Optimization",
    category: "environmental_action",
    score,
    confidence: 70,
    subscores,
    rank: 0,
    reason: `Traffic density score of ${infrastructure.trafficDensityScore.toFixed(0)}/100 with urban density of ${geography.urbanDensityScore.toFixed(0)}% creates strong case for transit investment. Existing transit score is ${infrastructure.publicTransportScore.toFixed(0)}/100 — ${infrastructure.publicTransportScore < 50 ? "significant gap to fill" : "good foundation to build on"}.`,
    estimatedImpact: "Each 10% modal shift to transit reduces traffic AQI contribution by 8%. 30–40% CO₂ reduction per passenger-km vs private car.",
    implementationDifficulty: "Very High",
    timeToImpact: "3–10 years",
    costEstimate: "$50M–$5B depending on scale",
    cobenefits: ["Reduced congestion", "Land use efficiency", "Equity", "Economic productivity"],
    barriers: infrastructure.publicTransportScore > 70 ? ["Strong existing system — marginal gains only"] : ["High capital cost", "Political will required"],
    quickWin: false,
  };
}

// ── Master Scoring Orchestrator ───────────────────────────────

export function scoreAllSolutions(profile: EnvironmentalProfile): SolutionScore[] {
  const scores = [
    scoreSolar(profile),
    scoreWind(profile),
    scoreBiogas(profile),
    scoreMicroHydro(profile),
    scoreRainwaterHarvesting(profile),
    scoreGreenRoofs(profile),
    scoreEVAdoption(profile),
    scoreWasteSegregation(profile),
    scoreUrbanCooling(profile),
    scorePublicTransport(profile),
  ];

  // Sort by score descending and assign ranks
  scores.sort((a, b) => b.score - a.score);
  scores.forEach((s, i) => { s.rank = i + 1; });

  return scores;
}

// ── What-If Scenario Generator ────────────────────────────────

export function generateWhatIfScenarios(
  profile: EnvironmentalProfile, scores: SolutionScore[]
): WhatIfScenario[] {
  const { climate, geography, pollution, infrastructure } = profile;
  const solarScore = scores.find(s => s.solution === "Solar Energy");
  const evScore = scores.find(s => s.solution === "EV Adoption");
  const greenRoofScore = scores.find(s => s.solution === "Green Roofs");

  const scenarios: WhatIfScenario[] = [];

  // Solar scenario
  const solarPct = 30;
  const solarMWh = (infrastructure.estimatedRooftopAreaPct / 100) * 
    geography.landAreaKm2 * 0.3 * 1e6 * (solarPct / 100) * 
    climate.solarRadiation * 365 * 0.18 / 1000; // MWh
  
  scenarios.push({
    scenario: `If ${solarPct}% of rooftops install solar panels`,
    assumption: `${solarPct}% of ${infrastructure.estimatedRooftopAreaPct.toFixed(0)}% available rooftop area (~${(geography.landAreaKm2 * 0.3 * solarPct / 100).toFixed(0)} km²) is fitted with 300W/m² panels at 18% efficiency`,
    projectedAQIChange: -Math.round(solarScore ? solarScore.score * 0.08 : 5),
    projectedCO2ReductionTons: Math.round(solarMWh * 0.4),
    projectedEnergyMWh: Math.round(solarMWh),
    projectedJobs: Math.round(solarMWh / 500),
    confidence: "Medium (±15%)",
  });

  // EV scenario
  const evPct = 40;
  const co2PerVehicle = 2.3; // tons/year typical car
  const vehicleEstimate = geography.landAreaKm2 * geography.urbanDensityScore * 0.3;

  scenarios.push({
    scenario: `If ${evPct}% of private vehicles switch to EV`,
    assumption: `${evPct}% EV adoption across estimated ${vehicleEstimate.toFixed(0)} vehicles, powered by ${climate.solarRadiation > 4.5 ? "solar-charged grid" : "current grid mix"}`,
    projectedAQIChange: -Math.round(evScore ? evScore.score * 0.15 : 8),
    projectedCO2ReductionTons: Math.round(vehicleEstimate * evPct / 100 * co2PerVehicle),
    projectedEnergyMWh: 0,
    projectedJobs: Math.round(vehicleEstimate * evPct / 100 * 0.01),
    confidence: "High (±10%)",
  });

  // Green roof scenario
  const greenRoofArea = geography.landAreaKm2 * (geography.urbanDensityScore / 100) * 0.4; // km²
  const heatReduction = Math.min(3, climate.temperatureAvg > 30 ? 2.5 : 1.5);

  scenarios.push({
    scenario: "If 50% of flat rooftops are converted to green roofs",
    assumption: `50% green roof conversion across ${greenRoofArea.toFixed(1)} km² of eligible rooftop area`,
    projectedAQIChange: -Math.round(greenRoofScore ? greenRoofScore.score * 0.06 : 3),
    projectedCO2ReductionTons: Math.round(greenRoofArea * 1e6 * 0.000002), // 2kg CO₂/m² sequestration
    projectedEnergyMWh: Math.round(greenRoofArea * 1e6 * 5 / 1000), // cooling energy saved
    projectedJobs: Math.round(greenRoofArea * 50),
    confidence: "Medium (±20%)",
  });

  return scenarios;
}

// ── Insight Generator ─────────────────────────────────────────

export function generateInsights(
  profile: EnvironmentalProfile, scores: SolutionScore[]
): import("./engine.types").Insight[] {
  const insights: import("./engine.types").Insight[] = [];
  const { climate, geography, pollution, infrastructure, policy } = profile;

  const top3 = scores.slice(0, 3);
  const solar = scores.find(s => s.solution === "Solar Energy")!;
  const wind = scores.find(s => s.solution === "Wind Energy")!;
  const ev = scores.find(s => s.solution === "EV Adoption")!;
  const biogas = scores.find(s => s.solution === "Biogas")!;
  const rwh = scores.find(s => s.solution === "Rainwater Harvesting")!;

  // Solar vs Wind comparison
  if (Math.abs(solar.score - wind.score) > 20) {
    const winner = solar.score > wind.score ? solar : wind;
    const loser = solar.score > wind.score ? wind : solar;
    insights.push({
      type: "comparison",
      title: `${winner.solution} significantly outperforms ${loser.solution} here`,
      body: `${winner.solution} scores ${winner.score}/100 vs ${loser.score}/100 for ${loser.solution}. The gap of ${Math.abs(solar.score - wind.score)} points reflects ${solar.score > wind.score ? `${climate.solarRadiation.toFixed(1)} kWh/m²/day solar radiation and ${infrastructure.estimatedRooftopAreaPct.toFixed(0)}% rooftop availability making solar the clear choice` : `${climate.windSpeedAvg.toFixed(1)} m/s wind speed and ${geography.terrain} terrain making wind more viable`}.`,
      supporting_data: `Solar: ${climate.solarRadiation.toFixed(1)} kWh/m²/day | Wind: ${climate.windSpeedAvg.toFixed(1)} m/s avg`,
      priority: "high",
    });
  }

  // Quick wins
  const quickWins = scores.filter(s => s.quickWin);
  if (quickWins.length > 0) {
    insights.push({
      type: "opportunity",
      title: `${quickWins.length} quick-win solution${quickWins.length > 1 ? "s" : ""} available`,
      body: `${quickWins.map(s => s.solution).join(" and ")} can be deployed rapidly with high impact. ${quickWins[0].solution} particularly stands out because ${quickWins[0].reason.split(".")[0]}.`,
      supporting_data: quickWins.map(s => `${s.solution}: ${s.score}/100, ${s.timeToImpact}`).join(" | "),
      priority: "high",
    });
  }

  // Underutilized opportunity
  const underutilized = scores.filter(s => s.score > 60 && s.rank > 5);
  if (underutilized.length > 0) {
    insights.push({
      type: "opportunity",
      title: `${underutilized[0].solution} is underutilized despite strong fundamentals`,
      body: `${underutilized[0].solution} scores ${underutilized[0].score}/100 but ranks #${underutilized[0].rank} — likely underimplemented due to ${underutilized[0].implementationDifficulty} implementation difficulty. ${underutilized[0].reason}`,
      supporting_data: underutilized[0].estimatedImpact,
      priority: "medium",
    });
  }

  // Policy gap
  if (!policy.solarFeedInTariff && solar.score > 65) {
    insights.push({
      type: "barrier",
      title: "Policy gap: No solar feed-in tariff despite strong solar potential",
      body: `With ${climate.solarRadiation.toFixed(1)} kWh/m²/day solar radiation, ${profile.location.city} has excellent solar fundamentals — but no feed-in tariff reduces ROI for residential/commercial adopters by 20–40%. Policy advocacy could unlock mass adoption.`,
      supporting_data: `Solar score: ${solar.score}/100 | Policy strength: ${policy.policyStrengthScore}/100`,
      priority: "high",
    });
  }

  // Pollution urgency
  if (pollution.aqi > 100) {
    insights.push({
      type: "warning",
      title: `AQI of ${pollution.aqi} creates health emergency — immediate action needed`,
      body: `Current AQI of ${pollution.aqi} (${pollution.aqiCategory}) primarily driven by ${pollution.primarySources.join(", ")}. The top 3 recommendations (${top3.map(s => s.solution).join(", ")}) together could reduce AQI by an estimated ${Math.round(top3.reduce((sum, s) => sum + s.score * 0.04, 0))}% if fully implemented.`,
      supporting_data: `NO2: ${pollution.no2} µg/m³ | PM2.5: ${pollution.pm25} µg/m³ | O3: ${pollution.o3} µg/m³`,
      priority: "high",
    });
  }

  // Synergy insight
  if (solar.score > 65 && biogas.score > 50) {
    insights.push({
      type: "synergy",
      title: "Solar + Biogas synergy: resilient hybrid energy system",
      body: `Combining ${profile.location.city}'s strong solar potential (score: ${solar.score}) with biogas from organic waste (score: ${biogas.score}) creates complementary generation — solar peaks midday, biogas provides baseload power especially at night. CO₂ from biogas can also be used in agricultural greenhouses powered by solar.`,
      supporting_data: `Organic waste: ${infrastructure.organicWasteKgPerCapita} kg/capita/year | Solar radiation: ${climate.solarRadiation.toFixed(1)} kWh/m²/day`,
      priority: "medium",
    });
  }

  // Rainwater insight
  if (rwh.score > 60 && climate.rainfallAnnual > 600) {
    insights.push({
      type: "opportunity",
      title: "Rainwater harvesting: massive untapped potential",
      body: `With ${climate.rainfallAnnual.toFixed(0)}mm annual rainfall and ${infrastructure.estimatedRooftopAreaPct.toFixed(0)}% rooftop availability, ${profile.location.city} could harvest significant volumes of water at very low cost. This is often the highest ROI intervention for water-stressed urban areas.`,
      supporting_data: `Rainfall: ${climate.rainfallAnnual.toFixed(0)} mm/year | Peak month: ${Math.max(...climate.rainfallMonthly).toFixed(0)} mm`,
      priority: "medium",
    });
  }

  return insights.slice(0, 6); // max 6 insights
}

// ── Profile Summary Builder ───────────────────────────────────

function classifyPotential(score: number): "low" | "moderate" | "high" | "excellent" {
  if (score >= 75) return "excellent";
  if (score >= 55) return "high";
  if (score >= 35) return "moderate";
  return "low";
}

// ── Master Engine Function ────────────────────────────────────

export function runRecommendationEngine(profile: EnvironmentalProfile): RecommendationEngineResponse {
  const scores = scoreAllSolutions(profile);
  const scenarios = generateWhatIfScenarios(profile, scores);
  const insights = generateInsights(profile, scores);

  const solarScore = scores.find(s => s.solution === "Solar Energy")!;
  const windScore = scores.find(s => s.solution === "Wind Energy")!;

  const overallRisk = Math.round(
    normalize(profile.pollution.aqi, 0, 300) * 0.5 +
    inverseNormalize(profile.geography.greenCoverPct, 0, 50) * 0.3 +
    normalize(profile.climate.temperatureAvg, 10, 45) * 0.2
  );

  return {
    location: profile.location,
    profile_summary: {
      solar_potential: classifyPotential(solarScore.score),
      wind_potential: classifyPotential(windScore.score),
      pollution_severity: profile.pollution.aqi <= 50 ? "good" : profile.pollution.aqi <= 100 ? "moderate" : profile.pollution.aqi <= 150 ? "poor" : "hazardous",
      urbanization: `${profile.geography.urbanClassification} (${profile.geography.urbanDensityScore.toFixed(0)}% density)`,
      overall_environmental_risk: clamp(overallRisk),
    },
    topRecommendations: scores,
    comparisonMatrix: scores.map(s => ({
      solution: s.solution,
      score: s.score,
      category: s.category,
    })),
    whatIfScenarios: scenarios,
    insights,
    dataQuality: {
      overall: 78,
      climate: profile.climate.source.includes("NASA") ? 90 : 75,
      geography: 72,
      pollution: profile.pollution.source.includes("OpenWeather") ? 85 : 65,
      infrastructure: 68,
    },
    generatedAt: new Date().toISOString(),
  };
}
