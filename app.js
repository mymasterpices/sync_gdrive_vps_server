const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const { google } = require("googleapis");

const app = express();
const PORT = 3000;

// === CONFIG ===
const CREDENTIALS_PATH = "credentials.json"; // Your OAuth credentials
const TOKEN_PATH = "token.json"; // Token will be saved here
const DRIVE_FOLDER_ID = "1LzO5hO4FV3Ag3v8EGgxMd0PVWEVklFZy"; // Folder to sync
const LOCAL_FOLDER = path.join(__dirname, "downloads/gati_drive"); // Local folder to save files

// === LOAD CREDENTIALS ===
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
const { client_secret, client_id, redirect_uris } =
  credentials.web || credentials.installed;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`; // Change if using VPS with public IP

const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  REDIRECT_URI
);

// Serve /downloads folder publicly at root or a specific path
app.use("/downloads", express.static(LOCAL_FOLDER));
// === HELPER FUNCTIONS ===

// Generate OAuth URL
app.get("/auth", (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  res.redirect(authUrl);
});

// OAuth callback route
app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing code");

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    res.send(
      "✅ Google Drive connected successfully. You can now test /test and /sync."
    );
    console.log("Token saved to", TOKEN_PATH);
  } catch (err) {
    console.error(err);
    res.status(500).send("Authentication failed");
  }
});

// Test API: checks connection and lists first 10 files
app.get("/test", async (req, res) => {
  try {
    if (!fs.existsSync(TOKEN_PATH))
      return res.status(400).send("Please authorize first: /auth");

    oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH)));
    const drive = google.drive({ version: "v3", auth: oAuth2Client });

    const result = await drive.files.list({
      q: `'${DRIVE_FOLDER_ID}' in parents and trashed = false`,
      pageSize: 10,
      fields: "files(id, name, mimeType)",
    });

    res.json(result.data.files);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error connecting to Google Drive");
  }
});

// Sync folder: download all files and subfolders
app.get("/sync", async (req, res) => {
  try {
    if (!fs.existsSync(TOKEN_PATH))
      return res.status(400).send("Please authorize first: /auth");

    oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH)));
    const drive = google.drive({ version: "v3", auth: oAuth2Client });

    await syncFolder(drive, DRIVE_FOLDER_ID, LOCAL_FOLDER);

    res.send("✅ Sync completed successfully.");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error syncing folder");
  }
});

// Recursive folder sync
async function listFiles(drive, folderId) {
  let files = [];
  let pageToken = null;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType)",
      pageToken,
    });
    files.push(...res.data.files);
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return files;
}

async function downloadFile(drive, fileId, destPath) {
  const dest = fs.createWriteStream(destPath);
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );

  await new Promise((resolve, reject) => {
    res.data.pipe(dest);
    dest.on("finish", resolve);
    dest.on("error", reject);
  });
  console.log(`Downloaded: ${destPath}`);
}

async function syncFolder(drive, folderId, localPath) {
  await fs.ensureDir(localPath);

  const files = await listFiles(drive, folderId);

  for (const file of files) {
    const filePath = path.join(localPath, file.name);

    if (file.mimeType === "application/vnd.google-apps.folder") {
      await syncFolder(drive, file.id, filePath);
    } else {
      if (!fs.existsSync(filePath)) {
        await downloadFile(drive, file.id, filePath);
      }
    }
  }
}

// Start Express server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`1️⃣ Visit /auth to authorize Google Drive`);
  console.log(`2️⃣ Test connection via /test`);
  console.log(`3️⃣ Sync folder via /sync`);
});
