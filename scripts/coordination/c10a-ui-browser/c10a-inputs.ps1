function Get-C10AInputs([string]$Root, [string]$Accepted) {
    $files = @(Get-ChildItem (Join-Path $Root 'frontend/src') -Recurse -File)
    $files += @(Get-ChildItem (Join-Path $Root 'frontend/dist') -Recurse -File)
    $files += @(Get-ChildItem (Join-Path $Root 'scripts/coordination/c10a-ui-browser') -File | Where-Object { $_.Name -notin @('c10a-browser-reference-manifest.json','c10a-reference-manifest.json') })
    foreach ($p in @('frontend/package.json','frontend/package-lock.json','frontend/vite.config.js','frontend/index.html','scripts/coordination/c7-incident-report/c7-helpers.psm1','scripts/coordination/c7-incident-report/fixture-cleanup.ps1')) { $files += Get-Item (Join-Path $Root $p) }
    $files += @(Get-ChildItem (Join-Path $Root 'backend/src') -Recurse -File)
    foreach ($p in @('backend/pom.xml','backend/mvnw','backend/mvnw.cmd','scripts/coordination/c8-account-assignment-browser/browser-controls.cjs')) { $files += Get-Item (Join-Path $Root $p) }
    foreach ($p in @('source-after.json','build/build-provenance-report.json','backend-copy/target/kdrive-0.1.0-SNAPSHOT.jar')) { $files += Get-Item (Join-Path $Accepted $p) }
    $pointer=Join-Path $Root '.runtime/c10a-ui-baseline-dist.txt'
    $files += Get-Item $pointer
    $baseline=Join-Path $Root ((Get-Content $pointer -Raw).Trim())
    $files += @(Get-ChildItem $baseline -Recurse -File)
    $map = [ordered]@{}
    foreach ($f in ($files | Sort-Object FullName -Unique)) { $map[$f.FullName.Substring($Root.Length + 1).Replace('\','/')] = (Get-FileHash $f.FullName).Hash }
    return $map
}

function Stop-C10AOwnedContainer([string]$Container, [bool]$Owned, [scriptblock]$InvokeCommand) {
    if (-not $Owned -or $Container -notmatch '^kltn-c10a-') { throw '[CONTAINER_GUARD] Refusing unowned fixture' }
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
