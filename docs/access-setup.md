# Locking the private side — Cloudflare Access

**Do this before you share any link — `/suggest` or the landing page.**

Until it's done, the console at `https://scarborough-film-map.pages.dev/app/` is fully open: anyone
who has the URL can read, edit and delete all your locations, ideas and shoot days. That was
tolerable while the URL was effectively private. The moment you hand out links to the same host, it
isn't — and the landing page now links to the console in its footer.

Everything here is dashboard work — it needs your login and accepts terms on your behalf, so it
can't be scripted for you.

---

## What you're building

Since the 2026-08-12 restructure the private surface lives under two clean prefixes, so the rules
are simpler than they used to be:

| Path | Who can reach it | Why |
|---|---|---|
| `/` (landing), `/landing.css` | anyone | the film's public face |
| `/suggest`, `/suggest.js`, `/suggest.css` | anyone | the public form you share |
| `/data/*`, `/icons/*`, `/manifest.webmanifest`, `/sw.js` | anyone | open data, icons, PWA plumbing — no secrets |
| `/api/public/*` | anyone | the single endpoint that submits a suggestion |
| **`/app*`** | **you only** | the console: locations, ideas, shoot days, review queue |
| **`/api/*` (everything else)** | **you only** | reads and writes over your data |

Everything in the "anyone" rows needs **no Access rule at all** — you only protect `/app*` and
`/api/*`, then punch one bypass hole for `/api/public/*`.

The naming split is deliberate: `/api/public/…` versus `/api/suggestions`. A bypass rule written as
`/api/suggest*` would also match `/api/suggestions` and quietly expose your review queue — including
every contributor's email. Don't rename these to share a prefix.

---

## 1. Turn on Zero Trust

1. Cloudflare dashboard → **Zero Trust** (left sidebar).
2. If it's your first time it asks you to pick a team name — anything, e.g. `premfilm`. Choose the
   **Free** plan (50 users). A payment method may be requested; the free tier is $0.

## 2. Add a login method

Zero Trust → **Settings → Authentication → Login methods**. **One-time PIN** is already there and is
all you need: you enter your email, Cloudflare emails you a 6-digit code. No password, nothing to
leak. (Google is also an option if you'd rather click through.)

## 3. Protect the console and the API

Zero Trust → **Access → Applications → Add an application → Self-hosted**.

- **Application name:** `Scarborough Film Map — private`
- **Session duration:** 1 month (so your phone doesn't ask constantly)
- **Public hostnames:** add **two** entries:
  - `scarborough-film-map.pages.dev` path `app*`
  - `scarborough-film-map.pages.dev` path `api/*`

Then **Add policy**:
- **Policy name:** `Only Prem`
- **Action:** Allow
- **Include:** *Emails* → `landedimmigrant@gmail.com`

Save.

## 4. Let the public suggestion endpoint through

Add a **second self-hosted application**:

- **Application name:** `Scarborough Film Map — public suggest API`
- **Public hostname:** `scarborough-film-map.pages.dev` path `api/public/*`
- **Policy:** name `Everyone`, action **Bypass**, include *Everyone*

More specific paths win, so this hole in `/api/*` is exactly `/api/public/*` and nothing else.
The landing page, `/suggest` and the static assets aren't covered by either application, so they
stay public with no rule needed.

## 5. Set the tripwire

```bash
npx wrangler pages secret put OWNER_EMAIL --project-name scarborough-film-map
# paste: landedimmigrant@gmail.com
```

With this set, owner API routes also check the `Cf-Access-Authenticated-User-Email` header Access
injects, and refuse the request if it's missing or different.

**Be clear about what this is worth.** It is a *second* line of defence, not the lock. Access strips
inbound `Cf-Access-*` headers and sets its own, so downstream of Access the check is meaningful —
but with no Access in front, anyone can simply send that header themselves. It exists so that if a
policy is later disabled, or a Bypass rule is scoped too broadly, the API fails closed instead of
silently serving your data. **Access is the lock. This is the tripwire.**

Leave `OWNER_EMAIL` unset and the API stays open, exactly as it is today — so setting it up in the
wrong order can't lock you out of your own app.

---

## 6. Check it actually works

```bash
# signed out — both should redirect to a Cloudflare login page, NOT return data
curl -sI https://scarborough-film-map.pages.dev/app/ | head -1
curl -sI https://scarborough-film-map.pages.dev/api/db | head -1

# the public pages and endpoint must still be reachable with no login
curl -sI https://scarborough-film-map.pages.dev/ | head -1
curl -sI https://scarborough-film-map.pages.dev/suggest | head -1
curl -s -X POST https://scarborough-film-map.pages.dev/api/public/suggest \
  -H 'Content-Type: application/json' -d '{"lat":43.77,"lng":-79.25,"title":"Access test","name":"Test"}'
```

Expected: the first two are `302` to `*.cloudflareaccess.com` (or `401`/`403` from the tripwire),
the next two are `200`, the last returns `{"ok":true,...}`.

Then, in a browser: open `/app/` and confirm you get the email-code login; open `/` and `/suggest`
in a private window and confirm they load with no login at all.

Finally — **decline the "Access test" suggestion** from your review queue.

### The phone after Access

The installed PWA will hit the Access login once per session duration (1 month). Do one online
open after setting this up so the service worker and the Access cookie are both fresh. Offline
field use keeps working — cached data is served without a round-trip to Access, and writes go
through the network, which by then carries your Access cookie.

---

## If you lock yourself out

Access policies are edited from the Cloudflare dashboard, which is authenticated separately — you
can always get back in there and disable the application. The database is untouched either way, and
`node tools/db-exec.mjs "select count(*) from locations"` still works from your machine because it
talks to Neon directly, not through Pages.

## A cheaper alternative, if Access proves annoying

Cloudflare Access is the right tool, but it does mean an email code on a new device. If that grates,
the fallback is to keep the app on an unguessable path instead. That's security by obscurity and a
leaked link is a full breach — but it is strictly better than the current state of "anyone with the
public URL". Say the word and it's a small change.
