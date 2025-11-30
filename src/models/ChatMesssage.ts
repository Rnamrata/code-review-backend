import { response } from 'express';
import { stat } from 'fs';
import { get } from 'http';
import { v4 as uuidv4 } from 'uuid';

export enum MessageRole {
    USER = 'user',
    ASSISTANT = 'assistant',
    SYSTEM = 'system'
}

export interface MessageSource {
    title?: string;
    content: string;
    relevance?: number; // 0 to 1
    documentId?: string;
    chunkId?: string;
}

export interface MessageMetadata {
  ipAddress?: string;
  userAgent?: string;
  responseTime?: number; // milliseconds
  tokensUsed?: number;
  model?: string;
  temperature?: number;
  [key: string]: any; // Allow additional metadata
}

export enum ContextType {
  GENERAL = 'general',
  ISSUE_EXPLANATION = 'issue_explanation',
  CODE_REVIEW = 'code_review',
  BEST_PRACTICES = 'best_practices',
  SECURITY_ADVICE = 'security_advice',
  REFACTORING_SUGGESTION = 'refactoring_suggestion'
}

export class ChatMessage {
    messageId: string;
    sessionId: string;
    ragSessionId?: string;

    role: MessageRole;
    content: string

    question?: string; // Original question that prompted this message
    answer?: string; // Answer provided by the assistant
    sources?: MessageSource[];
    confidence?: number; // 0 to 1

    timestamp: Date;
    responceTime?: number; // milliseconds

    metadata?: MessageMetadata;
    relatedIsssueIds?: string[];
    contextType?: ContextType;

    parentMessageId?: string; // For threading conversations
    threadId?: string;

    constructor(data: Partial<ChatMessage>) {
        this.messageId = data.messageId || uuidv4();
        this.sessionId = data.sessionId!;
        this.ragSessionId = data.ragSessionId;

        this.role = data.role || MessageRole.USER;
        this.content = data.content!;

        this.question = data.question;
        this.answer = data.answer;
        this.sources = data.sources;
        this.confidence = data.confidence;

        this.timestamp = data.timestamp || new Date();
        this.responceTime = data.responceTime;

        this.metadata = data.metadata || {};
        this.relatedIsssueIds = data.relatedIsssueIds;
        this.contextType = data.contextType || ContextType.GENERAL;

        this.parentMessageId = data.parentMessageId;
        this.threadId = data.threadId;
    }

    isUserMessage(): boolean {
        return this.role === MessageRole.USER;
    }

    isAssistantMessage(): boolean {
        return this.role === MessageRole.ASSISTANT;
    }

    isSystemMessage(): boolean {
        return this.role === MessageRole.SYSTEM;
    }

    hasSources(): boolean {
        return !!(this.sources && this.sources.length > 0);
    }

    isHighConfidence(): boolean {
        return this.confidence ? this.confidence >= 0.7 : false;
    }

    isMediumConfidence(): boolean {
        return this.confidence ? this.confidence >= 0.5 && this.confidence < 0.7 : false;
    }

    isLowConfidence(): boolean {
        return this.confidence ? this.confidence < 0.5 : false;
    }

    getConfidenceLevel(): 'high' | 'medium' | 'low' | 'unknown' {
        if (!this.confidence) return 'unknown';
        if (this.confidence >= 0.7) return 'high';
        if (this.confidence >= 0.5) return 'medium';
        return 'low';
    }

    getFormattedTimestamp(): string {
        return this.timestamp.toLocaleString();
    }

    getISOTimestamp(): string {
        return this.timestamp.toISOString();
    }

    getResponseTimeInSeconds(): number | null {
        return this.responceTime ? this.responceTime / 1000 : null;
    }

    hasRelatedIssues(): boolean {
        return !!(this.relatedIsssueIds && this.relatedIsssueIds.length > 0);
    }

    getRelatedIssueCount(): number {
        return this.relatedIsssueIds? this.relatedIsssueIds.length : 0;
    }

    isPartOfThreaad(): boolean {
        return !!(this.threadId || this.parentMessageId);
    }

    addSource(source: MessageSource): void {
        if (!this.sources) {
            this.sources = [];
        }
        this.sources.push(source);
    }

    addRelatedIssueId(issueId: string): void {
        if (!this.relatedIsssueIds) {
            this.relatedIsssueIds = [];
        }

        if (!this.relatedIsssueIds.includes(issueId)) {
            this.relatedIsssueIds.push(issueId);
        }
    }

    setMetadata(key: string, value: any): void {
        if (!this.metadata) {
            this.metadata = {};
        }
        this.metadata[key] = value;
    }

    getMetadata(key: string): any {
        return this.metadata ? this.metadata[key] : undefined;
    }

    validate(): boolean {
        if (!this.messageId || !this.sessionId || !this.content) return false;
        if (!this.role) return false;
        if (this.role === MessageRole.USER && !this.question) return false;
        if (this.role === MessageRole.ASSISTANT && !this.answer) return false;
        return true;
    }

    toJSON(): any {
        return {
            messageId: this.messageId,
            sessionId: this.sessionId,
            ragSessionId: this.ragSessionId,
            role: this.role,
            content: this.content,
            question: this.question,
            answer: this.answer,
            sources: this.sources,
            confidence: this.confidence,
            timestamp: this.timestamp.toISOString(),
            responceTime: this.responceTime,
            metadata: this.metadata,
            relatedIsssueIds: this.relatedIsssueIds,
            contextType: this.contextType,
            parentMessageId: this.parentMessageId,
            threadId: this.threadId
        };
    }

    static fromJSON(json: any): ChatMessage {
        return new ChatMessage({
            ...json,
            timestamp: new Date(json.timestamp),
            role: json.role as MessageRole,
            contextType: json.contextType as ContextType
        });
    }

    static createUserMessage(
        sessionId: string,
        question: string,
        contextType: ContextType = ContextType.GENERAL,
        relatedIsssueIds?: string[]
    ): ChatMessage {
        return new ChatMessage({
            sessionId,
            role: MessageRole.USER,
            content: question,
            question,
            contextType,
            relatedIsssueIds
        });
    }

    static createAssistantMessage(
        sessionId: string,
        answer: string,
        sources?: MessageSource[],
        confidence?: number,
        responceTime?: number
    ): ChatMessage {
        return new ChatMessage({
            sessionId,
            role: MessageRole.ASSISTANT,
            content: answer,
            answer,
            sources,
            confidence,
            responceTime
        });
    }

    static createSystemMessage(
        sessionId: string,
        content: string
    ): ChatMessage {
        return new ChatMessage({
            sessionId,
            role: MessageRole.SYSTEM,
            content,
            contextType: ContextType.GENERAL
        });
    }

    static createPair(
        sessionId: string,
        question: string,
        answer: string,
        sources?: MessageSource[],
        confidence?: number
    ): [ChatMessage, ChatMessage] {
        const userMsg = ChatMessage.createUserMessage(sessionId, question);
        const assistantMsg = ChatMessage.createAssistantMessage(
            sessionId,
            answer,
            sources,
            confidence
        );

        assistantMsg.parentMessageId = userMsg.messageId;

        return [userMsg, assistantMsg];
    }
}

export class ChatHistory {
    sessionId: string;
    messages: ChatMessage[];
    createdAt: Date;
    updatedAt: Date;

    constructor(sessionId: string) {
        this.sessionId = sessionId;
        this.messages = [];
        this.createdAt = new Date();
        this.updatedAt = new Date();
    }
    
    addMessage(message: ChatMessage): void {
        if(message.sessionId !== this.sessionId) {
            throw new Error('Message sessionId does not match history session ID');
        }

        if(!message.validate()) {
            throw new Error('Invalid message: missing required fields');
        }

        this.messages.push(message);
        this.updatedAt = new Date();
    }
    
    addMessages(messages: ChatMessage[]): void {
        messages.forEach(msg => this.addMessage(msg));
    }

    getAllMessages(): ChatMessage[] {
        return [...this.messages];
    }

    getMessagesByRole(role: MessageRole): ChatMessage[] {
        return this.messages.filter(msg => msg.role === role);
    }

    getUserQuestions(): ChatMessage[] {
        return this.getMessagesByRole(MessageRole.USER);
    }

    getAssistantResponses(): ChatMessage[] {
        return this.getMessagesByRole(MessageRole.ASSISTANT);
    }

    getSystemMessages(): ChatMessage[] {
        return this.getMessagesByRole(MessageRole.SYSTEM);
    }

    getLastMessages(n: number): ChatMessage[] {
        return this.messages.slice(-n);
    }

    getFirstMessages(n: number): ChatMessage[] {
        return this.messages.slice(0, n);
    }

    getMessageByContext(contextType: ContextType): ChatMessage[] {
        return this.messages.filter(msg => msg.contextType === contextType);
    }

    getMessageByIssueId(issueId: string): ChatMessage[] {
        return this.messages.filter(msg => 
            msg.relatedIsssueIds?.includes(issueId)
        );
    }

    getMessageById(messageId: string): ChatMessage | null {
        return this.messages.find(msg => msg.messageId === messageId) || null;
    }

    getMessageCount(): number {
        return this.messages.length;
    }

    getCountByRole(role: MessageRole): number {
        return this.getMessagesByRole(role).length;
    }

    isEmpty(): boolean {
        return this.messages.length === 0;
    }

    clear(): void {
        this.messages = [];
        this.updatedAt = new Date();
    }

    removeMessageById(messageId: string): boolean {
        const index = this.messages.findIndex(msg => msg.messageId === messageId);
        if (index !== -1) {
            this.messages.splice(index, 1);
            this.updatedAt = new Date();
            return true;
        }
        return false;
    }

    removeLastMessages(n: number): void {
        this.messages.slice(0 , -n);
        this.updatedAt = new Date();
    }

    getQAPairs(): Array<{
        question: string;
        answer: string;
        timestamp: Date;
        questionId: string;
        answerId: string;
        sources?: MessageSource[];
        confidence?: number;
    }> {
        const pairs: Array<any> = [];

        for (let i = 0; i < this.messages.length - 1; i++) {
            const current = this.messages[i];
            const next = this.messages[i + 1];

            if(current.isUserMessage() && next.isAssistantMessage()) {
                pairs.push({
                    question: current.question || current.content,
                    answer: next.answer || next.content,
                    timestamp: current.timestamp,
                    questionId: current.messageId,
                    answerId: next.messageId,
                    sources: next.sources,
                    confidence: next.confidence
                });
            }
        }
        return pairs;    
    }

    getMessageInRange(startTime: Date, endTime: Date): ChatMessage[] {
        return this.messages.filter(msg => 
            msg.timestamp >= startTime && msg.timestamp <= endTime
        );
    }

    getTotalDuration(): number {
        if (this.messages.length === 0) return 0;

        const first = this.messages[0].timestamp;
        const last = this.messages[this.messages.length - 1].timestamp;

        return last.getTime() - first.getTime();
    }

    getAverageResponseTime(): number | null {
        const responseTimes = this.messages
            .filter(msg => msg.responceTime !== undefined)
            .map(msg => msg.responceTime!);

        if (responseTimes.length === 0) return null;

        const sum = responseTimes.reduce((a, b) => a + b, 0);
        return sum / responseTimes.length;
    }

    getStatistics(): {
        totalMessages: number;
        userMessages: number;
        assistantMessages: number;
        systemMessages: number;
        qaPairs: number;
        averageResponseTime: number | null;
        totalDuration: number;
        messagesWithSources: number;
        averageConfidence: number | null;
    } {
        const messagesWithSources = this.messages.filter(msg => msg.hasSources()).length;

        const confidences = this.messages
            .filter(msg => msg.confidence !== undefined)
            .map(msg => msg.confidence!);

        const averageConfidence = confidences.length > 0
            ? confidences.reduce((a, b) => a + b, 0) / confidences.length
            : null;

        return {
            totalMessages: this.getMessageCount(),
            userMessages: this.getCountByRole(MessageRole.USER),
            assistantMessages: this.getCountByRole(MessageRole.ASSISTANT),
            systemMessages: this.getCountByRole(MessageRole.SYSTEM),
            qaPairs: this.getQAPairs().length,
            averageResponseTime: this.getAverageResponseTime(),
            totalDuration: this.getTotalDuration(),
            messagesWithSources,
            averageConfidence
        };
    }

    ToMarkdown(): string {
        let markdown = `# Chat History for Session ${this.sessionId}\n\n`;
        markdown += `**Created At:** ${this.createdAt.toLocaleString()}\n\n`;
        markdown += `**Updated At:** ${this.updatedAt.toLocaleString()}\n\n`;
        markdown += `**Total Messages:** ${this.getMessageCount()}\n\n`;
        markdown += `---\n\n`;

        this.messages.forEach((msg: ChatMessage, index: number) => {
            const roleEmoji = {
                [MessageRole.USER]: '👤',
                [MessageRole.ASSISTANT]: '🤖',
                [MessageRole.SYSTEM]: '⚙️'
            };

        markdown += `## ${roleEmoji[msg.role]} Message ${index + 1}\n\n`;
        markdown += `**Time:** ${msg.getFormattedTimestamp()}\n\n`;
        markdown += `${msg.content}\n\n`;

        if(msg.hasSources()) {
            markdown += `**Sources:**\n`;
            msg.sources!.forEach((source: MessageSource, srcIndex: number): void => {
                const title: string = source.title ?? 'Source';
                markdown += `${srcIndex + 1}. ${title}\n`;
            });
            markdown += `\n`;
        }

        markdown += `---\n\n`;
        });
    
        return markdown;
    }

    toJson(): any {
        return {
            sessionId: this.sessionId,
            createdAt: this.createdAt.toISOString(),
            updatedAt: this.updatedAt.toISOString(),
            messages: this.messages.map(msg => msg.toJSON()),
            messageCount: this.getMessageCount(),
            statistics: this.getStatistics()
        };
    }

    static fromJSON(json: any): ChatHistory {
        const history = new ChatHistory(json.sessionId);
        history.createdAt = new Date(json.createdAt);
        history.updatedAt = new Date(json.updatedAt);
        history.messages = json.messages.map((msgJson: any) => ChatMessage.fromJSON(msgJson));
        return history;
    }
}