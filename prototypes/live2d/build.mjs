import {build} from 'esbuild';
await build({entryPoints:['prototypes/live2d/renderer.ts'],outfile:'prototypes/live2d/probe.js',bundle:true,format:'iife',platform:'browser',target:'chrome144',sourcemap:true,logLevel:'info'});
