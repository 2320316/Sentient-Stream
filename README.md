# Sentient Stream

Sentient Stream is a small Node-RED + UI Builder application that watches a webcam, sends frames to an LM Studio instance to determine a user's mood, and uses the Spotify Web API to suggest, queue, and control music that matches the detected mood.

This repository contains the Node-RED flow export and the UI Builder front-end used by the `sentient-stream` page.

Contents

- `node-red/flows.json` — Node-RED flow export (Spotify OAuth, LM Studio integration, playback/queue actions).
- `uibuilder/sentient-stream/src/index.html` — UI markup.
- `uibuilder/sentient-stream/src/index.css` — UI stylesheet.
- `uibuilder/sentient-stream/src/index.js` — Browser logic (camera, mood scanning, player controls).

Goals of this README

- Provide a clear, step-by-step way to run Sentient Stream locally (Node-RED + UI Builder).
- Show how to expose Node-RED to the internet using ngrok (required for Spotify OAuth callbacks).
- Explain what environment variables are required and how to configure Spotify and LM Studio.

Prerequisites

- Node.js / npm (for local tooling) — optional if you use Docker.
- Docker (recommended for a self-contained Node-RED instance).
- ngrok (or any public HTTPS tunnel) for exposing Node-RED to Spotify.
- A Spotify Developer application (Client ID, Client Secret).
- LM Studio or compatible LLM vision endpoint reachable from Node-RED.

Quick architecture summary

- Browser (UI Builder page) — captures webcam frames and renders player/queue.
- Node-RED — routes requests, handles Spotify OAuth, calls LM Studio, searches Spotify, queues playback.
- LM Studio — receives images (base64) and returns mood + optional song suggestion.

Quick Start (Docker, ngrok)

1. Start Node-RED (Docker)

Run Node-RED using Docker (this example mounts a local `node-red` folder for persistence):

```bash
mkdir -p ./node-red
docker run -it --rm \
  -p 1880:1880 \
  -v "$(pwd)/node-red:/data" \
  --name mynodered nodered/node-red:latest
```

2. Install uibuilder in Node-RED

- In the Node-RED editor (http://localhost:1880), open the Palette Manager → Install and install `node-red-contrib-uibuilder` if not already installed.

3. Start ngrok to expose Node-RED (needed for Spotify OAuth)

```bash
ngrok http 1880
```

- Copy the public HTTPS URL shown by ngrok (e.g. `https://abcd-12-34-56.ngrok.io`). You will use this for the Spotify redirect and return URLs.

4. Configure the Spotify Developer app

- Open https://developer.spotify.com and create / select your app.
- Set the Redirect URI to your public ngrok URL + `/spotify/callback`.
  Example: `https://abcd-12-34-56.ngrok.io/spotify/callback`
- Set the app's allowed return URL to the UI path (optional): `https://abcd-12-34-56.ngrok.io/sentient-stream/`
- Note the `Client ID` and `Client Secret` — you'll add these to Node-RED environment variables.

5. Import Node-RED flows

- Open Node-RED at `http://localhost:1880`.
- From the menu ▶ Import → Clipboard (or File) → choose `node-red/flows.json` from this repo and import.
- Deploy the flow.

6. Configure environment variables in Node-RED

Set the following environment variables in your Node-RED deployment (either in `settings.js`, your container environment, or using the Node-RED UI environment settings):

- `SPOTIFY_CLIENT_ID` — Spotify app Client ID
- `SPOTIFY_CLIENT_SECRET` — Spotify app Client Secret
- `SPOTIFY_REDIRECT_URI` — e.g., `https://abcd-12-34-56.ngrok.io/spotify/callback`
- `SPOTIFY_RETURN_URL` — e.g., `https://abcd-12-34-56.ngrok.io/sentient-stream/`
- `LM_STUDIO_BASE_URL` — e.g., `http://host.docker.internal:1234` (or your LM Studio URL)

If you run Node-RED in Docker, pass env vars like:

```bash
docker run -it --rm \
  -p 1880:1880 \
  -e SPOTIFY_CLIENT_ID=your_client_id \
  -e SPOTIFY_CLIENT_SECRET=your_client_secret \
  -e SPOTIFY_REDIRECT_URI="https://abcd-12-34-56.ngrok.io/spotify/callback" \
  -e LM_STUDIO_BASE_URL="http://host.docker.internal:1234" \
  -v "$(pwd)/node-red:/data" \
  --name mynodered nodered/node-red:latest
```

7. Setup UI Builder page (sentient-stream)

- In Node-RED, open the `uibuilder` node you added during import.
- Create or select a folder named `sentient-stream` (this will be the page path).
- Open the folder's `src` editor (uibuilder provides an in-browser file editor) and paste the three front-end files from this repository:
  - `index.html` — paste the contents of `uibuilder/sentient-stream/src/index.html`.
  - `index.css` — paste the contents of `uibuilder/sentient-stream/src/index.css`.
  - `index.js` — paste the contents of `uibuilder/sentient-stream/src/index.js`.
- Save the files and Deploy the Node-RED flow.

8. Open the page and test

- Browse to your public ngrok URL + `/sentient-stream/` (for example `https://abcd-12-34-56.ngrok.io/sentient-stream/`) or to `http://localhost:1880/sentient-stream/` if you are running without ngrok and the Spotify auth returns are not required.
- Allow camera access when prompted.
- Click `Connect Spotify` to start the OAuth flow (you'll be redirected to Spotify and return via the ngrok callback).

Troubleshooting

- Camera issues: make sure the page is loaded over HTTPS (ngrok provides HTTPS) or the browser may block camera access on some platforms. Verify browser camera permissions for the site.
- Spotify OAuth errors: ensure the Spotify Redirect URI exactly matches the URI registered in the Spotify Developer app (including trailing slashes). If you change ngrok tunnels, update the Spotify app settings.
- LM Studio errors: confirm `LM_STUDIO_BASE_URL` is reachable from Node-RED (from inside the container use `host.docker.internal` for local services).
- Token persistence: Node-RED stores Spotify tokens in global context; they may be lost on container recreation unless you persist Node-RED data (`/data` volume).

FAQ

Q: Can I run without ngrok?

A: Yes for local testing of the UI and camera, but Spotify OAuth requires a public HTTPS callback for production flows. You can mock the Spotify endpoints for testing, or run the Spotify flow only when exposing Node-RED publicly.

Q: Where are tokens stored?

A: Tokens are stored in Node-RED global context (in-memory + persisted to `/data` if using the official Docker image with a volume).

---

Contributing

If you change flows or front-end files, export the Node-RED flow and commit the updated `node-red/flows.json` and the three UI files under `uibuilder/sentient-stream/src/` so other users can reproduce the setup.

License

This repository contains example code and is provided without warranty. Check the LICENSE file or add one if you plan to reuse or publish this project.
