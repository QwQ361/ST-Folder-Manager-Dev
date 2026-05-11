$f = 'index.js'
$lines = [System.IO.File]::ReadAllLines($f, [System.Text.Encoding]::UTF8)
$newLines = [System.Collections.Generic.List[string]]::new()
for ($i = 0; $i -lt $lines.Length; $i++) {
  # Skip lines36882, 36883, 36884 (1-based), i.e. 0-based 36881, 36882, 36883
  if ($i -eq 36881 -or $i -eq 36882 -or $i -eq 36883) { continue }
  $newLines.Add($lines[$i])
}
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllLines($f, $newLines, $utf8NoBom)
Write-Host 'Done - removed3 lines (36882-36884)'
