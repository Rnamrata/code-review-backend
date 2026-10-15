import { Finding, Severity} from '../models/finding';
import { ReviewSummary } from '../models/review.model';

export function buildSummary(findings: Finding[]): ReviewSummary {
    const bySeverity: Record<Severity, number> = {
        critical: 0, 
        high: 0,
        medium: 0,
        low: 0,
        info: 0
    };

    const bySource: ReviewSummary['bySource'] = {};
    const byCategory: Record<string, number> = {};

    for (const finding of findings) {
        bySeverity[finding.severity] += 1;
        if (finding.source) bySource[finding.source] = (bySource[finding.source] ?? 0) + 1;
        const category = finding.category ?? 'uncategorized';
        byCategory[category] = (byCategory[category] ?? 0) + 1;
    }

    return {
        total: findings.length, bySeverity, bySource, byCategory
    };

}