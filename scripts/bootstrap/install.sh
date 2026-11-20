#!/bin/sh
# PLA-I2-4 (audit B2): install Plania on macOS or Linux from one line, without corepack, on a brand-new machine.
#   curl -fsSL https://github.com/Jorg3L3on/plania/releases/latest/download/install.sh | sh
#   curl -fsSL <same address> | sh -s -- --dir ~/otra-carpeta
#   sh install.sh --from plania-0.1.0.tar.gz          a package already on this machine, nothing downloaded
#   sh install.sh [options] -- --url postgres://...   everything after -- goes to pnpm plania:install
# Options: --dir <folder> (default ~/plania, or PLANIA_DIR), --version <x.y.z> (or PLANIA_VERSION), --from <file>
# (or PLANIA_FROM), --no-service, --no-open (no browser at the end), --yes (ask nothing, install what is missing).
# Steps: install what the machine lacks (Node 22+, git, Postgres) after one question, get the release and check its
# .sha256, unpack it, get the pnpm its package.json pins (npm; npx when a global install is not allowed), then
# `pnpm install --prod --frozen-lockfile` and `pnpm plania:install`, which starts Plania as a service.
# Downloads come from PLANIA_DOWNLOAD_BASE (default: the latest GitHub Release). pnpm release:pack stamps the
# release's version into DEFAULT_VERSION; with no version the installer takes plania-latest.tar.gz, which every
# release carries. Another version: PLANIA_DOWNLOAD_BASE=https://github.com/Jorg3L3on/plania/releases/download/v<x.y.z>.
set -eu

DEFAULT_VERSION=""
DEFAULT_BASE="https://github.com/Jorg3L3on/plania/releases/latest/download"

say() { printf '%s\n' "$*"; }
fail() { printf 'Plania: %s\n' "$*" >&2; exit 1; }

dir="${PLANIA_DIR:-}"
version="${PLANIA_VERSION:-$DEFAULT_VERSION}"
from="${PLANIA_FROM:-}"
base="${PLANIA_DOWNLOAD_BASE:-$DEFAULT_BASE}"
service=1
ask=1
open=1
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) [ $# -ge 2 ] || fail "--dir necesita una carpeta."; dir="$2"; shift 2 ;;
    --version) [ $# -ge 2 ] || fail "--version necesita un número."; version="$2"; shift 2 ;;
    --from) [ $# -ge 2 ] || fail "--from necesita un archivo."; from="$2"; shift 2 ;;
    --no-service) service=0; shift ;;
    --no-open) open=0; shift ;;
    --yes|-y) ask=0; shift ;;
    --help|-h) sed -n '2,15p' "$0" 2>/dev/null || true; exit 0 ;;
    --) shift; break ;;
    *) fail "No conozco la opción $1." ;;
  esac
done
[ "$open" = 1 ] || set -- --no-open "$@"
if [ -n "$from" ]; then
  [ -f "$from" ] || fail "No encuentro el paquete $from."
  from="$(cd "$(dirname "$from")" && pwd)/$(basename "$from")"
fi

can_ask() { { : </dev/tty; } 2>/dev/null; }

# 1. The folder: --dir, PLANIA_DIR, or asked (default ~/plania). Checked before anything is installed.
if [ -z "$dir" ]; then
  dir="$HOME/plania"
  if [ "$ask" = 1 ] && can_ask; then
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

# 2. What this machine lacks: Node 22+, git, a Postgres answering on localhost:5432. PLA-I2-4 (from zero): installed
# after one question (none with --yes). Claude Code stays the owner's to install and sign in; the install says so.
node_ok() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 22 ]; }
pg_answers() {
  if command -v pg_isready >/dev/null 2>&1; then
    rc=0
    pg_isready -h localhost -p 5432 -t 3 >/dev/null 2>&1 || rc=$?
    # 0 accepts connections, 1 answers but refuses them for now (starting up): both mean a server is there.
    [ "$rc" -le 1 ]
    return
  fi
  if command -v node >/dev/null 2>&1; then
    node -e 'const s=require("net").connect(5432,"127.0.0.1");s.setTimeout(3000);s.on("connect",()=>process.exit(0));s.on("error",()=>process.exit(1));s.on("timeout",()=>process.exit(1))' 2>/dev/null
    return
  fi
  if command -v bash >/dev/null 2>&1; then
    bash -c 'exec 3<>/dev/tcp/127.0.0.1/5432' 2>/dev/null
    return
  fi
  return 1
}
os="$(uname -s)"
need_node=0
need_git=0
need_pg=0
node_ok || need_node=1
git --version >/dev/null 2>&1 || need_git=1
pg_answers || need_pg=1
# test/bootstrap.test.ts only: nothing is installed on the machine running the tests.
if [ "${PLANIA_BOOTSTRAP_SKIP_DEPS:-}" = 1 ]; then need_node=0; need_git=0; need_pg=0; fi

missing=""
add_missing() { missing="${missing:+$missing, }$1"; }
[ "$need_node" = 0 ] || add_missing "Node 22"
[ "$need_git" = 0 ] || add_missing "git"
[ "$need_pg" = 0 ] || add_missing "Postgres (la base de datos de Plania)"

brew=""
SUDO=""
pm=""
if [ -n "$missing" ]; then
  case "$os" in
    Darwin)
      for b in "$(command -v brew 2>/dev/null || true)" /opt/homebrew/bin/brew /usr/local/bin/brew; do
        if [ -n "$b" ] && [ -x "$b" ]; then brew="$b"; break; fi
      done
      if [ -z "$brew" ]; then
        say "A esta Mac le falta: $missing."
        say "Para instalarlo hace falta Homebrew: instálalo con la línea que da https://brew.sh y vuelve a correr esta línea."
        exit 1
      fi
      ;;
    Linux)
      if command -v apt-get >/dev/null 2>&1; then pm=apt
      elif command -v dnf >/dev/null 2>&1; then pm=dnf
      else fail "A esta máquina le falta: $missing. Instálalo con el gestor de paquetes de tu sistema y vuelve a correr esta línea."
      fi
      if [ "$(id -u)" != 0 ]; then
        command -v sudo >/dev/null 2>&1 || fail "A esta máquina le falta: $missing, y para instalarlo hace falta sudo."
        SUDO="sudo"
      fi
      ;;
    *) fail "A esta máquina le falta: $missing. Instálalo y vuelve a correr esta línea." ;;
  esac
  say "A esta máquina le falta: $missing."
  if [ "$ask" = 1 ]; then
    can_ask || fail "Vuelve a correr la línea con --yes para instalarlo, o instálalo tú."
    printf '¿Lo instalo ahora? Puede pedir la contraseña de tu computadora. [S/n] ' >/dev/tty
    read -r answer </dev/tty || answer=""
    case "$answer" in [nN]*) say "No se instaló nada."; exit 1 ;; esac
  fi
fi

# Homebrew's folders in this script's PATH, so the next step finds what was just installed.
brew_path() {
  eval "$("$brew" shellenv)"
  hash -r 2>/dev/null || true
}
# A package manager's output only when it fails.
quiet() {
  if "$@" >"$work/step.log" 2>&1; then return 0; fi
  tail -n 20 "$work/step.log" >&2
  return 1
}
apt_updated=0
apt_update() {
  [ "$apt_updated" = 1 ] && return 0
  quiet $SUDO apt-get update -q || fail "apt-get update falló."
  apt_updated=1
}
apt_install() { quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -q "$@" || fail "apt-get no pudo instalar $*."; }
dnf_install() { quiet $SUDO dnf install -y -q "$@" || fail "dnf no pudo instalar $*."; }
fetch() { # <url> <file>
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -q "$1" -O "$2"
  else fail "Falta curl o wget para bajar Plania."
  fi
}

if [ "$need_node" = 1 ]; then
  say "Instalando Node..."
  case "$os" in
    Darwin)
      "$brew" install node >/dev/null || fail "Homebrew no pudo instalar Node."
      brew_path
      ;;
    Linux)
      if [ "$pm" = apt ]; then
        apt_update
        cand="$(apt-cache policy nodejs 2>/dev/null | sed -n 's/^ *Candidate: *\([0-9]*\).*/\1/p' | head -n 1)"
        if [ -n "$cand" ] && [ "$cand" -ge 22 ] 2>/dev/null; then
          apt_install nodejs npm
        else
          # The distribution's Node is older: NodeSource's Node 22 package, which carries npm.
          apt_install ca-certificates curl gnupg
          fetch https://deb.nodesource.com/setup_22.x "$work/nodesource.sh" || fail "No se pudo bajar el instalador de Node (deb.nodesource.com)."
          quiet $SUDO bash "$work/nodesource.sh" || fail "No se pudo agregar el repositorio de Node (deb.nodesource.com)."
          apt_install nodejs
        fi
      else
        cand="$(dnf -q info nodejs 2>/dev/null | sed -n 's/^Version *: *\([0-9]*\).*/\1/p' | sort -n | tail -n 1)"
        if [ -n "$cand" ] && [ "$cand" -ge 22 ] 2>/dev/null; then
          dnf_install nodejs npm
        else
          fetch https://rpm.nodesource.com/setup_22.x "$work/nodesource.sh" || fail "No se pudo bajar el instalador de Node (rpm.nodesource.com)."
          quiet $SUDO bash "$work/nodesource.sh" || fail "No se pudo agregar el repositorio de Node (rpm.nodesource.com)."
          dnf_install nodejs
        fi
      fi
      hash -r 2>/dev/null || true
      ;;
  esac
  node_ok || fail "Node se instaló pero no responde como Node 22 o más nuevo. Abre una terminal nueva y vuelve a correr esta línea."
fi

if [ "$need_git" = 1 ]; then
  say "Instalando git..."
  case "$os" in
    Darwin)
      "$brew" install git >/dev/null || fail "Homebrew no pudo instalar git."
      brew_path
      ;;
    Linux)
      if [ "$pm" = apt ]; then apt_update; apt_install git; else dnf_install git; fi
      ;;
  esac
fi

# Postgres: installed and started here, with a role `plania` that may create databases and a generated password. The
# address goes to pnpm plania:install in PLANIA_INSTALL_URL, which keeps it in .env only; it is never printed.
pg_url=""
if [ "$need_pg" = 1 ]; then
  say "Instalando Postgres..."
  password="$(od -An -tx1 -N24 /dev/urandom | tr -d ' \n')"
  [ "${#password}" -eq 48 ] || fail "No se pudo generar una contraseña para Postgres."
  role_sql="DO \$\$BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'plania') THEN ALTER ROLE plania WITH LOGIN CREATEDB PASSWORD '$password'; ELSE CREATE ROLE plania WITH LOGIN CREATEDB PASSWORD '$password'; END IF; END\$\$;"
  wait_pg() {
    i=0
    until pg_answers; do
      i=$((i + 1))
      [ "$i" -lt 60 ] || fail "Postgres se instaló pero no responde en localhost:5432."
      sleep 1
    done
  }
  case "$os" in
    Darwin)
      "$brew" install postgresql@17 >/dev/null || fail "Homebrew no pudo instalar Postgres."
      brew_path
      pgbin="$("$brew" --prefix postgresql@17)/bin"
      PATH="$pgbin:$PATH"
      export PATH
      "$brew" services start postgresql@17 >/dev/null || fail "No se pudo encender Postgres (brew services start postgresql@17)."
      wait_pg
      # Homebrew's cluster belongs to this user and trusts connections from this machine.
      printf '%s\n' "$role_sql" | "$pgbin/psql" -q -h localhost -d postgres -v ON_ERROR_STOP=1 >/dev/null || fail "No se pudo crear el usuario plania en Postgres."
      ;;
    Linux)
      if [ "$pm" = apt ]; then
        apt_update
        apt_install postgresql
      else
        dnf_install postgresql-server postgresql
        $SUDO postgresql-setup --initdb >/dev/null 2>&1 || true
        # Red Hat's cluster checks TCP logins with ident; Plania logs in with a password.
        $SUDO sed -i 's/^\(host[[:space:]].*[[:space:]]\)ident[[:space:]]*$/\1scram-sha-256/' /var/lib/pgsql/data/pg_hba.conf 2>/dev/null || true
      fi
      if [ -d /run/systemd/system ]; then
        $SUDO systemctl enable postgresql >/dev/null 2>&1 || true
        $SUDO systemctl restart postgresql >/dev/null 2>&1 || fail "No se pudo encender Postgres (systemctl start postgresql)."
      else
        # No systemd (a container): the distribution's init script.
        $SUDO service postgresql start >/dev/null 2>&1 || fail "No se pudo encender Postgres (service postgresql start)."
      fi
      wait_pg
      if [ "$(id -u)" = 0 ]; then
        printf '%s\n' "$role_sql" | su postgres -s /bin/sh -c "cd /tmp && psql -q -d postgres -v ON_ERROR_STOP=1" >/dev/null || fail "No se pudo crear el usuario plania en Postgres."
      else
        printf '%s\n' "$role_sql" | sudo -u postgres sh -c "cd /tmp && psql -q -d postgres -v ON_ERROR_STOP=1" >/dev/null || fail "No se pudo crear el usuario plania en Postgres."
      fi
      ;;
  esac
  pg_url="postgres://plania:$password@localhost:5432/plania"
  say "Postgres quedó instalado y encendido."
fi

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

# 3. The package: --from, or downloaded with its .sha256 (required).
if [ -n "$from" ]; then
  archive="$from"
  if [ -f "$from.sha256" ]; then check_sha "$archive" "$from.sha256"
  else say "Sin $(basename "$from").sha256 al lado: se instala sin comprobarlo."
  fi
else
  # No version: plania-latest.tar.gz, which every release carries beside plania-<version>.tar.gz.
  name="plania-${version:-latest}.tar.gz"
  say "Bajando Plania ${version:-(la última versión)}..."
  fetch "${base%/}/$name" "$work/$name" || fail "No se pudo bajar ${base%/}/$name."
  fetch "${base%/}/$name.sha256" "$work/$name.sha256" || fail "No se pudo bajar ${base%/}/$name.sha256, así que no se puede comprobar el paquete."
  archive="$work/$name"
  check_sha "$archive" "$work/$name.sha256"
fi

# 4. Unpack: the archive holds one folder, plania-<version>.
command -v tar >/dev/null 2>&1 || fail "Falta tar para abrir el paquete."
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
  say "Instalando pnpm $want_pnpm con npm..."
  if npm install -g "pnpm@$want_pnpm" >/dev/null 2>&1; then
    prefix="$(npm prefix -g)"
    if [ -x "$prefix/bin/pnpm" ]; then pnpm_cmd="$prefix/bin/pnpm"; else pnpm_cmd="pnpm"; fi
  else
    say "npm no pudo instalar pnpm para todo el sistema; se usa con npx, sin instalarlo."
    pnpm_cmd="npx --yes pnpm@$want_pnpm"
  fi
fi

# 6. Dependencies from the lockfile, then the install command (database, .env, migrations, the service). The address
# of a Postgres installed here goes in PLANIA_INSTALL_URL; a --url given after -- still wins.
# In the environment, not on the command line: pnpm prints a script's command line.
if [ -n "$pg_url" ]; then PLANIA_INSTALL_URL="$pg_url"; export PLANIA_INSTALL_URL; fi
say "Instalando lo que Plania necesita..."
# shellcheck disable=SC2086
$pnpm_cmd install --prod --frozen-lockfile || fail "pnpm install falló. Corre pnpm help:report en $dir y manda el informe."
# The install command starts Plania as a service by default; --no-service tells it not to (--no-start).
[ "$service" = 1 ] || set -- --no-start "$@"
# Under `curl … | sh` this shell's stdin is the script itself, so the install command would see no terminal and could
# not ask for a Postgres user and password (B3). It reads the terminal instead when there is one.
if [ "$ask" = 1 ] && can_ask; then
  # shellcheck disable=SC2086
  $pnpm_cmd plania:install "$@" </dev/tty || exit 1
else
  # shellcheck disable=SC2086
  $pnpm_cmd plania:install "$@" || exit 1
fi
