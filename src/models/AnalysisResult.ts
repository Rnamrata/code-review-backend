
import { Issue } from './issues';

export interface ParsingResults {
  language: string;
  linesOfCode: number;
  commentLines: number;
  blankLines: number;
  functions: FunctionInfo[];
  classes: ClassInfo[];
  imports: ImportInfo[];
  exports?: ExportInfo[];
  entryPoints?: string[];
  parsingTime: number; // milliseconds
  parsingErrors?: string[];
}

export interface FunctionInfo {
  name: string;
  line: number;
  endLine?: number;
  parameters: string[];
  returnType?: string;
  isAsync: boolean;
  isExported: boolean;
  complexity?: number;
  linesOfCode?: number;
  comments?: string[];
}

export interface ClassInfo {
  name: string;
  line: number;
  endLine?: number;
  methods: FunctionInfo[];
  properties: string[];
  extends?: string;
  implements?: string[];
}

export interface ImportInfo {
  module: string;
  imports: string[];
  line: number;
  isDefault: boolean;
}

export interface ExportInfo {
  name: string;
  line: number;
  isDefault: boolean;
}

export interface StaticAnalysisResults {
  issues: Issue[];
  totalIssues: number;
  bugsFound: number;
  codeSmells: number;
  nullSafetyIssues: number;
  errorHandlingIssues: number;
  unusedCode: number;
  duplicateCode: number;
  analysisTime: number; // milliseconds
  analyzedBy: string;
}

export interface SecurityAnalysisResults {
  issues: Issue[];
  totalVulnerabilities: number;
  criticalVulnerabilities: number;
  highVulnerabilities: number;
  mediumVulnerabilities: number;
  lowVulnerabilities: number;
  securityScore: number; // 0-100
  vulnerabilityTypes: Record<string, number>; // e.g., { "SQL_INJECTION": 2, "XSS": 1 }
  analysisTime: number;
  analyzedBy: string;
}

export interface ComplexityResults {
  issues: Issue[];
  averageCyclomaticComplexity: number;
  averageCognitiveComplexity: number;
  maxNestingDepth: number;
  maintainabilityIndex: number; // 0-100
  complexFunctions: ComplexFunctionInfo[];
  complexityScore: number; // 0-100
  analysisTime: number;
  analyzedBy: string;
}

export interface ComplexFunctionInfo {
  name: string;
  line: number;
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  nestingDepth: number;
  linesOfCode: number;
  suggestedRefactoring?: string;
}

export interface StyleResults {
  issues: Issue[];
  totalViolations: number;
  namingViolations: number;
  indentationIssues: number;
  lineLengthViolations: number;
  documentationMissing: number;
  styleScore: number; // 0-100
  analysisTime: number;
  analyzedBy: string;
}

export interface RagInsights {
  securityReview?: string;
  codeQualityReview?: string;
  bestPractices?: string[];
  improvementSuggestions?: string[];
  explainedIssues?: Array<{
    issueId: string;
    explanation: string;
    sources?: string[];
  }>;
  overallAssessment?: string;
  ragSessionId?: string;
  analysisTime: number;
}

export interface AnalysisMetadata {
  sessionId: string;
  filename: string;
  language: string;
  startTime: Date;
  endTime?: Date;
  totalDuration?: number; // milliseconds
  analyzersUsed: string[];
  analysisVersion: string;
  errors?: string[];
}

export class AnalysisResult {
  metadata: AnalysisMetadata;
  parsingResults?: ParsingResults;
  staticAnalysisResults?: StaticAnalysisResults;
  securityAnalysisResults?: SecurityAnalysisResults;
  complexityResults?: ComplexityResults;
  styleResults?: StyleResults;
  ragInsights?: RagInsights;

  constructor(data: Partial<AnalysisResult>) {
    this.metadata = data.metadata || this.createDefaultMetadata();
    this.parsingResults = data.parsingResults;
    this.staticAnalysisResults = data.staticAnalysisResults;
    this.securityAnalysisResults = data.securityAnalysisResults;
    this.complexityResults = data.complexityResults;
    this.styleResults = data.styleResults;
    this.ragInsights = data.ragInsights;
  }

    private createDefaultMetadata(): AnalysisMetadata {
        return {
            sessionId: '',
            filename: '',
            language: '',
            startTime: new Date(),
            analyzersUsed: [],
            analysisVersion: '1.0'
        };
    }

    getAllIssues(): Issue[] {
       const allIssues: Issue[] = [];
       
       if (this.staticAnalysisResults) {
            allIssues.push(...this.staticAnalysisResults.issues);
       }

        if (this.securityAnalysisResults) {
            allIssues.push(...this.securityAnalysisResults.issues);
        }
        
        if (this.complexityResults) {
            allIssues.push(...this.complexityResults.issues);
        }
        
        if (this.styleResults) {
            allIssues.push(...this.styleResults.issues);
        }

        return allIssues;
    }

    isComplete(): boolean {
        return !!(this.metadata.endTime &&
            this.parsingResults
        );
    }

    getDuration(): number | undefined {
        if (this.metadata.endTime) {
            return 0;
        }

        return (this.metadata.endTime!.getTime() - this.metadata.startTime.getTime());
    }

    complete(): void {
        this.metadata.endTime = new Date();
        this.metadata.totalDuration = this.getDuration();
    }

    addError(error: string): void {
        if (!this.metadata.errors) {
            this.metadata.errors = [];
        }
        this.metadata.errors.push(error);
    }

    hasErrors(): boolean {
        return !!(this.metadata.errors && this.metadata.errors.length > 0);
    }

    toJSON(): any {
        return {
            metadata: {
                ...this.metadata,
                startTime: this.metadata.startTime.toISOString(),
                endTime: this.metadata.endTime ? this.metadata.endTime.toISOString() : undefined,
            },
            parsingResults: this.parsingResults,
            staticAnalysisResults: this.staticAnalysisResults ? {
                ...this.staticAnalysisResults,
                issues: this.staticAnalysisResults.issues.map(issue => issue.toJSON())
            } : undefined,
            securityAnalysisResults: this.securityAnalysisResults ? {
                ...this.securityAnalysisResults,
                issues: this.securityAnalysisResults.issues.map(issue => issue.toJSON())
            } : undefined,
            complexityResults: this.complexityResults ? {
                ...this.complexityResults,
                issues: this.complexityResults.issues.map(issue => issue.toJSON())
            } : undefined,
            styleResults: this.styleResults ? {
                ...this.styleResults,
                issues: this.styleResults.issues.map(issue => issue.toJSON())
            } : undefined,
            ragInsights: this.ragInsights
        };
    }

    static fromJSON(json: any): AnalysisResult {
        return new AnalysisResult({
            metadata: {
                ...json.metadata,
                startTime: new Date(json.metadata.startTime),
                endTime: json.metadata.endTime ? new Date(json.metadata.endTime) : undefined,
            },
            parsingResults: json.parsingResults,
            staticAnalysisResults: json.staticAnalysisResults ? {
                ...json.staticAnalysisResults,
                issues: json.staticAnalysisResults.issues.map((i: any) => Issue.fromJSON(i))
            } : undefined,
            securityAnalysisResults: json.securityAnalysisResults ? {
                ...json.securityAnalysisResults,
                issues: json.securityAnalysisResults.issues.map((i: any) => Issue.fromJSON(i))
            } : undefined,
            complexityResults: json.complexityResults ? {
                ...json.complexityResults,
                issues: json.complexityResults.issues.map((i: any) => Issue.fromJSON(i))
            } : undefined,
            styleResults: json.styleResults ? {
                ...json.styleResults,
                issues: json.styleResults.issues.map((i: any) => Issue.fromJSON(i))
            } : undefined,
            ragInsights: json.ragInsights
        });
    }
}
