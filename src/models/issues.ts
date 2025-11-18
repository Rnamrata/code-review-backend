import {v4 as uuidv4} from 'uuid';

export enum IssueCategory {
    SECURITY = 'Security',
    QUALITY = 'Quality',
    COMPLEXITY = 'Complexity',
    STYLE = 'Style'
}

export enum IssueSeverity {
    CRETICAL = 'Critical',
    HIGH = 'High',
    MEDIUM = 'Medium',
    LOW = 'Low',
    INFO = 'Info'
}

export enum FixDifficulty {
    EASY = 'Easy',
    MEDIUM = 'Medium',
    HARD = 'Hard'
}

export interface IssueLocation {
    line: number;
    column: number;
    endline?: number;
    endcolumn?: number;
    functionNeame?: string;
    className?: string;
}

export interface IssueFix {
    description: string;
    codeExample?: string;
    difficulty: FixDifficulty;
    estimatedTime?: string; // e.g., "15 minutes", "1 hour"
    additionalChanges?: string[];
}

export interface IssueReference {
    cwe?: string;
    owasp?: string;
    rule?: string;
    link?: string;
}

export interface AIInsight {
    explanation?: string;
    source?: string;
    confidence?: number; // 0 to 1
}

export class Issue {
    issueId: string;
    category: IssueCategory;
    severity: IssueSeverity;
    type: string;

    location: IssueLocation;
    filename: string;

    title: string;
    description: string;
    codeSnippet?: string;
    impact?: string;

    fix?: IssueFix;
    references?: IssueReference;
    aiInsight?: AIInsight;

    priority: number; // 1 (highest) to 10 (lowest)
    detectedBy: string;
    timestamp: Date;

    constructor(data: Partial<Issue>) {
        this.issueId = data.issueId || uuidv4();
        this.category = data.category!;
        this.severity = data.severity!;
        this.type = data.type!;

        this.location = data.location!;
        this.filename = data.filename!;

        this.title = data.title!;
        this.description = data.description!;
        this.codeSnippet = data.codeSnippet;
        this.impact = data.impact;

        this.fix = data.fix;
        this.references = data.references;
        this.aiInsight = data.aiInsight;

        this.priority = data.priority || this.calculatePriority();
        this.detectedBy = data.detectedBy || 'Unknown';
        this.timestamp = data.timestamp || new Date();
    }

    isCritical(): boolean {
        return this.severity === IssueSeverity.CRETICAL;
    }

    isHighPriority(): boolean {
        return this.severity === IssueSeverity.CRETICAL || 
               this.severity === IssueSeverity.HIGH;
    }

    calculatePriority(): number {
        const severityScore: Record<IssueSeverity, number> = {
            [IssueSeverity.CRETICAL]: 10,
            [IssueSeverity.HIGH]: 7,
            [IssueSeverity.MEDIUM]: 5,
            [IssueSeverity.LOW]: 3,
            [IssueSeverity.INFO]: 1
        };

        const severityWeight: Record<IssueCategory, number> = {
            [IssueCategory.SECURITY]: 1.0,
            [IssueCategory.QUALITY]: 0.8,
            [IssueCategory.COMPLEXITY]: 0.6,
            [IssueCategory.STYLE]: 0.4
        }

        const basePriority = severityScore[this.severity];
        const weight = severityWeight[this.category];

        return Math.round(basePriority * weight);
    }

    getProrityScore(): number {
        return this.priority;
    }

    validate(): boolean {
        const hasRequired = !!(
            this.issueId &&
            this.category &&
            this.severity &&
            this.type &&
            this.title &&
            this.description &&
            this.location &&
            this.filename
        )

        if (!hasRequired) {
            return false;
        }

        if(!this.location.line || this.location.line < 1) {
            return false;
        }

        return true;
    }

    getDisplaySeverity(): string {
        const severityEmojis: Record<IssueSeverity, string> = {
            [IssueSeverity.CRETICAL]: '🔥 Critical',
            [IssueSeverity.HIGH]: '⚠️ High',
            [IssueSeverity.MEDIUM]: '🔶 Medium',
            [IssueSeverity.LOW]: 'ℹ️ Low',
            [IssueSeverity.INFO]: '💡 Info'
        };

        return severityEmojis[this.severity];
    }

    toJSON(): any {
        return {
            issueId: this.issueId,
            category: this.category,
            severity: this.severity,
            type: this.type,
            location: this.location,
            filename: this.filename,
            title: this.title,
            description: this.description,
            codeSnippet: this.codeSnippet,
            impact: this.impact,
            fix: this.fix,
            references: this.references,
            aiInsight: this.aiInsight,
            priority: this.priority,
            detectedBy: this.detectedBy,
            timestamp: this.timestamp.toISOString()
        };
    }

    static fromJSON(json: any): Issue {
        return new Issue({
            ...json,
            timestamp: new Date(json.timestamp)
        });
    }

    static createQuick(
        category: IssueCategory,
        severity: IssueSeverity,
        title: string,
        line: number,
        filename: string
    ): Issue {
        return new Issue({
            category,
            severity,
            type: 'GENERIC',
            title,
            description: title,
            location: { line, column: 1 },
            filename
        });
    }
}