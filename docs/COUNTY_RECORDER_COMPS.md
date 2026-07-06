# County Recorder Multifamily Comp Imports

LA County does not provide a simple public online API for all recorder records, so this importer is built for CSV exports that you obtain from county/assessor records, a title company, broker research, or a data vendor.

## What This Adds

- imports multifamily sale records into `sold_comps`
- stores APN and recorder document number
- stores buyer, seller, document type, transfer tax, and raw source row
- estimates sale price from documentary transfer tax when an explicit sale price is not available
- calculates price per unit and price per square foot when units/building size are present
- skips non-multifamily rows by default

## CSV Columns

The importer accepts flexible column names. These are recommended:

```text
apn, recorder_document_number, recording_date, document_type, address, city, zip,
neighborhood, buyer, seller, transfer_tax, sale_price, units, building_sf,
year_built, property_type, lat, lng, notes
```

Use `docs/county-recorder-comps-template.csv` as the starter template.

## Price From Transfer Tax

If `sale_price` is blank, the importer estimates sale price from documentary transfer tax using the default LA County rate:

```text
sale price = transfer tax / 0.0011
```

That is only a public-record estimate. Exempt transfers, partial-interest transfers, entity transfers, city transfer taxes, and lien assumptions can make the inferred price wrong. The importer labels those rows as `transfer_tax_inferred`.

## Run Locally

Preview only:

```bash
npm run import:county-comps -- path/to/comps.csv --dry-run
```

Import into Supabase:

```bash
npm run import:county-comps -- path/to/comps.csv --commit
```

The import requires:

```text
SUPABASE_URL
SUPABASE_SERVICE_KEY
```

## Options

```text
--dry-run              Preview only. This is the default.
--commit               Write rows to Supabase.
--min-units 5          Minimum units for multifamily filtering.
--tax-rate 0.0011      Transfer tax rate used to infer sale price.
--source name          Source label stored in sold_comps.
```

## Good Data Sources

- county recorder/title-company CSV exports
- assessor parcel exports with units, year built, and building size
- broker sale comp spreadsheets
- manual rows from purchase/sale documents

Cap rate and NOI are not usually available from recorder data. Add those later from broker packages or manual comp research.
