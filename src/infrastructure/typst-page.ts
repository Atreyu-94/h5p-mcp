import path from 'node:path';
import {runFigureProcess} from './typst-process.js';
import {load} from './runtime.js';

export const pixelsPerInch=192;
const pixelLimit=16_000_000;
const byteLimit=4*1024*1024;
const invalid=(reason:string,code='BACKEND_ERROR')=>Object.assign(new Error(reason),{code});

/** Internal compiler boundary for reviewed templates prepared in a private root.
 * Callers cannot select source, packages or flags through the CLI/MCP figure operations.
 */
export async function compileSinglePage(executable:string,root:string,packages:string,cache:string,signal?:AbortSignal) {
 const compile=(format:'svg'|'png')=>runFigureProcess(executable,[
  'compile','--root',root,'--package-path',packages,'--package-cache-path',cache,
  '--ignore-system-fonts','--creation-timestamp','0','--ppi',String(pixelsPerInch),
  '--format',format,path.join(root,'figure.typ'),'-',
 ],signal,{cwd:root,maxStdout:byteLimit});
 // A single stdout destination makes Typst reject a second page. Bound the emitted bytes
 // while the compiler is running, and check page geometry before requesting a raster.
 return renderSinglePage(compile);
}

export async function renderSinglePage(compile:(format:'svg'|'png')=>Promise<Buffer>) {
 const svg=await compile('svg');
 const probe=load('probe-image-size').sync;
 const vector=probe(svg);
 if(vector?.type!=='svg'||vector.wUnits!=='pt'||vector.hUnits!=='pt'||
    !Number.isFinite(vector.width+vector.height)||vector.width<=0||vector.height<=0)
  throw invalid('Invalid SVG dimensions.');
 const maxWidth=Math.ceil(vector.width*pixelsPerInch/72);
 const maxHeight=Math.ceil(vector.height*pixelsPerInch/72);
 if(maxWidth*maxHeight>pixelLimit)throw invalid('Page exceeds the PNG pixel budget.','LIMIT_EXCEEDED');
 const png=await compile('png');
 const raster=probe(png);
 if(raster?.type!=='png'||raster.width<=0||raster.height<=0||raster.width*raster.height>pixelLimit)
  throw invalid('Invalid PNG dimensions.');
 return {svg,png,widthPt:vector.width,heightPt:vector.height,pngWidth:raster.width,pngHeight:raster.height};
}
