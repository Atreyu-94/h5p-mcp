const assert=require('node:assert/strict');

module.exports=async function checkMotion(mode,page,frame){
  assert(['desktop','narrow','zoom','narrator'].includes(mode));
  if(mode==='narrow')await page.setViewportSize({width:360,height:800});
  const picture=frame.getByRole('img',{name:/Gráfica de posición frente al tiempo/});
  await picture.evaluate(img=>img.decode());
  await frame.getByText(/Tiempo en segundos y posición en metros/).waitFor({state:'visible'});
  const geometry=await page.evaluate(()=>({dpr:devicePixelRatio,inner:innerWidth,outer:outerWidth}));
  if(mode==='zoom'){assert(geometry.inner<geometry.outer*0.55);assert(geometry.dpr>=2);}
  if(mode==='narrow')assert.equal(geometry.inner,360);
  const rect=await picture.boundingBox();
  assert(rect.width>0 && rect.x>=0 && rect.x+rect.width<=geometry.inner+1);
  if(mode==='narrator'){
    await page.evaluate(()=>document.title='M4 H5P - Narrator QA');
    await page.bringToFront();
    console.log('Narrator QA ready '+page.url());
    // Manual assistive-technology session; closing the dedicated page ends the check.
    await page.waitForEvent('close',{timeout:600000});
    return;
  }
  const correct='Entre 2 y 4 s.',wrong='Entre 0 y 2 s.';
  const findButton=selector=>frame.locator(selector).filter({visible:true}).first();
  const feedback=frame.getByText(/Entre 2 y 4 s, ambas lecturas/);
  assert.equal(await feedback.filter({visible:true}).count(),0);
  for(const [choice,score] of [[wrong,0],[correct,1]]){
    await frame.getByRole('radio',{name:choice,exact:false}).press('Space');
    await findButton('button.h5p-theme-check,button.h5p-question-check-answer').press('Enter');
    assert.equal(await frame.evaluate(()=>H5P.instances[0].getScore()),score);
    const explanation=score?feedback:frame.getByText(/Compara las posiciones en los extremos/);
    await explanation.first().waitFor({state:'visible',timeout:5000});
    if(!score)await findButton('button.h5p-theme-retry,button.h5p-question-try-again').press('Enter');
  }
  console.log(JSON.stringify({mode,geometry,imageWidth:rect.width,incorrect:0,retry:true,correct:1,feedback:true}));
};
