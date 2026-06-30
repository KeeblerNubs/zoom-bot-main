#!/usr/bin/env bash
set -euo pipefail

WIREGUARD_CONFIG_PATH="${WIREGUARD_CONFIG_PATH:-/etc/wireguard/wg0.conf}"
WIREGUARD_INTERFACE="${WIREGUARD_INTERFACE:-wg0}"
WIREGUARD_ENABLED="${WIREGUARD_ENABLED:-false}"
WIREGUARD_CONFIG_B64="${WIREGUARD_CONFIG_B64:-}"

is_truthy() {
  case "${1,,}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

if is_truthy "$WIREGUARD_ENABLED"; then
  if [ -n "$WIREGUARD_CONFIG_B64" ]; then
    mkdir -p "$(dirname "$WIREGUARD_CONFIG_PATH")"
    printf '%s' "$WIREGUARD_CONFIG_B64" | base64 -d > "$WIREGUARD_CONFIG_PATH"
    chmod 600 "$WIREGUARD_CONFIG_PATH"
  fi

  if [ ! -f "$WIREGUARD_CONFIG_PATH" ]; then
    echo "WireGuard is enabled, but no config exists at $WIREGUARD_CONFIG_PATH" >&2
    echo "Mount a config file there or provide WIREGUARD_CONFIG_B64." >&2
    exit 1
  fi

  mkdir -p /run/wireguard
  chmod 600 "$WIREGUARD_CONFIG_PATH"
  echo "Starting WireGuard interface $WIREGUARD_INTERFACE using $WIREGUARD_CONFIG_PATH"
  wg-quick up "$WIREGUARD_CONFIG_PATH"

  shutdown_wireguard() {
    echo "Stopping WireGuard interface $WIREGUARD_INTERFACE"
    wg-quick down "$WIREGUARD_CONFIG_PATH" || true
  }
  trap shutdown_wireguard EXIT
fi

exec "$@"
