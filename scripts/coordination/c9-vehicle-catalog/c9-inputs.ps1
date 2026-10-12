function Get-C9Inputs([string]$Root, [string]$Accepted) {
    $files = @(Get-ChildItem (Join-Path $Root 'frontend/src') -Recurse -File)
    $files += @(Get-ChildItem (Join-Path $Root 'frontend/dist') -Recurse -File)
    $files += @(Get-ChildItem (Join-Path $Root 'scripts/coordination/c9-vehicle-catalog') -File | Where-Object { $_.Name -notin @('c9-browser-reference-manifest.json','c9-reference-manifest.json') })
    foreach ($p in @('frontend/package.json','frontend/package-lock.json','frontend/vite.config.js','frontend/index.html','scripts/coordination/c7-incident-report/c7-helpers.psm1','scripts/coordination/c7-incident-report/fixture-cleanup.ps1')) { $files += Get-Item (Join-Path $Root $p) }
    $files += @(Get-ChildItem (Join-Path $Root 'backend/src') -Recurse -File)
    foreach ($p in @('backend/pom.xml','backend/mvnw','backend/mvnw.cmd','scripts/coordination/c8-account-assignment-browser/browser-controls.cjs')) { $files += Get-Item (Join-Path $Root $p) }
    foreach ($p in @('source-after.json','build/build-provenance-report.json','backend-copy/target/kdrive-0.1.0-SNAPSHOT.jar')) { $files += Get-Item (Join-Path $Accepted $p) }
    $map = [ordered]@{}
    foreach ($f in ($files | Sort-Object FullName -Unique)) { $map[$f.FullName.Substring($Root.Length + 1).Replace('\','/')] = (Get-FileHash $f.FullName).Hash }
    return $map
}
