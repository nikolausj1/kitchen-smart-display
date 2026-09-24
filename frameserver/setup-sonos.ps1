<#
.SYNOPSIS
    Install or refresh node-sonos-http-api on the NUC as the nssm service
    SmartDisplaySonosAPI, listening on 127.0.0.1:5005 for FrameServer to proxy.

.DESCRIPTION
    Work package A of docs/designs/sonos-and-state-to-the-hub.md (rollout step 1
    in docs/designs/echo-show-and-hub.md). Idempotent: each step looks at the
    current state and changes only what differs, so re-running this script is
    also how to repair or upgrade the install.

    Run it elevated on the NUC. From the Mac, at the repo root:
        scp -i ~/.ssh/sportsbox_nuc_ed25519 frameserver/setup-sonos.ps1 micro@nuc.local:C:/Services/setup-sonos.ps1
        ssh -i ~/.ssh/sportsbox_nuc_ed25519 micro@nuc.local "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Services\setup-sonos.ps1"

    Steps:
      1. Clone jishi/node-sonos-http-api into C:\Services\SonosHTTPAPI (or fetch)
         and check out the pinned commit $Ref.
      2. npm ci --omit=dev when node_modules is missing or the commit changed.
         Upstream ships a package-lock.json, and ci leaves the git tree clean.
      3. Write settings.json: port 5005, HTTP listener bound to 127.0.0.1.
      4. Inbound firewall rules for node.exe from the local subnet.
      5. Install or correct the nssm service definition.
      6. Start it (restart only when code or service settings changed), wait up
         to 60 s for discovery, print the rooms, and check the listener bind.

    Never touched: the SmartDisplayFrameServer service, C:\Services\FrameServer,
    and the firewall profiles themselves.

    Facts read from the source at the pinned commit (2026-09-24). This script
    depends on them, so re-check them whenever $Ref is bumped:
      - settings.json keys used here: "port" and "ip". server.js calls
        server.listen(settings.port, settings.ip); the defaults are 5005 and
        0.0.0.0. The same object goes to sonos-discovery, which reads only
        "household" from it, so "ip" does not affect discovery or events.
        settings.js parses the file with JSON5 and silently falls back to the
        defaults (0.0.0.0) if parsing fails. Hence strict ASCII JSON with no
        BOM below, and the bind check at the end.
      - Discovery (sonos-discovery/lib/sonos-ssdp.js): one udp4 socket bound to
        port 1905 (its bind address cycles every 5 s between 0.0.0.0 and each
        non-internal IPv4), sending M-SEARCH to 239.255.255.250:1900 and to
        255.255.255.255:1900. Players answer unicast to port 1905. Nothing in
        node.exe listens on UDP 1900, so the inbound SSDP rule is UDP 1905.
        SSDP runs only until the first player answers.
      - Events (sonos-discovery/lib/NotificationListener.js): an HTTP server on
        TCP 3500, all interfaces, trying 3501, 3502 and so on if the port is
        taken. Players NOTIFY http://<local IP that reached them>:3500/ with
        every topology and playback change. This is what keeps /zones current,
        so it is the rule that matters most.
      - SonosSystem.restart() (run when the topology subscription fails for
        about 25 s, e.g. the first-found player went offline) opens a new
        listener without closing the old one, so the event port creeps up by
        one per internal restart until the process restarts. Hence 3500-3509.
      - say, sayall, clip and the other announcement actions hand players a URL
        on this API's own port. With the loopback bind they cannot work. No
        house app uses them.
      - Logging is stdout with ISO timestamps, level from NODE_LOG_LEVEL
        (default info). Per-request logging is errors only.
      - A running process never picks up a Sonos room rename: Player.roomName
        is set once and players are cached by UUID. After renaming a room in
        the Sonos app, run: nssm restart SmartDisplaySonosAPI

    Rollback:
        nssm stop SmartDisplaySonosAPI
        nssm remove SmartDisplaySonosAPI confirm
        Get-NetFirewallRule -Group 'Smart Display Sonos' | Remove-NetFirewallRule
        (optional) Remove-Item -Recurse -Force C:\Services\SonosHTTPAPI

.PARAMETER Ref
    Upstream commit to run. Bump deliberately, re-check the facts above, re-run.

.PARAMETER NoWait
    Skip the post-start discovery wait and bind check.
#>
[CmdletBinding()]
param(
    [string]$Ref = '3776f0ee2261c924c7b7204de121a38100a08ca7',
    [switch]$NoWait
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
$ServiceName  = 'SmartDisplaySonosAPI'
$DisplayName  = 'Smart Display Sonos HTTP API'
$Description  = 'node-sonos-http-api for the house displays; FrameServer proxies it at /api/sonos'
$RepoUrl      = 'https://github.com/jishi/node-sonos-http-api.git'
$InstallDir   = 'C:\Services\SonosHTTPAPI'
$LogDir       = Join-Path $InstallDir 'logs'
$LogFile      = Join-Path $LogDir 'service.log'
$Node         = 'C:\Program Files\nodejs\node.exe'
$Npm          = 'C:\Program Files\nodejs\npm.cmd'
$Git          = 'C:\Program Files\Git\cmd\git.exe'
$ListenIp     = '127.0.0.1'   # FrameServer is the only client; nothing on the LAN needs it
$ListenPort   = 5005
$SsdpPort     = 1905          # sonos-ssdp.js: socket.bind(1905, ...)
$EventPorts   = '3500-3509'   # NotificationListener: 3500, +1 per internal restart
$RotateBytes  = 10MB
$FwGroup      = 'Smart Display Sonos'
$FwSsdpName   = "SmartDisplay Sonos SSDP (UDP $SsdpPort)"
$FwEventsName = "SmartDisplay Sonos UPnP events (TCP $EventPorts)"
$DiscoveryWaitSeconds = 60

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
    # which 'Stop' would treat as fatal (git and npm write progress and warnings
    # there), so the preference is relaxed for the call and the exit code decides.
    # NULs are stripped because nssm can emit UTF-16 when its output is piped.
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

function Get-NssmValue([string[]]$Keys) {
    # 'nssm get' for one setting, '' when unset. Never throws.
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $script:Nssm get $ServiceName @Keys 2>$null
    } finally {
        $ErrorActionPreference = $saved
    }
    return ((@($out) | ForEach-Object { "$_" -replace "`0", '' }) -join "`n").Trim()
}

function Resolve-Commit([string]$Rev) {
    # Full SHA for a revision in the clone, or $null if it is not there (yet).
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $Git -C $InstallDir rev-parse --verify --quiet "$Rev^{commit}" 2>$null
        $ok = ($LASTEXITCODE -eq 0)
    } finally {
        $ErrorActionPreference = $saved
    }
    if ($ok) { return ("$out").Trim() }
    return $null
}

function Stop-SonosService {
    # Only ever this service. FrameServer is not ours to stop.
    $s = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($s -and $s.Status -ne 'Stopped') {
        Write-Host "    Stopping $ServiceName"
        $null = Invoke-Native -FilePath $script:Nssm -ArgumentList @('stop', $ServiceName)
    }
}

function Get-ServiceNodeProcessId {
    # nssm.exe is the service process; node.exe is its child.
    $svcInfo = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
    if (-not $svcInfo -or -not $svcInfo.ProcessId) { return $null }
    $child = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($svcInfo.ProcessId) AND Name='node.exe'" |
        Select-Object -First 1
    if ($child) { return [int]$child.ProcessId }
    return $null
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this elevated. (Over ssh the micro account already is.)'
}
if ($ServiceName -eq 'SmartDisplayFrameServer') { throw 'Refusing to manage FrameServer from this script.' }
foreach ($tool in @($Node, $Npm, $Git)) {
    if (-not (Test-Path $tool)) { throw "Missing $tool" }
}
# The WinGet link, the same nssm.exe that SmartDisplayFrameServer's service runs.
$script:Nssm = (Get-Command nssm -ErrorAction Stop).Source
Write-Host "node $(& $Node --version), nssm at $script:Nssm, service $ServiceName"

$codeChanged = $false
$settingsChanged = $false
$serviceChanged = $false

# ---------------------------------------------------------------------------
# 1. Code
# ---------------------------------------------------------------------------
Write-Step "1/6  Code: $RepoUrl at $Ref"
if (-not (Test-Path (Join-Path $InstallDir '.git'))) {
    if (Test-Path $InstallDir) { throw "$InstallDir exists but is not a git clone. Move it aside and re-run." }
    # git is required so the installed commit is known. (Without git, the
    # equivalent is GitHub's archive zip of $Ref expanded into $InstallDir.)
    $null = Invoke-Native -FilePath $Git -ArgumentList @('clone', '--quiet', $RepoUrl, $InstallDir)
    $codeChanged = $true
}
$want = Resolve-Commit $Ref
if (-not $want) {
    $null = Invoke-Native -FilePath $Git -ArgumentList @('-C', $InstallDir, 'fetch', '--quiet', 'origin')
    $want = Resolve-Commit $Ref
    if (-not $want) { throw "Commit $Ref is not in $RepoUrl" }
}
if ((Resolve-Commit 'HEAD') -ne $want) {
    Stop-SonosService   # do not swap code under a running process
    $null = Invoke-Native -FilePath $Git -ArgumentList @('-C', $InstallDir, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', $want)
    $codeChanged = $true
}
Write-Host "    HEAD $want"
# Keep 'git status' clean: settings.json, cache/ and static/tts are already in
# upstream's .gitignore; the log folder is ours.
$exclude = Join-Path $InstallDir '.git\info\exclude'
New-Item -ItemType Directory -Force -Path (Split-Path $exclude) | Out-Null
if (-not ((Test-Path $exclude) -and (Select-String -Path $exclude -Pattern '^logs/$' -Quiet))) {
    Add-Content -Path $exclude -Value 'logs/' -Encoding Ascii
}

# ---------------------------------------------------------------------------
# 2. Dependencies
# ---------------------------------------------------------------------------
Write-Step '2/6  Dependencies: npm ci --omit=dev'
$marker = Join-Path $InstallDir 'node_modules\sonos-discovery\package.json'
if ($codeChanged -or -not (Test-Path $marker)) {
    Stop-SonosService
    # Upstream declares engines "node >=4 <23"; npm warns EBADENGINE on Node 24
    # but installs. Runtime on Node 24 was verified on 2026-09-24.
    Push-Location $InstallDir
    try {
        $null = Invoke-Native -FilePath $Npm -ArgumentList @('ci', '--omit=dev', '--no-audit', '--no-fund')
    } finally {
        Pop-Location
    }
    $codeChanged = $true
} else {
    Write-Host '    node_modules already installed for this commit; skipped.'
}

# ---------------------------------------------------------------------------
# 3. settings.json
# ---------------------------------------------------------------------------
Write-Step "3/6  settings.json: port $ListenPort, ip $ListenIp"
$settingsPath = Join-Path $InstallDir 'settings.json'
$settingsText = @"
{
  "port": $ListenPort,
  "ip": "$ListenIp"
}
"@
$current = $null
if (Test-Path $settingsPath) { $current = [IO.File]::ReadAllText($settingsPath) }
if ($current -ne $settingsText) {
    # ASCII, no BOM (see the note on JSON5 parsing above).
    [IO.File]::WriteAllText($settingsPath, $settingsText, (New-Object System.Text.ASCIIEncoding))
    $settingsChanged = $true
    Write-Host "    written: $settingsPath"
} else {
    Write-Host '    unchanged'
}

# ---------------------------------------------------------------------------
# 4. Firewall
# ---------------------------------------------------------------------------
Write-Step '4/6  Firewall: inbound allow for node.exe from the local subnet (Private, Domain)'
# Remove-then-create keeps this idempotent and clears rules left by an earlier
# version of this script under other names or ports. No rule for TCP 5005:
# the API is loopback-only.
Get-NetFirewallRule -Group $FwGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
foreach ($name in @($FwSsdpName, $FwEventsName)) {
    Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
}
$rule = @{
    Direction     = 'Inbound'
    Action        = 'Allow'
    Program       = $Node
    Profile       = 'Domain, Private'
    RemoteAddress = 'LocalSubnet'
    Group         = $FwGroup
    Enabled       = 'True'
}
$null = New-NetFirewallRule @rule -DisplayName $FwSsdpName -Protocol UDP -LocalPort $SsdpPort `
    -Description 'Sonos players answer node-sonos-http-api M-SEARCH (sent to 239.255.255.250:1900) unicast to UDP 1905. Created by setup-sonos.ps1.'
$null = New-NetFirewallRule @rule -DisplayName $FwEventsName -Protocol TCP -LocalPort $EventPorts `
    -Description 'UPnP event NOTIFY callbacks from Sonos players to node-sonos-http-api (3500, +1 per internal rediscovery). Created by setup-sonos.ps1.'
Get-NetFirewallRule -Group $FwGroup | ForEach-Object { Write-Host "    $($_.DisplayName)  [$($_.Profile)]" }
foreach ($fwProfile in @(Get-NetFirewallProfile -Name Domain, Private)) {
    if ("$($fwProfile.Enabled)" -ne 'True') {
        Write-Host "    Note: the $($fwProfile.Name) firewall profile is off, so these rules are not enforced there today. They are in place for when it is turned on."
    }
}

# ---------------------------------------------------------------------------
# 5. nssm service
# ---------------------------------------------------------------------------
Write-Step "5/6  nssm service $ServiceName"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
    $null = Invoke-Native -FilePath $script:Nssm -ArgumentList @('install', $ServiceName, $Node, 'server.js')
    $serviceChanged = $true
}
# nssm reads the App* values when the service starts, so changing one needs a
# restart. DisplayName, Description and Start do not.
$desired = [ordered]@{
    Application     = $Node
    AppParameters   = 'server.js'          # relative to AppDirectory
    AppDirectory    = $InstallDir
    DisplayName     = $DisplayName
    Description     = $Description
    Start           = 'SERVICE_AUTO_START'
    AppStdout       = $LogFile
    AppStderr       = $LogFile
    AppRotateFiles  = '1'
    # Rotation happens when the service starts. Do NOT set AppRotateOnline 1:
    # with nssm 2.24-101 on this NUC it left the service hung in STOP_PENDING
    # after node had exited (2026-09-24). FrameServer runs with 0 too. The log
    # is quiet (errors only), so rotate-at-start is enough.
    AppRotateOnline = '0'
    AppRotateBytes  = [string]$RotateBytes # 10 MB
}
foreach ($key in $desired.Keys) {
    if ((Get-NssmValue @($key)) -ne $desired[$key]) {
        $null = Invoke-Native -FilePath $script:Nssm -ArgumentList @('set', $ServiceName, $key, $desired[$key]) -Quiet
        Write-Host ('    set {0} = {1}' -f $key, $desired[$key])
        if ($key -like 'App*') { $serviceChanged = $true }
    }
}
# Restart on any exit. That is nssm's default; stated so a hand edit is undone.
if ((Get-NssmValue @('AppExit', 'Default')) -ne 'Restart') {
    $null = Invoke-Native -FilePath $script:Nssm -ArgumentList @('set', $ServiceName, 'AppExit', 'Default', 'Restart') -Quiet
    Write-Host '    set AppExit Default = Restart'
    $serviceChanged = $true
}

# ---------------------------------------------------------------------------
# 6. Start and verify
# ---------------------------------------------------------------------------
Write-Step '6/6  Start and verify'
$status = (Get-Service -Name $ServiceName).Status
if ($status -eq 'Running' -and -not ($codeChanged -or $settingsChanged -or $serviceChanged)) {
    Write-Host '    Already running with this code and configuration; left running.'
} elseif ($status -eq 'Running') {
    Write-Host '    Restarting to pick up changes'
    $null = Invoke-Native -FilePath $script:Nssm -ArgumentList @('restart', $ServiceName)
} else {
    $null = Invoke-Native -FilePath $script:Nssm -ArgumentList @('start', $ServiceName)
}
Write-Host "    nssm status: $((Invoke-Native -FilePath $script:Nssm -ArgumentList @('status', $ServiceName) -Quiet) -join '')"
if ($NoWait) { return }

$started = Get-Date
$deadline = $started.AddSeconds($DiscoveryWaitSeconds)
$zones = @()
$rooms = @()
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    try {
        $body = (Invoke-WebRequest -Uri "http://127.0.0.1:$ListenPort/zones" -UseBasicParsing -TimeoutSec 5).Content
        $parsed = ConvertFrom-Json -InputObject $body
        $zones = @($parsed)
        $rooms = @($zones | ForEach-Object { $_.members } | ForEach-Object { $_.roomName } | Sort-Object)
        if ($rooms.Count -gt 0) { break }
    } catch {
        # not listening yet, or discovery still running
    }
}
if ($rooms.Count -eq 0) {
    Write-Warning "No zones after $DiscoveryWaitSeconds s. Last log lines:"
    if (Test-Path $LogFile) { Get-Content $LogFile -Tail 30 | ForEach-Object { Write-Host "    $_" } }
    exit 1
}
Write-Host ('    Discovery OK after {0:N0} s: {1} zone(s), {2} room(s): {3}' -f ((Get-Date) - $started).TotalSeconds, $zones.Count, $rooms.Count, ($rooms -join ', '))

# The API must listen on loopback only. A settings.json that failed to parse
# would silently fall back to 0.0.0.0.
$nodePid = Get-ServiceNodeProcessId
if (-not $nodePid) { Write-Warning 'Could not find the service node.exe process.'; exit 1 }
$tcp = @(Get-NetTCPConnection -OwningProcess $nodePid -State Listen -ErrorAction SilentlyContinue | Sort-Object LocalPort)
$udp = @(Get-NetUDPEndpoint -OwningProcess $nodePid -ErrorAction SilentlyContinue | Sort-Object LocalPort)
Write-Host "    node.exe pid $nodePid listening on:"
$tcp | ForEach-Object { Write-Host ('      TCP {0}:{1}' -f $_.LocalAddress, $_.LocalPort) }
$udp | ForEach-Object { Write-Host ('      UDP {0}:{1}' -f $_.LocalAddress, $_.LocalPort) }
$api = @($tcp | Where-Object { $_.LocalPort -eq $ListenPort })
if ($api.Count -eq 0 -or @($api | Where-Object { $_.LocalAddress -ne $ListenIp }).Count -gt 0) {
    Write-Warning "The HTTP API is not bound to ${ListenIp}:$ListenPort only. Check the log for a settings.json parse warning."
    exit 1
}
Write-Host "    API bound to ${ListenIp}:$ListenPort only. FrameServer upstream: http://${ListenIp}:$ListenPort"
