import axios from "axios";
import { fetchNormalisedRundown } from "./rundown";

export async function reenviarRundown() {
    try {
        // 1️⃣ Busca os dados da API local
        const dados = await fetchNormalisedRundown();

        console.log("📦 Dados do rundown:", dados);

        // 2️⃣ Envia os dados para uma API externa
        // const resposta = await axios.post("https://minhaapi.com/receber", dados);

        //console.log("✅ Dados enviados com sucesso:", resposta.data);
    } catch (erro) {
        //console.error("❌ Erro ao reenviar rundown:", erro);
    }
}
