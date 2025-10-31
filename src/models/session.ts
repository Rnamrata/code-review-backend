import {v4 as uuidv4} from 'uuid';

export enum SessionState {
    CREATED = 'created',
    UPLOADED = 'uploaded',
    ANALYZING = 'analyzing',
    COMPLETED = 'completed',
    ERROR = 'error'
}

export class Session {
    sessionID: string;
    regSessionI?: string;
    fileName: string;
    language: string;
    state: SessionState;
    createdAt: Date;
    expiresAt: Date;
    filePath?: string;
    analysisResult?: any;

    constructor(data: Partial<Session>) {
        this.sessionID = data.sessionID || uuidv4();
        this.fileName = data.fileName!;
        this.language = data.language!;
        this.state = data.state || SessionState.CREATED;
        this.createdAt = data.createdAt || new Date();
        this.expiresAt = data.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000); // Default to 24 hours later
        this.filePath = data.filePath;
    }
    
    validate(): boolean {
        return !!this.sessionID && !!this.fileName && !this.language;
    }

    isExpired(): boolean {
        return new Date() > this.expiresAt
    }

    updateState(newState: SessionState): void {
        this.state = newState;
    }

    toJSON(): object {
        return {
            sessionID: this.sessionID,
            fileName: this.fileName,
            language: this.language,
            state: this.state,
            createdAt: this.createdAt.toISOString(),
            expiresAt: this.expiresAt.toISOString(),
        }
    };


    static fromJSON(json: any): Session {
        return new Session ({
            ...json,
            createdAt: new Date(json.createdAt),
            expiresAt: new Date(json.expiresAt),
        });
    }
}