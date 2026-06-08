# Security Policy

## Supported versions

Only the latest release is actively supported.

## Reporting a vulnerability

Please report security issues privately by emailing the maintainer or opening a minimal GitHub security advisory if available.

Do not include sensitive profile, certificate, Wi-Fi, VPN, or MDM content in public issues. If a reproduction requires profile content, reduce it to a synthetic example first.

## Security posture

PLIST Viewer is read-only. It reads `.plist` and `.mobileconfig` files through the vault API and renders a local inspection view.

The plugin does not install profiles, activate profiles, enroll devices in MDM, provision devices, sign payloads, validate certificate trust chains, or make certificate trust decisions. It does not send vault content to external services, does not use runtime network APIs, does not read or change the system clipboard, does not open system profile dialogs, and does not write inspected files back to disk.

Runtime parsing uses the local `DOMParser` provided by the app environment for XML plists. Binary plist support in v0.1 is detection-only.
