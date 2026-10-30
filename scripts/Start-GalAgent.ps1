[CmdletBinding()]
param(
    [string]$PackageDirectory,
    [string]$InstallRoot,
    [string]$ProfileDirectory,
    [switch]$PrepareOnly
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

$mutex = $null
$locked = $false
$staging = $null
try {
    if (!$PackageDirectory) { $PackageDirectory = Join-Path $PSScriptRoot '..\release\v0.2.0\win-unpacked' }
    if (!$InstallRoot) { $InstallRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'GalAgent\app' }
    if ($ProfileDirectory) {
        $ProfileDirectory = Get-FullDirectory (Resolve-Path -LiteralPath $ProfileDirectory).Path
        if (!(Test-Path -LiteralPath $ProfileDirectory -PathType Container)) { throw 'Selected profile directory was not found.' }
        Assert-NoReparseAncestors $ProfileDirectory
    }
    $source = Get-FullDirectory (Resolve-Path -LiteralPath $PackageDirectory).Path
    $root = Get-FullDirectory $InstallRoot
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

    $exeHash = Get-Sha256 $sourceExe
    $asarHash = Get-Sha256 $sourceAsar
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $buildId = 'build-' + ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($exeHash + $asarHash))).Replace('-', '').Substring(0, 24).ToLowerInvariant())
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
        if ((Get-Sha256 (Join-Path $staging 'GalAgent.exe')) -ne $exeHash -or
            (Get-Sha256 (Join-Path $staging 'resources\app.asar')) -ne $asarHash) {
            throw 'The copied runtime failed its integrity check.'
        }
        @{ version = 1; buildId = $buildId; exeSha256 = $exeHash; asarSha256 = $asarHash; preparedAt = [DateTime]::UtcNow.ToString('o') } |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $staging '.galagent-install.json') -Encoding UTF8
        Assert-InstallChild $staging $root
        Assert-InstallChild $target $root
        Move-Item -LiteralPath $staging -Destination $target
        $staging = $null
    }
    Assert-NoReparseAncestors $target
    $installedExe = Join-Path $target 'GalAgent.exe'
    if ((Get-Sha256 $installedExe) -ne $exeHash -or
        (Get-Sha256 (Join-Path $target 'resources\app.asar')) -ne $asarHash) {
        throw 'The installed runtime has changed. The original package was not modified.'
    }
    $mutex.ReleaseMutex()
    $locked = $false
    $result = [ordered]@{ ok = $true; executablePath = $installedExe; installDirectory = $target; buildId = $buildId; reused = [bool]$reused; started = $false }
    if ($ProfileDirectory) { $result.profileDirectory = $ProfileDirectory }
    if (!$PrepareOnly) {
        # Visible application requested by the user; keep Electron's sandbox enabled.
        $previousProfile = $env:GALAGENT_DATA_DIR
        try {
            if ($ProfileDirectory) { $env:GALAGENT_DATA_DIR = $ProfileDirectory }
            $application = Start-Process -FilePath $installedExe -WorkingDirectory $target -WindowStyle Normal -PassThru
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
    [pscustomobject]$result | ConvertTo-Json -Compress
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
