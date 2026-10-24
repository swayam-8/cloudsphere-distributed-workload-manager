import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Activity, ArrowRight, Check, ChevronRight, Cloud, Eye, EyeOff, HelpCircle, Layers3, LayoutDashboard, ListTodo, LogOut, Menu, Server, Settings2, UploadCloud, X } from 'lucide-react';
import { api, setToken, token } from './api';
import { ButtonContent, ErrorBox, PageHeading, useData } from './components/ui';
import CreateWorkload from './pages/CreateWorkload';
import WorkloadDetail from './pages/WorkloadDetail';
import { Compute, Monitoring, Overview, Settings, WorkerDetail, Workloads } from './pages/WorkspacePages';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import './styles.css';

function Logo() {return <><span className="brand-mark"><Layers3 size={23} strokeWidth={1.7}/></span><span>CloudSphere<small>WORKLOAD WORKSPACE</small></span></>;}

function Login({ onLogin }) {
  const [value,setValue]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[visible,setVisible]=useState(false);
  async function submit(e) {
    e.preventDefault();setBusy(true);setError('');setToken(value.trim());
    try{await api('/dashboard');onLogin();}catch(e){setToken('');setError(e.message);}finally{setBusy(false);}
  }
  return <main className="login-page"><section className="login-story"><div className="brand"><Logo/></div><div className="login-intro"><span className="login-kicker">WORKLOAD ORCHESTRATION</span><h1>Submit workloads.<br/>Track the results.</h1><p>Submit data processing jobs, follow their execution, and keep the results together.</p><ol><li><span>01</span><div><strong>Bring your data</strong><p>Upload a CSV, an image, or a batch of images.</p></div></li><li><span>02</span><div><strong>Choose the processing</strong><p>Set the task and the resources it needs.</p></div></li><li><span>03</span><div><strong>Follow the result</strong><p>See progress and download the finished output.</p></div></li></ol></div><div className="login-story-footer">CloudSphere <span>Distributed workload orchestration</span></div></section><section className="login-form-side"><form onSubmit={submit}><span className="login-form-icon"><Layers3 size={25}/></span><div><span className="eyebrow">WORKSPACE ACCESS</span><h2>Sign in to CloudSphere</h2><p>Enter your operator token to open the workspace.</p></div>{error&&<ErrorBox error={error}/>}<label htmlFor="operator-token">Operator token</label><div className="password-field"><input id="operator-token" type={visible?'text':'password'} autoComplete="off" placeholder="Paste your workspace token" required value={value} onChange={e=>setValue(e.target.value)}/><button className="icon-button" type="button" aria-label={visible?'Hide token':'Show token'} onClick={()=>setVisible(v=>!v)}>{visible?<EyeOff size={17}/>:<Eye size={17}/>}</button></div><button className="primary" disabled={busy}><ButtonContent busy={busy}>{busy?'Signing in…':'Open workspace'}</ButtonContent>{!busy&&<ArrowRight size={17}/>}</button><details className="token-help"><summary>Where do I find my token?</summary><p>For local development, open <code>.local/dev.env</code> in your project folder and copy the value after <code>CLOUDSPHERE_OPERATOR_TOKEN=</code>. Keep the file private.</p></details><p className="login-note">Your token is kept in this browser tab’s session.</p></form></section></main>;
}

const navigation=[['/','Overview',LayoutDashboard],['/workloads','Workloads',ListTodo],['/compute','Compute',Server],['/monitoring','Monitoring',Activity],['/settings','Settings',Settings2]];

function HelpDialog({ close }) {
  const dialog=useRef(null);
  useEffect(()=>{dialog.current?.showModal?.();},[]);
  return <dialog className="help-dialog" aria-labelledby="help-title" ref={dialog} onCancel={close} onClick={e=>{if(e.target===dialog.current)close();}}><div className="help-header"><span className="brand-mark"><Layers3 size={22}/></span><button className="icon-button" aria-label="Close help" onClick={close}><X size={20}/></button></div><span className="eyebrow">GETTING STARTED</span><h2 id="help-title">How a workload runs</h2><ol className="help-steps"><li><strong>1. Create a workload</strong><p>Select CSV processing, image processing, or a CPU benchmark. Upload an input file when your job needs one.</p></li><li><strong>2. Review and submit</strong><p>Choose the processing options, name your workload, and confirm its resource settings. CloudSphere adds it to the queue.</p></li><li><strong>3. Follow execution</strong><p>A healthy worker with enough capacity runs the job. Open the workload to see progress, attempts, logs, and the assignment decision.</p></li><li><strong>4. Collect your results</strong><p>When the job finishes, download the ZIP containing the output and processing report.</p></li></ol><button className="primary" onClick={close}>Got it<Check size={15}/></button></dialog>;
}

function Shell({ logout }) {
  const [open,setOpen]=useState(false),[toast,setToast]=useState(null),[help,setHelp]=useState(false);
  const location=useLocation(),cloud=useData('/cloud/status');
  const page=location.pathname==='/workloads/new'?'New workload':/^\/workloads\/.+/.test(location.pathname)?'Workload details':/^\/compute\/.+/.test(location.pathname)?'Worker details':navigation.find(([path])=>path===location.pathname)?.[1]||'Page not found';
  useEffect(()=>{setOpen(false);document.title=`${page} · CloudSphere`;},[location.pathname,page]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),6000);return()=>clearTimeout(timer);},[toast]);
  function notify(message,error=false){setToast({message,error});}
  const mode=cloud.data?.mode;
  return <div className="app-shell"><a className="skip-link" href="#main-content">Skip to content</a>{open&&<button className="nav-scrim" aria-label="Close navigation overlay" onClick={()=>setOpen(false)}/>}
    <aside className={`sidebar ${open?'open':''}`}><Link className="brand" to="/"><Logo/></Link><Link className="sidebar-create" to="/workloads/new" onClick={()=>setOpen(false)}><UploadCloud size={18}/> New workload <span aria-hidden="true">+</span></Link><div className="nav-label">WORKSPACE</div><nav aria-label="Workspace navigation">{navigation.slice(0,2).map(([path,name,Icon])=><NavLink end={path==='/'} key={path} to={path}><Icon size={18}/>{name}</NavLink>)}<div className="nav-label">INFRASTRUCTURE</div>{navigation.slice(2,4).map(([path,name,Icon])=><NavLink key={path} to={path}><Icon size={18}/>{name}</NavLink>)}</nav><div className="sidebar-bottom"><NavLink className="settings-link" to="/settings"><Settings2 size={18}/>Settings</NavLink><button onClick={()=>setHelp(true)} className="sidebar-help"><HelpCircle size={18}/>How it works</button><div className="workspace-card"><span className="workspace-avatar"><Layers3 size={18}/></span><div><strong>{mode==='AWS'?'Cloud workspace':'Local workspace'}</strong><small>{mode==='LOCAL'?'AWS not connected':mode==='AWS'?'AWS configured':'Connecting…'}</small></div></div><button className="logout" onClick={logout}><LogOut size={16}/>Sign out</button></div></aside>
    <div className="workspace"><header className="topbar"><button className="icon-button mobile-menu" aria-label="Toggle navigation" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{open?<X size={20}/>:<Menu size={20}/>}</button><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14}/><strong>{page}</strong></div><div className={`environment ${mode?.toLowerCase()||''}`}><Cloud size={14}/>{mode==='LOCAL'?'Local environment':mode==='AWS'?'AWS configured':'Connecting…'}</div><button className="icon-button help-button" aria-label="How CloudSphere works" onClick={()=>setHelp(true)}><HelpCircle size={19}/></button><span className="operator-avatar" title="Operator workspace">OP</span></header>
      <main id="main-content" className="content"><Routes><Route path="/" element={<Overview/>}/><Route path="/workloads" element={<Workloads/>}/><Route path="/workloads/new" element={<CreateWorkload notify={notify}/>}/><Route path="/workloads/:id" element={<WorkloadDetail notify={notify}/>}/><Route path="/compute" element={<Compute/>}/><Route path="/compute/:id" element={<WorkerDetail/>}/><Route path="/monitoring" element={<Monitoring/>}/><Route path="/settings" element={<Settings notify={notify}/>}/><Route path="*" element={<div className="not-found"><span>404</span><PageHeading title="This page isn’t here">Return to your workspace to find a workload or start a new one.</PageHeading><Link className="button primary" to="/">Back to overview<ArrowRight size={16}/></Link></div>}/></Routes><footer><span>CloudSphere<span className="footer-divider">/</span>Workload workspace</span><button className="text-button" onClick={()=>setHelp(true)}>How it works <ArrowRight size={13}/></button></footer></main>
    </div>{help&&<HelpDialog close={()=>setHelp(false)}/>} {toast&&<div className={`toast ${toast.error?'toast-error':''}`} role={toast.error?'alert':'status'}><span>{toast.error?<HelpCircle size={18}/>:<Check size={18}/>}</span><p>{toast.message}</p><button className="icon-button" aria-label="Dismiss notification" onClick={()=>setToast(null)}><X size={15}/></button></div>}
  </div>;
}

export function App() {
  const [loggedIn,setLoggedIn]=useState(Boolean(token));
  return loggedIn?<BrowserRouter><Shell logout={()=>{setToken('');setLoggedIn(false);}}/></BrowserRouter>:<Login onLogin={()=>setLoggedIn(true)}/>;
}
if(document.getElementById('root'))createRoot(document.getElementById('root')).render(<App/>);
