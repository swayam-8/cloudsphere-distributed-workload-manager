const hosts=new Set(['localhost','127.0.0.1','::1','[::1]']);
const peers=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);

export function demoAccessAllowed(cfg,req) {
  return cfg.demoAccess===true&&peers.has(req.socket.remoteAddress)&&hosts.has(String(req.hostname).toLowerCase());
}

export function requireSafeDemoBind(cfg,host) {
  if(cfg.demoAccess&&!hosts.has(host))throw new Error('Token-free demo access must bind to localhost or 127.0.0.1');
}
