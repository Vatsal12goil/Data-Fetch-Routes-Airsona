// ============================================================
// Airsona — Data Aggregation Service
// Multi-source environmental data fetcher with fallbacks
// APIs used: Open-Meteo (free), OpenWeatherMap, OpenAQ, 
//            Overpass/OSM, NASA POWER (solar)
// ============================================================

import type {
  GeoCoordinates, ClimateData, GeographicData,
  PollutionData, InfrastructureData, PolicyData, EnvironmentalProfile
} from "./engine.types";

// ── Geocoding ────────────────────────────────────────────────

export async function geocodeLocation(city: string): Promise<{
  coordinates: GeoCoordinates;
  city: string;
  country: string;
  timezone: string;
}> {
  // Nominatim (OpenStreetMap) — free, no key required
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1&addressdetails=1`;
  const res = await fetch(url, { headers: { "User-Agent": "Airsona/1.0 (climate@airsona.app)" } });
  const data = await res.json();

  if (!data.length) throw new Error(`Location not found: ${city}`);
  const place = data[0];

  // Get timezone via Open-Meteo
  const tzRes = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&timezone=auto&forecast_days=1&hourly=temperature_2m`
  );
  const tzData = await tzRes.json();

  return {
    coordinates: { lat: parseFloat(place.lat), lon: parseFloat(place.lon) },
    city: place.address?.city || place.address?.town || place.address?.municipality || city,
    country: place.address?.country || "Unknown",
    timezone: tzData.timezone || "UTC",
  };
}

// ── Climate Data — Open-Meteo (historical + forecast) ────────

export async function fetchClimateData(coords: GeoCoordinates): Promise<ClimateData> {
  // Open-Meteo historical climate API (free, no key)
  // Uses ERA5 reanalysis data
  const { lat, lon } = coords;
  
  // Current + recent climate
  const currentUrl = `https://api.open-meteo.com/v1/forecast?` +
    `latitude=${lat}&longitude=${lon}&` +
    `hourly=temperature_2m,relativehumidity_2m,windspeed_10m,shortwave_radiation&` +
    `daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,shortwave_radiation_sum&` +
    `past_days=30&forecast_days=7&timezone=auto`;

  const currentRes = await fetch(currentUrl);
  const currentData = await currentRes.json();

  // NASA POWER API for precise solar radiation (free)
  const nasaUrl = `https://power.larc.nasa.gov/api/temporal/climatology/point?` +
    `parameters=ALLSKY_SFC_SW_DWN,WS10M,T2M,RH2M,PRECTOTCORR&` +
    `community=RE&longitude=${lon}&latitude=${lat}&format=JSON`;

  let nasaData: any = null;
  try {
    const nasaRes = await fetch(nasaUrl);
    nasaData = await nasaRes.json();
  } catch {
    // NASA POWER can be slow — use Open-Meteo fallback
  }

  // Extract from Open-Meteo daily data
  const daily = currentData.daily || {};
  const temps = daily.temperature_2m_max || [];
  const tempsMin = daily.temperature_2m_min || [];
  const precip = daily.precipitation_sum || [];
  const wind = daily.windspeed_10m_max || [];
  const radiation = daily.shortwave_radiation_sum || [];
  
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const validFilter = (arr: number[]) => arr.filter((v): v is number => v !== null && v !== undefined);

  const avgTemp = avg(validFilter(temps));
  const avgWindSpeed = avg(validFilter(wind)) * 0.2778; // km/h → m/s
  const avgRadiation = nasaData?.properties?.parameter?.ALLSKY_SFC_SW_DWN?.ANN || 
                       avg(validFilter(radiation)) * 0.0036; // Wh → kWh

  // Monthly rainfall estimation (extrapolate from 30-day sample)
  const rainfallAnnual = avg(validFilter(precip)) * 365;
  const monthlyRainfall = Array(12).fill(0).map((_, i) => {
    // Seasonal distribution approximation
    const factor = [0.6, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3, 1.2, 1.1, 1.0, 0.8, 0.65][i];
    return Math.round((rainfallAnnual / 12) * factor);
  });

  const nasaTemp = nasaData?.properties?.parameter?.T2M?.ANN || avgTemp;
  const nasaHumidity = nasaData?.properties?.parameter?.RH2M?.ANN || 60;
  const nasaWind = nasaData?.properties?.parameter?.WS10M?.ANN || avgWindSpeed;

  return {
    solarRadiation: Math.max(2, Math.min(9, avgRadiation || 4.5)),
    windSpeedAvg: Math.max(1, nasaWind),
    windSpeedSeasonal: {
      spring: nasaWind * 1.1,
      summer: nasaWind * 0.9,
      autumn: nasaWind * 1.05,
      winter: nasaWind * 1.2,
    },
    temperatureAvg: nasaTemp,
    temperatureRange: {
      min: avg(validFilter(tempsMin)) || nasaTemp - 10,
      max: avg(validFilter(temps)) || nasaTemp + 10,
    },
    humidity: nasaHumidity,
    rainfallAnnual: Math.max(100, rainfallAnnual),
    rainfallMonthly: monthlyRainfall,
    sunshineHours: avgRadiation * 365 / 0.3, // rough estimation
    uvIndex: Math.max(1, Math.min(11, avgRadiation * 1.2)),
    source: nasaData ? "NASA POWER + Open-Meteo" : "Open-Meteo ERA5",
  };
}

// ── Geographic Data — OpenStreetMap Overpass ─────────────────

export async function fetchGeographicData(
  coords: GeoCoordinates, city: string
): Promise<GeographicData> {
  const { lat, lon } = coords;
  
  // Query Overpass for urban features within 5km radius
  const overpassQuery = `
    [out:json][timeout:15];
    (
      node["natural"="water"](around:5000,${lat},${lon});
      way["natural"="water"](around:5000,${lat},${lon});
      node["landuse"="industrial"](around:5000,${lat},${lon});
      way["landuse"="industrial"](around:5000,${lat},${lon});
      way["building"](around:1000,${lat},${lon});
    );
    out tags 300;
  `;

  let waterNearby = false;
  let industrialCount = 0;
  let buildingCount = 0;

  try {
    const overpassUrl = "https://overpass-api.de/api/interpreter";
    const res = await fetch(overpassUrl, {
      method: "POST",
      body: `data=${encodeURIComponent(overpassQuery)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const data = await res.json();
    // Count features by type from results
    waterNearby = (data.elements?.filter((e: any) => e.tags?.natural === "water").length || 0) > 0;
    industrialCount = data.elements?.filter((e: any) => e.tags?.landuse === "industrial").length || 0;
    buildingCount = data.elements?.filter((e: any) => e.tags?.building).length || 0;
  } catch {
    // Overpass can timeout — use defaults
  }

  // Elevation from Open-Meteo
  let elevation = 50;
  try {
    const elevRes = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
    const elevData = await elevRes.json();
    elevation = elevData.elevation?.[0] || 50;
  } catch { /* use default */ }

  // Urban density heuristic based on lat/lon and city type
  // In production: use population density raster data
  const urbanDensityScore = Math.min(100, Math.max(10, buildingCount * 2.5 + 40));

  return {
    urbanClassification: urbanDensityScore > 65 ? "urban" : urbanDensityScore > 35 ? "peri-urban" : "rural",
    urbanDensityScore,
    elevation,
    terrain: elevation < 100 ? "flat" : elevation < 500 ? "hilly" : "mountainous",
    landAreaKm2: 500, // typical metro area estimate
    greenCoverPct: Math.max(5, 50 - urbanDensityScore * 0.4),
    waterBodiesNearby: waterNearby,
    distanceToWaterKm: waterNearby ? 2.5 : 25,
    coastlineProximity: Math.abs(lat) < 35 && waterNearby,
    source: "OpenStreetMap Overpass + Open-Meteo Elevation",
  };
}

// ── Pollution Data — OpenAQ + OpenWeatherMap ─────────────────

export async function fetchPollutionData(
  coords: GeoCoordinates, apiKey?: string
): Promise<PollutionData> {
  const { lat, lon } = coords;
  let aqi = 75, no2 = 35, pm25 = 25, pm10 = 45, o3 = 60, co2 = 420;

  // OpenAQ v3 — free, no key required for basic queries
  try {
    const aqUrl = `https://api.openaq.org/v3/locations?coordinates=${lat},${lon}&radius=25000&limit=5&order_by=distance`;
    const aqRes = await fetch(aqUrl, { headers: { "X-API-Key": process.env.OPENAQ_KEY || "" } });
    const aqData = await aqRes.json();
    
    if (aqData.results?.length > 0) {
      const station = aqData.results[0];
      // Get latest measurements
      const measureUrl = `https://api.openaq.org/v3/locations/${station.id}/latest`;
      const mRes = await fetch(measureUrl, { headers: { "X-API-Key": process.env.OPENAQ_KEY || "" } });
      const mData = await mRes.json();
      
      for (const m of mData.results || []) {
        if (m.parameter === "pm25") pm25 = m.value;
        if (m.parameter === "pm10") pm10 = m.value;
        if (m.parameter === "no2") no2 = m.value;
        if (m.parameter === "o3") o3 = m.value;
      }
    }
  } catch { /* use defaults */ }

  // OpenWeatherMap AQI (free tier supports 1000 calls/day)
  if (apiKey) {
    try {
      const owmUrl = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`;
      const owmRes = await fetch(owmUrl);
      const owmData = await owmRes.json();
      
      if (owmData.list?.[0]) {
        const comp = owmData.list[0].components;
        aqi = owmData.list[0].main.aqi * 50; // OWM uses 1-5 scale
        no2 = comp.no2 || no2;
        pm25 = comp.pm2_5 || pm25;
        pm10 = comp.pm10 || pm10;
        o3 = comp.o3 || o3;
        co2 = 410 + (aqi * 0.1); // local CO2 estimation from AQI proxy
      }
    } catch { /* use estimated values */ }
  }

  // Compute AQI from PM2.5 if we have it (EPA standard)
  if (pm25 > 0 && aqi === 75) {
    if (pm25 <= 12) aqi = pm25 * 4.2;
    else if (pm25 <= 35.4) aqi = 50 + (pm25 - 12) * 2.1;
    else if (pm25 <= 55.4) aqi = 100 + (pm25 - 35.4) * 2.5;
    else aqi = 150 + (pm25 - 55.4) * 1.5;
  }

  const aqiCategory = aqi <= 50 ? "Good" : aqi <= 100 ? "Moderate" :
    aqi <= 150 ? "Unhealthy for Sensitive Groups" : aqi <= 200 ? "Unhealthy" :
    aqi <= 300 ? "Very Unhealthy" : "Hazardous";

  // Infer primary pollution sources
  const sources: string[] = [];
  if (no2 > 40) sources.push("traffic/vehicles");
  if (pm25 > 25) sources.push("industrial emissions");
  if (pm10 > 50) sources.push("construction/dust");
  if (o3 > 100) sources.push("photochemical smog");
  if (!sources.length) sources.push("mixed/diffuse");

  return {
    aqi: Math.round(aqi),
    aqiCategory,
    no2: Math.round(no2 * 10) / 10,
    co2: Math.round(co2),
    pm25: Math.round(pm25 * 10) / 10,
    pm10: Math.round(pm10 * 10) / 10,
    o3: Math.round(o3 * 10) / 10,
    primarySources: sources,
    pollutionTrend: aqi > 100 ? "worsening" : aqi < 50 ? "improving" : "stable",
    source: apiKey ? "OpenWeatherMap + OpenAQ" : "OpenAQ + EPA AQI formula",
  };
}

// ── Infrastructure Data — OSM + estimation ───────────────────

export async function fetchInfrastructureData(
  coords: GeoCoordinates, geography: GeographicData
): Promise<InfrastructureData> {
  const { lat, lon } = coords;
  let transitStops = 0, roads = 0, industries = 0;

  // Query Overpass for infrastructure features
  try {
    const query = `
      [out:json][timeout:15];
      (
        node["highway"="bus_stop"](around:5000,${lat},${lon});
        node["railway"="station"](around:5000,${lat},${lon});
        way["highway"~"motorway|trunk|primary"](around:3000,${lat},${lon});
        way["landuse"="industrial"](around:5000,${lat},${lon});
      );
      out count;
    `;
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const data = await res.json();
    transitStops = data.elements?.filter((e: any) => 
      e.tags?.highway === "bus_stop" || e.tags?.railway === "station"
    ).length || 0;
    roads = data.elements?.filter((e: any) => e.tags?.highway).length || 0;
    industries = data.elements?.filter((e: any) => e.tags?.landuse === "industrial").length || 0;
  } catch { /* use geography-based estimates */ }

  const density = geography.urbanDensityScore;

  return {
    buildingDensityScore: density,
    estimatedRooftopAreaPct: Math.min(85, density * 0.7 + 10),
    trafficDensityScore: Math.min(100, roads * 3 + density * 0.4),
    industrialZonesPct: Math.min(40, industries * 2 + 5),
    publicTransportScore: Math.min(100, transitStops * 2.5 + 10),
    evChargingStations: Math.max(1, Math.round(density * 0.3)),
    organicWasteKgPerCapita: density > 60 ? 120 : density > 30 ? 180 : 240,
    source: "OpenStreetMap Overpass + estimation models",
  };
}

// ── Policy Data — Heuristic + Country DB ─────────────────────

export async function fetchPolicyData(country: string): Promise<PolicyData> {
  // Curated policy database for major countries
  // In production: integrate with IEA, IRENA, or country-specific APIs
  const policyDB: Record<string, Partial<PolicyData>> = {
    "India": { renewableSubsidyAvailable: true, solarFeedInTariff: true, carbonTaxInEffect: false, evIncentives: true, greenBuildingCode: true, policyStrengthScore: 72, notes: "National Solar Mission, PM-KUSUM scheme, FAME II for EVs" },
    "United States": { renewableSubsidyAvailable: true, solarFeedInTariff: false, carbonTaxInEffect: false, evIncentives: true, greenBuildingCode: true, policyStrengthScore: 68, notes: "IRA tax credits, state-level net metering, federal EV credits" },
    "Germany": { renewableSubsidyAvailable: true, solarFeedInTariff: true, carbonTaxInEffect: true, evIncentives: true, greenBuildingCode: true, policyStrengthScore: 92, notes: "Energiewende, EEG feed-in tariff, carbon pricing" },
    "China": { renewableSubsidyAvailable: true, solarFeedInTariff: true, carbonTaxInEffect: true, evIncentives: true, greenBuildingCode: false, policyStrengthScore: 80, notes: "China ETS, NEV subsidies, solar auction system" },
    "United Kingdom": { renewableSubsidyAvailable: true, solarFeedInTariff: true, carbonTaxInEffect: true, evIncentives: true, greenBuildingCode: true, policyStrengthScore: 88, notes: "UK ETS, Contracts for Difference, green homes grant" },
    "Australia": { renewableSubsidyAvailable: true, solarFeedInTariff: true, carbonTaxInEffect: false, evIncentives: false, greenBuildingCode: true, policyStrengthScore: 62, notes: "SRES, state-based feed-in tariffs, NABERS" },
    "Brazil": { renewableSubsidyAvailable: true, solarFeedInTariff: true, carbonTaxInEffect: false, evIncentives: false, greenBuildingCode: false, policyStrengthScore: 55, notes: "ANEEL auctions, net metering resolution" },
    "default": { renewableSubsidyAvailable: false, solarFeedInTariff: false, carbonTaxInEffect: false, evIncentives: false, greenBuildingCode: false, policyStrengthScore: 30, notes: "Limited available policy data for this region" },
  };

  const policy = policyDB[country] || policyDB["default"];

  return {
    renewableSubsidyAvailable: policy.renewableSubsidyAvailable ?? false,
    solarFeedInTariff: policy.solarFeedInTariff ?? false,
    carbonTaxInEffect: policy.carbonTaxInEffect ?? false,
    evIncentives: policy.evIncentives ?? false,
    greenBuildingCode: policy.greenBuildingCode ?? false,
    policyStrengthScore: policy.policyStrengthScore ?? 30,
    notes: policy.notes ?? "",
    source: "Curated policy database (IEA/IRENA aligned)",
  };
}

// ── Master Aggregator ─────────────────────────────────────────

export async function buildEnvironmentalProfile(
  locationInput: { city?: string; coordinates?: { lat: number; lon: number } },
  apiKey?: string
): Promise<EnvironmentalProfile> {
  
  let coordinates: GeoCoordinates;
  let city: string;
  let country: string;
  let timezone: string;

  if (locationInput.city) {
    const geo = await geocodeLocation(locationInput.city);
    coordinates = geo.coordinates;
    city = geo.city;
    country = geo.country;
    timezone = geo.timezone;
  } else if (locationInput.coordinates) {
    coordinates = locationInput.coordinates;
    // Reverse geocode
    const geo = await geocodeLocation(`${coordinates.lat},${coordinates.lon}`);
    city = geo.city;
    country = geo.country;
    timezone = geo.timezone;
  } else {
    throw new Error("Either city or coordinates must be provided");
  }

  // Parallel fetch all data layers
  const [climate, geography, pollution] = await Promise.all([
    fetchClimateData(coordinates),
    fetchGeographicData(coordinates, city),
    fetchPollutionData(coordinates, apiKey),
  ]);

  const [infrastructure, policy] = await Promise.all([
    fetchInfrastructureData(coordinates, geography),
    fetchPolicyData(country),
  ]);

  return {
    location: { city, country, coordinates, timezone },
    climate,
    geography,
    pollution,
    infrastructure,
    policy,
    fetchedAt: new Date().toISOString(),
  };
}

// --- Dynamic CLI Execution ---
async function main() {
  // Grab the location from command-line arguments (e.g., npx tsx data.aggregator.ts "New York")
  const locationArg = process.argv.slice(2).join(" ");
  
  if (!locationArg) {
    console.error("Please provide a location. Example: npx tsx data.aggregator.ts \"New York\"");
    process.exit(1);
  }

  try {
    console.log(`Fetching environmental profile for ${locationArg}...`);
    const profile = await buildEnvironmentalProfile({ city: locationArg });
    
    // Print the result directly to the console
    console.dir(profile, { depth: null });
  } catch (error) {
    console.error("Error fetching data:", error);
  }
}

// Only execute the main function if this script is being run directly
if (require.main === module) {
  main();
}
