# SPRINT Opportunity Directory

A static, accessible directory of Brown University experiential learning
opportunities.

## Architecture

- Google Sheets is the editorial source for opportunities, programs,
  taxonomy, and cycle-specific site settings.
- GitHub Actions imports and validates the public read-only sheet.
- GitHub Pages hosts the generated static application.
- Search and filtering run entirely in the user's browser.
- Opportunity order follows the source spreadsheet row order.

## Local development

Requires Node.js 22 or later.

```bash
npm install
npm run import
npm test
npm run build
npm run serve
```

Then open:

<http://localhost:8000>

`npm run serve` serves the repository root for development. The production
build is written to `dist/`.

## Publishing

The site publishes:

- When a change is pushed to `main`
- Approximately every ten minutes
- When a maintainer manually runs the `Publish SPRINT directory` workflow

GitHub scheduled workflows may run later than their exact scheduled time.

## Data validation

Publication is blocked when required data is invalid. A failed build does not
replace the currently published site.

Validation output is available in:

- The GitHub Actions run summary
- `data/publication-report.md` during local imports

## Analytics

Analytics are not enabled. Opportunity and program links include stable event
metadata and dispatch a `sprint:analytics` browser event so Brown-approved
analytics can be added later without redesigning the cards.
