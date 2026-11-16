import crypto from 'node:crypto';
import path from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { HttpError } from '../security/authService.js';

export interface ExtractedPage {
  pageNumber: number;
  sectionTitle: string | null;
  text: string;
}

export interface ExtractionResult {
  fileType: 'PDF' | 'DOCX' | 'TXT' | 'MARKDOWN';
  pages: ExtractedPage[];
  fullTextLength: number;
}

const EXTENSION_TO_TYPE: Record<string, 'PDF' | 'DOCX' | 'TXT' | 'MARKDOWN'> = {
  '.pdf': 'PDF',
  '.docx': 'DOCX',
  '.txt': 'TXT',
  '.md': 'MARKDOWN',
  '.markdown': 'MARKDOWN',
};

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/octet-stream', // some browsers send this for .md
]);

export function sanitizeFilename(originalFilename: string): string {
  const base = path.basename(originalFilename || 'document.txt');
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 140);
  return cleaned || 'document.txt';
}

export function detectAndValidateFileType(
  originalFilename: string,
  mimeType: string
): 'PDF' | 'DOCX' | 'TXT' | 'MARKDOWN' {
  const ext = path.extname(originalFilename).toLowerCase();
  const fileType = EXTENSION_TO_TYPE[ext];
  if (!fileType) {
    throw new HttpError(
      400,
      'UNSUPPORTED_FILE_TYPE',
      'Only PDF, DOCX, TXT, and Markdown (.md) files are supported.'
    );
  }
  if (mimeType && !ALLOWED_MIMES.has(mimeType.toLowerCase())) {
    throw new HttpError(400, 'INVALID_MIME_TYPE', `Unsupported MIME type: ${mimeType}`);
  }
  return fileType;
}

export function computeSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function cleanText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractSectionsAndPagesFromPlaintext(
  rawText: string,
  isMarkdown: boolean
): ExtractedPage[] {
  const cleaned = cleanText(rawText);
  if (!cleaned) return [];

  const lines = cleaned.split('\n');
  const pages: ExtractedPage[] = [];
  const LINES_PER_SYNTHETIC_PAGE = 45;
  let currentHeading: string | null = null;
  let currentBuffer: string[] = [];
  let pageNum = 1;

  for (const line of lines) {
    if (isMarkdown) {
      const headingMatch = line.match(/^#{1,4}\s+(.+)$/);
      if (headingMatch) {
        currentHeading = headingMatch[1].trim();
      }
    } else if (/^([0-9]+\.\s+[A-Z].{2,60}|[A-Z][A-Z0-9\s]{4,50})$/.test(line.trim())) {
      currentHeading = line.trim();
    }

    currentBuffer.push(line);
    if (currentBuffer.length >= LINES_PER_SYNTHETIC_PAGE) {
      const text = cleanText(currentBuffer.join('\n'));
      if (text) {
        pages.push({ pageNumber: pageNum, sectionTitle: currentHeading, text });
        pageNum += 1;
      }
      currentBuffer = [];
    }
  }

  if (currentBuffer.length > 0) {
    const text = cleanText(currentBuffer.join('\n'));
    if (text) {
      pages.push({ pageNumber: pageNum, sectionTitle: currentHeading, text });
    }
  }

  return pages;
}

export async function extractDocumentText(
  buffer: Buffer,
  fileType: 'PDF' | 'DOCX' | 'TXT' | 'MARKDOWN'
): Promise<ExtractionResult> {
  let pages: ExtractedPage[] = [];

  if (fileType === 'PDF') {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      if (result.pages && result.pages.length > 0) {
        pages = result.pages
          .map((p) => ({
            pageNumber: p.num,
            sectionTitle: null,
            text: cleanText(p.text || ''),
          }))
          .filter((p) => p.text.length > 0);
      } else {
        const fallbackText = cleanText(result.text || '');
        if (fallbackText) {
          pages = [{ pageNumber: 1, sectionTitle: null, text: fallbackText }];
        }
      }
    } finally {
      await parser.destroy();
    }
  } else if (fileType === 'DOCX') {
    const result = await mammoth.extractRawText({ buffer });
    pages = extractSectionsAndPagesFromPlaintext(result.value || '', false);
  } else if (fileType === 'MARKDOWN') {
    pages = extractSectionsAndPagesFromPlaintext(buffer.toString('utf8'), true);
  } else {
    pages = extractSectionsAndPagesFromPlaintext(buffer.toString('utf8'), false);
  }

  const fullTextLength = pages.reduce((sum, p) => sum + p.text.length, 0);
  if (fullTextLength === 0) {
    throw new HttpError(422, 'EMPTY_DOCUMENT', 'No extractable text found in the uploaded document.');
  }

  return { fileType, pages, fullTextLength };
}
