import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Run against the installed tarball, through the real SDK client and stdio process.
export async function storageProbe(client,root,reconnect) {
 const call=async(connection,name,args)=>{
  console.log('storage: '+name);
  const result=(await connection.callTool({name,arguments:args})).structuredContent;
  assert.notEqual(result.ok,false,JSON.stringify(result));return result;
 };
 const authoringSource=JSON.parse((await client.readResource({uri:'h5p-authoring://v1/examples'})).contents[0].text)[0];
 const compiled=await call(client,'prepare_stored_h5p_source',{source:authoringSource});
 assert.equal((await call(client,'export_prepared_h5p_activity',{preparation_id:compiled.object_id,idempotency_key:'stdio-source'})).kind,'artifact');
 const png=path.join(root,'source.png');
 await fs.writeFile(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ioAAAAASUVORK5CYII=','base64'));
 const asset=await call(client,'upload_h5p_asset',{path:png,mime:'image/png'});
 const activity={title:'Persistent math and image',library:'H5P.TrueFalse 1.8',assets:{image:asset.object_id},params:{question:'<p>\\(1+1=2\\)</p>',correct:'true',media:{type:{library:'H5P.Image 1.1',params:{file:{path:'asset:image',mime:'image/png'},alt:'Image'}}}}};
 const prepared=await call(client,'prepare_stored_h5p_activity',{activity});
 assert(prepared.library_snapshot_id);
 await fs.writeFile(png,'changed after upload');
 await call(client,'revoke_stored_h5p_object',{object_id:asset.object_id});
 const source=path.join(root,'data/libraries/H5P.TrueFalse-1.8/library.json');
 const original=await fs.readFile(source,'utf8');
 const changed=JSON.parse(original);changed.patchVersion++;
 await fs.writeFile(source,JSON.stringify(changed));
 const input={preparation_id:prepared.object_id,idempotency_key:'persistent-example'};
 const [one,two]=await Promise.all([call(client,'export_prepared_h5p_activity',input),call(client,'export_prepared_h5p_activity',input)]);
 assert.equal(one.object_id,two.object_id);assert.equal(one.target.compatible,false);
 assert.equal(one.target.code,'TARGET_INVENTORY_UNKNOWN');
 const bytes=Buffer.from((await client.readResource({uri:one.uri})).contents[0].blob,'base64');
 assert.equal(createHash('sha256').update(bytes).digest('hex'),one.sha256);
 const filename=path.join(root,'stored.h5p');await fs.writeFile(filename,bytes);
 const pkg=await call(client,'upload_h5p_package',{path:filename,mime:'application/zip'});
 assert.equal((await call(client,'validate_stored_h5p_package',{object_id:pkg.object_id})).verification.importation,'not_run');
 const target=await call(client,'register_h5p_target_profile',{profile:{core:{major:1,minor:28},inventory_at:new Date().toISOString(),can_install:false,libraries:[]}});
 const incompatible=(await client.callTool({name:'export_prepared_h5p_activity',arguments:{...input,idempotency_key:'target-check',target_profile_id:target.object_id}})).structuredContent;
 assert.equal(incompatible.diagnostics[0].code,'TARGET_INCOMPATIBLE');
 assert.match(incompatible.diagnostics[0].expected,/H5P.MathDisplay/);
 const conflict=(await client.callTool({name:'export_prepared_h5p_activity',arguments:{...input,ttl_seconds:60}})).structuredContent;
 assert.equal(conflict.diagnostics[0].code,'IDEMPOTENCY_CONFLICT');
 await client.close();
 const restarted=await reconnect('libraries:install');
 try {
  const replay=await call(restarted,'export_prepared_h5p_activity',input);
  assert.equal(replay.object_id,one.object_id);assert.equal(replay.sha256,one.sha256);
  assert.equal((await restarted.readResource({uri:one.uri})).contents[0].blob,bytes.toString('base64'));
  const next=await call(restarted,'capture_h5p_library_snapshot',{});
  assert.notEqual(next.object_id,prepared.library_snapshot_id);
  await call(restarted,'activate_h5p_library_snapshot',{object_id:prepared.library_snapshot_id});
  const rolledBack=await call(restarted,'prepare_stored_h5p_activity',{activity:{title:'Rollback',library:'H5P.TrueFalse 1.8',params:{question:'<p>Old generation?</p>',correct:'true'}}});
  assert.equal(rolledBack.library_snapshot_id,prepared.library_snapshot_id);
  await call(restarted,'revoke_stored_h5p_object',{object_id:one.object_id});
  await assert.rejects(restarted.readResource({uri:one.uri}));
 }finally{await restarted.close();await fs.writeFile(source,original);}
 console.log('F5: immutable media/libraries, concurrent export, target/MathDisplay, import, restart, rollback and revocation passed');
}
