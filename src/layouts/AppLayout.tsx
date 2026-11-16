import React, { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BookOpen,
  FileStack,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Shield,
  User,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

interface AppLayoutProps {
  title: string;
  breadcrumb: string;
  primaryAction?: React.ReactNode;
  children: React.ReactNode;
}

export function AppLayout({ title, breadcrumb, primaryAction, children }: AppLayoutProps) {
  const { user, logout, hasRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isPrivileged = hasRole('ADMIN', 'KNOWLEDGE_OWNER');
  const isAdmin = hasRole('ADMIN');

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
      isActive
        ? 'bg-blue-50 text-blue-700'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
    }`;

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white border-r border-slate-200 w-64">
      <div className="px-5 py-5 border-b border-slate-200 flex items-center justify-between">
        <Link
          to="/"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-2.5 text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          <span className="w-7 h-7 rounded-md bg-blue-700 text-white flex items-center justify-center">
            <BookOpen className="w-4 h-4" />
          </span>
          <span>KnowledgeAssist</span>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-1.5 text-slate-500 hover:text-slate-900 rounded-md"
          aria-label="Close navigation"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto" aria-label="Primary navigation">
        <div className="space-y-1">
          <div className="px-3 pb-1 text-xs font-semibold text-slate-400">Workspace</div>
          <NavLink to="/" end className={navItemClass} onClick={() => setMobileOpen(false)}>
            <LayoutDashboard className="w-4 h-4 shrink-0" />
            <span>Overview</span>
          </NavLink>
          <NavLink to="/chat" className={navItemClass} onClick={() => setMobileOpen(false)}>
            <MessageSquare className="w-4 h-4 shrink-0" />
            <span>AI Assistant</span>
          </NavLink>
          <NavLink to="/conversations" className={navItemClass} onClick={() => setMobileOpen(false)}>
            <History className="w-4 h-4 shrink-0" />
            <span>Conversations</span>
          </NavLink>
          <NavLink to="/profile" className={navItemClass} onClick={() => setMobileOpen(false)}>
            <User className="w-4 h-4 shrink-0" />
            <span>My Profile</span>
          </NavLink>
        </div>

        {isPrivileged && (
          <div className="space-y-1 pt-2 border-t border-slate-100">
            <div className="px-3 pb-1 text-xs font-semibold text-slate-400">Administration</div>
            <NavLink to="/admin" end className={navItemClass} onClick={() => setMobileOpen(false)}>
              <BarChart3 className="w-4 h-4 shrink-0" />
              <span>Analytics & Jobs</span>
            </NavLink>
            <NavLink
              to="/admin/documents"
              className={navItemClass}
              onClick={() => setMobileOpen(false)}
            >
              <FileStack className="w-4 h-4 shrink-0" />
              <span>Document Library</span>
            </NavLink>
            {isAdmin && (
              <NavLink
                to="/admin/users"
                className={navItemClass}
                onClick={() => setMobileOpen(false)}
              >
                <Users className="w-4 h-4 shrink-0" />
                <span>Users & Departments</span>
              </NavLink>
            )}
          </div>
        )}
      </nav>

      <div className="p-4 border-t border-slate-200 bg-slate-50/70">
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-md bg-slate-200 text-slate-700 flex items-center justify-center text-xs font-semibold shrink-0">
            {user?.fullName
              ?.split(' ')
              .map((p) => p[0])
              .slice(0, 2)
              .join('')
              .toUpperCase() || 'U'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-900 truncate">{user?.fullName}</div>
            <div className="text-xs text-slate-500 truncate">{user?.email}</div>
            <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
              <Shield className="w-3 h-3 shrink-0 text-blue-700" />
              <span className="truncate">{user?.roles.join(', ')}</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <aside className="hidden lg:block shrink-0">{sidebarContent}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 flex">{sidebarContent}</div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-4 sm:px-8 h-16 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-md"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="text-xs text-slate-500 truncate">{breadcrumb}</div>
              <h1 className="text-base sm:text-lg font-semibold text-slate-900 truncate">{title}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {primaryAction ?? (
              location.pathname !== '/chat' && (
                <Link
                  to="/chat"
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
                >
                  Ask Assistant
                </Link>
              )
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-[1440px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
