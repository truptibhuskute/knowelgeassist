package com.knowledgeassist.rag;

import com.knowledgeassist.rag.CitationValidator.VerifiedCitation;
import com.knowledgeassist.vector.VectorRetrievalRepository.RetrievedChunk;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class ConfidenceCalculator {

    public enum ConfidenceLevel { HIGH, MEDIUM, LOW }

    public ConfidenceLevel calculate(
            List<RetrievedChunk> chunks, List<VerifiedCitation> citations, boolean abstained) {
        if (abstained || chunks.isEmpty() || citations.isEmpty()) {
            return ConfidenceLevel.LOW;
        }
        double topScore = chunks.get(0).hybridScore();
        double meanScore = chunks.stream().mapToDouble(RetrievedChunk::hybridScore).average().orElse(0.0);
        if (topScore >= 0.55 && (citations.size() >= 2 || meanScore >= 0.42)) {
            return ConfidenceLevel.HIGH;
        }
        if (topScore >= 0.32) {
            return ConfidenceLevel.MEDIUM;
        }
        return ConfidenceLevel.LOW;
    }
}
