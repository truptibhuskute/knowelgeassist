export type RoleName = 'EMPLOYEE' | 'KNOWLEDGE_OWNER' | 'ADMIN';

export type AccessScope = 'ALL_EMPLOYEES' | 'DEPARTMENT' | 'RESTRICTED';

export type DocumentStatus =
  | 'UPLOADED'
  | 'PROCESSING'
  | 'INDEXED'
  | 'FAILED'
  | 'DELETING'
  | 'DELETED';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  roles: RoleName[];
  departmentIds: string[];
}

export interface CitationDto {
  documentId: string;
  documentName: string;
  documentVersion: number;
  pageNumber: number;
  chunkId: string;
  excerpt: string;
}

export interface ChatResponseDto {
  conversationId: string;
  messageId: string;
  answer: string;
  confidence: ConfidenceLevel;
  citations: CitationDto[];
  followUpQuestions: string[];
  retrievalMetadata: {
    retrievedChunkCount: number;
    model: string;
    grounded: boolean;
    abstained: boolean;
    totalLatencyMs: number;
  };
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  documentVersion: number;
  pageNumber: number;
  sectionTitle: string | null;
  chunkText: string;
  semanticScore: number;
  keywordScore: number;
  hybridScore: number;
}
