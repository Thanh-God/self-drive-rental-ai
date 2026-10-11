function Assert-FixtureCleanupTarget {
    param($Expected, $Actual, [string[]]$VolumeReferences, [string[]]$ProtectedNames,
          [switch]$RequireArchive, [bool]$ArchiveVerified = $false)
    if ($Expected.Action -ne 'ARCHIVE_THEN_REMOVE') { throw '[NOT_SELECTED]' }
    if ($Expected.Name -notmatch '^kltn-(c[3456][ab]?|staff-c[34][ab]?|cb)-[a-zA-Z0-9_.-]+$' -or
        $Expected.Name -eq 'kltn-phase5-rerun' -or $Expected.Name -in $ProtectedNames) {
        throw '[PROTECTED_TARGET]'
    }
    if (-not $Expected.Id -or $Actual.Id -ne $Expected.Id -or
        $Actual.Name.TrimStart('/') -ne $Expected.Name -or $Actual.Image -ne $Expected.Image) {
        throw '[IDENTITY_DRIFT]'
    }
    if ($Actual.State.Running -ne $false) { throw '[NOT_STOPPED]' }
    $planned = @($Expected.Volumes)
    $mounted = @($Actual.Mounts | Where-Object Type -eq 'volume')
    if ($planned.Count -ne 1 -or $mounted.Count -ne 1 -or
        -not $planned[0].Name -or $mounted[0].Name -ne $planned[0].Name -or
        $mounted[0].Destination -ne '/var/lib/mysql') { throw '[MOUNT_DRIFT]' }
    if ($VolumeReferences.Count -ne 1 -or $VolumeReferences[0] -ne $Expected.Id) {
        throw '[SHARED_VOLUME]'
    }
    if ($RequireArchive -and -not $ArchiveVerified) { throw '[ARCHIVE_NOT_VERIFIED]' }
}
Export-ModuleMember -Function Assert-FixtureCleanupTarget
