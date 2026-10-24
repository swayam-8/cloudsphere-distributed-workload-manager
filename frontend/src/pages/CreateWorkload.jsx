import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, CheckCircle2, FileCheck2, FileSpreadsheet, Info, LoaderCircle, Server, UploadCloud, X } from 'lucide-react';
import { api, saveBlob, uploadFile } from '../api';
import { bytes, ButtonContent, ErrorBox, JobIcon, PageHeading, Steps, templates, useData } from '../components/ui';
import { previewCSV, validateFile } from '../lib/files';
import DatasetGuide from '../components/DatasetGuide';
import { datasets, csvRules } from '../lib/datasets';

const defaults={name:'',cpu:'1',memory:'256',priority:'1',timeout:'180',retries:'2',group:'',value:'',width:'256',limit:'100000'};

export default function CreateWorkload({ notify }) {
  const [search,setSearch]=useSearchParams();
  const kind=Object.hasOwn(templates,search.get('type'))?search.get('type'):'csv';
  const [step,setStep]=useState(0),[file,setFile]=useState(null),[preview,setPreview]=useState(null),[previewError,setPreviewError]=useState('');
  const [rules,setRules]=useState(csvRules);
  const [values,setValues]=useState(defaults),[error,setError]=useState(''),[drag,setDrag]=useState(false),[phase,setPhase]=useState(''),[progress,setProgress]=useState(0),[uploaded,setUploaded]=useState(null),[imageUrl,setImageUrl]=useState('');
  const input=useRef(null),controller=useRef(null),mounted=useRef(true);
  const workers=useData('/workers'),navigate=useNavigate(),busy=Boolean(phase);
  const field=name=>({value:values[name],onChange:e=>setValues(v=>({...v,[name]:e.target.value}))});
  useEffect(()=>()=>{mounted.current=false;controller.current?.abort();},[]);
  useEffect(()=>{
    setPreview(null);setPreviewError('');setImageUrl('');
    if(!file)return;
    let active=true,url;
    if(kind==='csv') {
      const reader=new FileReader();
      reader.onload=()=>{if(!active)return;try{setPreview(previewCSV(String(reader.result)));}catch(e){setPreviewError(e.message);}};
      reader.onerror=()=>{if(active)setPreviewError('The preview could not be read. The worker will validate the file when it runs.');};
      reader.readAsText(file.slice(0,65536));
    } else if(file.type.startsWith('image/') && typeof URL.createObjectURL==='function') {url=URL.createObjectURL(file);setImageUrl(url);}
    return()=>{active=false;if(url)URL.revokeObjectURL(url);};
  },[file,kind]);

  function chooseKind(next) {setSearch({type:next},{replace:true});setFile(null);setUploaded(null);setPreview(null);setError('');setValues(v=>({...v,group:'',value:''}));}
  function chooseFile(selected) {
    const message=validateFile(selected,kind);setError(message);if(message)return;
    setFile(selected);setUploaded(null);
    setValues(v=>({...v,name:v.name || selected.name.replace(/\.[^.]+$/,'').replaceAll('_',' ').replaceAll('-',' '),group:'',value:''}));
  }
  function next(e) {
    e?.preventDefault();setError('');
    if(step===0 && kind!=='cpu'){const message=validateFile(file,kind);if(message){setError(message);return;}}
    if(step===1 && !values.name.trim()){setError('Give your workload a name before continuing.');return;}
    setStep(n=>n+1);
  }
  async function submit(e) {
    e.preventDefault();if(step<2){next();return;}
    setError('');controller.current=new AbortController();
    try {
      let inputId=null;
      if(kind!=='cpu') {
        const message=validateFile(file,kind);if(message)throw new Error(message);
        if(uploaded?.file===file)inputId=uploaded.id;
        else {
          setPhase('upload');setProgress(0);
          const artifact=await uploadFile(file,setProgress,controller.current.signal);
          inputId=artifact.id;setUploaded({file,id:inputId});
        }
      }
      setPhase('submit');
      const parameters=kind==='csv'?{group_by:values.group,value_column:values.value,...rules}:kind==='images'?{width:Number(values.width)}:{limit:Number(values.limit)};
      const task=await api('/tasks',{method:'POST',signal:controller.current.signal,body:JSON.stringify({name:values.name.trim(),kind,parameters,input_id:inputId,cpu:Number(values.cpu),memory_mb:Number(values.memory),priority:Number(values.priority),timeout_seconds:Number(values.timeout),max_retries:Number(values.retries)})});
      if(mounted.current){notify('Workload submitted. You can follow its progress here.');navigate(`/workloads/${task.id}`);}
    } catch(e){if(mounted.current && e.name!=='AbortError')setError(e.message);}
    finally{if(mounted.current)setPhase('');}
  }
  function useSample(id) {
    const d=datasets[id];chooseFile(new File([d.csv],`${id}-sample.csv`,{type:'text/csv'}));
    setValues(v=>({...v,name:d.title,group:d.group,value:d.value}));
    setRules({...csvRules,deduplicate:Boolean(d.clean),drop_missing:Boolean(d.clean),invalid_numeric:d.clean?'skip':'fail'});
  }
  function sample() {saveBlob(new Blob(['category,amount\nbooks,12.50\nhardware,32.00\nbooks,7.50\nhardware,18.00\n'],{type:'text/csv'}),'sample-sales.csv');}
  const online=workers.data?.filter(w=>w.state==='HEALTHY') || [];
  const available=online.filter(w=>w.cpu-w.reserved.cpu>=Number(values.cpu) && w.memory_mb-w.reserved.memory_mb>=Number(values.memory) && w.reserved.jobs<w.max_parallel).length;
  const template=templates[kind];

  return <>
    <Link className="back-link" to="/workloads"><ArrowLeft size={14}/> Back to workloads</Link>
    <PageHeading section="NEW WORKLOAD" title="Create a workload">Upload your data, choose the processing options, and review your job.</PageHeading>
    <div className="create-layout">
      <form className="workflow-panel" onSubmit={submit} onInvalidCapture={e=>{const details=e.target.closest('details');if(details)details.open=true;}}>
        <Steps current={step} items={['Choose input','Configure','Review & submit']}/>
        {error && <div className="form-error"><ErrorBox error={error}/></div>}
        <fieldset disabled={busy}>
          {step===0 && <div className="step-body">
            <div className="step-intro"><span className="section-number">01</span><div><h2>Choose a workload</h2><p>Start with the kind of data you want to process.</p></div></div>
            <div className="template-choices">{Object.entries(templates).map(([key,t])=>{const Icon=t.icon;return <button type="button" key={key} aria-pressed={kind===key} className={`template-choice ${kind===key?'selected':''}`} onClick={()=>chooseKind(key)}><Icon size={21}/><strong>{t.short}</strong><small>{key==='csv'?'.csv files':key==='images'?'Images or .zip':'No file required'}</small><span className="radio-mark">{kind===key && <i/>}</span></button>;})}</div>
            {kind!=='cpu' ? <>
              <div className="field-heading"><h3>Upload your {kind==='csv'?'CSV file':'images'}</h3><span>Maximum 10 MB</span></div>
              <input ref={input} tabIndex={-1} className="sr-only" id="workload-file" type="file" accept={template.accepts} aria-label={kind==='csv'?'Upload CSV file':'Upload image or ZIP file'} onChange={e=>{if(e.target.files?.[0])chooseFile(e.target.files[0]);e.target.value='';}}/>
              {!file ? <div className={`dropzone ${drag?'dragging':''}`} onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);if(e.dataTransfer.files.length!==1){setError('Upload one CSV, image, or ZIP file at a time.');return;}chooseFile(e.dataTransfer.files[0]);}}>
                <span className="upload-icon"><UploadCloud size={27}/></span><h3>Drag and drop your file here</h3><p>{kind==='csv'?'A CSV file with column headers in the first row.':'A PNG, JPG, or ZIP containing up to 100 images.'}</p><button type="button" className="button primary" onClick={()=>input.current?.click()}>Browse files</button><small>{kind==='csv'?'CSV files only':'PNG, JPG, JPEG or ZIP'} · Up to 10 MB</small>
              </div> : <div className="selected-file"><JobIcon kind={kind}/><div><strong>{file.name}</strong><small>{bytes(file.size)} · Ready to upload</small></div><CheckCircle2 size={18} className="success-text"/><button type="button" className="icon-button" aria-label="Remove selected file" onClick={()=>{setFile(null);setUploaded(null);}}><X size={17}/></button></div>}
              {preview && <div className="preview"><div className="preview-heading"><span><FileSpreadsheet size={15}/> Data preview</span><small>{preview.headers.length} columns · first {preview.rows.length} rows</small></div><div className="table-wrap"><table><thead><tr>{preview.headers.map((h,i)=><th key={i}>{h || '(empty header)'}</th>)}</tr></thead><tbody>{preview.rows.map((row,index)=><tr key={index}>{row.map((cell,i)=><td key={i} title={cell}>{cell || '—'}</td>)}</tr>)}</tbody></table></div></div>}
              {previewError && <p className="field-note"><Info size={15}/> Preview unavailable: {previewError}</p>}
              {imageUrl && <div className="image-preview"><img src={imageUrl} alt={`Preview of ${file.name}`}/><div><strong>Original image</strong><p>Aspect ratio will be preserved. Your original file stays unchanged.</p></div></div>}
              {kind==='csv' && <div className="sample-link"><span>Just trying it out?</span><button type="button" onClick={sample}><ArrowDownToLine size={14}/> Download a sample CSV</button></div>}
              {kind==='csv' && <DatasetGuide onUse={useSample}/>}
            </> : <div className="benchmark-intro"><JobIcon kind="cpu"/><div><h3>No file upload needed</h3><p>This job calculates prime numbers up to a limit you choose. Use it to see how workers handle a computational task.</p></div></div>}
          </div>}

          {step===1 && <div className="step-body">
            <div className="step-intro"><span className="section-number">02</span><div><h2>Configure processing</h2><p>Tell us what to do with {kind==='cpu'?'this calculation':file?.name}.</p></div></div>
            <label>Workload name<input name="name" maxLength={120} required placeholder="e.g. Monthly sales summary" {...field('name')}/><small>A name that will help you find this job later.</small></label>
            <div className="form-section"><h3>Processing options</h3>{kind==='csv' ? <div className="form-grid">
              <label>Group rows by{preview ? <select name="group_by" {...field('group')}><option value="">All rows together</option>{preview.headers.map((h,i)=><option key={i} value={h}>{h}</option>)}</select> : <input name="group_by" maxLength={80} placeholder="Column name (optional)" {...field('group')}/>}<small>Produce one summary row for each distinct value.</small></label>
              <label>Calculate the sum of{preview ? <select name="value_column" {...field('value')}><option value="">Count rows only</option>{preview.headers.map((h,i)=><option key={i} value={h}>{h}{preview.numeric.includes(h)?' · numeric':''}</option>)}</select> : <input name="value_column" maxLength={80} placeholder="Numeric column (optional)" {...field('value')}/>}<small>Produces sum, average, minimum and maximum. Plain numbers only.</small></label>
            </div> : kind==='images' ? <label>Maximum thumbnail size<select name="width" {...field('width')}>{[64,128,256,512,1024,2048].map(n=><option value={n} key={n}>{n} × {n} pixels</option>)}</select><small>Images fit inside this size without stretching or enlarging.</small></label> : <label>Find primes up to<input name="limit" type="number" min={100} max={20000000} step={1} required {...field('limit')}/><small>100 is a quick check. Larger limits take more compute time; maximum 20 million.</small></label>}</div>
            {kind==='csv' && <div className="form-section"><h3>Data quality &amp; cleaning</h3><p className="field-note">Quality checks always run. Only the selected rules remove or change data; the original upload is preserved.</p><div className="cleaning-options">{[['trim_whitespace','Trim spaces around cell values'],['deduplicate','Remove exact duplicate rows'],['drop_missing','Remove rows with any empty cell'],['detect_outliers','Flag numeric outliers (1.5 × IQR; keep these rows)']].map(([key,label])=><label key={key}><input type="checkbox" checked={rules[key]} onChange={e=>setRules(r=>({...r,[key]:e.target.checked}))}/>{label}</label>)}</div>{values.value && <label>If the numeric column has invalid or empty values<select value={rules.invalid_numeric} onChange={e=>setRules(r=>({...r,invalid_numeric:e.target.value}))}><option value="fail">Fail the job and report the problem</option><option value="skip">Skip those rows and count removals in the report</option></select></label>}<div className="output-explainer"><strong>What you will get</strong><p>{values.group?`One summary for each ${values.group}.`:'One summary for the whole file.'} {values.value?`Count, sum, mean, minimum and maximum of ${values.value}.`:'Row counts; numeric aggregation is not selected.'} Plus quality checks, a cleaned CSV and a downloadable HTML report. Statistics use the retained rows.</p></div></div>}
            <div className="form-section"><h3>Execution</h3><div className="form-grid"><label>Priority<select {...field('priority')}><option value="0">Low</option><option value="1">Normal</option><option value="2">High</option></select><small>Higher-priority jobs are considered first.</small></label><label>Time limit (seconds)<input type="number" required min={1} max={3600} {...field('timeout')}/><small>Stop the job if processing takes longer.</small></label></div></div>
            <details className="advanced-options"><summary>Resource and retry settings <span>1 vCPU / 256 MB by default</span></summary><div className="form-grid"><label>CPU cores<input type="number" required min={0.25} max={64} step={0.25} {...field('cpu')}/></label><label>Memory (MB)<input type="number" required min={64} max={65536} {...field('memory')}/></label><label>Automatic retries<input type="number" required min={0} max={5} {...field('retries')}/><small>Retry an interrupted or failed attempt up to this many times.</small></label></div></details>
          </div>}

          {step===2 && <div className="step-body">
            <div className="step-intro"><span className="section-number">03</span><div><h2>Ready to submit</h2><p>Check your input and processing settings before your job is queued.</p></div></div>
            <div className="review-title"><JobIcon kind={kind}/><div><h3>{values.name}</h3><span>{template.name}</span></div><button type="button" className="text-button" onClick={()=>setStep(1)}>Edit settings</button></div>
            <dl className="review-list"><div><dt>Input</dt><dd>{file ? <><span>{file.name}</span><small>{bytes(file.size)}</small></> : 'No file — generated computation'}</dd></div><div><dt>Processing</dt><dd>{kind==='csv'?`${values.group?`Group by ${values.group}`:'All rows'} · ${values.value?`Sum ${values.value}`:'Count rows'}`:kind==='images'?`Create thumbnails up to ${values.width} × ${values.width} px`:`Find primes from 2 to ${Number(values.limit).toLocaleString()}`}</dd></div>{kind==='csv'&&<div><dt>Cleaning rules</dt><dd>{[['trim_whitespace','Trim spaces'],['deduplicate','Remove duplicates'],['drop_missing','Remove incomplete rows'],['detect_outliers','Flag IQR outliers']].filter(([k])=>rules[k]).map(([,label])=>label).join(' · ')||'Keep values unchanged'}<small>Invalid numeric values: {rules.invalid_numeric==='skip'?'skip rows and report count':'fail validation'}. Outlier detection never removes rows.</small></dd></div>}<div><dt>Resources</dt><dd>{values.cpu} vCPU · {values.memory} MB memory</dd></div><div><dt>Priority & time limit</dt><dd>{['Low','Normal','High'][Number(values.priority)]} · {values.timeout} seconds</dd></div><div><dt>Output</dt><dd>{template.output}<small>Downloadable as a ZIP when processing completes.</small></dd></div></dl>
            <div className="notice"><Info size={17}/><p>{available ? 'Your job will be queued and assigned to an available worker.' : 'Your job will wait in the queue until a worker has enough free capacity.'} You can follow its progress on the next page.</p></div>
            {busy && <div className="upload-progress" role="status"><div><LoaderCircle size={15} className="spin"/><strong>{phase==='upload'?(progress===100?'Saving your uploaded file…':`Uploading ${file?.name}…`):'Adding your workload to the queue…'}</strong>{phase==='upload' && <span>{progress}%</span>}</div>{phase==='upload' && <progress max={100} value={progress}/>}</div>}
          </div>}
        </fieldset>
        <div className="workflow-actions"><span>Step {step+1} of 3</span>{step>0?<button type="button" disabled={busy} onClick={()=>{setError('');setStep(n=>n-1);}}><ArrowLeft size={15}/> Back</button>:<Link className="button" to="/workloads">Cancel</Link>}<button type="submit" className="primary" disabled={busy}><ButtonContent busy={busy}>{step===2?(busy?'Submitting…':'Submit workload'):'Continue'}</ButtonContent>{!busy && <ArrowRight size={16}/>}</button></div>
      </form>
      <aside className="create-aside"><div className="aside-card"><span className="aside-icon"><FileCheck2 size={22}/></span><h3>From input to result</h3><ol className="how-it-works"><li><span>1</span><div><strong>Upload & configure</strong><p>Choose your input and the processing it needs.</p></div></li><li><span>2</span><div><strong>We find a worker</strong><p>Your workload waits until suitable compute is available.</p></div></li><li><span>3</span><div><strong>Download the output</strong><p>Follow progress, inspect logs, and collect your results.</p></div></li></ol></div><div className="capacity-note"><Server size={17}/><div><strong>{workers.data?`${online.length} worker${online.length===1?'':'s'} online`:'Checking worker availability…'}</strong><p>{workers.error?'Worker availability is temporarily unavailable.':`${available} can currently fit this resource request. Jobs can still be submitted when no worker is free.`}</p></div></div></aside>
    </div>
  </>;
}
