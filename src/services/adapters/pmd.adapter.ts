import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { appConfig } from '../../config/app.config';
import { SUPPORTED_LANGUAGES } from '../../constants/fileTypes';
import { Finding, Severity } from '../../models/finding';
import { Analyzer, ReviewRequest } from '../../models/review.model';

// PMD, the Java linter. It reads source code, so one uploaded file is enough: nothing is compiled.

interface PmdViolation {
    beginline: number;
    description: string;
    rule: string;
    ruleset: string;
}

interface PmdReport {
    files?: { violations?: PmdViolation[] }[];
    suppressedViolations?: { violation?: PmdViolation }[];
    processingErrors?: { message?: string; detail?: string }[];
    configurationErrors?: { rule?: string; message?: string }[];
}

type Category = 'security' | 'bug' | 'reliability' | 'maintainability' | 'performance';

// The rules that run, and what each finding is. Chosen for problems that matter in a review:
// the whole "best practices" or "code style" sets would bury them in noise.
export const PMD_RULES: Record<string, { ref: string; category: Category }> = {
    HardCodedCryptoKey: { ref: 'category/java/security.xml/HardCodedCryptoKey', category: 'security' },
    InsecureCryptoIv: { ref: 'category/java/security.xml/InsecureCryptoIv', category: 'security' },
    UseEqualsToCompareStrings: { ref: 'category/java/errorprone.xml/UseEqualsToCompareStrings', category: 'bug' },
    MisplacedNullCheck: { ref: 'category/java/errorprone.xml/MisplacedNullCheck', category: 'bug' },
    BrokenNullCheck: { ref: 'category/java/errorprone.xml/BrokenNullCheck', category: 'bug' },
    EqualsNull: { ref: 'category/java/errorprone.xml/EqualsNull', category: 'bug' },
    OverrideBothEqualsAndHashcode: { ref: 'category/java/errorprone.xml/OverrideBothEqualsAndHashcode', category: 'bug' },
    ImplicitSwitchFallThrough: { ref: 'category/java/errorprone.xml/ImplicitSwitchFallThrough', category: 'bug' },
    ReturnFromFinallyBlock: { ref: 'category/java/errorprone.xml/ReturnFromFinallyBlock', category: 'bug' },
    UnsynchronizedStaticFormatter: { ref: 'category/java/multithreading.xml/UnsynchronizedStaticFormatter', category: 'bug' },
    DoubleCheckedLocking: { ref: 'category/java/multithreading.xml/DoubleCheckedLocking', category: 'bug' },
    CloseResource: { ref: 'category/java/errorprone.xml/CloseResource', category: 'reliability' },
    EmptyCatchBlock: { ref: 'category/java/errorprone.xml/EmptyCatchBlock', category: 'reliability' },
    AvoidPrintStackTrace: { ref: 'category/java/bestpractices.xml/AvoidPrintStackTrace', category: 'reliability' },
    PreserveStackTrace: { ref: 'category/java/bestpractices.xml/PreserveStackTrace', category: 'reliability' },
    UseStringBufferForStringAppends: { ref: 'category/java/performance.xml/UseStringBufferForStringAppends', category: 'performance' },
    UnusedPrivateField: { ref: 'category/java/bestpractices.xml/UnusedPrivateField', category: 'maintainability' },
    UnusedPrivateMethod: { ref: 'category/java/bestpractices.xml/UnusedPrivateMethod', category: 'maintainability' },
    UnusedLocalVariable: { ref: 'category/java/bestpractices.xml/UnusedLocalVariable', category: 'maintainability' }
};

const SEVERITY: Record<Category, Severity> = {
    security: 'high',
    bug: 'medium',
    reliability: 'medium',
    performance: 'low',
    maintainability: 'low'
};

// Stop reading if PMD's output is absurdly large.
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

function toFinding(v: PmdViolation, request: ReviewRequest): Finding {
    const category = PMD_RULES[v.rule]?.category ?? 'maintainability';
    return {
        file: request.filename,
        line: v.beginline,
        // The rule at the end, as Ruff and ESLint do, so its "why" card is exact
        message: `${v.description.trim()} (${v.rule})`,
        severity: SEVERITY[category],
        category,
        source: 'pmd'
    };
}

/** A file PMD could not parse: one finding on the line it names, as Ruff does for a syntax error. */
function syntaxFinding(error: { message?: string; detail?: string }, request: ReviewRequest): Finding {
    const text = `${error.message ?? ''} ${error.detail ?? ''}`;
    const line = Number(/line (\d+)/i.exec(text)?.[1] ?? 0);
    const reason = /Encountered[^\n.]*/.exec(text)?.[0]?.trim();
    return {
        file: request.filename,
        line,
        message: `Java syntax error${reason ? `: ${reason}` : ''}; the file could not be checked further`,
        severity: 'high',
        category: 'bug',
        source: 'pmd'
    };
}

/** A name PMD reads as Java: the sanitized one, always ending in .java. */
function javaName(safeFilename: string): string {
    const base = path.basename(safeFilename) || 'Code.java';
    return base.toLowerCase().endsWith('.java') ? base : `${base}.java`;
}

function runPmd(file: string, signal?: AbortSignal): Promise<PmdReport> {
    return new Promise((resolve, reject) => {
        const args = [
            'check',
            '--no-cache',
            '--no-progress',
            '--format', 'json',
            '--rulesets', Object.values(PMD_RULES).map((r) => r.ref).join(','),
            // Submitted code must not be able to hide findings: a random marker replaces "NOPMD",
            // and @SuppressWarnings("PMD") findings are reported with the rest
            '--suppress-marker', `X${randomBytes(8).toString('hex')}`,
            '--show-suppressed',
            '--dir', file
        ];

        // The code is only read by PMD, never compiled or run.
        const child = spawn(appConfig.pmdBin, args, {
            timeout: appConfig.pmdTimeoutMs,
            signal,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        let bytes = 0;
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            bytes += Buffer.byteLength(chunk);
            if (bytes > MAX_OUTPUT_BYTES) {
                child.kill();
                reject(new Error('PMD output exceeded the size limit'));
                return;
            }
            stdout += chunk;
        });
        child.stderr.on('data', (chunk: string) => { stderr += chunk; });

        child.on('error', (err: NodeJS.ErrnoException) => {
            reject(err.code === 'ENOENT' ? new Error(`PMD not found at "${appConfig.pmdBin}" (set PMD_BIN, or PMD_ENABLED=false)`) : err);
        });

        child.on('close', (code, closeSignal) => {
            if (closeSignal) {
                reject(new Error(`PMD was stopped (${closeSignal}), likely a timeout`));
                return;
            }
            // 0 = clean, 4 = findings, 5 = a file it couldn't parse. 1 and 2 mean PMD itself failed.
            if (code !== 0 && code !== 4 && code !== 5) {
                reject(new Error(`PMD failed (exit ${code}): ${stderr.trim().slice(0, 200)}`));
                return;
            }
            try {
                resolve(JSON.parse(stdout) as PmdReport);
            } catch {
                reject(new Error(`PMD returned invalid JSON: ${stderr.trim().slice(0, 200)}`));
            }
        });
    });
}

export const pmdAdapter: Analyzer = {
    name: 'pmd',

    supports(language: string): boolean {
        return appConfig.pmdEnabled && language === SUPPORTED_LANGUAGES.JAVA;
    },

    async analyze(request: ReviewRequest, signal?: AbortSignal): Promise<Finding[]> {
        // A folder of its own, readable only by this user, removed afterwards whatever happens
        const dir = await mkdtemp(path.join(tmpdir(), 'review-pmd-'));
        try {
            const file = path.join(dir, javaName(request.safeFilename));
            await writeFile(file, request.code, { mode: 0o600 });
            const report = await runPmd(file, signal);

            const config = report.configurationErrors?.[0];
            if (config) throw new Error(`PMD rule set problem: ${config.rule ?? ''} ${config.message ?? ''}`.trim());

            const parseError = report.processingErrors?.[0];
            if (parseError) return [syntaxFinding(parseError, request)];

            const violations = [
                ...(report.files ?? []).flatMap((f) => f.violations ?? []),
                ...(report.suppressedViolations ?? []).flatMap((s) => (s.violation ? [s.violation] : []))
            ];
            return violations.filter((v) => v.beginline > 0).map((v) => toFinding(v, request));
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    }
};
