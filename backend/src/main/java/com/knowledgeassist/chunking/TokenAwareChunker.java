package com.knowledgeassist.chunking;

import com.knowledgeassist.config.RagProperties;
import com.knowledgeassist.extraction.TextExtractorService.ExtractedPage;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
public class TokenAwareChunker {

    public record TextChunk(int chunkIndex, int pageNumber, String sectionTitle, String text, int tokenCount) {}

    private final RagProperties ragProperties;

    public TokenAwareChunker(RagProperties ragProperties) {
        this.ragProperties = ragProperties;
    }

    public int estimateTokens(String text) {
        if (text == null || text.isBlank()) return 0;
        String[] words = text.trim().split("\\s+");
        return Math.max(1, (int) Math.ceil(words.length * 1.3));
    }

    public List<TextChunk> chunk(List<ExtractedPage> pages) {
        int maxTokens = Math.max(100, ragProperties.chunkSizeTokens());
        int overlapTokens = Math.min(ragProperties.chunkOverlapTokens(), (int) (maxTokens * 0.4));

        List<TextChunk> chunks = new ArrayList<>();
        List<Unit> currentUnits = new ArrayList<>();
        int currentTokenSum = 0;
        int chunkIndex = 0;

        for (ExtractedPage page : pages) {
            String[] paragraphs = page.text().split("\\n{2,}");
            for (String para : paragraphs) {
                String trimmed = para.trim();
                if (trimmed.isEmpty()) continue;
                int tokens = estimateTokens(trimmed);

                if (currentTokenSum + tokens > maxTokens && !currentUnits.isEmpty()) {
                    chunkIndex = flushChunk(chunks, currentUnits, chunkIndex, overlapTokens);
                    currentTokenSum = currentUnits.stream().mapToInt(Unit::tokens).sum();
                }
                currentUnits.add(new Unit(trimmed, page.pageNumber(), page.sectionTitle(), tokens));
                currentTokenSum += tokens;
            }
        }

        if (!currentUnits.isEmpty()) {
            String combined = String.join("\n\n", currentUnits.stream().map(Unit::text).toList()).trim();
            if (!combined.isEmpty() && (chunks.isEmpty() || !chunks.get(chunks.size() - 1).text().equals(combined))) {
                Unit first = currentUnits.get(0);
                chunks.add(new TextChunk(chunkIndex, first.pageNumber(), first.sectionTitle(), combined, estimateTokens(combined)));
            }
        }
        return chunks;
    }

    private int flushChunk(List<TextChunk> chunks, List<Unit> currentUnits, int chunkIndex, int overlapTokens) {
        String combined = String.join("\n\n", currentUnits.stream().map(Unit::text).toList()).trim();
        if (!combined.isEmpty()) {
            Unit first = currentUnits.get(0);
            chunks.add(new TextChunk(chunkIndex++, first.pageNumber(), first.sectionTitle(), combined, estimateTokens(combined)));
        }

        List<Unit> kept = new ArrayList<>();
        int keptTokens = 0;
        for (int i = currentUnits.size() - 1; i >= 0; i--) {
            Unit u = currentUnits.get(i);
            if (keptTokens + u.tokens() <= overlapTokens || kept.isEmpty()) {
                kept.add(0, u);
                keptTokens += u.tokens();
            } else {
                break;
            }
        }
        currentUnits.clear();
        currentUnits.addAll(kept);
        return chunkIndex;
    }

    private record Unit(String text, int pageNumber, String sectionTitle, int tokens) {}
}
