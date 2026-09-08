// Local dev server: serves public/ and proxies /api/* to the live Firebase backend.
// Usage: node dev-server.js [port]   (default 8123)
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.argv[2]) || 8123;
const PUBLIC_DIR = path.join(__dirname, "public");
const LIVE_ORIGIN = "https://sandru-proposal-generator.web.app";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// Holds the most recent /api/generateProposal exchange for test inspection
let lastGeneration = null;

// Test-mode script injected into index.html; use ?testfill=1 or ?testfill=astragal
const TEST_FILL_SCRIPT = `
<script>
(function () {
  var testMode = new URLSearchParams(location.search).get("testfill");
  if (!testMode) return;
  function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }
  function setVal(id, val) { const el = document.getElementById(id); if (!el) return; el.value = val; fire(el, "input"); fire(el, "change"); }
  function check(id) { const el = document.getElementById(id); if (!el || el.checked) return; el.checked = true; fire(el, "change"); el.click && el.checked === false && el.click(); }
  function setQty(id, val) { const cb = document.getElementById(id); const qty = cb && cb.parentElement.querySelector(".cb-qty"); if (!qty) return; qty.value = val; fire(qty, "input"); fire(qty, "change"); }
  function fill() {
    window._currentIdToken = "local-test-token";
    if (testMode === "aifill") {
      setVal("ai-source", 'Replace two existing call boxes with two ButterflyMX intercoms.');
      return;
    }
    if (testMode === "astragal") {
      if (typeof switchType === "function") switchType("astragal");
      setVal("ast-company", "Test Property Management");
      setVal("ast-contact", "Jane Doe");
      setVal("ast-site", "Fremont Crossing");
      setVal("ast-addr", "123 Fremont Ave N");
      setVal("ast-zip", "Seattle, WA 98109");
      check("ast-hw-0"); setQty("ast-hw-0", 3);
      check("ast-hw-1"); setQty("ast-hw-1", 2);
      setVal("ast-inswing", 1);
      setVal("ast-outswing", 2);
      setVal("ast-doors", "Office Door (In-Swing)\\nCommercial Lobby to Stairs (Outswing)\\nGarage Shop (Outswing)");
      setVal("ast-notes", "Bulk quantity discount applied to materials and labor.");
      setVal("ast-lhrs", 12);
      setVal("ast-lrate", 160);
      setTimeout(function () {
        document.querySelectorAll("#ast-lineitems input[type=number]").forEach(function (inp) {
          if (!inp.value || Number(inp.value) === 0) { inp.value = 500; fire(inp, "input"); fire(inp, "change"); }
        });
        if (typeof calcPrice === "function") calcPrice("ast");
        var banner = document.createElement("div");
        banner.textContent = "ASTRAGAL TEST DATA LOADED - click 'Generate proposal text'";
        banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#b45309;color:#fff;padding:8px 14px;font:600 14px sans-serif;text-align:center;";
        document.body.appendChild(banner);
      }, 300);
      return;
    }
    setVal("bf-company", "Test Property Management");
    setVal("bf-contact", "Jane Doe");
    setVal("bf-site", "Cedar Ridge Apartments");
    setVal("bf-addr", "1234 Main St");
    setVal("bf-zip", "Bellevue, WA 98004");
    setVal("bf-jobtype", "replacement");
    setVal("bf-doors", 1);
    setVal("bf-existing", "Doorking");
    setVal("bf-cabling", "reuse");
    setVal("bf-notes", "Mount the new intercom where the existing Doorking callbox is located; cover remaining hole with black PVC board.");
    check("bf-bmx-0"); // 8-inch Surface Intercom
    check("bf-mat-0"); // Black PVC Board
    check("bf-mat-9"); // Cabling & supports
    setVal("bf-lhrs", 8);
    setVal("bf-lrate", 160);
    // Give any checkbox-created pricing line items a price
    setTimeout(function () {
      document.querySelectorAll("#bf-lineitems input[type=number]").forEach(function (inp) {
        if (!inp.value || Number(inp.value) === 0) { inp.value = 150; fire(inp, "input"); fire(inp, "change"); }
      });
      if (typeof calcPrice === "function") calcPrice("bf");
      var banner = document.createElement("div");
      banner.textContent = "TEST DATA LOADED - scroll down on the ButterflyMX tab and click 'Generate proposal text'";
      banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#b45309;color:#fff;padding:8px 14px;font:600 14px sans-serif;text-align:center;";
      document.body.appendChild(banner);
    }, 300);
  }
  // Local test mode reveals the UI without weakening the deployed auth gate.
  // The live API still rejects requests without a real Firebase ID token.
  var gate = document.getElementById("signin-gate");
  var localApp = document.getElementById("app-wrap");
  if (gate) gate.classList.add("hidden");
  if (localApp) localApp.classList.remove("hidden");

  // Firebase auth may update after this injected script runs. Keep the local
  // test UI visible long enough for that callback to settle, but fill only once.
  var filled = false;
  var attempts = 0;
  var t = setInterval(function () {
    var app = document.getElementById("app-wrap");
    if (gate) gate.classList.add("hidden");
    if (app) app.classList.remove("hidden");
    window._currentIdToken = "local-test-token";
    if (app && !app.classList.contains("hidden") && !filled) {
      filled = true;
      fill();
    }
    attempts += 1;
    if (attempts >= 20) clearInterval(t);
  }, 500);
})();
</scr` + `ipt>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Test inspection endpoint: last proposal generation seen by the proxy
  if (url.pathname === "/__last-generation") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(lastGeneration || { pending: true }));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const reqBody = chunks.length ? Buffer.concat(chunks) : undefined;
      if (url.pathname === "/api/generateProposal" && req.headers.authorization === "Bearer local-test-token") {
        let prompt = null;
        try { prompt = JSON.parse(reqBody.toString("utf8")).prompt; } catch {}
        const responseJson = { text: `*ButterflyMX Access Control Installation for Cedar Ridge Apartments*

*Job Site*
Cedar Ridge Apartments
1234 Main St
Bellevue, WA 98004

*Scope of Work*
* Remove the existing DoorKing call box.
*Customer-Provided ButterflyMX Hardware*
* Install and configure one (1) customer-provided ButterflyMX 8" Surface Intercom where the existing DoorKing call box was located.
* Test the completed system for functionality.

*Materials*
* Black PVC Board
* Cabling, Conduit, Connectors, Cable Support
Total Materials: $300.00

*Labor*
* Installation and programming labor
Total Labor: $1,280.00

*Terms and Conditions*
* Standard Sandru Technologies terms apply.` };
        lastGeneration = { time: new Date().toISOString(), status: 200, prompt, response: responseJson };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(responseJson));
        return;
      }
      if (url.pathname === "/api/extractProposalData" && req.headers.authorization === "Bearer local-test-token") {
        const responseJson = {
          extraction: {
            proposalType: "butterfly",
            fields: [],
            checkboxes: [
              {
                id: "bf-bmx-2",
                checked: true,
                quantity: 2,
                confidence: "medium",
                evidence: "two ButterflyMX intercoms; the recessed mounting default applies"
              },
              {
                id: "bf-bmx-4",
                checked: true,
                quantity: 26,
                confidence: "high",
                evidence: "twenty-six (26) ButterflyMX Standard Card Readers"
              },
              {
                id: "bf-mat-0",
                checked: true,
                quantity: 2,
                confidence: "high",
                evidence: "two (2) Black PVC Boards"
              }
            ],
            warnings: []
          }
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(responseJson));
        return;
      }
      const headers = { "Content-Type": req.headers["content-type"] || "application/json" };
      if (req.headers.authorization) headers.Authorization = req.headers.authorization;
      const upstream = await fetch(LIVE_ORIGIN + url.pathname, {
        method: req.method,
        headers,
        body: reqBody,
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      if (url.pathname === "/api/generateProposal") {
        let prompt = null, responseJson = null;
        try { prompt = JSON.parse(reqBody.toString("utf8")).prompt; } catch {}
        try { responseJson = JSON.parse(body.toString("utf8")); } catch {}
        lastGeneration = { time: new Date().toISOString(), status: upstream.status, prompt, response: responseJson };
        console.log(`[capture] generateProposal -> ${upstream.status}`);
      }
      res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/json" });
      res.end(body);
    } catch (err) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Proxy error: " + err.message }));
    }
    return;
  }

  let filePath = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, "404.html"), (e2, nf) => {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end(e2 ? "Not found" : nf);
      });
      return;
    }
    if (path.basename(filePath) === "index.html") {
      const html = data.toString("utf8").replace("</body>", TEST_FILL_SCRIPT + "\n</body>");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`Dev server: http://localhost:${PORT}  (API → ${LIVE_ORIGIN})`));
