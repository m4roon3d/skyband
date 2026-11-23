# skyband

Single-file static web app (`index.html`), no build step. Brand is always lowercase `skyband`. See README.md and docs/CLAUDE_HANDOVER.md for the design guardrails.

## Ship
target: github-pages
merge: on-"Merge"
checks: npm ci && npm test
release: none
preview: none (Pages only deploys from main; PRs run the tests)
