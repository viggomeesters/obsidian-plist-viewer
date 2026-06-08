# Community Submission Checklist

Current release target: `0.1.0`

## Repository

- [x] Public GitHub repository exists or is ready to create.
- [x] `README.md` describes what the plugin does and how to use it.
- [x] `README.md` states that profiles are inspected only and never installed or applied.
- [x] `LICENSE` exists.
- [x] `manifest.json` exists at repository root.
- [x] `manifest.json.id` is `plist-viewer`.
- [x] `manifest.json.description` does not include the redundant product name.
- [x] `manifest.json.version` uses `x.y.z`.
- [x] `versions.json` maps plugin version to minimum app version.

## Release

- [x] `npm run build` passes.
- [x] `npx tsc --noEmit` passes.
- [x] `npm test` passes.
- [x] Release tag should equal `manifest.json.version`.
- [x] Release assets should include `main.js`.
- [x] Release assets should include `manifest.json`.
- [x] Release assets should include `styles.css`.

## Directory Submission

- [ ] Sign in to https://community.obsidian.md.
- [ ] Link the GitHub account that owns the repository.
- [ ] Open **Plugins -> New plugin**.
- [ ] Submit `https://github.com/viggomeesters/obsidian-plist-viewer`.
- [ ] Confirm developer policies and support commitment.
- [ ] Address automated review feedback.

These final directory steps require the repository owner's account.

Official references:

- https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin
- https://github.com/obsidianmd/obsidian-releases
