const path = require('path');
const addon = require(path.join(__dirname, 'build', 'Release', 'powerpoint_windows.node'));

function getPowerPointStatus() {
  try {
    return addon.getPowerPointStatus();
  } catch (error) {
    return {
      isAvailable: false,
      error: error.message || 'Erro ao obter status do PowerPoint'
    };
  }
}

module.exports = { getPowerPointStatus };













