import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, RefreshCw } from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { AppLayout } from '../layouts/AppLayout';
import type { AnalyticsSummary, AuditLogItem, IngestionJobItem } from '../types/api';

export function AdminDashboardPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('ADMIN');
  const queryClient = useQueryClient();

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['admin-analytics'],
    queryFn: async () => {
      const res = await apiClient.get<AnalyticsSummary>('/admin/analytics');
      return res.data;
    },
  });

  const { data: jobs } = useQuery({
    queryKey: ['admin-ingestion-jobs'],
    queryFn: async () => {
      const res = await apiClient.get<{ jobs: IngestionJobItem[] }>('/admin/ingestion-jobs');
      return res.data.jobs;
    },
  });

  const { data: auditLogs } = useQuery({
    queryKey: ['admin-audit-logs'],
    enabled: isAdmin,
    queryFn: async () => {
      const res = await apiClient.get<{ logs: AuditLogItem[] }>('/admin/audit-logs?limit=25');
      return res.data.logs;
    },
  });

  const retryMutation = useMutation({
    mutationFn: async (jobId: string) => {
      await apiClient.post(`/admin/ingestion-jobs/${jobId}/retry?sync=true`);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-ingestion-jobs'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-analytics'] }),
      ]);
    },
  });

  return (
    <AppLayout
      title="Enterprise Analytics & Operations"
      breadcrumb="Administration / Analytics & Jobs"
      primaryAction={
        <Link
          to="/admin/documents"
          className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 whitespace-nowrap shrink-0"
        >
          Manage Documents
        </Link>
      }
    >
      <div className="space-y-8">
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500">Total RAG Queries</div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {analyticsLoading ? '—' : analytics?.queries.total ?? 0}
            </div>
            <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
              {analytics?.queries.successful ?? 0} answered · {analytics?.queries.abstained ?? 0} abstained
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500">Retrieval Hit Rate</div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {analyticsLoading
                ? '—'
                : `${Math.round((analytics?.queries.retrievalHitRate ?? 0) * 100)}%`}
            </div>
            <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
              Avg latency: {analytics?.queries.avgTotalLatencyMs ?? 0} ms
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500">Indexed Documents</div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {analyticsLoading ? '—' : analytics?.documents.indexed ?? 0}
            </div>
            <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
              {analytics?.documents.totalChunks ?? 0} vector chunks · {analytics?.documents.failed ?? 0} failed
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500">User Feedback</div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {analyticsLoading
                ? '—'
                : `${analytics?.feedback.thumbsUp ?? 0} / ${analytics?.feedback.total ?? 0}`}
            </div>
            <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
              Positive ratings · {analytics?.queries.totalTokens ?? 0} tokens used
            </div>
          </div>
        </section>

        {analytics && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <h2 className="text-sm font-semibold text-slate-900 pb-3 border-b border-slate-100">
                Confidence Distribution & Pipeline Latency
              </h2>
              <div className="mt-4 grid grid-cols-3 gap-4 text-xs">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-slate-500">High Confidence</div>
                  <div className="mt-1 text-lg font-bold font-mono tabular-nums text-green-700">
                    {analytics.queries.confidenceBreakdown.HIGH}
                  </div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-slate-500">Medium Confidence</div>
                  <div className="mt-1 text-lg font-bold font-mono tabular-nums text-amber-700">
                    {analytics.queries.confidenceBreakdown.MEDIUM}
                  </div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-slate-500">Low / Abstained</div>
                  <div className="mt-1 text-lg font-bold font-mono tabular-nums text-red-700">
                    {analytics.queries.confidenceBreakdown.LOW}
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-3 gap-4 text-xs">
                <div>
                  <div className="text-slate-500">Avg Embedding</div>
                  <div className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900">
                    {analytics.queries.avgEmbeddingLatencyMs} ms
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Avg Vector Retrieval</div>
                  <div className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900">
                    {analytics.queries.avgRetrievalLatencyMs} ms
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Avg LLM Synthesis</div>
                  <div className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900">
                    {analytics.queries.avgLlmLatencyMs} ms
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <h2 className="text-sm font-semibold text-slate-900 pb-3 border-b border-slate-100">
                Ingestion Pipeline Jobs ({jobs?.length || 0})
              </h2>
              <div className="mt-3 overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-3 font-medium">Document</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium text-right">Duration</th>
                      <th className="py-2 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(jobs || []).slice(0, 10).map((job) => (
                      <tr key={job.id}>
                        <td className="py-2.5 pr-3 font-medium text-slate-900 truncate max-w-[180px]">
                          {job.document_name} (v{job.document_version})
                        </td>
                        <td className="py-2.5 pr-3">
                          <span
                            className={`inline-flex items-center gap-1 font-medium ${
                              job.status === 'COMPLETED'
                                ? 'text-green-700'
                                : job.status === 'FAILED' || job.status === 'DEAD_LETTER'
                                  ? 'text-red-700'
                                  : 'text-amber-700'
                            }`}
                          >
                            {job.status === 'COMPLETED' ? (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            ) : job.status === 'FAILED' || job.status === 'DEAD_LETTER' ? (
                              <AlertTriangle className="w-3.5 h-3.5" />
                            ) : (
                              <Clock className="w-3.5 h-3.5" />
                            )}
                            {job.status}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-600">
                          {job.duration_ms != null ? `${job.duration_ms} ms` : '—'}
                        </td>
                        <td className="py-2.5 text-right">
                          {(job.status === 'FAILED' || job.status === 'DEAD_LETTER') && (
                            <button
                              type="button"
                              onClick={() => retryMutation.mutate(job.id)}
                              className="inline-flex items-center gap-1 text-blue-700 hover:underline font-medium"
                            >
                              <RefreshCw className="w-3 h-3" />
                              Retry
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {isAdmin && (
          <section className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="text-sm font-semibold text-slate-900 pb-3 border-b border-slate-100">
              Security & Compliance Audit Log
            </h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-4 font-medium">Timestamp</th>
                    <th className="py-2 pr-4 font-medium">Actor</th>
                    <th className="py-2 pr-4 font-medium">Action</th>
                    <th className="py-2 pr-4 font-medium">Resource</th>
                    <th className="py-2 font-medium">Correlation ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(auditLogs || []).map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/60">
                      <td className="py-2.5 pr-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-800">{log.actor_email || 'System'}</td>
                      <td className="py-2.5 pr-4 font-mono font-medium text-slate-900">
                        {log.action}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600 font-mono">
                        {log.resource_type}
                        {log.resource_id ? `:${log.resource_id.slice(0, 8)}` : ''}
                      </td>
                      <td className="py-2.5 font-mono text-slate-400">
                        {log.correlation_id ? log.correlation_id.slice(0, 12) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </AppLayout>
  );
}
