# c7-helpers.psm1
# Module chứa các helper cho C7 Incident Reporting:
# - Protect-SensitiveText & Invoke-DockerSqlSafe: Redaction logger và an toàn SQL
# - Invoke-OwnedProcessCleanup: Dừng an toàn owned process
# - Snapshot-ProcessEnvironment & Restore-ProcessEnvironment: Chụp và phục hồi env absent/existing
# - Assert-SurefireXmlStrict: Strict Surefire XML validation
# - Snapshot-DatabaseTableState: Chụp snapshot dữ liệu bảng để đối soát bất biến

Set-StrictMode -Version Latest

function Protect-SensitiveText {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Text,
        
        [Parameter(Mandatory = $false)]
        [string[]]$KnownSecrets = @()
    )

    if ([string]::IsNullOrEmpty($Text)) {
        return $Text
    }

    $clean = $Text
    if ($KnownSecrets) {
        foreach ($sec in $KnownSecrets) {
            if (-not [string]::IsNullOrEmpty($sec)) {
                $clean = $clean.Replace($sec, "[REDACTED]")
            }
        }
    }
    $clean = $clean -replace "(?i)(password|token|secret|pwd)\s*=\s*['""]?[^'"";\s]+['""]?", '$1=[REDACTED]'
    $clean = $clean -replace "(?i)(marker_token\s*\)\s*VALUES\s*\([^)]*?)'[^']+'(\s*\))", '$1''[REDACTED]''$2'
    $clean = $clean -replace "(?i)(VALUES\s*\([^)]*?,\s*)'[^']+'(\s*\))", '$1''[REDACTED]''$2'
    $clean = $clean -replace "(?i)(VALUES\s*\(\s*)'[^']+'(\s*\))", '$1''[REDACTED]''$2'
    $clean = $clean -replace "(?i)'SYNTHETIC_[^']+'", "'[REDACTED]'"
    $clean = $clean -replace "(?i)\bSYNTHETIC_[A-Z0-9_]+\b", "[REDACTED]"
    $clean = $clean -replace "(?i)\b[0-9a-f]{32}\b", "[REDACTED]"

    return $clean
}

function Invoke-OwnedProcessCleanup {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$OwnedProcesses,
        
        [Parameter(Mandatory = $false)]
        [scriptblock]$LogAction = $null,
        
        [Parameter(Mandatory = $false)]
        [scriptblock]$CustomStopProcess = $null
    )

    $cleanupFailed = $false
    $stoppedPids = [Collections.Generic.List[int]]::new()

    foreach ($proc in $OwnedProcesses) {
        if ($null -eq $proc) {
            continue
        }

        $hasExited = $false
        $targetPid = $null

        if ($proc -is [System.Diagnostics.Process]) {
            $hasExited = $proc.HasExited
            $targetPid = $proc.Id
        } elseif ($proc -is [hashtable] -or $proc -is [pscustomobject]) {
            $hasExited = [bool]$proc.HasExited
            $targetPid = [int]$proc.Id
        }

        if (-not $hasExited -and $null -ne $targetPid) {
            try {
                if ($LogAction) {
                    & $LogAction "Stopping Owned process (PID $targetPid)..."
                }

                if ($CustomStopProcess) {
                    & $CustomStopProcess $targetPid
                } else {
                    & taskkill.exe /PID $targetPid /T /F | Out-Null
                    if($LASTEXITCODE -ne 0){throw 'Owned process-tree stop failed'}
                }

                if($proc -is [System.Diagnostics.Process]){$null=$proc.WaitForExit(5000)}
                $stillRunning = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
                if ($stillRunning) {
                    throw "Process PID $targetPid still running after Stop-Process"
                }

                $stoppedPids.Add($targetPid)
                if ($LogAction) {
                    & $LogAction "Owned process PID $targetPid verified stopped."
                }
            } catch {
                if ($LogAction) {
                    & $LogAction "CLEANUP FAILURE: Failed to stop process PID $($targetPid): $_"
                }
                $cleanupFailed = $true
            }
        }
    }

    return [pscustomobject]@{
        Success       = (-not $cleanupFailed)
        CleanupFailed = $cleanupFailed
        StoppedPids   = $stoppedPids.ToArray()
    }
}

function Snapshot-ProcessEnvironment {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$VariableNames
    )

    $snapshot = [ordered]@{}
    foreach ($varName in $VariableNames) {
        $snapshot[$varName] = [Environment]::GetEnvironmentVariable($varName, "Process")
    }
    return $snapshot
}

function Restore-ProcessEnvironment {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary]$SavedEnvironment
    )

    foreach ($varName in $SavedEnvironment.Keys) {
        $val = $SavedEnvironment[$varName]
        [Environment]::SetEnvironmentVariable($varName, $val, "Process")
    }
}

function Assert-SurefireXmlStrict {
    param(
        [Parameter(Mandatory = $true)]
        [string]$XmlPath,
        
        [Parameter(Mandatory = $true)]
        [int]$ExpectedTests,
        
        [Parameter(Mandatory = $false)]
        [int]$ExpectedFailures = 0,
        
        [Parameter(Mandatory = $false)]
        [int]$ExpectedErrors = 0,
        
        [Parameter(Mandatory = $false)]
        [int]$ExpectedSkipped = 0
    )

    if (-not (Test-Path -LiteralPath $XmlPath)) {
        throw "Surefire report missing: $XmlPath"
    }

    [xml]$xml = Get-Content -LiteralPath $XmlPath -Raw
    $testsuite = $xml.testsuite
    if (-not $testsuite) {
        throw "Invalid surefire XML (missing <testsuite>): $XmlPath"
    }

    $attrs = @('tests', 'failures', 'errors', 'skipped')
    $values = @{}
    foreach ($attr in $attrs) {
        $rawValue = $testsuite.GetAttribute($attr)
        if ([string]::IsNullOrWhiteSpace($rawValue)) {
            throw "XML attribute '$attr' is missing or blank in $([System.IO.Path]::GetFileName($XmlPath))"
        }
        if (-not ($rawValue -match '^\d+$')) {
            throw "XML attribute '$attr' is not a valid non-negative integer: '$rawValue' in $([System.IO.Path]::GetFileName($XmlPath))"
        }
        $intValue = [int]$rawValue
        if ($intValue -lt 0) {
            throw "XML attribute '$attr' is negative: $intValue in $([System.IO.Path]::GetFileName($XmlPath))"
        }
        $values[$attr] = $intValue
    }

    $tests = $values['tests']
    $failures = $values['failures']
    $errors = $values['errors']
    $skipped = $values['skipped']

    if ($tests -ne $ExpectedTests) {
        throw "XML Count Mismatch in $([System.IO.Path]::GetFileName($XmlPath)): expected $ExpectedTests tests, found $tests."
    }
    if ($failures -ne $ExpectedFailures) {
        throw "XML Failure Mismatch in $([System.IO.Path]::GetFileName($XmlPath)): expected $ExpectedFailures failures, found $failures."
    }
    if ($errors -ne $ExpectedErrors) {
        throw "XML Error Mismatch in $([System.IO.Path]::GetFileName($XmlPath)): expected $ExpectedErrors errors, found $errors."
    }
    if ($skipped -ne $ExpectedSkipped) {
        throw "XML Skipped Mismatch in $([System.IO.Path]::GetFileName($XmlPath)): expected $ExpectedSkipped skipped, found $skipped."
    }

    return @{
        Tests    = $tests
        Failures = $failures
        Errors   = $errors
        Skipped  = $skipped
        Pass     = ($tests - $failures - $errors - $skipped)
    }
}

Export-ModuleMember -Function Protect-SensitiveText, Invoke-OwnedProcessCleanup, Snapshot-ProcessEnvironment, Restore-ProcessEnvironment, Assert-SurefireXmlStrict

