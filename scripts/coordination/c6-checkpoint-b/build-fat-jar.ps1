[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$EvidenceDir,[string]$OutputDir,[switch]$SkipBuildIfJarMatches,[string]$ManifestReferencePath)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$repo=(Get-Item $PSScriptRoot).Parent.Parent.Parent.FullName
$backend=Join-Path $repo 'backend'
function Get-Inputs {
 $map=[ordered]@{}
 $paths=@('pom.xml','mvnw.cmd','mvnw')+@(Get-ChildItem (Join-Path $backend '.mvn') -Recurse -File | ForEach-Object {$_.FullName.Substring($backend.Length+1)})+@(Get-ChildItem (Join-Path $backend 'src') -Recurse -File | ForEach-Object {$_.FullName.Substring($backend.Length+1)})
 foreach($rel in ($paths | Sort-Object -Unique)) {$map[$rel.Replace('\','/')]=(Get-FileHash -LiteralPath (Join-Path $backend $rel)).Hash}
 return $map
}
function Assert-Inputs($current,$reference) {
 $props=@($reference.psobject.Properties)
 if($props.Count -ne $current.Count -or $props.Count -eq 0){throw '[SOURCE_DRIFT] Manifest keyset differs'}
 foreach($p in $props){if(-not $current.Contains($p.Name) -or $current[$p.Name] -ne $p.Value){throw "[SOURCE_DRIFT] Input differs: $($p.Name)"}}
}
$before=Get-Inputs
if($ManifestReferencePath){Assert-Inputs $before (Get-Content -LiteralPath $ManifestReferencePath -Raw | ConvertFrom-Json)}
if(Test-Path -LiteralPath $EvidenceDir){throw '[PREFLIGHT_REFUSAL] Build evidence already exists'}
New-Item -ItemType Directory -Path $EvidenceDir | Out-Null
if(-not $OutputDir){$OutputDir=Join-Path $EvidenceDir 'backend'}
if(Test-Path -LiteralPath $OutputDir){throw '[PREFLIGHT_REFUSAL] Build output already exists'}
New-Item -ItemType Directory -Path $OutputDir | Out-Null
foreach($name in @('pom.xml','mvnw.cmd','mvnw','.mvn','src')){Copy-Item -LiteralPath (Join-Path $backend $name) -Destination $OutputDir -Recurse}
$before | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'build-inputs-before.json')
$old=Get-Location
try {
 Set-Location $OutputDir
 & .\mvnw.cmd -o -B -ntp "-Dmaven.repo.local=$repo/.runtime/m2" package -DskipTests > (Join-Path $EvidenceDir 'maven.log') 2>&1
 if($LASTEXITCODE -ne 0){throw "[BUILD_FAILURE] Maven exit $LASTEXITCODE"}
} finally {Set-Location $old}
$after=Get-Inputs
Assert-Inputs $after ($before | ConvertTo-Json | ConvertFrom-Json)
$after | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'build-inputs-after.json')
$jar=Join-Path $OutputDir 'target/kdrive-0.1.0-SNAPSHOT.jar'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($jar)
$sha=[Security.Cryptography.SHA256]::Create()
$checks=@()
try {
 $classes=Join-Path $OutputDir 'target/classes'
 foreach($f in Get-ChildItem $classes -Recurse -File) {
  $rel=$f.FullName.Substring($classes.Length+1).Replace('\','/')
  $entry=$zip.GetEntry("BOOT-INF/classes/$rel")
  if(-not $entry){throw "[PROVENANCE_ERROR] Missing JAR entry $rel"}
  $s=$entry.Open()
  try {$j=[BitConverter]::ToString($sha.ComputeHash($s)).Replace('-','')} finally {$s.Dispose()}
  $d=(Get-FileHash -LiteralPath $f.FullName).Hash
  if($j -ne $d){throw "[PROVENANCE_ERROR] Entry differs $rel"}
  $checks+=[pscustomobject]@{JarPath=$entry.FullName;Hash=$j;Match=$true}
 }
 if(@($zip.Entries | Where-Object {$_.FullName.StartsWith('BOOT-INF/classes/') -and -not $_.FullName.EndsWith('/')}).Count -ne $checks.Count){throw '[PROVENANCE_ERROR] JAR contains unexpected entries'}
} finally {$zip.Dispose();$sha.Dispose()}
$result=[pscustomobject]@{EffectiveJarPath=$jar;JarSHA256=(Get-FileHash $jar).Hash;BuildInputsCount=$before.Count;ClassesComparedCount=$checks.Count;AllClassesMatched=$true;OutputIsolationActive=$true;CompiledOutput=Join-Path $OutputDir 'target';ClassComparisons=$checks;BuildExitCode=0}
$result | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $EvidenceDir 'build-provenance-report.json')
$result
