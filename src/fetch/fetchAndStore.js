const axios = require('axios');
const prisma = require('../prismaClient');

const FETCH_INTERVAL = 2000000;
const CITY = "kanpur";
const COUNTRY = "india";
const API_KEY = YOUR_API_KEY;

const API_URL = `https://api.waqi.info/search/?token=${API_KEY}&keyword=${CITY},${COUNTRY}`;

async function fetchAndStoreData() {
  try {
    const response = await axios.get(API_URL);

    const stationList = response.data.data;
    if (!Array.isArray(stationList) || stationList.length === 0) {
      throw new Error("No stations found in WAQI response");
    }

    for (const station of stationList) {
      const stationInfo = station.station;
      if (!stationInfo || !Array.isArray(stationInfo.geo)) continue;

      const [lat, lon] = stationInfo.geo;
      const location = stationInfo.name;
      const uid = station.uid;

      const detailsUrl = `https://api.waqi.info/feed/@${uid}/?token=${API_KEY}`;
      const detailsResponse = await axios.get(detailsUrl);

      const detailedData = detailsResponse.data.data;
      if (!detailedData) continue;

      const iaqi = detailedData.iaqi || {};

      const aqiRecord = {
        location,
        lat,
        lon,
        aqi: parseInt(detailedData.aqi) || null,
        pm25: iaqi.pm25?.v ?? null,
        pm10: iaqi.pm10?.v ?? null,
        o3: iaqi.o3?.v ?? null,
        no2: iaqi.no2?.v ?? null,
        so2: iaqi.so2?.v ?? null,
        co: iaqi.co?.v ?? null,
      };

      await prisma.aQIStation.create({
        data: aqiRecord
      });

      console.log(`✅ Stored AQI for ${location}`);
    }

  } catch (err) {
    console.error('❌ Fetch/store failed:', err.message);
  }
}

function startAutoFetch() {
  fetchAndStoreData(); // Immediate run
  setInterval(fetchAndStoreData, FETCH_INTERVAL); // Repeat
}

module.exports = {
  startAutoFetch
};
