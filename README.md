# Forge

Tasks, a focus timer, an infinite board and an AI coach you can talk to. It runs on **your own** free Cloudflare account, keeps your data in **your own** Neon database, and works on your phone and computer, online or offline.

Nobody else hosts your Forge: you deploy your own copy, and your keys and data never pass through anyone else's server.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR-NAME/forge)

## What you need (all free)

| What | Why | Where |
|---|---|---|
| Cloudflare account | Runs your Forge and stores your images (R2) | [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) |
| Neon account | The database for your tasks, notes and projects | [console.neon.tech](https://console.neon.tech) |
| NVIDIA key *(optional)* | The coach's brain | [build.nvidia.com](https://build.nvidia.com) → any model → **Get API Key** |
| Groq key *(optional)* | Voice: talk instead of type | [console.groq.com/keys](https://console.groq.com/keys) |

## Set it up in 5 steps

1. **Turn on R2** in Cloudflare: dashboard → **R2 Object Storage** → **Get started**. Cloudflare asks for a card, but nothing is charged inside the free 10 GB.
2. **Click "Deploy to Cloudflare"** above. It copies Forge into your account, creates the `forge-files` bucket, and asks for a **PASSPHRASE**: the password you'll log in with. Pick something long.
3. **Make a Neon project** at console.neon.tech, press **Connect**, and copy the connection string (`postgresql://…`).
4. **Open your Forge** at the address Cloudflare shows (`https://forge.<you>.workers.dev`), log in, and follow the setup: your name, then the Neon string, a storage check, and the coach and voice keys. Each one has a **Test** button.
5. **Install it**
   - **iPhone:** open the address in Safari → Share → **Add to Home Screen**.
   - **Computer:** in Chrome or Edge, click the install icon in the address bar.

Change keys any time in **Settings → Connections**.

### From the terminal instead

```bash
git clone https://github.com/YOUR-NAME/forge && cd forge
npm install
npx wrangler login
npx wrangler r2 bucket create forge-files
npx wrangler secret put PASSPHRASE
npx wrangler deploy
```

## How it works

- **One Cloudflare Worker** serves the app and its API (`cloud/worker.js`). The R2 bucket is linked to it in `wrangler.jsonc`, so it needs no key.
- **Every task, note and project is its own row** in Neon. Each device keeps a full copy and syncs only what changed. If two devices edit the same thing, the newer edit wins.
- **Keys** (Neon, NVIDIA, Groq) live in a private file in your bucket. Only your Worker reads them; they are never sent to the browser.
- **Offline:** the app and the images you've viewed are saved on each device. Changes made offline sync when you're back online.
- **Backups:** every night a snapshot of everything goes into your bucket under `backups/`, and the last 30 are kept. You can also use **Settings → Data → Export backup** at any time.

## Free limits

| Service | Free | Plenty for |
|---|---|---|
| Workers | 100,000 requests/day | One person syncs a few hundred a day |
| Neon | 0.5 GB | Years of tasks and notes |
| R2 | 10 GB, free downloads | Thousands of board images (they're shrunk before upload) |

## Moving from the old local Forge

If you used the local version (`node server.js`), move everything (tasks, board, images, chat) into your cloud Forge after setup:

```bash
node cloud/migrate.mjs https://forge.<you>.workers.dev
```

It asks for your passphrase. Your local `data/` folder is left as it was.

## Developing

```bash
npm install
cp .dev.vars.example .dev.vars   # set PASSPHRASE
npm run dev                      # http://localhost:8787
```

If your internet provider's DNS refuses Neon's addresses (`Query refused`, seen on Jio), run `node tools/neon-dev-proxy.js` and add `NEON_DEV_PROXY=http://127.0.0.1:8790/sql` to `.dev.vars`. A deployed Forge doesn't need this.

The old local version still runs with `node server.js` (or `Forge.vbs` on Windows) and keeps data in `data/`.
