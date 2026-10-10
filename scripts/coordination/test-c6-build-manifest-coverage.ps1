param([Parameter(Mandatory=$true)][string]$BuildScript,[Parameter(Mandatory=$true)][string]$EvidenceDir)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $EvidenceDir){throw 'Evidence already exists'}
New-Item -ItemType Directory -Path $EvidenceDir | Out-Null
$reference=Join-Path $EvidenceDir 'empty-reference.json'
'{}' | Set-Content -LiteralPath $reference
$caught=''
try {
    & $BuildScript -EvidenceDir (Join-Path $EvidenceDir 'actual') -OutputDir (Join-Path $EvidenceDir 'jar-copy') -SkipBuildIfJarMatches -ManifestReferencePath $reference > (Join-Path $EvidenceDir 'build.log')
} catch {$caught=$_.Exception.Message}
$passed=$caught.Contains('[SOURCE_DRIFT]') -or $caught.Contains('[MANIFEST_ERROR]')
[pscustomobject]@{EmptyReferenceRejected=$passed;Cause=$caught;SourceModified=$false;BuildScriptSHA256=(Get-FileHash -LiteralPath $BuildScript).Hash} | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'result.json')
if(-not $passed){exit 1}
