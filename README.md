# Stuttgart im Kino

A responsive cinema showtime aggregator for Stuttgart. The Node server collects structured event data from local cinema websites. It never invents fallback showings: unavailable sources produce a clearly marked empty state.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Notes

- Scraping adapters live in `server.js` and normalize JSON-LD `ScreeningEvent`/`Event` data.
- Results are cached for 20 minutes to be considerate to cinema websites.
- Only scraped, source-backed showings are displayed; there is no demo fallback.
- Source websites can change their markup. Verify cinema terms and robots policies before production use.
