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

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  roles: RoleName[];
  departmentIds: string[];
  departments?: Array<{ id: string; name: string; description: string | null }>;
  createdAt?: string;
}

export interface AuthResponse {
  user: UserProfile;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface Department {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  memberCount: number;
}

export interface DocumentItem {
  id: string;
  name: string;
  originalFilename: string;
  mimeType: string;
  fileType: string;
  fileSizeBytes: number;
  checksumSha256: string;
  ownerId: string;
  ownerName: string;
  departmentId: string | null;
  departmentName: string | null;
  accessScope: AccessScope;
  status: DocumentStatus;
  currentVersion: number;
  chunkCount: number;
  processingError: string | null;
  createdAt: string;
  processedAt: string | null;
  updatedAt: string;
}

export interface DocumentVersion {
  id: string;
  version_number: number;
  original_filename: string;
  file_size_bytes: number;
  checksum_sha256: string;
  change_note: string | null;
  created_at: string;
  uploaded_by_name: string;
}

export interface DocumentChunkItem {
  id: string;
  chunk_index: number;
  page_number: number;
  section_title: string | null;
  chunk_text: string;
  token_count: number;
  embedding_model: string;
}

export interface Citation {
  documentId: string;
  documentName: string;
  documentVersion: number;
  pageNumber: number;
  chunkId: string;
  excerpt: string;
}

export interface ChatResponse {
  conversationId: string;
  messageId: string;
  answer: string;
  confidence: ConfidenceLevel;
  citations: Citation[];
  followUpQuestions: string[];
  retrievalMetadata: {
    retrievedChunkCount: number;
    model: string;
    grounded: boolean;
    abstained: boolean;
    totalLatencyMs: number;
  };
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationMessage {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  confidence: ConfidenceLevel | null;
  citations: Citation[];
  followUpQuestions: string[];
  retrievalMetadata: ChatResponse['retrievalMetadata'] | null;
  createdAt: string;
}

export interface AnalyticsSummary {
  queries: {
    total: number;
    successful: number;
    abstained: number;
    failed: number;
    retrievalHitRate: number;
    avgTotalLatencyMs: number;
    avgRetrievalLatencyMs: number;
    avgEmbeddingLatencyMs: number;
    avgLlmLatencyMs: number;
    totalTokens: number;
    confidenceBreakdown: {
      HIGH: number;
      MEDIUM: number;
      LOW: number;
    };
  };
  documents: {
    totalActive: number;
    indexed: number;
    processing: number;
    failed: number;
    totalChunks: number;
  };
  ingestion: {
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
    avgDurationMs: number;
  };
  feedback: {
    total: number;
    thumbsUp: number;
    thumbsDown: number;
  };
}

export interface IngestionJobItem {
  id: string;
  document_id: string;
  document_name: string;
  file_type: string;
  document_version: number;
  status: string;
  attempt_count: number;
  duration_ms: number | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface AuditLogItem {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details_json: string | null;
  correlation_id: string | null;
  ip_address: string | null;
  created_at: string;
}
