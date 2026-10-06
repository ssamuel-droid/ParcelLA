param(
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\public\assets\parcella-tour-voice.wav')
)

Add-Type -AssemblyName System.Speech

$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice.Rate = 2
$voice.Volume = 100

try {
  $voice.SelectVoiceByHints(
    [System.Speech.Synthesis.VoiceGender]::Female,
    [System.Speech.Synthesis.VoiceAge]::Adult
  )
} catch {
  # Keep the system default voice when no matching local voice is installed.
}

$script = @'
ParcelLA turns any address into an underwritten development opportunity. Compare by-right zoning, density bonus, E D 1, and state housing options. Screen listings and city filings. Set rents, costs, financing, land basis, and unit sizes once, then re-underwrite every deal instantly. Verify ownership, sales, debt, plans, and determinations. Export the same analysis to Excel and PDF. Stop browsing. Start underwriting.
'@

$resolved = [System.IO.Path]::GetFullPath($OutputPath)
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($resolved)) | Out-Null
$voice.SetOutputToWaveFile($resolved)
$voice.Speak($script.Trim())
$voice.Dispose()

Write-Output "Created $resolved"
