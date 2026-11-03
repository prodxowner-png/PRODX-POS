import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import type { Task } from '../types/task';

const taskApi = '/api/v1/tasks';

async function request<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message || `Task API request failed (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function useTasks() {
  const { session } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session?.token) {
      setTasks([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const data = await request<Task[]>(taskApi, session.token);
      setTasks(data);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load tasks.');
    } finally {
      setLoading(false);
    }
  }, [session?.token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const requireSessionToken = (): string => {
    if (!session?.token) throw new Error('Sign in through the PRODX POS session before managing tasks.');
    return session.token;
  };

  const addTask = async (title: string, description?: string) => {
    const token = requireSessionToken();
    const task = await request<Task>(taskApi, token, {
      method: 'POST',
      body: JSON.stringify({ id: crypto.randomUUID(), title: title.trim(), description: description || '' }),
    });
    setTasks((previous) => [task, ...previous.filter((item) => item.id !== task.id)]);
    setError(null);
    return task;
  };

  const updateTaskStatus = async (taskId: string, completed: boolean) => {
    const token = requireSessionToken();
    const task = await request<Task>(`${taskApi}/${encodeURIComponent(taskId)}`, token, {
      method: 'PATCH', body: JSON.stringify({ completed }),
    });
    setTasks((previous) => previous.map((item) => item.id === task.id ? task : item));
    setError(null);
  };

  const deleteTask = async (taskId: string) => {
    const token = requireSessionToken();
    await request<void>(`${taskApi}/${encodeURIComponent(taskId)}`, token, { method: 'DELETE' });
    setTasks((previous) => previous.filter((item) => item.id !== taskId));
    setError(null);
  };

  return { tasks, loading, error, addTask, updateTaskStatus, deleteTask, refresh };
}
