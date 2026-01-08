const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");

const app = express();
app.use(cors());
app.set("json spaces", 2);

const NBTS_URL = "https://nbts.health.gov.lk/mobile/";

/* =========================
   LOCATION NORMALIZATION
   ========================= */
function normalizeLocation(raw) {
  if (!raw) return "";

  const text = raw.toUpperCase().trim();

  const replacements = {
    "NBC": "Colombo",
    "COLOMBO 01": "Colombo",
    "COLOMBO-01": "Colombo",
  };

  let normalized = replacements[text] || text;

  normalized = normalized.replace(/\d+/g, "").trim(); // remove digits
  normalized = normalized.charAt(0) + normalized.slice(1).toLowerCase(); // Proper case

  return `${normalized}, Sri Lanka`;
}

/* =========================
   GEOCODING (NOMINATIM)
   ========================= */
const locationCache = {};

async function geocodeLocation(location) {
  if (locationCache[location]) return locationCache[location];

  const url =
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encodeURIComponent(location)}` +
    `&format=json&limit=1`;

  try {
    const response = await axios.get(url, {
      headers: { "User-Agent": "FYP-BloodDonation-App" },
    });

    if (!response.data || response.data.length === 0) return null;

    const { lat, lon } = response.data[0];
    const coords = { latitude: parseFloat(lat), longitude: parseFloat(lon) };

    locationCache[location] = coords;
    return coords;
  } catch (error) {
    console.error("Geocoding failed:", location, error.message);
    return null;
  }
}

/* =========================
   DISTANCE (HAVERSINE)
   ========================= */
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (v) => (v * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/* =========================
   NBTS CAMPAIGN API
   ========================= */
app.get("/api/nbts-campaigns", async (req, res) => {
  try {
    // Optional query params
    const userLat = req.query.lat ? parseFloat(req.query.lat) : null;
    const userLng = req.query.lng ? parseFloat(req.query.lng) : null;
    const radiusKm = req.query.radius ? parseFloat(req.query.radius) : 25;

    const response = await axios.get(NBTS_URL, {
     headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  },
});


    const campaigns = [];
    const rows = $("table tbody tr").toArray();

    for (let index = 0; index < rows.length; index++) {
      const cols = $(rows[index]).find("td");
      if (cols.length < 4) continue;

      const date = $(cols[0]).text().trim();
      const title = $(cols[1]).text().trim();
      const venue = $(cols[2]).text().trim();
      const bloodBank = $(cols[3]).text().trim();

      const city = normalizeLocation(bloodBank);
      const coords = await geocodeLocation(city);

      campaigns.push({
        id: `nbts_${index}_${date.replace(/-/g, "")}`,
        source: "NBTS",
        date,
        title,
        venue,
        bloodBank,
        city,
        latitude: coords ? coords.latitude : null,
        longitude: coords ? coords.longitude : null,
        sourceUrl: NBTS_URL,
      });
    }

    // Filter if user provides coordinates
    let filteredCampaigns = campaigns;

    if (userLat !== null && userLng !== null) {
      filteredCampaigns = campaigns
        .map((c) => {
          if (c.latitude == null || c.longitude == null) return null;

          const distance = calculateDistanceKm(
            userLat,
            userLng,
            c.latitude,
            c.longitude
          );

          return { ...c, distanceKm: Number(distance.toFixed(2)) };
        })
        .filter((c) => c !== null && c.distanceKm <= radiusKm)
        .sort((a, b) => a.distanceKm - b.distanceKm);
    }

    return res.status(200).json({
      source: "NBTS",
      total: filteredCampaigns.length,
      campaigns: filteredCampaigns,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to parse NBTS campaigns",
      details: error.message,
    });
  }
});

// const PORT = 3000;

// app.listen(PORT, "0.0.0.0", () => {
//   console.log(`NBTS API running on port ${PORT}`);
// });

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`NBTS API running on port ${PORT}`);
});


