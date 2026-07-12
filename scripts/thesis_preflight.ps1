[CmdletBinding()]
param(
    [switch]$SkipModelEvidence
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
$Failures = New-Object System.Collections.Generic.List[string]

function Write-Pass([string]$Message) {
    Write-Host "PASS $Message" -ForegroundColor Green
}

function Write-Fail([string]$Message) {
    Write-Host "FAIL $Message" -ForegroundColor Red
    $Failures.Add($Message)
}

function Test-Endpoint(
    [string]$Name,
    [string]$Url,
    [int[]]$ExpectedStatus = @(200)
) {
    try {
        $Response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 15 -MaximumRedirection 0 -ErrorAction Stop
        if ($ExpectedStatus -contains [int]$Response.StatusCode) {
            Write-Pass "$Name responded with HTTP $($Response.StatusCode)"
        } else {
            Write-Fail "$Name returned unexpected HTTP $($Response.StatusCode)"
        }
    } catch {
        $Status = $_.Exception.Response.StatusCode.value__
        if ($Status -and ($ExpectedStatus -contains [int]$Status)) {
            Write-Pass "$Name responded with HTTP $Status"
        } else {
            Write-Fail "$Name is unavailable: $($_.Exception.Message)"
        }
    }
}

function Invoke-MlPython(
    [Parameter(Mandatory = $true)][string]$Code,
    [string]$FailureMessage = "ML container Python command failed"
) {
    # Windows PowerShell 5.1 can strip nested quotes from native-command
    # arguments. Base64 keeps the Python source as one quote-free argument.
    $EncodedCode = [Convert]::ToBase64String(
        [Text.Encoding]::UTF8.GetBytes($Code)
    )
    $Output = & docker compose exec -T ml-service python -c 'import base64,sys;exec(base64.b64decode(sys.argv[1]))' $EncodedCode
    if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
    return $Output
}

Write-Host "FAIV Predict thesis preflight" -ForegroundColor Cyan
Write-Host "Repository: $Root"

try {
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) { throw "docker info failed" }
    Write-Pass "Docker engine is available"
} catch {
    Write-Fail "Docker Desktop is not ready"
}

try {
    & docker compose config --quiet
    if ($LASTEXITCODE -ne 0) { throw "docker compose config failed" }
    Write-Pass "Compose configuration is valid"
} catch {
    Write-Fail "Compose configuration is invalid or .env is incomplete"
}

foreach ($Service in @("frontend", "ml-service", "n8n")) {
    try {
        $ContainerId = (& docker compose ps -q $Service).Trim()
        if (-not $ContainerId) { throw "container does not exist" }
        $State = (& docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $ContainerId).Trim()
        $Parts = $State.Split("|")
        if ($Parts[0] -eq "running" -and $Parts[1] -eq "healthy") {
            Write-Pass "$Service container is running and healthy"
        } else {
            throw "state is $State"
        }
    } catch {
        Write-Fail "$Service is not healthy: $($_.Exception.Message)"
    }
}

Test-Endpoint "Frontend" "http://127.0.0.1:3000/" @(200, 302, 307, 308)
Test-Endpoint "ML service" "http://127.0.0.1:8000/healthz"
Test-Endpoint "n8n database readiness" "http://127.0.0.1:5678/healthz/readiness"

try {
    $SecurityOutput = & docker compose exec -T n8n node -e "console.log(JSON.stringify({blocked:process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE,hasToken:Boolean(process.env.INTERNAL_API_TOKEN),hasMlUrl:Boolean(process.env.FAIV_ML_URL)}))"
    if ($LASTEXITCODE -ne 0) { throw "n8n security command failed" }
    $Security = ($SecurityOutput | Select-Object -Last 1) | ConvertFrom-Json
    if ($Security.blocked -eq "true" -and -not $Security.hasToken -and -not $Security.hasMlUrl) {
        Write-Pass "n8n blocks environment access and receives no application token/ML URL"
    } else {
        throw "blocked=$($Security.blocked), hasToken=$($Security.hasToken), hasMlUrl=$($Security.hasMlUrl)"
    }
} catch {
    Write-Fail "n8n security contract failed: $($_.Exception.Message)"
}

try {
    $SchemaCode = @'
import os
import psycopg2

connection = psycopg2.connect(os.environ["DATABASE_URL"])
try:
    cursor = connection.cursor()
    cursor.execute(
        """SELECT
             EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=%s AND table_name=%s AND column_name=%s),
             to_regclass(%s) IS NOT NULL,
             EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=%s AND table_name=%s AND column_name=%s),
             EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=%s AND table_name=%s AND column_name=%s),
             to_regprocedure(%s) IS NOT NULL,
             to_regprocedure(%s) IS NOT NULL,
             to_regprocedure(%s) IS NOT NULL""",
        (
            "public", "posts", "media_product_type",
            "public.prediction_publications",
            "public", "predictions", "actual_er",
            "public", "brands", "instagram_account_id",
            "public.link_prediction_publication(uuid,uuid)",
            "public.reconcile_prediction_publication_outcomes(uuid)",
            "public.validate_prediction_observed_outcome()",
        ),
    )
    print("|".join(str(value).lower() for value in cursor.fetchone()))
finally:
    connection.close()
'@
    $SchemaOutput = Invoke-MlPython -Code $SchemaCode -FailureMessage "database schema command failed"
    $SchemaFlags = ([string]($SchemaOutput | Select-Object -Last 1)).Trim().ToLowerInvariant().Split("|")
    if ($SchemaFlags.Count -ne 7 -or $SchemaFlags[0] -ne "true") {
        throw "posts.media_product_type is missing; apply migration 202607120003 before rebuilding/retraining"
    }
    if (
        $SchemaFlags[1] -ne "true" -or
        $SchemaFlags[2] -ne "true" -or
        $SchemaFlags[3] -ne "true" -or
        $SchemaFlags[4] -ne "true" -or
        $SchemaFlags[5] -ne "true" -or
        $SchemaFlags[6] -ne "true"
    ) {
        throw "prediction publication cohesion schema is missing; apply migration 202607120004"
    }
    Write-Pass "Meta media-product and Content Plan/publication-cohesion migrations are applied"
} catch {
    Write-Fail "Database migration contract failed: $($_.Exception.Message)"
}

if (-not $SkipModelEvidence) {
    try {
        $TrainingHashCode = @'
from app.train_pipeline import training_code_sha256
print(training_code_sha256())
'@
        $TrainingHashOutput = Invoke-MlPython -Code $TrainingHashCode -FailureMessage "current training-code fingerprint command failed"
        $CurrentTrainingCodeHash = ([string]($TrainingHashOutput | Select-Object -Last 1)).Trim().ToLowerInvariant()
        if ($CurrentTrainingCodeHash -notmatch '^[0-9a-f]{64}$') {
            throw "current training-code fingerprint is invalid"
        }
        $EvidenceOutput = & docker compose exec -T ml-service python -m app.thesis_evidence --format json
        if ($LASTEXITCODE -ne 0) { throw "model evidence exporter failed" }
        $EvidenceJson = $EvidenceOutput -join [Environment]::NewLine
        # Windows PowerShell 5.1 can preserve a top-level JSON array as one
        # nested System.Object[]. Enumerate it explicitly so each loop item is
        # one model object on both Windows PowerShell 5.1 and PowerShell 7.
        $ParsedEvidence = ConvertFrom-Json -InputObject $EvidenceJson
        $Models = @()
        foreach ($ParsedModel in $ParsedEvidence) {
            $Models += $ParsedModel
        }
        if ($Models.Count -eq 0) { throw "no trained models found" }
        foreach ($Model in $Models) {
            $Metrics = $Model.metrics
            $Scope = if ($Model.brand_name) { $Model.brand_name } elseif ($Model.niche) { $Model.niche } else { $Model.brand_id }
            if ($Metrics.evaluation_contract -ne "faiv-thesis-v2") {
                throw "model $Scope was trained before faiv-thesis-v2; execute sync/retrain again"
            }
            $RecordedTrainingCodeHash = ([string]$Metrics.training_code_sha256).Trim().ToLowerInvariant()
            if ($RecordedTrainingCodeHash -notmatch '^[0-9a-f]{64}$') {
                throw "model $Scope has no valid training-code fingerprint; execute sync/retrain again"
            }
            if ($RecordedTrainingCodeHash -ne $CurrentTrainingCodeHash) {
                throw "model $Scope was trained with different training/preprocessing source (model $($RecordedTrainingCodeHash.Substring(0, 12)), current $($CurrentTrainingCodeHash.Substring(0, 12))); execute sync/retrain again"
            }
            if (
                -not $Metrics.dataset.dataset_sha256 -or
                -not $Metrics.candidate.confusion_matrix -or
                $null -eq $Metrics.candidate.balanced_accuracy -or
                $null -eq $Metrics.candidate.ordinal_mae -or
                -not $Metrics.comparators.logistic_regression -or
                -not $Metrics.temporal_evaluation.summary -or
                -not $Metrics.scientific_gate
            ) {
                throw "model $Scope is missing v2 statistical or comparison evidence"
            }
            if ($Metrics.promotion_gate.passed -ne $true -or $Metrics.accuracy_gain_over_baseline -le 0) {
                throw "model $Scope did not pass the majority-baseline promotion gate"
            }
            foreach ($ClassName in @("LOW", "AVERAGE", "HIGH")) {
                $ClassProperty = $Metrics.train_class_distribution.PSObject.Properties[$ClassName]
                $ClassCount = 0
                if (
                    $null -eq $ClassProperty -or
                    -not [int]::TryParse([string]$ClassProperty.Value, [ref]$ClassCount) -or
                    $ClassCount -le 0
                ) {
                    throw "model $Scope training split is missing class $ClassName"
                }
            }
            if (-not $Metrics.runtime.requirements_sha256 -or -not $Metrics.runtime.scikit_learn) {
                throw "model $Scope is missing runtime/dependency evidence"
            }
            if (@($Metrics.promotion_gate.warnings).Count -gt 0) {
                Write-Host "WARN model ${Scope}: $($Metrics.promotion_gate.warnings -join ', ')" -ForegroundColor Yellow
            }
            if ($Metrics.evaluation_status -notin @("validated", "exploratory")) {
                throw "model $Scope has no valid scientific evaluation status"
            }
            if ($Metrics.evaluation_status -eq "exploratory") {
                $Reasons = @($Metrics.scientific_gate.failure_reasons) -join ", "
                Write-Host "WARN model ${Scope} is scientifically exploratory: $Reasons" -ForegroundColor Yellow
            }
            Write-Pass "model evidence is complete for $Scope (version $($Model.version), status $($Metrics.evaluation_status))"
        }
    } catch {
        Write-Fail "Final model evidence is incomplete: $($_.Exception.Message)"
    }
} else {
    Write-Host "WARN model evidence check skipped by operator" -ForegroundColor Yellow
}

if (Test-Path ".env") {
    try {
        & git check-ignore --quiet .env
        if ($LASTEXITCODE -eq 0) {
            Write-Pass ".env exists and is ignored by Git"
        } else {
            Write-Fail ".env exists but is not ignored by Git"
        }
    } catch {
        Write-Fail "Could not verify .env Git ignore state"
    }
} else {
    Write-Fail "Repository-root .env is missing"
}

Write-Host ""
if ($Failures.Count -gt 0) {
    Write-Host "$($Failures.Count) preflight check(s) failed." -ForegroundColor Red
    exit 1
}

Write-Host "All automated thesis-machine preflight checks passed." -ForegroundColor Green
Write-Host "Complete and record the manual A01-A12 scenarios in docs/THESIS_TEST_REPORT.md."
exit 0
