# Private GitHub connection setup

Codepilot uses GitHub's device authorization flow. The **GitHub App Client ID is public**; no GitHub personal access token, client secret, private key, or callback URL is required for this flow. GitHub tokens remain on Codepilot's server and are never returned to browser storage.

## Register the GitHub App

1. In GitHub, open **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Give it a name, then enable **Device Flow**. A callback URL is unnecessary for this flow.
3. Request only these repository permissions:
   - **Contents:** Read and write (required to read repository files and create a branch/commit).
   - **Metadata:** Read-only (required repository metadata access).
   - Leave all other permissions disabled. Codepilot blocks `.github/workflows/` changes rather than requesting the separate Workflows permission.
4. Create the App and copy its **Client ID** (not the App ID or a client secret).
5. Install the App on the account that owns the repositories. Choose **Only select repositories** and select the repositories Codepilot may access; do not choose all repositories unless that is your intent.
6. In Codepilot, open **Connect repository → Private access**, paste the public Client ID, and start authorization. GitHub shows a one-time user code; open the official GitHub device page, enter that code, then return to Codepilot.

GitHub's `offline_access` device flow produces an expiring user token plus a refresh token. Codepilot rotates these on the server. Both remain only in process memory, so a Preview/server restart requires reconnecting. Use Codepilot's **Disconnect** control to clear the active server session. You can also revoke the GitHub App authorization or change its repository installation scope in GitHub.

## Safe push behavior

Codepilot lists only repositories accessible to both the authorized GitHub user and the installed App. Before a push, it displays the repository, commit message, exact file paths, and exact new branch name. The initial private import uses the repository's default branch; each push creates a new `codepilot/...` branch from the latest version of the imported source branch. It does not force-push, change the source/default branch, or merge. Review the branch and open a pull request in GitHub if you want to propose merging it.

The repository browser lists up to 1,000 accessible repositories; it displays a notice if more results may exist. The App's selected-repository installation scope is the preferred way to keep the list narrow.

A changed file that no longer matches the version Codepilot imported is treated as a conflict; re-import/review the repository before trying again. This initial version supports source/text files within conservative count and size limits, not binary assets or Git LFS uploads.

## Official GitHub references

- [Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
- [GitHub App device flow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [Installing your own GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app)
- [Refreshing user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)
- [Creating Git trees](https://docs.github.com/rest/git/trees) and [updating Git references](https://docs.github.com/rest/git/refs)
