import { inflateRawSync } from 'node:zlib';

// Read our bounded job ZIPs in memory without extracting files or adding a platform dependency.
export function zipFiles(bytes) {
  let end=bytes.length-22;
  while(end>=Math.max(0,bytes.length-65557)&&bytes.readUInt32LE(end)!==0x06054b50)end--;
  if(end<0||bytes.readUInt32LE(end)!==0x06054b50)throw new Error('ZIP directory missing');
  const count=bytes.readUInt16LE(end+10),files=new Map();let offset=bytes.readUInt32LE(end+16),total=0;
  for(let i=0;i<count;i++) {
    if(bytes.readUInt32LE(offset)!==0x02014b50)throw new Error('Invalid ZIP directory');
    const method=bytes.readUInt16LE(offset+10),length=bytes.readUInt32LE(offset+20),size=bytes.readUInt32LE(offset+24);
    const nameSize=bytes.readUInt16LE(offset+28),extraSize=bytes.readUInt16LE(offset+30),commentSize=bytes.readUInt16LE(offset+32),local=bytes.readUInt32LE(offset+42);
    total+=size;if(total>32*1024*1024)throw new Error('ZIP too large');
    const name=bytes.subarray(offset+46,offset+46+nameSize).toString();
    if(bytes.readUInt32LE(local)!==0x04034b50)throw new Error('Invalid ZIP entry');
    const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28),content=bytes.subarray(start,start+length);
    files.set(name,method===0?content:method===8?inflateRawSync(content,{maxOutputLength:32*1024*1024}):(()=>{throw new Error('Unsupported compression');})());
    offset+=46+nameSize+extraSize+commentSize;
  }
  return files;
}
