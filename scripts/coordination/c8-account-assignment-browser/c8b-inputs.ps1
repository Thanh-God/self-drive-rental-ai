function Get-C8BInputs([string]$Root) {
    $files = @(Get-ChildItem (Join-Path $Root 'frontend/src') -Recurse -File)
    $files += @(Get-ChildItem (Join-Path $Root 'frontend/dist') -Recurse -File)
    $files += @(Get-ChildItem (Join-Path $Root 'scripts/coordination/c8-account-assignment-browser') -File | Where-Object { $_.Name -ne 'c8b-reference-manifest.json' })
    foreach ($p in @('frontend/package.json','frontend/package-lock.json','frontend/vite.config.js','frontend/index.html','scripts/coordination/c7-incident-report/c7-helpers.psm1','scripts/coordination/c7-incident-report/fixture-cleanup.ps1')) { $files += Get-Item (Join-Path $Root $p) }
    $map = [ordered]@{}
    foreach ($f in ($files | Sort-Object FullName -Unique)) { $map[$f.FullName.Substring($Root.Length + 1).Replace('\','/')] = (Get-FileHash $f.FullName).Hash }
    return $map
}
