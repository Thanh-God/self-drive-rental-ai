param([Parameter(Mandatory=$true)][string]$EvidenceDirectory)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $EvidenceDirectory){throw 'Refuse existing test evidence'}
New-Item -ItemType Directory -Path $EvidenceDirectory | Out-Null
$script=Join-Path $PSScriptRoot 'verify-docker-storage.ps1'
$before=Join-Path $EvidenceDirectory 'before'
$after=Join-Path $EvidenceDirectory 'after'
New-Item -ItemType Directory -Path $before,$after | Out-Null
$files=@('containers.txt','volumes.txt','images.txt','kdrive-private.sql','flyway.txt')
foreach($name in $files){'fixture' | Set-Content (Join-Path $before $name); 'fixture' | Set-Content (Join-Path $after $name)}
$summary=@{ServerVersion='fixture-version';MySQLPort33385=$true} | ConvertTo-Json
$summary | Set-Content (Join-Path $before 'summary.json')
$summary | Set-Content (Join-Path $after 'summary.json')
& $script -Mode Compare -BeforeDirectory $before -AfterDirectory $after
$passed=1
foreach($name in $files){
    'changed' | Set-Content (Join-Path $after $name)
    $caught=$false
    try{& $script -Mode Compare -BeforeDirectory $before -AfterDirectory $after}catch{if($_.Exception.Message -eq "Snapshot mismatch: $name"){$caught=$true}else{throw}}
    if(-not $caught){throw "Comparator accepted drift: $name"}
    'fixture' | Set-Content (Join-Path $after $name)
    $passed++
}
$missing=Join-Path $EvidenceDirectory 'incomplete'
New-Item -ItemType Directory -Path $missing | Out-Null
$caught=$false
try{& $script -Mode Compare -BeforeDirectory $before -AfterDirectory $missing}catch{if($_.Exception.Message -like 'Missing required snapshot:*'){$caught=$true}else{throw}}
if(-not $caught){throw 'Missing evidence accepted'}
$passed++
foreach($case in @('version','endpoint')){
    $bad=@{ServerVersion='fixture-version';MySQLPort33385=$true}
    if($case -eq 'version'){$bad.ServerVersion='other'}else{$bad.MySQLPort33385=$false}
    $bad | ConvertTo-Json | Set-Content (Join-Path $after 'summary.json')
    $caught=$false
    try{& $script -Mode Compare -BeforeDirectory $before -AfterDirectory $after}catch{if(($case -eq 'version' -and $_.Exception.Message -like 'Docker server version changed*') -or ($case -eq 'endpoint' -and $_.Exception.Message -eq 'MySQL endpoint not verified')){$caught=$true}else{throw}}
    if(-not $caught){throw "Accepted invalid $case"}
    $passed++
}
"PASS: $passed comparator checks (same, five drifts, missing, version, endpoint)" | Tee-Object -FilePath (Join-Path $EvidenceDirectory 'result.txt')
