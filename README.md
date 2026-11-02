# Codepilot

Codepilot is a browser-local coding workspace with a Manus-backed coding assistant, project history, a code editor, a sandboxed web preview, archive import/export, voice transcription, and public/private GitHub repository workflows.

## Run on Manus

The managed Manus Preview supplies the backend AI and speech service credentials, so the app does not ask you for an AI provider key. Open the project's Preview to use the complete zero-user-key experience.

## Run locally

Use Node.js 22 or later and pnpm 11.25.0:

```sh
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install
pnpm dev
```

Useful project commands:

```sh
pnpm typecheck
pnpm build
pnpm test:github
```

## Connect private GitHub repositories

Register and install your own GitHub App with **Device Flow** enabled and only **Metadata: read-only** plus **Contents: read and write** permissions. Install it only on the repositories you intend to use. In Codepilot, open **Private access**, enter the App's public Client ID, and authorize from GitHub. See [the GitHub App setup guide](docs/github-app-setup.md).

The app does not need your personal access token or the App's client secret. Device and user tokens stay in server memory, so reconnect after a server restart. Codepilot pushes changes only to a new `codepilot/...` branch after showing the exact repository, file changes, message, and branch for confirmation. It never writes to or merges into the imported source/default branch.

## Deploy to Railway or another Docker host

The repository has a multi-stage root [`Dockerfile`](Dockerfile) and a secret-safe [`.dockerignore`](.dockerignore). See [the Railway deployment guide](docs/railway-deploy.md) for GitHub import, health checks, environment boundaries, and operational limitations.

**Important:** the no-key Manus AI and speech integrations work when Manus provides its managed backend credentials. Those credentials are not included in this repository and are not available to a Railway deployment. On Railway, chat and transcription will remain unavailable until you separately configure a supported model and speech backend. Do not add a sandbox credential or the personal GitHub token from chat to this repository. The project has no end-user authentication or shared durable session database; add access control and stronger quotas before exposing a non-Manus deployment publicly.
