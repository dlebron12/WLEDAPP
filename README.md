# WLED App

A web app for controlling WLED light controllers on your home network.

- **Sign in / create account**
- **Controls tab**: add your WLED devices by IP address, pick one from a dropdown, choose an effect
  (Individual Light, Solid, Blink, Twinkle, Colorful), adjust color/brightness/speed, watch a live
  5×5 preview, then **Save** the settings or **Apply** them to the lights.

The app must run on a computer on the same network as your WLED controllers.

## Stack
- **Node.js + Express**: the web server and API
- **SQLite** (via `better-sqlite3`): the database is a single file at `data/wledapp.db`, created automatically on first run
- **scrypt** (built into Node): passwords are stored only as salted hashes, never as plain text

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

## API
| Method | Path          | Body                       | Purpose                     |
|--------|---------------|----------------------------|-----------------------------|
| POST   | `/api/signup` | `{ username, password }`   | Create an account, sign in  |
| POST   | `/api/login`  | `{ username, password }`   | Sign in                     |
| POST   | `/api/logout` |                            | Sign out                    |
| GET    | `/api/me`     |                            | Current signed-in user      |
| GET    | `/api/devices` |                           | List your devices           |
| POST   | `/api/devices` | `{ name, host }`          | Add a device (local IP or `.local` name) |
| DELETE | `/api/devices/:id` |                       | Remove a device             |
| GET    | `/api/devices/:id/settings` |              | Saved settings (or defaults) |
| PUT    | `/api/devices/:id/settings` | settings     | Save settings               |
| POST   | `/api/devices/:id/apply` | settings        | Send settings to the WLED device |

Settings: `{ effect, color: "#rrggbb", brightness: 1–255, speed: 0–255, pixels: [25 × "#rrggbb"] }`.

### Effects → WLED
| App effect | WLED |
|---|---|
| Individual Light | per-LED colors (`seg.i`) on the first 25 LEDs |
| Solid | effect 0 |
| Blink | effect 1 |
| Twinkle | effect 17 |
| Colorful | effect 34 |

Rules: usernames are 3–32 characters (letters, numbers, `_ . -`) and unique regardless of case. Passwords need at least 8 characters.

## Database schema
- `users`: `id`, `username`, `password_hash`, `created_at`
- `sessions`: `token`, `user_id`, `expires_at` (7-day sign-in sessions, stored in a cookie)
- `devices`: `id`, `user_id`, `name`, `host`, `created_at`
- `device_settings`: `device_id`, `settings` (JSON), `updated_at`
