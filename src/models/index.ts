import { Session } from './Session';
import {
    Issue,
    IssueCategory,
    IssueSeverity,
    FixDifficulty,
    IssueLocation,
    IssueFix,
    IssueReference,
    AIInsight
} from './issues';
import {
    ReviewReport,
    ReportGrade,
    ReportMetadata,
    ExecutiveSummary,
    CategoryScore,
    Recommendation,
    ActionPlanPhase,
    MetricComparison
} from './reviewReport';
import {
    AnalysisResult,
    ParsingResults,
    FunctionInfo,
    ClassInfo,
    ImportInfo,
    ExportInfo,
    StaticAnalysisResults,
    SecurityAnalysisResults,
    ComplexityResults,
    ComplexFunctionInfo,
    StyleResults,
    RagInsights,
    AnalysisMetadata
} from './AnalysisResult';
import {
    ChatMessage,
    MessageRole,
    MessageSource,
    MessageMetadata,
    ChatHistory,
    ContextType
} from './chatMesssage';

export function isIssue(value: any): value is Issue {
    return value instanceof Issue && typeof value.validate === 'function';
}

export function isReviewReport(value: any): value is ReviewReport {
    return value instanceof ReviewReport && typeof value.calculateOverallScore === 'function';
}

export function isAnalysisResult(value: any): value is AnalysisResult {
    return value instanceof AnalysisResult && typeof value.getAllIssues === 'function';
}

export function isChatMessage(value: any): value is ChatMessage {
    return value instanceof ChatMessage && typeof value.validate === 'function';
}

export function isSession(value: any): value is Session {
    return value instanceof Session && typeof value.validate === 'function';
}

export type IssueInput = Partial<Issue> & {
    category: IssueCategory;
    severity: IssueSeverity;
    type: string;
    location: IssueLocation;
    title: string;
    description: string;
    filename: string;
}

export type IssueDTO = {
    issueId: string;
    category: IssueCategory;
    severity: IssueSeverity;
    type: string;
    title: string;
    description: string;
    filename: string;
    line: number;
    priority: number;
};

export type ReportSummaryDTO = {
    reportId: string;
    sessionId: string;
    filename: string;
    overallGrade: ReportGrade;
    overallScore: number;
    totalIssues: number;
    criticalIssues: number;
    generatedAt: string;
};

export type ChatMessageDTO = {
    messageId: string;
    role: MessageRole;
    content: string;
    timestamp: Date;
    sources?: MessageSource[];
    confidence?: number;
};

export function issueToDTO(issue: Issue): IssueDTO {
    return {
        issueId: issue.issueId,
        category: issue.category,
        severity: issue.severity,
        type: issue.type,
        title: issue.title,
        description: issue.description,
        line: issue.location.line,
        filename: issue.filename,
        priority: issue.priority
    };
}

export function reportToSummaryDTO(report: ReviewReport): ReportSummaryDTO {
    return {
        reportId: report.metadata.reportId,
        sessionId: report.metadata.sessionId,
        filename: report.metadata.filename,
        overallGrade: report.summary.overallGrade,
        overallScore: report.summary.overallScore,
        totalIssues: report.summary.totalIssues,
        criticalIssues: report.summary.criticalIssues,
        generatedAt: report.metadata.generatedAt.toISOString()
    };
}

export function chatMessageToDTO(message: ChatMessage): ChatMessageDTO {
    return {
        messageId: message.messageId,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        sources: message.sources,
        confidence: message.confidence
    };
}

export function issuesToDTOs(issues: Issue[]): IssueDTO[] {
    return issues.map(issueToDTO);
}

export function chatMessageToDTOs(messages: ChatMessage[]): ChatMessageDTO[] {
    return messages.map(chatMessageToDTO);
}
