# WLED App

A web app with user accounts. Right now it has sign-in and account creation.

## Stack
- **Node.js + Express**: the web server and API
- **SQLite** (via `better-sqlite3`): the database is a single file at `data/wledapp.db`, created automatically on first run
- **scrypt** (built into Node): passwords are stored only as salted hashes, never as plain text

## Run it
```bash
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

Rules: usernames are 3–32 characters (letters, numbers, `_ . -`) and unique regardless of case. Passwords need at least 8 characters.

## Database schema
- `users`: `id`, `username`, `password_hash`, `created_at`
- `sessions`: `token`, `user_id`, `expires_at` (7-day sign-in sessions, stored in a cookie)
