param(
  [string]$TasksPath = "specs/001-convertitodo/tasks.md"
)

$ErrorActionPreference = 'Stop'
$remote = (git config --get remote.origin.url).Trim()
if ($remote -notmatch '^https://github\.com/([^/]+)/([^/.]+)(?:\.git)?$') {
  throw "El remoto no es una URL de GitHub válida: $remote"
}
$repo = "$($Matches[1])/$($Matches[2])"
if ($repo -ne 'Tiago-Davila/All-Converter') {
  throw "El repositorio remoto no coincide con el destino autorizado: $repo"
}

$labels = @(
  @{ name='fase:setup'; color='1D76DB'; description='Preparación del proyecto' },
  @{ name='fase:nucleo'; color='5319E7'; description='Infraestructura fundacional' },
  @{ name='fase:ui'; color='0E8A16'; description='Interfaz base' },
  @{ name='fase:workers'; color='FBCA04'; description='Workers y ejecución asíncrona' },
  @{ name='fase:imagenes'; color='C5DEF5'; description='Conversores de imágenes' },
  @{ name='fase:planillas'; color='BFDADC'; description='Conversores de planillas' },
  @{ name='fase:pdf'; color='D93F0B'; description='Conversores PDF' },
  @{ name='fase:docx'; color='006B75'; description='Conversores DOCX' },
  @{ name='fase:batch'; color='E99695'; description='Lotes y carpetas' },
  @{ name='fase:media'; color='B60205'; description='Audio y vídeo' },
  @{ name='fase:pulido'; color='7057FF'; description='Pulido y validación transversal' },
  @{ name='frontend'; color='0E8A16'; description='UI React/Tailwind' },
  @{ name='backend'; color='5319E7'; description='Reservado: no hay backend en esta SPA' },
  @{ name='converters'; color='C2E0C6'; description='Lógica de conversión local' },
  @{ name='workers'; color='FBCA04'; description='Web Workers y transferibles' },
  @{ name='testing'; color='BFD4F2'; description='Vitest, fixtures o validación' },
  @{ name='infrastructure'; color='D4C5F9'; description='Build, Vercel, dependencias o PWA' }
)
foreach ($label in $labels) {
  gh label create $label.name --repo $repo --color $label.color --description $label.description --force | Out-Null
}

$existing = @{}
gh issue list --repo $repo --state all --limit 1000 --json number,title | ConvertFrom-Json | ForEach-Object {
  if ($_.title -match '\b(T\d{3})\b') { $existing[$Matches[1]] = $_.number }
}

$phase = ''
$created = @()
$skipped = @()
Get-Content $TasksPath | ForEach-Object {
  if ($_ -match '^## Phase \d+:\s*(.+)$') { $phase = $Matches[1]; return }
  if ($_ -notmatch '^\- \[ \] (T\d{3})(?: \[P\])?(?: \[US\d\])? (.+)$') { return }
  $id = $Matches[1]; $description = $Matches[2]
  if ($existing.ContainsKey($id)) { $skipped += "$id (#$($existing[$id]))"; return }

  $phaseLabel = switch -Regex ($phase) {
    'Setup' {'fase:setup'}; 'Núcleo' {'fase:nucleo'}; 'UI base' {'fase:ui'}; 'workers' {'fase:workers'};
    'imágenes' {'fase:imagenes'}; 'planillas' {'fase:planillas'}; 'PDF' {'fase:pdf'}; 'DOCX' {'fase:docx'};
    'Batch' {'fase:batch'}; 'Audio/video' {'fase:media'}; 'Pulido' {'fase:pulido'}; default {'infrastructure'}
  }
  $issueLabels = @($phaseLabel)
  if ($description -match 'src/components|src/App|src/index.css') { $issueLabels += 'frontend' }
  if ($description -match 'converters/') { $issueLabels += 'converters' }
  if ($description -match 'workers/') { $issueLabels += 'workers' }
  if ($description -match 'tests/|fixture|validación') { $issueLabels += 'testing' }
  if ($description -match 'package.json|vite|vercel|fonts|PWA|ffmpeg|SheetJS') { $issueLabels += 'infrastructure' }
  $body = "## Tarea Spec Kit`n`n$description`n`n## Trazabilidad`n- Fuente: `specs/001-convertitodo/tasks.md``n- Fase: $phase`n- Regla: una tarea, un diff y un commit.`n`n## Criterios`n- Respetar la constitution y la especificación.`n- Incluir tests/fixtures cuando la tarea los indica.`n- No enviar archivos del usuario fuera del navegador."
  $labelList = (($issueLabels | Select-Object -Unique) -join ',')
  $number = gh issue create --repo $repo --title "${id}: $description" --body $body --label $labelList
  $created += "$id $number"
}
"Created: $($created -join ', ')"
"Skipped: $($skipped -join ', ')"
