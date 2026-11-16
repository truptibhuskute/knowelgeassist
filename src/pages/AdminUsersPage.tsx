import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, UserCheck, UserX } from 'lucide-react';
import { apiClient, extractApiErrorMessage } from '../api/client';
import { AppLayout } from '../layouts/AppLayout';
import type { Department, RoleName, UserProfile } from '../types/api';

export function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptDesc, setNewDeptDesc] = useState('');
  const [deptError, setDeptError] = useState<string | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const res = await apiClient.get<{ users: UserProfile[] }>('/users');
      return res.data.users;
    },
  });

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      const res = await apiClient.get<{ departments: Department[] }>('/departments');
      return res.data.departments;
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async (payload: {
      userId: string;
      isActive?: boolean;
      roles?: RoleName[];
      departmentIds?: string[];
    }) => {
      await apiClient.patch(`/users/${payload.userId}`, {
        isActive: payload.isActive,
        roles: payload.roles,
        departmentIds: payload.departmentIds,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      await queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
  });

  const createDeptMutation = useMutation({
    mutationFn: async () => {
      await apiClient.post('/departments', {
        name: newDeptName.trim(),
        description: newDeptDesc.trim() || undefined,
      });
    },
    onSuccess: async () => {
      setNewDeptName('');
      setNewDeptDesc('');
      setDeptError(null);
      await queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
    onError: (err) => {
      setDeptError(extractApiErrorMessage(err));
    },
  });

  const toggleRole = (user: UserProfile, role: RoleName) => {
    const exists = user.roles.includes(role);
    const next = exists ? user.roles.filter((r) => r !== role) : [...user.roles, role];
    if (next.length === 0) return;
    updateUserMutation.mutate({ userId: user.id, roles: next });
  };

  const toggleDept = (user: UserProfile, deptId: string) => {
    const exists = user.departmentIds.includes(deptId);
    const next = exists
      ? user.departmentIds.filter((d) => d !== deptId)
      : [...user.departmentIds, deptId];
    updateUserMutation.mutate({ userId: user.id, departmentIds: next });
  };

  return (
    <AppLayout title="Users & Departments" breadcrumb="Administration / Users & Departments">
      <div className="space-y-8">
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-base font-semibold text-slate-900 pb-4 border-b border-slate-100">
            Employee Accounts & RBAC Assignment
          </h2>

          {isLoading ? (
            <div className="py-10 text-center text-sm text-slate-500">Loading users...</div>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-3 pr-4 font-medium">User</th>
                    <th className="py-3 pr-4 font-medium">Status</th>
                    <th className="py-3 pr-4 font-medium">Roles</th>
                    <th className="py-3 pr-4 font-medium">Departments</th>
                    <th className="py-3 font-medium text-right">Account</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(users || []).map((u) => (
                    <tr key={u.id}>
                      <td className="py-3.5 pr-4">
                        <div className="font-semibold text-slate-900">{u.fullName}</div>
                        <div className="text-slate-500 font-mono">{u.email}</div>
                      </td>
                      <td className="py-3.5 pr-4">
                        <span
                          className={`inline-flex items-center gap-1 font-medium ${
                            u.isActive ? 'text-green-700' : 'text-red-700'
                          }`}
                        >
                          {u.isActive ? (
                            <UserCheck className="w-3.5 h-3.5" />
                          ) : (
                            <UserX className="w-3.5 h-3.5" />
                          )}
                          {u.isActive ? 'Active' : 'Deactivated'}
                        </span>
                      </td>
                      <td className="py-3.5 pr-4">
                        <div className="flex flex-wrap gap-2">
                          {(['EMPLOYEE', 'KNOWLEDGE_OWNER', 'ADMIN'] as RoleName[]).map((role) => (
                            <label key={role} className="inline-flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={u.roles.includes(role)}
                                onChange={() => toggleRole(u, role)}
                              />
                              <span className="font-mono text-[11px]">{role}</span>
                            </label>
                          ))}
                        </div>
                      </td>
                      <td className="py-3.5 pr-4">
                        <div className="flex flex-wrap gap-2">
                          {(departments || []).map((d) => (
                            <label key={d.id} className="inline-flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={u.departmentIds.includes(d.id)}
                                onChange={() => toggleDept(u, d.id)}
                              />
                              <span>{d.name}</span>
                            </label>
                          ))}
                        </div>
                      </td>
                      <td className="py-3.5 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            updateUserMutation.mutate({ userId: u.id, isActive: !u.isActive })
                          }
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                            u.isActive
                              ? 'border-red-200 text-red-700 hover:bg-red-50'
                              : 'border-green-200 text-green-700 hover:bg-green-50'
                          }`}
                        >
                          {u.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Departments</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Departments govern visibility and vector retrieval for DEPARTMENT-scoped documents.
              </p>
            </div>
          </div>

          {deptError && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
              {deptError}
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              value={newDeptName}
              onChange={(e) => setNewDeptName(e.target.value)}
              placeholder="New department name (e.g. Product)"
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
            <input
              type="text"
              value={newDeptDesc}
              onChange={(e) => setNewDeptDesc(e.target.value)}
              placeholder="Description (optional)"
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
            <button
              type="button"
              disabled={newDeptName.trim().length < 2 || createDeptMutation.isPending}
              onClick={() => createDeptMutation.mutate()}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Department</span>
            </button>
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {(departments || []).map((dept) => (
              <div key={dept.id} className="p-4 border border-slate-200 rounded-lg bg-slate-50/50">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-blue-700" />
                    {dept.name}
                  </span>
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    {dept.memberCount} members
                  </span>
                </div>
                {dept.description && (
                  <p className="mt-1.5 text-xs text-slate-600">{dept.description}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
