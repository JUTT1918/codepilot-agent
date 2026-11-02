# TODO

## 1. Coding assistant and multi-language workspace — complete
- The user requested: “Make a agent high professional level that do coding making app and website” and said “other agent can do coding understand every language or coding programing.”
- Provide a professional coding-assistant chat backed by Manus's built-in AI, with code-oriented responses and a file workspace that can edit and export code.
- The assistant should handle requests and source text across programming languages; do not claim that the browser can execute every language. Only sandboxed HTML/CSS/JavaScript can run in the live preview.
- Evidence: the browser chat reaches the managed server-side Manus AI route and returned HTTP 200 with the expected completion; the code editor supports common web, JavaScript/TypeScript, JSON, and Python highlighting, while additional language text remains editable/exportable.

## 2. Projects and live preview — complete
- The user requested: “we can link every app with him by allowing him like GitHub and also preview the agent.”
- Provide project selection, public GitHub repository URL import, private repository access through an authorized GitHub App, local project-archive import/export, and a live preview for supported web files.
- Keep the preview sandboxed and label its HTML/CSS/JavaScript execution boundary.
- Evidence: public GitHub import and project ZIP safety/preview checks passed. The preview inlines local web assets and blocks external network access.

## 3. Chat-first UI, history, settings, files, and voice — implemented; iPhone microphone permission needs on-device verification
- The user requested: “the agent has chatbox ui desgin same like MANUS AI also history button in sidebar settings or other agent can do coding”.
- Provide a polished Manus-inspired chat workspace, sidebar history, settings/agent options, and a responsive layout.
- The user requested: “also give mic to talk in voice or + icon to share files etc”.
- Provide a microphone control that records/transcribes voice on supported browsers and a plus/file control for user-selected file attachments/imports; give clear permission, loading, unsupported-file, and error states.
- Evidence: chat history, agent modes, file picker, voice recording/transcription wiring, responsive Chat/Code/Preview navigation, and microphone error states are implemented and type-check. Common private-credential files are blocked from accidental attachment. Binary attachments are identified by filename only; readable source/text attachment contents are sent with a prompt. A physical iPhone permission/transcription run has not been performed.

## 4. No user-provided API key — complete
- The user requested: “without using any api key.”
- Do not require the user to provide an AI-provider API key. Use platform-managed Manus AI and speech credentials only from trusted backend routes; never expose them in browser code. Keep the managed database disabled.
- Evidence: the managed AI chat path returned a live successful response with no user-supplied key; server-side routes hold platform credentials; project config has `server=true` and `database=false`.

## 5. Browser-local, mobile-responsive workspace — implemented; physical-device layout not separately inspected
- The user approved projects, chat history, and files stored in browser storage for this first version, with export support.
- Ensure the workspace remains usable at phone widths, with touch-accessible Chat/Code/Preview navigation and a drawer for project/history navigation.
- Evidence: local browser persistence, ZIP export, responsive styles, accessible controls, and reduced-motion support are implemented; the optimized first view builds successfully. No physical iPhone visual inspection was performed.

## 6. Private GitHub authentication and code push — implemented to the approved scope; a live account still requires the user's GitHub App setup
- The user requested: “Can you add support for private GitHub repository authentication and pushing code?”
- Add private repository access through GitHub App device authorization, not a personal access token. Provide a clear App setup path, accept its public Client ID, request only Contents read/write and Metadata read, and explain that the GitHub App must be installed only on repositories the account owner selects.
- After approval, keep the GitHub access and refresh tokens on the server; expose only an opaque Codepilot session ID to the browser. Let the authorized user list and import permitted private repositories; preserve remote branch/tree/file SHA metadata for safe change detection.
- Pushing requires an explicit confirmation showing repository, commit message, changed paths, and exact target branch. Create a new `codepilot/...` branch based on the latest imported source branch; never force-push, write directly to that source/default branch, or merge automatically. Stop on stale-file conflicts, validate paths and file limits, respect GitHub rate limits, and report the resulting branch/commit URL.
- Evidence: server routes implement device authorization, bounded server-memory token/session handling and serialized token refresh, private repository listing/import, path-level conflict detection, and branch-only push. The UI shows setup instructions, the exact outgoing paths, commit message, exact target branch, connection/disconnect state, post-push branch/commit links, and an explicit notice if the first 1,000 repository results are capped. `pnpm typecheck`, `pnpm build`, and the credential-free `pnpm test:github` smoke test pass; the smoke test exercises overlapping refresh requests, session disconnect during refresh, scoped request-body limits, and disclosed pagination truncation. The mock test does not exercise a real user account.
- External setup remaining: the user must register/install a GitHub App with the documented least-privilege permissions, select the allowed repositories, and enter its public Client ID. The physical authorization flow and a real repository push have not been exercised in the user's account.

## 7. New private repository and external deployment handoff — complete
- The user requested: “New repo bna ka is agent all file push Kerdo TAH KEH MA EASILY ISKO RAILWAY YA KAHI BE DEPLOY KERK KA USE KERLO.”
- Create a **private** `codepilot-agent` repository and push a complete clean snapshot of the tracked project files, without changing the existing Manus `origin` or copying its internal Git history. Do not place the personal token pasted in chat, any AI key, or any other secret in files, Git configuration, or commits; use the authorized GitHub account connector.
- Add a root Dockerfile, `.dockerignore`, README, and Railway deployment guide so Railway or a similar Docker host can build the source. Do not deploy publicly or create a paid external service as part of repository preparation.
- Preserve the user's original no-AI-key requirement: Manus-managed AI and speech work without a user key on Manus hosting. Those managed credentials are not portable to Railway; the README must clearly say that an external host needs a separately configured supported AI/speech service before chat/voice can work.
- Evidence: created **private** [`JUTT1918/codepilot-agent`](https://github.com/JUTT1918/codepilot-agent) with `main` and pushed a clean 46-file snapshot (initial commit `02db5800661832a702a8cddb0dfcad373ccf9fce`). The snapshot has no Manus source history and contains no personal token, `.env`, private-key file, or AI credential. The Manus canonical origin was unchanged. TypeScript, Vite production build, mocked GitHub integration, and production-mode health/route-manifest checks pass. A Docker engine was unavailable locally, so the container image itself was not built here.
- The root Dockerfile, `.dockerignore`, README, and cited Railway guide are included. No Railway project/domain was created and no external deployment was started. Chat and voice on Railway still require a separately configured supported AI/speech backend; the zero-user-key setup runs where Manus supplies its managed credentials.

## Broader-public-exposure security follow-up — pending if the app is exposed beyond this Preview
- Chat and voice routes use per-IP in-memory rate limits (30 chat and 10 voice requests per 10 minutes, per process). This reduces casual abuse but is not distributed and does not authenticate callers.
- GitHub access/refresh tokens and device codes are process-memory only; they are not persisted in browser storage or exposed in API responses/logs. Only the opaque Codepilot session ID is held in tab-scoped session storage. GitHub operations have separate limits, exact-scope review, and explicit push confirmation.
- The current project is not published and auto-publish is disabled. Before broad public exposure, add a platform-appropriate access-control/quotas layer rather than relying on process-local throttles alone.
