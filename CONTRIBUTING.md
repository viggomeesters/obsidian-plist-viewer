# Contributing

Thanks for helping improve PLIST Viewer.

## Development checks

Run these before submitting changes:

```bash
npm run build
npx tsc --noEmit
npm test
```

For manual testing, copy or symlink the repository into `.obsidian/plugins/plist-viewer/` in a test vault, reload the app, and open `.plist` and `.mobileconfig` fixtures.

## Security boundaries

Changes must preserve the v0.1 read-only model:

- no profile installation or activation
- no MDM enrollment, provisioning, signing, or certificate trust decisions
- no file write-back for inspected `.plist` or `.mobileconfig` files
- no binary plist conversion output files
- no runtime network APIs
- no runtime clipboard APIs
- no dynamic code execution

Use synthetic fixtures. Do not commit private profile, certificate, Wi-Fi, VPN, or MDM content.
