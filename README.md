# Light Ops: WLED controller app

Light Ops Permanent Lighting's web app for controlling WLED light controllers on a home network.

- **Sign in / create account**
- **Setup tab**: find WLED controllers on the network (no IP address needed) and add them, or add one
  by IP address; edit each controller's strips (lights per strip), update its address, remove it, or
  **Set up controller** (writes the standard LED settings and presets; see below).
- **Controls tab**: pick a controller from the dropdown (the choice is remembered), pick a strip (or
  all strips), choose an effect (Individual Light, Solid, Blink, Twinkle, Colorful, Repeated Pattern),
  adjust color/brightness/speed, watch a live preview of 25 lights (as a 5×5 grid or along a
  house's roofline), then **Save** the settings or **Apply** them to
  the lights.

The app must run on a computer on the same Wi-Fi as your WLED controllers.

### Finding controllers (no IP address needed)
After a controller has joined the home Wi-Fi (setup steps 1–8), **Setup → Find controllers on my
network** lists every WLED controller on the network with its name, IP address, `.local` name and
LED outputs. **Add** fills in the form, including one strip per LED output with its length.

- It listens for the `_wled._tcp` mDNS announcement every WLED controller makes, and also scans
  the computer's local network (its real size, up to 1,022 addresses) for `/json/info` in case the
  router blocks mDNS. If nothing is found, the app says what it searched and what to check, and the
  terminal running the app logs a `[discovery]` line with the details.
- The controller's MAC address is saved. If the router later gives it a new IP address, **Apply**
  finds it again by MAC, saves the new address and carries on. Setup also offers **Update address**
  when a search finds an added controller at a new IP.

### Set up controller (setup guide steps 13–31)
Once a controller is on the home Wi-Fi and added, **Setup → Set up controller** writes the standard
LED configuration through WLED's `/json/cfg` API, using the controller's strips from the app (one
output per strip, at most 4), then reads the configuration back to check it:

| Guide step | Setting written |
|---|---|
| 13 | Automatic brightness limiter off (`maxpwr: 0`) |
| 15 | LED type SK6812/WS2814 RGBW (`type: 30`) |
| 16–17 | Color order RGB, swap none (`order: 1`) |
| 18 | Length = lights on each strip (`len`) |
| 19 | Data GPIOs 18, 5, 17, 16 for outputs 1–4 (`pin`) |
| 20–22 | Reverse off, skip 0, off refresh on (`rev`, `skip`, `ref`) |
| 23 | Auto-calculate W channel: Brighter (`rgbwm: 1`) |

Optionally it uploads a presets file (e.g. `ZeusPresets.json`, steps 28–31) the same way WLED's
"Restore presets" does. Wi-Fi setup (steps 1–8) still happens through the WLED network first.
The values live in `src/controllerSetup.js`. If the controller's settings are locked with a PIN,
unlock them in WLED first. The Setup tab shows when each controller was last set up, and flags it
if its strips were edited since.

### Strips
A controller drives one or more strips (one per LED output / data line), each with its own number of
lights (default **300**). Each strip is its own section, a WLED *segment*, with its own effect
and settings. Strips are laid out one after another:

| Strip | WLED segment | Lights (example: 300 + 250 + 120) |
|---|---|---|
| 1 | 0 | 0–299 |
| 2 | 1 | 300–549 |
| 3 | 2 | 550–669 |

Total lights = the sum of the strip lengths. It should match the LED count configured in WLED
(Config → LED Preferences); **Apply** warns if it doesn't. The number of strips is limited only by
the controller (its segment limit, usually 16 or 32), which is checked when applying. Applying to
"All strips" also removes any extra WLED segments beyond the configured strips. For Individual
Light, the 25 preview bulbs are spread evenly along each strip.

## Tool versions
Exact versions are listed in `env.yaml` and enforced by:
- `.nvmrc`: Node.js version (used by nvm)
- `package.json` `engines`: Node.js and npm versions (`.npmrc` makes `npm install` refuse other versions)
- `package-lock.json`: every npm package

## Run it
Install [nvm](https://github.com/nvm-sh/nvm) (Mac/Linux) or [nvm-windows](https://github.com/coreybutler/nvm-windows), then from the project folder:
```bash
nvm install        # installs the Node version in .nvmrc (nvm-windows: nvm install 22.23.4)
nvm use            # (nvm-windows: nvm use 22.23.4)
npm install
npm start
```
Then open http://localhost:3000.

## Use it from a phone
The app runs on the computer; a phone on the same Wi-Fi can open it in its browser.
1. Start the app on the computer (`npm start`). It prints a line like
   `On your phone (same Wi-Fi): http://192.168.1.23:3000`.
2. Open that address in the phone's browser (Safari: Share → Add to Home Screen for an app icon).
3. If macOS asks whether to allow incoming connections for "node", choose **Allow**.

The computer must stay on and running the app, on the same Wi-Fi as the controllers. While the phone is
joined to a controller's own WLED network (Wi-Fi setup, steps 1–8) it can't reach the app; switch the
phone back to the home Wi-Fi afterwards.

## API
| Method | Path          | Body                       | Purpose                     |
|--------|---------------|----------------------------|-----------------------------|
| POST   | `/api/signup` | `{ username, password }`   | Create an account, sign in  |
| POST   | `/api/login`  | `{ username, password }`   | Sign in                     |
| POST   | `/api/logout` |                            | Sign out                    |
| GET    | `/api/me`     |                            | Current signed-in user (incl. `selectedDeviceId`) |
| PUT    | `/api/me/selected-device` | `{ deviceId }`  | Remember the controller picked on Controls |
| GET    | `/api/devices` |                           | List your devices           |
| GET    | `/api/devices/discover` | `?scan=0` = mDNS only | Find WLED controllers on the network |
| POST   | `/api/devices` | `{ name, host, stripLengths: [300, 250], mdns?, mac? }` | Add a device (local IP or `.local` name) |
| PUT    | `/api/devices/:id` | same as above         | Edit a device               |
| GET    | `/api/devices/setup-profile` |              | What Set up controller writes |
| POST   | `/api/devices/:id/setup` | `{ presets? }` (file text) | Write the standard LED setup (+ presets) |
| DELETE | `/api/devices/:id` |                       | Remove a device             |
| GET    | `/api/devices/:id/strips/:strip/settings` | | Saved settings (or defaults) |
| PUT    | `/api/devices/:id/strips/:strip/settings` | settings | Save settings     |
| POST   | `/api/devices/:id/strips/:strip/apply` | settings | Send settings to the WLED device |

`:strip` is a strip number (1, 2, …) or `all`.

Settings: `{ effect, color: "#rrggbb", brightness: 1–255, speed: 0–255, pixels: [25 × "#rrggbb"], num_lights_rp: 2|3|5|10, pattern: [10 × "#rrggbb"] }`.

### Effects → WLED
| App effect | WLED |
|---|---|
| Individual Light | per-LED colors (`seg.i`) on the first 25 LEDs |
| Solid | effect 0 |
| Blink | effect 1 |
| Twinkle | effect 17 |
| Colorful | effect 34 |
| Repeated Pattern | per-LED colors (`seg.i`): a pattern of `num_lights_rp` (2, 3, 5 or 10) colors repeated along every light of the strip, sent 256 lights per request |

Rules: usernames are 3–32 characters (letters, numbers, `_ . -`) and unique regardless of case. Passwords need at least 8 characters.

## Database schema
- `users`: `id`, `username`, `password_hash`, `created_at`, `selected_device_id` (last controller picked on Controls)
- `sessions`: `token`, `user_id`, `expires_at` (7-day sign-in sessions, stored in a cookie)
- `devices`: `id`, `user_id`, `name`, `host` (controller IP), `mdns` (`.local` name), `mac`, `created_at`,
  `configured_at` / `configured_lengths` (last Set up controller, and the strips it wrote)
- `strips`: `device_id`, `strip_number`, `length`, `settings` (JSON, empty until saved), `updated_at`

The device's strip count and total lights are calculated from its strips.

Schema changes are applied automatically at startup (`src/db.js`, tracked with SQLite's `user_version`),
so an existing `data/wledapp.db` is upgraded in place.
