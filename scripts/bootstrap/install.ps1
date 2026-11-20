# PLA-I2-4 (audit B2): install Plania on Windows from one line, without corepack, on a brand-new machine.
#   irm https://github.com/Jorg3L3on/plania/releases/latest/download/install.ps1 | iex
#   powershell -ExecutionPolicy Bypass -File install.ps1 -From plania-0.1.0.tar.gz   a package already here
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Dir D:\plania -InstallArgs '--url','postgres://...'
# Parameters, each also read from the environment for the one-line form: -Dir (PLANIA_DIR, default ~\plania),
# -Version (PLANIA_VERSION), -From (PLANIA_FROM), -NoService, -NoOpen (no browser at the end), -Yes (ask nothing,
# install what is missing; PLANIA_YES=1), -InstallArgs (passed on to pnpm plania:install).
# Steps: install what the machine lacks (Node 22+, git, Postgres) with winget after one question, get the release and
# check its .sha256, unpack it, get the pnpm its package.json pins (npm installs it per user; npx when that fails),
# then `pnpm install --prod --frozen-lockfile` and `pnpm plania:install --service`.
# Downloads come from PLANIA_DOWNLOAD_BASE (default: the latest GitHub Release). pnpm release:pack stamps the
# release's version into $DefaultVersion; with no version the installer takes plania-latest.tar.gz, which every
# release carries. Another version: PLANIA_DOWNLOAD_BASE=https://github.com/Jorg3L3on/plania/releases/download/v<x.y.z>.
# This file stays ASCII: Windows PowerShell 5.1 reads a file without a BOM as ANSI, and a BOM breaks `irm | iex`.
# Accented letters are written {a} {e} {i} {o} {u} {n} {?} and put back by Say.
param(
  [string]$Dir = $env:PLANIA_DIR,
  [string]$Version = $env:PLANIA_VERSION,
  [string]$From = $env:PLANIA_FROM,
  [switch]$NoService,
  [switch]$NoOpen,
  [switch]$Yes,
  [string[]]$InstallArgs = @()
)

$DefaultVersion = ''
$DefaultBase = 'https://github.com/Jorg3L3on/plania/releases/latest/download'

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Words([string]$s) {
  $map = @{ '{a}' = 0xE1; '{e}' = 0xE9; '{i}' = 0xED; '{o}' = 0xF3; '{u}' = 0xFA; '{n}' = 0xF1; '{?}' = 0xBF }
  foreach ($k in $map.Keys) { $s = $s.Replace($k, [string][char]$map[$k]) }
  return $s
}
function Say([string]$s) { Write-Host (Words $s) }
function Stop-Install([string]$s) { throw [System.Exception]::new((Words $s)) }

function Get-Sha256([string]$file) { return (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant() }
function Test-Sha([string]$archive, [string]$shaFile) {
  $want = ((Get-Content -LiteralPath $shaFile -TotalCount 1) -split '\s+')[0].ToLowerInvariant()
  if ($want -ne (Get-Sha256 $archive)) { Stop-Install 'El paquete no coincide con su .sha256: puede estar da{n}ado o no ser el publicado. No se instal{o} nada.' }
  Say 'El paquete coincide con su .sha256.'
}

function Test-Node {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  try { return ([int](& node -p "process.versions.node.split('.')[0]") -ge 22) } catch { return $false }
}
function Test-Git {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return $false }
  & git --version *> $null
  return ($LASTEXITCODE -eq 0)
}
# A Postgres answering on localhost:5432.
function Test-Postgres {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $wait = $client.BeginConnect('127.0.0.1', 5432, $null, $null)
    if (-not $wait.AsyncWaitHandle.WaitOne(3000)) { return $false }
    $client.EndConnect($wait)
    return $true
  } catch { return $false } finally { $client.Close() }
}
# What winget just installed, in this script's PATH: the system's and the user's PATH as saved, plus the folders the
# installers use (the Postgres installer does not touch PATH).
function Update-Path([string[]]$extra = @()) {
  $saved = @([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User')) | Where-Object { $_ }
  $env:Path = ((@($extra | Where-Object { Test-Path -LiteralPath $_ }) + $saved + @($env:Path)) -join ';')
}
function Install-Winget([string]$id, [string]$what, [string[]]$more = @()) {
  Say "Instalando $what..."
  $wingetArgs = @('install', '--id', $id, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity') + $more
  & winget @wingetArgs | Out-Null
  # 0, or "already installed" (0x8A15002B): what follows checks the result itself.
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) { Stop-Install "winget no pudo instalar $what (c{o}digo $LASTEXITCODE)." }
}
function New-Password {
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Install-Plania {
  # 1. The folder: -Dir, PLANIA_DIR, or asked (default ~\plania). Checked before anything is installed.
  $quiet = $Yes -or ($env:PLANIA_YES -eq '1')
  $canAsk = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
  $target = $Dir
  if (-not $target) {
    $target = Join-Path $HOME 'plania'
    if (-not $quiet -and $canAsk) {
      $answer = Read-Host (Words "Carpeta donde instalar Plania [$target]")
      if ($answer) { $target = $answer }
    }
  }
  if ($target -eq '~' -or $target.StartsWith('~\') -or $target.StartsWith('~/')) { $target = $HOME + $target.Substring(1) }
  $target = [System.IO.Path]::GetFullPath($target)
  if (Test-Path -LiteralPath $target) {
    if (Test-Path -LiteralPath (Join-Path $target 'release.json')) {
      Stop-Install "Plania ya est{a} instalado en $target. Para pasar a otra versi{o}n, desde esa carpeta: pnpm update:plania <paquete>."
    }
    if (-not (Test-Path -LiteralPath $target -PathType Container)) { Stop-Install "$target ya existe y no es una carpeta. Elige otra con -Dir." }
    if (Get-ChildItem -LiteralPath $target -Force | Select-Object -First 1) { Stop-Install "La carpeta $target no est{a} vac{i}a. Elige otra con -Dir." }
  }
  if ($From) {
    if (-not (Test-Path -LiteralPath $From -PathType Leaf)) { Stop-Install "No encuentro el paquete $From." }
    $From = (Resolve-Path -LiteralPath $From).Path
  }

  # 2. What this machine lacks: Node 22+, git, a Postgres answering on localhost:5432. PLA-I2-4 (from zero): installed
  # with winget after one question (none with -Yes). Claude Code stays the owner's to install and sign in; the
  # install says so at the end.
  $needNode = -not (Test-Node)
  $needGit = -not (Test-Git)
  $needPg = -not (Test-Postgres)
  # test/bootstrap.test.ts only: nothing is installed on the machine running the tests.
  if ($env:PLANIA_BOOTSTRAP_SKIP_DEPS -eq '1') { $needNode = $false; $needGit = $false; $needPg = $false }
  $missing = @()
  if ($needNode) { $missing += 'Node 22' }
  if ($needGit) { $missing += 'git' }
  if ($needPg) { $missing += 'Postgres (la base de datos de Plania)' }
  $pgUrl = $null
  if ($missing.Count) {
    $list = $missing -join ', '
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      Stop-Install ("A esta computadora le falta: $list. Para instalarlo hace falta winget: inst{a}lalo con el " +
        "Instalador de aplicaciones de Microsoft Store (https://apps.microsoft.com/detail/9NBLGGH4NNS1) y vuelve a correr esta l{i}nea.")
    }
    Say "A esta computadora le falta: $list."
    if (-not $quiet) {
      if (-not $canAsk) { Stop-Install 'Vuelve a correr la l{i}nea con -Yes (o PLANIA_YES=1) para instalarlo, o inst{a}lalo t{u}.' }
      $answer = Read-Host (Words '{?}Lo instalo ahora? Windows puede pedir permiso para cada programa. [S/n]')
      if ($answer -match '^[nN]') { Stop-Install 'No se instal{o} nada.' }
    }

    if ($needNode) {
      Install-Winget 'OpenJS.NodeJS.LTS' 'Node'
      Update-Path @((Join-Path $env:ProgramFiles 'nodejs'))
      if (-not (Test-Node)) { Stop-Install 'Node se instal{o} pero no responde como Node 22 o m{a}s nuevo. Abre una ventana nueva de PowerShell y vuelve a correr esta l{i}nea.' }
    }
    if ($needGit) {
      Install-Winget 'Git.Git' 'git'
      Update-Path @((Join-Path $env:ProgramFiles 'Git\cmd'))
    }
    if ($needPg) {
      # The superuser's password is generated here and kept only in .env, inside the address (never printed).
      $password = New-Password
      Install-Winget 'PostgreSQL.PostgreSQL.17' 'Postgres' @('--override', "--mode unattended --unattendedmodeui none --superpassword $password --serverport 5432 --disable-components stackbuilder")
      Update-Path @((Join-Path $env:ProgramFiles 'PostgreSQL\17\bin'))
      $up = $false
      for ($i = 0; $i -lt 60; $i++) {
        if (Test-Postgres) { $up = $true; break }
        Start-Sleep -Seconds 1
      }
      if (-not $up) { Stop-Install 'Postgres se instal{o} pero no responde en localhost:5432.' }
      $pgUrl = "postgres://postgres:$password@localhost:5432/plania"
      Say 'Postgres qued{o} instalado y encendido.'
    }
  }

  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (-not (Test-Path -LiteralPath $tar)) { $tar = 'tar' }
  $work = Join-Path ([System.IO.Path]::GetTempPath()) ('plania-install-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    # 3. The package: -From, or downloaded with its .sha256 (required).
    if ($From) {
      $archive = $From
      if (Test-Path -LiteralPath "$archive.sha256") { Test-Sha $archive "$archive.sha256" }
      else { Say "Sin $(Split-Path -Leaf $archive).sha256 al lado: se instala sin comprobarlo." }
    } else {
      $v = if ($Version) { $Version } else { $DefaultVersion }
      $base = if ($env:PLANIA_DOWNLOAD_BASE) { $env:PLANIA_DOWNLOAD_BASE } else { $DefaultBase }
      $base = $base.TrimEnd('/')
      # No version: plania-latest.tar.gz, which every release carries beside plania-<version>.tar.gz.
      $name = if ($v) { "plania-$v.tar.gz" } else { 'plania-latest.tar.gz' }
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
      Say "Bajando Plania $(if ($v) { $v } else { '(la {u}ltima versi{o}n)' })..."
      $archive = Join-Path $work $name
      try { Invoke-WebRequest -UseBasicParsing -Uri "$base/$name" -OutFile $archive } catch { Stop-Install "No se pudo bajar $base/$name." }
      try { Invoke-WebRequest -UseBasicParsing -Uri "$base/$name.sha256" -OutFile "$archive.sha256" }
      catch { Stop-Install "No se pudo bajar $base/$name.sha256, as{i} que no se puede comprobar el paquete." }
      Test-Sha $archive "$archive.sha256"
    }

    # 4. Unpack: the archive holds one folder, plania-<version>. Relative names with the working folder set, so
    # no drive letter reaches tar.
    $unpack = Join-Path $work 'unpack'
    New-Item -ItemType Directory -Path $unpack | Out-Null
    Copy-Item -LiteralPath $archive -Destination (Join-Path $unpack 'package.tar.gz')
    Push-Location $unpack
    try { & $tar -xzf 'package.tar.gz'; $tarOk = ($LASTEXITCODE -eq 0) } finally { Pop-Location }
    if (-not $tarOk) { Stop-Install 'No se pudo abrir el paquete.' }
    $inner = Get-ChildItem -LiteralPath $unpack -Directory -Filter 'plania-*' | Select-Object -First 1
    if (-not $inner -or -not (Test-Path -LiteralPath (Join-Path $inner.FullName 'package.json'))) {
      Stop-Install 'El paquete no tiene la carpeta plania-<versi{o}n> que se espera.'
    }
    $parent = Split-Path -Parent $target
    if ($parent -and -not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target }
    try { Move-Item -LiteralPath $inner.FullName -Destination $target }
    catch { Copy-Item -LiteralPath $inner.FullName -Destination $target -Recurse }
    Say "Plania qued{o} en $target."
  } finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }

  Push-Location $target
  try {
    # 5. pnpm, the version package.json pins. No corepack: Node 25 and newer do not ship it, and enabling it here
    # needs an administrator shell.
    $want = (& node -p "String(require('./package.json').packageManager || '').replace(/^pnpm@/, '').replace(/\+.*$/, '')").Trim()
    if (-not $want) { Stop-Install 'package.json no dice qu{e} versi{o}n de pnpm usar.' }
    $pnpm = @()
    $have = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($have -and ((& pnpm --version 2>$null) -eq $want)) {
      $pnpm = @('pnpm')
    } else {
      Say "Instalando pnpm $want con npm..."
      & npm install -g "pnpm@$want" *> $null
      if ($LASTEXITCODE -eq 0) {
        $global = Join-Path ((& npm prefix -g).Trim()) 'pnpm.cmd'
        # @(...) around the whole if: an if-expression unrolls a one-item array into its string, and $pnpm[0] would
        # then be the path's first letter.
        $pnpm = @(if (Test-Path -LiteralPath $global) { $global } else { 'pnpm' })
      } else {
        Say 'npm no pudo instalar pnpm; se usa con npx, sin instalarlo.'
        $pnpm = @('npx', '--yes', "pnpm@$want")
      }
    }
    $pnpmExe = $pnpm[0]
    $pnpmPre = @($pnpm | Select-Object -Skip 1)

    # 6. Dependencies from the lockfile, then the install command (database, .env, migrations, the service). The
    # address of a Postgres installed here goes first, so one given in -InstallArgs still wins.
    Say 'Instalando lo que Plania necesita...'
    & $pnpmExe @pnpmPre install --prod --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { Stop-Install "pnpm install fall{o}. Corre pnpm help:report en $target y manda el informe." }
    $rest = @('plania:install')
    if (-not $NoService) { $rest += '--service' }
    if ($NoOpen) { $rest += '--no-open' }
    if ($pgUrl) { $rest += @('--url', $pgUrl) }
    & $pnpmExe @pnpmPre @rest @InstallArgs
    if ($LASTEXITCODE -ne 0) { Stop-Install 'La instalaci{o}n no termin{o}: arriba dice qu{e} falta.' }
  } finally {
    Pop-Location
  }
}

try {
  Install-Plania
} catch {
  Write-Host ('Plania: ' + $_.Exception.Message) -ForegroundColor Red
  # Run as a file, the exit code says it failed; through `irm | iex`, exit would close the user's window.
  if ($PSCommandPath) { exit 1 }
}
