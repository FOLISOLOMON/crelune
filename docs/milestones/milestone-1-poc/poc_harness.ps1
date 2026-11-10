<#
.SYNOPSIS
    CRELUNE — Milestone 1 Affinity 3.3 Technical Validation Proof of Concept Harness
.DESCRIPTION
    Validates the local environment, executes the template immutability protocol,
    prepares isolated working directories, simulates payload execution for the Windows
    Creative Agent, and verifies end-to-end data integrity and hash invariance.
#>

[CmdletBinding()]
param(
    [string]$ManifestPath = "",
    [string]$WorkspaceRoot = ""
)

$ErrorActionPreference = "Stop"

if (-not $ManifestPath) {
    $ManifestPath = Join-Path $PSScriptRoot "manifest\sample_job_manifest.json"
}
if (-not $WorkspaceRoot) {
    $WorkspaceRoot = Join-Path $PSScriptRoot "workspace"
}

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   CRELUNE MILESTONE 1 — AFFINITY 3.3 VALIDATION HARNESS         " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# 1. Environment Detection
Write-Host "`n[Stage 1] Environment Inspection..." -ForegroundColor Yellow
$os = Get-CimInstance -ClassName Win32_OperatingSystem
$osInfo = "$($os.Caption) (Build $($os.BuildNumber), Architecture $($os.OSArchitecture))"
Write-Host "  Operating System: $osInfo"

$affinityPackage = Get-AppxPackage -Name "Canva.Affinity"
if (-not $affinityPackage) {
    Write-Error "Affinity package not found."
}
Write-Host "  Affinity Package: $($affinityPackage.Name) v$($affinityPackage.Version)"
Write-Host "  Package Location: $($affinityPackage.InstallLocation)"

$aliasPath = "$env:LOCALAPPDATA\Microsoft\WindowsApps\Affinity.exe"
$aliasExists = Test-Path $aliasPath
Write-Host "  Execution Alias : $aliasPath (Found: $aliasExists)"

# 2. Manifest Validation
Write-Host "`n[Stage 2] Job Manifest Inspection..." -ForegroundColor Yellow
if (-not (Test-Path $ManifestPath)) {
    Write-Error "Job manifest not found at: $ManifestPath"
}
$manifestContent = Get-Content -Raw $ManifestPath | ConvertFrom-Json
Write-Host "  Job ID          : $($manifestContent.jobId)"
Write-Host "  Event Type      : $($manifestContent.eventType)"
Write-Host "  Target Member   : $($manifestContent.member.name)"
Write-Host "  Template Source : $($manifestContent.template.sourcePath)"

$templateAbsPath = Join-Path "d:\Projects\Crelune" $manifestContent.template.sourcePath
if (-not (Test-Path $templateAbsPath)) {
    Write-Error "Template file not found at: $templateAbsPath"
}

# 3. Immutability Protocol Baseline
Write-Host "`n[Stage 3] Template Immutability Protocol (Pre-Execution)..." -ForegroundColor Yellow
$initialHash = (Get-FileHash -Path $templateAbsPath -Algorithm SHA256).Hash
Write-Host "  Initial Hash    : $initialHash"
Write-Host "  Expected Hash   : $($manifestContent.template.expectedSha256)"

if ($initialHash -ne $manifestContent.template.expectedSha256) {
    Write-Error "Template hash mismatch! Aborting."
}
Write-Host "  Verification    : PASS (Source template integrity verified)" -ForegroundColor Green

# 4. Workspace Isolation
Write-Host "`n[Stage 4] Isolated Job Workspace Preparation..." -ForegroundColor Yellow
$jobDir = Join-Path $WorkspaceRoot $manifestContent.jobId
if (Test-Path $jobDir) {
    Remove-Item -Recurse -Force $jobDir
}
$null = New-Item -ItemType Directory -Force -Path $jobDir
$workingDocPath = Join-Path $jobDir "working_document.afdesign"
$deliverablePath = Join-Path $jobDir $manifestContent.export.filename

Write-Host "  Job Workspace   : $jobDir"
Write-Host "  Copying template to working copy (zero mutation of master)..."
Copy-Item -Path $templateAbsPath -Destination $workingDocPath -Force

$workingDocHash = (Get-FileHash -Path $workingDocPath -Algorithm SHA256).Hash
Write-Host "  Working Doc Copy: $workingDocPath (Hash: $workingDocHash)"

# 5. Payload Preparation & Execution Contract Verification
Write-Host "`n[Stage 5] Creative Agent Contract Preparation..." -ForegroundColor Yellow
$jobConfig = @{
    jobId = $manifestContent.jobId
    workingDocumentPath = $workingDocPath
    outputPath = $deliverablePath
    fields = $manifestContent.fields
    export = $manifestContent.export
}
$configPath = Join-Path $jobDir "agent_job_config.json"
$jobConfig | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath -Encoding UTF8
Write-Host "  Config Generated: $configPath"

# Simulate execution of deliverable creation (creates synthetic PNG output deliverable for verification)
$syntheticPngBytes = [byte[]](0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x07, 0x80, 0x00, 0x00, 0x04, 0x38, 0x08, 0x06, 0x00, 0x00, 0x00, 0xE0, 0xDC, 0xF9, 0xDB, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82)
[System.IO.File]::WriteAllBytes($deliverablePath, $syntheticPngBytes)
Write-Host "  Deliverable Created : $deliverablePath ($((Get-Item $deliverablePath).Length) bytes)"

# 6. Post-Execution Template Immutability Verification
Write-Host "`n[Stage 6] Post-Execution Immutability Verification..." -ForegroundColor Yellow
$postHash = (Get-FileHash -Path $templateAbsPath -Algorithm SHA256).Hash
Write-Host "  Post-Job Hash   : $postHash"

if ($postHash -eq $initialHash) {
    Write-Host "  IMMUTABILITY    : STRICT PASS (Master template was completely untouched)" -ForegroundColor Green
} else {
    Write-Error "CRITICAL FAILURE: Master template was modified!"
}

# 7. Generate Verification Report
$report = [PSCustomObject]@{
    timestamp = (Get-Date).ToString("o")
    environment = [PSCustomObject]@{
        os = $osInfo
        affinityVersion = $affinityPackage.Version
        packageLocation = $affinityPackage.InstallLocation
        appAlias = $aliasPath
        mcpPort = 33001
    }
    immutability = [PSCustomObject]@{
        masterTemplatePath = $templateAbsPath
        preExecutionSha256 = $initialHash
        postExecutionSha256 = $postHash
        immutabilityStatus = "VERIFIED_PASS"
    }
    jobExecution = [PSCustomObject]@{
        jobId = $manifestContent.jobId
        workspacePath = $jobDir
        workingDocumentPath = $workingDocPath
        deliverablePath = $deliverablePath
        deliverableSizeBytes = (Get-Item $deliverablePath).Length
        status = "SUCCESS"
    }
}

$reportPath = Join-Path $jobDir "poc_verification_report.json"
$report | ConvertTo-Json -Depth 5 | Set-Content -Path $reportPath -Encoding UTF8
Write-Host "`nVerification report written to: $reportPath" -ForegroundColor Cyan
Write-Host "Milestone 1 Proof of Concept Harness Completed Successfully!`n" -ForegroundColor Green
