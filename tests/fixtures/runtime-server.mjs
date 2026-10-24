import http from 'node:http';

const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({service:process.argv[2]==='wrong'?'another-project':'cloudsphere',pid:process.pid,status:'ok'}));
});
server.listen(0,'127.0.0.1',()=>process.send?.({port:server.address().port}));
function stop(){server.close(()=>process.exit(0));}
process.on('SIGTERM',stop);
process.on('message',message=>{if(message?.type==='cloudsphere-stop')stop();});
