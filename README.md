# Hack Carrier 2026

[T3 Stack](https://create.t3.gg/) project bootstrapped with `create-t3-app` (Next.js, TypeScript, tRPC, Prisma + PostgreSQL, Tailwind CSS, NextAuth).

## What's next? How do I make an app with this?

We try to keep this project as simple as possible, so you can start with just the scaffolding we set up for you, and add additional things later when they become necessary.

If you are not familiar with the different technologies used in this project, please refer to the respective docs. If you still are in the wind, please join our [Discord](https://t3.gg/discord) and ask for help.

- [Next.js](https://nextjs.org)
- [NextAuth.js](https://next-auth.js.org)
- [Prisma](https://prisma.io)
- [Tailwind CSS](https://tailwindcss.com)
- [tRPC](https://trpc.io)

## Getting started

```bash
npm install
# Start PostgreSQL (Docker): ./start-database.sh
npm run db:push
npm run dev
```

To start/stop the PostgreSQL database, you can use the provided scripts:

```bash
docker stop hackcarrier-2026-postgres
docker start hackcarrier-2026-postgres
```

## Learn More

To learn more about the [T3 Stack](https://create.t3.gg/), take a look at the following resources:

- [Documentation](https://create.t3.gg/)
- [Learn the T3 Stack](https://create.t3.gg/en/faq#what-learning-resources-are-currently-available) — Check out these awesome tutorials

You can check out the [create-t3-app GitHub repository](https://github.com/t3-oss/create-t3-app) — your feedback and contributions are welcome!

## How do I deploy this?

Follow our deployment guides for [Vercel](https://create.t3.gg/en/deployment/vercel), [Netlify](https://create.t3.gg/en/deployment/netlify) and [Docker](https://create.t3.gg/en/deployment/docker) for more information.

### Vercel + Neon

`.env.local` is not deployed. In Vercel → Project Settings → Environment Variables, set at least:

| Key | Value |
| --- | --- |
| `AUTH_SECRET` | same as `.env.local` |
| `DATABASE_URL` | Neon **pooled** URL (`…-pooler.…`, `sslmode=require`) |
| `DATABASE_URL_UNPOOLED` | Neon **direct** URL (`…`, `sslmode=require`) |
| `HELLO_BACKEND_URL` | (server-side hello cURL target; defaults to `https://$VERCEL_URL/api/hello` on Vercel) |

Optional: `AUTH_DISCORD_ID`, `AUTH_DISCORD_SECRET`, `DATABASE_URL_UNPOOLED` (direct URL for migrations), `HELLO_BACKEND_URL` (server-side hello cURL target; defaults to `https://$VERCEL_URL/api/hello` on Vercel). `prisma.config.ts` loads `.env.local` only when present; on Vercel it uses these injected vars, so the Neon connection string stays the same.

### Hello cURL test

The home page button **Say Hello (cURL)** runs entirely on the server: tRPC `post.helloBackend` issues an HTTP GET (Node `fetch`, same idea as cURL) to `/api/hello` and returns `Hello World from the backend`.

Manual checks:

```bash
curl http://127.0.0.1:3000/api/hello
curl -X POST http://127.0.0.1:3000/api/trpc/post.helloBackend
# after deploy:
curl https://<your-app>.vercel.app/api/hello
```
