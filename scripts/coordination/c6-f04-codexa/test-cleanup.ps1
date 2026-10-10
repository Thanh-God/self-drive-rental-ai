param([Parameter(Mandatory=$true)][string]$EvidenceDir)
$ErrorActionPreference='Stop'
if(Test-Path $EvidenceDir){throw 'Evidence exists'}
New-Item -ItemType Directory $EvidenceDir | Out-Null
. (Join-Path $PSScriptRoot 'fixture-cleanup.ps1')
# Actual cleanup function; substitute only the external Docker command boundary.
function docker {
    if($args[0] -eq 'stop') {$global:LASTEXITCODE=if($script:mode -eq 'StopFailure'){23}else{0};return 'fixture'}
    if($args[0] -eq 'inspect') {
        $global:LASTEXITCODE=if($script:mode -eq 'ReadbackFailure'){23}else{0}
        return $(if($script:mode -eq 'Running'){'true'}else{'false'})
    }
    throw 'Unexpected Docker operation'
}
$results=@()
foreach($case in @('Normal','StopFailure','ReadbackFailure','Running','PortHeld','ArtifactFailure')) {
    $script:mode=$case
    $socket=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
    $socket.Start();$port=$socket.LocalEndpoint.Port
    if($case -ne 'PortHeld'){$socket.Stop()}
    $path=Join-Path $EvidenceDir "$case.json"
    if($case -eq 'ArtifactFailure'){$path=Join-Path $EvidenceDir 'absent/readback.json'}
    $cause=''
    try {Stop-F04Fixture -Container 'owned-fixture-unit' -Port $port -Owned $true -ReadbackPath $path | Out-Null}
    catch {$cause=$_.Exception.Message}
    finally {$socket.Stop()}
    if($case -eq 'Normal'){if($cause){throw "Normal failed: $cause"}}
    elseif(-not $cause.Contains('[CLEANUP_FAILURE]')){throw "Expected cleanup cause: $case"}
    $results+=[pscustomobject]@{Case=$case;ExpectedFailure=($case -ne 'Normal');Cause=$cause;Passed=$true}
}
$results | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'cases.json')
Write-Output 'PASS six actual cleanup-function cases (mock Docker boundary, real socket and artifact writes)'
