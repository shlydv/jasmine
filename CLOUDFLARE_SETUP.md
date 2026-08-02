# Jasmine cloud sync setup (Cloudflare Free)

The repository now contains a Cloudflare Pages Function at `/api/data`. It keeps the browser's local copy for offline use, and synchronizes the same JSON data to Cloudflare D1 when online. The API is fail-closed: it will not read or write data until both D1 and Cloudflare Access authentication are configured.

Cloudflare's current Free plan is sufficient for this small household app. D1 is available on Free; the documented allowance is 5 GB stored data, 5 million row reads/day, and 100,000 row writes/day. Pages Functions share the Workers Free quota of 100,000 requests/day.

## 1. Create the D1 database

In Cloudflare Dashboard:

1. Open **Workers & Pages → D1 → Create database**.
2. Name it `jasmine-residency`.
3. Open the database's **Console**, paste the contents of [`schema.sql`](./schema.sql), and run it.

## 2. Bind it to the Pages project

1. Open **Workers & Pages → your Jasmine Pages project → Settings → Bindings**.
2. Add a **D1 database** binding.
3. Set the variable name exactly to `JASMINE_DB` and select `jasmine-residency`.
4. Repeat for Production if Cloudflare shows separate Preview/Production environments.

Redeploy the site after adding the binding.

## 3. Protect the app with free Cloudflare Access

Because the database contains renter and billing information, do not expose the Pages site/API publicly.

1. Open **Zero Trust → Access controls → Applications → Add application → Self-hosted**.
2. Protect the exact hostname used by the app, for example `www.aaskdasodas.com/*`.
3. Add an **Allow** policy for your father's and your login email addresses. One-time PIN by email is the simplest provider.
4. Copy the application's **Application Audience (AUD) Tag** from its additional settings.
5. Note your Zero Trust team domain, such as `https://your-team.cloudflareaccess.com`.

Cloudflare Access's Free plan is intended for fewer than 50 users. The Pages Function independently validates the signed `Cf-Access-Jwt-Assertion` token, its issuer, expiry, signature, and audience, so a direct/bypassed request cannot impersonate an authenticated user.

## 4. Add the two Pages variables

In **Workers & Pages → Jasmine → Settings → Variables and Secrets**, add these as production variables:

- `CF_ACCESS_TEAM_DOMAIN` = your Zero Trust team domain, including `https://`.
- `CF_ACCESS_AUD` = the Access application's AUD tag.

Redeploy once more. The Backup screen should show **Cloud sync: connected** after login.

## How synchronization behaves

- The app still works offline using local browser storage.
- Opening it online pulls the D1 copy to a new device.
- Every local save is uploaded in the background.
- If two devices save different changes at the same time, the second device gets a conflict instead of silently overwriting the first. Export its JSON backup, review it, then use the cloud copy or import the backup deliberately.
- D1's built-in Time Travel provides point-in-time recovery for the last 30 days. Keep the existing JSON download as a longer-term backup as well.

## Local testing

The production setup is easiest through the dashboard. For local Pages testing, install Wrangler and run the Pages dev server with a local D1 binding; do not put Access secrets in the repository.
