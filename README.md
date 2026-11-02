# Star One Offer Manager

Desktop app (Electron) that lets Star One Gym change the seasonal offer on the website without touching code.
It edits `src/data/offer.json` in the website repo through the GitHub API; Cloudflare Pages rebuilds the site.

## Install
Download `StarOne-Offer-Manager-1.0.0-setup.exe` (or the portable `.exe`) from the latest Release.
The app is unsigned, so Windows SmartScreen shows a warning the first time: click **More info → Run anyway**.

## Setup (once)
Settings → GitHub: repository `owner/name` of the website, branch `main`, file `src/data/offer.json`,
and a fine-grained token with **Contents: read and write** on that one repo only. Test connection → Save.

## Develop
```
npm install
npm start        # run
npm run dist     # build installers into release/
```
