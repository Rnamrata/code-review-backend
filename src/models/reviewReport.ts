import { v4 as uuidv4 } from 'uuid';
import { Issue, IssueSeverity, IssueCategory } from './issue';

export enum ReportGrade {
    A = 'A',
    B = 'B',
    C = 'C',
    D = 'D',
    F = 'F'
}

export interface ReportMetadata {
    reportId: string;
    sessionId: string;
    filename: string;
    originalfilename: string;
    language: string;
    generatedAt: Date;
    reportVersion: string;
    analysisVersion?: string;
}

export interface ExecutiveSummary {
    overallGrade: ReportGrade;
    overallScore: number; // 0 to 100
    status: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
    verdict: string;
    totalIssues: number;
    criticalIssues: number;
    highIssues: number;
    mediumIssues: number;
    lowIssues: number;
    infoIssues: number;
}

export interface CategoryScore {
    category: IssueCategory;
    sccore: number;
    grade: ReportGrade;
    weight: number;
    issues: Issue[];
    issueCount: number;
    summery: string;
}

export interface Recommendation {
    priority: 'immediate' | 'high' | 'medium' | 'low';
    category: IssueCategory;
    title: string;
    description: string;
    impact: string;
    effort: 'low' | 'medium' | 'high';
    relatedIssues: string[]; // issue IDs
}

export interface ActionPlanPhase {
    phase: number;
    name: string;
    description: string;
    issues: string[]; // issue IDs
    estimatedTime: string; // e.g., "2 weeks", "1 month"
    priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface MetricComparison {
    current: {
        totalIssues: number;
        criticatIssues: number;
        securityScore: number;
        qualityScore: number;
        complexityScore: number;
        styleScore: number;
    };
    previous: {
        totalIssues: number;
        criticatIssues: number;
        securityScore: number;
        qualityScore: number;
        complexityScore: number;
        styleScore: number;
    };
    improement: {
        issueReduction: number; // in percentage
        scoreIncrease: number; // in percentage
    }
}

export class ReviewReport {
    metadata: ReportMetadata;
    summary: ExecutiveSummary;
    categoryScores: Map<IssueCategory, CategoryScore>;
    issues: Issue[];
    recommendations: Recommendation[];
    actionPlan: ActionPlanPhase[];
    metrics: MetricComparison;

    constructor(data: Partial<ReviewReport>) {
        this.metadata = data.metadata || this.createDefaultMetadata();
        this.summary = data.summary || this.createDefaultSummary();
        this.categoryScores = data.categoryScores || new Map();
        this.issues = data.issues || [];
        this.recommendations = data.recommendations || [];
        this.actionPlan = data.actionPlan || [];
        this.metrics = data.metrics || this.createDefaultMetrics();
    }

    private createDefaultMetadata(): ReportMetadata {
        return {
            reportId: uuidv4(),
            sessionId: '',
            filename: '',
            originalfilename: '',
            language: '',
            generatedAt: new Date(),
            reportVersion: '1.0',
        };
    }

    private createDefaultSummary(): ExecutiveSummary {
        return {
            overallGrade: ReportGrade.C,
            overallScore: 50,
            status: 'fair',
            verdict: 'Analysis pending',
            totalIssues: 0,
            criticalIssues: 0,
            highIssues: 0,
            mediumIssues: 0,
            lowIssues: 0,
            infoIssues: 0,
        };
    }
    private createDefaultMetrics(): MetricComparison {
        return {
            current: {
                totalIssues: 0,
                criticatIssues: 0,
                securityScore: 0,
                qualityScore: 0,
                complexityScore: 0,
                styleScore: 0,
            },
            previous: {
                totalIssues: 0,
                criticatIssues: 0,
                securityScore: 0,
                qualityScore: 0,
                complexityScore: 0,
                styleScore: 0,
            },
            improement: {
                issueReduction: 0,
                scoreIncrease: 0,
            }
        }
    }

    calculateOverallScore(): number {
        if (this.categoryScores.size === 0) return 0;

        let weightedSum = 0;
        let totalWeight = 0;

        this.categoryScores.forEach((catScore) => {
            weightedSum += catScore.sccore * catScore.weight;
            totalWeight += catScore.weight;
        });

        return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
    }

    scoreToGrade(score: number): ReportGrade {
        if (score >= 90) return ReportGrade.A;
        if (score >= 80) return ReportGrade.B;
        if (score >= 70) return ReportGrade.C;
        if (score >= 60) return ReportGrade.D;
        return ReportGrade.F;
    }

    scoreToStatus(score: number): 'excellent' | 'good' | 'fair' | 'poor' | 'critical' {
        if (score >= 90) return 'excellent';
        if (score >= 75) return 'good';
        if (score >= 50) return 'fair';
        if (score >= 30) return 'poor';
        return 'critical';
    }

    getIssuesBySeverity(severity: IssueSeverity): Issue[] {
        return this.issues.filter(issue => issue.severity === severity);
    }

    getIssuesByCategory(category: IssueCategory): Issue[] {
        return this.issues.filter(issue => issue.category === category);
    }

    getPrioritizedIssues(): Issue[] {
        return [...this.issues].sort((a, b) => b.getProrityScore() - a.getProrityScore());
    }

    getCriticalIssues(): Issue[] {
        return this.issues.filter(issue => issue.isCritical());
    }

    getHighPriorityIssues(): Issue[] {
        return this.issues.filter(issue => issue.isHighPriority());
    }

    countIssuesBySeverity(): Record<IssueSeverity, number> {
        const counts: Record<IssueSeverity, number> = {
            [IssueSeverity.CRITICAL]: 0,
            [IssueSeverity.HIGH]: 0,
            [IssueSeverity.MEDIUM]: 0,
            [IssueSeverity.LOW]: 0,
            [IssueSeverity.INFO]: 0
        };

        this.issues.forEach(issue => {
            counts[issue.severity]++;
        });

        return counts;
    }

    countIssuesByCategory(): Record<IssueCategory, number> {
        const counts: Record<IssueCategory, number> = {
            [IssueCategory.SECURITY]: 0,
            [IssueCategory.QUALITY]: 0,
            [IssueCategory.COMPLEXITY]: 0,
            [IssueCategory.STYLE]: 0
        };

        this.issues.forEach(issue => {
            counts[issue.category]++;
        });

        return counts;
    }

    validate(): boolean {
        if (!this.metadata.reportId || !this.metadata.sessionId) return false;
        if (!this.summary) return false;
        return this.issues.every(issue => issue.validate());
    }

    toJSON(): any {
        return {
            metadata: {
                ...this.metadata,
                generatedAt: this.metadata.generatedAt.toISOString()
            },
            summary: this.summary,
            categoryScores: Array.from(this.categoryScores.entries()).map(([category, score]) => ({
                ...score,
                issues: score.issues.map(i => i.toJSON())
            })),
            issues: this.issues.map(issue => issue.toJSON()),
            recommendations: this.recommendations,
            actionPlan: this.actionPlan,
            metrics: this.metrics
        };
    }

    static fromJSON(json: any): ReviewReport {
        const report = new ReviewReport({});

        report.metadata = {
            ...json.metadata,
            generatedAt: new Date(json.metadata.generatedAt)
        };
        
        report.summary = json.summary;
        report.categoryScores = new Map();
        
        if (json.categoryScores) {
            json.categoryScores.forEach((cs: any) => {
                report.categoryScores.set(cs.category, {
                    ...cs,
                    issues: cs.issues.map((i: any) => Issue.fromJSON(i))
                });
            });
        }
        
        report.issues = json.issues.map((i: any) => Issue.fromJSON(i));
        report.recommendations = json.recommendations;
        report.actionPlan = json.actionPlan;
        report.metrics = json.metrics;
        
        return report;
    }
}