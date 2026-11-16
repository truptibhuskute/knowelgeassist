import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileText, Lock, ShieldCheck } from 'lucide-react';
import { apiClient, extractApiErrorMessage } from '../api/client';
import { AppLayout } from '../layouts/AppLayout';
import type { DocumentChunkItem, DocumentItem, DocumentVersion } from '../types/api';

export function DocumentViewerPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const highlightedChunkId = searchParams.get('chunkId');

  const { data, isLoading, error } = useQuery({
    queryKey: ['document-chunks', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const [chunksRes, versionsRes] = await Promise.all([
        apiClient.get<{ document: DocumentItem; chunks: DocumentChunkItem[] }>(
          `/documents/${id}/chunks`
        ),
        apiClient.get<{ versions: DocumentVersion[] }>(`/documents/${id}/versions`),
      ]);
      return {
        document: chunksRes.data.document,
        chunks: chunksRes.data.chunks,
        versions: versionsRes.data.versions,
      };
    },
  });

  return (
    <AppLayout
      title={data?.document.name || 'Document Source Viewer'}
      breadcrumb="Workspace / Document Viewer"
      primaryAction={
        <Link
          to="/chat"
          className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 whitespace-nowrap shrink-0"
        >
          Ask About Document
        </Link>
      }
    >
      {isLoading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-500">
          Loading document source...
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-sm text-red-800">
          {extractApiErrorMessage(error)}
        </div>
      ) : data ? (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-blue-700" />
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{data.document.name}</h2>
                  <div className="text-xs text-slate-500 mt-0.5 font-mono">
                    {data.document.originalFilename} · {data.document.fileType} · v
                    {data.document.currentVersion}
                  </div>
                </div>
              </div>

              <Link
                to="/"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to Workspace</span>
              </Link>
            </div>

            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <div className="text-slate-500">Access Scope</div>
                <div className="mt-1 font-semibold text-slate-900 flex items-center gap-1.5">
                  {data.document.accessScope === 'RESTRICTED' ? (
                    <Lock className="w-3.5 h-3.5 text-amber-600" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5 text-green-600" />
                  )}
                  <span>
                    {data.document.accessScope}
                    {data.document.departmentName ? ` (${data.document.departmentName})` : ''}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-slate-500">Status & Chunks</div>
                <div className="mt-1 font-semibold font-mono tabular-nums text-slate-900">
                  {data.document.status} · {data.chunks.length} chunks
                </div>
              </div>
              <div>
                <div className="text-slate-500">Owner</div>
                <div className="mt-1 font-semibold text-slate-900">{data.document.ownerName}</div>
              </div>
              <div>
                <div className="text-slate-500">SHA-256 Checksum</div>
                <div className="mt-1 font-mono text-slate-700 truncate">
                  {data.document.checksumSha256.slice(0, 16)}...
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <section className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="pb-3 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Indexed Source Passages
                </h3>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  {data.chunks.length} passages
                </span>
              </div>

              <div className="space-y-3">
                {data.chunks.map((chunk) => {
                  const isHighlighted = chunk.id === highlightedChunkId;
                  return (
                    <div
                      key={chunk.id}
                      className={`p-4 rounded-lg border ${
                        isHighlighted
                          ? 'border-blue-600 bg-blue-50/60'
                          : 'border-slate-200 bg-slate-50/40'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-200/70 text-xs text-slate-500">
                        <span className="font-mono tabular-nums font-medium text-slate-700">
                          Chunk #{chunk.chunk_index + 1} · Page {chunk.page_number}
                          {chunk.section_title ? ` · ${chunk.section_title}` : ''}
                        </span>
                        <span className="font-mono tabular-nums">
                          {chunk.token_count} tokens
                          {isHighlighted ? ' · Cited Passage' : ''}
                        </span>
                      </div>
                      <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                        {chunk.chunk_text}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="bg-white border border-slate-200 rounded-xl p-6">
              <h3 className="text-sm font-semibold text-slate-900 pb-3 border-b border-slate-100">
                Version History ({data.versions.length})
              </h3>
              <div className="mt-3 divide-y divide-slate-100">
                {data.versions.map((ver) => (
                  <div key={ver.id} className="py-3 text-xs space-y-1">
                    <div className="flex items-center justify-between font-semibold text-slate-900">
                      <span className="font-mono tabular-nums">Version {ver.version_number}</span>
                      <span className="font-mono tabular-nums text-slate-500">
                        {(ver.file_size_bytes / 1024).toFixed(1)} KB
                      </span>
                    </div>
                    <div className="text-slate-600">{ver.change_note || 'Document upload'}</div>
                    <div className="text-slate-400 font-mono">
                      By {ver.uploaded_by_name} · {new Date(ver.created_at).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </AppLayout>
  );
}
