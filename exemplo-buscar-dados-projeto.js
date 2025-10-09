/**
 * Exemplo de como buscar dados específicos de um projeto do Supabase
 * Incluindo nome do projeto e cores dos eventos
 */

// Exemplo de uso da nova API
async function buscarDadosProjeto(projectCode) {
  try {
    // URL da API do servidor Ontime
    const apiUrl = 'http://localhost:3001/api/supabase/project';
    
    const response = await fetch(`${apiUrl}/${projectCode}`);
    
    if (!response.ok) {
      throw new Error(`Erro HTTP: ${response.status}`);
    }
    
    const data = await response.json();
    
    console.log('=== DADOS DO PROJETO ===');
    console.log(`Código do Projeto: ${data.project.projectCode}`);
    console.log(`Nome do Projeto: ${data.project.projectName}`);
    console.log(`Última Atualização: ${data.project.lastUpdated}`);
    console.log(`No Ar: ${data.project.onAir ? 'Sim' : 'Não'}`);
    
    console.log('\n=== EVENTO ATUAL ===');
    if (data.project.currentEvent) {
      const current = data.project.currentEvent;
      console.log(`Cue: ${current.cue}`);
      console.log(`Título: ${current.title}`);
      console.log(`Cor: ${current.colour}`);
      console.log(`Duração: ${current.duration}s`);
      console.log(`Público: ${current.isPublic ? 'Sim' : 'Não'}`);
    } else {
      console.log('Nenhum evento em execução');
    }
    
    console.log('\n=== PRÓXIMO EVENTO ===');
    if (data.project.nextEvent) {
      const next = data.project.nextEvent;
      console.log(`Cue: ${next.cue}`);
      console.log(`Título: ${next.title}`);
      console.log(`Cor: ${next.colour}`);
      console.log(`Duração: ${next.duration}s`);
      console.log(`Público: ${next.isPublic ? 'Sim' : 'Não'}`);
    } else {
      console.log('Nenhum próximo evento');
    }
    
    console.log('\n=== CUESHEET COMPLETO ===');
    console.log(`Total de Eventos: ${data.project.cuesheet.totalEvents}`);
    console.log(`Duração Total: ${data.project.cuesheet.totalDuration}s`);
    
    console.log('\n=== LISTA DE EVENTOS COM CORES ===');
    data.project.cuesheet.events.forEach((event, index) => {
      console.log(`${index + 1}. [${event.cue}] ${event.title}`);
      console.log(`   Cor: ${event.colour}`);
      console.log(`   Duração: ${event.duration}s`);
      console.log(`   Tipo: ${event.type}`);
      console.log(`   Público: ${event.isPublic ? 'Sim' : 'Não'}`);
      if (event.note) {
        console.log(`   Nota: ${event.note}`);
      }
      console.log('');
    });
    
    return data.project;
    
  } catch (error) {
    console.error('Erro ao buscar dados do projeto:', error.message);
    return null;
  }
}

// Exemplo de uso
async function exemplo() {
  // Substitua 'SEU_PROJECT_CODE' pelo código do projeto que você quer buscar
  const projectCode = 'SEU_PROJECT_CODE';
  
  console.log(`Buscando dados do projeto: ${projectCode}\n`);
  
  const dadosProjeto = await buscarDadosProjeto(projectCode);
  
  if (dadosProjeto) {
    console.log('\n✅ Dados carregados com sucesso!');
    
    // Exemplo de como acessar as cores dos eventos
    const coresUnicas = [...new Set(dadosProjeto.cuesheet.events.map(event => event.colour))];
    console.log(`\nCores únicas encontradas: ${coresUnicas.join(', ')}`);
    
    // Exemplo de como filtrar eventos por cor
    const eventosVermelhos = dadosProjeto.cuesheet.events.filter(event => event.colour === '#ff0000');
    console.log(`\nEventos vermelhos: ${eventosVermelhos.length}`);
    
  } else {
    console.log('❌ Falha ao carregar dados do projeto');
  }
}

// Executar exemplo (descomente para testar)
// exemplo();

module.exports = { buscarDadosProjeto };


