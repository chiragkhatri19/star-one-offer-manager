# Star One Offer Manager

Desktop app (Electron) that lets Star One Gym change the seasonal offer on the website without touching code.
It publishes to `https://staronegym.com/api/offer` (a Cloudflare Pages Function in the website repo that stores ## Install
Download `StarOne-Offer-Manager-<version>-setup.exe` (or the portable `.exe`) from the latest Release.
The app is unsigned, so Windows SmartScreen shows a warning the first time: click **More info → Run anyway**.

## Setup (once)
Settings → type the **Offer Manager password** → Test connection → Save. The website address is already filled in.
The password is the website's `OFFER_KEY` Pages secret; it is stored encrypted on the PC.

with **Contents: read and write** on that one repo only. Test connection → Save.

## Develop
```
npm install
npm start        # run
npm run dist     # build installers into release/
```
