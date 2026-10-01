#!/usr/bin/env bash
set -euo pipefail
node --check portal/config.js
node --check portal/portal.js
node --check js/portal-admin.js
node --check js/portal-ad-reports.js
node --check js/config.js
python .github/scripts/check-inline-scripts.py businesses.html ad-reports.html
# Deno and PostgreSQL-compatible migration tests run separately in staging.
