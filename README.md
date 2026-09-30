# Stuttgart im Kino

A responsive cinema showtime aggregator for Stuttgart. The Node server collects structured event data from local cinema websites. It never invents fallback showings: unavailable sources produce a clearly marked empty state.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000/kino/. `/kino` redirects to `/kino/` so relative asset and API URLs stay under the app prefix. Unknown routes return 404.

To serve at the root instead, run `BASE_PATH=/ npm start`. Other prefixes are supported, for example `BASE_PATH=/apps/kino npm start`.

## Cloudflare Tunnel and Access

For `https://doehyunbaek.com/kino/`, forward requests to `http://localhost:3000` **without stripping `/kino`**. Assets and API endpoints are also under `/kino/`. If the domain hosts another site, route only `/kino` and its descendants to this tunnel origin and preserve the existing site's routing.

Configure Cloudflare Access to protect both `/kino` and `/kino/*`, with an allow policy for your email addresses. This code change does not configure the tunnel or Access itself.

## TMDB catalogue tab

Create a free TMDB API credential and provide either form before starting:

```bash
TMDB_API_TOKEN="your-read-access-token" npm run dev
# or: TMDB_API_KEY="your-v3-api-key" npm run dev
```

The credential stays on the server. The tab supports global movie, TV, and person search; opening a person shows their combined cast and crew credits.

## Firestore watchlist sync

The Merkliste can be used locally or synchronized after Google sign-in. It follows the Firebase setup from `~/academical` and stores data separately at:

```text
users/{uid}/film/watchlist
```

Firebase Authentication must enable Google sign-in, the deployed hostname must be listed under authorized domains, and Firestore rules must restrict each `users/{uid}` tree to that authenticated user.

## Notes

- Scraping adapters live in `server.js` and normalize JSON-LD `ScreeningEvent`/`Event` data.
- Results are cached for 20 minutes to be considerate to cinema websites.
- Only scraped, source-backed showings are displayed; there is no demo fallback.
- Source websites can change their markup. Verify cinema terms and robots policies before production use.
