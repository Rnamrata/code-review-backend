import { promises as fs} from 'fs';
import path from 'path';
import { Session } from '../models/Session';
import { appConfig } from '../config/app.config';
import { logger, logFile, logSession } from '../utils/logger.util';
import { SessionState } from '../constants/sessionStates';

export interface CreateSessionData {
    sessionID: string;
    fileName: string;
    originalFilename?: string;
    language: string;
    filePath?: string;
    fileSize?: number;
    metadata?: {
        ipAddress?: string;
        userAgent?: string
    };
}

export class SessionManagerService {
    private static sessionDir = appConfig.sessionDirectory;

    static async initialize(): Promise<void> {
        await fs.mkdir(this.sessionDir, { recursive: true });
        logger.info('Session directory initialized', { path: this.sessionDir });
    }

    public static async createSession(data: CreateSessionData): Promise<Session> {
        try {
            const session = new Session({
                ...data,
                state: SessionState.CREATED
            });

            if(!session.validate()) {
                throw new Error('Invalid session data');
            }

            await this._saveSession(session);

            logSession('created', session.sessionID, {
                fileName: session.fileName,
                language: session.language
            });

            return session;
        } catch (error) {
            logger.error('Failed to create session', { error });
            throw error;
        }
    }

    public static async getSession(sessionID: string): Promise<Session | null> {
        try {
            const filePath = this._getSessionFilePath(sessionID);
            const content = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);

            const session = Session.fromJSON(data);
            if(session.isExpired()) {
                logger.warn('Session expired', { sessionID });
                return null;
            }
            return session;
        } catch (error) {
            logger.debug('Session not found', { sessionID });
            return null;
        }
    }

    public static async updateSession(
        sessionID: string,
        updates: Partial<Session> 
    ): Promise<Session> {
        const session = await this.getSession(sessionID);
        
        if(!session) {
            throw new Error('Session not found: ${sessionID}');
        }

        Object.assign(session, updates);
        session.lastActivityAt = new Date();

        await this._saveSession(session);

        logSession('updated', sessionID);
        return session;
    }

    public static async updateSessionState(
        sessionID: string,
        newState: SessionState
    ): Promise<Session> {
        const session = await this.getSession(sessionID);
        if(!session) {
            throw new Error('Session not found: ${sessionID}');
        }

        session.updateState(newState);
        await this._saveSession(session);

        logSession('updated', sessionID, { newState });
        return session;
    }

    public static async deleteSession(sessionID: string): Promise<boolean> {
        try {
            const filePath = this._getSessionFilePath(sessionID);
            await fs.unlink(filePath);

            logSession('deleted', sessionID);
            return true;
        } catch (error) {
            logger.error('Failed to delete session', { sessionID, error });
            return false;
        }
    }

    private static _getSessionFilePath(sessionID: string): string {
        return path.join(this.sessionDir, `${sessionID}.json`);
    }

    private static async _saveSession(session: Session): Promise<void> {
        const filePath = this._getSessionFilePath(session.sessionID);
        const content = JSON.stringify(session.toJSON(), null, 2);
        await fs.writeFile(filePath, content, 'utf-8');
    }
}
