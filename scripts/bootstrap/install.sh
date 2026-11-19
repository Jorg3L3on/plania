#!/bin/sh
# PLA-I2-4 (audit B2): install Plania on macOS or Linux from one line, without corepack.
#   curl -fsSL <download address>/install.sh | sh
#   curl -fsSL <download address>/install.sh | sh -s -- --dir ~/otra-carpeta
#   sh install.sh --from plania-0.1.0.tar.gz          a package already on this machine, nothing downloaded
#   sh install.sh [options] -- --url postgres://…     everything after -- goes to pnpm plania:install
# Options: --dir <folder> (default ~/plania, or PLANIA_DIR), --version <x.y.z> (or PLANIA_VERSION), --from <file>
# (or PLANIA_FROM), --no-service, --yes (ask nothing).
# Steps: check Node 22+, get the release and check its .sha256, unpack it into the folder, get the pnpm version its
# package.json pins (npm, which Node still ships; npx when a global install is not allowed), then
# `pnpm install --prod --frozen-lockfile` and `pnpm plania:install --service`.
# The download address is PLANIA_DOWNLOAD_BASE; pnpm release:pack writes the release's version and, when
# PLANIA_DOWNLOAD_BASE is set while packing, its address into the two DEFAULT_ lines below.
set -eu

DEFAULT_VERSION=""
DEFAULT_BASE="https://downloads.example.invalid/plania"

say() { printf '%s\n' "$*"; }
fail() { printf 'Plania: %s\n' "$*" >&2; exit 1; }

dir="${PLANIA_DIR:-}"
version="${PLANIA_VERSION:-$DEFAULT_VERSION}"
from="${PLANIA_FROM:-}"
base="${PLANIA_DOWNLOAD_BASE:-$DEFAULT_BASE}"
service=1
ask=1
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) [ $# -ge 2 ] || fail "--dir necesita una carpeta."; dir="$2"; shift 2 ;;
    --version) [ $# -ge 2 ] || fail "--version necesita un número."; version="$2"; shift 2 ;;
    --from) [ $# -ge 2 ] || fail "--from necesita un archivo."; from="$2"; shift 2 ;;
    --no-service) service=0; shift ;;
    --yes|-y) ask=0; shift ;;
    --help|-h) sed -n '2,13p' "$0" 2>/dev/null || true; exit 0 ;;
    --) shift; break ;;
    *) fail "No conozco la opción $1." ;;
  esac
done

# 1. Node 22 or newer.
if ! command -v node >/dev/null 2>&1; then
  say "Plania necesita Node 22 o más nuevo, y no está instalado."
  case "$(uname -s)" in
    Darwin) say "Instálalo con Homebrew (brew install node) o desde https://nodejs.org, y vuelve a correr esta línea." ;;
    *) say "Instálalo con el gestor de paquetes de tu sistema o desde https://nodejs.org, y vuelve a correr esta línea." ;;
  esac
  exit 1
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 22 ]; then
  fail "Plania necesita Node 22 o más nuevo; aquí hay $(node --version). Actualízalo desde https://nodejs.org y vuelve a correr esta línea."
fi
command -v tar >/dev/null 2>&1 || fail "Falta tar para abrir el paquete."

# 2. The folder: --dir, PLANIA_DIR, or asked (default ~/plania).
if [ -z "$dir" ]; then
  dir="$HOME/plania"
  if [ "$ask" = 1 ] && { : </dev/tty; } 2>/dev/null; then
    printf 'Carpeta donde instalar Plania [%s]: ' "$dir" >/dev/tty
    read -r answer </dev/tty || answer=""
    [ -n "$answer" ] && dir="$answer"
  fi
fi
case "$dir" in "~"|"~/"*) dir="$HOME${dir#\~}" ;; esac
if [ -e "$dir" ]; then
  [ -f "$dir/release.json" ] && fail "Plania ya está instalado en $dir. Para pasar a otra versión, desde esa carpeta: pnpm update:plania <paquete>."
  [ -d "$dir" ] || fail "$dir ya existe y no es una carpeta. Elige otra con --dir."
  [ -z "$(ls -A "$dir")" ] || fail "La carpeta $dir no está vacía. Elige otra con --dir."
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/plania-install.XXXXXX")"
trap 'rm -rf "$work"' EXIT INT TERM

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else node -e 'const h=require("crypto").createHash("sha256");h.update(require("fs").readFileSync(process.argv[1]));console.log(h.digest("hex"))' "$1"
  fi
}
check_sha() { # <archive> <sha256 file>
  want="$(cut -d' ' -f1 <"$2" | tr 'A-F' 'a-f' | head -n 1)"
  got="$(sha256_of "$1")"
  [ "$want" = "$got" ] || fail "El paquete no coincide con su .sha256: puede estar dañado o no ser el publicado. No se instaló nada."
  say "El paquete coincide con su .sha256."
}
fetch() { # <url> <file>
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -q "$1" -O "$2"
  else fail "Falta curl o wget para bajar Plania."
  fi
}

# 3. The package: --from, or downloaded with its .sha256 (required).
if [ -n "$from" ]; then
  [ -f "$from" ] || fail "No encuentro el paquete $from."
  archive="$from"
  if [ -f "$from.sha256" ]; then check_sha "$archive" "$from.sha256"
  else say "Sin $(basename "$from").sha256 al lado: se instala sin comprobarlo."
  fi
else
  [ -n "$version" ] || fail "Falta la versión: pasa --version <x.y.z>, o --from <paquete> para uno ya bajado."
  case "$base" in *example.invalid*) fail "Todavía no hay dirección de descarga. Pon PLANIA_DOWNLOAD_BASE, o usa --from <paquete>." ;; esac
  name="plania-$version.tar.gz"
  say "Bajando Plania $version…"
  fetch "${base%/}/$name" "$work/$name" || fail "No se pudo bajar ${base%/}/$name."
  fetch "${base%/}/$name.sha256" "$work/$name.sha256" || fail "No se pudo bajar ${base%/}/$name.sha256, así que no se puede comprobar el paquete."
  archive="$work/$name"
  check_sha "$archive" "$work/$name.sha256"
fi

# 4. Unpack: the archive holds one folder, plania-<version>.
mkdir -p "$work/unpack"
tar -xzf "$archive" -C "$work/unpack" || fail "No se pudo abrir el paquete."
inner=""
for d in "$work/unpack"/plania-*; do [ -d "$d" ] && inner="$d"; done
[ -n "$inner" ] && [ -f "$inner/package.json" ] || fail "El paquete no tiene la carpeta plania-<versión> que se espera."
mkdir -p "$(dirname "$dir")"
if [ -d "$dir" ]; then rmdir "$dir"; fi
mv "$inner" "$dir"
say "Plania quedó en $dir."
cd "$dir"

# 5. pnpm, the version package.json pins. No corepack: Node 25 and newer do not ship it.
want_pnpm="$(node -p 'String(require("./package.json").packageManager || "").replace(/^pnpm@/, "").replace(/\+.*$/, "")')"
[ -n "$want_pnpm" ] || fail "package.json no dice qué versión de pnpm usar."
pnpm_cmd=""
if command -v pnpm >/dev/null 2>&1 && [ "$(pnpm --version 2>/dev/null)" = "$want_pnpm" ]; then
  pnpm_cmd="pnpm"
else
  say "Instalando pnpm $want_pnpm con npm…"
  if npm install -g "pnpm@$want_pnpm" >/dev/null 2>&1; then
    prefix="$(npm prefix -g)"
    if [ -x "$prefix/bin/pnpm" ]; then pnpm_cmd="$prefix/bin/pnpm"; else pnpm_cmd="pnpm"; fi
  else
    say "npm no pudo instalar pnpm para todo el sistema; se usa con npx, sin instalarlo."
    pnpm_cmd="npx --yes pnpm@$want_pnpm"
  fi
fi

# 6. Dependencies from the lockfile, then the install command (database, .env, migrations, the service).
say "Instalando lo que Plania necesita…"
# shellcheck disable=SC2086
$pnpm_cmd install --prod --frozen-lockfile || fail "pnpm install falló. Corre pnpm help:report en $dir y manda el informe."
if [ "$service" = 1 ]; then
  # shellcheck disable=SC2086
  $pnpm_cmd plania:install --service "$@" || exit 1
else
  # shellcheck disable=SC2086
  $pnpm_cmd plania:install "$@" || exit 1
fi
