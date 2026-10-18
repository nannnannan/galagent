param([switch]$IncludeTitles, [switch]$IncludeClipboard)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class GalDesktop {
    [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder value, int length, out int needed);
    [DllImport("kernel32.dll")] public static extern ulong GetTickCount64();
    [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern uint RegisterClipboardFormat(string name);
    [DllImport("user32.dll")] public static extern bool IsClipboardFormatAvailable(uint format);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool OpenClipboard(IntPtr owner);
    [DllImport("user32.dll")] public static extern bool CloseClipboard();
    [DllImport("user32.dll")] public static extern IntPtr GetClipboardData(uint format);
    [DllImport("kernel32.dll")] public static extern IntPtr GlobalLock(IntPtr handle);
    [DllImport("kernel32.dll")] public static extern bool GlobalUnlock(IntPtr handle);
    [DllImport("kernel32.dll")] public static extern UIntPtr GlobalSize(IntPtr handle);
    // Password managers mark secrets with these formats; such content is never read.
    public static bool ClipboardExcluded() {
        if (IsClipboardFormatAvailable(RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing"))) return true;
        if (IsClipboardFormatAvailable(RegisterClipboardFormat("Clipboard Viewer Ignore"))) return true;
        uint history = RegisterClipboardFormat("CanIncludeInClipboardHistory");
        if (IsClipboardFormatAvailable(history)) {
            if (!OpenClipboard(IntPtr.Zero)) return true;
            try {
                IntPtr handle = GetClipboardData(history);
                if (handle == IntPtr.Zero) return true;
                IntPtr data = GlobalLock(handle);
                if (data == IntPtr.Zero) return true;
                try { return Marshal.ReadInt32(data) == 0; } finally { GlobalUnlock(handle); }
            } finally { CloseClipboard(); }
        }
        return false;
    }
    public static string ClipboardText(int maxChars) {
        if (!IsClipboardFormatAvailable(13)) return "";
        if (!OpenClipboard(IntPtr.Zero)) return null;
        try {
            IntPtr handle = GetClipboardData(13);
            if (handle == IntPtr.Zero) return "";
            IntPtr data = GlobalLock(handle);
            if (data == IntPtr.Zero) return "";
            try {
                long chars = (long)GlobalSize(handle).ToUInt64() / 2;
                int length = (int)Math.Min(chars, (long)maxChars);
                string text = Marshal.PtrToStringUni(data, length);
                int end = text.IndexOf('\0');
                return end >= 0 ? text.Substring(0, end) : text;
            } finally { GlobalUnlock(handle); }
        } finally { CloseClipboard(); }
    }
}
'@
    $lastTick = [GalDesktop]::GetTickCount64()
    $lastClipboard = $null
    while ($true) {
        $tick = [GalDesktop]::GetTickCount64()
        $gap = $tick - $lastTick
        $lastTick = $tick
        $sample = @{available=$false; observedAt=[DateTime]::UtcNow.ToString('o'); suspended=($gap -gt 10000)}
        # Only the active input desktop proves an unlocked session. Failure is unknown,
        # not evidence that the user is unlocked. No window metadata on unknown/locked.
        $desktop = [GalDesktop]::OpenInputDesktop(0, $false, 1)
        if ($desktop -eq [IntPtr]::Zero) {
            $sample.error = 'session-unavailable'
        } else {
            try {
                $desktopName = New-Object System.Text.StringBuilder 128
                $needed = 0
                $readName = [GalDesktop]::GetUserObjectInformation($desktop, 2, $desktopName, 256, [ref]$needed)
                if (-not $readName) { $sample.error = 'session-unknown' }
                elseif ($desktopName.ToString() -ne 'Default') { $sample.locked=$true; $sample.error='session-locked' }
                elseif ($sample.suspended) { $sample.locked=$false; $sample.error='resume-gap' }
                else {
                    $sample.locked=$false
                    $window = [GalDesktop]::GetForegroundWindow()
                    $info = New-Object GalDesktop+LASTINPUTINFO
                    $info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($info)
                    if ($window -eq [IntPtr]::Zero -or -not [GalDesktop]::GetLastInputInfo([ref]$info)) {
                        $sample.error='foreground-unavailable'
                    } else {
                        $foregroundProcessId = [uint32]0
                        [void][GalDesktop]::GetWindowThreadProcessId($window, [ref]$foregroundProcessId)
                        try {
                            $foregroundProcess = [Diagnostics.Process]::GetProcessById($foregroundProcessId)
                            try { $sample.appName = $foregroundProcess.ProcessName } finally { $foregroundProcess.Dispose() }
                            # LASTINPUTINFO is a wrapping 32-bit timestamp. This is elapsed
                            # input idleness only; no input events or contents are inspected.
                            $sample.idleSeconds = [Math]::Floor((($tick % 4294967296 - [uint64]$info.dwTime + 4294967296) % 4294967296) / 1000)
                            $rect = New-Object GalDesktop+RECT
                            $monitor = New-Object GalDesktop+MONITORINFO
                            $monitor.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($monitor)
                            $monitorHandle = [GalDesktop]::MonitorFromWindow($window, 2)
                            if ([GalDesktop]::GetWindowRect($window, [ref]$rect) -and [GalDesktop]::GetMonitorInfo($monitorHandle, [ref]$monitor)) {
                                $sample.fullscreen = ($rect.Left -le $monitor.rcMonitor.Left -and $rect.Top -le $monitor.rcMonitor.Top -and $rect.Right -ge $monitor.rcMonitor.Right -and $rect.Bottom -ge $monitor.rcMonitor.Bottom)
                            }
                            if ($IncludeTitles) {
                                $title = New-Object System.Text.StringBuilder 257
                                [void][GalDesktop]::GetWindowText($window, $title, 257)
                                $sample.title = ($title.ToString() -replace '[\x00-\x1f\x7f]', ' ')
                            }
                            $sample.available = $true
                        } catch { $sample.error='process-unavailable' }
                    }
                }
            } finally { [void][GalDesktop]::CloseDesktop($desktop) }
        }
        [Console]::WriteLine(($sample | ConvertTo-Json -Compress))
        # Clipboard only while the session is unlocked and the user opted in. Keystrokes are never read.
        if ($IncludeClipboard -and $sample.locked -eq $false -and -not $sample.suspended) {
            $sequence = [GalDesktop]::GetClipboardSequenceNumber()
            if ($sequence -ne $lastClipboard) {
                $previous = $lastClipboard
                $baseline = ($null -eq $previous)
                $lastClipboard = $sequence
                try {
                    $excluded = [GalDesktop]::ClipboardExcluded()
                    $clip = @{excluded=$excluded; baseline=$baseline}
                    $ready = $true
                    if (-not $excluded) {
                        $text = [GalDesktop]::ClipboardText(2000)
                        # Clipboard busy: retry on the next loop.
                        if ($null -eq $text) { $lastClipboard = $previous; $ready = $false } else { $clip.text = ($text -replace '\x00', '') }
                    }
                    if ($ready) { [Console]::WriteLine((@{clipboard=$clip} | ConvertTo-Json -Compress)) }
                } catch { $lastClipboard = $previous }
            }
        }
        Start-Sleep -Milliseconds 2000
    }
} catch {
    [Console]::WriteLine((@{available=$false; observedAt=[DateTime]::UtcNow.ToString('o'); error='helper-failed'} | ConvertTo-Json -Compress))
    exit 1
}
