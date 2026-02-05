const keytar = require('keytar');
const { getServerUrl } = require('../externals.js');
const { isProduction } = require('../externals.js');
const config = require('../config.js');

const SERVICE_NAME = 'HouseriaAPP';
const TOKEN_KEY = 'auth_token';
const USER_DATA_KEY = 'user_data';

/**
 * Obtém um ID único da máquina. Usa node-machine-id se disponível; senão, fallback com crypto + os.
 * @returns {string} Machine ID
 */
function getMachineId() {
  try {
    const { machineIdSync } = require('node-machine-id');
    return machineIdSync();
  } catch (_) {
    const os = require('os');
    return require('crypto')
      .createHash('sha256')
      .update(os.hostname() + os.platform() + os.arch())
      .digest('hex')
      .substring(0, 32);
  }
}

/**
 * Serviço de autenticação para gerenciar login, logout e tokens JWT
 */
class AuthService {
  constructor() {
    this.token = null;
    this.userData = null;
    this.sessionData = null;
    this.machineId = getMachineId();
    console.log('🖥️ Machine ID obtido:', this.machineId ? `${this.machineId.substring(0, 8)}...` : '(fallback)');
  }

  /**
   * Constrói uma URL completa para um endpoint da API
   * @param {string} baseUrl - URL base da API (ex: https://www.houseria.art.br)
   * @param {string} endpoint - Endpoint (ex: /auth/login)
   * @returns {string} URL completa
   */
  buildApiUrl(baseUrl, endpoint) {
    // Remove barra final da baseUrl se existir
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    
    // Garante que o endpoint comece com /
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    
    // Trata o prefixo da API
    const prefix = config.apiPrefix || '';
    let fullPath = '';
    
    if (prefix) {
      // Se o prefixo começar com /, usa como está; senão, adiciona /
      const cleanPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`;
      // Remove barra dupla se o endpoint já começar com /
      fullPath = `${cleanPrefix}${cleanEndpoint}`;
    } else {
      fullPath = cleanEndpoint;
    }
    
    // Remove barras duplas que possam ter sido criadas
    const finalUrl = `${cleanBaseUrl}${fullPath}`.replace(/([^:]\/)\/+/g, '$1');
    
    // Log em desenvolvimento para debug
    if (process.env.NODE_ENV !== 'production') {
      console.log(`🔗 Construindo URL: ${baseUrl} + prefixo "${prefix || '(nenhum)'}" + ${endpoint} = ${finalUrl}`);
    }
    
    return finalUrl;
  }

  /**
   * Obtém URL base da API
   * 
   * Prioridade:
   * 1. API_URL (variável de ambiente) - para qualquer ambiente (mais alta prioridade)
   * 2. REMOTE_API_URL (variável de ambiente) - para qualquer ambiente
   * 3. Servidor remoto padrão (defaultRemoteApiUrl) - mesmo em produção
   * 4. Servidor local (apenas se explicitamente necessário)
   * 5. Fallback: localhost:4001
   */
  getApiBaseUrl(port) {
    // Se API_URL estiver configurada (ex: Vercel), usar ela (prioridade máxima)
    // Isso permite usar servidor remoto tanto em dev quanto em produção
    if (config.apiUrl) {
      console.log(`🌐 Usando API_URL: ${config.apiUrl}`);
      return config.apiUrl;
    }
    
    // Se REMOTE_API_URL estiver configurada, usar ela (mesmo em produção)
    if (config.remoteApiUrl) {
      console.log(`🌐 Usando REMOTE_API_URL: ${config.remoteApiUrl}`);
      return config.remoteApiUrl;
    }
    
    // Se não houver API_URL nem REMOTE_API_URL, usar servidor remoto padrão
    // Isso garante que login/logout sempre usem a API externa quando não configurado explicitamente
    if (config.defaultRemoteApiUrl) {
      console.log(`🌐 Usando servidor remoto padrão: ${config.defaultRemoteApiUrl}`);
      console.log(`💡 Para usar outro servidor, configure API_URL ou REMOTE_API_URL`);
      return config.defaultRemoteApiUrl;
    }
    
    // Servidor local só como último recurso (quando não há nenhuma API externa configurada)
    if (isProduction && port) {
      const localUrl = getServerUrl(port);
      console.log(`🏠 [PROD] Usando servidor local (fallback): ${localUrl}`);
      console.log(`⚠️ Nenhuma API externa configurada. Configure API_URL ou REMOTE_API_URL para usar API externa.`);
      return localUrl;
    }
    
    // Fallback final: localhost (não deveria chegar aqui)
    console.log(`🏠 [FALLBACK] Usando localhost:4001`);
    return 'http://localhost:4001';
  }

  /**
   * Faz login via API
   * @param {string} email - Email do usuário
   * @param {string} password - Senha do usuário
   * @param {number} [port] - Porta do servidor (para produção local)
   * @returns {Promise<Object>} Dados do login (token, user, session, licenseExpiresAt)
   */
  async login(email, password, port) {
    try {
      if (!this.machineId || typeof this.machineId !== 'string' || !this.machineId.trim()) {
        throw new Error('Não foi possível obter o identificador da máquina. Reinicie o aplicativo.');
      }
      const apiUrl = this.getApiBaseUrl(port);
      const loginUrl = this.buildApiUrl(apiUrl, '/auth/desktop/login');
      
      console.log(`🔗 Tentando login em (desktop): ${loginUrl}`);

      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email.trim(),
          password: password,
          machineId: this.machineId,
        }),
      });

      // Verificar o tipo de conteúdo da resposta
      const contentType = response.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');
      
      // Ler o texto da resposta primeiro para debug
      const responseText = await response.text();
      
      if (!isJson) {
        console.error('❌ Resposta não é JSON. Content-Type:', contentType);
        console.error('❌ Resposta recebida (primeiros 500 caracteres):', responseText.substring(0, 500));
        
        // Se for HTML, provavelmente é uma página de erro 404 ou similar
        if (contentType && contentType.includes('text/html')) {
          throw new Error(
            `A API retornou HTML ao invés de JSON. Isso geralmente significa que a URL está incorreta.\n` +
            `URL tentada: ${loginUrl}\n` +
            `Status: ${response.status} ${response.statusText}\n` +
            `Verifique se o endpoint está correto e se o servidor está configurado para retornar JSON.`
          );
        }
        
        throw new Error(
          `Resposta da API não é JSON. Content-Type: ${contentType || 'não especificado'}\n` +
          `Status: ${response.status} ${response.statusText}\n` +
          `Resposta: ${responseText.substring(0, 200)}`
        );
      }
      
      // Tentar fazer parse do JSON
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('❌ Erro ao fazer parse do JSON:', parseError);
        console.error('❌ Resposta recebida:', responseText);
        throw new Error(
          `Erro ao processar resposta da API: ${parseError.message}\n` +
          `Status: ${response.status} ${response.statusText}\n` +
          `Resposta: ${responseText.substring(0, 200)}`
        );
      }

      // Log da resposta completa para debug
      console.log('📥 Resposta do servidor (status):', response.status, response.statusText);
      console.log('📥 Resposta do servidor (dados):', JSON.stringify(data, null, 2));
      console.log('📥 Campos presentes na resposta:', Object.keys(data));

      if (!response.ok) {
        console.log('❌ Resposta não OK, tratando erro...');
        throw this.handleLoginError(data, response.status);
      }

      console.log('✅ Resposta OK, validando dados...');

      // Validar que o token foi retornado (endpoint desktop: success, token, user, session, licenseExpiresAt)
      if (!data.token) {
        console.error('❌ Token não retornado pela API. Resposta recebida:', JSON.stringify(data, null, 2));
        throw new Error(
          'O servidor não retornou um token JWT. A resposta não contém o campo "token".'
        );
      }

      console.log('✅ Token encontrado, validando formato...');

      // Validar que token é uma string não vazia
      if (typeof data.token !== 'string' || data.token.trim() === '') {
        console.error('❌ Token inválido recebido:', typeof data.token, data.token);
        throw new Error('Token JWT inválido recebido da API.');
      }

      console.log('✅ Token válido, preparando dados do usuário...');

      // Armazenar dados (formato endpoint desktop: user, session com id, activeMachines, maxLimit, reused)
      this.token = data.token;
      this.userData = data.user || {
        id: data.userId,
        email: data.email,
        isAdmin: data.isAdmin,
      };
      const rawSession = data.session || {};
      this.sessionData = {
        ...rawSession,
        id: rawSession.id,
        activeMachines: rawSession.activeMachines,
        maxLimit: rawSession.maxLimit,
        baseLimit: rawSession.baseLimit,
        additionalLicenses: rawSession.additionalLicenses,
        reused: rawSession.reused,
        // Compatibilidade com código que usa activeSessions
        activeSessions: rawSession.activeMachines ?? rawSession.activeSessions,
        sessionId: rawSession.id ?? rawSession.sessionId,
      };

      console.log('✅ Dados preparados:', {
        hasToken: !!this.token,
        hasUserData: !!this.userData,
        hasSessionData: !!this.sessionData,
        userData: this.userData,
        sessionData: this.sessionData,
      });

      // Salvar no keychain de forma segura
      console.log('💾 Salvando token no keychain...');
      await this.saveTokenSecurely(this.token);
      console.log('💾 Salvando dados do usuário no keychain...');
      await this.saveUserData(this.userData, this.sessionData, data.licenseExpiresAt);
      console.log('✅ Dados salvos com sucesso!');

      const result = {
        success: true,
        token: data.token,
        user: data.user || this.userData,
        session: data.session || this.sessionData,
        licenseExpiresAt: data.licenseExpiresAt,
      };

      console.log('✅ Login (desktop) concluído com sucesso! Retornando resultado...');
      return result;
    } catch (error) {
      console.error('Erro no login:', error.message);
      throw error;
    }
  }

  /**
   * Faz logout via API
   * @param {number} [port] - Porta do servidor (para produção local)
   */
  async logout(port) {
    if (!this.token) {
      // Já está deslogado, apenas limpar dados locais
      await this.clearStoredData();
      return;
    }

    try {
      const apiUrl = this.getApiBaseUrl(port);
      const logoutUrl = this.buildApiUrl(apiUrl, '/auth/desktop/logout');
      console.log(`🔗 Tentando logout em (desktop): ${logoutUrl}`);
      
      await fetch(logoutUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      console.error('Erro ao fazer logout no servidor:', error.message);
      // Continuar mesmo se logout no servidor falhar
    } finally {
      // Sempre limpar dados locais
      this.token = null;
      this.userData = null;
      this.sessionData = null;
      await this.clearStoredData();
    }
  }

  /**
   * Decodifica o payload do JWT (sem validar assinatura).
   * @param {string} token - Token JWT
   * @returns {Object|null} Payload ou null
   */
  decodeTokenPayload(token) {
    if (!token || typeof token !== 'string') return null;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * Obtém a data de expiração do período de acesso (licença) a partir do JWT.
   * O backend deve incluir no payload do JWT o claim licenseExpiresAt (ISO string ou timestamp).
   * @param {string} [token] - Token a verificar (opcional)
   * @returns {string|null} Data em ISO ou null se não houver (ex.: admin)
   */
  getLicenseExpiresAtFromToken(token) {
    const t = token || this.token;
    const payload = this.decodeTokenPayload(t);
    if (!payload || payload.licenseExpiresAt == null) return null;
    return payload.licenseExpiresAt;
  }

  /**
   * Verifica se o período de acesso (licença) expirou.
   * Se não houver licenseExpiresAt no token (ex.: admin), considera não expirado.
   * @param {string} [token] - Token a verificar (opcional)
   * @returns {boolean} true se a data de licença já passou
   */
  isLicenseExpired(token) {
    const licenseExpiresAt = this.getLicenseExpiresAtFromToken(token || this.token);
    if (!licenseExpiresAt) return false;
    try {
      const endMs = new Date(licenseExpiresAt).getTime();
      return Number.isFinite(endMs) && endMs < Date.now();
    } catch {
      return false;
    }
  }

  /**
   * Verifica se token está expirado (sem validar assinatura)
   * @param {string} [token] - Token a verificar (opcional, usa token atual se não fornecido)
   * @returns {boolean} true se expirado
   */
  isTokenExpired(token) {
    const tokenToCheck = token || this.token;
    if (!tokenToCheck) {
      return true;
    }

    try {
      const payload = this.decodeTokenPayload(tokenToCheck);
      if (!payload || payload.exp == null) return true;
      const now = Math.floor(Date.now() / 1000);
      return payload.exp < now;
    } catch (error) {
      console.error('Erro ao verificar expiração do token:', error);
      return true;
    }
  }

  /**
   * Verifica se usuário está autenticado (token válido e licença não expirada)
   * @returns {boolean} true se autenticado
   */
  isAuthenticated() {
    if (this.token === null || this.isTokenExpired()) return false;
    if (this.isLicenseExpired()) return false;
    return true;
  }

  /**
   * Retorna informações de licença a partir do JWT (para exibir em Config).
   * Aceita no payload: isAdmin ou admin (backend pode enviar qualquer um).
   * @returns {{ licenseExpiresAt: string|null, isAdmin: boolean }}
   */
  getLicenseInfo() {
    const payload = this.decodeTokenPayload(this.token);
    if (!payload) {
      return { licenseExpiresAt: null, isAdmin: false };
    }
    const isAdmin = payload.isAdmin === true || payload.admin === true;
    const licenseExpiresAt = this.getLicenseExpiresAtFromToken(this.token);
    return { licenseExpiresAt, isAdmin };
  }

  /**
   * Obtém token atual
   * @returns {string|null} Token JWT ou null
   */
  getToken() {
    return this.token;
  }

  /**
   * Obtém dados do usuário
   * @returns {Object|null} Dados do usuário ou null
   */
  getUserData() {
    return this.userData;
  }

  /**
   * Obtém dados da sessão
   * @returns {Object|null} Dados da sessão ou null
   */
  getSessionData() {
    return this.sessionData;
  }

  /**
   * Carrega token salvo ao iniciar app.
   * Considera inválido se o token expirou ou se o período de licença (licenseExpiresAt) passou.
   * @returns {Promise<boolean>} true se token válido e licença ativa foi carregado
   */
  async loadStoredToken() {
    try {
      const token = await this.loadTokenSecurely();
      if (!token || this.isTokenExpired(token)) return false;
      if (this.isLicenseExpired(token)) {
        console.log('📅 Período de acesso expirado (licenseExpiresAt). Limpando dados salvos.');
        await this.clearStoredData();
        this.token = null;
        this.userData = null;
        this.sessionData = null;
        return false;
      }

      this.token = token;
      const userData = await this.loadUserData();
      if (userData) {
        this.userData = userData.user;
        this.sessionData = userData.session;
      }
      return true;
    } catch (error) {
      console.error('Erro ao carregar token salvo:', error);
      return false;
    }
  }

  /**
   * Faz requisições autenticadas
   * @param {string} url - URL da requisição
   * @param {RequestInit} [options] - Opções do fetch
   * @returns {Promise<Response>} Resposta da requisição
   */
  async authenticatedFetch(url, options = {}) {
    if (!this.token || this.isTokenExpired()) {
      throw new Error('Token inválido ou expirado. Faça login novamente.');
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    });

    // Se token inválido, fazer logout automático
    if (response.status === 401) {
      await this.logout();
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    return response;
  }

  /**
   * Trata erros de login e retorna Error apropriado
   * @private
   */
  handleLoginError(data, status) {
    if (data.code === 'invalid_credentials') {
      return new Error('Email ou senha incorretos.');
    } else if (data.code === 'period_expired') {
      return new Error('Seu período de acesso expirou. Faça uma nova aquisição.');
    } else if (data.code === 'max_sessions_reached') {
      const activeMachines = data.activeMachines ?? data.activeSessions ?? 0;
      const maxLimit = data.maxLimit ?? 5;
      const message = `Limite de ${maxLimit} máquinas atingido. ` +
        `Você possui ${activeMachines} máquina(s) ativa(s). ` +
        `Faça logout em uma das instâncias ou compre licenças adicionais.`;
      const error = new Error(message);
      error.code = 'max_sessions_reached';
      error.details = {
        activeMachines,
        activeSessions: activeMachines,
        maxLimit,
        baseLimit: data.baseLimit,
        additionalLicenses: data.additionalLicenses,
        availableSlots: data.availableSlots,
      };
      return error;
    } else if (status === 401) {
      return new Error('Usuário ou senha inválidos.');
    } else if (status === 403) {
      return new Error('Acesso negado. Verifique suas credenciais.');
    } else {
      return new Error(data.message || 'Erro ao fazer login. Tente novamente.');
    }
  }

  /**
   * Salva token no keychain de forma segura
   * @private
   */
  async saveTokenSecurely(token) {
    // Validar que token não é null, undefined ou string vazia
    if (!token || typeof token !== 'string' || token.trim() === '') {
      throw new Error('Token inválido: não pode ser vazio ou nulo.');
    }

    try {
      await keytar.setPassword(SERVICE_NAME, TOKEN_KEY, token);
    } catch (error) {
      console.error('Erro ao salvar token no keychain:', error);
      // Em caso de erro, não falhar o login, mas logar o erro
      throw new Error('Erro ao salvar credenciais. Tente novamente.');
    }
  }

  /**
   * Carrega token do keychain
   * @private
   */
  async loadTokenSecurely() {
    try {
      return await keytar.getPassword(SERVICE_NAME, TOKEN_KEY);
    } catch (error) {
      console.error('Erro ao carregar token do keychain:', error);
      return null;
    }
  }

  /**
   * Salva dados do usuário no keychain
   * @private
   */
  async saveUserData(user, session, licenseExpiresAt) {
    try {
      const userData = {
        user,
        session,
        licenseExpiresAt,
        savedAt: new Date().toISOString(),
      };
      await keytar.setPassword(SERVICE_NAME, USER_DATA_KEY, JSON.stringify(userData));
    } catch (error) {
      console.error('Erro ao salvar dados do usuário:', error);
      // Não falhar se não conseguir salvar dados do usuário
    }
  }

  /**
   * Carrega dados do usuário do keychain
   * @private
   */
  async loadUserData() {
    try {
      const userDataStr = await keytar.getPassword(SERVICE_NAME, USER_DATA_KEY);
      if (userDataStr) {
        return JSON.parse(userDataStr);
      }
      return null;
    } catch (error) {
      console.error('Erro ao carregar dados do usuário:', error);
      return null;
    }
  }

  /**
   * Limpa todos os dados armazenados
   * @private
   */
  async clearStoredData() {
    try {
      await keytar.deletePassword(SERVICE_NAME, TOKEN_KEY);
      await keytar.deletePassword(SERVICE_NAME, USER_DATA_KEY);
    } catch (error) {
      console.error('Erro ao limpar dados armazenados:', error);
      // Continuar mesmo se falhar
    }
  }
}

// Exportar instância singleton
module.exports = new AuthService();
