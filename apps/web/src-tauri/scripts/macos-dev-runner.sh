#!/usr/bin/env bash
# Replaces `cargo` for `tauri:dev` on macOS so the debug binary is signed with a
# stable Apple Development identity before launch. Ad-hoc/linker signatures change
# every rebuild, which makes Keychain ACL checks re-prompt on every launch.
#
# Invoked by tauri.macos.conf.json as: macos-dev-runner.sh run|build [cargo args...]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRATE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BINARY_NAME="${GALMAIL_DEV_BINARY_NAME:-GalMail}"

cd "${CRATE_DIR}"

resolve_identity() {
  if [[ -n "${GALMAIL_DEV_CODESIGN_IDENTITY:-}" ]]; then
    printf '%s\n' "${GALMAIL_DEV_CODESIGN_IDENTITY}"
    return 0
  fi
  security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/.*"\(Apple Development:[^"]*\)".*/\1/p' \
    | head -1
}

find_debug_binary() {
  local profile="debug"
  local triple=""
  local prev=""
  local arg
  for arg in "$@"; do
    if [[ "${prev}" == "--target" ]]; then
      triple="${arg}"
    elif [[ "${arg}" == "--release" ]]; then
      profile="release"
    elif [[ "${prev}" == "--profile" ]]; then
      profile="${arg}"
    fi
    prev="${arg}"
  done

  local target_dir="${CARGO_TARGET_DIR:-${CRATE_DIR}/target}"
  local candidates=()
  if [[ -n "${triple}" ]]; then
    candidates+=("${target_dir}/${triple}/${profile}/${BINARY_NAME}")
  fi
  candidates+=("${target_dir}/${profile}/${BINARY_NAME}")

  local path
  for path in "${candidates[@]}"; do
    if [[ -x "${path}" ]]; then
      printf '%s\n' "${path}"
      return 0
    fi
  done
  return 1
}

codesign_bin() {
  local bin="$1"
  local identity
  identity="$(resolve_identity || true)"
  if [[ -z "${identity}" ]]; then
    echo "galmail macos-dev-runner: no Apple Development identity found; Keychain may re-prompt each rebuild." >&2
    echo "  Fix: install an Apple Development cert, or set GALMAIL_DEV_CODESIGN_IDENTITY." >&2
    return 0
  fi
  # Stable Team ID signature (not ad-hoc). Identifier matches tauri.conf.json.
  codesign --force --sign "${identity}" --identifier com.galateacorp.mail "${bin}"
  echo "galmail macos-dev-runner: signed $(basename "${bin}") with ${identity}" >&2
}

cmd="${1:-}"
if [[ "${cmd}" != "run" && "${cmd}" != "build" ]]; then
  exec cargo "$@"
fi
shift

if [[ "${cmd}" == "build" ]]; then
  exec cargo build "$@"
fi

# `tauri:dev` uses `cargo run`. Intercept so we can codesign between build and exec.
cargo_args=()
app_args=()
seeing_app_args=0
for arg in "$@"; do
  if [[ "${seeing_app_args}" -eq 1 ]]; then
    app_args+=("${arg}")
  elif [[ "${arg}" == "--" ]]; then
    seeing_app_args=1
  else
    cargo_args+=("${arg}")
  fi
done

cargo build "${cargo_args[@]}"

bin="$(find_debug_binary "${cargo_args[@]}")" || {
  echo "galmail macos-dev-runner: could not find ${BINARY_NAME} after build" >&2
  exit 1
}

codesign_bin "${bin}"
exec "${bin}" "${app_args[@]}"
