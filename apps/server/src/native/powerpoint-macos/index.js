const addon = require('./build/Release/powerpoint_macos.node');

/**
 * Obtém o status atual do PowerPoint
 * @returns {Promise<{isAvailable: boolean, slideCount?: number, currentSlide?: number, isInSlideShow?: boolean, slidesRemaining?: number, error?: string}>}
 */
function getPowerPointStatus() {
  try {
    return addon.getPowerPointStatus();
  } catch (error) {
    return {
      isAvailable: false,
      error: error.message || 'Erro ao acessar módulo nativo'
    };
  }
}

module.exports = { getPowerPointStatus };






