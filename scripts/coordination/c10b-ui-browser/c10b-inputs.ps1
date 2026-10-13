function Get-C10BInputs([string]$Root, [string]$Accepted) {
    $files = @(Get-ChildItem (Join-Path $Root 'frontend/src') -Recurse -File)
    $files += @(Get-ChildItem (Join-Path $Root 'frontend/dist') -Recurse -File)
    $files += @(Get-ChildItem (Join-Path $Root 'scripts/coordination/c10b-ui-browser') -File | Where-Object { $_.Extension -in @('.ps1','.cjs') })
    foreach ($p in @('frontend/package.json','frontend/package-lock.json','frontend/vite.config.js','frontend/index.html','scripts/coordination/c7-incident-report/c7-helpers.psm1','scripts/coordination/c7-incident-report/fixture-cleanup.ps1')) { $files += Get-Item (Join-Path $Root $p) }
    $files += @(Get-ChildItem (Join-Path $Root 'backend/src') -Recurse -File)
    foreach ($p in @('backend/pom.xml','backend/mvnw','backend/mvnw.cmd','scripts/coordination/c8-account-assignment-browser/browser-controls.cjs')) { $files += Get-Item (Join-Path $Root $p) }
    foreach ($p in @('source-after.json','build/build-provenance-report.json','backend-copy/target/kdrive-0.1.0-SNAPSHOT.jar')) { $files += Get-Item (Join-Path $Accepted $p) }
    $files += @(Get-ChildItem (Join-Path $Root 'frontend/public') -Recurse -File)
    $map = [ordered]@{}
    foreach ($f in ($files | Sort-Object FullName -Unique)) { $map[$f.FullName.Substring($Root.Length + 1).Replace('\','/')] = (Get-FileHash $f.FullName).Hash }
    return $map
}

function Stop-C10BOwnedContainer([string]$Container, [bool]$Owned, [scriptblock]$InvokeCommand) {
    if (-not $Owned -or $Container -notmatch '^kltn-c10b-') { throw '[CONTAINER_GUARD] Refusing unowned fixture' }
    if (-not $InvokeCommand) {
        $InvokeCommand = {
            param($Verb, $Name)
            $output = if ($Verb -eq 'stop') { @(& docker stop $Name 2>&1) } else { @(& docker inspect --format '{{.State.Running}}' $Name 2>&1) }
            [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = @($output) }
        }
    }
    $stop = & $InvokeCommand 'stop' $Container
    if ($stop.ExitCode -ne 0) { return [pscustomobject]@{ Passed = $false; Stage = 'stop'; ExitCode = $stop.ExitCode } }
    $readback = & $InvokeCommand 'inspect' $Container
    [pscustomobject]@{
        Passed = ($readback.ExitCode -eq 0 -and $readback.Output.Count -eq 1 -and $readback.Output[0].ToString().Trim() -ceq 'false')
        Stage = 'inspect'
        ExitCode = $readback.ExitCode
    }
}
