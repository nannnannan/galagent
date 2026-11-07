[CmdletBinding()]
param(
    [string]$PackageDirectory,
    [string]$InstallRoot,
    [string]$ProfileDirectory,
    [switch]$PrepareOnly,
    [ValidateRange(1, 10)][int]$KeepVersions = 2
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Get-Sha256([string]$File) {
    $stream = [IO.File]::OpenRead($File)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-', '') }
    finally { $hasher.Dispose(); $stream.Dispose() }
}

function Get-FullDirectory([string]$Value) {
    return [IO.Path]::GetFullPath($Value).TrimEnd('\', '/')
}
function Test-Within([string]$Candidate, [string]$Root) {
    return $Candidate.Equals($Root, [StringComparison]::OrdinalIgnoreCase) -or
        $Candidate.StartsWith($Root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}
function Assert-InstallChild([string]$Candidate, [string]$Root) {
    if (!(Test-Within $Candidate $Root) -or $Candidate.Equals($Root, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Installation target escaped its dedicated directory.'
    }
}
function Assert-NoReparseAncestors([string]$Directory) {
    $current = $Directory
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Installation through a symbolic link or junction is not supported.'
            }
        }
        $parent = [IO.Directory]::GetParent($current)
        if (!$parent) { break }
        $current = $parent.FullName
    }
}

function Get-PackageFiles([string]$Directory) {
    $paths = [string[]]@(Get-ChildItem -LiteralPath $Directory -File -Recurse -Force |
        Where-Object { $_.FullName -ne (Join-Path $Directory '.galagent-install.json') } |
        ForEach-Object { $_.FullName.Substring($Directory.Length + 1) })
    [Array]::Sort($paths, [StringComparer]::Ordinal)
    foreach ($relative in $paths) {
        [pscustomobject]@{ path = $relative; sha256 = Get-Sha256 (Join-Path $Directory $relative) }
    }
}
function Get-Fingerprint($Files) {
    $text = ($Files | ForEach-Object { $_.path + '|' + $_.sha256 }) -join "`n"
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)))).Replace('-', '') }
    finally { $hash.Dispose() }
}
function Assert-PackageFiles([string]$Directory, $Files) {
    Assert-NoReparseAncestors $Directory
    if (@(Get-ChildItem -LiteralPath $Directory -Recurse -Force -Attributes ReparsePoint).Count) { throw 'The runtime contains a symbolic link or junction.' }
    foreach ($file in $Files) {
        $full = [IO.Path]::GetFullPath((Join-Path $Directory $file.path))
        Assert-InstallChild $full $Directory
        if (!(Test-Path -LiteralPath $full -PathType Leaf) -or (Get-Sha256 $full) -ne $file.sha256) {
            throw ('Runtime file differs from package: ' + $file.path)
        }
    }
}
function Remove-OldVersions([string]$Root, [string]$Current, [int]$Keep) {
    $removed = @()
    $skipped = @()
    try {
        $processes = @(Get-CimInstance Win32_Process -Filter "Name='GalAgent.exe'" -ErrorAction Stop)
        if (@($processes | Where-Object { !$_.ExecutablePath }).Count) { throw 'Process paths unavailable' }
    } catch { return @{ removed = @(); skipped = @('Process inventory unavailable; cleanup skipped') } }
    $candidates = @()
    foreach ($dir in @(Get-ChildItem -LiteralPath $Root -Directory -Force)) {
        if ($dir.Name -notmatch '^build-[a-f0-9]{24}$' -or $dir.FullName -eq $Current) { continue }
        try {
            Assert-InstallChild $dir.FullName $Root
            Assert-NoReparseAncestors $dir.FullName
            if (@(Get-ChildItem -LiteralPath $dir.FullName -Recurse -Force -Attributes ReparsePoint).Count) { throw 'linked content' }
            $manifest = Get-Content -LiteralPath (Join-Path $dir.FullName '.galagent-install.json') -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($manifest.buildId -ne $dir.Name -or $manifest.version -notin @(1, 2)) { throw 'unrecognized manifest' }
            if (Test-Path -LiteralPath (Join-Path $dir.FullName '.galagent-keep')) { throw 'pinned for rollback' }
            if ($manifest.version -eq 1) {
                $identityHash = [Security.Cryptography.SHA256]::Create()
                try { $identity = ([BitConverter]::ToString($identityHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($manifest.exeSha256 + $manifest.asarSha256)))).Replace('-', '') }
                finally { $identityHash.Dispose() }
            } else { $identity = [string]$manifest.packageSha256 }
            if ($identity -notmatch '^[a-fA-F0-9]{64}$' -or ('build-' + $identity.Substring(0, 24).ToLowerInvariant()) -ne $dir.Name) { throw 'unrecognized build identity' }
            if ((Get-Sha256 (Join-Path $dir.FullName 'GalAgent.exe')) -ne $manifest.exeSha256 -or
                (Get-Sha256 (Join-Path $dir.FullName 'resources\app.asar')) -ne $manifest.asarSha256) { throw 'changed runtime' }
            if (@($processes | Where-Object { Test-Within $_.ExecutablePath $dir.FullName }).Count) { throw 'running version' }
            $used = [DateTime]::Parse($manifest.preparedAt).ToUniversalTime()
            if ($manifest.PSObject.Properties['lastUsedAt']) { $used = [DateTime]::Parse($manifest.lastUsedAt).ToUniversalTime() }
            $candidates += [pscustomobject]@{ path = $dir.FullName; used = $used }
        } catch { $skipped += $dir.Name + ': ' + $_.Exception.Message }
    }
    foreach ($entry in @($candidates | Sort-Object used -Descending | Select-Object -Skip ($Keep - 1))) {
        try {
            $live = @(Get-CimInstance Win32_Process -Filter "Name='GalAgent.exe'" -ErrorAction Stop)
            if (@($live | Where-Object { !$_.ExecutablePath -or (Test-Within $_.ExecutablePath $entry.path) }).Count) { throw 'running version' }
            Assert-InstallChild $entry.path $Root
            Assert-NoReparseAncestors $entry.path
            Remove-Item -LiteralPath $entry.path -Recurse -Force -ErrorAction Stop
            $removed += [IO.Path]::GetFileName($entry.path)
        } catch { $skipped += [IO.Path]::GetFileName($entry.path) + ': ' + $_.Exception.Message }
    }
    return @{ removed = $removed; skipped = $skipped }
}

$mutex = $null
$locked = $false
$staging = $null
try {
    $defaultPackage = !$PackageDirectory
    $explicitProfile = [bool]$ProfileDirectory
    $selectionFile = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'GalAgent-profile.json'
    if (!$PrepareOnly -and !$ProfileDirectory -and !$env:GALAGENT_DATA_DIR -and (Test-Path -LiteralPath $selectionFile)) {
        $selection = Get-Content -LiteralPath $selectionFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($selection.version -ne 1 -or ![IO.Path]::IsPathRooted($selection.directory)) { throw 'Invalid current profile selection.' }
        $ProfileDirectory = $selection.directory
    }
    if (!$PackageDirectory) { $PackageDirectory = Join-Path $PSScriptRoot '..\release\win-unpacked' }
    if (!$InstallRoot) { $InstallRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'GalAgent\app' }
    if ($ProfileDirectory) {
        $ProfileDirectory = Get-FullDirectory (Resolve-Path -LiteralPath $ProfileDirectory).Path
        if (!(Test-Path -LiteralPath $ProfileDirectory -PathType Container)) { throw 'Selected profile directory was not found.' }
        Assert-NoReparseAncestors $ProfileDirectory
    }
    if ($defaultPackage -and !$PrepareOnly) {
        $installed = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
            Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -match '^GalAgent(?: |$)' -and $_.PSObject.Properties['DisplayIcon'] } |
            Select-Object -First 1
        if ($installed) {
            $exe = ([string]$installed.DisplayIcon -replace ',\d+$', '').Trim('"')
            if (!(Test-Path -LiteralPath $exe -PathType Leaf) -or [IO.Path]::GetFileName($exe) -ne 'GalAgent.exe') { throw 'The installed GalAgent entry is missing.' }
            Assert-NoReparseAncestors $exe
            $launch = @{ FilePath = $exe; WorkingDirectory = (Split-Path -Parent $exe); WindowStyle = 'Normal'; PassThru = $true }
            if ($ProfileDirectory) {
                if (Test-Within $ProfileDirectory (Split-Path -Parent $exe)) { throw 'The profile must be outside the program directory.' }
                $launch.ArgumentList = @('--profile-directory="' + $ProfileDirectory + '"')
                if ($explicitProfile) { $launch.ArgumentList += '--remember-profile' }
            }
            $application = Start-Process @launch
            [pscustomobject]@{ ok = $true; installed = $true; executablePath = $exe; processId = $application.Id; profileDirectory = $ProfileDirectory } | ConvertTo-Json -Compress
            return
        }
    }
    $source = Get-FullDirectory (Resolve-Path -LiteralPath $PackageDirectory).Path
    $root = Get-FullDirectory $InstallRoot
    if ($ProfileDirectory -and (Test-Within $ProfileDirectory $root)) { throw 'The profile must be outside the managed runtime directory.' }
    if ((Test-Within $root $source) -or (Test-Within $source $root)) {
        throw 'Package and installation directories must be separate.'
    }
    Assert-NoReparseAncestors $root
    $sourceExe = Join-Path $source 'GalAgent.exe'
    $sourceAsar = Join-Path $source 'resources\app.asar'
    if (!(Test-Path -LiteralPath $sourceExe -PathType Leaf) -or !(Test-Path -LiteralPath $sourceAsar -PathType Leaf)) {
        throw 'GalAgent.exe or resources/app.asar is missing. Build the package first.'
    }
    if ((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'The package directory must not be a symbolic link or junction.'
    }
    $links = @(Get-ChildItem -LiteralPath $source -Recurse -Force -Attributes ReparsePoint)
    if ($links.Count) { throw 'The package contains external links; installation was stopped.' }

    $files = @(Get-PackageFiles $source)
    $fingerprint = Get-Fingerprint $files
    $exeHash = Get-Sha256 $sourceExe
    $asarHash = Get-Sha256 $sourceAsar
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $buildId = 'build-' + $fingerprint.Substring(0, 24).ToLowerInvariant()
        $lockId = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant())))).Replace('-', '').Substring(0, 24)
    } finally { $sha.Dispose() }
    $target = Get-FullDirectory (Join-Path $root $buildId)
    Assert-InstallChild $target $root
    $mutex = New-Object Threading.Mutex($false, ('Local\GalAgent-Install-' + $lockId))
    try { $locked = $mutex.WaitOne(60000) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (!$locked) { throw 'Another GalAgent installation is still running. Try again shortly.' }

    $manifestPath = Join-Path $target '.galagent-install.json'
    $reused = Test-Path -LiteralPath $manifestPath -PathType Leaf
    if (!$reused) {
        if (Test-Path -LiteralPath $target) { throw 'An incomplete installation already occupies this version directory.' }
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        Assert-NoReparseAncestors $root
        $staging = Get-FullDirectory (Join-Path $root ($buildId + '.staging-' + [Guid]::NewGuid().ToString('N')))
        Assert-InstallChild $staging $root
        New-Item -ItemType Directory -Path $staging | Out-Null
        # Copy content only; the runtime inherits the normal application directory permissions.
        Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $staging -Recurse
        Assert-PackageFiles $staging $files
        @{ version = 2; buildId = $buildId; packageSha256 = $fingerprint; exeSha256 = $exeHash; asarSha256 = $asarHash; preparedAt = [DateTime]::UtcNow.ToString('o') } |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $staging '.galagent-install.json') -Encoding UTF8
        Assert-InstallChild $staging $root
        Assert-InstallChild $target $root
        Move-Item -LiteralPath $staging -Destination $target
        $staging = $null
    }
    Assert-NoReparseAncestors $target
    $installedExe = Join-Path $target 'GalAgent.exe'
    Assert-PackageFiles $target $files
    $installedManifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($installedManifest.buildId -ne $buildId -or $installedManifest.version -ne 2 -or $installedManifest.packageSha256 -ne $fingerprint) {
        throw 'The runtime manifest does not match the package.'
    }
    $installedManifest | Add-Member -NotePropertyName lastUsedAt -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
    $installedManifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    $result = [ordered]@{ ok = $true; executablePath = $installedExe; installDirectory = $target; buildId = $buildId; reused = [bool]$reused; started = $false }
    if ($ProfileDirectory) { $result.profileDirectory = $ProfileDirectory }
    if (!$PrepareOnly) {
        # Visible application requested by the user; keep Electron's sandbox enabled.
        $previousProfile = $env:GALAGENT_DATA_DIR
        try {
            if ($ProfileDirectory) { $env:GALAGENT_DATA_DIR = $ProfileDirectory }
            $launch = @{ FilePath = $installedExe; WorkingDirectory = $target; WindowStyle = 'Normal'; PassThru = $true }
            if ($ProfileDirectory) {
                $launch.ArgumentList = @('--profile-directory="' + $ProfileDirectory + '"')
                if ($explicitProfile) { $launch.ArgumentList += '--remember-profile' }
            }
            $application = Start-Process @launch
        } finally {
            if ($null -eq $previousProfile) { Remove-Item Env:GALAGENT_DATA_DIR -ErrorAction SilentlyContinue }
            else { $env:GALAGENT_DATA_DIR = $previousProfile }
        }
        if ($application.WaitForExit(1500) -and $application.ExitCode -ne 0) {
            throw ('GalAgent exited during startup (code ' + $application.ExitCode + ').')
        }
        $result.started = $true
        $result.processId = $application.Id
    }
    $cleanup = Remove-OldVersions $root $target $KeepVersions
    $result.keepVersions = $KeepVersions
    $result.removedVersions = @($cleanup.removed)
    $result.skippedCleanup = @($cleanup.skipped)
    [pscustomobject]$result | ConvertTo-Json -Depth 5 -Compress
} catch {
    if (!$PrepareOnly) {
        try {
            Add-Type -AssemblyName PresentationFramework
            [System.Windows.MessageBox]::Show($_.Exception.Message, 'GalAgent startup failed') | Out-Null
        } catch { }
    }
    Write-Error $_.Exception.Message -ErrorAction Continue
    exit 1
} finally {
    if ($locked -and $mutex) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
    if ($staging -and (Test-Path -LiteralPath $staging)) {
        Assert-InstallChild $staging $root
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
}
