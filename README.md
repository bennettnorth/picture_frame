# Picture frame dashboard

A wall dashboard for an **AiMOR PF1007 10.1" Wi-Fi photo frame** (FCC ID 2AW9M-PORTRAIT), based on
[wesbos/photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard). It shows:

- **Weather**: current conditions, the next 12 hours and a 5-day forecast ([Open-Meteo](https://open-meteo.com), no API key)
- **Subway times**: live MTA arrivals for the platforms you choose, plus service alerts for those lines (MTA GTFS-realtime, no API key)
- **Citi Bike**: classic bikes, e-bikes and open docks at your nearest stations (Citi Bike GBFS, no API key)
- **Google Calendar**: today's agenda and the next few days, from one or more calendars (secret iCal link)

![Dashboard demo at 1280x800](docs/images/demo.png)

There are two halves:

1. **Rooting the frame** so it runs your page instead of the AiMOR app. This happens at a computer
   with the frame plugged in over USB. See **[docs/ROOTING-PF1007.md](docs/ROOTING-PF1007.md)**.
2. **This server**, hosted online for free on [Render](https://render.com). It fetches all the data
   and serves the page the frame shows. No extra hardware at home.

## Why not run everything on the frame?

The frame is Android 6 with no way to run a server, and its browser engine can't fetch MTA
subway data (a binary format) or your Google Calendar directly. So a small server does the
fetching and the frame just shows a web page. The server also keeps your private calendar link
off the frame.

The frame's certificate store dates from 2015 and doesn't trust today's certificate authorities, so it
rejects most HTTPS sites, Render included. Once the frame is rooted,
`scripts/install-frame-certs.sh` adds the current Let's Encrypt, Google and SSL.com root
certificates. Their fingerprints are pinned in `frame-certs/`. See step 5 of the rooting guide.

The page is written in ES5 with flexbox only, so it should render on the stock WebView without the
WebView upgrade. That's how it was written, not something tested on a real frame yet. If anything
looks broken on the frame, do the WebView 106 upgrade from the rooting guide.

## Host it on Render (free)

1. Sign up at [render.com](https://render.com) with your GitHub account.
2. **New → Blueprint**, then pick this repo. Render reads `render.yaml`.
3. When it asks for `GCAL_FAMILY_ICS`, paste your Google Calendar secret iCal address (see
   [Google Calendar](#google-calendar) below).
4. When the deploy finishes, open the service's **Environment** tab and copy the generated
   `DASHBOARD_KEY`.
5. Your dashboard URL is `https://<service-name>.onrender.com/?key=<DASHBOARD_KEY>`. Open it in
   your computer's browser to check it, then point the frame at it.

Settings live in [`config.json`](config.json), which holds no secrets and is committed. Edit it
(or ask Claude to) and push, and Render redeploys on its own. Render deploys from the branch you
pick when you create the Blueprint; merge into `main` and deploy from that.

About Render's free plan (check their current terms): a free service sleeps after about 15 minutes
with no visitors. The frame checks in every 30 seconds, so it stays awake while the frame is on.
If the frame has been off, the first load takes up to about a minute while the service wakes up.
The page keeps retrying, so it fills in on its own. Free instance hours cover one service running
all month.

Without the `?key=`, the page loads but shows no data, so a stranger who finds the URL can't see
your calendar. To change the key, edit `DASHBOARD_KEY` in Render and update the frame's URL.

## Run it locally

Needs Node.js 18 or newer.

```sh
npm install
npm run demo          # sample data, nothing to configure: open http://localhost:8080
cp .env.example .env  # then fill in your calendar link
npm test
npm start
```

## Configuration ([`config.json`](config.json))

### Weather

Set `weather.latitude` / `weather.longitude` to your home, and `label` to whatever you want shown.
`units` is `imperial` or `metric`.

### Subway

Each entry in `subway.stops` is one **platform direction**:

```json
{ "label": "Bedford Av", "direction": "Manhattan", "stopId": "L08N", "routes": ["L"] }
```

Find stop IDs with:

```sh
npm run find-stop -- bedford
```

IDs ending in `N` are northbound (usually toward Manhattan or the Bronx) and `S` southbound.
`routes` picks which MTA feeds to download, and only those lines are shown. Leave it out to check
every feed. Express runs (the `<6>`, `<7>`) show as diamonds. Set `"alerts": false` to hide
service alerts.

### Citi Bike

Either list exact stations:

```sh
npm run find-station -- bedford             # search by name
npm run find-station -- 40.7081 -73.9571    # nearest to a point
```

```json
"citibike": { "stationIds": ["<id printed by find-station>"] }
```

or leave `stationIds` empty and use `near` to show the closest `count` stations to a point.

### Google Calendar

For each calendar: open Google Calendar on a computer → **Settings** → click the calendar →
**Integrate calendar** → copy **Secret address in iCal format**. Put it in `.env`:

```sh
GCAL_FAMILY_ICS=https://calendar.google.com/calendar/ical/.../private-.../basic.ics
```

and refer to it from `config.json` as `"url": "$GCAL_FAMILY_ICS"`. Add one entry per calendar,
each with its own `color`. The secret address works like a password: anyone who has it can read
the calendar. If it leaks, reset it on the same settings page.

Recurring events, exceptions, moved and cancelled instances, all-day and multi-day events are
handled. Google can take a few hours to update the secret iCal feed after you change an event.
That delay is on Google's side, not the dashboard's.

### Other options

| Setting | Default | |
| --- | --- | --- |
| `port` | `8080` | Also `PORT` env var (Render sets it) |
| `DASHBOARD_KEY` env var | unset | When set, the data API requires `?key=` in the page URL |
| `timezone` | `America/New_York` | Used for the clock and calendar, whatever the frame's own clock says |
| `?nightStart=23&nightEnd=6` | 23 → 6 | URL query: hours when the screen dims |

Data is cached on the server: subway 30 s, Citi Bike 60 s, calendar 5 min, weather 10 min. If a
source fails, the last good data stays on screen with a note.

## Other ways to host it

Any host that runs Node or Docker works: Fly.io, Railway, Google Cloud Run, or a box at home
(`deploy/frame-dashboard.service` is a systemd unit). There's a `Dockerfile` too:

```sh
docker build -t frame-dashboard .
docker run -d --restart unless-stopped -p 8080:8080 --env-file .env frame-dashboard
```

**Testing from your laptop:** with the frame on USB and root ADB working, `adb reverse tcp:8080 tcp:8080`
lets the frame open `http://127.0.0.1:8080/` from your laptop (see the rooting guide).

## Layout

```
server/            Node server (no framework)
  sources/         weather, subway, citibike, calendar
  ics.js           iCalendar parser + recurrence expansion
public/            The page the frame shows (ES5, flexbox only, for the old WebView)
scripts/           find-stop / find-station helpers, install-frame-certs.sh
frame-certs/       Root certificates (and pinned fingerprints) for the frame's trust store
render.yaml        Render Blueprint
test/              node --test suites (npm test)
docs/              Rooting guide for the PF1007
```
