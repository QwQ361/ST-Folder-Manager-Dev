# Fix indentation for renderRegexView function (lines 22405-22964)
$raw = [System.IO.File]::ReadAllText('index.js')

# Detect line ending
if ($raw.Contains("`r`n")) {
    $eol = "`r`n"
} else {
    $eol = "`n"
}

$lines = $raw.Split($eol)
Write-Host "Total lines: $($lines.Length)"
Write-Host "Before fix - Line 22405: '$($lines[22404].Substring(0, [Math]::Min(50, $lines[22404].Length)))'"

# Add 2-space indent to lines 22405-22964 (0-indexed: 22404-22963)
for ($i = 22404; $i -le 22963; $i++) {
    if ($null -ne $lines[$i] -and $lines[$i].Length -gt 0) {
        $lines[$i] = '  ' + $lines[$i]
    }
}

Write-Host "After fix - Line 22405: '$($lines[22404].Substring(0, [Math]::Min(50, $lines[22404].Length)))'"

$result = [String]::Join($eol, $lines)
[System.IO.File]::WriteAllText('index.js', $result, (New-Object System.Text.UTF8Encoding $false))
Write-Host 'Done! Indentation fixed.'
