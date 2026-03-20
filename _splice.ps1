# Replace lines 22405-22900 in index.js with content from _temp_regex_view.js
$raw = [System.IO.File]::ReadAllText('index.js')
$eol = if ($raw.Contains("`r`n")) { "`r`n" } else { "`n" }
$lines = $raw -split "`r?`n"
Write-Host "Total lines in index.js: $($lines.Length)"
Write-Host "Line 22405 (0-idx 22404): $($lines[22404].Substring(0, [Math]::Min(60, $lines[22404].Length)))"
Write-Host "Line 22900 (0-idx 22899): $($lines[22899].Substring(0, [Math]::Min(60, $lines[22899].Length)))"
Write-Host "Line 22901 (0-idx 22900): $($lines[22900].Substring(0, [Math]::Min(60, $lines[22900].Length)))"

$newFunc = [System.IO.File]::ReadAllText('_temp_regex_view.js')
$newFuncLines = ($newFunc.TrimEnd()) -split "`r?`n"
Write-Host "New function lines: $($newFuncLines.Length)"

$before = $lines[0..22403]
$after = $lines[22900..($lines.Length-1)]
Write-Host "Before lines: $($before.Length), After lines: $($after.Length)"

$allLines = $before + $newFuncLines + $after
Write-Host "Result total lines: $($allLines.Length)"

$result = $allLines -join $eol
[System.IO.File]::WriteAllText('index.js', $result, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Done! index.js updated."
