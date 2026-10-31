# HarperTube

A simple YouTube player for Harper:

- A scrollable grid of videos from a fixed set of channels, newest first.
- Tap a video to play it. A back button (a faint white arrow in an outlined square) sits in the top-left corner, a large scrub bar sits under the video, and a strip of videos runs along the bottom.
- Every tap shows a ripple, and buttons shrink when pressed.
- The video is covered by a tap shield, so tapping it pauses or resumes instead of opening YouTube's channel or "more videos" links.
- Portrait only.

This repo is just the static page (`index.html`, `app.js`, `style.css`). There's no build step and no API key. The video lists come from [harpertube/channels](https://github.com/harpertube/channels), which keeps them up to date and publishes them at <https://harpertube.github.io/channels/>. The Android app is [harpertube/android](https://github.com/harpertube/android).

The channels Harper sees are the `CHANNELS` list in `app.js`. Each one must also be in the channels repo's `channels.json`.

## Publishing

In *Settings → Pages*, deploy from the `master` branch, `/ (root)`. The app is at <https://harpertube.github.io/>.

## Testing locally

```sh
python -m http.server 8000 --bind 0.0.0.0
```

Then open <http://localhost:8000>, or `http://<this computer's IP>:8000` from the tablet. The page reads the live data from <https://harpertube.github.io/channels/> by default.

To use other data, add `?data=URL`, for example `?data=testdata/` for a copy of a `data/` folder placed next to `index.html`.

## Tablet setup (Android)

1. Open the Pages URL in Chrome, then choose *⋮ → Add to Home screen → Install*. The app then opens full screen and stays in portrait.
2. Turn on *App pinning* (on Samsung tablets it's called *Pin windows*) in *Settings → Security*, then pin HarperTube. Harper can't leave the app until you unpin it.
