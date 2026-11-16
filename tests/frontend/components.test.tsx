// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../src/api/client';
import { AuthProvider } from '../../src/hooks/useAuth';
import { AppLayout } from '../../src/layouts/AppLayout';
import { ChatPage } from '../../src/pages/ChatPage';
import { LoginPage } from '../../src/pages/LoginPage';

function renderWithProviders(ui: React.ReactElement, initialRoute = '/') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialRoute]}>{ui}</MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe('KnowledgeAssist Frontend Component Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders login page and displays API authentication errors', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { allowSelfRegistration: true, demoSeedEnabled: false, llmProvider: 'test' },
    });
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('Invalid email or password.'));

    renderWithProviders(<LoginPage />, '/login');

    fireEvent.change(screen.getByLabelText(/Work Email/i), {
      target: { value: 'user@company.com' },
    });
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: 'BadPassword1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password.');
    });
  });

  it('hides Admin navigation links for standard EMPLOYEE accounts', async () => {
    localStorage.setItem('ka_access_token', 'fake-token');
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        id: 'u1',
        email: 'emp@company.com',
        fullName: 'Alex Rivera',
        isActive: true,
        roles: ['EMPLOYEE'],
        departmentIds: [],
      },
    });

    renderWithProviders(
      <AppLayout title="Overview" breadcrumb="Workspace / Overview">
        <div>Main content</div>
      </AppLayout>
    );

    await waitFor(() => {
      expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
    });
    expect(screen.queryByText('Analytics & Jobs')).not.toBeInTheDocument();
    expect(screen.queryByText('Users & Departments')).not.toBeInTheDocument();
  });

  it('submits chat question and expands verified source citations', async () => {
    localStorage.setItem('ka_access_token', 'fake-token');
    vi.spyOn(apiClient, 'get').mockImplementation(async (url) => {
      if (url === '/users/me') {
        return {
          data: {
            id: 'u1',
            email: 'emp@company.com',
            fullName: 'Alex Rivera',
            isActive: true,
            roles: ['EMPLOYEE'],
            departmentIds: [],
          },
        };
      }
      if (url === '/conversations') {
        return { data: { conversations: [] } };
      }
      return { data: {} };
    });

    vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: {
        conversationId: 'conv-1',
        messageId: 'msg-2',
        answer: 'Employees accrue 22 days of PTO annually.',
        confidence: 'HIGH',
        citations: [
          {
            documentId: 'doc-1',
            documentName: 'Employee_Handbook_2026',
            documentVersion: 1,
            pageNumber: 2,
            chunkId: 'chunk-1',
            excerpt: 'Full-time employees accrue 22 days of Paid Time Off (PTO) annually.',
          },
        ],
        followUpQuestions: ['Can unused PTO carry over?'],
        retrievalMetadata: {
          retrievedChunkCount: 3,
          model: 'gemini-4-hydrogen',
          grounded: true,
          abstained: false,
          totalLatencyMs: 120,
        },
      },
    });

    renderWithProviders(<ChatPage />, '/chat');

    const input = await screen.findByPlaceholderText(/Ask a question grounded/i);
    fireEvent.change(input, { target: { value: 'How many PTO days do we get?' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/chat', {
        question: 'How many PTO days do we get?',
        conversationId: undefined,
      });
    });
  });
});
