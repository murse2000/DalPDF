import {comparePages,type TextPage} from './assistant-core';
self.onmessage=(e:MessageEvent<{before:TextPage[];after:TextPage[]}>)=>{
 try{self.postMessage({changes:comparePages(e.data.before,e.data.after)});}
 catch(error){self.postMessage({error:String(error)});}
};
