# ParceLLA — Los Angeles Development Site Marketplace

Pre-underwriting search engine for LA development sites. Every listing is automatically underwritten — IRR, net profit, cap rate on cost, and development spread calculated before you filter.

## What's built

### Search & Underwriting
- Pre-underwriting on all 27 listings (22 for-sale + 5 off-market comps)
- IRR, net profit, dev spread %, and cap rate on cost as filter inputs
- Land imputation for off-market sites ($/unit and $/SF methods)
- Exit cap with submarket defaults (+25bps spread) + global override
- RSMeans 2024 hard cost model ($275–340/SF by type, scale discounts)
- Prop 13 property tax (1.25% of land basis, 2%/yr escalation)

### Financial Model
- S-curve construction draw schedule (beta distribution, 18-month)
- Carry cost on actual drawn balance vs flat estimate
- Loan sizing: LTC / DSCR / LTV binding constraint + sensitivity table
- 20-year cash flow with rent growth (2.5%/yr) and opex escalation
- IRR hurdle waterfall (4 presets: standard, institutional, IRR hurdles, dev-friendly)
- 8% pref return + tiered promote (80/20 → 70/30 → 60/40)
- Bear / base / bull scenarios + 4 stress tests + break-even analysis
- IRR + net profit sensitivity heatmaps

### Data & Intelligence
- 7-factor demand scoring (renter concentration, income/rent, pop density, rent growth, transit, jobs, supply)
- AI deal narrative — Claude analyzes each site: why it pencils, main risk, what others miss
- Sold comps database (10 seeded LA transactions, cap rate validation)
- County recorder comp imports for APN/document-number public-record sales
- Submarket cap rate view (aggregated from sold comps)
- LA Open Data integration: LADBS permits, RTI status, zoning, RSO
- Census ACS: median income, renter %, population density by tract
- Google Maps: street map, satellite, Street View, geocoding

### Exports & Sharing
- PDF deal memo (4-page: summary, costs, cash flow, sensitivity)
- Excel workbook (6 sheets, 821 formulas, zero errors)
- Deal sharing: URL with encoded assumptions, or persistent tokens
- Email: deal summary + PDF attachment via Resend

### User Features
- Auth: signup, signin, signout, forgot/reset password (Supabase)
- Saved sites + deal notes
- Model overrides saved per user per site
- Deal alerts (daily/weekly/instant) with email delivery
- Activity log
- Stripe subscriptions (Free / Pro $49 / Enterprise $199)

### Infrastructure
- Express API (20+ routes, auth middleware, rate limiting, error handling)
- Nightly LADBS permit sync (node-cron, 2AM PT)
- Monthly rent comp sync (RentCast, 1st of month)
- PostgreSQL + PostGIS (Supabase) — full schema with RLS
- Railway + Render deployment configs

## Quick start

```bash
git clone https://github.com/YOUR_USERNAME/parcella.git
cd parcella
cp .env.example .env   # fill in your keys
npm install
npm run dev            # API on :3001
```

## Minimum keys to run (free)
```
SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_KEY
```
Everything else degrades gracefully with mock data.

## Deploy to Railway (recommended)
1. Push to GitHub
2. railway.app → New Project → Deploy from GitHub → select `parcella`
3. Add env vars in Railway dashboard
4. Done — live URL in ~3 minutes

## API routes
```
GET  /api/health
GET  /api/sites?minIRR=15&hood=Koreatown&sort=profit
GET  /api/sites/:id
GET  /api/sites/:id/demand
GET  /api/sites/:id/enrich
POST /api/model/:id/waterfall
POST /api/pdf/:id
POST /api/narrative/:id
GET  /api/comps/submarket/:hood
GET  /api/stripe/plans
POST /api/stripe/checkout
```

## Database setup
Run `supabase/schema.sql` in Supabase SQL editor. Seeds 27 sites, 40 rent comps, 10 sold comps.

## County recorder comp imports
Use `docs/county-recorder-comps-template.csv` as the template, then preview with:

```bash
npm run import:county-comps -- path/to/comps.csv --dry-run
```

After running the Supabase migration and confirming the preview, import with:

```bash
npm run import:county-comps -- path/to/comps.csv --commit
```

## Stack
Node.js 18 | Express | Supabase (PostgreSQL + PostGIS) | Puppeteer | Stripe | Resend | Mapbox | Claude API
