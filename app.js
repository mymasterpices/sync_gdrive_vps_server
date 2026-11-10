const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const readline = require("readline");

const app = express();
const PORT = process.env.PORT || 3000;
const LOG_FILE = process.env.LOG_FILE || "/var/log/gdrive-sync.log";

// Needed so req.protocol is "https" when behind nginx/Cloudflare, otherwise
// copied links may come out as http:// and get blocked as mixed content.
app.set("trust proxy", true);

// ---------- CORS ----------
// Origins allowed to read images from JavaScript (needed for PDF generation).
// Add your real Angular app origin(s): scheme + domain, no trailing slash.
// Can also be set via env: ALLOWED_ORIGINS="https://app.example.com,http://localhost:4200"
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS || "https://crm.jools.in,http://localhost:4200"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions = {
  origin: ALLOWED_ORIGINS,
  methods: ["GET", "HEAD", "OPTIONS"],
  maxAge: 86400, // cache preflight for 1 day
};

// Correctly point to the 'processed' directory
// This makes files inside /var/www/gDrive/processed available at /processed
// CORS is applied only to this route so the browser can read the images
// (canvas / fetch) when building PDFs.
app.use(
  "/processed",
  cors(corsOptions),
  express.static(path.join(__dirname, "processed")),
);

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
]);

// ---------- Image search API ----------
app.get("/api/images", async (req, res) => {
  const tag = typeof req.query.tag === "string" ? req.query.tag.trim() : "";
  const normalizedTag = tag.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (!normalizedTag || normalizedTag.length > 100) {
    return res.status(400).json({ error: "Enter a tag number to search." });
  }

  try {
    const files = await fs.promises.readdir(path.join(__dirname, "processed"));
    const matches = files
      .filter((file) => {
        if (!IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
          return false;

        const base = path.basename(file, path.extname(file)).toLowerCase();
        const norm = base.replace(/[^a-z0-9]/g, "");

        // exact match
        if (norm === normalizedTag) return true;

        // letters-only prefix, e.g. searching 1234 finds AB1234
        if (
          norm.endsWith(normalizedTag) &&
          /^[a-z]*$/.test(norm.slice(0, norm.length - normalizedTag.length))
        )
          return true;

        // tag followed by a separator and suffix, e.g. AB1234_1, AB1234-front
        const escaped = normalizedTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(base);
      })
      .sort((a, b) => a.localeCompare(b));

    res.json({
      images: matches.map((file) => ({
        name: file,
        url: `${req.protocol}://${req.get("host")}/processed/${encodeURIComponent(file)}`,
      })),
    });
  } catch (err) {
    console.error("Failed to search processed images:", err);
    res.status(500).json({ error: "Could not search processed images." });
  }
});

// ---------- Search page ----------
// Served from public/index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- Image watcher stats ----------

const MONTHS = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

// Matches lines written by the watcher, e.g.
// "Mon Oct 19 14:32:10 IST 2026: New image detected: /path/a.jpg - Running cleanup..."
const DETECT_REGEX =
  /^\w{3} (\w{3})\s+(\d{1,2}) (\d{2}:\d{2}:\d{2}) (\S+) (\d{4}): New image detected: (.+?) - Running cleanup/;

async function readWatcherStats() {
  const daily = {}; // { "2026-10-19": { count: 5, lastTimestamp: "..." } }
  let total = 0;
  let lastTimestamp = null;
  let lastFile = null;

  if (!fs.existsSync(LOG_FILE)) {
    return { total, lastTimestamp, lastFile, daily };
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(LOG_FILE, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const m = line.match(DETECT_REGEX);
    if (!m) continue;

    const [, mon, day, time, tz, year, file] = m;
    const dateKey = `${year}-${MONTHS[mon]}-${day.padStart(2, "0")}`;
    const stamp = `${dateKey} ${time} ${tz}`;

    if (!daily[dateKey]) daily[dateKey] = { count: 0, lastTimestamp: null };
    daily[dateKey].count++;
    daily[dateKey].lastTimestamp = stamp;

    total++;
    lastTimestamp = stamp;
    lastFile = file;
  }

  return { total, lastTimestamp, lastFile, daily };
}

app.get("/stats", async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30; // ?days=7 to limit history
    const { total, lastTimestamp, lastFile, daily } = await readWatcherStats();

    const dailyRuns = Object.keys(daily)
      .sort()
      .reverse()
      .slice(0, days)
      .map((date) => ({
        date,
        newFiles: daily[date].count,
        lastTimestamp: daily[date].lastTimestamp,
      }));

    const todayKey = new Date().toISOString().slice(0, 10);

    res.json({
      service: "image-watcher",
      totalNewFiles: total,
      newFilesToday: daily[todayKey] ? daily[todayKey].count : 0,
      lastRun: lastTimestamp,
      lastFile,
      dailyRuns,
    });
  } catch (err) {
    console.error("Failed to read watcher log:", err);
    res.status(500).json({ error: "Could not read watcher log" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(
    `CORS allowed origins for /processed: ${ALLOWED_ORIGINS.join(", ")}`,
  );
});
