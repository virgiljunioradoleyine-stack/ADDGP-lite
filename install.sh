#!/bin/sh
# ADDGP-Lite installer.
#
# Never requires root. Never touches a system directory. Prints exactly what it
# did. A student on a shared university machine must be able to use this.
#
#   tar xzf addgp-lite.tar.gz && ./install.sh
#
# Or skip this entirely — the binary works where it stands:
#
#   chmod +x addgp-lite && ./addgp-lite init

set -eu

BIN="addgp-lite"
DEST="${ADDGP_INSTALL_DIR:-$HOME/.local/bin}"
HERE="$(cd "$(dirname "$0")" && pwd)"

say()  { printf '%s\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; }
die()  { printf '  ✗ %s\n' "$*" >&2; exit 1; }

say ""
say "ADDGP-Lite installer"
say "  Your code, your keys, your data, your report."
say ""

[ -f "$HERE/$BIN" ] || die "No $BIN next to this script. Run install.sh from the extracted tarball."

# ── verify the checksum before installing anything ───────────────────────────
if [ -f "$HERE/$BIN.sha256" ]; then
  EXPECTED=$(awk '{print $1}' "$HERE/$BIN.sha256")
  if command -v shasum >/dev/null 2>&1; then
    ACTUAL=$(shasum -a 256 "$HERE/$BIN" | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then
    ACTUAL=$(sha256sum "$HERE/$BIN" | awk '{print $1}')
  else
    ACTUAL=""
  fi

  if [ -z "$ACTUAL" ]; then
    warn "No shasum or sha256sum on this machine; checksum not verified."
  elif [ "$EXPECTED" = "$ACTUAL" ]; then
    ok "Checksum verified: $ACTUAL"
  else
    say ""
    die "CHECKSUM MISMATCH.
      expected $EXPECTED
      actual   $ACTUAL
    Do not run this binary. Ask whoever handed it to you for a fresh copy."
  fi
else
  warn "No $BIN.sha256 alongside the binary; checksum not verified."
fi

# ── signature, when minisign is available ────────────────────────────────────
if [ -f "$HERE/$BIN.minisig" ]; then
  if command -v minisign >/dev/null 2>&1; then
    if [ -f "$HERE/minisign.pub" ]; then
      minisign -Vm "$HERE/$BIN" -p "$HERE/minisign.pub" >/dev/null 2>&1 \
        && ok "Signature verified" \
        || die "SIGNATURE VERIFICATION FAILED. Do not run this binary."
    else
      warn "Signature present but no minisign.pub to check it against."
    fi
  else
    warn "Signature present but minisign is not installed; skipped."
  fi
fi

# ── install ──────────────────────────────────────────────────────────────────
mkdir -p "$DEST" || die "Could not create $DEST"
cp "$HERE/$BIN" "$DEST/$BIN" || die "Could not copy to $DEST — no root is needed, but the directory must be writable."
chmod +x "$DEST/$BIN"
ok "Installed to $DEST/$BIN"

for f in README.md SELF_COMPLIANCE.md LICENSE DISCLAIMER.md; do
  [ -f "$HERE/$f" ] && cp "$HERE/$f" "$DEST/../share/addgp-lite/$f" 2>/dev/null || true
done

# ── PATH ─────────────────────────────────────────────────────────────────────
case ":${PATH}:" in
  *":$DEST:"*)
    ok "$DEST is already on your PATH"
    ;;
  *)
    say ""
    warn "$DEST is not on your PATH. Add this line to your shell profile:"
    say ""
    say "    export PATH=\"\$PATH:$DEST\""
    say ""
    say "  (~/.bashrc, ~/.zshrc, or ~/.profile — whichever your shell reads.)"
    say "  Until then, run it by full path: $DEST/$BIN"
    ;;
esac

say ""
say "  Next:"
say "    addgp-lite verify                # confirm you got what was sent"
say "    addgp-lite init                  # keys, regions, sovereignty level"
say "    addgp-lite sovereignty preview   # exactly what would leave this machine"
say ""
say "  This is an engineering artifact, not legal advice."
say ""
