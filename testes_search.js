const fs=require('fs'),vm=require('vm');
function load(file){
  const code=fs.readFileSync(file,'utf8');
  const ctx={console,setTimeout,clearTimeout,Date,Promise};
  vm.createContext(ctx);
  return vm.runInContext(code+';BotQL',ctx);
}
const BotQL=load(process.argv[2]||'botql_browser.js');
const {BotQLInterpreter,MemoryFileSystem}=BotQL;

let pass=0,fail=0;
function ok(c,msg){ if(c){pass++;console.log('  ok  ',msg)}else{fail++;console.log('  FAIL',msg)} }

const KB=`Git rebase reaplica commits sobre outra base, deixando o historico linear.

Git merge junta duas branches criando um commit de juncao.

Python e uma linguagem de programacao interpretada de alto nivel.`;

function mk(sql,files,opts={}){
  const out=[];
  const fsys=new MemoryFileSystem(files);
  const bot=BotQLInterpreter.fromSource(sql,{fileSystem:fsys,basePath:'',...opts});
  bot.onReply=({text,html})=>out.push({text,html});
  return {bot,out,fsys};
}
async function main(){
 // ---------- regressao: sintaxe antiga ----------
 console.log('1. regressao THINK ... OR REPLY');
 {
  const {bot,out}=mk(`CREATE BOT "T"
ON MESSAGE
  THINK(kb.txt) WAITING("a",0) OR REPLY "nao sei"
RUN BOT`,{'kb.txt':KB});
  await bot.receiveMessage('c1','o que e git rebase');
  ok(out.length===1&&/rebase/i.test(out[0].text),'THINK responde do ficheiro');
  await bot.receiveMessage('c1','receita de bolo de chocolate');
  ok(out.length===2&&out[1].text==='nao sei','THINK cai no OR REPLY');
 }
 console.log('2. regressao WHEN/INSERT/UPDATE');
 {
  const {bot,out}=mk(`CREATE BOT "T"
CREATE TABLE Context ()
ON MESSAGE {
  INSERT INTO Context
  WHEN CONTAINS "ola"
    REPLY "ola!"
  OTHERWISE
    REPLY "outra"
  UPDATE Context SET reply = "x"
}
RUN BOT`,{});
  await bot.receiveMessage('c1','ola tudo bem');
  await bot.receiveMessage('c1','xyz');
  ok(out[0].text==='ola!'&&out[1].text==='outra','WHEN/OTHERWISE intactos');
  ok(bot.db.getRows('Context').length===2,'INSERT/UPDATE intactos');
 }
 // ---------- ASK resposta clara ----------
 console.log('3. ASK com resposta clara nao pesquisa');
 {
  let buscas=0;
  const {bot,out}=mk(`CREATE BOT "T"
CONNECT SEARCH WIKI, STACKOVERFLOW
ON MESSAGE
  ASK(kb.txt) AND REPLY "Qual?" OR SEARCH message INTO kb.txt OR REPLY "nao sei"
RUN BOT`,{'kb.txt':KB},{onSearch:async()=>{buscas++;return[]}});
  await bot.receiveMessage('c1','o que e git rebase');
  ok(out.length===1&&/rebase/i.test(out[0].text)&&!out[0].html&&buscas===0,'responde direto, sem sondagem, sem busca');
  ok(JSON.stringify(bot.searchProviders)==='["WIKI","STACKOVERFLOW"]','CONNECT SEARCH liga providers');
 }
 // ---------- ASK em duvida ----------
 console.log('4. ASK em duvida mostra sondagem; toque responde; outra msg limpa');
 {
  let buscas=0;
  const {bot,out}=mk(`CREATE BOT "T"
CONNECT SEARCH WIKI
ON MESSAGE
  ASK(kb.txt) AND REPLY "Qual destas queres dizer?" OR SEARCH message INTO kb.txt OR REPLY "nao sei"
RUN BOT`,{'kb.txt':KB},{onSearch:async()=>{buscas++;return[]}});
  const idx=bot.knowledgeCache.get('kb.txt');
  const real=idx.analyze.bind(idx);
  idx.analyze=(m)=>m==='git'?{decision:'REANALISAR',confidence:.3,margem:.05,texto:null}:real(m);
  await bot.receiveMessage('c1','git');
  ok(out.length===1&&out[0].html&&out[0].html.includes('data-botql-ask='),'envia html com data-botql-ask');
  ok(/Qual destas queres dizer\?/.test(out[0].text)&&/1\. /.test(out[0].text)&&/2\. /.test(out[0].text),'texto plano numerado + intro');
  ok(buscas===0,'nao pesquisou');
  const labels=[...out[0].html.matchAll(/data-botql-ask="([^"]*)"/g)].map(m=>m[1]);
  ok(labels.length>=2&&labels.length<=4,'2 a 4 opcoes: '+labels.length);
  console.log('     opcoes:',labels);
  const n0=out.length;
  await bot.receiveMessage('c1',labels[0].replace(/&quot;/g,'"'));
  ok(out.length===n0+1&&!out[n0].html&&KB.includes(out[n0].text),'toque na opcao responde com o bloco completo');
  ok(bot._askPending.size===0,'pendente limpo');
  // numero
  await bot.receiveMessage('c1','git');
  const n1=out.length;
  await bot.receiveMessage('c1','2');
  ok(out.length===n1+1&&KB.includes(out[n1].text),'resposta por numero funciona');
  // outra mensagem limpa
  await bot.receiveMessage('c1','git');
  await bot.receiveMessage('c1','o que e git rebase');
  ok(bot._askPending.size===0&&/rebase/i.test(out[out.length-1].text),'outra mensagem limpa pendente e segue o fluxo');
 }
 // ---------- ASK + SEARCH ----------
 console.log('5. ASK nao sabe -> SEARCH grava -> repete e responde');
 {
  let buscas=0,gravados=[];
  const {bot,out,fsys}=mk(`CREATE BOT "T"
CONNECT SEARCH WIKI, STACKOVERFLOW
ON MESSAGE
  ASK(kb.txt) AND REPLY "Qual?" OR SEARCH message INTO kb.txt OR REPLY "nao sei"
RUN BOT`,{'kb.txt':KB},{
    onSearch:async({query,providers})=>{buscas++;return[
      {title:'Docker',snippet:'<b>Docker</b> e uma plataforma de <i>containers</i> para empacotar aplicacoes.',url:'u'},
      {title:'Docker Compose',snippet:'Compose define aplicacoes docker com varios containers num ficheiro yaml.',url:'u2'}]},
    onFileWrite:({path,content})=>gravados.push(path)});
  await bot.receiveMessage('c1','o que e docker containers');
  ok(buscas===1,'pesquisou 1 vez');
  ok(out.length===1&&/docker/i.test(out[0].text)&&!/<b>/.test(out[0].text),'respondeu com o que aprendeu (HTML limpo)');
  ok(fsys.readFile('kb.txt').includes('Docker')&&fsys.readFile('kb.txt').startsWith('Git rebase'),'gravou no fim, sem apagar o existente');
  ok(gravados[0]==='kb.txt','onFileWrite chamado');
  await bot.receiveMessage('c1','o que e docker containers');
  ok(buscas===1&&out.length===2,'segunda pergunta igual: sem nova pesquisa');
 }
 console.log('6. SEARCH vazio / erro -> REPLY final');
 {
  const mkbot=(onSearch)=>mk(`CREATE BOT "T"
CONNECT SEARCH WIKI
ON MESSAGE
  ASK(kb.txt) OR SEARCH message INTO kb.txt OR REPLY "nao sei"
RUN BOT`,{'kb.txt':KB},{onSearch});
  let r=mkbot(async()=>[]); await r.bot.receiveMessage('c','zzz qqq xxx yyy');
  ok(r.out.length===1&&r.out[0].text==='nao sei','lista vazia cai no REPLY');
  r=mkbot(async()=>{throw new Error('rede')}); await r.bot.receiveMessage('c','zzz qqq xxx yyy');
  ok(r.out.length===1&&r.out[0].text==='nao sei'&&r.bot.lastSearchError.message==='rede','erro de rede cai no REPLY e fica registado');
 }
 console.log('7. erros claros');
 {
  let r=mk(`CREATE BOT "T"
ON MESSAGE
  ASK(kb.txt) OR SEARCH message INTO kb.txt OR REPLY "x"
RUN BOT`,{'kb.txt':KB},{onSearch:async()=>[]});
  let err=null; try{await r.bot.receiveMessage('c','zzz qqq xxx')}catch(e){err=e}
  ok(err&&/no CONNECT SEARCH/.test(err.message),'SEARCH sem CONNECT SEARCH: '+(err&&err.message));
  r=mk(`CREATE BOT "T"
CONNECT SEARCH WIKI
ON MESSAGE
  ASK(kb.txt) OR SEARCH message INTO kb.txt OR REPLY "x"
RUN BOT`,{'kb.txt':KB});
  err=null; try{await r.bot.receiveMessage('c','zzz qqq xxx')}catch(e){err=e}
  ok(err&&/missing onSearch/.test(err.message),'SEARCH sem onSearch: '+(err&&err.message));
 }
 console.log('8. SEARCH isolado (ON START) e THINK + SEARCH + THINK separados');
 {
  const {bot,out,fsys}=mk(`CREATE BOT "T"
CONNECT SEARCH WIKI
ON START
  SEARCH "git rebase tutorial" INTO lume.txt
ON MESSAGE
  THINK(base.txt) OR THINK(lume.txt) OR SEARCH message INTO lume.txt OR REPLY "nao sei"
RUN BOT`,{'base.txt':KB,'lume.txt':''},{onSearch:async({query})=>[{title:'T:'+query,snippet:'Resposta sobre '+query+' com varios detalhes uteis.'}]});
  await bot.start();
  ok(fsys.readFile('lume.txt').includes('git rebase tutorial'),'ON START gravou sem responder (out='+out.length+')');
  ok(out.length===0,'SEARCH isolado nao responde');
  await bot.receiveMessage('c','python generators avancados');
  ok(out.length===1&&/python generators/i.test(out[0].text),'cadeia THINK/THINK/SEARCH repete o THINK do ficheiro certo');
 }
 console.log('9. dedupe e limites');
 {
  let chamada=0;
  const itens=[1,2,3,4,5].map(i=>({title:'T'+i,snippet:'x'.repeat(50)+' texto numero '+i+' '+'y'.repeat(900)}));
  const {bot,out,fsys}=mk(`CREATE BOT "T"
CONNECT SEARCH WIKI
ON START {
  SEARCH "aaa bbb" INTO k.txt
  SEARCH "aaa bbb" INTO k.txt
  SEARCH "ab" INTO k.txt
}
RUN BOT`,{'k.txt':''},{onSearch:async()=>{chamada++;return chamada===1?itens:itens.slice(0,3)}});
  await bot.start();
  const blocos=fsys.readFile('k.txt').split(/\n\s*\n/);
  ok(chamada===2,'consulta com menos de 3 caracteres nao pesquisa ('+chamada+' chamadas)');
  ok(blocos.length===3,'1a pesquisa grava no maximo 3 blocos; 2a so repete os mesmos e nao duplica: '+blocos.length);
  ok(blocos.every(b=>b.length<=610),'blocos truncados');
 }
 console.log('10. sintaxe invalida');
 {
  for(const [src,re] of [
   ['CREATE BOT "T"\nON MESSAGE\n  THINK(k.txt) OR FOO\nRUN BOT',/expected THINK, ASK, SEARCH or REPLY/],
   ['CREATE BOT "T"\nON MESSAGE\n  SEARCH message k.txt\nRUN BOT',/INTO/],
   ['CREATE BOT "T"\nCONNECT SEARCH\nRUN BOT',/IDENT/],
  ]){ let e=null; try{BotQLInterpreter.fromSource(src,{fileSystem:new MemoryFileSystem({}),basePath:''})}catch(x){e=x}
      ok(e&&re.test(e.message),'erro: '+(e&&e.message.slice(0,70))); }
 }
 console.log(`\n${pass} passaram, ${fail} falharam`);
 process.exit(fail?1:0);
}
main().catch(e=>{console.error('ERRO NO TESTE',e);process.exit(2)});
