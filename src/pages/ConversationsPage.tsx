import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, Edit2, MessageSquare, Search, Trash2, X } from 'lucide-react';
import { apiClient } from '../api/client';
import { AppLayout } from '../layouts/AppLayout';
import type { ConversationSummary } from '../types/api';

export function ConversationsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const { data: conversations, isLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const res = await apiClient.get<{ conversations: ConversationSummary[] }>('/conversations');
      return res.data.conversations;
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      await apiClient.patch(`/conversations/${id}`, { title });
    },
    onSuccess: async () => {
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/conversations/${id}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const filtered = (conversations || []).filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppLayout
      title="Conversation History"
      breadcrumb="Workspace / Conversations"
      primaryAction={
        <Link
          to="/chat"
          className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 whitespace-nowrap shrink-0"
        >
          New Conversation
        </Link>
      }
    >
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Your Saved Threads</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Conversations are strictly private to your authenticated account.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-900"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-sm text-slate-500">Loading conversations...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            No conversations found.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((conv) => (
              <div
                key={conv.id}
                className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  {editingId === conv.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="flex-1 max-w-md px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => renameMutation.mutate({ id: conv.id, title: editTitle })}
                        className="p-1.5 text-green-700 hover:bg-green-50 rounded-md"
                        aria-label="Save title"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-md"
                        aria-label="Cancel rename"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <Link
                        to={`/chat/${conv.id}`}
                        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-blue-700"
                      >
                        <MessageSquare className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="truncate">{conv.title}</span>
                      </Link>
                      <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                        {conv.messageCount} messages · Updated{' '}
                        {new Date(conv.updatedAt).toLocaleString()}
                      </div>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    to={`/chat/${conv.id}`}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                  >
                    Open
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(conv.id);
                      setEditTitle(conv.title);
                    }}
                    className="p-1.5 text-slate-500 hover:text-slate-900 border border-slate-200 rounded-lg"
                    aria-label="Rename conversation"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(conv.id)}
                    className="p-1.5 text-red-600 hover:bg-red-50 border border-slate-200 rounded-lg"
                    aria-label="Delete conversation"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
