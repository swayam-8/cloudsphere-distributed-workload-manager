export const batchKeys=(taskId,attemptId)=>({config:`cloudsphere/batch/${taskId}/${attemptId}/config.json`,result:`cloudsphere/batch/${taskId}/${attemptId}/result.json`,output:`cloudsphere/batch/${taskId}/${attemptId}/output.zip`});
export async function readBoundedBody(body,limit){
  const chunks=[];let length=0;
  for await(const value of body){const chunk=Buffer.from(value);length+=chunk.length;if(length>limit){body.destroy?.();throw new Error('S3 object exceeds permitted size');}chunks.push(chunk);}
  return Buffer.concat(chunks);
}
