import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './main';
import { setToken } from './api';

afterEach(() => { cleanup(); setToken(''); vi.restoreAllMocks(); });

test('console rejects invalid authentication with an actionable error', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 401, json: async () => ({ detail: 'Operator authentication required' }) });
  render(<App/>);
  fireEvent.change(screen.getByLabelText('Operator token'), { target: { value: 'wrong-credential' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect securely' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Operator authentication required');
  expect(sessionStorage.getItem('cloudsphere-token')).toBeNull();
});

test('a missing proxy route reports backend routing instead of blaming the token', async () => {
  vi.spyOn(globalThis,'fetch').mockResolvedValue({ ok:false,status:404,json:async()=>{ throw new Error('Not JSON'); } });
  render(<App/>);
  fireEvent.change(screen.getByLabelText('Operator token'),{ target:{ value:'test-token-for-proxy-check' } });
  fireEvent.click(screen.getByRole('button',{ name:'Connect securely' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('CLOUDSPHERE_API_PORT matches');
  expect(sessionStorage.getItem('cloudsphere-token')).toBeNull();
});

test('authenticated empty overview shows observed zeroes and worker instructions', async () => {
  setToken('test-operator-token');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async url => ({ ok: true, json: async () => url.endsWith('/dashboard') ? {
    total: 0, counts: {}, healthy_workers: 0, offline_workers: 0, recent_tasks: [], mode: 'LOCAL'
  } : url.endsWith('/workers') ? [] : { mode: 'LOCAL' } }));
  render(<App/>);
  expect(await screen.findByText('Start a worker daemon to register real compute capacity.')).toBeInTheDocument();
  expect(screen.getByText('Submit an approved workload to see real execution history.')).toBeInTheDocument();
  expect(screen.getByText('LOCAL DEVELOPMENT')).toBeInTheDocument();
  expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(4);
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect console' }));
  await waitFor(() => expect(screen.getByLabelText('Operator token')).toBeInTheDocument());
});
