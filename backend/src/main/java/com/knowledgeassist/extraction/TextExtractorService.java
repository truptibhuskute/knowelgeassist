package com.knowledgeassist.extraction;

import org.apache.tika.Tika;
import org.apache.tika.metadata.Metadata;
import org.apache.tika.parser.AutoDetectParser;
import org.apache.tika.sax.BodyContentHandler;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.List;

@Service
public class TextExtractorService {

    public record ExtractedPage(int pageNumber, String sectionTitle, String text) {}

    private final Tika tika = new Tika();

    public String detectMimeType(byte[] content, String filename) {
        return tika.detect(content, filename);
    }

    public List<ExtractedPage> extractPages(byte[] content, String fileType) {
        try {
            BodyContentHandler handler = new BodyContentHandler(-1);
            Metadata metadata = new Metadata();
            new AutoDetectParser().parse(new ByteArrayInputStream(content), handler, metadata);
            String cleaned = cleanText(handler.toString());
            if (cleaned.isBlank()) {
                return List.of();
            }

            List<ExtractedPage> pages = new ArrayList<>();
            String[] lines = cleaned.split("\n");
            StringBuilder buffer = new StringBuilder();
            int page = 1;
            int lineCount = 0;

            for (String line : lines) {
                buffer.append(line).append('\n');
                lineCount++;
                if (lineCount >= 45) {
                    String pageText = buffer.toString().trim();
                    if (!pageText.isEmpty()) {
                        pages.add(new ExtractedPage(page++, null, pageText));
                    }
                    buffer.setLength(0);
                    lineCount = 0;
                }
            }
            String rem = buffer.toString().trim();
            if (!rem.isEmpty()) {
                pages.add(new ExtractedPage(page, null, rem));
            }
            return pages;
        } catch (Exception ex) {
            throw new IllegalStateException("Failed to extract text from " + fileType + " document", ex);
        }
    }

    private String cleanText(String raw) {
        return raw.replace("\r\n", "\n")
                .replace("\u0000", "")
                .replaceAll("[ \\t]+\\n", "\n")
                .replaceAll("\\n{3,}", "\n\n")
                .trim();
    }
}
