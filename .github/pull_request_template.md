## Summary

-

## Checks

- [ ] `npm run build`
- [ ] `npx tsc --noEmit`
- [ ] `npm test`
- [ ] Tested `.plist`
- [ ] Tested `.mobileconfig`
- [ ] Tested invalid XML fallback
- [ ] Tested binary plist fallback

## Security

- [ ] Plugin remains read-only
- [ ] No profile install, activation, enrollment, provisioning, signing, or trust decisions added
- [ ] No runtime network APIs added
- [ ] No runtime clipboard APIs added
- [ ] No inspected file write-back added
- [ ] `manifest.json.description` avoids redundant product naming
