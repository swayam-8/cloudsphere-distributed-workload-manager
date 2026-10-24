import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CreateWorkload from './CreateWorkload';
import { api, uploadFile } from '../api';

vi.mock('../api',()=>({api:vi.fn(),uploadFile:vi.fn(),saveBlob:vi.fn()}));
beforeEach(()=>{
  api.mockImplementation(async(path,options)=>options?.method==='POST'?{id:'created-task'}:[]);
  uploadFile.mockResolvedValue({id:'uploaded-input'});
});
afterEach(()=>{cleanup();vi.clearAllMocks();});
function open(){render(<MemoryRouter initialEntries={['/workloads/new']}><Routes><Route path="/workloads/new" element={<CreateWorkload notify={vi.fn()}/>}/><Route path="/workloads/:id" element={<p>Submitted workload details</p>}/></Routes></MemoryRouter>);}
async function reviewCSV(){
  const file=new File(['category,amount\nbooks,12.5\nhardware,32\n'],'sales.csv',{type:'text/csv'});
  fireEvent.change(screen.getByLabelText('Upload CSV file'),{target:{files:[file]}});
  await screen.findByRole('columnheader',{name:'category'});
  fireEvent.click(screen.getByRole('button',{name:'Continue'}));
  fireEvent.change(screen.getByLabelText(/Workload name/),{target:{value:'Sales totals'}});
  fireEvent.change(screen.getByLabelText(/Group rows by/),{target:{value:'category'}});
  fireEvent.change(screen.getByLabelText(/Calculate the sum of/),{target:{value:'amount'}});
  fireEvent.click(screen.getByRole('button',{name:'Continue'}));
  return file;
}
test('new workload starts with a visible CSV upload and will not advance without input',async()=>{
  open();expect(screen.getByRole('button',{name:'Browse files'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Continue'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose a nonempty file');
  expect(uploadFile).not.toHaveBeenCalled();
});
test('CSV file preview, selected columns and confirmed settings are sent to the real API contract',async()=>{
  open();const file=await reviewCSV();
  expect(screen.getByRole('heading',{name:'Ready to submit'})).toBeInTheDocument();
  expect(uploadFile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Submit workload'}));
  expect(await screen.findByText('Submitted workload details')).toBeInTheDocument();
  expect(uploadFile).toHaveBeenCalledWith(file,expect.any(Function),expect.any(AbortSignal));
  const call=api.mock.calls.find(([path,options])=>path==='/tasks'&&options?.method==='POST');
  expect(JSON.parse(call[1].body)).toMatchObject({name:'Sales totals',kind:'csv',input_id:'uploaded-input',parameters:{group_by:'category',value_column:'amount'},cpu:1,memory_mb:256});
});
test('upload failure is visible and does not create a task',async()=>{
  open();await reviewCSV();uploadFile.mockRejectedValueOnce(new Error('Upload storage is unavailable.'));
  fireEvent.click(screen.getByRole('button',{name:'Submit workload'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Upload storage is unavailable');
  expect(api.mock.calls.filter(([path])=>path==='/tasks')).toHaveLength(0);
});
test('a failed task submission reuses the completed upload when retried',async()=>{
  open();await reviewCSV();
  let attempts=0;
  api.mockImplementation(async(path,options)=>{
    if(options?.method==='POST'){if(++attempts===1)throw new Error('Queue temporarily unavailable.');return{id:'created-task'};}
    return[];
  });
  fireEvent.click(screen.getByRole('button',{name:'Submit workload'}));
  await screen.findByRole('alert');
  await waitFor(()=>expect(screen.getByRole('button',{name:'Submit workload'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Submit workload'}));
  await screen.findByText('Submitted workload details');
  expect(uploadFile).toHaveBeenCalledTimes(1);
});

test('a practical sample explains its output and submits the corresponding cleaning rules',async()=>{
  open();expect(screen.getByText(/North: 2 orders, total 3,000/)).toBeInTheDocument();
  const card=screen.getByRole('heading',{name:'Clean a messy dataset'}).closest('article');
  fireEvent.click(card.querySelector('button'));
  await screen.findByRole('columnheader',{name:'order_id'});
  fireEvent.click(screen.getByRole('button',{name:'Continue'}));
  expect(screen.getByLabelText(/Group rows by/)).toHaveValue('category');
  expect(screen.getByLabelText(/Calculate the sum of/)).toHaveValue('amount');
  expect(screen.getByLabelText('Remove exact duplicate rows')).toBeChecked();
  expect(screen.getByLabelText('Remove rows with any empty cell')).toBeChecked();
  expect(screen.getByLabelText(/If the numeric column/)).toHaveValue('skip');
  fireEvent.click(screen.getByRole('button',{name:'Continue'}));
  fireEvent.click(screen.getByRole('button',{name:'Submit workload'}));
  await screen.findByText('Submitted workload details');
  const call=api.mock.calls.find(([path,options])=>path==='/tasks'&&options?.method==='POST');
  expect(JSON.parse(call[1].body).parameters).toMatchObject({group_by:'category',value_column:'amount',deduplicate:true,drop_missing:true,invalid_numeric:'skip'});
});
