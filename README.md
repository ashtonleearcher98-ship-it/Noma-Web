# Noma Web

A responsive web client for the same Noma Firebase project used by the Android app. It supports verified email sign-in, a unique claimed phone number, one-to-one and group messages, and in-app voice/video calls through LiveKit. The phone number is **not verified by SMS**; do not treat it as proof of ownership. Messages are not end-to-end encrypted.

## Free GitHub Pages deployment

1. Create a **public** GitHub repository for Noma Web and upload the **contents of this folder** to its root. Commit to the `main` branch. Do not upload `node_modules` or `dist`. The `.github/workflows/pages.yml` workflow installs dependencies, builds the site, and deploys it.
2. In the repository's **Settings → Pages → Build and deployment**, select **GitHub Actions**. After the workflow completes, GitHub will show a URL like `https://USERNAME.github.io/REPOSITORY/`. The site works at a repository path because Vite builds relative asset URLs.
3. In [Firebase Console → Authentication → Settings → Authorized domains](https://console.firebase.google.com/project/noma-f813b/authentication/settings), add **`USERNAME.github.io`** (the hostname only; omit `https://` and `/REPOSITORY/`). If using a custom domain, add that hostname too. Email/Password Authentication is enabled in the Noma project. For local testing, add `localhost` separately if Firebase requires it.
4. For browser calls, update the existing Deno Playground at `https://mild-moose-1657.noma.deno.net/`: replace its code with the complete `backend/deno-standalone.js` file and deploy it. It retains the same Firebase/LiveKit environment variables and adds the `OPTIONS` preflight response and CORS headers browsers need. **Do not put `LIVEKIT_API_SECRET` into GitHub or this web client.** If the Deno Playground already has the four environment variables, leave them there.
5. Try two distinct verified accounts on separate browsers/devices. Claim different phone numbers, find one by its full international number, exchange messages, then test a voice/video call. The browser must be granted microphone/camera access, and the site must be served over HTTPS (GitHub Pages provides it).

The Firebase web configuration in `src/firebase.js` is a public client identifier, not a server credential. The call token endpoint verifies Firebase ID tokens and chat membership before issuing room tokens. Free tiers have quotas; account verification is by email, and incoming ringing is available while a client is open.

## Development

```bash
npm ci
npm run dev
npm run build
```

The app uses Vite with relative asset paths so no repository name is baked in. `npm run build` writes the site to `dist/`.
