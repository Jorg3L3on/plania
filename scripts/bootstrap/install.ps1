# PLA-I2-4 (audit B2): install Plania on Windows from one line, without corepack and without an administrator shell.
#   irm <download address>/install.ps1 | iex
#   powershell -ExecutionPolicy Bypass -File install.ps1 -From plania-0.1.0.tar.gz   a package already here
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Dir D:\plania -InstallArgs '--url','postgres://...'
# Parameters, each also read from the environment for the one-line form: -Dir (PLANIA_DIR, default ~\plania),
# -Version (PLANIA_VERSION), -From (PLANIA_FROM), -NoService, -Yes (ask nothing), -InstallArgs (passed on to
# pnpm plania:install).
# Steps: check Node 22+, get the release and check its .sha256, unpack it into the folder, get the pnpm version its
# package.json pins (npm, which Node still ships, installs per user; npx when that fails), then
# `pnpm install --prod --frozen-lockfile` and `pnpm plania:install --service`.
# The download address is PLANIA_DOWNLOAD_BASE; pnpm release:pack writes the release's version and, when
# PLANIA_DOWNLOAD_BASE is set while packing, its address into the two $Default lines below.
# This file stays ASCII: Windows PowerShell 5.1 reads a file without a BOM as ANSI, and a BOM breaks `irm | iex`.
# Accented letters are written {a} {e} {i} {o} {u} {n} {?} and put back by Say.
param(
  [string]$Dir = $env:PLANIA_DIR,
  [string]$Version = $env:PLANIA_VERSION,
  [string]$From = $env:PLANIA_FROM,
  [switch]$NoService,
  [switch]$Yes,
  [string[]]$InstallArgs = @()
)

$DefaultVersion = ''
$DefaultBase = 'https://downloads.example.invalid/plania'

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

function Install-Plania {
  # 1. Node 22 or newer.
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Stop-Install ("Plania necesita Node 22 o m{a}s nuevo, y no est{a} instalado. Inst{a}lalo con winget (winget install OpenJS.NodeJS.LTS) " +
      'o desde https://nodejs.org, abre una ventana nueva de PowerShell y vuelve a correr esta l{i}nea.')
  }
  $major = [int](& node -p "process.versions.node.split('.')[0]")
  if ($major -lt 22) {
    Stop-Install "Plania necesita Node 22 o m{a}s nuevo; aqu{i} hay $(& node --version). Actual{i}zalo (winget upgrade OpenJS.NodeJS.LTS, o https://nodejs.org) y vuelve a correr esta l{i}nea."
  }
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (-not (Test-Path -LiteralPath $tar)) { $tar = 'tar' }

  # 2. The folder: -Dir, PLANIA_DIR, or asked (default ~\plania).
  $target = $Dir
  if (-not $target) {
    $target = Join-Path $HOME 'plania'
    if (-not $Yes -and [Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
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

  $work = Join-Path ([System.IO.Path]::GetTempPath()) ('plania-install-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    # 3. The package: -From, or downloaded with its .sha256 (required).
    if ($From) {
      if (-not (Test-Path -LiteralPath $From -PathType Leaf)) { Stop-Install "No encuentro el paquete $From." }
      $archive = (Resolve-Path -LiteralPath $From).Path
      if (Test-Path -LiteralPath "$archive.sha256") { Test-Sha $archive "$archive.sha256" }
      else { Say "Sin $(Split-Path -Leaf $archive).sha256 al lado: se instala sin comprobarlo." }
    } else {
      $v = if ($Version) { $Version } else { $DefaultVersion }
      if (-not $v) { Stop-Install 'Falta la versi{o}n: pasa -Version <x.y.z>, o -From <paquete> para uno ya bajado.' }
      $base = if ($env:PLANIA_DOWNLOAD_BASE) { $env:PLANIA_DOWNLOAD_BASE } else { $DefaultBase }
      if ($base -like '*example.invalid*') { Stop-Install 'Todav{i}a no hay direcci{o}n de descarga. Pon PLANIA_DOWNLOAD_BASE, o usa -From <paquete>.' }
      $base = $base.TrimEnd('/')
      $name = "plania-$v.tar.gz"
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
      Say "Bajando Plania $v..."
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
        $pnpm = if (Test-Path -LiteralPath $global) { @($global) } else { @('pnpm') }
      } else {
        Say 'npm no pudo instalar pnpm; se usa con npx, sin instalarlo.'
        $pnpm = @('npx', '--yes', "pnpm@$want")
      }
    }
    $pnpmExe = $pnpm[0]
    $pnpmPre = @($pnpm | Select-Object -Skip 1)

    # 6. Dependencies from the lockfile, then the install command (database, .env, migrations, the service).
    Say 'Instalando lo que Plania necesita...'
    & $pnpmExe @pnpmPre install --prod --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { Stop-Install "pnpm install fall{o}. Corre pnpm help:report en $target y manda el informe." }
    $rest = @('plania:install')
    if (-not $NoService) { $rest += '--service' }
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
