(() => {
  // Use the page's own origin so calls work under ngrok, localhost, or any tunnel
  const NODERED_BASE = window.location.origin;
  const LUCIDE_SCRIPT =
    "https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js";
  const SPOTIFY_SDK_SCRIPT = "https://sdk.scdn.co/spotify-player.js";
  const UIBUILDER_SCRIPT = "../uibuilder/uibuilder.iife.min.js";
  const CAPTURE_WIDTH = 320;
  const CAPTURE_HEIGHT = 240;
  const SCAN_INTERVAL_MS = 30000;
  const PLAYER_POLL_MS = 3000;
  const MIN_CONFIDENCE = 0.38;
  const SCRIPT_TIMEOUT_MS = 12000;
  const API_TIMEOUT_MS = 25000;

  const moods = {
    happy: { label: "Happy", color: "#f5c518" },
    sad: { label: "Sad", color: "#5b9bd5" },
    angry: { label: "Angry", color: "#e74c3c" },
    surprised: { label: "Surprised", color: "#e67e22" },
    fearful: { label: "Fearful", color: "#9b59b6" },
    disgusted: { label: "Disgusted", color: "#27ae60" },
    neutral: { label: "Neutral", color: "#95a5a6" },
  };

  const dom = {
    headline: document.getElementById("headline"),
    spotifyLogin: document.getElementById("spotify-login"),
    activatePlayer: document.getElementById("activate-player"),
    socketState: document.getElementById("socket-state"),
    cameraFrame: document.getElementById("camera-frame"),
    cameraFeed: document.getElementById("camera-feed"),
    cameraMessage: document.getElementById("camera-message"),
    moodLabel: document.getElementById("mood-label"),
    moodAnalysis: document.getElementById("mood-analysis"),
    confidenceLabel: document.getElementById("confidence-label"),
    confidenceBar: document.getElementById("confidence-bar"),
    detectorState: document.getElementById("detector-state"),
    toggleDetection: document.getElementById("toggle-detection"),
    trackName: document.getElementById("track-name"),
    artistName: document.getElementById("artist-name"),
    albumArt: document.getElementById("album-art"),
    progressNow: document.getElementById("progress-now"),
    progressEnd: document.getElementById("progress-end"),
    progressBar: document.getElementById("progress-bar"),
    previousTrack: document.getElementById("previous-track"),
    togglePlayback: document.getElementById("toggle-playback"),
    nextTrack: document.getElementById("next-track"),
    playerState: document.getElementById("player-state"),
    queueState: document.getElementById("queue-state"),
    queueList: document.getElementById("queue-list"),
    manualSongForm: document.getElementById("manual-song-form"),
    manualSongTitle: document.getElementById("manual-song-title"),
    manualSongArtist: document.getElementById("manual-song-artist"),
  };

  const state = {
    detectorReady: false,
    cameraReady: false,
    cameraStarting: false,
    detectionPaused: false,
    scanBusy: false,
    lastSubmittedMood: null,
    queue: [],
    spotifyPlayer: null,
    spotifyReady: false,
    spotifyToken: null,
    spotifyTokenExpiresAt: 0,
    deviceId: null,
    lastPlayer: null,
  };

  // ── Utilities ──────────────────────────────────────────────────────────────

  function syncIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  async function loadLucideIcons() {
    try {
      await loadScript(LUCIDE_SCRIPT, 5000);
      syncIcons();
    } catch (_) {}
  }

  function setText(node, value) {
    if (node) node.textContent = value;
  }
  function setStatus(value) {
    setText(dom.detectorState, value);
  }

  function setButtonIcon(button, name) {
    const icon = button && button.querySelector("[data-lucide]");
    if (!icon) return;
    icon.setAttribute("data-lucide", name);
    syncIcons();
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function trackIdentity(track = {}) {
    const title = String(track.title || "")
      .trim()
      .toLowerCase();
    const artist = String(track.artist || "")
      .trim()
      .toLowerCase();
    const uri = String(track.uri || "")
      .trim()
      .toLowerCase();
    return `${uri}::${title}::${artist}`;
  }
  function formatPercent(value) {
    return `${Math.round(clamp01(value) * 100)}%`;
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = String(total % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function cameraErrorMessage(error) {
    const name = error && error.name ? String(error.name) : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError")
      return "Permission denied. Allow camera for localhost, then click video to retry.";
    if (name === "NotFoundError" || name === "DevicesNotFoundError")
      return "No camera found";
    return error instanceof Error ? error.message : "Camera unavailable";
  }

  function withTimeout(promise, timeoutMs, message) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() =>
      window.clearTimeout(timer),
    );
  }

  function loadScript(src, timeoutMs = SCRIPT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === "true") resolve();
        else {
          existing.addEventListener("load", resolve, { once: true });
          existing.addEventListener(
            "error",
            () => reject(new Error(`Unable to load ${src}`)),
            { once: true },
          );
        }
        return;
      }
      const script = document.createElement("script");
      let timer = null;
      script.src = src;
      script.async = true;
      script.onload = () => {
        window.clearTimeout(timer);
        script.dataset.loaded = "true";
        resolve();
      };
      script.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error(`Unable to load ${src}`));
      };
      timer = window.setTimeout(() => {
        script.remove();
        reject(new Error(`Timed out loading ${src}`));
      }, timeoutMs);
      document.head.append(script);
    });
  }

  async function apiFetch(path, options = {}) {
    const timeoutMs = options.timeoutMs || API_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    const headers = {
      "ngrok-skip-browser-warning": "true",
      ...(options.headers || {}),
    };
    if (options.body && !headers["Content-Type"])
      headers["Content-Type"] = "application/json";

    let response = null,
      text = "",
      payload = null;
    try {
      response = await fetch(path, {
        ...options,
        headers,
        signal: controller.signal,
      });
      text = await response.text();
    } catch (error) {
      if (error && error.name === "AbortError")
        throw new Error(
          `Request timed out after ${Math.round(timeoutMs / 1000)}s`,
        );
      throw error;
    } finally {
      window.clearTimeout(timer);
    }

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (_) {
        payload = text;
      }
    }

    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && payload.error
          ? payload.error
          : `Request failed with ${response.status}`;
      throw new Error(message);
    }
    return payload;
  }

  // ── Mood helpers ───────────────────────────────────────────────────────────

  function normalizeMood(mood) {
    const key = String(mood || "neutral")
      .trim()
      .toLowerCase();
    return moods[key] ? key : "neutral";
  }

  function renderMood(mood, confidence, source, latencyMs) {
    const key = normalizeMood(mood);
    const config = moods[key];
    const safe = clamp01(confidence);
    dom.cameraFrame.style.setProperty("--mood-color", config.color);
    dom.confidenceBar.style.width = formatPercent(safe);
    dom.confidenceBar.style.backgroundColor = config.color;
    setText(dom.moodLabel, config.label);
    setText(dom.confidenceLabel, formatPercent(safe));
    setText(dom.headline, `${config.label} signal detected`);
    if (source)
      setStatus(`${source} scan in ${Math.round(Number(latencyMs) || 0)}ms`);
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  async function startCamera() {
    if (state.cameraReady || state.cameraStarting) return;
    state.cameraStarting = true;
    dom.cameraMessage.textContent = "Allow camera access";
    setStatus("Requesting camera");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      dom.cameraMessage.textContent = "Camera API unavailable";
      setStatus("Camera API unavailable");
      state.cameraStarting = false;
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 960 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: false,
      });
      dom.cameraFeed.muted = true;
      dom.cameraFeed.playsInline = true;
      dom.cameraFeed.srcObject = stream;
      await dom.cameraFeed.play();
      state.cameraReady = true;
      dom.cameraMessage.style.display = "none";
      setStatus(
        state.detectorReady ? "Camera live" : "Camera live; loading detector",
      );
    } catch (error) {
      dom.cameraMessage.textContent = "Camera unavailable. Click to retry.";
      setStatus(cameraErrorMessage(error));
    } finally {
      state.cameraStarting = false;
    }
  }

  // ── LM Studio analysis (via Node-RED proxy) ───────────────────────────────

  function captureFrameBase64() {
    const canvas = document.createElement("canvas");
    const width = dom.cameraFeed.videoWidth || CAPTURE_WIDTH;
    const height = dom.cameraFeed.videoHeight || CAPTURE_HEIGHT;
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(dom.cameraFeed, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
  }

  async function detectMoodFromFrame() {
    const image = captureFrameBase64();
    return apiFetch("/lm/vision", {
      method: "POST",
      body: JSON.stringify({ image }),
    });
  }

  async function setupDetector() {
    try {
      const probe = await apiFetch("/lm/ping", {
        method: "GET",
      });
      if (!probe || probe.ok !== true) {
        throw new Error("LM Studio not reachable via proxy");
      }
      state.detectorReady = true;
      setStatus("LM Studio ready");
      scanMood();
    } catch (_) {
      state.detectorReady = false;
      setStatus("LM Studio offline — use manual song search");
    }
  }

  async function scanMood() {
    if (state.detectionPaused || state.scanBusy || !state.detectorReady) return;
    if (
      !state.cameraReady ||
      dom.cameraFeed.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      setStatus("Waiting for camera");
      return;
    }
    state.scanBusy = true;
    const startedAt = performance.now();
    try {
      const result = await detectMoodFromFrame();
      if (!result.face_detected) {
        setText(dom.moodAnalysis, result.mood_analysis || "No face detected");
        setStatus("No face detected");
        return;
      }
      const moodValue = normalizeMood(
        result.mood && typeof result.mood === "object"
          ? result.mood.mood
          : result.mood,
      );
      const confidence = clamp01(
        result.mood && typeof result.mood === "object"
          ? result.mood.confidence
          : result.confidence,
      );
      renderMood(
        moodValue,
        confidence,
        "lm-studio",
        performance.now() - startedAt,
      );
      setText(
        dom.moodAnalysis,
        result.mood_analysis || result.source || "LLM analysis ready",
      );
      if (
        confidence >= MIN_CONFIDENCE &&
        moodValue !== state.lastSubmittedMood
      ) {
        if (result.track || result.suggestion) {
          await queueSuggestedSong(result);
        } else {
          setText(dom.queueState, "Song suggestion unavailable");
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Mood scan failed");
    } finally {
      state.scanBusy = false;
    }
  }

  async function queueSuggestedSong(analysis, playerReadyPromise = null) {
    const moodData =
      analysis && analysis.mood && typeof analysis.mood === "object"
        ? analysis.mood
        : {};
    const mood = normalizeMood(
      moodData.mood || (analysis && analysis.mood) || "neutral",
    );
    const confidence = clamp01(
      moodData.confidence != null
        ? moodData.confidence
        : analysis && analysis.confidence,
    );
    const suggestion = analysis && (analysis.track || analysis.suggestion);
    const title = String((suggestion && suggestion.title) || "").trim();
    const artist = String((suggestion && suggestion.artist) || "").trim();

    if (!title) {
      setText(
        dom.moodAnalysis,
        (analysis && (analysis.mood_analysis || analysis.source)) ||
          "LLM analysis ready",
      );
      setText(dom.queueState, "Song suggestion unavailable");
      throw new Error("LM Studio returned no song suggestion");
    }

    if (analysis && analysis.source !== "manual") {
      state.lastSubmittedMood = mood;
    }

    setText(
      dom.moodAnalysis,
      (analysis && (analysis.mood_analysis || analysis.source)) ||
        "LLM analysis ready",
    );
    setText(dom.queueState, "Finding Spotify match");

    const preview = {
      queued: false,
      source: (analysis && analysis.source) || "lm-studio",
      mood_analysis: (analysis && analysis.mood_analysis) || "",
      track: {
        ...suggestion,
        title,
        artist,
        mood: {
          mood,
          confidence,
        },
      },
    };

    addQueuedTrack(preview);

    const queued = await apiFetch("/suggest/song", {
      method: "POST",
      body: JSON.stringify({
        suggestion: {
          title,
          artist,
          mood,
          reason: suggestion && suggestion.reason ? suggestion.reason : "",
        },
        mood,
        confidence,
      }),
    });

    const finalQueued = {
      ...queued,
      mood_analysis:
        (analysis && analysis.mood_analysis) || queued.mood_analysis || "",
    };

    state.queue[0] = finalQueued;
    renderQueue();
    setText(dom.queueState, finalQueued.queued ? "Loading player" : "Matched");
    if (playerReadyPromise) await playerReadyPromise;
    await playMatchedTrack(finalQueued.track);
    return finalQueued;
  }

  async function submitManualSongSearch(playerReadyPromise = null) {
    const title = String(
      (dom.manualSongTitle && dom.manualSongTitle.value) || "",
    ).trim();
    const artist = String(
      (dom.manualSongArtist && dom.manualSongArtist.value) || "",
    ).trim();

    if (!title) {
      setStatus("Enter a song title to search");
      return;
    }

    try {
      await queueSuggestedSong(
        {
          source: "manual",
          mood_analysis: "Manual song search",
          mood: { mood: "neutral", confidence: 0 },
          track: {
            title,
            artist,
            reason: "Manual song search",
          },
        },
        playerReadyPromise,
      );
      if (dom.manualSongForm instanceof HTMLFormElement) {
        dom.manualSongForm.reset();
      }
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Manual song search failed",
      );
    }
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function addQueuedTrack(payload) {
    if (!payload || !payload.track) return;

    const incomingTrack = payload.track;
    const latest = state.queue[0];
    const latestTrack = latest && latest.track ? latest.track : null;

    if (
      latestTrack &&
      trackIdentity(latestTrack) === trackIdentity(incomingTrack)
    ) {
      state.queue[0] = {
        ...latest,
        ...payload,
        track: {
          ...latestTrack,
          ...incomingTrack,
        },
      };
    } else {
      state.queue = [payload, ...state.queue].slice(0, 8);
    }

    renderQueue();
  }

  function removeQueuedTrack(index) {
    state.queue.splice(index, 1);
    renderQueue();
  }

  function latestMatchedTrack() {
    return state.queue[0] && state.queue[0].track ? state.queue[0].track : null;
  }

  function fallbackPlaybackTrack() {
    const currentUri = state.lastPlayer && state.lastPlayer.uri;
    const queuedTracks = state.queue
      .map((entry) => entry && entry.track)
      .filter((track) => track && track.uri);

    return (
      queuedTracks.find((track) => track.uri !== currentUri) ||
      queuedTracks[0] ||
      null
    );
  }

  function renderQueue() {
    clearNode(dom.queueList);

    if (!state.queue.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Waiting for a mood shift";
      dom.queueList.append(empty);
      return;
    }

    state.queue.forEach((entry, index) => {
      const track = entry.track || {};
      const mood = track.mood && track.mood.mood ? track.mood.mood : null;
      const moodLabel = mood
        ? `${moods[normalizeMood(mood)].label} mood`
        : "AI match";

      const item = document.createElement("article");
      item.className = "queue-item";

      const art = document.createElement("div");
      art.className = "queue-art";
      if (track.album_art) {
        const image = document.createElement("img");
        image.src = String(track.album_art);
        image.alt = "";
        image.loading = "lazy";
        art.append(image);
      }

      const copy = document.createElement("div");
      copy.className = "queue-copy";

      const title = document.createElement("strong");
      title.textContent = track.title || "Unknown track";

      const meta = document.createElement("span");
      meta.textContent = `${track.artist || "Unknown artist"} - ${moodLabel}`;

      const detail = document.createElement("span");
      detail.className = "queue-detail";
      detail.textContent =
        entry.mood_analysis ||
        track.reason ||
        (entry.queued === false ? "Finding Spotify match" : "");

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "queue-remove";
      removeBtn.setAttribute("aria-label", "Remove from queue");
      removeBtn.innerHTML = `<i data-lucide="x" aria-hidden="true"></i>`;
      removeBtn.addEventListener("click", () => removeQueuedTrack(index));
      copy.append(title, meta, detail);
      item.append(art, copy, removeBtn);
      dom.queueList.append(item);
    });
    syncIcons();
  }

  function renderPlayer(player = {}) {
    state.lastPlayer = player;
    const duration = Number(player.duration_ms || 0);
    const progress = Number(player.progress_ms || 0);
    const percent = duration
      ? Math.min(100, Math.round((progress / duration) * 100))
      : 0;

    setText(dom.trackName, player.track_name || "No active track");
    setText(
      dom.artistName,
      player.artist ||
        (state.spotifyReady
          ? "Browser player active"
          : "Connect Spotify to begin"),
    );
    setText(dom.progressNow, formatTime(progress));
    setText(dom.progressEnd, formatTime(duration));
    dom.progressBar.style.width = `${percent}%`;
    setButtonIcon(dom.togglePlayback, player.is_playing ? "pause" : "play");

    clearNode(dom.albumArt);
    if (player.album_art) {
      dom.albumArt.classList.add("has-image");
      const image = document.createElement("img");
      image.src = String(player.album_art);
      image.alt = "";
      dom.albumArt.append(image);
      try {
        // set album art as page background via CSS variable and toggle class
        document.body.style.setProperty(
          "--album-bg",
          `url("${String(player.album_art)}")`,
        );
        document.body.classList.add("has-album-art");
      } catch (e) {
        // ignore if DOM not available
      }
    } else {
      dom.albumArt.classList.remove("has-image");
      // clear album art background
      try {
        document.body.classList.remove("has-album-art");
        document.body.style.removeProperty("--album-bg");
      } catch (e) {}
    }
  }

  async function pollPlayerState() {
    try {
      const player = await apiFetch("/player/state");
      setText(dom.playerState, player.is_playing ? "Playing" : "Ready");
      renderPlayer(player);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (!msg.includes("304")) {
        setText(dom.playerState, "Disconnected");
        if (!state.spotifyReady) {
          setText(dom.artistName, "Connect Spotify to begin");
        }
      }
    }
  }

  async function fetchSpotifyToken(forceRefresh = false) {
    if (
      !forceRefresh &&
      state.spotifyToken &&
      (!state.spotifyTokenExpiresAt ||
        Date.now() < state.spotifyTokenExpiresAt - 60 * 1000)
    ) {
      return state.spotifyToken;
    }

    const payload = await apiFetch("/spotify/token", { method: "GET" });
    if (!payload || !payload.access_token) {
      state.spotifyToken = null;
      state.spotifyTokenExpiresAt = 0;
      throw new Error("Spotify token unavailable. Connect Spotify again.");
    }

    state.spotifyToken = payload.access_token;
    state.spotifyTokenExpiresAt = Number(payload.expires_at || 0);
    return state.spotifyToken;
  }

  async function waitForSpotifyDevice(timeoutMs = 10000) {
    const startedAt = Date.now();

    while (!state.deviceId && Date.now() - startedAt < timeoutMs) {
      await delay(150);
    }

    if (!state.deviceId) {
      throw new Error("Spotify player is still starting");
    }

    return state.deviceId;
  }

  async function ensureSpotifySdk() {
    if (window.Spotify) return;

    await new Promise((resolve, reject) => {
      window.onSpotifyWebPlaybackSDKReady = resolve;
      loadScript(SPOTIFY_SDK_SCRIPT).catch(reject);
    });
  }

  async function activateSpotifyPlayer() {
    if (state.deviceId) return state.deviceId;
    if (state.spotifyPlayer) return waitForSpotifyDevice();

    setText(dom.activatePlayer.querySelector("span"), "Loading");
    try {
      await ensureSpotifySdk();
      await fetchSpotifyToken(true);
      await initSpotifyPlayer();
      return waitForSpotifyDevice();
    } catch (error) {
      setText(dom.activatePlayer.querySelector("span"), "Activate Player");
      setStatus(
        error instanceof Error ? error.message : "Unable to activate player",
      );
      throw error;
    }
  }

  async function initSpotifyPlayer() {
    if (state.spotifyPlayer || !window.Spotify) return;

    const player = new window.Spotify.Player({
      name: "Sentient Stream Browser",
      getOAuthToken: async (callback) => {
        try {
          callback(await fetchSpotifyToken());
        } catch (error) {
          setStatus(
            error instanceof Error && error.message
              ? error.message
              : "Spotify token unavailable",
          );
          callback("");
        }
      },
      volume: 0.7,
    });

    player.addListener("ready", ({ device_id: deviceId }) => {
      state.spotifyReady = true;
      state.deviceId = deviceId;
      setText(dom.playerState, "Browser active");
      setText(dom.activatePlayer.querySelector("span"), "Player Active");
      setButtonIcon(dom.activatePlayer, "check");
      transferPlayback(deviceId).catch((error) => {
        setStatus(
          error instanceof Error ? error.message : "Playback transfer failed",
        );
      });
    });

    player.addListener("not_ready", () => {
      state.spotifyReady = false;
      setText(dom.playerState, "Offline");
    });

    player.addListener("initialization_error", ({ message }) =>
      setStatus(message),
    );
    player.addListener("authentication_error", ({ message }) =>
      setStatus(message),
    );
    player.addListener("account_error", ({ message }) => setStatus(message));
    player.addListener("playback_error", ({ message }) => setStatus(message));

    state.spotifyPlayer = player;
    const connected = await player.connect();
    if (!connected) {
      throw new Error("Spotify player connection was rejected");
    }
  }

  async function transferPlayback(deviceId) {
    await apiFetch("/spotify/transfer", {
      method: "PUT",
      body: JSON.stringify({ device_ids: [deviceId], play: false }),
    });
  }

  async function playMatchedTrack(track) {
    if (!track || !track.uri) {
      setText(dom.queueState, "Matched");
      return;
    }

    try {
      const deviceId = await activateSpotifyPlayer();
      await apiFetch(
        `/spotify/play?device_id=${encodeURIComponent(deviceId)}`,
        {
          method: "POST",
          body: JSON.stringify({ uris: [track.uri] }),
        },
      );

      setText(dom.queueState, "Playing");
      renderPlayer({
        is_playing: true,
        track_name: track.title,
        artist: track.artist,
        album_art: track.album_art,
        progress_ms: 0,
        duration_ms: 0,
        uri: track.uri,
      });
      pollPlayerState();
    } catch (error) {
      setText(dom.queueState, "Queued");
      setStatus(
        error instanceof Error
          ? error.message
          : "Track queued; activate Spotify player",
      );
    }
  }

  function requirePlayer() {
    if (state.spotifyPlayer) return true;
    setStatus("Activate the browser player first");
    return false;
  }

  function bindControls() {
    dom.spotifyLogin.addEventListener("click", () => {
      window.location.href = "/spotify/login";
    });

    dom.activatePlayer.addEventListener("click", () => {
      activateSpotifyPlayer();
    });

    dom.cameraFrame.addEventListener("click", () => {
      if (!state.cameraReady) startCamera();
    });

    dom.toggleDetection.addEventListener("click", () => {
      state.detectionPaused = !state.detectionPaused;
      setText(
        dom.toggleDetection.querySelector("span"),
        state.detectionPaused ? "Resume" : "Pause",
      );
      setButtonIcon(
        dom.toggleDetection,
        state.detectionPaused ? "play" : "pause",
      );
      setStatus(state.detectionPaused ? "Detection paused" : "Detection live");
    });

    dom.previousTrack.addEventListener("click", () => {
      if (requirePlayer()) {
        state.spotifyPlayer.previousTrack().catch((error) => {
          setStatus(
            error instanceof Error
              ? error.message
              : "Previous track unavailable",
          );
        });
      }
    });

    dom.togglePlayback.addEventListener("click", () => {
      if (requirePlayer()) {
        if (!state.lastPlayer || !state.lastPlayer.uri) {
          const track = latestMatchedTrack();
          if (track) {
            playMatchedTrack(track);
            return;
          }
        }

        state.spotifyPlayer.togglePlay().catch((error) => {
          const track = latestMatchedTrack();
          const message =
            error instanceof Error ? error.message : "Playback unavailable";

          if (track && message.toLowerCase().includes("no list")) {
            playMatchedTrack(track);
            return;
          }

          setStatus(message);
        });
      }
    });

    dom.nextTrack.addEventListener("click", () => {
      if (requirePlayer()) {
        state.spotifyPlayer.nextTrack().catch((error) => {
          const fallbackTrack = fallbackPlaybackTrack();
          const message =
            error instanceof Error ? error.message.toLowerCase() : "";

          if (
            fallbackTrack &&
            (message.includes("no list was loaded") ||
              message.includes("cannot perform operation"))
          ) {
            setText(dom.queueState, "Playing queued match");
            playMatchedTrack(fallbackTrack);
            return;
          }

          setStatus(
            error instanceof Error ? error.message : "Next track unavailable",
          );
        });
      }
    });

    if (dom.manualSongForm) {
      dom.manualSongForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const playerReady = activateSpotifyPlayer().catch(() => null);
        submitManualSongSearch(playerReady);
      });
    }
  }

  async function initUibuilder() {
    if (!window.uibuilder) {
      try {
        await loadScript(UIBUILDER_SCRIPT);
      } catch (error) {
        setText(dom.socketState, "Socket offline");
        return;
      }
    }

    if (!window.uibuilder) {
      setText(dom.socketState, "Socket offline");
      return;
    }

    window.uibuilder.start?.();
    setText(dom.socketState, "Socket live");

    window.uibuilder.onChange?.("msg", (msg) => {
      if (msg && msg.topic === "sentient-stream/queued") {
        addQueuedTrack(msg.payload);
      }
    });
  }

  async function boot() {
    bindControls();
    loadLucideIcons();
    renderMood("neutral", 0, "startup", 0);
    setText(dom.moodAnalysis, "Waiting for an LLM mood analysis");
    renderQueue();
    startCamera();
    setupDetector();
    initUibuilder();
    window.setInterval(scanMood, SCAN_INTERVAL_MS);
    await pollPlayerState();
    window.setInterval(pollPlayerState, PLAYER_POLL_MS);
  }

  boot().catch((error) => {
    setStatus(error instanceof Error ? error.message : "Startup failed");
  });
})();
