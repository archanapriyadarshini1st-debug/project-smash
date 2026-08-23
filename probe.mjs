import puppeteer from 'puppeteer'
const b = await puppeteer.launch({headless:'new', args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=swiftshader']})
const p = await b.newPage()
const logs=[]
p.on('console', m => logs.push(`[${m.type()}] ${m.text().slice(0,300)}`))
p.on('pageerror', e => logs.push(`[PAGEERROR] ${String(e).slice(0,400)}`))
await p.goto('http://localhost:5173', {waitUntil:'domcontentloaded', timeout:45000})
await new Promise(r=>setTimeout(r,9000))
const info = await p.evaluate(() => {
  const c=document.querySelector('canvas')
  return { canvas: !!c, w:c?.width, h:c?.height, hud: !!document.querySelector('button') }
})
console.log('INFO', JSON.stringify(info))
console.log('--- CONSOLE ---'); logs.slice(0,45).forEach(l=>console.log(l))
await p.screenshot({path:'/home/user/cosmic-forge/shot.png'})
await b.close()
