import { execFile } from 'child_process';
import { appConfig } from '../config/app.config';

export interface CheckResult {
    ok: boolean;
    detail: string;
}

export interface Readiness {
    ready: boolean;
    checks: { ruff: CheckResult; ollama: CheckResult };
}

function checkRuff(): Promise<CheckResult> {
    return new Promise((resolve) => {
        execFile(appConfig.ruffBin, ['--version'], { timeout: appConfig.readinessTimeoutMs }, (error, stdout) => {
            if (error) {
                resolve({ ok: false, detail: 'Ruff is not available' });
                return;
            }
            resolve({ ok: true, detail: String(stdout).trim() });
        });
    });
}

// Ollama reports a model without a tag as "name:latest".
const sameModel = (installed: string, wanted: string): boolean =>
    installed === wanted || installed === `${wanted}:latest`;

async function checkOllama(): Promise<CheckResult> {
    if (!appConfig.llmEnabled) return { ok: true, detail: 'not used (LLM_ENABLED is false)' };

    try {
        const response = await fetch(`${appConfig.ollamaBaseUrl}/api/tags`, {
            signal: AbortSignal.timeout(appConfig.readinessTimeoutMs)
        });
        if (!response.ok) return { ok: false, detail: `Ollama answered with status ${response.status}` };

        const body = (await response.json()) as { models?: { name?: unknown }[] };
        const installed = (body.models ?? []).map((model) => String(model.name));

        return installed.some((name) => sameModel(name, appConfig.llmModel))
            ? { ok: true, detail: `model ${appConfig.llmModel} is installed` }
            : { ok: false, detail: `model ${appConfig.llmModel} is not installed (run: ollama pull ${appConfig.llmModel})` };
    } catch {
        return { ok: false, detail: 'Ollama is unreachable' };
    }
}

// Unlike /health, which only says the process is up, this checks what a review needs.
// Neither check can throw, so the endpoint always has an answer.
export async function checkReadiness(): Promise<Readiness> {
    const [ruff, ollama] = await Promise.all([checkRuff(), checkOllama()]);
    return { ready: ruff.ok && ollama.ok, checks: { ruff, ollama } };
}