export function createHostConnection(initial = null) {
 let adapter=initial;
 return {
  connectHost(host){adapter=host;return ()=>{if(adapter===host)adapter=null;};},
  async callHost(method,payload){
   const target=adapter,fn=target?.[method];
   if(typeof fn!=='function')throw Error(`Host API not connected: ${method}. Connect the parent application to enable this command.`);
   return fn.call(target,payload);
  },
  destroy(){adapter=null;}
 };
}
const standalone=createHostConnection();
export const connectHost=standalone.connectHost,callHost=standalone.callHost;
