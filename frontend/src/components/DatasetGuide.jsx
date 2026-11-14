import React, { useState } from 'react';
import { ArrowDownToLine, ArrowRight } from 'lucide-react';
import { saveBlob } from '../api';
import { datasets } from '../lib/datasets';

export default function DatasetGuide({onUse}) {
  const [selected,setSelected]=useState('sales'),d=datasets[selected];
  return <section className="dataset-guide"><h3>Need a sample?</h3><p className="sample-description">Upload any supported CSV with headers, then choose a grouping and optional numeric column.</p><label>Example dataset<select value={selected} onChange={e=>setSelected(e.target.value)}>{Object.entries(datasets).map(([id,example])=><option key={id} value={id}>{example.title}</option>)}</select></label><div className="sample-summary"><code>{d.columns}</code><p>Group by <strong>{d.group}</strong> · Analyse <strong>{d.value}</strong>{d.clean?' · Enable cleaning':''}</p><p><strong>Expected sample result:</strong> {d.expected}</p></div><div className="actions"><button type="button" onClick={()=>onUse(selected)}>Use sample<ArrowRight size={14}/></button><button type="button" onClick={()=>saveBlob(new Blob([d.csv],{type:'text/csv'}),`${selected}-sample.csv`)}><ArrowDownToLine size={14}/>Download CSV</button></div><details><summary>Supported CSV format</summary><p>UTF-8 comma-separated data with unique, nonempty headers; maximum 10 MB, 200 columns, one million rows and 10,000 groups. Numeric amounts need plain numbers without currency symbols. Without a selected numeric column, the output contains counts and quality checks. Column meaning, currency and business rules are not inferred.</p></details></section>;
}
