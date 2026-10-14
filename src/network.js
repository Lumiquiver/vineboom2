export class MultiplayerClient {
  constructor(url, onEvent=()=>{}){
    this.url=url;this.onEvent=onEvent;this.ws=null;this.connected=false;this.queue=[];this.id=null;this.roomCode=null;this.role='player';this.intentionalClose=false;
  }
  connect(){
    return new Promise((resolve,reject)=>{
      let ws;
      try{ws=new WebSocket(this.url);}catch(error){reject(error);return;}
      this.ws=ws;this.intentionalClose=false;
      const timeout=setTimeout(()=>{if(!this.connected){try{ws.close();}catch{}reject(new Error('Connection timed out. The multiplayer server may be offline.'));}},7000);
      ws.addEventListener('open',()=>{this.connected=true;clearTimeout(timeout);for(const msg of this.queue)ws.send(JSON.stringify(msg));this.queue=[];resolve(this);});
      ws.addEventListener('message',event=>{let data;try{data=JSON.parse(event.data);}catch{return;}if(data.type==='hello'){this.id=data.id;}if(data.type==='created'||data.type==='joined'){this.id=data.self?.id||this.id;this.roomCode=data.code||this.roomCode;this.role=data.role||this.role;}this.onEvent(data);});
      ws.addEventListener('error',()=>{clearTimeout(timeout);if(!this.connected)reject(new Error('Could not connect. Is the VineBoom room server running?'));});
      ws.addEventListener('close',()=>{clearTimeout(timeout);const had=this.connected;this.connected=false;if(!this.intentionalClose)this.onEvent({type:'disconnected',expected:!had});});
    });
  }
  send(type,payload={}){
    const message={type,...payload};
    if(this.ws&&this.ws.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify(message));
    else if(this.ws&&this.ws.readyState===WebSocket.CONNECTING)this.queue.push(message);
    else return false;
    return true;
  }
  close(){this.intentionalClose=true;try{this.ws?.close();}catch{}this.connected=false;}
}
