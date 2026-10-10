param([Parameter(Mandatory=$true)][string]$EvidenceDir)
$ErrorActionPreference='Stop'
if(Test-Path $EvidenceDir){throw 'Evidence already exists'}
New-Item -ItemType Directory $EvidenceDir | Out-Null
$build=Join-Path $PSScriptRoot 'build-fat-jar.ps1'
$result=& $build -EvidenceDir (Join-Path $EvidenceDir 'normal') -OutputDir (Join-Path $EvidenceDir 'output')
foreach($suffix in @('ReviewController$Input.class','ReviewController$Moderation.class')){
 if(-not @($result.ClassComparisons | Where-Object {$_.JarPath.EndsWith($suffix)}).Count){throw "Nested class not verified $suffix"}
}
$manifest=Get-Content (Join-Path $EvidenceDir 'normal/build-inputs-before.json') -Raw | ConvertFrom-Json
$cases=@()
foreach($mode in @('Empty','Missing','Extra','Changed')) {
 $map=[ordered]@{};foreach($p in $manifest.psobject.Properties){$map[$p.Name]=$p.Value}
 switch($mode){'Empty'{$map=[ordered]@{}} 'Missing'{$map.Remove('pom.xml')} 'Extra'{$map['unexpected.java']='bad'} 'Changed'{$map['pom.xml']='bad'}}
 $ref=Join-Path $EvidenceDir "$mode.json";$map | ConvertTo-Json | Set-Content $ref
 $cause=''
 try {& $build -EvidenceDir (Join-Path $EvidenceDir $mode) -ManifestReferencePath $ref} catch {$cause=$_.Exception.Message}
 if(-not $cause.Contains('[SOURCE_DRIFT]')){throw "Wrong rejection $mode : $cause"}
 $cases+=[pscustomobject]@{Mode=$mode;Cause=$cause;Passed=$true}
}
$cases | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'adverse.json')
[pscustomobject]@{Entries=$result.ClassesComparedCount;Inputs=$result.BuildInputsCount;BuildExit=$result.BuildExitCode;AllPassed=$true} | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'summary.json')
