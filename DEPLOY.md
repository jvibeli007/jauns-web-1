# Deploy

## GitHub Pages

1. Push this folder to `jvibeli007/jauns-web-1`.
2. Open the repository on GitHub.
3. Go to Settings → Pages.
4. Set Source to GitHub Actions.
5. Run the workflow when you want a fresh snapshot:
   Actions → Request celebrity snapshot → Run workflow.
6. Open the Pages URL after deployment completes.

For a public repository named `jvibeli007/jauns-web-1`, the expected URL is:

```text
https://jvibeli007.github.io/jauns-web-1/
```

## Per-request Update

The workflow does not run on a schedule. Trigger it manually whenever you want a fresh snapshot. It performs these steps:

1. Generate the latest `data/snapshot.json`.
2. Save a dated copy in `data/history/`.
3. Commit the data update when files changed.
4. Deploy the static site to GitHub Pages.

## Local Validation

```bash
node scripts/update-snapshot.mjs
node scripts/serve.mjs
```

Open:

```text
http://127.0.0.1:4173/
```

If network access is unavailable:

```bash
node scripts/update-snapshot.mjs --offline
```
