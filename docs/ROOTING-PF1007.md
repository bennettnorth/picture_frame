# Rooting the AiMOR PF1007 and making it show the dashboard

Your box says **Model No. PF1007**, AiMOR app, FCC ID `2AW9M-PORTRAIT`, made by Shenzhen Efercro. That
matches the **PF1007L** (Allwinner A33, Android 6), which many people have rooted. Its full,
tested procedures are in [wesbos/photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard).
This page is a map through them for your frame, plus the steps that point the frame at this
repo's dashboard.

> **Follow the wesbos docs for the actual commands.** They're updated as new firmware versions
> turn up (the firmware table was last updated 2026-10-12), and they include safety checks
> (hashes, sector offsets) that you shouldn't skip or copy from somewhere else. Where this page
> and theirs disagree, theirs wins.

The easiest way through is to run Claude Code **on your own computer**, with the frame plugged
in and the wesbos repo cloned. That's how the wesbos README suggests doing it, and
the agent can then read `adb` output and run the read-only tests with you. A cloud session can't
reach a USB device on your desk.

## Before anything: don't put it on Wi-Fi yet

The stock AiMOR app (`com.efercro.os.aimor`) keeps an **unencrypted** connection to the vendor's
server on TCP port 7806. The server can send it **root shell commands**, and anyone who can tamper
with that traffic can do the same. Details:
[aimor-remote-root-shell.md](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/aimor-remote-root-shell.md).

- Keep the frame **off your home Wi-Fi** until it's rooted and the AiMOR app is disabled.
- If you can, block outbound **TCP 7806** and `imsconnect.efercro.com` for the frame on your router.
- The dashboard needs none of AiMOR's cloud features.

## What you need

- A **USB-A to USB-C data cable**, in a USB-A port on the computer. USB-C to USB-C gave other PF1007L
  owners no power and no data. Charge-only cables and bus-powered hubs also cause trouble.
- [Android platform tools](https://developer.android.com/tools/releases/platform-tools) (`adb`).
- Maybe a spare **microSD card, 32 GB or smaller, FAT32**, if your unit needs a boot patch.
- macOS or Linux is easiest. One route is Windows + WSL.

## Step 1: identify the unit (no changes)

On the frame: **Settings → About**. Write down the **model** and the **full firmware string**.

- Model `PF1007L` and firmware containing `A33`: continue.
- Compare the end of the firmware string with the
  [known firmware table](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/pf1007l-start-here.md#known-firmware-and-units)
  (`…20260113`, `…20260410`, `…20260416`, `OS-PF1009…`, `FL-AIMOR-OS…`, `V10-1680…`). The firmware
  version decides which route works.
- Not A33 (for example `rk312x`): it's a different board. Use the wesbos
  [device index](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/devices.md) instead.

## Step 2: get ADB, least invasive first

Work through [pf1007l-start-here.md → Test sequence](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/pf1007l-start-here.md#test-sequence)
in order, and **stop at the first one that works**:

| Order | Test | Changes the frame? |
| --- | --- | --- |
| T3 | Stock ADB over USB: `adb devices -l` (some units ship with it on) | No |
| T3b | Stock ADB over the network, port 5555 | No (but briefly goes on Wi-Fi) |
| T3c | Temporary root ADB through the AiMOR connection (tested on April `20260410` firmware) | Runtime only, gone after reboot |
| T4–T6 + patch | **Route U** (USB, mainline U-Boot over FEL, preferred) or **Route S** (SD card only) boot patch | **Yes**: writes the boot partition, after a full verified backup |

Rules from people who've done this, worth following:

1. **Back up first** and verify the backup (Route U takes a full eMMC image).
2. Check your **boot image hash** against the table (T6) before any write. If it doesn't match,
   ask in a [wesbos issue](https://github.com/wesbos/photo-frame-dashboard/issues) before writing.
3. Don't edit hash or sector checks in their scripts to get past a failure.
4. Don't cut power during a write.
5. Keep backups private. They contain your Wi-Fi password and device credentials.

When you have it, `adb shell id` prints `uid=0(root)`.

## Step 3: lock it down

From [T8 / aimor-remote-root-shell.md §8](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/aimor-remote-root-shell.md#8-recommended-actions):
install a replacement launcher first (Rootless Launcher, pinned SHA-256 in the
[PF1007L guide §5](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/allwinner-a33-pf1007l.md#5-install-a-launcher-and-optional-firefox-fallback)),
make sure it shows on screen, **then** disable the vendor apps:

```sh
adb shell pm disable com.efercro.os.aimor   # vendor app + its remote root shell
adb shell pm disable com.yhk.qeota          # firmware updater (could undo your changes)
adb shell pm disable com.DeviceTest         # factory test app with an unprotected receiver
```

Wait until `/data/system/users/0/package-restrictions.xml` shows `enabled="2"` for each one before
rebooting. Package Manager writes it asynchronously. After a power cycle (`adb reboot` hangs on many
units), this should print nothing:

```sh
adb shell 'netstat -an | grep :7806'
```

Now the frame can go on Wi-Fi.

## Step 4: set up the frame for a wall display

```sh
adb shell settings put global auto_time 1                     # fixes the "1969" clock
adb shell setprop persist.sys.timezone America/New_York       # ships as New York already; check
adb shell settings put system screen_off_timeout 2147483647   # never sleep
adb shell svc power stayon true
```

The dashboard dims itself at night (11pm to 6am by default), so you don't need a screen-off
schedule. The frame's Wi-Fi MAC changes at every boot, so you can't give **the frame** a
reliable DHCP reservation. That only matters for `adb` over Wi-Fi. The dashboard doesn't care,
because the frame connects out to the hosted dashboard.

## Step 5: trust modern HTTPS certificates

The dashboard is hosted on Render over HTTPS. The frame's 2015 trust store doesn't include the
certificate authorities Render and most sites use today, so the page would fail to load. With
root ADB, from this repo on your computer:

```sh
sh scripts/install-frame-certs.sh          # undo: sh scripts/install-frame-certs.sh --undo
```

It checks each certificate in `frame-certs/` against pinned SHA-256 fingerprints, copies it into
`/system/etc/security/cacerts/`, and records what it added so undo removes only those. The
Let's Encrypt part matches the wesbos BIUFRAME guide. This writes to `/system`, so run it after
your backup. Power-cycle the frame afterwards.

## Step 6: show the dashboard full screen

Deploy the server first (see [Host it on Render](../README.md#host-it-on-render-free)) and check
your URL, `https://<name>.onrender.com/?key=<DASHBOARD_KEY>`, in a desktop browser. Below,
`<dashboard-url>` means that full URL including `?key=`.

**Option A: the wesbos kiosk app (recommended).** It's a small full-screen WebView app that can be
the Home app, so it starts at boot. Hold two fingers on the screen for 1.5 s to get a menu
(launcher, Android settings, reload). Build it from their repo with JDK 17 and Android build-tools 34:

1. In `dashboard/kiosk/src/com/wesbos/homehq/MainActivity.java`, change `DEFAULT_URL` to
   `<dashboard-url>`.
2. `ANDROID_HOME=/path/to/android-sdk bash dashboard/kiosk/build.sh`
3. `adb install -r dashboard/kiosk/build/homehq.apk`
4. Select it as the Home app. The unit has no navigation bar, so also see their kiosk README for the
   optional floating Back/Dashboard buttons.

You can also leave the default URL alone and open any URL:

```sh
adb shell 'am start -a android.intent.action.VIEW -d "<dashboard-url>" -n com.wesbos.homehq/.MainActivity'
```

(Quote the whole command when the URL has `&`.)

**Option B: testing from a laptop before deploying.** No certificates needed. With the frame on USB:

```sh
npm run demo                         # or npm start
adb reverse tcp:8080 tcp:8080
adb shell 'am start -a android.intent.action.VIEW -d "http://127.0.0.1:8080/" -n com.wesbos.homehq/.MainActivity'
```

**Option C: Firefox 143 ARMv7** (pinned in the PF1007L guide). It works without the WebView upgrade
but uses about 4–5× the RAM of the kiosk.

### WebView upgrade (optional)

The stock WebView is version 44 (2015). This dashboard's page avoids modern JS and CSS so it should
work on it. If it renders wrong, or you want to run other pages, follow the WebView 106 swap in
[PF1007L guide §6](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/allwinner-a33-pf1007l.md#6-upgrade-webview-before-using-the-kiosk).
It replaces files in `/system`, so make a backup first and follow the read-back steps exactly.

## Security once it's done

- `/system/xbin/su` gives root to **any** app without a prompt. Install nothing untrusted.
- Android 6 and WebView 106 are old. Keep the frame on your home network, pointed only at your own dashboard.
- If you used T3c or Route S, port 5555 may be open root ADB on your network. Read the matching
  section of the wesbos docs on how to close it.

## Send back what you find

If your unit's firmware or results aren't in their table, the wesbos repo asks for a
[report](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/pf1007l-start-here.md#report-your-unit)
(no serials, MACs or Wi-Fi details). Each report helps the next person.
