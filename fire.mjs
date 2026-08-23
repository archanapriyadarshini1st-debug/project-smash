import puppeteer from 'puppeteer'
const b = await puppeteer.launch({headless:'new', args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=swiftshader','--window-size=900,650']})
const p = await b.newPage(); await p.setViewport({width:900,height:650})
const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,200)))
p.on('console',m=>{const t=m.text(); if(/ERROR|not compiled|undeclared/i.test(t)) errs.push(t.slice(0,200))})
await p.goto('http://localhost:5173',{waitUntil:'domcontentloaded',timeout:45000})
await new Promise(r=>setTimeout(r,9000))

// CATACLYSM BEAM (4) — drag a long scar across the surface
await p.keyboard.press('4')
await new Promise(r=>setTimeout(r,400))
await p.mouse.move(400,300); await p.mouse.down()
for (let i=0;i<40;i++){ await p.mouse.move(400+i*4, 300+Math.sin(i/5)*30); await new Promise(r=>setTimeout(r,45)) }
await p.mouse.up()
await new Promise(r=>setTimeout(r,1500))
await p.screenshot({path:'shot_beam.png'})

// METEOR STRIKE (6) — projectile + crater + debris
await p.keyboard.press('6')
for (const [x,y] of [[350,250],[470,340],[400,400]]) {
  await p.mouse.move(x,y); await p.mouse.down(); await new Promise(r=>setTimeout(r,120)); await p.mouse.up()
  await new Promise(r=>setTimeout(r,1400))
}
await new Promise(r=>setTimeout(r,2000))
await p.screenshot({path:'shot_meteor.png'})

const tel = await p.evaluate(()=>{
  const t=[...document.querySelectorAll('div')].map(d=>d.textContent).filter(x=>x&&x.includes('INTEGRITY'))
  return t[0]?.slice(0,200)
})
console.log('TELEMETRY:', tel)
console.log('ERRORS:', errs.length? errs.slice(0,5): 'none')
await b.close()
