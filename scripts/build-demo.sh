#!/usr/bin/env bash
# Builds the static GitHub Pages demo into $1 (default _site). Requires `npm run build` first.
set -euo pipefail
OUT="${1:-_site}"
rm -rf "$OUT" && mkdir -p "$OUT/lib"
cp public/app.js public/style.css "$OUT/"
for f in types engine analysis report view browser-api; do cp "dist/src/$f.js" "$OUT/lib/"; done
node -e 'import("./dist/src/scenario.js").then(m=>process.stdout.write(JSON.stringify(m.loadScenarios("scenarios"))))' > "$OUT/scenarios.json"
sed -e 's#<html lang="en">#<html lang="en" data-demo="1">#' \
    -e 's#href="/style.css"#href="./style.css"#' \
    -e 's#src="/app.js"#src="./app.js"#' \
    -e "s#<meta charset=\"utf-8\">#<meta charset=\"utf-8\">\n<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'\">#" \
    public/index.html > "$OUT/index.html"
