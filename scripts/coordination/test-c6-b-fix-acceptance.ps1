param(
    [Parameter(Mandatory=$true)][string]$RunnerPath,
    [Parameter(Mandatory=$true)][string]$EvidenceDir,
    [Parameter(Mandatory=$true)][ValidateSet('Inventory','Cleanup')][string]$Mode
)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $EvidenceDir){throw 'Evidence already exists'}
New-Item -ItemType Directory -Path $EvidenceDir | Out-Null
$RunnerPath=(Resolve-Path -LiteralPath $RunnerPath).Path
$script:nativeCalls=0
function docker { $script:nativeCalls++; & $env:ComSpec /c 'exit 23' }
function Start-Process { throw '[PROBE_FORBIDDEN_SPAWN]' }
$cause=''
if($Mode -eq 'Inventory') {
    try { . $RunnerPath -EvidenceDir (Join-Path $EvidenceDir 'fixture') } catch {$cause=$_.Exception.Message}
    $passed=$cause.Contains('Docker container inventory failed with native exit code 23') -and $script:nativeCalls -eq 1 -and -not (Test-Path (Join-Path $EvidenceDir 'fixture\mysql.private.env'))
} else {
    $tokens=$null; $errors=$null
    $ast=[Management.Automation.Language.Parser]::ParseFile($RunnerPath,[ref]$tokens,[ref]$errors)
    $node=$ast.Find({param($n) $n -is [Management.Automation.Language.TryStatementAst] -and $null -ne $n.Finally -and $n.Finally.Extent.Text.Contains('ownedProcessReadback')},$true)
    if($null -eq $node){throw 'Cleanup AST missing'}
    $text=$node.Finally.Extent.Text
    $body=[scriptblock]::Create($text.Substring(1,$text.Length-2))
    function Write-RunLog {param($Message) Add-Content (Join-Path $EvidenceDir 'cleanup.log') $Message}
    $backendProcess=$null; $viteProcess=$null; $containerCreated=$true
    $ContainerName='PROBE_FAKE_ONLY'; $VolumeName='PROBE_FAKE_ONLY'
    $cleanupFailureOccurred=$false; $cleanupFailureMessage=''; $overallSuccess=$true
    $SimulateCleanupFailure=$false; $SimulateCleanupFailureEarly=$false
    $held=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
    $held.Start(); $MysqlPort=$held.LocalEndpoint.Port; $BackendPort=$MysqlPort; $VitePort=$MysqlPort
    try {. $body} catch {$cause=$_.Exception.Message} finally {$held.Stop()}
    $passed=$cause.Contains('[CLEANUP_FAILURE]') -and $cause.Contains('Docker stop failed') -and $cause.Contains('Ports were not freed') -and -not $overallSuccess
}
[pscustomobject]@{Mode=$Mode;RunnerSHA256=(Get-FileHash -LiteralPath $RunnerPath).Hash;NativeExit=23;NativeCalls=$script:nativeCalls;Cause=$cause;Passed=$passed;RealDockerStarted=$false} | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'result.json')
if(-not $passed){exit 1}
