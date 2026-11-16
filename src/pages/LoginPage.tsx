import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, BookOpen, Loader2, Lock } from 'lucide-react';
import { apiClient, extractApiErrorMessage } from '../api/client';
import { useAuth } from '../hooks/useAuth';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: policy } = useQuery({
    queryKey: ['auth-policy'],
    queryFn: async () => {
      const res = await apiClient.get<{
        allowSelfRegistration: boolean;
        demoSeedEnabled: boolean;
        llmProvider: string;
      }>('/auth/policy');
      return res.data;
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Please enter both email and password.');
      return;
    }
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate('/');
    } catch (err) {
      setError(extractApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemoAccount = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('KnowledgeDemo!2026');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex items-center justify-center gap-2.5">
          <span className="w-9 h-9 rounded-lg bg-blue-700 text-white flex items-center justify-center">
            <BookOpen className="w-5 h-5" />
          </span>
          <span className="text-2xl font-bold tracking-tight text-slate-900">KnowledgeAssist</span>
        </div>
        <h1 className="mt-4 text-center text-lg font-semibold text-slate-900">
          Sign in to your enterprise workspace
        </h1>
        <p className="mt-1 text-center text-sm text-slate-500">
          Permission-verified internal document intelligence
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          {error && (
            <div
              role="alert"
              className="mb-5 p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
                Work Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 placeholder:text-slate-400"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 placeholder:text-slate-400"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Sign In</span>
                </>
              )}
            </button>
          </form>

          {policy?.allowSelfRegistration !== false && (
            <div className="mt-5 pt-5 border-t border-slate-100 text-center text-sm text-slate-600">
              Need an employee account?{' '}
              <Link to="/register" className="font-semibold text-blue-700 hover:underline">
                Register here
              </Link>
            </div>
          )}

          {policy?.demoSeedEnabled && (
            <div className="mt-6 pt-5 border-t border-slate-200">
              <div className="text-xs font-semibold text-slate-500 mb-2.5">
                Development Seed Accounts (Prefill Credentials)
              </div>
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => fillDemoAccount('admin@knowledgeassist.local')}
                  className="text-left px-3 py-2 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-between"
                >
                  <span className="font-medium text-slate-800">admin@knowledgeassist.local</span>
                  <span className="text-slate-500">Admin · Security & Eng</span>
                </button>
                <button
                  type="button"
                  onClick={() => fillDemoAccount('alex.eng@knowledgeassist.local')}
                  className="text-left px-3 py-2 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-between"
                >
                  <span className="font-medium text-slate-800">alex.eng@knowledgeassist.local</span>
                  <span className="text-slate-500">Employee · Engineering</span>
                </button>
                <button
                  type="button"
                  onClick={() => fillDemoAccount('sam.finance@knowledgeassist.local')}
                  className="text-left px-3 py-2 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-between"
                >
                  <span className="font-medium text-slate-800">sam.finance@knowledgeassist.local</span>
                  <span className="text-slate-500">Employee · Finance</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
