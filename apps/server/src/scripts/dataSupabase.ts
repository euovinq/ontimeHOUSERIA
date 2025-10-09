import axios from 'axios';

export async function reenviarRundown() {
  console.log('🧩 reenviarRundown iniciado...');

  setTimeout(async () => {
    try {
      const dados = await axios.get('http://localhost:4001/data/rundown/normalised');
      console.log('📦 Dados do rundown obtidos:', dados.data);
    } catch (err) {
      console.error('❌ Erro ao reenviar rundown:', err.message);
    }
  }, 5000); // espera 5 segundos antes de tentar
}
