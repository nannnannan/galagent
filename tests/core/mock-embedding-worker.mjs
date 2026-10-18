import { parentPort } from 'node:worker_threads';
parentPort.on('message', ({id,text,op}) => {
  if (op === 'dispose') { parentPort.postMessage({op:'disposed'}); return; }
  if (text === 'crash') process.exit(1);
  else setTimeout(() => parentPort.postMessage({id,values:[1,0]}), text === 'slow' ? 90 : 1);
});
