function Stop-F04Fixture {
    param([string]$Container,[int]$Port,[bool]$Owned,[string]$ReadbackPath)
    $errors=@()
    $running=$null
    $free=$true
    if($Owned) {
        try {
            & docker stop $Container | Out-Null
            if($LASTEXITCODE -ne 0){$errors+='Docker stop failed'}
        } catch {$errors+='Docker stop exception'}
        try {
            $state=@(& docker inspect --format '{{.State.Running}}' $Container)
            if($LASTEXITCODE -ne 0 -or $state.Count -ne 1 -or $state[0] -cne 'false'){$errors+='Container stop readback failed'}
            else {$running=$false}
        } catch {$errors+='Container readback exception'}
        $free=$false
        for($attempt=0;$attempt -lt 10;$attempt++) {
            $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$Port)
            try {$listener.Start();$free=$true} catch {} finally {$listener.Stop()}
            if($free){break}
            Start-Sleep -Milliseconds 200
        }
        if(-not $free){$errors+='Owned port remains occupied'}
    }
    $readback=[pscustomobject]@{Container=$Container;Owned=$Owned;Running=$running;Port=$Port;PortFree=$free;Errors=$errors;Passed=($errors.Count -eq 0)}
    try {$readback | ConvertTo-Json | Set-Content -LiteralPath $ReadbackPath -Encoding UTF8} catch {$errors+='Cleanup artifact write failed'}
    if($errors.Count){throw '[CLEANUP_FAILURE] Fixture cleanup/readback failed'}
    return $readback
}
