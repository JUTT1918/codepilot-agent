# Codepilot — implementation plan

## Approved scope

Build a polished, responsive coding-agent workspace inspired by Manus's chat-first interaction pattern. The application includes a project/history sidebar, agent settings, chat, file/project workspace, code editor, file and microphone input, preview, and public/private repository experiences. The selected design direction is a graphite-and-indigo developer cockpit with crisp typography, restrained motion, a distinct Codepilot mark, and a compact touch-friendly mobile layout.

Use the built-in Manus AI and speech services through a trusted project backend; do not require an AI-provider API key. The managed server capability is enabled and the managed database remains disabled. Project files and conversations are stored in browser storage and can be exported. The assistant can discuss and generate code across languages; the in-browser live preview executes only sandboxed HTML/CSS/JavaScript.

The user has additionally requested private GitHub repository authentication and pushing code. Implement GitHub App user authorization through the OAuth device flow. The GitHub App's public Client ID is entered in the Private Access setup panel; no client secret, personal access token, redirect callback, or GitHub token is requested from the user. The app owner must register a GitHub App with device flow enabled and the minimum repository permissions, and install it only on the repositories the owner selects. Access is still constrained by both the GitHub App installation and the user's own repository permission.

The user also asked for a new repository containing all project files, ready to deploy through Railway or a similar host. Create a **private** `codepilot-agent` repository in the authenticated user's GitHub account and push a clean source snapshot. Do not alter the existing Manus canonical `origin`, include the current repository's internal Git history, or put any credential in the export. Add a root Dockerfile, `.dockerignore`, a project README, and a Railway deployment guide; Railway can auto-detect a root `Dockerfile`, and the app already honors its runtime `PORT` and exposes `/api/health`.

Do not deploy to Railway in this step. The built-in, no-user-key Manus AI and Speech service credentials are provided only by the Manus-hosted backend; they must not be exported to another host. An external deployment needs a separately configured compatible model/speech backend and authenticated usage quotas before public exposure. State this boundary in the README and deployment guide, and never add a sandbox/API key or the user's posted personal token to source or Git history.

## Implementation approach

- **Frontend:** React, TypeScript, and Vite. Use a component-based single-page workspace, responsive navigation, a chat composer with file picker and microphone controls, project tree/editor, settings, and sandboxed preview. Store projects and conversations in browser storage. Support project archive import/export. Workspace source text is sent to Manus AI only when the user submits a prompt.
- **Backend:** Node.js/Express on the managed WebDev server. Preserve the health, managed chat, and speech proxy routes. Add GitHub App device-flow, private repository listing/import, and push routes. Do all GitHub API calls in the backend; never return a GitHub access/refresh token to the browser, write it to local/session storage, or include it in logs. Keep the GitHub App client ID as public configuration only.
- **Device authorization:** The user enters a public GitHub App Client ID. The backend requests a device code with `offline_access`, stores the private device code in server memory, and returns only the user code and GitHub verification URL. The UI polls at no faster than GitHub's returned interval and handles pending, `slow_down`, denial, and expiry. On approval, keep GitHub access/refresh tokens in process memory and return only a cryptographically random opaque Codepilot session ID. The browser keeps that opaque ID for the current tab/session; disconnect clears the server session. Refresh tokens are rotated server-side. A backend restart requires reconnection because the database is intentionally disabled.
- **Repository import:** After authorization, list up to 1,000 repositories the authenticated user and app installation can access, and visibly disclose if results were capped. Fetch repository metadata and selected text/source blobs through the authenticated backend, with file count/size limits and safe-path checks. Store the repository owner/name, private flag, default branch tip/tree SHAs, and imported file blob SHAs in browser-local project metadata for change detection. Keep public URL import available without auth.
- **Push safety:** Require an explicit user confirmation showing the target repository, commit message, exact added/changed/deleted paths, and exact target branch name. Detect stale imported file conflicts against the current source-branch tree and stop rather than overwrite silently. Create the user-visible `codepilot/<date>-<random>` branch from the latest imported source-branch tip (the default branch on the initial private-repository import); create Git tree/commit/ref through GitHub's Git Database API. Never force-update, push directly to, or merge into the source/default branch. Return the created branch/commit URL and let the user review/open a pull request in GitHub. Require `Contents: read & write` and `Metadata: read`; block `.github/workflows/` changes unless the app also receives a separate Workflows permission (do not request that permission in this scope).
- **Session/security boundaries:** Server-side GitHub user tokens and device codes exist only in bounded, expiring in-memory maps. The browser receives an opaque Codepilot session ID, not a GitHub token. A browser reload may keep that opaque ID in tab-scoped session storage; server restarts or session expiry require reconnecting. Serialize refresh-token rotation per session so concurrent expired-token requests share one in-flight refresh, and don't resurrect a disconnected session. Provide an explicit Disconnect control. Apply separate bounded rate limits to device start/poll, repository operations, and push; respect GitHub's returned rate-limit/backoff headers and never automatically repeat an ambiguous write.
- **Runtime:** Serve the Vite UI and API from configured port 3000, keeping browser requests origin-relative. Preserve `public/manus-routes.json`. Prepare a production build and server entrypoint, but do not claim publication unless separately confirmed.

## Project structure

- `src/main.tsx`, `src/App.tsx`: bootstrap, application workspace state, imported repository baseline metadata, and action coordination.
- `src/components/`: sidebar, chat, composer, file tree, lazy editor, preview, repository/device-flow dialog, push confirmation, settings, and common dialogs.
- `src/lib/`: browser persistence, archive handling, public GitHub importer, authenticated GitHub client, Git blob hashing/change calculation, API clients, and preview utilities.
- `server/boot.ts`, `server/index.ts`, `server/rateLimit.ts`, `server/routes/`: Vite/Express runtime, API app, limits, chat, transcription, GitHub authorization/token session, private importer, and safe push.
- `public/manus-routes.json`: current page route declaration.
- `public/logo.svg`, `app.config.ts`: site mark and project logo metadata.
- `docs/github-app-setup.md`: concise user-facing GitHub App registration and permission setup.
- `docs/railway-deploy.md`, `README.md`: portable build/run guidance and explicit external AI-service limitations.
- `Dockerfile`, `.dockerignore`: multi-stage, lockfile-pinned Node deployment image without local credentials, dependencies, or build artifacts in the context.
- `scripts/github-integration-smoke.mjs`: credential-free mock test for device authorization, private import, conflict stops, and branch-only pushes (`pnpm test:github`).
- `plan.md`, `TODO.md`: approved design, implementation decisions, explicit outcome acceptance criteria, and remaining setup/device-verification boundaries.

## Design direction

- **Design Movement:** modern developer-tool editorialism with a quiet studio-like dark canvas and high-contrast technical typography.
- **Core Principles:** fast orientation; conversation stays primary; code and preview remain one gesture away; visible permission boundaries; usable at phone widths.
- **Color Philosophy:** deep graphite surfaces reduce glare and frame content; a restrained electric-indigo signature accent makes the workspace feel precise and capable; cool muted neutrals keep long code and chat sessions calm.
- **Layout Paradigm:** an asymmetric workspace rail, conversation canvas, and selectively expanded workbench; on mobile, history becomes a drawer and Chat/Code/Preview become touch-sized modes.
- **Signature Elements:** compact angular C-shaped code mark; softly outlined active-project capsule; thin indigo focus/running-state glows used sparingly.
- **Interaction Philosophy:** predictable keyboard and touch actions, explicit consent states, clear loading/error/retry states, and no deceptive connected/generated status. A push always previews its exact scope and asks the user to confirm.
- **Animation:** short 140–220 ms opacity/translate transitions; respect reduced-motion preferences; no looping decorative motion.
- **Typography System:** DM Sans for interface and DM Mono for code, with system sans/monospace fallbacks; compact but generous line-height hierarchy for dense technical content.
- **Brand Essence:** a focused coding workspace that turns natural-language requests into understandable, editable code; capable, calm, transparent.
- **Brand Voice:** direct, helpful, technically clear. Example lines: “Describe the change. Keep control of the files.” “Preview what this workspace can run; export everything you own.”
- **Wordmark & Logo:** custom angular C-shaped code mark paired with a restrained lowercase wordmark, created in project SVG/CSS rather than a stock logo.
- **Signature Brand Color:** electric indigo.

## Material constraints

The browser-local app has no durable cross-device account or database. In-memory GitHub tokens will be lost on project server restart, requiring reconnection. The GitHub App registration and installation selection are owned by the user and cannot be created on their behalf; the Client ID is public configuration. Private repository features remain unavailable until a valid App is registered and installed with the stated permissions. GitHub rate limits are respected; ambiguous pushes are not retried automatically. Chat and transcription have per-IP, in-memory limits but no caller accounts/distributed quotas; add stronger platform access controls before broad public exposure. Only HTML/CSS/JavaScript run in preview, which is sandboxed and network-isolated. No user-provided AI API key is needed on Manus hosting. Manus AI/Speech platform credentials are not portable to Railway or other third-party hosts; no-key AI works only where Manus supplies those managed services.

## Official GitHub references reviewed

- [Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app) — device flow setup, client ID, minimal permissions, and callback URL behavior.
- [Generating a user access token for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app) — device-code flow, `offline_access`, interval and polling errors.
- [Refreshing user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens) — eight-hour access-token and six-month refresh-token lifetimes; server-side token rotation.
- [Authenticating with a GitHub App on behalf of a user](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user) — access bounded by user rights, App permissions, and installation.
- [Choosing permissions for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app) — least privilege and Contents permission for Git access.
- [Installing your own GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app) — “Only select repositories” installation boundary.
- [REST API endpoints for Git trees](https://docs.github.com/rest/git/trees) and [Git references](https://docs.github.com/rest/git/refs) — building commits and creating non-force branch references.
- [REST API rate limits](https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api) — rate-limit headers and retry/backoff behavior.
