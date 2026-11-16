package com.knowledgeassist.rag;

import com.knowledgeassist.vector.VectorRetrievalRepository.RetrievedChunk;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class CitationValidator {

    public record VerifiedCitation(
            UUID documentId,
            String documentName,
            int documentVersion,
            int pageNumber,
            UUID chunkId,
            String excerpt
    ) {}

    public List<VerifiedCitation> resolveAndVerify(
            List<String> llmCitedChunkIds, List<RetrievedChunk> authorizedChunks) {
        Map<String, RetrievedChunk> allowedById = new HashMap<>();
        for (RetrievedChunk chunk : authorizedChunks) {
            allowedById.put(chunk.chunkId().toString(), chunk);
        }

        List<VerifiedCitation> verified = new ArrayList<>();
        Set<UUID> seen = new HashSet<>();
        for (String rawId : llmCitedChunkIds) {
            RetrievedChunk match = allowedById.get(rawId);
            if (match != null && seen.add(match.chunkId())) {
                String excerpt = match.chunkText().length() > 360
                        ? match.chunkText().substring(0, 357) + "..."
                        : match.chunkText();
                verified.add(new VerifiedCitation(
                        match.documentId(),
                        match.documentName(),
                        match.documentVersion(),
                        match.pageNumber(),
                        match.chunkId(),
                        excerpt
                ));
            }
        }
        return verified;
    }
}
