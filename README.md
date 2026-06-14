# ParceLLA — Los Angeles Development Site Marketplace

A public-facing marketplace for LA development sites (for sale + RTI/entitled), with a built-in financial analysis engine anchored to RSMeans construction costs and LA submarket data.

## Features

- **Search & filter** — 22 live listings across 10 LA neighborhoods, filterable by type, price, units, lot size, zoning, IRR, net profit, price/unit
- **Map view** — Pin map with IRR color-coding and RTI callouts
- **Financial model** — Per-site IRR, cap rate on cost, cash-on-cash, equity multiple, dev spread, 5-year hold waterfall
- **RSMeans cost engine** — $275–340/SF by project type with scale discounts, full soft cost breakdown
- **Scenario analysis** — Bear/Base/Bull + 4 stress tests + break-even
- **Sensitivity heatmaps** — IRR across rent × cap rate grid; net profit across cost × rent grid
- **Excel export** — 6-tab professional workbook (Dashboard, Assumptions, Deal Model, Comp Table, Sensitivity, Data Architecture)
- **User accounts** — Sign in, save sites, deal alerts
- **Data source layer** — LA Assessor, LADBS, Zillow, CoStar, Census integration map

## Tech Stack (prototype)

- **Frontend:** Vanilla HTML/CSS/JS (single-file prototype)
- **Financial model:** Pure JS, Newton-Raphson IRR solver
- **Excel export:** Python + openpyxl (server-side)

## Production Stack (recommended)

- **Frontend:** React + Vite + MapboxGL
- **Backend:** Node.js / Express
- **Database:** PostgreSQL + PostGIS
- **Auth:** Supabase / Auth0
- **Data:** LA City Open Data (Socrata API) + Zillow Bridge API

## Data Sources

| Source | Dataset | Endpoint | Status |
|--------|---------|----------|--------|
| LA City Open Data | LADBS Permits | `data.lacity.org/resource/nbyu-2ha9.json` | Requires App Token |
| LA City Open Data | Zoning | `data.lacity.org/resource/qv65-mhbd.json` | Requires App Token |
| LA County Assessor | Parcel Data | `assessor.lacounty.gov` | Requires API key |
| RSMeans 2024 | Construction Costs | Hardcoded LA Metro rates | Active |
| Zillow / Bridge | Rent Comps | `api.bridgedataoutput.com` | Requires paid key |
| CoStar / LoopNet | Listings | `api.costar.com` | Enterprise license |
| Census ACS | Demographics | `api.census.gov` | Free / open |

## Financial Model

### Cost Model (RSMeans anchored)
- **Multifamily (Type V):** $285/SF base
- **Mixed-Use (Type III/V podium):** $320/SF
- **Condo/Townhome (Type III):** $340/SF
- **SFR + ADU:** $275/SF
- Scale discounts: >50K SF −5%, >100K SF −7%

### Soft Costs (18% of hard costs)
- Architecture & Engineering: 6%
- Permits & Processing: $2,500/unit
- Title, Escrow & Legal: 1.5% of land + $35K
- Developer Fee: 3%
- Contingency: 5%

### Financing Defaults
- LTC: 65% | Rate: 6.5% | Term: 18 months

### Returns
- Levered IRR (Newton-Raphson, 5-yr hold)
- Cap rate on cost vs market cap rate
- Cash-on-cash return
- Equity multiple
- 8% preferred return + 80/20 GP promote waterfall

## LA Submarket Cap Rates (2024)

| Neighborhood | Cap Rate |
|---|---|
| Los Feliz | 4.0% |
| Silver Lake | 4.2% |
| Culver City | 4.2% |
| Mar Vista | 4.3% |
| Echo Park | 4.4% |
| Mid-Wilshire | 4.5% |
| Highland Park | 4.6% |
| West Adams | 4.7% |
| Koreatown | 4.8% |
| Boyle Heights | 5.0% |

## Getting Started

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/parcella.git
cd parcella

# Open prototype (no build needed)
open public/index.html

# Or serve locally
npx serve public
```

## Excel Export

```bash
pip install openpyxl
python scripts/generate_excel.py
# Output: ParceLLA_Analysis.xlsx
```

## Roadmap

- [ ] Connect LA City Open Data (Socrata App Token)
- [ ] Zillow Bridge API rent comp integration
- [ ] Real MapboxGL map (replace SVG grid)
- [ ] PDF deal memo export (Puppeteer)
- [ ] User accounts (Supabase)
- [ ] Saved searches + email alerts
- [ ] CoStar / LoopNet listing sync
- [ ] LA County Assessor parcel enrichment
- [ ] Mobile responsive layout
- [ ] Comp sales database

## License

MIT
