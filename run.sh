#!/usr/bin/env bash
set -euo pipefail

OPTIONS_FILE="/data/options.json"
DEFAULT_SCRIPTS_DIR="/config/scripts"
RESOLVED_DIR="${DEFAULT_SCRIPTS_DIR}"

if [[ -f "${OPTIONS_FILE}" ]]; then
  # jq is installed in the image
  CUSTOM_DIR=$(jq -er '.scripts_dir // empty' "${OPTIONS_FILE}" 2>/dev/null || true)
  if [[ -n "${CUSTOM_DIR}" ]]; then
    RESOLVED_DIR="${CUSTOM_DIR}"
  fi

  mapfile -t ENV_PAIRS < <(jq -r '.env_vars // {} | to_entries[] | "\(.key)=\(.value // "")"' "${OPTIONS_FILE}" 2>/dev/null || true)
  if [[ ${#ENV_PAIRS[@]} -gt 0 ]]; then
    for pair in "${ENV_PAIRS[@]}"; do
      KEY="${pair%%=*}"
      VALUE="${pair#*=}"
      if [[ -n "${KEY}" ]]; then
        export "${KEY}"="${VALUE}"
      fi
    done
  fi
fi

export SCRIPTS_DIR="${RESOLVED_DIR}"
mkdir -p "${SCRIPTS_DIR}"

if [[ "${NODE_ENV:-}" == "development" ]]; then
  exec node_modules/.bin/nodemon index.mjs
else
  exec node index.mjs
fi
