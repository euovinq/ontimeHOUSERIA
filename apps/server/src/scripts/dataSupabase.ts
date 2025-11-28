import axios from 'axios';

export async function reenviarRundown() {
  console.log('🧩 reenviarRundown iniciado...');

  setTimeout(async () => {
    try {
      await axios.get('http://localhost:4001/data/rundown/normalised');
    } catch (err) {
      console.error('❌ Erro ao reenviar rundown:', err.message);
    }
  }, 5000); // espera 5 segundos antes de tentar
}
