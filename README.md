# Jasmine Residency

Family rent manager with local storage, JSON backup/restore, and authenticated Cloudflare sync.

## Run locally

From this folder:

```sh
python3 -m http.server 8765
```

Open http://localhost:8765. Local preview data is separate from the live website. The simple local server does not provide cloud sync.

## Flats and checked-out tenants

On **All Flats**, use **+ Add Flat** to create a vacant unit, then tap its card to add a renter. Flat names must be unique (ignoring case and surrounding spaces). The **Checked-out tenants** folder keeps previous renters, their documents and billing history separately. Checkout leaves the flat available for a new renter. An old renter cannot be reopened while the flat has another active renter. Vacant flat records are included in cloud sync and JSON backups.

## Tenant information

Open a flat and select **Tenant Info**. Expand each section for owner details, personal information, permanent/local addresses, IDs, references, previous residence and employment. A third contact is optional, matching the supplied verification form. Existing tenant data stays intact; new fields start blank. Use **Save Changes** after edits or photo/signature uploads.

Date of birth has separate day, month and year fields, so the year can be typed directly. Impossible dates are rejected.

Photographs and signatures accept JPG, PNG and WebP up to 5 MB and are compressed before storage. New files are stored separately from the tenant JSON in IndexedDB on the device and authenticated D1 attachment records in the cloud. Existing inline photographs continue to work. Use **Save Changes** and confirm cloud sync finishes before switching devices.

**Print verification details / PDF** creates a two-page A4 details sheet with the tenant photograph in the upper-right corner and signatures on page two. It uses the current form values. Print at the default scale on A4; unusually long text that cannot fit prompts you to shorten it instead of silently clipping fields. This is a details sheet for completing the police application, not an official submission or a filled copy of the original PDF.

**Preview agreement draft** populates a printable draft using the supplied leave and licence template. Enter the agreement dates, duration, property details, amounts in words and inventory first. Missing values remain visible blanks. Fixed clauses are reproduced from the supplied template and need review; this feature does not certify their legal accuracy. The sample person's ID, name and address are not embedded in the new template. Agreement dates and deposits are taken from entered records, not the inconsistent sample values.

## Two installments

**Add Bill / Payment**, **History → Edit**, and **Month Entry** support Payment 1 and Payment 2 with separate amounts, dates and modes. To record a later installment for an existing month, edit that month's entry. The aggregate amount remains compatible with existing balances and reports. Editing a payment recalculates subsequent balances. Existing single-payment records appear as Payment 1. Receipts, statements and Excel exports include both installments.

## Multiple electricity meters

Open **Electricity meters** to name meters, set opening readings and rates, or add another meter (up to eight). Flat 104 (Hall) defaults to two meters and 002 (Office) to four. Enter each additional meter’s readings or a direct bill amount. Add Bill, History → Edit and Month Entry total all meters into the monthly electricity charge. Readings carry forward independently; receipts, messages and exports include the breakdown. Historical bills retain their original amounts. Use **Add configured meters to this bill** when deliberately adding meters to an older bill.

## ID uploads and Aadhaar suggestions

In **Tenant Info → ID documents and Aadhaar import**, upload PDF, JPG, PNG or WebP files up to 5 MB each (up to ten documents per tenant). **Read Aadhaar details** reads English text locally in the browser using bundled PDF.js and Tesseract.js. No document is sent to an OCR provider. Text PDFs are read directly; scans and images use OCR. Scanned documents need a clear image, and the first OCR run downloads the bundled recognition libraries. OCR supports documents of up to four pages; password-protected PDFs require an unlocked copy or an image.

Review and edit the suggested name, full birth date, gender, ID number and address; select the fields to apply, then **Save Changes**. Existing values remain unchanged until you apply suggestions. Masked IDs stay masked, and a year of birth does not become an invented full date. Extraction is a convenience and does not validate an identity document.

Files upload before their tenant references. Files are protected by the same Cloudflare Access checks as tenant data and are never cached by the service worker. The attachment API creates its tables additively on first use. Files are split into 512 KiB rows to stay below D1’s row limit. The app reserves 400 MiB for file content, leaving room within the D1 free plan’s 500 MB database limit. **Check file storage** shows current use. Removed files remain stored for undo and backup compatibility; removal from a tenant does not reclaim cloud space.

JSON exports include saved photos and documents, fetching cloud copies when needed. If a file is unavailable, export reports the error rather than producing an incomplete backup. Imports restore the embedded files and upload them on the next successful sync. Backups contain personal documents and should be kept privately.

## Tests

```sh
node --test tests/*.test.*
```

These use synthetic records without accessing live data. Cloud setup is described in `CLOUDFLARE_SETUP.md`.
