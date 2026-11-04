// Uploads use canonical MIME names. Native H5P fields additionally accept legacy audio aliases.
const extensions = new Map(Object.entries({
  'image/svg+xml':'svg','image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','image/bmp':'bmp','image/tiff':'tiff','image/avif':'avif',
  'audio/mpeg':'mp3','audio/wav':'wav','audio/ogg':'ogg','audio/mp4':'m4a','audio/webm':'webm',
  'video/mp4':'mp4','video/webm':'webm','video/ogg':'ogv','application/pdf':'pdf','text/vtt':'vtt',
}));
export const uploadExtension = (mime:string) => extensions.get(mime);
export function nativeExtension(mime:string) {
  return uploadExtension(mime==='audio/mp3'?'audio/mpeg':mime==='audio/x-wav'?'audio/wav':mime);
}
// Shared signatures identify containers, not their tracks or playback codecs.
function signature(mime:string) {
  switch(mime) {
    case 'audio/mp3': return 'audio/mpeg';
    case 'audio/x-wav': case 'audio/vnd.wave': return 'audio/wav';
    case 'application/ogg': case 'video/ogg': return 'audio/ogg';
    case 'audio/mp4': return 'video/mp4';
    case 'audio/webm': return 'video/webm';
    default: return mime;
  }
}
export function matchesMediaBytes(mime:string, types:string[], header:Buffer) {
  if(mime==='text/vtt') return /^(?:\uFEFF)?WEBVTT(?:[ \t]|\r?\n|$)/.test(header.toString('utf8'));
  return types.some(type=>signature(type)===signature(mime));
}
