import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileUp,
  Lock,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiClient, extractApiErrorMessage } from '../api/client';
import { AppLayout } from '../layouts/AppLayout';
import type { AccessScope, Department, DocumentItem, UserProfile } from '../types/api';

export function AdminDocumentsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadScope, setUploadScope] = useState<AccessScope>('ALL_EMPLOYEES');
  const [uploadDeptId, setUploadDeptId] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  // Modal state for permissions & version replacement
  const [permDoc, setPermDoc] = useState<DocumentItem | null>(null);
  const [permScope, setPermScope] = useState<AccessScope>('ALL_EMPLOYEES');
  const [permDeptId, setPermDeptId] = useState<string>('');
  const [permUserIds, setPermUserIds] = useState<string[]>([]);

  const [replaceDoc, setReplaceDoc] = useState<DocumentItem | null>(null);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [replaceNote, setReplaceNote] = useState('');

  const { data: docs, isLoading } = useQuery({
    queryKey: ['admin-documents', search, statusFilter],
    refetchInterval: 3000,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      const res = await apiClient.get<{ documents: DocumentItem[] }>(
        `/documents?${params.toString()}`
      );
      return res.data.documents;
    },
  });

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      const res = await apiClient.get<{ departments: Department[] }>('/departments');
      return res.data.departments;
    },
  });

  const { data: allUsers } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const res = await apiClient.get<{ users: UserProfile[] }>('/users');
      return res.data.users;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (selectedFiles.length === 0) throw new Error('Select at least one file.');
      if (uploadScope === 'DEPARTMENT' && !uploadDeptId) {
        throw new Error('Select a target department for DEPARTMENT access scope.');
      }

      if (selectedFiles.length === 1) {
        const fd = new FormData();
        fd.append('file', selectedFiles[0]);
        fd.append('accessScope', uploadScope);
        if (uploadDeptId) fd.append('departmentId', uploadDeptId);
        await apiClient.post('/documents/upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } else {
        const fd = new FormData();
        for (const f of selectedFiles) {
          fd.append('files', f);
        }
        fd.append('accessScope', uploadScope);
        if (uploadDeptId) fd.append('departmentId', uploadDeptId);
        await apiClient.post('/documents/bulk-upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
    },
    onSuccess: async () => {
      setSelectedFiles([]);
      setUploadError(null);
      setUploadSuccess('Document upload queued for asynchronous extraction and indexing.');
      await queryClient.invalidateQueries({ queryKey: ['admin-documents'] });
    },
    onError: (err) => {
      setUploadSuccess(null);
      setUploadError(extractApiErrorMessage(err));
    },
  });

  const savePermissionsMutation = useMutation({
    mutationFn: async () => {
      if (!permDoc) return;
      await apiClient.put(`/documents/${permDoc.id}/permissions`, {
        accessScope: permScope,
        departmentId: permScope === 'DEPARTMENT' ? permDeptId : null,
        userIds: permScope === 'RESTRICTED' ? permUserIds : [],
      });
    },
    onSuccess: async () => {
      setPermDoc(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-documents'] });
    },
  });

  const replaceVersionMutation = useMutation({
    mutationFn: async () => {
      if (!replaceDoc || !replaceFile) throw new Error('Select a replacement file.');
      const fd = new FormData();
      fd.append('file', replaceFile);
      if (replaceNote) fd.append('changeNote', replaceNote);
      await apiClient.post(`/documents/${replaceDoc.id}/replace`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: async () => {
      setReplaceDoc(null);
      setReplaceFile(null);
      setReplaceNote('');
      await queryClient.invalidateQueries({ queryKey: ['admin-documents'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (docId: string) => {
      await apiClient.delete(`/documents/${docId}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-documents'] });
    },
  });

  const openPermissionsModal = async (doc: DocumentItem) => {
    setPermDoc(doc);
    setPermScope(doc.accessScope);
    setPermDeptId(doc.departmentId || '');
    try {
      const res = await apiClient.get<{ grants: Array<{ user_id: string }> }>(
        `/documents/${doc.id}/permissions`
      );
      setPermUserIds(res.data.grants.map((g) => g.user_id));
    } catch {
      setPermUserIds([]);
    }
  };

  return (
    <AppLayout
      title="Document Library & Ingestion"
      breadcrumb="Administration / Document Library"
    >
      <div className="space-y-6">
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="pb-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900">
              Upload Enterprise Documents
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Supports PDF, DOCX, TXT, and Markdown up to 50 MB. Files are validated, SHA-256 deduplicated, chunked, and indexed asynchronously.
            </p>
          </div>

          {uploadError && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{uploadError}</span>
            </div>
          )}
          {uploadSuccess && (
            <div className="mt-4 p-3 rounded-lg bg-green-50 border border-green-200 text-xs text-green-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{uploadSuccess}</span>
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-4 gap-4 items-end">
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Select File(s) (Single or Bulk)
              </label>
              <input
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.md,.markdown"
                onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))}
                className="block w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3.5 file:rounded-lg file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 file:text-slate-700 hover:file:bg-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Access Scope
              </label>
              <select
                value={uploadScope}
                onChange={(e) => setUploadScope(e.target.value as AccessScope)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-900"
              >
                <option value="ALL_EMPLOYEES">ALL_EMPLOYEES</option>
                <option value="DEPARTMENT">DEPARTMENT</option>
                <option value="RESTRICTED">RESTRICTED</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Department {uploadScope === 'DEPARTMENT' ? '(Required)' : '(Optional)'}
              </label>
              <select
                value={uploadDeptId}
                onChange={(e) => setUploadDeptId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-900"
              >
                <option value="">None</option>
                {(departments || []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-4">
            <div className="text-xs text-slate-500 font-mono">
              {selectedFiles.length > 0
                ? `${selectedFiles.length} file(s) ready: ${selectedFiles.map((f) => f.name).join(', ')}`
                : 'No files selected'}
            </div>
            <button
              type="button"
              disabled={selectedFiles.length === 0 || uploadMutation.isPending}
              onClick={() => uploadMutation.mutate()}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{uploadMutation.isPending ? 'Uploading...' : 'Upload & Index'}</span>
            </button>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900">
              Managed Documents ({docs?.length || 0})
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by title..."
                  className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="">All Statuses</option>
                <option value="INDEXED">INDEXED</option>
                <option value="PROCESSING">PROCESSING</option>
                <option value="UPLOADED">UPLOADED</option>
                <option value="FAILED">FAILED</option>
              </select>
            </div>
          </div>

          {isLoading ? (
            <div className="py-12 text-center text-sm text-slate-500">Loading document library...</div>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-3 pr-4 font-medium">Document</th>
                    <th className="py-3 pr-4 font-medium">Scope</th>
                    <th className="py-3 pr-4 font-medium">Status</th>
                    <th className="py-3 pr-4 font-medium text-right">Ver</th>
                    <th className="py-3 pr-4 font-medium text-right">Chunks</th>
                    <th className="py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(docs || []).map((doc) => (
                    <tr key={doc.id} className="hover:bg-slate-50/70">
                      <td className="py-3 pr-4">
                        <Link
                          to={`/documents/${doc.id}`}
                          className="font-semibold text-slate-900 hover:text-blue-700"
                        >
                          {doc.name}
                        </Link>
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                          {doc.fileType} · {(doc.fileSizeBytes / 1024).toFixed(1)} KB
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-slate-700">
                        <div className="inline-flex items-center gap-1">
                          {doc.accessScope === 'RESTRICTED' && (
                            <Lock className="w-3 h-3 text-amber-600" />
                          )}
                          <span>{doc.accessScope}</span>
                        </div>
                        {doc.departmentName && (
                          <div className="text-[11px] text-slate-500">{doc.departmentName}</div>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-flex items-center gap-1 font-medium ${
                            doc.status === 'INDEXED'
                              ? 'text-green-700'
                              : doc.status === 'FAILED'
                                ? 'text-red-700'
                                : 'text-amber-700'
                          }`}
                        >
                          {doc.status === 'INDEXED' ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : doc.status === 'FAILED' ? (
                            <AlertCircle className="w-3.5 h-3.5" />
                          ) : (
                            <Clock className="w-3.5 h-3.5" />
                          )}
                          {doc.status}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-right font-mono tabular-nums text-slate-700">
                        v{doc.currentVersion}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono tabular-nums text-slate-700">
                        {doc.chunkCount}
                      </td>
                      <td className="py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void openPermissionsModal(doc)}
                            title="Manage Access Permissions"
                            className="p-1.5 text-slate-600 hover:text-blue-700 border border-slate-200 rounded-md"
                          >
                            <Settings2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setReplaceDoc(doc);
                              setReplaceFile(null);
                              setReplaceNote('');
                            }}
                            title="Replace Version"
                            className="p-1.5 text-slate-600 hover:text-blue-700 border border-slate-200 rounded-md"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteMutation.mutate(doc.id)}
                            title="Delete Document"
                            className="p-1.5 text-red-600 hover:bg-red-50 border border-slate-200 rounded-md"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {permDoc && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">
              Access Control — {permDoc.name}
            </h3>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Access Scope</label>
              <select
                value={permScope}
                onChange={(e) => setPermScope(e.target.value as AccessScope)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              >
                <option value="ALL_EMPLOYEES">ALL_EMPLOYEES</option>
                <option value="DEPARTMENT">DEPARTMENT</option>
                <option value="RESTRICTED">RESTRICTED</option>
              </select>
            </div>

            {permScope === 'DEPARTMENT' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Assigned Department
                </label>
                <select
                  value={permDeptId}
                  onChange={(e) => setPermDeptId(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                >
                  <option value="">Select department</option>
                  {(departments || []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {permScope === 'RESTRICTED' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Explicit User Grants
                </label>
                <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1.5">
                  {(allUsers || []).map((u) => {
                    const checked = permUserIds.includes(u.id);
                    return (
                      <label
                        key={u.id}
                        className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setPermUserIds((prev) => [...prev, u.id]);
                            } else {
                              setPermUserIds((prev) => prev.filter((id) => id !== u.id));
                            }
                          }}
                        />
                        <span className="font-medium">{u.fullName}</span>
                        <span className="text-slate-400">({u.email})</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPermDoc(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => savePermissionsMutation.mutate()}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800"
              >
                Save Policy
              </button>
            </div>
          </div>
        </div>
      )}

      {replaceDoc && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">
              Replace Version — {replaceDoc.name}
            </h3>
            <p className="text-xs text-slate-500">
              Current version is v{replaceDoc.currentVersion}. Uploading a new file creates v
              {replaceDoc.currentVersion + 1} while preserving history.
            </p>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                New Document File
              </label>
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md,.markdown"
                onChange={(e) => setReplaceFile(e.target.files?.[0] || null)}
                className="block w-full text-xs text-slate-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Change Note</label>
              <input
                type="text"
                value={replaceNote}
                onChange={(e) => setReplaceNote(e.target.value)}
                placeholder="e.g. Updated Q4 policy thresholds"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReplaceDoc(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!replaceFile || replaceVersionMutation.isPending}
                onClick={() => replaceVersionMutation.mutate()}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50 flex items-center gap-1.5"
              >
                <FileUp className="w-3.5 h-3.5" />
                <span>Upload v{replaceDoc.currentVersion + 1}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
