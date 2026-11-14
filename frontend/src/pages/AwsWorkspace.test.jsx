import React from 'react';
import {test,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import AwsWorkspace from './AwsWorkspace';
import {api} from '../api';
vi.mock('../api',()=>({api:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const data=()=>({mode:'LOCAL',enabled:false,account:null,region:null,queue:null,definition:null,bucket:null,audit_table:null,log_group:null,missing:['Batch queue'],verification:{status:'not_checked',checked_at:null},evidence:{recorded_jobs:0,completed_jobs:0,synced_audit_events:0,log_streams:0,compute:[],latest_image:null},recent_tasks:[]});

test('AWS page is useful in local mode and keeps the eight service details secondary',async()=>{
  api.mockResolvedValue(data());render(<MemoryRouter><AwsWorkspace/></MemoryRouter>);
  expect(await screen.findByRole('heading',{name:'AWS is not active in this launch'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Verify AWS connection'})).toBeDisabled();
  expect(screen.getByRole('heading',{name:'No AWS workloads yet'})).toBeInTheDocument();
  const disclosure=screen.getByText(/AWS services & console links/).closest('details');expect(disclosure).not.toHaveAttribute('open');
  expect(disclosure.querySelectorAll('tbody tr')).toHaveLength(8);
  expect(screen.getByLabelText('Open AWS Batch console')).toHaveAttribute('href',expect.stringContaining('eu-north-1'));
  expect(api.mock.calls.every(([route])=>route==='/cloud/overview')).toBe(true);
});

test('connection verification refreshes server evidence and never submits a workload',async()=>{
  let verified=false;
  api.mockImplementation(async route=>{if(route==='/cloud/batch/verify'){verified=true;return {connected:true};}const d=data();return {...d,mode:'AWS',enabled:true,region:'eu-north-1',verification:verified?{status:'passed',checked_at:'2026-01-01T00:00:00Z',details:{queue:'real-queue'}}:d.verification};});
  render(<MemoryRouter><AwsWorkspace/></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'Verify AWS connection'}));
  expect(await screen.findByText('Core connection checked')).toBeInTheDocument();
  expect(api).toHaveBeenCalledWith('/cloud/batch/verify',{method:'POST',body:'{}'});
  expect(api.mock.calls.some(([route])=>route==='/tasks')).toBe(false);
});
