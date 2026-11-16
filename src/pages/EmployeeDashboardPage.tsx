import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, FileText, Lock, MessageSquare, Search, Users } from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { AppLayout } from '../layouts/AppLayout';
import type { ConversationSummary, DocumentItem } from '../types/api';

export function EmployeeDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [quickPrompt, setQuickPrompt] = useState('');
  const [docSearch, setDocSearch] = useState('');

  const { data: docsData, isLoading: docsLoading } = useQuery({
    queryKey: ['visible-documents'],
    queryFn: async () => {
      const res = await apiClient.get<{ documents: DocumentItem[] }>('/documents');
      return res.data.documents;
    },
  });

  const { data: convData, isLoading: convLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const res = await apiClient.get<{ conversations: ConversationSummary[] }>('/conversations');
      return res.data.conversations;
    },
  });

  const docs = docsData || [];
  const conversations = convData || [];
  const indexedDocs = docs.filter((d) => d.status === 'INDEXED');

  const filteredDocs = indexedDocs.filter(
    (d) =>
      d.name.toLowerCase().includes(docSearch.toLowerCase()) ||
      (d.departmentName || '').toLowerCase().includes(docSearch.toLowerCase())
  );

  const handleQuickAsk = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickPrompt.trim()) return;
    navigate(`/chat?q=${encodeURIComponent(quickPrompt.trim())}`);
  };

  const starterPrompts = [
    'What is the standard resignation notice period and what happens if it is not served?',
    'How many weeks of paid parental leave are employees eligible for?',
    'What is the domestic vs international daily meal reimbursement allowance?',
  ];

  return (
    <AppLayout
      title="Knowledge Workspace"
      breadcrumb={`Workspace / ${user?.fullName || 'Employee'}`}
      primaryAction={
        <Link
          to="/chat"
          className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
        >
          New Conversation
        </Link>
      }
    >
      <div className="space-y-8">
        <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          <div className="max-w-3xl">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
              Ask verified questions across authorized company knowledge
            </h2>
            <p className="mt-1.5 text-sm text-slate-600">
              Answers are grounded exclusively in documents you are authorized to view, with page-level source citations.
            </p>

            <form onSubmit={handleQuickAsk} className="mt-5 flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={quickPrompt}
                  onChange={(e) => setQuickPrompt(e.target.value)}
                  placeholder="Ask about PTO, incident SLAs, expense limits, or onboarding..."
                  className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 placeholder:text-slate-400"
                />
              </div>
              <button
                type="submit"
                className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-2"
              >
                <span>Ask Assistant</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="mt-4 flex flex-wrap gap-2">
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => navigate(`/chat?q=${encodeURIComponent(prompt)}`)}
                  className="text-left text-xs text-slate-600 hover:text-blue-700 bg-slate-50 hover:bg-blue-50 border border-slate-200 rounded-lg px-3 py-1.5 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div>
              <div className="text-xs font-medium text-slate-500">Accessible Indexed Documents</div>
              <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                {docsLoading ? '—' : indexedDocs.length}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">Assigned Departments</div>
              <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                {user?.departments?.length ?? user?.departmentIds.length ?? 0}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">Saved Conversations</div>
              <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                {convLoading ? '—' : conversations.length}
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <section className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Authorized Knowledge Base</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Documents currently accessible under your role and department memberships
                </p>
              </div>
              <div className="relative w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={docSearch}
                  onChange={(e) => setDocSearch(e.target.value)}
                  placeholder="Filter documents..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 text-slate-900"
                />
              </div>
            </div>

            {docsLoading ? (
              <div className="py-10 text-center text-sm text-slate-500">Loading documents...</div>
            ) : filteredDocs.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">
                No indexed documents match your filter.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50/70 px-2 rounded-lg transition-colors"
                  >
                    <div className="min-w-0">
                      <Link
                        to={`/documents/${doc.id}`}
                        className="text-sm font-semibold text-slate-900 hover:text-blue-700 truncate block"
                      >
                        {doc.name}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          {doc.fileType}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">v{doc.currentVersion}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{doc.chunkCount} chunks</span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          {doc.accessScope === 'RESTRICTED' ? (
                            <Lock className="w-3 h-3 text-amber-600" />
                          ) : (
                            <Users className="w-3 h-3 text-slate-400" />
                          )}
                          {doc.accessScope === 'DEPARTMENT'
                            ? `Department: ${doc.departmentName || 'Assigned'}`
                            : doc.accessScope === 'RESTRICTED'
                              ? 'Restricted Grant'
                              : 'All Employees'}
                        </span>
                      </div>
                    </div>
                    <Link
                      to={`/documents/${doc.id}`}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 whitespace-nowrap shrink-0"
                    >
                      Inspect Source
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900">Recent Conversations</h3>
              <Link to="/conversations" className="text-xs font-medium text-blue-700 hover:underline">
                View all
              </Link>
            </div>

            {convLoading ? (
              <div className="py-10 text-center text-sm text-slate-500">Loading history...</div>
            ) : conversations.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm text-slate-500">No conversations yet.</p>
                <Link
                  to="/chat"
                  className="mt-3 inline-block px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800"
                >
                  Start First Chat
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {conversations.slice(0, 6).map((c) => (
                  <Link
                    key={c.id}
                    to={`/chat/${c.id}`}
                    className="block py-3 hover:bg-slate-50 px-2 rounded-lg transition-colors"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-900 truncate">
                      <MessageSquare className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{c.title}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                      {c.messageCount} messages · {new Date(c.updatedAt).toLocaleDateString()}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </AppLayout>
  );
}
