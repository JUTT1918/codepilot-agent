# Deploying Codepilot on Railway

## Build and service setup

Codepilot includes a root `Dockerfile`, so Railway can build it as a container when you import the GitHub repository. Railway documents deployment from a GitHub repository and automatic use of a root file named exactly `Dockerfile`.[1] The container build installs the pinned pnpm dependencies, builds the browser UI, and starts the Express server. The server binds to `0.0.0.0`, honors Railway's runtime `PORT`, and exposes `GET /api/health` for service health checks.

1. Create a Railway project and choose **Deploy from GitHub repo**.
2. Select the private `codepilot-agent` repository and its `main` branch. Authorize Railway to access that private repository if asked.
3. Deploy the service. Railway should detect the root `Dockerfile` automatically.[1] In the service settings, use `/api/health` as the health-check path if you enable a health check.
4. Generate a domain only when you are ready to expose the app. Review access control, rate limits, and costs before sharing the address.

Railway service variables are passed to the build and running service.[2] Set sensitive values in Railway's service Variables interface; never commit `.env` files or paste credentials into source. This repo intentionally has no provider secrets or `.env` file.

## Important: AI and voice outside Manus

The current no-user-key configuration works on Manus because Manus supplies `MANUS_API_URL` and `MANUS_API_KEY` to the trusted WebDev backend. Codepilot's chat and transcription routes return an unavailable response if those variables are absent. Railway does not inherit Manus's managed credentials, and this repository intentionally does not contain them. Therefore the web UI and server can start on Railway, but AI chat and voice transcription will not work there until a compatible model and speech service are separately configured. Do not reuse a sandbox key or the personal GitHub token from chat.

The GitHub App integration has a separate, public Client ID entered in Private access. GitHub authorization tokens remain in server memory, so a server restart requires reconnecting. The app has no end-user login and its rate limits are process-local; do not expose it to the general public without adding suitable access control and stronger quotas. For the no-key AI version, use the existing Manus-hosted Preview or ask to publish through Manus hosting instead.

## Current Railway configuration note

Railway currently documents that Config as Code files such as `railway.json` and `railway.toml` are deprecated, with existing files supported only until 2026-12-01.[3] This repository therefore uses Railway's root-Dockerfile auto-detection and does not include a deprecated Railway configuration file. Configure the health-check path and any environment variables in Railway's service settings.

## References

[1]: https://docs.railway.com/guides/express "Deploy an Express App"
[2]: https://docs.railway.com/variables "Using Variables"
[3]: https://docs.railway.com/config-as-code/reference "Railway Config as Code Reference"
