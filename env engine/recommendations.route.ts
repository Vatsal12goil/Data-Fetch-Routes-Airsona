// ============================================================
// Airsona — /location-recommendations API Route
// ============================================================

import { Router, Request, Response } from "express";
import { buildEnvironmentalProfile } from "./data.aggregator";
import { runRecommendationEngine } from "./engine";

const router = Router();

/**
 * POST /api/location-recommendations
 *
 * Body:
 *   { city: "Mumbai" }
 *   OR
 *   { coordinates: { lat: 19.076, lon: 72.877 } }
 *
 * Returns: Full RecommendationEngineResponse JSON
 */
router.post("/location-recommendations", async (req: Request, res: Response) => {
  const start = Date.now();

  try {
    const { city, coordinates } = req.body;

    if (!city && !coordinates) {
      return res.status(400).json({
        error: "Provide either 'city' (string) or 'coordinates' ({ lat, lon })",
      });
    }

    if (coordinates) {
      if (typeof coordinates.lat !== "number" || typeof coordinates.lon !== "number") {
        return res.status(400).json({ error: "coordinates.lat and coordinates.lon must be numbers" });
      }
      if (Math.abs(coordinates.lat) > 90 || Math.abs(coordinates.lon) > 180) {
        return res.status(400).json({ error: "Invalid coordinate range" });
      }
    }

    console.log(`[Airsona Engine] Processing: ${city || `${coordinates.lat},${coordinates.lon}`}`);

    // 1. Aggregate all environmental data
    const profile = await buildEnvironmentalProfile(
      { city, coordinates },
      process.env.OPENWEATHER_API_KEY
    );

    // 2. Run scoring engine
    const recommendations = runRecommendationEngine(profile);

    const elapsed = Date.now() - start;
    console.log(`[Airsona Engine] Completed in ${elapsed}ms`);

    return res.json({
      success: true,
      processingTimeMs: elapsed,
      data: recommendations,
    });

  } catch (err: any) {
    console.error("[Airsona Engine] Error:", err.message);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal engine error",
      detail: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  }
});

/**
 * GET /api/location-recommendations/demo
 * Returns a pre-computed demo response for UI testing
 */
router.get("/location-recommendations/demo", async (_req: Request, res: Response) => {
  // Returns Mumbai demo — useful for frontend development without API calls
  try {
    const profile = await buildEnvironmentalProfile({ city: "Mumbai, India" });
    const recommendations = runRecommendationEngine(profile);
    return res.json({ success: true, data: recommendations });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
