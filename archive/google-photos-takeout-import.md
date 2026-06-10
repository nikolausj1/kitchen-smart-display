---
title: "Google Photos to Immich - Curated Album Import"
created: 2026-06-08
modified: 2026-06-08
version: 1.0
author: Claude Opus 4.7 (claude-opus-4-7)
tags:
---

# Google Photos to Immich - Curated Album Import

This document is a handoff to Claude Code for executing a Google Photos Takeout import into Immich. Read this whole file before starting. Reference `Smart Displays.md` for the broader Kitchen Smart Display project context, and `CLAUDE.md` for project standards (Markdown front matter, no em dashes, etc).

## Why This Exists

The Kitchen Smart Display reads its photo slideshow from a self-hosted Immich server. Justin's photo library lives in Google Photos. Rather than commit to a full library migration today, the plan is to import a small set of curated albums to:

1. Give the kitchen display real curated content to test against
2. Verify the Takeout + immich-go pipeline works end-to-end
3. Defer the full ~220GB Google Photos migration to a future session

A previous attempt used the wrong import method (direct "Download all" from album page in Google Photos web UI) which strips metadata. Those photos landed in Immich with corrupt dates (showing May 28 2026 instead of their actual capture date). They need to be purged before the new import.

## Goal

End state:

- Wrong-date photos from the previous attempt are removed from Immich
- 2-5 curated Google Photos albums are present in Immich
- All photos have correct capture timestamps from the JSON sidecars
- GPS data is preserved where the source had it
- Album structure in Immich matches what was in Google Photos

## Current State

- Immich server running at `http://192.168.6.128:2283` on the Synology NAS
- Justin is the admin user
- An API key called `kitchen_display` exists in 1Password but it was set up READ-ONLY for the kitchen display kiosk. It does NOT have upload permissions, so immich-go will fail with it. **A new API key with upload permissions is needed for this import.** See Phase 3 below.
- Mac is **Apple Silicon MacBook Pro**
- `immich-go` binary was downloaded to `~/Downloads/immich-go` but it's the Intel (x86_64) build. Running it returned "exec format error." It needs to be re-downloaded as `arm64`.

## Justin Will Need to Provide

- Confirm the list of albums to import (probably "Best of 2025," "Wizarding World Vacation," and maybe 1-3 more - confirm before kicking off Takeout)
- The new API key for upload (Phase 3, Justin generates in Immich UI)

---

## Workflow

### Phase 1: Clean up the bad-date photos from Immich

Goal: Remove the previously-imported photos that have wrong timestamps (May 28 2026 or similar future dates).

Recommended approach (web UI, simplest):

1. Justin opens Immich in browser
2. Navigate to Photos view
3. Scroll to May 28 2026 (it'll be at the top since it's "tomorrow")
4. Select all the bad-date photos (shift-click first and last)
5. Click Trash icon to move to Trash
6. Navigate to Trash, Empty Trash

If Claude Code wants to handle this via API instead:

- The kitchen_display key does NOT have `asset.delete` permission
- Use the new upload key (Phase 3) which can include delete permission, OR have Justin do it manually in the web UI
- Endpoint: `DELETE /api/assets` with bulk asset IDs

### Phase 2: Re-download immich-go for arm64

1. Open https://github.com/simulot/immich-go/releases
2. Under Assets for the latest release, download `immich-go_Darwin_arm64.tar.gz`
3. Extract:

   ```bash
   cd ~/Downloads
   tar -xzf immich-go_Darwin_arm64.tar.gz
   ```

4. The old wrong-architecture binary at `~/Downloads/immich-go` will be overwritten
5. Strip macOS quarantine:

   ```bash
   xattr -d com.apple.quarantine ~/Downloads/immich-go
   ```

6. Verify it runs:

   ```bash
   ~/Downloads/immich-go --version
   ```

   Should print a version string. If "exec format error" persists, something else is wrong - report back.

### Phase 3: Generate a new Immich API key with upload permissions

The `kitchen_display` key in 1Password is read-only and will not work for immich-go uploads. Justin needs to generate a second key.

Justin does this in the Immich web UI:

1. Click avatar (top right) > Account Settings
2. Go to API Keys (left nav)
3. Click Create new API key
4. Name: `immich-go-import` (or similar)
5. Permissions: at minimum these must be checked:
   - `asset.upload`
   - `asset.read`
   - `asset.update` (for metadata writes)
   - `album.create`
   - `album.read`
   - `album.update`
   - `albumAsset.create`
   - `albumAsset.delete`
   - `asset.delete` (if Claude Code is doing the Phase 1 cleanup via API)
   - All the standard read permissions
6. Click Create. Copy the key string immediately (only shown once).
7. Save it in 1Password under a new entry, name it `immich-go-import`.

Claude Code: ask Justin for this key when ready to run immich-go. Treat it as a secret - don't echo it back in logs or commit it to anything.

### Phase 4: Takeout request for selected albums

Justin does this in his browser:

1. Open https://takeout.google.com
2. Click **Deselect all** at the top
3. Scroll down, check ONLY **Google Photos**
4. Inside the Google Photos row, click **All photo albums included**
5. In the modal that opens:
   - Click Deselect all
   - Check ONLY the specific albums Justin wants (NOT the "Photos from YYYY" auto-buckets)
6. Click OK
7. Scroll to bottom, click **Next step**
8. Frequency: Export once
9. Delivery method: Send download link via email
10. File type: .zip
11. File size: 50 GB
12. Click **Create export**

Google emails Justin when ready. Usually 30 min to a few hours for a small album-only export.

### Phase 5: Download zips when email arrives

When the email arrives:

1. Click the link in the email to open the Takeout download page
2. Even small exports may be split into 2-3 zip files. Download all of them.
3. Save to a consistent folder. Suggested:

   ```
   ~/Downloads/Takeout-curated-YYYY-MM-DD/
   ```

   where YYYY-MM-DD is today's date.

4. Verify all zips downloaded by checking file count and total size matches what Takeout shows on the download page.

### Phase 6: Extract

In Terminal:

```bash
cd ~/Downloads/Takeout-curated-YYYY-MM-DD/
for f in *.zip; do
  unzip "$f"
done
```

Or simpler: double-click each zip in Finder. They merge into a `Takeout/Google Photos/` tree.

Verify structure:

```bash
ls ~/Downloads/Takeout-curated-YYYY-MM-DD/Takeout/Google\ Photos/
```

Should list each album as a folder. Inside each folder should be a mix of .HEIC / .JPG / .MOV files and matching `.supplemental-metadata.json` (or `.json`) sidecars.

### Phase 7: Dry-run

Construct the command:

```bash
~/Downloads/immich-go upload from-google-photos \
  --server=http://192.168.6.128:2283 \
  --api-key=<paste-the-immich-go-import-key> \
  --dry-run \
  ~/Downloads/Takeout-curated-YYYY-MM-DD/Takeout
```

Note: the path ends at `Takeout/` (parent of `Google Photos/`), NOT at `Google Photos/` itself.

What to look for in the output:

- `Found X albums` - should match Justin's selected album count
- `Found Y assets` - sanity check against Google Photos count
- Number of assets that "will be uploaded" - look for any "0 valid" anomalies
- Any red error lines about missing JSON sidecars - a few warnings are OK; many errors mean the path is wrong

If the dry-run looks clean, proceed. If something looks off:

- Wrong album count: re-check Takeout selection
- Lots of missing JSON warnings: check that the path is right and that extraction completed
- API auth errors: confirm the new key has `asset.upload` permission

### Phase 8: Real import

Open another terminal tab and start caffeinate so the Mac doesn't sleep:

```bash
caffeinate -i &
```

Then run the same command without `--dry-run`:

```bash
~/Downloads/immich-go upload from-google-photos \
  --server=http://192.168.6.128:2283 \
  --api-key=<paste-key> \
  ~/Downloads/Takeout-curated-YYYY-MM-DD/Takeout
```

For a small batch (a few thousand photos), this takes 10-30 minutes. Monitor progress in the terminal.

If interrupted, just re-run the same command. immich-go checks each asset against the server and skips already-uploaded ones.

After completion, kill caffeinate:

```bash
fg
# Ctrl+C
```

### Phase 9: Verify

Justin or Claude Code (via Cowork later) should check:

1. **Albums view in Immich:** confirm each selected album name is present and roughly the right photo count
2. **Spot-check 5-10 random photos:**
   - Click into the photo, hit (i) info icon
   - "Date Taken" should match when the photo was actually captured (NOT today's date)
   - GPS coordinates should be present if the original had them
3. **Map view:** photos with GPS should appear as pins in the right locations
4. **Compare counts:** total photos imported should be close to total in Google Photos (small discrepancies for failed assets are expected)

If verification passes, the import is good.

---

## Gotchas

- **Live Photos.** iPhone Live Photos export as paired `.HEIC` + `.MOV` files with matching base names. immich-go pairs them automatically as long as both exist.
- **Edited photos.** Google Photos exports both the original AND an `-EDITED` version. immich-go uploads both by default. If duplicates appear in Immich, this is why.
- **JSON filename truncation.** If a photo filename is over ~46 chars, Google truncates the JSON sidecar filename. immich-go knows about this and handles it. Should not require intervention.
- **HEIC handling.** Immich displays HEIC natively. If photos appear broken/missing thumbnails, check that Immich's machine-learning service has run its thumbnail generation job (Administration > Jobs).
- **Album naming.** Album names with special characters (slashes, colons) get sanitized in the folder structure. If you see "Album Name " (trailing space) or similar weirdness in Immich, that's why.
- **"Photos from YYYY" folders.** If they appear in the extracted Takeout despite Justin only selecting named albums, ignore them. immich-go will dedup against the album folders.

## Safety Net

- Keep the Takeout zips and extracted folder for at least a week after successful import.
- Do NOT delete the source albums from Google Photos. They stay where they are. This whole import is additive.
- If the import goes wrong, delete from Immich (filter by upload date, Trash, empty), then re-run with corrected settings. Source data on Google's side is unaffected.

## Out of Scope (Future Work)

- Full Google Photos library Takeout (the 220GB export) is deferred. Don't do it in this session.
- Hard drive imports of old digital camera era photos: deferred.
- iPhone Immich iOS app auto-backup setup: deferred (separate session).
- 3-2-1 backup architecture (external drive + B2 offsite): deferred.

## Reporting Back

After completion, Claude Code should write a brief summary to `~/Library/CloudStorage/Dropbox/_Projects/Smart Display/import-log-YYYY-MM-DD.md` covering:

- Which albums were imported
- Total asset count
- Any failures or skipped files
- Verification results
- Anything Justin should manually review

That gives the Cowork session a clean handoff to continue from.

---

## Quick Reference - All Commands in Order

```bash
# Phase 2: Install immich-go
cd ~/Downloads
tar -xzf immich-go_Darwin_arm64.tar.gz
xattr -d com.apple.quarantine ~/Downloads/immich-go
~/Downloads/immich-go --version

# Phase 6: Extract Takeout (after download)
cd ~/Downloads/Takeout-curated-YYYY-MM-DD/
for f in *.zip; do unzip "$f"; done

# Phase 7: Dry-run
~/Downloads/immich-go upload from-google-photos \
  --server=http://192.168.6.128:2283 \
  --api-key=<key> \
  --dry-run \
  ~/Downloads/Takeout-curated-YYYY-MM-DD/Takeout

# Phase 8: Real import
caffeinate -i &
~/Downloads/immich-go upload from-google-photos \
  --server=http://192.168.6.128:2283 \
  --api-key=<key> \
  ~/Downloads/Takeout-curated-YYYY-MM-DD/Takeout
fg
# Ctrl+C to stop caffeinate
```
