# Locking the private side — Cloudflare Access

**Do this before you share the `/suggest` link with anyone.**

Until it's done, `https://scarborough-film-map.pages.dev` is fully open: anyone who has the URL can
read, edit and delete all 38 locations. That was tolerable while the URL was effectively private.
The moment you send a contributor a link to the same host, it isn't.

Everything here is dashboard work — it needs your login and accepts terms on your behalf, so it
can't be scripted for you.

---

## What you're building

| Path | Who can reach it | Why |
|---|---|---|
| `/` and everything else | **you only** | the app: your locations, contacts, shoot dates, review queue |
| `/suggest`, `/suggest.js`, `/suggest.css` | **anyone** | the public form you share |
| `/api/public/*` | **anyone** | the single endpoint that submits a suggestion |
| `/api/*` (everything else) | **you only** | reads and writes over your data |
| `/data/*`, `/styles.css`, `/icons/*` | **anyone** | the guest page needs them; they're open data and CSS, no secrets |

The path split is deliberate: `/api/public/…` versus `/api/suggestions`. A bypass rule written as
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

## 3. Protect the app

Zero Trust → **Access → Applications → Add an application → Self-hosted**.

- **Application name:** `Scarborough Film Map — private`
- **Session duration:** 1 month (so your phone doesn't ask constantly)
- **Public hostname:** `scarborough-film-map.pages.dev`, path left **empty** (covers everything)

Then **Add policy**:
- **Policy name:** `Only Prem`
- **Action:** Allow
- **Include:** *Emails* → `landedimmigrant@gmail.com`

Save.

## 4. Let the public in — the bypass rules

Still in the same application, add a **second policy**:

- **Policy name:** `Public suggestion page`
- **Action:** **Bypass**
- **Include:** *Everyone*

Then set its paths. In the application's **Public hostname** section add these as separate
hostname+path entries with the Bypass policy applied:

```
scarborough-film-map.pages.dev/suggest
scarborough-film-map.pages.dev/suggest.js
scarborough-film-map.pages.dev/suggest.css
scarborough-film-map.pages.dev/api/public/*
scarborough-film-map.pages.dev/data/*
scarborough-film-map.pages.dev/styles.css
scarborough-film-map.pages.dev/icons/*
```

> If the UI only lets one application own a hostname, create a **second self-hosted application**
> instead, name it `Scarborough Film Map — public form`, give it the paths above and a single
> Bypass/Everyone policy. More specific paths win over the catch-all, so the private app keeps
> covering everything else.

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
# signed out — should redirect to a Cloudflare login page, NOT return your data
curl -sI https://scarborough-film-map.pages.dev/api/db | head -1

# the public form and its endpoint must still be reachable
curl -sI https://scarborough-film-map.pages.dev/suggest | head -1
curl -s -X POST https://scarborough-film-map.pages.dev/api/public/suggest \
  -H 'Content-Type: application/json' -d '{"lat":43.77,"lng":-79.25,"title":"Access test","name":"Test"}'
```

Expected: the first is a `302` to `*.cloudflareaccess.com` (or a `401`/`403` from the tripwire), the
second is `200`, the third returns `{"ok":true,...}`.

Then, in a browser: open `/` and confirm you get the email-code login; open `/suggest` in a private
window and confirm it loads with no login at all.

Finally — **delete the "Access test" suggestion** from your review queue.

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
