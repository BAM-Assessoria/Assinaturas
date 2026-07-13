/**
 * Trava os invariantes que fazem as assinaturas sobreviverem ao Outlook CLÁSSICO.
 *
 * O Outlook clássico (Office Win32) renderiza HTML com o motor do Word, que:
 *   1. ACHATA o canal alfa de PNG contra BRANCO  -> PNG transparente vira um retângulo
 *      branco em volta do desenho. Num card cinza isso salta aos olhos (foi o bug dos
 *      ícones reportado pela Bracel em jul/2026).
 *   2. REESCALA sem suavização (nearest-neighbor) -> redução em razão não-inteira come
 *      traços finos. Por isso todo asset é exportado em EXATAMENTE 2x a caixa do HTML.
 *
 * Regra, então: nenhuma imagem da assinatura pode ter canal alfa, e a cor de fundo tem
 * que estar CRAVADA no arquivo, idêntica à cor do card onde ela é usada.
 *
 * Rodar:  node test/imagens.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const RAIZ = path.join(__dirname, '..');
const CINZA = '#F4F4F4';   // card da Bracel (padrão aprovado)
const BRANCO = '#FFFFFF';  // card da Bracel (variante) e das outras três marcas

// asset -> cor do card em que ele é colado, e a caixa que o HTML declara pra ele
const ASSETS = [
  ...['celular', 'telefone', 'email', 'endereco'].flatMap((i) => [
    { arq: `icons/${i}-cinza.png`,  fundo: CINZA,  caixa: [11, 11] },
    { arq: `icons/${i}-branco.png`, fundo: BRANCO, caixa: [11, 11] },
  ]),
  { arq: 'bracel_logo-cinza.png',  fundo: CINZA,  caixa: [149, 43] },
  { arq: 'bracel_logo-branco.png', fundo: BRANCO, caixa: [149, 43] },
  { arq: 'bg/bg-light.png',        fundo: CINZA,  caixa: null },
  { arq: 'bg/bg-white.png',        fundo: BRANCO, caixa: null },
];

// cada marca tem que referenciar os assets certos pro fundo de card que ela usa
const MARCAS = [
  { dir: 'bracel',  espera: ["icons/celular'  + ICON_SUF", "bracel_logo' + ICON_SUF"] },
  { dir: 'solibem', espera: ['icons/celular-branco.png', 'icons/endereco-branco.png'] },
  { dir: 'saltum',  espera: ['icons/celular-branco.png', 'icons/endereco-branco.png'] },
  { dir: 'simel',   espera: ['icons/celular-branco.png', 'icons/endereco-branco.png'] },
];

let falhas = 0;
const ok = (m) => console.log('  ok   ' + m);
const erro = (m) => { falhas++; console.log('  FALHA ' + m); };

const hex = (b) => '#' + [...b].slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

(async () => {
  console.log('\nAssets da assinatura (opacos, cor do card cravada, 2x exato):');
  for (const { arq, fundo, caixa } of ASSETS) {
    const p = path.join(RAIZ, arq);
    if (!fs.existsSync(p)) { erro(`${arq} — arquivo não existe`); continue; }

    const meta = await sharp(p).metadata();

    // 1. sem canal alfa: não existe transparência pro Word achatar
    if (meta.hasAlpha) erro(`${arq} — TEM canal alfa; o Word vai desenhar um retângulo branco`);
    else ok(`${arq} — sem canal alfa`);

    // 2. a cor cravada no arquivo bate exatamente com o card
    const canto = hex(await sharp(p).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer());
    if (canto !== fundo) erro(`${arq} — fundo ${canto}, mas o card é ${fundo}; vai aparecer um quadrado fantasma`);
    else ok(`${arq} — fundo ${canto} = card`);

    // 3. exatamente 2x a caixa do HTML: redução 2:1 sobrevive ao scaler sem suavização do Word
    if (caixa) {
      const [cw, ch] = caixa;
      if (meta.width !== cw * 2 || meta.height !== ch * 2) {
        erro(`${arq} — ${meta.width}x${meta.height}; esperado ${cw * 2}x${ch * 2} (2x de ${cw}x${ch})`);
      } else ok(`${arq} — ${meta.width}x${meta.height} = 2x da caixa ${cw}x${ch}`);
    }
  }

  console.log('\nCada marca aponta pros assets do fundo de card que ela usa:');
  for (const { dir, espera } of MARCAS) {
    const html = fs.readFileSync(path.join(RAIZ, dir, 'index.html'), 'utf8');
    // Só o que sai no e-mail importa. O preview e o toast da própria página rodam em
    // navegador (respeitam alfa) e podem usar o PNG transparente original à vontade.
    const i = html.indexOf('async function copyHTML');
    if (i < 0) { erro(`${dir} — copyHTML() não encontrada`); continue; }
    const exportado = html.slice(i);

    for (const ref of espera) {
      if (exportado.includes(ref)) ok(`${dir} → ${ref}`);
      else erro(`${dir} — não referencia ${ref}`);
    }
    // ninguém pode voltar a usar os PNGs transparentes antigos NA ASSINATURA
    const legado = exportado.match(/icons\/(celular|telefone|email|endereco)\.png|bracel_logo\.png/g);
    if (legado) erro(`${dir} — exporta asset legado COM ALFA: ${[...new Set(legado)].join(', ')}`);
    else ok(`${dir} — nenhum asset legado transparente na assinatura`);
  }

  console.log(falhas ? `\n${falhas} falha(s).\n` : '\nTudo certo.\n');
  process.exit(falhas ? 1 : 0);
})();
