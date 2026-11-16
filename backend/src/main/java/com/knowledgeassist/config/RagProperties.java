package com.knowledgeassist.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "knowledgeassist.rag")
public record RagProperties(
        int chunkSizeTokens,
        int chunkOverlapTokens,
        int topK,
        double similarityThreshold,
        String embeddingModel,
        int embeddingDimensions,
        int maxHistoryTurns
) {
}
