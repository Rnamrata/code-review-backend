import { spawn } from "child_process";
import { appConfig } from "../../config/app.config";
import { SUPPORTED_LANGUAGES } from "../../constants/fileTypes";
import { Finding, Severity } from "../../models/finding";
import { Analyzer, ReviewRequest } from "../../models/review.model";

interface RuffDiagnostic {
    code: string | null;
    message: string;
    location: { row: number, column: number };
    fix: { message?: string } | null;
}

// E4/E7/E9: imports, statements, syntax (skips E501 line-length noise).
// F: pyflakes, B: bugbear, S: bandit security, C90: complexity.
const SELECT = ['E4', 'E7', 'E9', 'F', 'B', 'S', 'C90'];
// S101 is "assert used": noise outside test files.
const IGNORE = ['S101'];

// Stop reading if Ruff's output is absurdly large.
const MAX_OUTPUT_BYTE = 5 * 1024 * 1024;

// Codes that point at a likely bug rather than upkeep.
const BUG_PREFIXES = ['B', 'E9', 'F5', 'F63', 'F7', 'F82'];

const isSyntaxError = (d: RuffDiagnostic): boolean =>
    d.code === null || d.code === 'invalid-syntax';

function toCategory(d: RuffDiagnostic): string {
    if (isSyntaxError(d)) return 'bug';
    const code = d.code as string;
    if (code.startsWith('S')) return 'security';
    if(BUG_PREFIXES.some((prefix) =>  code.startsWith(prefix))) return 'bug';
    return 'maintainability';
}

function toSeverity(d: RuffDiagnostic, category: string): Severity {
    // Ruff reports every diagnostic as "error", so severity comes from the rule.
    if (isSyntaxError(d) || category === 'security') return 'high';
    if (category === 'bug') return 'medium';
    return 'low';
}

function toFinding(d: RuffDiagnostic, request: ReviewRequest): Finding {
    const category = toCategory(d);
    const rule = isSyntaxError(d) ? '' : ` (${d.code})`;

    return {
       file: request.filename,
       line: d.location.row,
       message: `${d.message}${rule}`,
       severity: toSeverity(d, category),
       category,
       source: 'ruff',
       suggestion: d.fix?.message  ?? undefined
    };
}

function runRuff(request: ReviewRequest): Promise<RuffDiagnostic[]> {
    return new Promise ((resolve, reject) => {
        const args = [
            'check',
            '--isolated',            // ignore any ruff.toml / pyproject.toml on this machine
            '--no-cache',
            '--ignore-noqa',         // submitted code must not be able to hide findings
            '--output-format', 'json',
            '--select', SELECT.join(','),
            '--ignore', IGNORE.join(','),
            // "=" form: a name starting with "-" would otherwise be read as a flag
            `--stdin-filename=${request.safeFilename}`,
            '-'  
        ];

        // The submitted code is only ever written to stdin, never executed or saved.
        const child = spawn(appConfig.ruffBin, args,  {
            timeout: appConfig.ruffTimeoutMs,
            stdio: ['pipe','pipe', 'pipe']
        });

        let stdout = '';
        let stderr= '';
        let bytes = 0;

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            bytes += Buffer.byteLength(chunk);
            if (bytes> MAX_OUTPUT_BYTE) {
                child.kill();
                reject(new Error('Ruff output exceeded the size limit'));
                return;
            }
            stdout += chunk;
        });
        child.stderr.on('data', (chunk: string) => { stderr += chunk; });

        child.on('error', (err: NodeJS.ErrnoException) => {
            reject (
                err.code === 'ENOENT'
                ? new Error(`Ruff not founs at "${appConfig.ruffBin}" (set RUFF_BIN)`)
                : err
            );
        });

        child.on('close', (code, signal) => {
            if (signal) {
                reject(new Error(`Ruff was stoped (${signal}), likely a timeout`));
                return;
            }
            // 0 = clean, 1 = findings. Anything else (2+) means Ruff itself failed.
            if (code !== 0 && code !== 1) {
                reject(new Error(`Ruff failed (exit ${code}): ${stderr.trim().slice(0, 200)}`));
                return;
            }
            // Real Ruff always prints JSON when it exits 1. Empty output means
            // something other than a normal Ruff run, not "no findings".
            if (code === 1 && stdout.trim() === '') {
                reject(new Error(`Ruff exited with findings status but no output: ${stderr.trim().slice(0, 200)}`));
                return;
            }
            try {
                resolve(JSON.parse(stdout || '[]') as RuffDiagnostic[]);
            } catch {
                reject(new Error('Ruff returned invalid JSON'));
            }
        });

        // If Ruff dies early the pipe closes; the 'close' handler reports it.
        child.stdin.on('error', () => 'undefined');
        child.stdin.end(request.code);
    });
}

export const ruffAdapter: Analyzer = {
    name: 'ruff',

    supports(language: string): boolean {
        return language === SUPPORTED_LANGUAGES.PYTHON;
    },

    async analyze(request: ReviewRequest): Promise<Finding[]> {
        const diagonstic = (await runRuff(request)).filter((d) => d.location.row > 0);

        // One syntax mistake can produce several entries ("...", "unexpected EOF").
        // Keep only the first, and report nothing else: later findings would be noise.
        const syntaxErrors = diagonstic.filter(isSyntaxError);
        if (syntaxErrors.length > 0) {
            return [toFinding(syntaxErrors[0], request)];
        }
        return diagonstic.map((d) => toFinding(d, request));
    }
};