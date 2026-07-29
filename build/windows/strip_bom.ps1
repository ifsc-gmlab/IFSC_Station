$targets = @(
    "d:\gml\IFSC-Station\qgroundcontrol\src\QGCApplication.cc",
    "d:\gml\IFSC-Station\qgroundcontrol\src\Settings\AppSettings.cc"
)
foreach ($p in $targets) {
    if (-not (Test-Path $p)) { continue }
    $b = [System.IO.File]::ReadAllBytes($p)
    # Strip ALL leading BOMs (EF BB BF) one by one
    $i = 0
    while ($i + 2 -lt $b.Length -and $b[$i] -eq 0xEF -and $b[$i+1] -eq 0xBB -and $b[$i+2] -eq 0xBF) {
        $i += 3
    }
    if ($i -eq 0) {
        Write-Host "$p : no BOM, skipped"
        continue
    }
    $new = $b[$i..($b.Length-1)]
    [System.IO.File]::WriteAllBytes($p, $new)
    $head = [BitConverter]::ToString($new, 0, [Math]::Min(8, $new.Length))
    Write-Host "$p : stripped $i bytes of BOM, new head=$head, new size=$($new.Length)"
}
