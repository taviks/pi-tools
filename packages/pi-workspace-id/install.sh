#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(
  cd "$(dirname "$0")"
  pwd -P
)"

SRC="$SCRIPT_DIR/bin/piw"
TARGET_DIR="${PIW_INSTALL_DIR:-$HOME/.local/bin}"
TARGET="$TARGET_DIR/piw"

if [ ! -f "$SRC" ]; then
  echo "install: source script not found: $SRC" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
chmod +x "$SRC"
ln -sf "$SRC" "$TARGET"

echo "Installed: $TARGET -> $SRC"

case ":$PATH:" in
  *":$TARGET_DIR:"*)
    echo "PATH already contains $TARGET_DIR"
    ;;
  *)
    echo ""
    echo "Add this to your shell profile:"
    echo "  export PATH=\"$TARGET_DIR:\$PATH\""
    ;;
esac
