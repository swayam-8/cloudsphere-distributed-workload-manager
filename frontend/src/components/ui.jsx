import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowUpRight, Check, ChevronRight, FileImage, FileSpreadsheet, Inbox, LoaderCircle, RefreshCw, Terminal } from 'lucide-react';
import { api } from '../api';

export const templates = {
  csv: { name:'CSV data processing', short:'CSV processing', icon:FileSpreadsheet, description:'Group records and calculate totals from a CSV file.', output:'An aggregated CSV and processing report', accepts:'.csv' },
  images: { name:'Image processing', short:'Image processing', icon:FileImage, description:'Resize images and generate a set of thumbnails.', output:'Processed PNG images and a manifest', accepts:'.zip,.png,.jpg,.jpeg' },
  cpu: { name:'CPU benchmark', short:'CPU benchmark', icon:Terminal, description:'Run a prime-number calculation to measure compute performance.', output:'Prime count, checksum and execution timings', accepts:'' },
};
export const policies = { resource_aware:'Resource aware', round_robin:'Round robin', least_loaded:'Least loaded' };
const statuses = { QUEUED:'Queued', ASSIGNED:'Scheduled', RUNNING:'Running', COMPLETED:'Completed', FAILED:'Failed', CANCELLED:'Cancelled', LOST:'Interrupted', HEALTHY:'Online', OFFLINE:'Offline', ELIGIBLE:'Eligible', REJECTED:'Not eligible' };
export const date = value => value ? new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
export const bytes = value => value == null ? '—' : value < 1024 ? `${value} B` : value < 1048576 ? `${(value/1024).toFixed(1)} KB` : `${(value/1048576).toFixed(1)} MB`;
export function duration(seconds) { return seconds == null ? '—' : seconds>0 && seconds<0.1 ? '<0.1s' : seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds/60)}m ${Math.round(seconds%60)}s`; }
export function workerName(name) { const match=name?.match(/^worker-([ab])(?:-api\d+)?$/i); return match ? `Worker ${match[1].toUpperCase()}` : name; }
export function Badge({ value }) { return <span className={`badge ${value?.toLowerCase()}`}><i/>{statuses[value] || value || 'Unknown'}</span>; }
export function JobIcon({ kind }) { const Icon=templates[kind]?.icon || Inbox; return <span className={`job-icon ${kind}`}><Icon size={18}/></span>; }
export function Empty({ title='Nothing here yet', children, action, icon:Icon=Inbox }) { return <div className="empty"><span className="empty-icon"><Icon size={25}/></span><h3>{title}</h3><p>{children}</p>{action}</div>; }
export function ErrorBox({ error, onRetry }) { return <div role="alert" className="error"><AlertCircle size={18}/><div><strong>Something needs your attention</strong><p>{error}</p></div>{onRetry && <button className="button subtle" onClick={onRetry}>Try again</button>}</div>; }
export function Loading() { return <div className="loading-state" role="status" aria-label="Loading data"><div className="skeleton-line wide"/><div className="skeleton-line"/><div className="skeleton-line wide"/></div>; }
export function Panel({ title, description, extra, children, className='' }) { return <section className={`panel ${className}`}><div className="panel-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{extra}</div>{children}</section>; }
export function PageHeading({ section, title, children, action }) { return <div className="page-heading"><div>{section && <div className="eyebrow">{section}</div>}<h1>{title}</h1>{children && <p>{children}</p>}</div>{action}</div>; }
export function ButtonContent({ busy, children }) { return <>{busy && <LoaderCircle size={16} className="spin"/>}{children}</>; }

export function useData(path, { interval=5000 }={}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[updated,setUpdated]=useState(null),[live,setLive]=useState(true),[revision,setRevision]=useState(0);
  const previous=useRef(null);
  const refresh=useCallback(()=>setRevision(n=>n+1),[]);
  useEffect(()=>{
    const controller=new AbortController(); let busy=false;
    if(previous.current!==path) { setData(null);setUpdated(null);previous.current=path; }
    async function load() {
      if(busy)return;busy=true;
      try { const result=await api(path,{signal:controller.signal});if(!controller.signal.aborted){setData(result);setError('');setUpdated(new Date().toISOString());} }
      catch(e){if(!controller.signal.aborted)setError(e.message);}
      finally{busy=false;}
    }
    load();const timer=live?setInterval(load,interval):null;
    return()=>{controller.abort();clearInterval(timer);};
  },[path,live,revision,interval]);
  return {data,error,updated,live,setLive,refresh};
}
export function RefreshTools({ query }) { return <div className="refresh-tools"><span>{query.updated ? `Updated ${new Date(query.updated).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}` : 'Connecting…'}</span><label className="live-toggle"><input type="checkbox" checked={query.live} onChange={e=>query.setLive(e.target.checked)}/><span>Live updates</span></label><button className="icon-button" aria-label="Refresh data" title="Refresh data" onClick={query.refresh}><RefreshCw size={15}/></button></div>; }
export function DataView({ query, children }) { return <>{query.error && <ErrorBox error={query.error} onRetry={query.refresh}/>} {query.data===null ? !query.error && <Loading/> : children(query.data)}</>; }

export function TaskTable({ tasks, emptyAction=true }) {
  if(!tasks.length)return <Empty title="Your first workload starts here" action={emptyAction && <Link className="button primary" to="/workloads/new">Create workload<ChevronRight size={15}/></Link>}>Upload CSV data or images, choose the processing options, and submit your job. Its progress and results will appear here.</Empty>;
  return <div className="table-wrap"><table><thead><tr><th>Workload</th><th>Status</th><th>Resources</th><th>Priority</th><th>Submitted</th><th><span className="sr-only">Open workload</span></th></tr></thead><tbody>{tasks.map(task=><tr key={task.id}><td><Link className="workload-link" to={`/workloads/${task.id}`}><JobIcon kind={task.kind}/><span><strong>{task.name}</strong><small>{templates[task.kind]?.short}</small></span></Link></td><td><Badge value={task.status}/></td><td>{task.cpu} vCPU<small>{task.memory_mb} MB memory</small></td><td><span className={`priority priority-${task.priority}`}><i/>{['Low','Normal','High'][task.priority]}</span></td><td className="muted">{date(task.created_at)}</td><td><Link className="table-action" to={`/workloads/${task.id}`} aria-label={`Open ${task.name}`}><ArrowUpRight size={17}/></Link></td></tr>)}</tbody></table></div>;
}
export function Steps({ current, items }) { return <ol className="steps" aria-label="Workload progress">{items.map((name,index)=><li className={index===current?'current':index<current?'done':''} key={name} aria-current={index===current?'step':undefined}><span>{index<current?<Check size={14}/>:index+1}</span><strong>{name}</strong></li>)}</ol>; }
