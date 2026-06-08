import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const main = fs.readFileSync("src/main.ts", "utf8");
const parser = fs.readFileSync("src/parser.ts", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const readme = fs.readFileSync("README.md", "utf8");

const forbiddenRuntimePatterns = [
  ["fetch(", "no fetch usage"],
  ["XMLHttpRequest", "no XMLHttpRequest usage"],
  ["WebSocket", "no WebSocket usage"],
  ["navigator.clipboard", "no clipboard usage"],
  ["child_process", "no process execution module"],
  ["spawn(", "no spawn usage"],
  ["exec(", "no exec usage"],
  ["eval(", "no eval usage"],
  ["new Function", "no dynamic function construction"],
];

const runtimeText = `${main}\n${parser}\n${styles}`;
const assertions = [
  [manifest.id === "plist-viewer", "manifest id is plist-viewer"],
  [manifest.name === "PLIST Viewer", "manifest name is PLIST Viewer"],
  [manifest.version === "0.1.0", "manifest version is 0.1.0"],
  [!/obsidian/i.test(manifest.description), "manifest description avoids product name"],
  [main.includes("registerExtensions(PLIST_EXTENSIONS"), "extensions are registered"],
  [main.includes("[\"plist\", \"mobileconfig\"]"), "plist and mobileconfig extensions are in scope"],
  [main.includes("type ViewMode = \"tree\" | \"source\" | \"security\""), "tree/source/security modes exist"],
  [main.includes("renderTree(container, parsed, this.filterValue)"), "tree view code path exists"],
  [main.includes("renderSource(container, this.data)"), "source view code path exists"],
  [main.includes("renderSecurity(container, parsed)"), "security view code path exists"],
  [main.includes("parsed.isBinary") && main.includes("parsed.isLarge"), "binary and large fallbacks exist"],
  [parser.includes("parseFromString(data, \"application/xml\")"), "DOMParser XML parsing is used"],
  [parser.includes("isBinaryPlist"), "binary plist detection exists"],
  [parser.includes("com.apple.mdm"), "MDM payload warning exists"],
  [parser.includes("com.apple.wifi.managed"), "Wi-Fi payload warning exists"],
  [parser.includes("com.apple.vpn.managed"), "VPN payload warning exists"],
  [parser.includes("com.apple.applicationaccess"), "restrictions payload warning exists"],
  [parser.includes("com.apple.security.root"), "root certificate payload warning exists"],
  [readme.includes("does not install, activate, enroll, trust, sign, provision, or apply profiles"), "README states profile non-goals"],
  [readme.includes("does not use network APIs or clipboard APIs"), "README states network and clipboard boundary"],
  [!styles.includes("!important"), "styles do not use important overrides"],
  ...forbiddenRuntimePatterns.map(([pattern, label]) => [!runtimeText.includes(pattern), label]),
];

const failures = assertions.filter(([passes]) => !passes).map(([, label]) => label);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL: ${failure}`);
  }
  process.exit(1);
}

console.log("PLIST Viewer smoke checks passed.");
