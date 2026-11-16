package com.knowledgeassist.rag;

import com.knowledgeassist.chunking.TokenAwareChunker;
import com.knowledgeassist.config.RagProperties;
import com.knowledgeassist.extraction.TextExtractorService.ExtractedPage;
import com.knowledgeassist.vector.VectorRetrievalRepository.RetrievedChunk;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class CoreRagUnitTests {

    @Test
    void chunkerPreservesPageNumbersAndOverlapWithoutEmptyChunks() {
        RagProperties props = new RagProperties(80, 20, 5, 0.25, "text-embedding-3-small", 1536, 6);
        TokenAwareChunker chunker = new TokenAwareChunker(props);

        String longText = "Policy section one discusses annual leave accrual and carryover rules for all employees.\n\n"
                + "Policy section two details parental leave eligibility of sixteen weeks fully paid leave.\n\n"
                + "Policy section three covers meal allowances during domestic and international travel.";

        var chunks = chunker.chunk(List.of(new ExtractedPage(4, "Benefits", longText)));
        assertFalse(chunks.isEmpty());
        assertEquals(4, chunks.get(0).pageNumber());
        assertTrue(chunks.stream().noneMatch(c -> c.text().isBlank()));
    }

    @Test
    void citationValidatorRejectsFabricatedChunkIds() {
        CitationValidator validator = new CitationValidator();
        UUID validChunkId = UUID.randomUUID();
        UUID docId = UUID.randomUUID();

        RetrievedChunk realChunk = new RetrievedChunk(
                validChunkId, docId, "Employee_Handbook.pdf", 1, 12, "Leave",
                "Employees receive 22 PTO days annually.", 0.85, 0.6, 0.76);

        var verified = validator.resolveAndVerify(
                List.of(validChunkId.toString(), UUID.randomUUID().toString()),
                List.of(realChunk));

        assertEquals(1, verified.size());
        assertEquals(validChunkId, verified.get(0).chunkId());
        assertEquals("Employee_Handbook.pdf", verified.get(0).documentName());
    }
}
