# ============================================================================
# dsh-roco-daily / win.ps1
# Windows primitives: find window, read pixels, click, screenshot.
# Uses only .NET built-in types + user32 P/Invoke. No third-party deps.
# Output: one compact JSON line (UTF-8) on stdout.
# NOTE: kept ASCII-only on purpose so Windows PowerShell 5.1 parses it
#       regardless of file encoding / code page.
# ============================================================================
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('window', 'activate', 'cursor', 'probe', 'step', 'shot', 'screen', 'screens', 'petrect')]
  [string]$Action,

  [string]$Title = '',
  [string]$Proc = 'electron',
  [string]$Points = '',
  [int]$Tol = 18,
  [int]$TimeoutMs = 8000,
  [int]$PollMs = 200,
  [int]$X = -1,
  [int]$Y = -1,
  [string]$Out = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

if (-not ('RocoW32' -as [type])) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RocoW32 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);

  // Largest visible top-level window of a process, as "x,y,w,h"; empty when none.
  public static string LargestWindowOf(uint pid) {
    IntPtr best = IntPtr.Zero;
    long bestArea = 0;
    EnumWindows((h, l) => {
      uint p;
      GetWindowThreadProcessId(h, out p);
      if (p != pid) return true;
      if (!IsWindowVisible(h)) return true;
      RECT r;
      if (!GetWindowRect(h, out r)) return true;
      int w = r.Right - r.Left;
      int hh = r.Bottom - r.Top;
      if (w < 60 || hh < 60) return true;
      long area = (long)w * hh;
      if (area > bestArea) { bestArea = area; best = h; }
      return true;
    }, IntPtr.Zero);
    if (best == IntPtr.Zero) return "";
    RECT rr;
    if (!GetWindowRect(best, out rr)) return "";
    return rr.Left + "," + rr.Top + "," + (rr.Right - rr.Left) + "," + (rr.Bottom - rr.Top);
  }
}
"@
}

function Get-TargetWindow([string]$t) {
  $procs = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle })
  if ($t) {
    return ($procs | Where-Object { $_.MainWindowTitle -like "*$t*" } | Select-Object -First 1)
  }
  $fg = [RocoW32]::GetForegroundWindow()
  return ($procs | Where-Object { $_.MainWindowHandle -eq $fg } | Select-Object -First 1)
}

function Get-ClientBox($p) {
  $h = $p.MainWindowHandle
  $r = New-Object RocoW32+RECT
  [void][RocoW32]::GetClientRect($h, [ref]$r)
  $pt = New-Object RocoW32+POINT
  $pt.X = 0
  $pt.Y = 0
  [void][RocoW32]::ClientToScreen($h, [ref]$pt)
  return [pscustomobject]@{ x = $pt.X; y = $pt.Y; w = $r.Right; h = $r.Bottom; hwnd = [int64]$h }
}

function Read-Pixels($box, $pts) {
  $out = New-Object System.Collections.ArrayList
  if (-not $pts -or $pts.Count -eq 0) { return $out }
  $bmp = New-Object System.Drawing.Bitmap($box.w, $box.h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.CopyFromScreen($box.x, $box.y, 0, 0, (New-Object System.Drawing.Size($box.w, $box.h)))
    foreach ($p in $pts) {
      if ($p[0] -lt 0 -or $p[1] -lt 0 -or $p[0] -ge $box.w -or $p[1] -ge $box.h) {
        [void]$out.Add(@(-1, -1, -1))
        continue
      }
      $c = $bmp.GetPixel($p[0], $p[1])
      [void]$out.Add(@([int]$c.R, [int]$c.G, [int]$c.B))
    }
  } finally {
    $g.Dispose()
    $bmp.Dispose()
  }
  return $out
}

function Test-OneAnchor($rgbWant, $got, [int]$tol) {
  if ($null -eq $rgbWant) { return $true }
  if ($null -eq $got) { return $false }
  if ($got[0] -lt 0) { return $false }
  $d0 = [math]::Abs($rgbWant[0] - $got[0])
  $d1 = [math]::Abs($rgbWant[1] - $got[1])
  $d2 = [math]::Abs($rgbWant[2] - $got[2])
  if ($d0 -gt $tol) { return $false }
  if ($d1 -gt $tol) { return $false }
  if ($d2 -gt $tol) { return $false }
  return $true
}

# Parse "x,y,r,g,b;x,y,r,g,b" -> array of @{x;y;rgb}
function Parse-AnchorSpec([string]$s) {
  $list = New-Object System.Collections.ArrayList
  if (-not $s) { return $list }
  foreach ($one in ($s -split ';')) {
    if (-not $one.Trim()) { continue }
    $kv = $one -split ','
    if ($kv.Count -ge 5) {
      [void]$list.Add(@{ x = [int]$kv[0]; y = [int]$kv[1]; rgb = @([int]$kv[2], [int]$kv[3], [int]$kv[4]) })
    } elseif ($kv.Count -ge 2) {
      [void]$list.Add(@{ x = [int]$kv[0]; y = [int]$kv[1]; rgb = $null })
    }
  }
  return $list
}

function Parse-PointSpec([string]$s) {
  $list = New-Object System.Collections.ArrayList
  if (-not $s) { return $list }
  foreach ($one in ($s -split ';')) {
    if (-not $one.Trim()) { continue }
    $kv = $one -split ','
    if ($kv.Count -ge 2) { [void]$list.Add(@([int]$kv[0], [int]$kv[1])) }
  }
  return $list
}

$result = [ordered]@{ ok = $false; action = $Action }

switch ($Action) {

  'screen' {
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $result.ok = $true
    $result.screen = @{ w = $b.Width; h = $b.Height }
  }

  'window' {
    $p = Get-TargetWindow $Title
    if (-not $p) { $result.error = 'window-not-found' }
    else {
      $box = Get-ClientBox $p
      $result.ok = $true
      $result.window = @{ hwnd = $box.hwnd; title = $p.MainWindowTitle; process = $p.ProcessName; x = $box.x; y = $box.y; w = $box.w; h = $box.h }
    }
  }

  'activate' {
    $p = Get-TargetWindow $Title
    if (-not $p) { $result.error = 'window-not-found' }
    else {
      if ([RocoW32]::IsIconic($p.MainWindowHandle)) { [void][RocoW32]::ShowWindow($p.MainWindowHandle, 9) }
      [void][RocoW32]::SetForegroundWindow($p.MainWindowHandle)
      Start-Sleep -Milliseconds 250
      $fg = [RocoW32]::GetForegroundWindow()
      $result.ok = ($fg -eq $p.MainWindowHandle)
      $result.foreground = $result.ok
      if (-not $result.ok) { $result.error = 'cannot-foreground' }
    }
  }

  'screens' {
    $all = @()
    foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
      $all += @{ deviceName = $s.DeviceName; x = $s.Bounds.X; y = $s.Bounds.Y; w = $s.Bounds.Width; h = $s.Bounds.Height; primary = $s.Primary }
    }
    $result.ok = $true
    $result.screens = $all
  }

  'petrect' {
    $best = $null
    foreach ($pr in @(Get-Process -Name $Proc -ErrorAction SilentlyContinue)) {
      $spec = [RocoW32]::LargestWindowOf([uint32]$pr.Id)
      if (-not $spec) { continue }
      $kv = $spec -split ','
      $r = @{ x = [int]$kv[0]; y = [int]$kv[1]; w = [int]$kv[2]; h = [int]$kv[3] }
      if (-not $best -or ($r.w * $r.h) -gt ($best.w * $best.h)) { $best = $r }
    }
    if ($best) { $result.ok = $true; $result.rect = $best }
    else { $result.error = 'pet-window-not-found' }
  }

  'cursor' {
    $pt = New-Object RocoW32+POINT
    [void][RocoW32]::GetCursorPos([ref]$pt)
    $result.ok = $true
    $result.cursor = @{ x = $pt.X; y = $pt.Y }
  }

  'probe' {
    $p = Get-TargetWindow $Title
    if (-not $p) { $result.error = 'window-not-found' }
    else {
      $box = Get-ClientBox $p
      $pts = Parse-PointSpec $Points
      $pix = Read-Pixels $box $pts
      $colors = New-Object System.Collections.ArrayList
      foreach ($c in $pix) { [void]$colors.Add(@($c[0], $c[1], $c[2])) }
      $result.ok = $true
      $result.window = @{ hwnd = $box.hwnd; title = $p.MainWindowTitle; x = $box.x; y = $box.y; w = $box.w; h = $box.h }
      $result.colors = $colors
    }
  }

  'step' {
    $p = Get-TargetWindow $Title
    if (-not $p) { $result.error = 'window-not-found' }
    else {
      if ([RocoW32]::IsIconic($p.MainWindowHandle)) { [void][RocoW32]::ShowWindow($p.MainWindowHandle, 9) }
      [void][RocoW32]::SetForegroundWindow($p.MainWindowHandle)

      $anchors = Parse-AnchorSpec $Points
      $matched = $false
      $sw = [System.Diagnostics.Stopwatch]::StartNew()
      $lastColors = New-Object System.Collections.ArrayList

      while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
        $box = Get-ClientBox $p
        if ($box.w -gt 0 -and $box.h -gt 0 -and $anchors.Count -gt 0) {
          $coords = New-Object System.Collections.ArrayList
          foreach ($a in $anchors) { [void]$coords.Add(@($a.x, $a.y)) }
          $pix = Read-Pixels $box $coords
          $lastColors = New-Object System.Collections.ArrayList
          foreach ($c in $pix) { [void]$lastColors.Add(@($c[0], $c[1], $c[2])) }
          $allOk = $true
          for ($i = 0; $i -lt $anchors.Count; $i++) {
            $good = Test-OneAnchor $anchors[$i].rgb $pix[$i] $Tol
            if (-not $good) { $allOk = $false; break }
          }
          if ($allOk) { $matched = $true; break }
        }
        Start-Sleep -Milliseconds $PollMs
      }

      $result.waitedMs = [int]$sw.ElapsedMilliseconds
      $result.matched = $matched
      $result.colors = $lastColors
      if ($matched) {
        $box = Get-ClientBox $p
        $tx = $X
        $ty = $Y
        if ($tx -lt 0) { $tx = $anchors[0].x }
        if ($ty -lt 0) { $ty = $anchors[0].y }
        [void][RocoW32]::SetCursorPos(($box.x + $tx), ($box.y + $ty))
        Start-Sleep -Milliseconds 60
        [RocoW32]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 40
        [RocoW32]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
        $result.clicked = @{ x = $tx; y = $ty }
      }
      $result.ok = $true
    }
  }

  'shot' {
    $p = Get-TargetWindow $Title
    if (-not $p) { $result.error = 'window-not-found' }
    else {
      $box = Get-ClientBox $p
      $bmp = New-Object System.Drawing.Bitmap($box.w, $box.h)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try { $g.CopyFromScreen($box.x, $box.y, 0, 0, (New-Object System.Drawing.Size($box.w, $box.h))) }
      finally { $g.Dispose() }
      $target = $Out
      if (-not $target) { $target = Join-Path $env:TEMP ('roco-shot-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.png') }
      $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
      $bmp.Dispose()
      $result.ok = $true
      $result.path = $target
      $result.window = @{ x = $box.x; y = $box.y; w = $box.w; h = $box.h }
    }
  }
}

[Console]::Out.Write(($result | ConvertTo-Json -Compress -Depth 6))
