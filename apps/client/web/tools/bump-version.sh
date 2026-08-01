#!/usr/bin/env bash
# Sube de versión la app de una sola vez y sin olvidos:
#   - VERSION en game.js
#   - CACHE y recursos base versionados en sw.js
#   - los query strings ?v=semver de styles.css y game.js en index.html
# Todos los cambios se preparan y validan antes de sustituir los archivos. Si una
# escritura falla durante el commit, se restauran las copias originales.
#
# Uso:  tools/bump-version.sh 1.7.3
set -euo pipefail

cd "$(dirname "$0")/.."

NEW="${1:-}"
if [[ ! "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Uso: tools/bump-version.sh X.Y.Z" >&2
  exit 1
fi

VERSION_RE='[0-9]+\.[0-9]+\.[0-9]+'
OLD=$(sed -nE "s/.*const VERSION = '($VERSION_RE)'.*/\1/p" game.js)
CACHE_VERSION=$(sed -nE "s/^const CACHE = 'cv-cache-v($VERSION_RE)';/\1/p" sw.js)
INDEX_STYLE_VERSION=$(sed -nE "s#.*styles\.css\?v=($VERSION_RE).*#\1#p" index.html)
INDEX_GAME_VERSION=$(sed -nE "s#.*game\.js\?v=($VERSION_RE).*#\1#p" index.html)
SW_STYLE_VERSION=$(sed -nE "s#.*'\./styles\.css\?v=($VERSION_RE)'.*#\1#p" sw.js)
SW_GAME_VERSION=$(sed -nE "s#.*'\./game\.js\?v=($VERSION_RE)'.*#\1#p" sw.js)

require_version() {
  local label="$1" value="$2"
  if [[ ! "$value" =~ ^$VERSION_RE$ ]]; then
    echo "No se pudo leer una única versión semver en $label" >&2
    exit 1
  fi
}

require_version 'game.js VERSION' "$OLD"
require_version 'sw.js CACHE' "$CACHE_VERSION"
require_version 'index.html styles.css' "$INDEX_STYLE_VERSION"
require_version 'index.html game.js' "$INDEX_GAME_VERSION"
require_version 'sw.js styles.css' "$SW_STYLE_VERSION"
require_version 'sw.js game.js' "$SW_GAME_VERSION"

for current in "$CACHE_VERSION" "$INDEX_STYLE_VERSION" "$INDEX_GAME_VERSION" "$SW_STYLE_VERSION" "$SW_GAME_VERSION"; do
  if [[ "$current" != "$OLD" ]]; then
    echo "Versionado desincronizado; no se ha modificado ningún archivo." >&2
    echo "game=$OLD cache=$CACHE_VERSION index-css=$INDEX_STYLE_VERSION index-js=$INDEX_GAME_VERSION sw-css=$SW_STYLE_VERSION sw-js=$SW_GAME_VERSION" >&2
    exit 1
  fi
done

if [[ "$NEW" == "$OLD" ]]; then
  echo "La aplicación ya está en la versión $NEW; no hay cambios."
  exit 0
fi

TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/convergence-version.XXXXXX")
mkdir -p "$TMP_ROOT/stage" "$TMP_ROOT/backup"
ROLLBACK=0
cleanup() {
  local status=$?
  if [[ "$ROLLBACK" == '1' ]]; then
    cp "$TMP_ROOT/backup/game.js" game.js 2>/dev/null || true
    cp "$TMP_ROOT/backup/sw.js" sw.js 2>/dev/null || true
    cp "$TMP_ROOT/backup/index.html" index.html 2>/dev/null || true
  fi
  rm -rf "$TMP_ROOT"
  return "$status"
}
trap cleanup EXIT

for file in game.js sw.js index.html; do
  cp "$file" "$TMP_ROOT/stage/$file"
  cp "$file" "$TMP_ROOT/backup/$file"
done

# Preparar el release completo sobre copias temporales.
sed -E -i "s/(const VERSION = ')[0-9]+\.[0-9]+\.[0-9]+(')/\1$NEW\2/" "$TMP_ROOT/stage/game.js"
sed -E -i "s/(const CACHE = 'cv-cache-v)[0-9]+\.[0-9]+\.[0-9]+(')/\1$NEW\2/" "$TMP_ROOT/stage/sw.js"
for asset in styles.css game.js; do
  sed -E -i "s#(${asset}\?v=)[0-9]+\.[0-9]+\.[0-9]+#\1$NEW#g" "$TMP_ROOT/stage/index.html"
  sed -E -i "s#(${asset}\?v=)[0-9]+\.[0-9]+\.[0-9]+#\1$NEW#g" "$TMP_ROOT/stage/sw.js"
done

assert_count() {
  local expected="$1" file="$2"
  if [[ $(grep -F -c "$expected" "$file") -ne 1 ]]; then
    echo "Validación fallida para '$expected' en $file; no se ha modificado ningún archivo." >&2
    exit 1
  fi
}

assert_count "const VERSION = '$NEW';" "$TMP_ROOT/stage/game.js"
assert_count "const CACHE = 'cv-cache-v$NEW';" "$TMP_ROOT/stage/sw.js"
assert_count "styles.css?v=$NEW" "$TMP_ROOT/stage/index.html"
assert_count "game.js?v=$NEW" "$TMP_ROOT/stage/index.html"
assert_count "styles.css?v=$NEW" "$TMP_ROOT/stage/sw.js"
assert_count "game.js?v=$NEW" "$TMP_ROOT/stage/sw.js"

# Commit con rollback: nunca se deja una combinación parcial de versiones.
ROLLBACK=1
cp "$TMP_ROOT/stage/game.js" game.js
cp "$TMP_ROOT/stage/sw.js" sw.js
cp "$TMP_ROOT/stage/index.html" index.html
ROLLBACK=0

echo "Versión: $OLD → $NEW"
grep -n "const VERSION" game.js
grep -n "const CACHE" sw.js
grep -n "?v=" index.html
grep -n "styles.css?v=\|game.js?v=" sw.js
echo
echo "Commit sugerido: git commit -am \"Bump version to $NEW; update cache version and asset links\""
