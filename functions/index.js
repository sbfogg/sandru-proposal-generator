const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const ALLOWED_DOMAIN = "sandrutech.com";

exports.generateProposal = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // ── Verify the Firebase ID token sent from the signed-in page ──
    const authHeader = req.headers.authorization || "";
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) {
      return res.status(401).json({ error: "Missing auth token. Please sign in." });
    }

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(match[1]);
    } catch (err) {
      return res.status(401).json({ error: "Invalid or expired sign-in. Please sign in again." });
    }

    const email = decoded.email || "";
    if (!decoded.email_verified || !email.toLowerCase().endsWith("@" + ALLOWED_DOMAIN)) {
      return res.status(403).json({ error: "Access restricted to @" + ALLOWED_DOMAIN + " accounts." });
    }

    // ── Existing proposal generation logic ──
    const { prompt } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: "Missing 'prompt' in request body" });
    }

    try {
      const apiKey = ANTHROPIC_API_KEY.value();

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }]
        })
      });

      const data = await response.json();

      if (!response.ok) {
        const msg = (data.error && data.error.message) ? data.error.message : JSON.stringify(data);
        return res.status(response.status).json({ error: "Anthropic API error: " + msg });
      }

      const text = data.content.map(block => block.text || "").join("\n");
      return res.status(200).json({ text });

    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err.message || "Unknown server error" });
    }
  }
);
