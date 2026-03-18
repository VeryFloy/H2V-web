# H2V iOS Pre-Push Validator (Windows)
# Run from repo root: .\scripts\validate-ios.ps1

$ErrorCount = 0
$IosDir = Join-Path $PSScriptRoot "..\h2v_ios\h2v_ios"
$PbxPath = Join-Path $PSScriptRoot "..\h2v_ios\h2v_ios.xcodeproj\project.pbxproj"

function Fail($msg) {
    Write-Host "[FAIL] $msg" -ForegroundColor Red
    $script:ErrorCount++
}
function Pass($msg) { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }

Write-Host ""
Write-Host "=== H2V iOS Pre-Push Validator ===" -ForegroundColor Magenta
Write-Host ""

# Check 1: Production URLs
Write-Host "1. Checking production URLs..." -ForegroundColor Yellow
$networkFile = Join-Path $IosDir "Network.swift"
if (Test-Path $networkFile) {
    $content = Get-Content $networkFile -Raw
    if ($content -match 'localhost') {
        Fail "Network.swift contains 'localhost' - use production URL!"
        Info "Change to: https://h2von.com and wss://h2von.com/ws"
    } else {
        Pass "No localhost references"
    }
    if ($content -match 'http://') {
        Fail "Network.swift uses plain HTTP - must be HTTPS in production"
    } else {
        Pass "HTTPS/WSS URLs"
    }
} else {
    Fail "Network.swift not found at: $networkFile"
}

# Check 2: No bare print() calls outside #if DEBUG
Write-Host ""
Write-Host "2. Checking for debug print() calls..." -ForegroundColor Yellow
$swiftFiles = Get-ChildItem -Path $IosDir -Filter "*.swift" -Recurse -ErrorAction SilentlyContinue
$printIssues = @()
foreach ($file in $swiftFiles) {
    $lines = Get-Content $file.FullName
    $inDebugBlock = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if ($line -match '#if\s+DEBUG') { $inDebugBlock = $true }
        if ($line -match '#endif') { $inDebugBlock = $false }
        if (-not $inDebugBlock -and $line -match '^\s*(print|debugPrint)\s*\(') {
            $printIssues += "$($file.Name):$($i+1)"
        }
    }
}
if ($printIssues.Count -gt 0) {
    Fail "print() outside #if DEBUG found ($($printIssues.Count) places):"
    $printIssues | Select-Object -First 5 | ForEach-Object { Info "  $_" }
} else {
    Pass "No bare print() calls"
}

# Check 3: Brace balance
Write-Host ""
Write-Host "3. Checking brace balance..." -ForegroundColor Yellow
$braceErrors = @()
foreach ($file in $swiftFiles) {
    $text = Get-Content $file.FullName -Raw
    $stripped = $text -replace '"[^"\\]*(?:\\.[^"\\]*)*"', '""' -replace '//[^\n]*', ''
    $open  = ([regex]::Matches($stripped, '\{')).Count
    $close = ([regex]::Matches($stripped, '\}')).Count
    if ($open -ne $close) {
        $braceErrors += "$($file.Name): { $open  } $close"
    }
}
if ($braceErrors.Count -gt 0) {
    Fail "Unbalanced braces in $($braceErrors.Count) file(s):"
    $braceErrors | ForEach-Object { Info "  $_" }
} else {
    Pass "All files have balanced braces"
}

# Check 4: Swift files referenced in project exist on disk
Write-Host ""
Write-Host "4. Checking project file references..." -ForegroundColor Yellow
if (Test-Path $PbxPath) {
    $pbxContent = Get-Content $PbxPath -Raw
    $matches_ = [regex]::Matches($pbxContent, 'path = ([A-Za-z0-9_]+\.swift)')
    $missing = @()
    foreach ($m in $matches_) {
        $fname = $m.Groups[1].Value.Trim()
        $found = Get-ChildItem -Path $IosDir -Filter $fname -Recurse -ErrorAction SilentlyContinue
        if (-not $found) { $missing += $fname }
    }
    if ($missing.Count -gt 0) {
        Fail "Files referenced in .xcodeproj but missing on disk: $($missing -join ', ')"
    } else {
        Pass "All referenced Swift files exist"
    }
} else {
    Info "Skipping project reference check (pbxproj not found)"
}

# Check 5: SwiftLint (optional)
Write-Host ""
Write-Host "5. SwiftLint (optional)..." -ForegroundColor Yellow
$swiftlintCmd = Get-Command swiftlint -ErrorAction SilentlyContinue
if ($swiftlintCmd) {
    $result = & swiftlint lint --path $IosDir --quiet 2>&1
    if ($LASTEXITCODE -ne 0) {
        Fail "SwiftLint found issues:"
        $result | Select-Object -First 10 | ForEach-Object { Info "  $_" }
    } else {
        Pass "SwiftLint passed"
    }
} else {
    Info "SwiftLint not installed - skipping"
    Info "Install: https://github.com/realm/SwiftLint/releases (swiftlint-portable-windows.zip)"
}

# Summary
Write-Host ""
Write-Host "=== Result ===" -ForegroundColor Magenta
if ($ErrorCount -eq 0) {
    Write-Host "[PASS] All checks passed - safe to push!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "[FAIL] $ErrorCount error(s) found - fix before pushing" -ForegroundColor Red
    exit 1
}
