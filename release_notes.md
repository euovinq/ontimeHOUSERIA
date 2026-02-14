# HouseriaAPP - O que mudou na versão 1.0.3

## ☁️ Melhorias na sincronização com a nuvem

Quando o projeto está conectado ao Supabase, as alterações passam a subir para a nuvem **assim que você sai do campo** (ao clicar em outro lugar ou apertar Tab).

### 📤 O que passa a sincronizar na hora
- **Nome do evento** – ao digitar o título e sair do campo
- **Nota do evento** – ao preencher a nota e sair do campo
- **Campos customizados** – ao preencher qualquer campo extra e sair
- **Cor do evento**
- **Cue e demais informações**

Também sincroniza quando você:
- ➕ Cria um novo evento
- 🔀 Reordena ou troca eventos
- ⏱️ Aplica delay
- 🗑️ Deleta eventos
- 📝 Cria, edita ou remove campos customizados

---

## 🐛 Correções

- **Nome do evento na nuvem**: Antes, ao criar um evento e dar um nome, o nome às vezes não aparecia na nuvem. Agora isso foi corrigido. ✅
- **Campos customizados**: Os valores que você preenche nos campos extras agora são enviados corretamente para a nuvem. ✅
