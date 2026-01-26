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

  mapfile -t ENV_PAIRS < <(jq -r '.env_vars // [] | .[]' "${OPTIONS_FILE}" 2>/dev/null || true)
  if [[ ${#ENV_PAIRS[@]} -gt 0 ]]; then
    for pair in "${ENV_PAIRS[@]}"; do
      KEY="${pair%%=*}"
      VALUE="${pair#*=}"
      if [[ -n "${KEY}" ]]; then
        export "${KEY}"="${VALUE}"
      fi
    done
  fi

  mapfile -t NPM_MODULES < <(jq -r '.npm_modules // [] | .[]' "${OPTIONS_FILE}" 2>/dev/null || true)
  if [[ ${#NPM_MODULES[@]} -gt 0 ]]; then
    echo "Installing user npm modules: ${NPM_MODULES[*]}"
    npm install --no-save --include=optional --only=production "${NPM_MODULES[@]}"
  fi
fi

export SCRIPTS_DIR="${RESOLVED_DIR}"
mkdir -p "${SCRIPTS_DIR}"

# Create symlink to node_modules in scripts directory for ESM resolution
# Remove existing symlink/directory if it exists
if [[ -L "${SCRIPTS_DIR}/node_modules" ]] || [[ -e "${SCRIPTS_DIR}/node_modules" ]]; then
  rm -rf "${SCRIPTS_DIR}/node_modules"
fi
ln -s "${PWD}/node_modules" "${SCRIPTS_DIR}/node_modules"

# Add main node_modules to NODE_PATH for legacy support
export NODE_PATH="${PWD}/node_modules:${NODE_PATH:-}"

echo "Node paths: ${NODE_PATH}"
echo "Created symlink: ${SCRIPTS_DIR}/node_modules -> ${PWD}/node_modules"

if [[ "${NODE_ENV:-}" == "development" ]]; then
  exec node_modules/.bin/nodemon index.mjs
else
  exec node index.mjs
fi
