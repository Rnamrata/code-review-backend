import {v4 as uuidv4} from 'uuid';
import { SessionState } from '../constants/sessionStates';

export interface SessionProgress {
  percentage: number;
  currentStep: string;
  completedSteps: string[];
}

export interface SessionMetadata {
  ipAddress?: string;
  userAgent?: string;
  analysisVersion?: string;
}
export class Session {
    sessionID: string;
    regSessionID?: string;
    fileName: string;
    originalFilename: string;
    language: string;
    state: SessionState;
    filePath?: string;
    fileSize?: number;

    createdAt: Date;
    uploadedAt?: Date;
    analysisStartedAt?: Date;
    analysisCompletedAt?: Date;
    lastActivityAt: Date;
    expiresAt: Date;

    progress?: SessionProgress;

    progessResults?: any;
    staticAnalysisResults?: any;
    secrityAnalysisResults?: any;
    complexityResults?: any;
    styleResults?: any;
    regInsights?: any;
    finalReport?: any;

    chatHistory: any[];
    metadata: SessionMetadata;    

    analysisResult?: any;

    constructor(data: Partial<Session>) {
        this.sessionID = data.sessionID || uuidv4();
        this.fileName = data.fileName!;
        this.originalFilename = data.originalFilename || data.fileName!;
        this.language = data.language!;
        this.state = data.state || SessionState.CREATED;
        this.createdAt = data.createdAt || new Date();
        this.filePath = data.filePath!;
        this.fileSize = data.fileSize!;

        this.lastActivityAt = data.lastActivityAt || new Date();
        this.expiresAt = data.expiresAt || this.calculateExpiration();
        
        this.chatHistory = data.chatHistory || [];
        this.metadata = data.metadata || {};
    }

    private calculateExpiration(): Date {
        const hours = 24; // From config
        return new Date(Date.now() + hours * 60 * 60 * 1000);
    }
    
    validate(): boolean {
        return !!this.sessionID && !!this.fileName && !this.language;
    }

    isExpired(): boolean {
        return new Date() > this.expiresAt
    }

    updateState(newState: SessionState): void {
        this.state = newState;
        this.lastActivityAt = new Date();

        if(newState === SessionState.UPLOADED) {
            this.uploadedAt = new Date();
        } else if(newState === SessionState.ANALYZING) {
            this.analysisStartedAt = new Date();
        } else if(newState === SessionState.COMPLETED) {
            this.analysisCompletedAt = new Date();
        }
    }

    toJSON(): object {
        return {
            sessionId: this.sessionID,
            ragSessionId: this.regSessionID,
            filename: this.fileName,
            originalFilename: this.originalFilename,
            language: this.language,
            state: this.state,
            filePath: this.filePath,
            fileSize: this.fileSize,
            createdAt: this.createdAt.toISOString(),
            uploadedAt: this.uploadedAt?.toISOString(),
            analysisStartedAt: this.analysisStartedAt?.toISOString(),
            analysisCompletedAt: this.analysisCompletedAt?.toISOString(),
            lastActivityAt: this.lastActivityAt.toISOString(),
            expiresAt: this.expiresAt.toISOString(),
            progress: this.progress,
            chatHistory: this.chatHistory,
            metadata: this.metadata
        }
    };


    static fromJSON(json: any): Session {
        return new Session ({
            ...json,
            createdAt: new Date(json.createdAt),
            uploadedAt: json.uploadedAt ? new Date(json.uploadedAt) : undefined,
            lastActivityAt: new Date(json.lastActivityAt),
            expiresAt: new Date(json.expiresAt)
        });
    }
}