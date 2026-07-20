# Sandru Proposal Generator

An internal tool for Sandru Technologies that helps techs quickly build job proposals (ButterflyMX, cameras, Doorking repairs, door hardware, WiFi, access control expansion) and generate formatted write-ups for Quotient using Claude.

## How it works

- **`public/index.html`** — the single-page app. Sign in with a Google account restricted to `@sandrutech.com`. Fill out job details across tabs (ButterflyMX, Camera, Doorking, Door Hardware, WiFi, Access Expansion). Checking a hardware/material box (with quantity) automatically adds a matching line item to that tab's pricing section — just fill in the price.
- **`functions/index.js`** — a Firebase Cloud Function (`generateProposal`) that verifies the signed-in user's Firebase ID token, checks their email domain, and forwards the built prompt to the Anthropic API to generate proposal text.
- **`firebase.json`** — hosting config. Includes a rewrite so requests to `/api/generateProposal` on the hosting domain are forwarded to the Cloud Function, so the frontend never needs a hardcoded function URL.
- **`public/404.html`** — default Firebase 404 page.

## Project structure

```
sandru-proposal-generator/
├── firebase.json
├── public/
│   ├── index.html
│   └── 404.html
└── functions/
    ├── index.js
    └── package.json
```

## Requirements

- Node.js 24 (see `functions/package.json` → `engines`)
- [Firebase CLI](https://firebase.google.com/docs/cli): `npm install -g firebase-tools`
- Access to the `sandru-proposal-generator` Firebase project
- An `ANTHROPIC_API_KEY` secret configured in Firebase (see below)

## Setup on a new machine

```powershell
git clone https://github.com/<your-username>/sandru-proposal-generator.git
cd sandru-proposal-generator/functions
npm install
cd ..
firebase login
firebase use --add   # select sandru-proposal-generator
```

## Deploying

```powershell
firebase deploy --only hosting,functions
```

Deploy just one piece if needed:

```powershell
firebase deploy --only hosting
firebase deploy --only functions
```

## Secrets

The Cloud Function reads `ANTHROPIC_API_KEY` via Firebase's `defineSecret`. It's stored in Google Cloud Secret Manager tied to the project, not to any one machine, so you normally won't need to re-set it after a fresh clone. If it's ever missing:

```powershell
firebase functions:secrets:set ANTHROPIC_API_KEY
```

## Access control

Only accounts on the `sandrutech.com` domain (verified + email-verified) can call `generateProposal`. This is enforced server-side in `functions/index.js`, not just in the frontend UI.

## Drafts, templates, and history

- The current working proposal is automatically saved in that browser and restored after a refresh.
- Named templates can be saved, loaded, overwritten, and deleted from the Draft workspace toolbar.
- The 20 most recently generated proposals are stored locally with their completed form data and generated text.
- Drafts, templates, and history remain in browser storage; they are not uploaded to a separate database.
- Required client, site, scope, labor, monitoring, discount, and line-item fields are validated before an API request is sent.

## Local UI testing

Run `node dev-server.js`, then open `http://localhost:8123/?testfill=1`. Test mode reveals the local UI, fills a realistic ButterflyMX job, and returns a local canned proposal for generation requests. It does not bypass authentication on the deployed site or live Cloud Function.

## Notes

- Do **not** sync this project folder through Google Drive Desktop for active development — Drive can auto-convert files like `.html` into Google Docs (`.gdoc`) format, corrupting them. Use git for version control and machine-to-machine transfer instead.
- If you ever see `Unexpected token '<' ... is not valid JSON` when generating a proposal, it usually means the frontend is hitting the hosting URL instead of the `/api/generateProposal` rewrite — check `GENERATE_PROPOSAL_URL` in `index.html` and the `hosting.rewrites` block in `firebase.json`.
