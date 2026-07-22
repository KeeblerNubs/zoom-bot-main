#!/bin/bash
set -e

# Start WireGuard if enabled
if [ "$WIREGUARD_ENABLED" = "true" ]; then
    if [ -n "$WIREGUARD_CONFIG_B64" ]; then
        echo "$WIREGUARD_CONFIG_B64" | base64 -d > "$WIREGUARD_CONFIG_PATH"
    fi
    wg-quick up "$WIREGUARD_INTERFACE"
fi

exec "$@"
