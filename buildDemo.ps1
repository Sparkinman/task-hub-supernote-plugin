# Build the Task Hub Demo plugin from the same source as the real one.
#
# There is deliberately no second copy of the code. This script flips three
# things, runs the normal build, and puts them back:
#
#   src/mode.ts        DEMO = false  ->  true   (Metro folds it at bundle time)
#   PluginConfig.json  swapped for PluginConfig.demo.json  (own ID, name, no permissions)
#   package.json name  TaskHub -> TaskHubDemo   (buildPlugin.ps1 names the output from it)
#   app.json name      TaskHub -> TaskHubDemo   (index.js registers the RN component
#                                                under it; the host resolves it by pluginKey)
#
# app.json's name and PluginConfig.json's pluginKey MUST be identical. A mismatch
# installs cleanly and then does nothing at all: no toolbar button, no lasso
# button, no settings, no error. The demo shipped that way once; the check inside
# now refuses to build it.
#
# A distinct pluginID is what lets both plugins sit on the device at once;
# reusing the real one would have the host treat the demo as an update to it.
#
# The restore runs in a finally block, and the originals are also copied to
# *.prebuild.bak before anything is touched, so an interrupted run cannot leave
# a demo flag behind in the working tree. The build fails loudly if the flag is
# not back to false at the end.

$ErrorActionPreference = 'Stop'

# PowerShell 5.1 file I/O cannot round-trip these files: Get-Content -Raw decodes
# UTF-8 source as ANSI, and Set-Content -Encoding utf8 prepends a BOM that breaks
# JSON parsing. Both bit this project on the first demo build, so read and write
# go through .NET with an explicit no-BOM UTF-8 encoding.
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Read-Text([string]$path) {
    return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}
function Write-Text([string]$path, [string]$text) {
    [System.IO.File]::WriteAllText($path, $text, $Utf8NoBom)
}

$root = $PSScriptRoot
$modePath = Join-Path $root 'src\mode.ts'
$configPath = Join-Path $root 'PluginConfig.json'
$demoConfigPath = Join-Path $root 'PluginConfig.demo.json'
$packagePath = Join-Path $root 'package.json'
$appJsonPath = Join-Path $root 'app.json'

foreach ($required in @($modePath, $configPath, $demoConfigPath, $packagePath, $appJsonPath)) {
    if (-not (Test-Path $required)) {
        Write-Host "Missing required file: $required" -ForegroundColor Red
        exit 1
    }
}

# Verified rather than assumed: building a "demo" from a tree already flipped to
# demo would silently produce two identical plugins.
$modeOriginal = Read-Text $modePath
if ($modeOriginal -notmatch 'export const DEMO = false;') {
    Write-Host 'src/mode.ts is not in its committed state (DEMO = false). Fix it before building.' -ForegroundColor Red
    exit 1
}

$configOriginal = Read-Text $configPath
$packageOriginal = Read-Text $packagePath
$appJsonOriginal = Read-Text $appJsonPath

# Single source of truth for the demo's component name, so pluginKey and
# app.json's name cannot drift apart.
$demoKey = (Read-Text $demoConfigPath | ConvertFrom-Json).pluginKey
if (-not $demoKey) {
    Write-Host 'PluginConfig.demo.json has no pluginKey.' -ForegroundColor Red
    exit 1
}

Copy-Item $modePath "$modePath.prebuild.bak" -Force
Copy-Item $configPath "$configPath.prebuild.bak" -Force
Copy-Item $packagePath "$packagePath.prebuild.bak" -Force
Copy-Item $appJsonPath "$appJsonPath.prebuild.bak" -Force

# buildPlugin.ps1 zips whatever is sitting in build/generated, and never clears it.
# Left alone, the demo package ships the real plugin's bundle beside its own — and
# worse, the next real build would ship the demo's. Clear it either side of the run.
$generated = Join-Path $root 'build\generated'

try {
    Write-Host '=== Switching the tree to demo mode ===' -ForegroundColor Cyan
    Remove-Item $generated -Recurse -Force -ErrorAction SilentlyContinue

    # Byte-identical apart from the flag itself.
    $modeDemo = $modeOriginal -replace 'export const DEMO = false;', 'export const DEMO = true;'
    Write-Text $modePath $modeDemo

    Copy-Item $demoConfigPath $configPath -Force

    # Written with python so the JSON keeps its exact shape and encoding; the
    # PowerShell JSON round-trip reorders keys and has bitten this project before.
    # A script file, not an inline here-string: PowerShell's double-quoted form
    # ate the backslash escapes and handed python a syntax error, and its
    # single-quoted form cannot interpolate the key.
    & python (Join-Path $root 'scripts\set_demo_names.py') $demoKey
    if ($LASTEXITCODE -ne 0) { throw 'Could not rewrite package.json / app.json' }

    # Verified before building, not hoped for afterwards.
    $liveKey = (Read-Text $configPath | ConvertFrom-Json).pluginKey
    $liveName = (Read-Text $appJsonPath | ConvertFrom-Json).name
    if ($liveKey -ne $liveName) {
        throw "pluginKey '$liveKey' does not match app.json name '$liveName' - the plugin would install and do nothing"
    }
    Write-Host "Component name: $liveName (matches pluginKey)" -ForegroundColor Green

    Write-Host '=== Building TaskHubDemo.snplg ===' -ForegroundColor Cyan
    & (Join-Path $root 'buildPlugin.ps1')
    if ($LASTEXITCODE -ne 0) { throw "buildPlugin.ps1 failed with exit code $LASTEXITCODE" }
}
finally {
    Write-Host '=== Restoring the working tree ===' -ForegroundColor Cyan
    # Leaves no demo bundle behind for the next real build to package.
    Remove-Item $generated -Recurse -Force -ErrorAction SilentlyContinue
    Write-Text $modePath $modeOriginal
    Write-Text $configPath $configOriginal
    Write-Text $packagePath $packageOriginal
    Write-Text $appJsonPath $appJsonOriginal

    Remove-Item "$modePath.prebuild.bak" -Force -ErrorAction SilentlyContinue
    Remove-Item "$configPath.prebuild.bak" -Force -ErrorAction SilentlyContinue
    Remove-Item "$packagePath.prebuild.bak" -Force -ErrorAction SilentlyContinue
    Remove-Item "$appJsonPath.prebuild.bak" -Force -ErrorAction SilentlyContinue

    $restored = Read-Text $modePath
    if ($restored -notmatch 'export const DEMO = false;') {
        Write-Host 'RESTORE FAILED — src/mode.ts is still in demo mode. Fix it before building the real plugin.' -ForegroundColor Red
        exit 1
    }
    Write-Host 'Working tree restored (DEMO = false).' -ForegroundColor Green
}

$output = Join-Path $root 'build\outputs\TaskHubDemo.snplg'
if (Test-Path $output) {
    $size = [math]::Round((Get-Item $output).Length / 1MB, 2)
    Write-Host "Demo plugin: $output ($size MB)" -ForegroundColor Green
} else {
    Write-Host "Expected $output but it is not there." -ForegroundColor Red
    exit 1
}
