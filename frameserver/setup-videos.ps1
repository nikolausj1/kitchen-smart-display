<#
.SYNOPSIS
    Install the Music Videos tooling on the NUC: yt-dlp.exe and ffmpeg.exe in
    C:\Services\FrameServer\bin, a weekly yt-dlp self-update task, and the
    environment variables SmartDisplayFrameServer reads to find them and the
    NAS collection.

.DESCRIPTION
    Work package for docs/designs/music-videos.md ("Storage", "Tooling on the
    NUC"). Idempotent: each step looks at the current state and changes only
    what differs, so re-running this script is also how to repair it. yt-dlp
    itself is updated by its own weekly task (step 4), not by re-running this.

    Run it elevated on the NUC. From the Mac, at the repo root:
        scp -i ~/.ssh/sportsbox_nuc_ed25519 frameserver/setup-videos.ps1 micro@nuc.local:C:/Services/setup-videos.ps1
        ssh -i ~/.ssh/sportsbox_nuc_ed25519 micro@nuc.local "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Services\setup-videos.ps1"
    Report only, changing nothing (add -Check to the same ssh line).

    Steps:
      1. Make sure C:\Services\FrameServer\bin exists. deploy.sh never writes
         or deletes there (it only copies into app\, lib\, scripts\ and the
         top-level server files), so the binaries survive a deploy.
      2. yt-dlp.exe: download the latest release into bin\ when missing; when
         present run `yt-dlp.exe -U` instead. Print the version.
      3. ffmpeg.exe and ffprobe.exe: when either is missing, download the
         gyan.dev "essentials" release zip, extract only those two files from
         its bin\ folder, delete the zip. Print the first line of
         `ffmpeg -version`.
      4. Scheduled task SmartDisplayYtDlpUpdate: Sundays 04:00 as SYSTEM, runs
         whether anyone is logged on or not, runs `bin\yt-dlp.exe -U`. Created
         or corrected to exactly that.
      5. The service environment: merge MUSIC_VIDEOS_DIR, YTDLP_PATH and
         FFMPEG_PATH into AppEnvironmentExtra of SmartDisplayFrameServer,
         keeping every other entry that is already there. The service is
         restarted only when this changed something.
      6. The service account. NOT changed by this script (that needs a
         password); the instructions are printed, with the current state.

    -Check reports versions, task, environment, service account and whether
    the NAS path is reachable from THIS shell, and changes nothing. A yes on
    reachability is not proof for the service: the service runs in its own
    logon session, which is the whole reason step 6 exists.

    Never touched: the service's account (ObjectName), Application,
    AppDirectory, AppParameters or any other nssm setting, the other
    AppEnvironmentExtra entries, C:\Services\FrameServer's code and data,
    SmartDisplaySonosAPI, the firewall.

    Facts this script depends on (re-check them if a step starts failing):
      - yt-dlp: https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe
        redirects to the newest release asset; the .exe is a self-contained
        build with no Python needed. `yt-dlp.exe -U` replaces the file in
        place (it renames the running exe aside and writes the new one), so
        the account running it needs write access to bin\. SYSTEM and the
        admin that creates the folder both have it. `--version` prints just
        the version string, for example 2026.10.14.
      - ffmpeg: https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
        always points at the current stable "essentials" build. The zip holds
        one top-level folder (ffmpeg-<version>-essentials_build) with bin\
        ffmpeg.exe, ffprobe.exe and ffplay.exe inside it. Only the first two
        are kept. Merging video and audio into mp4 is a stream copy, so the
        essentials build is enough (no codec libraries beyond what it ships).
      - nssm: `nssm get <svc> AppEnvironmentExtra` prints one KEY=value per
        line. `nssm set <svc> AppEnvironmentExtra A=1 B=2` takes each entry as
        its own argument and REPLACES the whole list, hence the read, merge
        and write. nssm reads the environment when the service starts, so a
        change needs a restart. An argument containing spaces (the NAS path)
        is quoted by PowerShell on the way in; it must not end in a backslash,
        which is why trailing ones are trimmed off -VideosDir.
      - ObjectName: `nssm get <svc> ObjectName` prints LocalSystem, or the
        account as .\<user> once one is set. The service runs as LocalSystem today, and SMB paths do not
        authenticate for that account (docs/designs/photo-refresh-automation.md,
        "Sharp edges"), so the collection on \\MissionControl needs a real
        account whose Credential Manager holds the NAS login.
      - The hub's health route (GET /api/video/health, music-videos.md) returns
        "reachable": true only when the service process itself can read
        MUSIC_VIDEOS_DIR. That, not -Check, is the real test.

    Rollback:
        nssm set SmartDisplayFrameServer ObjectName LocalSystem
        Unregister-ScheduledTask -TaskName SmartDisplayYtDlpUpdate -Confirm:$false
        (optional) nssm set SmartDisplayFrameServer AppEnvironmentExtra <the other entries only>
        (optional) Remove-Item C:\Services\FrameServer\bin\yt-dlp.exe, ffmpeg.exe, ffprobe.exe
        nssm restart SmartDisplayFrameServer

.PARAMETER VideosDir
    The collection root the hub reads and writes. Becomes MUSIC_VIDEOS_DIR.

.PARAMETER Check
    Report only; change nothing.
#>
[CmdletBinding()]
param(
    [string]$VideosDir = '\\MissionControl\Media\Music Videos TV',
    [switch]$Check
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
$ServiceName  = 'SmartDisplayFrameServer'
$TaskName     = 'SmartDisplayYtDlpUpdate'
$InstallDir   = 'C:\Services\FrameServer'
$BinDir       = Join-Path $InstallDir 'bin'
$YtDlp        = Join-Path $BinDir 'yt-dlp.exe'
$Ffmpeg       = Join-Path $BinDir 'ffmpeg.exe'
$Ffprobe      = Join-Path $BinDir 'ffprobe.exe'
$YtDlpUrl     = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
$FfmpegZipUrl = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
$HubUrl       = 'http://127.0.0.1:8095'
$VideosDir    = $VideosDir.TrimEnd('\')   # a trailing backslash breaks quoted native arguments
$EnvWanted    = [ordered]@{
    MUSIC_VIDEOS_DIR = $VideosDir
    YTDLP_PATH       = $YtDlp
    FFMPEG_PATH      = $Ffmpeg
}
$EnvLines     = @($EnvWanted.Keys | ForEach-Object { '{0}={1}' -f $_, $EnvWanted[$_] })

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Step([string]$Text) {
    Write-Host ''
    Write-Host "==> $Text"
}

function Invoke-Native {
    # Run a console program, echo its output indented, throw on a non-zero exit.
    # Windows PowerShell 5.1 turns redirected native stderr into error records,
    # which 'Stop' would treat as fatal, so the preference is relaxed for the
    # call and the exit code decides. NULs are stripped because nssm can emit
    # UTF-16 when its output is piped.
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [switch]$Quiet
    )
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(& $FilePath @ArgumentList 2>&1 | ForEach-Object { ("$_" -replace "`0", '').TrimEnd() })
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $saved
    }
    if (-not $Quiet) {
        $output | Where-Object { $_ } | ForEach-Object { Write-Host "    $_" }
    }
    if ($code -ne 0) {
        throw ("'{0} {1}' exited with code {2}`n{3}" -f $FilePath, ($ArgumentList -join ' '), $code, ($output -join "`n"))
    }
    return $output
}

function Get-NssmLines([string[]]$Keys) {
    # 'nssm get' for one setting as an array of non-empty lines, @() when unset.
    # Never throws.
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $script:Nssm get $ServiceName @Keys 2>$null
    } finally {
        $ErrorActionPreference = $saved
    }
    $lines = @(@($out) | ForEach-Object { ("$_" -replace "`0", '').Trim() } | Where-Object { $_ })
    return $lines
}

function Get-NssmValue([string[]]$Keys) {
    return ((Get-NssmLines $Keys) -join "`n")
}

function Save-Download([string]$Url, [string]$Dest) {
    # Download to a side name and move into place, so a failed or half download
    # never replaces a working file.
    $tmp = "$Dest.download"
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    try {
        Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing
        if ((Get-Item -LiteralPath $tmp).Length -lt 1MB) { throw "Download from $Url is suspiciously small." }
        Move-Item -LiteralPath $tmp -Destination $Dest -Force
    } finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

function Get-FirstLine([string]$Exe, [string[]]$ArgumentList) {
    # First output line of a tool, or $null when it is missing or fails.
    if (-not (Test-Path -LiteralPath $Exe)) { return $null }
    try {
        $out = Invoke-Native -FilePath $Exe -ArgumentList $ArgumentList -Quiet
        return (@($out | Where-Object { $_ }) | Select-Object -First 1)
    } catch {
        return $null
    }
}

function Get-TaskProblems {
    # What differs between the installed task and the one this script wants.
    # An empty array means the task is as intended.
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) { return @('task is missing') }
    $problems = @()
    $actions = @($task.Actions)
    if ($actions.Count -ne 1 -or $actions[0].Execute -ne $YtDlp -or "$($actions[0].Arguments)".Trim() -ne '-U') {
        $problems += 'action is not: bin\yt-dlp.exe -U'
    }
    $triggers = @($task.Triggers)
    $trigOk = $false
    if ($triggers.Count -eq 1) {
        $t = $triggers[0]
        # DaysOfWeek is a bitmask in the weekly trigger; Sunday is 1.
        if ($t.CimClass.CimClassName -eq 'MSFT_TaskWeeklyTrigger' -and
            [int]$t.DaysOfWeek -eq 1 -and
            [int]$t.WeeksInterval -eq 1 -and
            "$($t.StartBoundary)" -like '*T04:00:00*' -and
            $t.Enabled) {
            $trigOk = $true
        }
    }
    if (-not $trigOk) { $problems += 'trigger is not: weekly, Sunday 04:00' }
    if ("$($task.Principal.UserId)" -ne 'SYSTEM' -or "$($task.Principal.LogonType)" -ne 'ServiceAccount') {
        $problems += 'principal is not SYSTEM (run whether logged on or not)'
    }
    if (-not $task.Settings.Enabled) { $problems += 'task is disabled' }
    return $problems
}

function Show-AccountInstructions([string]$ObjectName) {
    $isSystem = ($ObjectName -eq '' -or $ObjectName -ieq 'LocalSystem')
    Write-Host "    Service account now: $(if ($ObjectName) { $ObjectName } else { '(unreadable)' })"
    if ($isSystem) {
        Write-Host '    LocalSystem cannot authenticate to \\MissionControl, so the NAS folder will'
        Write-Host '    show "reachable": false until the service runs as a real account.'
    } else {
        Write-Host '    Already a named account. Still confirm the steps below were done for it.'
    }
    Write-Host ''
    Write-Host '    By hand, as Justin (this script cannot know the password):'
    Write-Host "      1. nssm get $ServiceName ObjectName"
    Write-Host "      2. If it says LocalSystem:  nssm set $ServiceName ObjectName .\<windows user> <password>"
    Write-Host '         nssm normally grants "Log on as a service" while setting it; confirm in'
    Write-Host '         secpol.msc > Local Policies > User Rights Assignment > Log on as a service.'
    Write-Host '      3. Sign in as that same user (console or RDP; Credential Manager is per'
    Write-Host '         account and often unavailable over ssh) and store the NAS login:'
    Write-Host '           cmdkey /add:MissionControl /user:<nas user> /pass'
    Write-Host '         (with /pass and no value, cmdkey prompts for the password.)'
    Write-Host "         Confirm with: cmdkey /list    and    dir `"$VideosDir`""
    Write-Host '         The account also needs read and write on that folder on the NAS.'
    Write-Host "      4. nssm restart $ServiceName"
    Write-Host '      5. Verify the service itself can see the folder:'
    Write-Host "           (Invoke-WebRequest -UseBasicParsing $HubUrl/api/video/health).Content"
    Write-Host '         and read "reachable": true.'
    Write-Host '    Changing the account also changes which profile the service runs under.'
    Write-Host '    Other file access (C:\Services\FrameServer, the photos) keeps working only'
    Write-Host '    if that user can read and write there; a local administrator can.'
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $Check -and -not $isAdmin) {
    throw 'Run this elevated. (Over ssh the micro account already is.)'
}
# The WinGet link, the same nssm.exe that runs SmartDisplayFrameServer.
$script:Nssm = (Get-Command nssm -ErrorAction Stop).Source
$serviceExists = [bool](Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)
if (-not $serviceExists -and -not $Check) {
    throw "Service $ServiceName is not installed here. Nothing to configure."
}
# Windows PowerShell 5.1 defaults to old TLS versions; both download hosts need 1.2.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# Invoke-WebRequest's progress bar makes large downloads many times slower on 5.1.
$ProgressPreference = 'SilentlyContinue'
Write-Host "nssm at $script:Nssm, service $ServiceName, collection $VideosDir$(if ($Check) { '  [CHECK ONLY]' })"

# ---------------------------------------------------------------------------
# -Check: report and stop
# ---------------------------------------------------------------------------
if ($Check) {
    Write-Step 'Check: binaries'
    $v = Get-FirstLine $YtDlp @('--version')
    Write-Host ('    yt-dlp   {0}' -f $(if ($v) { "$v  ($YtDlp)" } else { "MISSING or not runnable ($YtDlp)" }))
    $v = Get-FirstLine $Ffmpeg @('-version')
    Write-Host ('    ffmpeg   {0}' -f $(if ($v) { $v } else { "MISSING or not runnable ($Ffmpeg)" }))
    $v = Get-FirstLine $Ffprobe @('-version')
    Write-Host ('    ffprobe  {0}' -f $(if ($v) { $v } else { "MISSING or not runnable ($Ffprobe)" }))

    Write-Step "Check: scheduled task $TaskName"
    $problems = @(Get-TaskProblems)
    if ($problems.Count -eq 0) {
        $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
        Write-Host '    present and as intended (weekly, Sunday 04:00, SYSTEM, yt-dlp.exe -U)'
        if ($info) { Write-Host "    last run $($info.LastRunTime), last result $($info.LastTaskResult), next run $($info.NextRunTime)" }
    } else {
        $problems | ForEach-Object { Write-Host "    DIFFERS: $_" }
    }

    Write-Step "Check: $ServiceName environment"
    if ($serviceExists) {
        $existing = @(Get-NssmLines @('AppEnvironmentExtra'))
        foreach ($line in $EnvLines) {
            $key = ($line -split '=', 2)[0]
            $have = @($existing | Where-Object { ($_ -split '=', 2)[0] -ieq $key }) | Select-Object -First 1
            if ($have -ceq $line) { Write-Host "    ok       $line" }
            elseif ($have)        { Write-Host "    DIFFERS  have: $have" ; Write-Host "             want: $line" }
            else                  { Write-Host "    MISSING  $line" }
        }
        $others = @($existing | Where-Object { $k = ($_ -split '=', 2)[0]; -not (@($EnvWanted.Keys) -contains $k) })
        Write-Host "    other entries kept untouched: $($others.Count)"
        Write-Step 'Check: service account'
        Show-AccountInstructions (Get-NssmValue @('ObjectName'))
        Write-Host "    service state: $((Get-Service -Name $ServiceName).Status)"
    } else {
        Write-Host "    Service $ServiceName is not installed here."
    }

    Write-Step 'Check: NAS folder from THIS shell'
    $reach = Test-Path -LiteralPath $VideosDir -ErrorAction SilentlyContinue
    Write-Host "    $VideosDir reachable here: $reach"
    Write-Host '    (This elevated shell is not the service. Only /api/video/health proves the service can see it.)'
    return
}

# ---------------------------------------------------------------------------
# 1. bin\
# ---------------------------------------------------------------------------
Write-Step "1/6  Folder: $BinDir"
if (-not (Test-Path -LiteralPath $BinDir)) {
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    Write-Host '    created'
} else {
    Write-Host '    exists'
}

# ---------------------------------------------------------------------------
# 2. yt-dlp
# ---------------------------------------------------------------------------
Write-Step '2/6  yt-dlp'
if (-not (Test-Path -LiteralPath $YtDlp)) {
    Write-Host "    downloading $YtDlpUrl"
    Save-Download -Url $YtDlpUrl -Dest $YtDlp
} else {
    Write-Host '    present; running yt-dlp.exe -U'
    try {
        $null = Invoke-Native -FilePath $YtDlp -ArgumentList @('-U')
    } catch {
        # An update that cannot reach GitHub should not abort the other steps.
        Write-Warning "yt-dlp -U failed: $($_.Exception.Message)"
    }
}
$ytVersion = Get-FirstLine $YtDlp @('--version')
if (-not $ytVersion) { throw "$YtDlp does not run." }
Write-Host "    yt-dlp $ytVersion"

# ---------------------------------------------------------------------------
# 3. ffmpeg
# ---------------------------------------------------------------------------
Write-Step '3/6  ffmpeg'
if (-not ((Test-Path -LiteralPath $Ffmpeg) -and (Test-Path -LiteralPath $Ffprobe))) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = Join-Path $env:TEMP ('smartdisplay-ffmpeg-{0}.zip' -f [guid]::NewGuid().ToString('N'))
    try {
        Write-Host "    downloading $FfmpegZipUrl"
        Invoke-WebRequest -Uri $FfmpegZipUrl -OutFile $zip -UseBasicParsing
        $archive = [IO.Compression.ZipFile]::OpenRead($zip)
        try {
            foreach ($name in @('ffmpeg.exe', 'ffprobe.exe')) {
                $entry = $archive.Entries | Where-Object { $_.FullName -match ('(^|/)bin/' + [regex]::Escape($name) + '$') } | Select-Object -First 1
                if (-not $entry) { throw "$name not found in the ffmpeg zip." }
                $dest = Join-Path $BinDir $name
                $side = "$dest.new"
                [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $side, $true)
                Move-Item -LiteralPath $side -Destination $dest -Force
                Write-Host "    extracted $name"
            }
        } finally {
            $archive.Dispose()
        }
    } finally {
        Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host '    ffmpeg.exe and ffprobe.exe already present; skipped.'
}
$ffVersion = Get-FirstLine $Ffmpeg @('-version')
if (-not $ffVersion) { throw "$Ffmpeg does not run." }
Write-Host "    $ffVersion"

# ---------------------------------------------------------------------------
# 4. Weekly update task
# ---------------------------------------------------------------------------
Write-Step "4/6  Scheduled task $TaskName (Sunday 04:00, SYSTEM, yt-dlp.exe -U)"
$problems = @(Get-TaskProblems)
if ($problems.Count -eq 0) {
    Write-Host '    already as intended'
} else {
    $problems | ForEach-Object { Write-Host "    fixing: $_" }
    $action    = New-ScheduledTaskAction -Execute $YtDlp -Argument '-U' -WorkingDirectory $BinDir
    $trigger   = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -WeeksInterval 1 -At ([datetime]'04:00')
    $taskUser  = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $null = Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $taskUser `
        -Settings $settings -Force `
        -Description 'Weekly yt-dlp self-update for the Music Videos feature. Created by setup-videos.ps1.'
    $left = @(Get-TaskProblems)
    if ($left.Count -gt 0) { throw ("Task still differs after registering: " + ($left -join '; ')) }
    Write-Host '    registered'
}

# ---------------------------------------------------------------------------
# 5. Service environment
# ---------------------------------------------------------------------------
Write-Step "5/6  $ServiceName environment (AppEnvironmentExtra)"
$existing = @(Get-NssmLines @('AppEnvironmentExtra'))
$ourKeys  = @($EnvWanted.Keys)
$kept     = @($existing | Where-Object { $k = ($_ -split '=', 2)[0].Trim(); -not ($ourKeys -contains $k) })
$wanted   = @($kept) + @($EnvLines)
# Order-insensitive compare, so a hand-reordered but equal list is left alone.
$same = ((@($existing | Sort-Object) -join "`n") -ceq (@($wanted | Sort-Object) -join "`n"))
$envChanged = $false
if ($same) {
    Write-Host '    already set'
} else {
    Write-Host "    keeping $($kept.Count) existing entr$(if ($kept.Count -eq 1) { 'y' } else { 'ies' }) for other keys"
    # nssm replaces the whole list; each entry is a separate argument.
    $null = Invoke-Native -FilePath $script:Nssm -ArgumentList (@('set', $ServiceName, 'AppEnvironmentExtra') + $wanted) -Quiet
    $back = @(Get-NssmLines @('AppEnvironmentExtra'))
    if ((@($back | Sort-Object) -join "`n") -cne (@($wanted | Sort-Object) -join "`n")) {
        throw ("nssm did not store the environment as written. Now: " + ($back -join ' | '))
    }
    $envChanged = $true
    $EnvLines | ForEach-Object { Write-Host "    set $_" }
}

if ($envChanged) {
    Write-Host "    Restarting $ServiceName to pick up the environment (the hub is down for a few seconds)"
    $running = (Get-Service -Name $ServiceName).Status -eq 'Running'
    if ($running) {
        $null = Invoke-Native -FilePath $script:Nssm -ArgumentList @('restart', $ServiceName)
    } else {
        $null = Invoke-Native -FilePath $script:Nssm -ArgumentList @('start', $ServiceName)
    }
    # Best effort: the routes only exist once the hub with the Music Videos
    # code is deployed, so a failure here is information, not an error.
    $health = $null
    for ($i = 0; $i -lt 10 -and -not $health; $i++) {
        Start-Sleep -Seconds 2
        try {
            $health = ConvertFrom-Json -InputObject (Invoke-WebRequest -Uri "$HubUrl/api/video/health" -UseBasicParsing -TimeoutSec 5).Content
        } catch {
            $health = $null
        }
    }
    if ($health) {
        Write-Host ('    health: configured={0} reachable={1} yt-dlp={2} ffmpeg found={3}' -f $health.configured, $health.reachable, $health.ytdlp.version, $health.ffmpeg.found)
    } else {
        Write-Host '    /api/video/health did not answer (the hub build with the video routes may not be deployed yet).'
    }
} else {
    Write-Host '    No restart needed.'
}

# ---------------------------------------------------------------------------
# 6. Service account (instructions only)
# ---------------------------------------------------------------------------
Write-Step "6/6  Service account (not changed by this script)"
Show-AccountInstructions (Get-NssmValue @('ObjectName'))
Write-Host ''
Write-Host 'Done.'
