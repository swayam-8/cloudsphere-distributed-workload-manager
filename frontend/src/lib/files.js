export const UPLOAD_LIMIT=10*1024*1024;
export function validateFile(file,kind) {
  if(!file?.size)return 'Choose a nonempty file to continue.';
  if(file.size>UPLOAD_LIMIT)return 'This file is too large. The maximum upload size is 10 MB.';
  const extension=file.name.split('.').pop().toLowerCase();
  if(!(kind==='csv'?['csv']:['png','jpg','jpeg','zip']).includes(extension))return kind==='csv'?'Choose a CSV (.csv) file.':'Choose a PNG, JPG, JPEG or ZIP file.';
  return '';
}

// A bounded CSV preview with quoted fields, escaped quotes and multiline values.
// Full validation/processing still happens in the worker, not in this preview.
export function previewCSV(text,limit=6) {
  const rows=[];let row=[],field='',quoted=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') {
      if(quoted && text[i+1]==='"'){field+='"';i++;}
      else if(quoted || !field)quoted=!quoted;
      else field+=c;
    } else if(c===',' && !quoted){row.push(field);field='';}
    else if((c==='\n'||c==='\r') && !quoted) {
      if(c==='\r'&&text[i+1]==='\n')i++;
      row.push(field);if(row.some(v=>v!==''))rows.push(row);row=[];field='';
      if(rows.length>=limit)break;
    } else field+=c;
  }
  if(rows.length<limit && !quoted && (field || row.length)){row.push(field);rows.push(row);}
  if(!rows.length || rows[0].length>200)throw new Error('A CSV header with 1–200 columns is required.');
  const headers=rows[0],sample=rows.slice(1).filter(r=>r.length===headers.length);
  return {headers,rows:sample,numeric:headers.filter((_,i)=>sample.length && sample.every(row=>row[i].trim()!=='' && Number.isFinite(Number(row[i]))))};
}
