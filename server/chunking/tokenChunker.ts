import { config } from '../config.js';
import type { ExtractedPage } from '../extraction/textExtractor.js';

export interface TextChunk {
  chunkIndex: number;
  pageNumber: number;
  sectionTitle: string | null;
  text: string;
  tokenCount: number;
}

/**
 * Approximates token count using standard BPE word/punctuation heuristic (~1.3 tokens per word).
 */
export function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  return Math.max(1, Math.ceil(words.length * 1.3));
}

function splitIntoParagraphOrSentenceUnits(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const units: string[] = [];

  for (const para of paragraphs) {
    if (estimateTokens(para) <= 220) {
      units.push(para);
    } else {
      const sentences = para.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
      for (const s of sentences) {
        units.push(s);
      }
    }
  }
  return units;
}

export function chunkExtractedPages(
  pages: ExtractedPage[],
  options?: { chunkSizeTokens?: number; overlapTokens?: number }
): TextChunk[] {
  const maxTokens = options?.chunkSizeTokens ?? config.rag.chunkSizeTokens;
  const overlapTokens = Math.min(
    options?.overlapTokens ?? config.rag.chunkOverlapTokens,
    Math.floor(maxTokens * 0.4)
  );

  const chunks: TextChunk[] = [];
  let chunkIndex = 0;

  let currentUnits: Array<{ text: string; pageNumber: number; sectionTitle: string | null; tokens: number }> = [];
  let currentTokenSum = 0;

  const flushChunk = () => {
    if (currentUnits.length === 0) return;
    const combinedText = currentUnits.map((u) => u.text).join('\n\n').trim();
    if (!combinedText) return;

    const firstUnit = currentUnits[0];
    chunks.push({
      chunkIndex,
      pageNumber: firstUnit.pageNumber,
      sectionTitle: firstUnit.sectionTitle,
      text: combinedText,
      tokenCount: estimateTokens(combinedText),
    });
    chunkIndex += 1;

    // Keep trailing units up to overlapTokens
    if (overlapTokens > 0) {
      const kept: typeof currentUnits = [];
      let keptTokens = 0;
      for (let i = currentUnits.length - 1; i >= 0; i -= 1) {
        const unit = currentUnits[i];
        if (keptTokens + unit.tokens <= overlapTokens || kept.length === 0) {
          kept.unshift(unit);
          keptTokens += unit.tokens;
        } else {
          break;
        }
      }
      currentUnits = kept;
      currentTokenSum = keptTokens;
    } else {
      currentUnits = [];
      currentTokenSum = 0;
    }
  };

  for (const page of pages) {
    const units = splitIntoParagraphOrSentenceUnits(page.text);
    for (const unitText of units) {
      const unitTokens = estimateTokens(unitText);
      if (unitTokens === 0) continue;

      if (currentTokenSum + unitTokens > maxTokens && currentUnits.length > 0) {
        flushChunk();
      }

      // If single unit itself exceeds maxTokens, split by words safely
      if (unitTokens > maxTokens) {
        const words = unitText.split(/\s+/);
        const wordsPerChunk = Math.max(40, Math.floor(maxTokens / 1.3));
        const overlapWords = Math.max(10, Math.floor(overlapTokens / 1.3));
        for (let i = 0; i < words.length; i += Math.max(1, wordsPerChunk - overlapWords)) {
          const sliceText = words.slice(i, i + wordsPerChunk).join(' ').trim();
          if (!sliceText) continue;
          chunks.push({
            chunkIndex,
            pageNumber: page.pageNumber,
            sectionTitle: page.sectionTitle,
            text: sliceText,
            tokenCount: estimateTokens(sliceText),
          });
          chunkIndex += 1;
          if (i + wordsPerChunk >= words.length) break;
        }
        currentUnits = [];
        currentTokenSum = 0;
        continue;
      }

      currentUnits.push({
        text: unitText,
        pageNumber: page.pageNumber,
        sectionTitle: page.sectionTitle,
        tokens: unitTokens,
      });
      currentTokenSum += unitTokens;
    }
  }

  // Flush remaining non-duplicate tail
  if (currentUnits.length > 0) {
    const combinedText = currentUnits.map((u) => u.text).join('\n\n').trim();
    const lastChunk = chunks[chunks.length - 1];
    if (combinedText && (!lastChunk || lastChunk.text !== combinedText)) {
      chunks.push({
        chunkIndex,
        pageNumber: currentUnits[0].pageNumber,
        sectionTitle: currentUnits[0].sectionTitle,
        text: combinedText,
        tokenCount: estimateTokens(combinedText),
      });
    }
  }

  return chunks;
}
