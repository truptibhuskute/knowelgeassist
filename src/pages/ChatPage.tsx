import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Send,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { apiClient, extractApiErrorMessage } from '../api/client';
import { AppLayout } from '../layouts/AppLayout';
import type {
  ChatResponse,
  Citation,
  ConversationMessage,
  ConversationSummary,
} from '../types/api';

function CitationCard({ citation }: { citation: Citation }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-slate-200 rounded-lg bg-slate-50/70">
      <div className="px-3 py-2 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex items-center gap-2 text-left min-w-0 flex-1 text-xs font-medium text-slate-800 hover:text-blue-700"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-500" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-500" />
          )}
          <FileText className="w-3.5 h-3.5 shrink-0 text-blue-700" />
          <span className="truncate font-semibold">{citation.documentName}</span>
          <span className="text-slate-400" aria-hidden="true">·</span>
          <span className="font-mono tabular-nums text-slate-500 whitespace-nowrap shrink-0">
            v{citation.documentVersion} · p.{citation.pageNumber}
          </span>
        </button>

        <Link
          to={`/documents/${citation.documentId}?chunkId=${encodeURIComponent(citation.chunkId)}`}
          className="text-xs font-medium text-blue-700 hover:underline inline-flex items-center gap-1 whitespace-nowrap shrink-0"
        >
          <span>View Source</span>
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-slate-200/80 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
          {citation.excerpt}
        </div>
      )}
    </div>
  );
}

export function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'UP' | 'DOWN'>>({});
  const [optimisticMessages, setOptimisticMessages] = useState<ConversationMessage[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const initialQueryTriggered = useRef(false);

  const { data: conversations } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const res = await apiClient.get<{ conversations: ConversationSummary[] }>('/conversations');
      return res.data.conversations;
    },
  });

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['conversation-messages', conversationId],
    enabled: Boolean(conversationId),
    queryFn: async () => {
      const res = await apiClient.get<{
        conversation: { id: string; title: string };
        messages: ConversationMessage[];
      }>(`/conversations/${conversationId}/messages`);
      return res.data;
    },
  });

  const messages = conversationId ? historyData?.messages || [] : optimisticMessages;

  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, sending]);

  const sendQuestion = async (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed || sending) return;

    setError(null);
    setLastFailedPrompt(null);
    setSending(true);
    setInput('');

    if (!conversationId) {
      setOptimisticMessages((prev) => [
        ...prev,
        {
          id: `temp-${Date.now()}`,
          role: 'USER',
          content: trimmed,
          confidence: null,
          citations: [],
          followUpQuestions: [],
          retrievalMetadata: null,
          createdAt: new Date().toISOString(),
        },
      ]);
    }

    try {
      const res = await apiClient.post<ChatResponse>('/chat', {
        question: trimmed,
        conversationId: conversationId || undefined,
      });

      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (conversationId) {
        await queryClient.invalidateQueries({
          queryKey: ['conversation-messages', conversationId],
        });
      } else {
        setOptimisticMessages([]);
        navigate(`/chat/${res.data.conversationId}`, { replace: true });
      }
    } catch (err) {
      setError(extractApiErrorMessage(err));
      setLastFailedPrompt(trimmed);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    const q = searchParams.get('q');
    if (q && !conversationId && !initialQueryTriggered.current) {
      initialQueryTriggered.current = true;
      setSearchParams({}, { replace: true });
      void sendQuestion(q);
    }
  }, [searchParams, conversationId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendQuestion(input);
  };

  const handleFeedback = async (messageId: string, rating: 'UP' | 'DOWN') => {
    setFeedbackMap((prev) => ({ ...prev, [messageId]: rating }));
    try {
      await apiClient.post('/feedback', { messageId, rating });
    } catch {
      // Revert if failed
      setFeedbackMap((prev) => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
    }
  };

  const handleNewConversation = () => {
    setOptimisticMessages([]);
    setError(null);
    navigate('/chat');
  };

  return (
    <AppLayout
      title={historyData?.conversation.title || 'New AI Assistant Session'}
      breadcrumb="Workspace / AI Assistant"
      primaryAction={
        <button
          type="button"
          onClick={handleNewConversation}
          className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <MessageSquarePlus className="w-3.5 h-3.5" />
          <span>New Chat</span>
        </button>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[calc(100vh-10.5rem)] min-h-[540px]">
        <aside className="hidden lg:flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">Conversation History</span>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {conversations?.length || 0}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {(conversations || []).map((conv) => (
              <Link
                key={conv.id}
                to={`/chat/${conv.id}`}
                className={`block px-3 py-2.5 rounded-lg text-xs transition-colors ${
                  conv.id === conversationId
                    ? 'bg-blue-50 text-blue-800 font-semibold'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="truncate">{conv.title}</div>
                <div className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-400">
                  {conv.messageCount} msgs · {new Date(conv.updatedAt).toLocaleDateString()}
                </div>
              </Link>
            ))}
            {(!conversations || conversations.length === 0) && (
              <div className="p-4 text-xs text-slate-500 text-center">No saved threads yet.</div>
            )}
          </div>
        </aside>

        <section className="lg:col-span-3 flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            {historyLoading ? (
              <div className="py-16 text-center text-sm text-slate-500 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading conversation...</span>
              </div>
            ) : messages.length === 0 && !sending ? (
              <div className="py-12 max-w-xl mx-auto text-center">
                <ShieldCheck className="w-8 h-8 text-blue-700 mx-auto" />
                <h2 className="mt-3 text-base font-semibold text-slate-900">
                  Grounded Enterprise Document Assistant
                </h2>
                <p className="mt-1.5 text-sm text-slate-500">
                  Every answer is constrained to documents you have explicit permission to view. When evidence is missing, the assistant will abstain rather than guess.
                </p>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.role === 'USER' ? 'items-end' : 'items-start'}`}
                >
                  {msg.role === 'USER' ? (
                    <div className="max-w-2xl bg-blue-700 text-white px-4 py-3 rounded-xl text-sm leading-relaxed">
                      {msg.content}
                    </div>
                  ) : (
                    <div className="w-full max-w-3xl border border-slate-200 bg-white rounded-xl p-4 sm:p-5 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100 text-xs">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-semibold ${
                              msg.confidence === 'HIGH'
                                ? 'text-green-700'
                                : msg.confidence === 'MEDIUM'
                                  ? 'text-amber-700'
                                  : 'text-red-700'
                            }`}
                          >
                            Confidence: {msg.confidence || 'LOW'}
                          </span>
                          {msg.retrievalMetadata && (
                            <>
                              <span className="text-slate-300" aria-hidden="true">·</span>
                              <span className="text-slate-500 font-mono tabular-nums">
                                {msg.retrievalMetadata.retrievedChunkCount} chunks retrieved
                              </span>
                              <span className="text-slate-300" aria-hidden="true">·</span>
                              <span className="text-slate-500 font-mono tabular-nums">
                                {msg.retrievalMetadata.totalLatencyMs} ms
                              </span>
                            </>
                          )}
                        </div>

                        {!msg.id.startsWith('temp-') && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void handleFeedback(msg.id, 'UP')}
                              aria-label="Helpful answer"
                              className={`p-1.5 rounded-md border transition-colors ${
                                feedbackMap[msg.id] === 'UP'
                                  ? 'bg-green-50 border-green-300 text-green-700'
                                  : 'border-slate-200 text-slate-400 hover:text-slate-700'
                              }`}
                            >
                              <ThumbsUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleFeedback(msg.id, 'DOWN')}
                              aria-label="Unhelpful answer"
                              className={`p-1.5 rounded-md border transition-colors ${
                                feedbackMap[msg.id] === 'DOWN'
                                  ? 'bg-red-50 border-red-300 text-red-700'
                                  : 'border-slate-200 text-slate-400 hover:text-slate-700'
                              }`}
                            >
                              <ThumbsDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </div>

                      {msg.citations && msg.citations.length > 0 && (
                        <div className="space-y-2 pt-2">
                          <div className="text-xs font-semibold text-slate-600">
                            Verified Sources ({msg.citations.length})
                          </div>
                          <div className="space-y-2">
                            {msg.citations.map((cit) => (
                              <CitationCard key={cit.chunkId} citation={cit} />
                            ))}
                          </div>
                        </div>
                      )}

                      {msg.followUpQuestions && msg.followUpQuestions.length > 0 && (
                        <div className="pt-2 border-t border-slate-100">
                          <div className="text-xs font-medium text-slate-500 mb-2">
                            Suggested follow-up questions
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {msg.followUpQuestions.map((fq) => (
                              <button
                                key={fq}
                                type="button"
                                onClick={() => void sendQuestion(fq)}
                                className="text-left text-xs text-blue-700 bg-blue-50/70 hover:bg-blue-100 border border-blue-200/80 rounded-lg px-3 py-1.5 transition-colors"
                              >
                                {fq}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}

            {sending && (
              <div className="flex items-center gap-2.5 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin text-blue-700" />
                <span>Retrieving authorized documents and verifying citations...</span>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800 flex items-center justify-between gap-4"
              >
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                  <span>{error}</span>
                </div>
                {lastFailedPrompt && (
                  <button
                    type="button"
                    onClick={() => void sendQuestion(lastFailedPrompt)}
                    className="px-3 py-1.5 text-xs font-semibold text-red-800 bg-white border border-red-300 rounded-lg hover:bg-red-100 flex items-center gap-1.5 shrink-0"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry</span>
                  </button>
                )}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={handleSubmit} className="p-4 border-t border-slate-200 bg-slate-50/60">
            <div className="flex gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question grounded in your authorized documents..."
                disabled={sending}
                className="flex-1 px-4 py-2.5 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 placeholder:text-slate-400"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <Send className="w-4 h-4" />
                <span>Send</span>
              </button>
            </div>
          </form>
        </section>
      </div>
    </AppLayout>
  );
}
