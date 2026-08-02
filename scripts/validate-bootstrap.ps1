$ErrorActionPreference = "Stop"

$errors = [System.Collections.Generic.List[string]]::new()

function Add-ValidationError {
    param([Parameter(Mandatory)][string]$Message)
    $errors.Add($Message)
}

$requiredFiles = @(
    ".editorconfig",
    ".gitattributes",
    ".gitignore",
    ".github/CODEOWNERS",
    ".github/pull_request_template.md",
    ".github/workflows/ci.yml",
    "CONTRIBUTING.md",
    "README.md",
    "docs/release-and-rollback.md",
    "docs/repository-settings.md",
    "scripts/validate-bootstrap.ps1"
)

foreach ($path in $requiredFiles) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Add-ValidationError "Required file is missing: $path"
    }
}

$trackedFiles = @(git ls-files)
if ($LASTEXITCODE -ne 0) {
    Add-ValidationError "Unable to inspect tracked files with git ls-files."
}

$prohibitedExtensions = @(".pdf", ".stl")
foreach ($path in $trackedFiles) {
    if ($prohibitedExtensions -contains [IO.Path]::GetExtension($path).ToLowerInvariant()) {
        Add-ValidationError "Reference asset must not be tracked: $path"
    }
}

if (Test-Path -LiteralPath ".gitignore") {
    $ignore = Get-Content -LiteralPath ".gitignore" -Raw
    foreach ($pattern in @("*.pdf", "*.stl", ".env", "node_modules/", ".wrangler/")) {
        if ($ignore -notmatch [regex]::Escape($pattern)) {
            Add-ValidationError ".gitignore does not cover $pattern"
        }
    }
}

if (Test-Path -LiteralPath ".github/workflows/ci.yml") {
    $workflow = Get-Content -LiteralPath ".github/workflows/ci.yml" -Raw
    $workflowMarkers = @(
        "name: CI",
        "push:",
        "pull_request:",
        "required-ci:",
        "name: Required CI",
        "npm run build",
        "npm run lint",
        "npm run test:unit",
        "npm run test:e2e:smoke"
    )
    foreach ($marker in $workflowMarkers) {
        if (-not $workflow.Contains($marker)) {
            Add-ValidationError "CI workflow marker is missing: $marker"
        }
    }
    if ($workflow.Contains("`t")) {
        Add-ValidationError "CI workflow contains a tab; YAML indentation must use spaces."
    }
}

if (Test-Path -LiteralPath ".github/pull_request_template.md") {
    $template = Get-Content -LiteralPath ".github/pull_request_template.md" -Raw
    foreach ($heading in @("## Jira", "## Summary", "## Verification", "## Risks", "## Release and rollback")) {
        if (-not $template.Contains($heading)) {
            Add-ValidationError "Pull request template section is missing: $heading"
        }
    }
}

if (Test-Path -LiteralPath "CONTRIBUTING.md") {
    $contributing = Get-Content -LiteralPath "CONTRIBUTING.md" -Raw
    foreach ($marker in @("codex/KAN-XX-short-description", "Required CI", "review the final diff", "pull request")) {
        if (-not $contributing.Contains($marker)) {
            Add-ValidationError "CONTRIBUTING marker is missing: $marker"
        }
    }
}

if (Test-Path -LiteralPath "package.json") {
    try {
        $package = Get-Content -LiteralPath "package.json" -Raw | ConvertFrom-Json
        foreach ($script in @("build", "lint", "test:unit", "test:e2e:smoke")) {
            if (-not $package.scripts.PSObject.Properties.Name.Contains($script)) {
                Add-ValidationError "Application mode requires package script: $script"
            }
        }
    }
    catch {
        Add-ValidationError "package.json is not valid JSON: $($_.Exception.Message)"
    }
    Write-Output "Repository governance validated in application mode."
}
else {
    Write-Output "Repository governance validated in bootstrap mode."
}

if ($errors.Count -gt 0) {
    foreach ($validationError in $errors) {
        Write-Error $validationError
    }
    exit 1
}

Write-Output "Bootstrap validation passed."
