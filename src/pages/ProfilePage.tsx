import React from 'react';
import { Building2, Mail, Shield, UserCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { AppLayout } from '../layouts/AppLayout';

export function ProfilePage() {
  const { user, logout } = useAuth();

  return (
    <AppLayout title="User Profile" breadcrumb="Workspace / My Profile">
      <div className="max-w-3xl bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="flex items-start justify-between gap-4 pb-6 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{user?.fullName}</h2>
            <p className="text-sm text-slate-500 mt-0.5 flex items-center gap-1.5">
              <Mail className="w-4 h-4" />
              <span>{user?.email}</span>
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700">
            <UserCheck className="w-4 h-4" />
            <span>{user?.isActive ? 'Active Account' : 'Deactivated'}</span>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <div className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-blue-700" />
              <span>Assigned Roles</span>
            </div>
            <div className="mt-2 space-y-1.5">
              {(user?.roles || []).map((role) => (
                <div
                  key={role}
                  className="px-3 py-2 text-xs font-mono font-medium text-slate-800 bg-slate-50 border border-slate-200 rounded-lg"
                >
                  {role}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-blue-700" />
              <span>Department Memberships</span>
            </div>
            <div className="mt-2 space-y-1.5">
              {user?.departments && user.departments.length > 0 ? (
                user.departments.map((dept) => (
                  <div
                    key={dept.id}
                    className="px-3 py-2 text-xs text-slate-800 bg-slate-50 border border-slate-200 rounded-lg"
                  >
                    <div className="font-semibold">{dept.name}</div>
                    {dept.description && (
                      <div className="text-slate-500 mt-0.5">{dept.description}</div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-500">
                  No department memberships assigned (All-Employees documents still accessible).
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-slate-100 flex items-center justify-between">
          <div className="text-xs text-slate-500 font-mono">User ID: {user?.id}</div>
          <button
            type="button"
            onClick={() => void logout()}
            className="px-4 py-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
          >
            Revoke Session & Sign Out
          </button>
        </div>
      </div>
    </AppLayout>
  );
}
