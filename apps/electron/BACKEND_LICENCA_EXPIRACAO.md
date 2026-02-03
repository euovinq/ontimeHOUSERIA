# Backend: o que fazer para expiração de período (licença)

O app desktop já verifica a data de fim de acesso (`licenseExpiresAt`) no token JWT e encerra o uso quando a data passa. Para isso funcionar, o seu backend (Vercel) precisa fazer o seguinte.

---

## 1. Incluir `licenseExpiresAt` no payload do JWT (login)

Ao gerar o JWT no endpoint **POST /api/auth/desktop/login**, inclua no payload um claim com a data de fim do período de acesso do usuário.

- **Nome do claim:** `licenseExpiresAt`
- **Formato:** string em ISO (ex.: `"2026-12-31"` ou `"2026-12-31T23:59:59.000Z"`) ou timestamp em segundos (number).

Exemplo ao assinar o token (Node/JS):

```js
const payload = {
  userId: user.id,
  sessionId: session.id,
  isAdmin: user.isAdmin,   // ou admin: true/false — o app aceita qualquer um dos dois
  exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // token expira em 24h
  licenseExpiresAt: licenseExpiresAt   // ex.: "2026-12-31" ou null para admin/sem limite
};
const token = jwt.sign(payload, process.env.JWT_SECRET);
```

- **Admin:** o app aceita no payload tanto `isAdmin` quanto `admin` (true/false). Pode enviar um ou outro.
- A data deve vir da sua tabela de vendas/período (ex.: `sales`), para o usuário que está logando.
- Se o usuário for **admin** ou não tiver data de fim (acesso ilimitado), pode **omitir** o claim ou enviar `null`; o app considera “não expirado” quando não existe `licenseExpiresAt`.

---

## 2. Continuar retornando `licenseExpiresAt` no JSON de login

Na resposta do login, mantenha o campo **`licenseExpiresAt`** (como já pode estar hoje), para o app poder mostrar “dias restantes” na UI no futuro, se quiser:

```json
{
  "success": true,
  "token": "...",
  "user": { ... },
  "session": { ... },
  "licenseExpiresAt": "2026-12-31"
}
```

Para admin ou sem data, pode enviar `null`.

---

## 3. Bloquear login quando o período já expirou

No **POST /api/auth/desktop/login**, antes de criar sessão e gerar o JWT:

- Consulte a tabela de vendas/período (ex.: `sales`) e pegue a data de fim de acesso do usuário.
- Se essa data já passou (hoje > data fim), responda com erro e **não** emita token.

Exemplo de resposta:

- **Status:** 403 (ou 401)
- **Body:** `{ "success": false, "code": "period_expired", "message": "Seu período de acesso expirou. Faça uma nova aquisição." }`

O app já trata o código `period_expired` e mostra a mensagem correta.

---

## 4. (Opcional) Revalidar licença em rotas protegidas

Se quiser que a API também bloqueie requisições quando o período tiver expirado (além do app):

- Ao validar o JWT em rotas protegidas, leia o claim **`licenseExpiresAt`** do payload.
- Se existir e a data for anterior a “agora”, responda **403** com algo como:  
  `{ "message": "Período de acesso encerrado." }`

Assim, mesmo com um token ainda válido (não expirado em `exp`), o uso fica bloqueado depois da data de licença.

---

## Resumo

| Onde              | O que fazer |
|-------------------|-------------|
| Login (gerar JWT) | Incluir no payload: `licenseExpiresAt` com a data fim (tabela sales). Admin/sem limite: omitir ou `null`. |
| Resposta do login | Manter `licenseExpiresAt` no JSON (ou `null`). |
| Login (validação) | Se período já expirou, não criar sessão; retornar `period_expired`. |
| Rotas protegidas  | (Opcional) Se `licenseExpiresAt` no token já passou, retornar 403. |

Com isso, o app desktop:

- Ao abrir: se o token tiver `licenseExpiresAt` no passado, não considera logado e mostra a tela de login (e limpa os dados salvos).
- A cada 15 minutos: se a licença tiver expirado, mostra o aviso e encerra o app.
- O evento `auth-license-expired` (enviado pelo React, se usar) também usa essa mesma lógica de encerramento.
