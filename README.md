# Jasmine Residency

Family rent manager with local storage, JSON backup/restore, and authenticated Cloudflare sync.

## Run locally

From this folder:

```sh
python3 -m http.server 8765
```

Open http://localhost:8765. Local preview data is separate from the live website. The simple local server does not provide cloud sync.

## Tenant information

Open a flat and select **Tenant Info**. Expand each section for owner details, personal information, permanent/local addresses, IDs, references, previous residence and employment. A third contact is optional, matching the supplied verification form. Existing tenant data stays intact; new fields start blank. Use **Save Changes** after edits or photo/signature uploads.

Images accept JPG, PNG and WebP up to 5 MB, are resized/compressed, and are included in JSON backups and cloud sync. A size check prevents profile updates from exceeding the existing cloud payload limit.

**Print verification details / PDF** creates a details sheet from the current form for completing the police application; it is not an official submission or a filled copy of the original PDF.

**Preview agreement draft** populates a printable draft using the supplied leave and licence template. Enter the agreement dates, duration, property details, amounts in words and inventory first. Missing values remain visible blanks. Fixed clauses are reproduced from the supplied template and need review; this feature does not certify their legal accuracy. The sample person's ID, name and address are not embedded in the new template. Agreement dates and deposits are taken from entered records, not the inconsistent sample values.

## Two installments

**Add Bill / Payment**, **History → Edit**, and **Month Entry** support Payment 1 and Payment 2 with separate amounts, dates and modes. To record a later installment for an existing month, edit that month's entry. The aggregate amount remains compatible with existing balances and reports. Editing a payment recalculates subsequent balances. Existing single-payment records appear as Payment 1. Receipts, statements and Excel exports include both installments.

## Tests

```sh
node --test tests/tenant-payments.test.cjs
```

These use synthetic records without accessing live data. Cloud setup is described in `CLOUDFLARE_SETUP.md`.
