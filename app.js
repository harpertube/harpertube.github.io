"use strict";

// Start the next video in the list when one finishes.
const AUTOPLAY_NEXT = true;

const $ = (id) => document.getElementById(id);

function showFatal(message) {
  console.error(message);
  $("loading-view").hidden = true;
  $("error-message").textContent = message;
  $("error-view").hidden = false;
}

// The IFrame API calls this global once it has loaded, so it must exist before that script runs.
const ytReady = new Promise((resolve) => { window.onYouTubeIframeAPIReady = resolve; });

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds / 60) % 60;
  const s = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// ---------- video data ----------
//
// The video data comes from the harpertube/channels repo; see the comment at the top
// of its build_data.py for the layout. Every file but index.json has a content
// hash in its name, so the browser's HTTP cache handles "only download what changed".
// Add ?data=URL to the page URL to load the data from somewhere else.
const DATA_URL = (() => {
  const url = new URLSearchParams(location.search).get("data") ?? "https://harpertube.github.io/channels/";
  return url.endsWith("/") ? url : url + "/";
})();

// The channels Harper sees. Each must be in the channels repo's channels.json.
const CHANNELS = [
  "@SuperSimpleSongs",
  "@KidsTV123",
  "@Numberblocks",
  "@BriReads",
  "@HeyBear",
  "@BouncePatrol",
  "@SesameStreet",
  "@KidsCamp",
  "@TobeeAndFriends",
  "@SuperSimplePlay",
  "@BabyEinstein",
  "@MsRachel",
];

// Keep loading older batches at startup until there are at least this many videos.
const INITIAL_VIDEOS = 60;

async function getJson(path, options) {
  const url = DATA_URL + path;
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status}).`);
  return res.json();
}

// Per channel: its data directory and its batch file names still to load, oldest first.
let channelQueues = [];

async function loadChannels() {
  const index = await getJson("index.json", { cache: "no-cache" });
  channelQueues = await Promise.all(CHANNELS.map(async (handle) => {
    const entry = index.channels[handle];
    if (!entry) throw new Error(`Channel ${handle} isn't in ${DATA_URL}index.json. Add it to the channels repo's channels.json.`);
    const manifest = await getJson(entry.manifest);
    return { dir: entry.manifest.slice(0, entry.manifest.lastIndexOf("/") + 1), batches: [...manifest.batches] };
  }));
}

// Loads the next-older batch of every channel and returns their videos, newest
// first, alternating between channels so one channel doesn't take over the list.
async function loadNextBatches() {
  const lists = await Promise.all(channelQueues.map(async (q) => {
    const name = q.batches.pop();
    if (name === undefined) return [];
    return (await getJson(q.dir + name)).reverse();
  }));
  const out = [];
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) {
    for (const list of lists) if (i < list.length) out.push(list[i]);
  }
  return out;
}

function moreToLoad() {
  return channelQueues.some((q) => q.batches.length > 0);
}

let loadingMore = null;
// Appends the next round of batches to the list. Safe to call repeatedly; only one load runs at a time.
function loadMore() {
  if (loadingMore || !moreToLoad()) return loadingMore;
  loadingMore = loadNextBatches()
    .then(appendVideos)
    .catch((err) => showFatal(err.message))
    .finally(() => { loadingMore = null; });
  return loadingMore;
}

// ---------- UI ----------

let videos = [];
let current = -1;
let player = null;
let playerReady = false;
let stripCards = [];
let scrubbing = false;
// Set when a mouse drag on the strip ends, so the release doesn't also count as tapping a video.
let suppressClick = false;

function makeCard(video, index) {
  const card = document.createElement("button");
  card.className = "card tappable";

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  const img = document.createElement("img");
  img.src = `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`;
  img.alt = "";
  img.loading = "lazy";
  img.draggable = false;
  const dur = document.createElement("span");
  dur.className = "duration";
  dur.textContent = formatDuration(video.seconds);
  thumb.append(img, dur);

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = video.title;

  card.append(thumb, title);
  card.addEventListener("click", () => playIndex(index));
  return card;
}

function appendVideos(newVideos) {
  const start = videos.length;
  videos.push(...newVideos);
  $("home-grid").append(...newVideos.map((v, i) => makeCard(v, start + i)));
  const cards = newVideos.map((v, i) => makeCard(v, start + i));
  stripCards.push(...cards);
  $("strip").append(...cards);
}

// Loads more videos when the home grid or the strip is scrolled near its end.
function wireInfiniteScroll() {
  const MARGIN_PX = 1500;
  const home = $("home-view");
  home.addEventListener("scroll", () => {
    if (home.scrollTop + home.clientHeight > home.scrollHeight - MARGIN_PX) loadMore();
  }, { passive: true });
  const strip = $("strip");
  strip.addEventListener("scroll", () => {
    if (strip.scrollLeft + strip.clientWidth > strip.scrollWidth - MARGIN_PX) loadMore();
  }, { passive: true });
}

let toastTimer = 0;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

function ripple(x, y) {
  const r = document.createElement("div");
  r.className = "ripple";
  r.style.left = `${x}px`;
  r.style.top = `${y}px`;
  r.addEventListener("animationend", () => r.remove());
  document.body.append(r);
}

// ---------- player ----------

const playerVars = {
  autoplay: 1,
  controls: 0,
  rel: 0,
  fs: 0,
  disablekb: 1,
  iv_load_policy: 3,
  playsinline: 1,
  origin: location.origin,
};

async function playIndex(index) {
  current = index;
  const video = videos[index];

  if ($("player-view").hidden) {
    $("player-view").hidden = false;
    history.pushState({ playing: true }, "");
  }
  for (const [i, card] of stripCards.entries()) card.classList.toggle("current", i === index);
  stripCards[index].scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  setShieldIcon(false);
  pendingSeek = null;
  setProgress(0, 0);

  if (player) {
    player.loadVideoById(video.id);
    return;
  }
  await ytReady;
  player = new YT.Player("player", {
    // youtube.com rather than the privacy-enhanced youtube-nocookie.com, so the
    // player is signed in to the browser's account and YouTube Premium removes
    // ads. A supervised (Family Link) account needs YouTube's supervised
    // experience turned on in Family Link, or every video says "try watching
    // this video in YouTube Kids".
    host: "https://www.youtube.com",
    width: "100%",
    height: "100%",
    videoId: video.id,
    playerVars,
    events: { onReady: () => { playerReady = true; }, onStateChange, onError },
  });
}

function closePlayer() {
  if (player) player.stopVideo();
  $("player-view").hidden = true;
}

function onStateChange(e) {
  const s = YT.PlayerState;
  // Scrubbing pauses the video, but the play icon would hide the preview frame.
  setShieldIcon(!scrubbing && (e.data === s.PAUSED || e.data === s.CUED));
  if (e.data === s.ENDED && AUTOPLAY_NEXT) playIndex((current + 1) % videos.length);
}

function onError(e) {
  const video = videos[current];
  console.error(`YouTube player error ${e.data} for video ${video.id} (${video.title})`);
  toast("That video won't play here");
  setTimeout(() => playIndex((current + 1) % videos.length), 1500);
}

function setShieldIcon(showPlay) {
  $("shield-icon").classList.toggle("play", showPlay);
}

function togglePlay() {
  if (!player) return;
  const s = YT.PlayerState;
  const state = player.getPlayerState();
  if (state === s.PLAYING || state === s.BUFFERING) player.pauseVideo();
  else player.playVideo();
}

// ---------- scrubber ----------

function setProgress(seconds, duration) {
  const pct = duration > 0 ? (100 * seconds) / duration : 0;
  $("scrub-fill").style.width = `${pct}%`;
  $("scrub-knob").style.left = `${pct}%`;
  $("time-current").textContent = formatDuration(Math.floor(seconds));
  $("time-total").textContent = formatDuration(Math.floor(duration));
}

// After a scrub is released, the player keeps reporting the old time until the
// seek has loaded, which would snap the knob back. Until then, the knob stays
// where it was dropped.
const SEEK_LANDED_TOLERANCE_S = 2;
// Gives up holding the knob if the seek still hasn't landed after this long.
const SEEK_HOLD_MAX_MS = 15000;
let pendingSeek = null;

function updateProgress() {
  if (!playerReady || scrubbing || $("player-view").hidden) return;
  const seconds = player.getCurrentTime();
  const duration = player.getDuration();
  if (pendingSeek) {
    const landed = Math.abs(seconds - pendingSeek.seconds) <= SEEK_LANDED_TOLERANCE_S;
    if (!landed && performance.now() < pendingSeek.deadline) {
      setProgress(pendingSeek.seconds, duration);
      return;
    }
    pendingSeek = null;
  }
  setProgress(seconds, duration);
}

// While dragging, the video is paused and seeked to the finger position, so
// the video itself shows the frame being scrubbed to. YouTube's own scrub
// thumbnails (storyboards) aren't available through any public API.
const SCRUB_SEEK_INTERVAL_MS = 150;
let lastScrubSeek = 0;
let scrubSeconds = 0;

function scrubTo(e) {
  const rect = $("scrub-track").getBoundingClientRect();
  const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const duration = player.getDuration();
  scrubSeconds = fraction * duration;
  setProgress(scrubSeconds, duration);
  const now = performance.now();
  if (now - lastScrubSeek >= SCRUB_SEEK_INTERVAL_MS) {
    lastScrubSeek = now;
    player.seekTo(scrubSeconds, true);
  }
}

function wireScrubber() {
  const area = $("scrub-area");
  area.addEventListener("pointerdown", (e) => {
    if (!playerReady || !(player.getDuration() > 0)) return;
    scrubbing = true;
    area.setPointerCapture(e.pointerId);
    area.classList.add("active");
    setShieldIcon(false);
    player.pauseVideo();
    lastScrubSeek = 0;
    scrubTo(e);
  });
  area.addEventListener("pointermove", (e) => {
    if (scrubbing) scrubTo(e);
  });
  // Uses the last move's position rather than the release event's, which is meaningless for pointercancel.
  const release = () => {
    if (!scrubbing) return;
    scrubbing = false;
    area.classList.remove("active");
    pendingSeek = { seconds: scrubSeconds, deadline: performance.now() + SEEK_HOLD_MAX_MS };
    player.seekTo(scrubSeconds, true);
    player.playVideo();
  };
  area.addEventListener("pointerup", release);
  area.addEventListener("pointercancel", release);
}

// Touch already scrolls the strip natively; this adds click-and-drag for a mouse.
function enableMouseDragScroll(el) {
  let pointerId = -1;
  let startX = 0;
  let startScroll = 0;
  let moved = false;
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startScroll = el.scrollLeft;
    moved = false;
  });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) > 8) {
      moved = true;
      el.setPointerCapture(pointerId);
    }
    if (moved) el.scrollLeft = startScroll - dx;
  });
  el.addEventListener("pointerup", (e) => {
    if (e.pointerId !== pointerId) return;
    pointerId = -1;
    if (moved) {
      suppressClick = true;
      // In case the release doesn't produce a click at all.
      setTimeout(() => { suppressClick = false; }, 0);
    }
  });
}

// ---------- startup ----------

function wireEvents() {
  // Registered on window in the capture phase so it runs before everything else, including the ripple.
  window.addEventListener("click", (e) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
  // Ripple wherever something tappable is tapped. Capture phase so it fires even if the tap closes a view.
  document.addEventListener("click", (e) => {
    if (e.target.closest(".tappable")) ripple(e.clientX, e.clientY);
  }, true);
  // Makes :active styles work on iOS.
  document.addEventListener("touchstart", () => {}, { passive: true });
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  $("shield").addEventListener("click", togglePlay);
  // Back goes through history so the tablet's own back gesture does the same thing.
  $("back-button").addEventListener("click", () => history.back());
  window.addEventListener("popstate", closePlayer);

  wireScrubber();
  enableMouseDragScroll($("strip"));
  wireInfiniteScroll();
  setInterval(updateProgress, 250);
}

async function main() {
  // A reload while a video was open leaves a stale history entry behind.
  if (history.state?.playing) history.replaceState(null, "");
  wireEvents();
  await loadChannels();
  while (videos.length < INITIAL_VIDEOS && moreToLoad()) appendVideos(await loadNextBatches());
  if (videos.length === 0) throw new Error(`None of Harper's channels have any videos in ${DATA_URL}.`);
  $("loading-view").hidden = true;
}

main().catch((err) => showFatal(err.message));
